"""Watch the transport and recover it when the agent has gone silently deaf.

The gateway process can stay alive while its transport stops receiving, which is
how the agent went deaf for ten hours on September 16. The gateway records each
platform in gateway_state.json, and the transport rewrites its entry after every
attempt that ends, so an entry that is not connected and has not been written
for six minutes means the retry loop itself has stopped. This reads that file
from outside the process; nothing upstream is modified.
"""
import datetime as dt
import http.client
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request

STATE_PATH = "/var/lib/hermes/gateway_state.json"
PROC = "/proc"
PLATFORMS = ("plow_chat", "plow_email")
GRACE_SECONDS = 360
STATE_LIMIT = 1_048_576


def read_safely(path, read):
    """What `read` makes of a regular file at path, or None when there is none.

    The gateway's own user writes the files this module reads and the watchdog
    reads them as root, so a symlink, a FIFO or a directory is refused rather
    than followed, and the open never blocks.
    """
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError:
        return None
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            return None
        with os.fdopen(descriptor, "rb") as handle:
            descriptor = None
            return read(handle)
    except OSError:
        return None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def load_state(path=STATE_PATH):
    """The parsed state file, or None when it is missing, unsafe or not a JSON object.

    An oversized file or nesting deep enough to exhaust the parser is refused
    too, on top of the care read_safely takes.
    """
    raw = read_safely(path, lambda handle: handle.read(STATE_LIMIT + 1))
    if raw is None or len(raw) > STATE_LIMIT:
        return None
    try:
        doc = json.loads(raw)
    except (ValueError, RecursionError):
        return None
    return doc if isinstance(doc, dict) else None


def process_start_time(pid, proc=PROC):
    """Field 22 of /proc/<pid>/stat, or None when the process is gone or a zombie.

    The command name in field 2 can hold spaces and parentheses, so fields are
    counted from its last closing parenthesis, where the state comes first and
    the start time twentieth.
    """
    try:
        with open(f"{proc}/{pid}/stat", encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        fields = text[text.rindex(")") + 1:].split()
        return None if fields[0] == "Z" else int(fields[19])
    except (OSError, ValueError, IndexError):
        return None


def writer_live(entry, start_time_of=process_start_time):
    """Whether the process that wrote this entry is still the one under its id.

    The test upstream's status endpoint applies: the start times must match
    whenever both are known, which catches a reused process id.
    """
    pid = entry.get("writer_pid")
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        return False
    current = start_time_of(pid)
    if current is None:
        return False
    recorded = entry.get("writer_start_time")
    return not isinstance(recorded, int) or recorded == current


def _parse(value):
    moment = dt.datetime.fromisoformat(value)
    return moment if moment.tzinfo else moment.replace(tzinfo=dt.timezone.utc)


def assess(doc, start_time_of=process_start_time):
    """What the watched entries say, as (silent_since, unseen).

    silent_since is the oldest updated_at among live entries that are not
    connected, or None. The retry loop rewrites its entry after every attempt
    that ends, so an old one means the loop has gone silent. unseen is True when
    the file is missing or unreadable, an entry is absent or undated, or an
    entry's writer is not live, which covers the entries every new gateway
    inherits until its adapters report. Those carry no time worth trusting, so
    the caller dates them from its own first sighting.
    """
    platforms = doc.get("platforms") if isinstance(doc, dict) else None
    if not isinstance(platforms, dict):
        return None, True
    silent_since, unseen = None, False
    for name in PLATFORMS:
        entry = platforms.get(name)
        if not isinstance(entry, dict) or not writer_live(entry, start_time_of):
            unseen = True
            continue
        if entry.get("state") == "connected":
            continue
        try:
            updated = _parse(entry["updated_at"])
        except (KeyError, TypeError, ValueError):
            unseen = True
            continue
        if silent_since is None or updated < silent_since:
            silent_since = updated
    return silent_since, unseen


def unhealthy(since, now):
    return since is not None and (now - since).total_seconds() >= GRACE_SECONDS


MCP_LOG = "/var/lib/hermes/logs/agent.log"
MCP_SERVER = "plow"
MCP_TAIL_BYTES = 262_144
MCP_GRACE_SECONDS = 360
MCP_CHANGE = re.compile(r"\(state:\s*(?P<was>[^)]*?)\s*(?:→|->)\s*(?P<now>[^)]*?)\s*\)")
MCP_STAMP = re.compile(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}),(\d{3})")


def read_tail(path, limit):
    """The end of a text file, at most `limit` bytes of it, without a partial line.

    The gateway's log is appended to forever, so only its end is read, and the
    line the window opens inside is dropped rather than half parsed.
    """
    def window(handle):
        handle.seek(0, os.SEEK_END)
        start = max(0, handle.tell() - limit)
        handle.seek(start)
        return start, handle.read(limit)

    read = read_safely(path, window)
    if read is None:
        return ""
    start, raw = read
    text = raw.decode("utf-8", errors="replace")
    return text.partition("\n")[2] if start else text


def logged_at(line):
    """The UTC moment a log line was stamped with, or None when it carries none.

    The container runs on UTC and the gateway's logger writes a naive stamp, so
    the moment is read as UTC and returned aware.
    """
    stamp = MCP_STAMP.match(line)
    if stamp is None:
        return None
    try:
        moment = dt.datetime.strptime(stamp.group(1), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return moment.replace(microsecond=int(stamp.group(2)) * 1000, tzinfo=dt.timezone.utc)


def mcp_status(path=MCP_LOG, server=MCP_SERVER, tail=MCP_TAIL_BYTES):
    """(state, since) for the MCP session the agent reaches the owner's Mac through.

    Nothing records this session in gateway_state.json, so the last line that
    reports a state change for the server names both its state and when it
    changed. The real log writes the arrow as U+2192; a plain -> reads the same.
    (None, None) means there is no such line to read.
    """
    named = f"MCP server '{server}'"
    for line in reversed(read_tail(path, tail).splitlines()):
        if named not in line:
            continue
        change = MCP_CHANGE.search(line)
        if change is None:
            continue
        state = change.group("now").lower()
        if state:
            return state, logged_at(line)
    return None, None


RESTART_COOLDOWN_SECONDS = 600
VERIFY_SECONDS = 180
MAX_FAILED_RECOVERIES = 3


class Watchdog:
    """Decides, one observation at a time, whether to wait, restart or alert.

    It never reads the clock, the file system or the network, so every rule is
    tested by feeding it observations.
    """

    def __init__(self):
        self.unseen_since = None
        self.since = None
        self.last_restart_at = None
        self.pending_since = None
        self.failed = 0
        self.alerted = False

    def observe(self, now, silent_since, unseen):
        """One of none, restart, recovered, recovery_failed, alert or reconnected.

        silent_since and unseen are what assess reported. An unseen problem is
        dated from the first observation that reported one and forgotten by the
        first that does not, so a long stall never shortens the grace a dead
        writer gets.
        """
        if not unseen:
            self.unseen_since = None
        elif self.unseen_since is None:
            self.unseen_since = now
        known = [moment for moment in (silent_since, self.unseen_since) if moment is not None]
        self.since = min(known) if known else None
        since = self.since

        if self.pending_since is not None:
            if since is None:
                self._reset()
                return "recovered"
            if (now - self.pending_since).total_seconds() < VERIFY_SECONDS:
                return "none"
            self.pending_since = None
            self.failed += 1
            return "recovery_failed"

        if since is None:
            if self.failed or self.alerted:
                self._reset()
                return "reconnected"
            return "none"

        if not unhealthy(since, now):
            return "none"

        if self.failed >= MAX_FAILED_RECOVERIES:
            if self.alerted:
                return "none"
            self.alerted = True
            return "alert"

        if (self.last_restart_at is not None
                and (now - self.last_restart_at).total_seconds() < RESTART_COOLDOWN_SECONDS):
            return "none"

        self.last_restart_at = now
        self.pending_since = now
        return "restart"

    def _reset(self):
        self.pending_since = None
        self.failed = 0
        self.alerted = False


API_BASE = "https://api.plow.co"
ALERT_TEXT = (
    "I stopped receiving messages and could not reconnect after three tries, so "
    "anything you send me now will not reach me. Restarting the agent may fix it."
)


def delivery_unknown(status):
    """Plow may have accepted a message answered this way, so it is never resent.

    The plugin's own _message_delivery_unknown reads these statuses the same way.
    """
    return status >= 500 or status in (408, 424)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Refuse redirects, which urllib would follow carrying the Authorization header."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def plow_opener():
    """An opener that ignores proxy settings and refuses redirects, as the Plow bridge's does."""
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


OPENER = plow_opener()
CHAT_UID = re.compile(r"[A-Za-z0-9_-]{1,180}")


def build_alert_request(base, token, chat_uid, text=ALERT_TEXT):
    return urllib.request.Request(
        f"{base.rstrip('/')}/v1/chats/{chat_uid}/messages",
        data=json.dumps({"body": text}).encode("utf-8"),
        method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )


def send_alert(base, token, chat_uid, opener=OPENER.open, text=ALERT_TEXT):
    """sent, failed or unknown. Called once per failure episode and never retried.

    Unknown means Plow may have the message, so sending again risks a double
    send. The plugin sends over REST and only receives over the websocket, so
    this path can stay open while the transport is deaf. The bearer goes only to
    an https base and a well formed chat id, never through a proxy or a
    redirect, as the repository's own Plow bridge requires.
    """
    if not base.startswith("https://") or not CHAT_UID.fullmatch(chat_uid):
        return "failed"
    request = build_alert_request(base, token, chat_uid, text)
    try:
        with opener(request, timeout=20) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        return "unknown" if delivery_unknown(error.code) else "failed"
    except urllib.error.URLError as error:
        return "unknown" if isinstance(error.reason, TimeoutError) else "failed"
    except (OSError, http.client.HTTPException):
        return "unknown"
    try:
        payload = json.loads(raw or b"{}")
    except ValueError:
        return "unknown"
    uid = payload.get("uid") if isinstance(payload, dict) else None
    return "sent" if isinstance(uid, str) and uid else "unknown"


GATEWAY_SERVICE = "/run/service/hermes-gateway"
ENV_DIR = "/run/s6/container_environment"
CHECK_SECONDS = 60


def read_env(name, env_dir=ENV_DIR):
    """One value plow-init published for the container, or an empty string."""
    try:
        with open(os.path.join(env_dir, name), encoding="utf-8") as handle:
            return handle.read().strip()
    except OSError:
        return ""


def log(message):
    print(f"transport-watchdog: {message}", file=sys.stderr, flush=True)


def restart_gateway(run=subprocess.run):
    """Ask s6 to restart the gateway. A service held down with s6-svc -d stays down."""
    try:
        return run(["/command/s6-svc", "-r", GATEWAY_SERVICE], check=False).returncode == 0
    except OSError:
        return False


def make_alert(base, token, chat_uid, send=send_alert):
    """The alert to send when recovery fails. Only its outcome ever reaches the log."""
    return lambda: send(base, token, chat_uid)


def settings(read=read_env):
    """(base, token, chat_uid) as plow-init published them, with the plugin's default base."""
    return read("PLOW_API_BASE") or API_BASE, read("PLOW_AGENT_TOKEN"), read("PLOW_HOME_CHANNEL")


def once(dog, now, doc, restart, alert, log=log, start_time_of=process_start_time):
    """Apply one observation, log what it led to, and return the action."""
    silent_since, unseen = assess(doc, start_time_of)
    action = dog.observe(now, silent_since, unseen)
    if action == "restart":
        log(f"transport not healthy since {dog.since:%H:%M} UTC, restarting the gateway")
        if not restart():
            log("s6 did not accept the restart")
    elif action == "recovered":
        log("transport reconnected after the restart")
    elif action == "recovery_failed":
        log(f"the restart did not reconnect the transport, {dog.failed} of {MAX_FAILED_RECOVERIES}")
    elif action == "alert":
        try:
            outcome = alert()
        except Exception as error:  # the episode's only alert must still leave a record
            outcome = f"failed with {type(error).__name__}"
        log(f"recovery failed {MAX_FAILED_RECOVERIES} times, owner alert {outcome}")
    elif action == "reconnected":
        log("transport connected again")
    return action


def main(configured=settings, sleep=time.sleep, log=log):
    base, token, chat = configured()
    missing = [name for name, value in (("PLOW_AGENT_TOKEN", token), ("PLOW_HOME_CHANNEL", chat)) if not value]
    if missing:
        # The chat platform is enabled only when both are set, and the alert needs
        # both, so there is nothing to watch and no one to tell. Standing down for a
        # day and exiting lets s6 look again, as agent-index does.
        log(f"no {' or '.join(missing)} in this container, so the iMessage line is not set up; standing down")
        sleep(86400)
        return
    alert = make_alert(base, token, chat)
    dog = Watchdog()
    while True:
        try:
            once(dog, dt.datetime.now(dt.timezone.utc), load_state(), restart_gateway, alert, log=log)
        except Exception as error:  # a longrun that crashes is respawned in a tight loop
            log(f"check failed with {type(error).__name__}")
        sleep(CHECK_SECONDS)


if __name__ == "__main__":
    main()
