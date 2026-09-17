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
# One anchored shape for the whole line, because a chat message or a tool error
# quoting a state change is written into this same file verbatim, and only the
# gateway's own MCP logger may be believed. Every variable part is bounded, so
# one absurd line cannot cost the watchdog a minute of root cpu.
MCP_LINE = re.compile(
    r"(?P<stamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}) [A-Z]{4,8} "
    r"tools\.mcp_tool: MCP server '(?P<server>[^'\n]{1,64})'"
    r"[^\n]{0,400}?"
    r"\(state: ?(?P<was>[A-Za-z_]{1,32}) ?(?:→|->) ?(?P<now>[A-Za-z_]{1,32})\)")
MCP_STAMP_FORMAT = "%Y-%m-%d %H:%M:%S,%f"


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


def stamped_at(stamp):
    """The UTC moment a logger stamp names, or None when it names no real moment.

    The container runs on UTC and the gateway's logger writes a naive stamp, so
    the moment is read as UTC and returned aware.
    """
    try:
        return dt.datetime.strptime(stamp, MCP_STAMP_FORMAT).replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def mcp_status(path=MCP_LOG, server=MCP_SERVER, tail=MCP_TAIL_BYTES):
    """(state, since) for the MCP session the agent reaches the owner's Mac through.

    Nothing records this session in gateway_state.json, so the last line the
    gateway's own MCP logger wrote about the server names both its state and when
    it changed. The whole line must have that logger's shape: anything else in
    this file, including a message or a tool error quoting a state change, is not
    a reading, and neither is a line whose stamp names no real moment. The real
    log writes the arrow as U+2192; a plain -> reads the same. (None, None) means
    there is nothing to read.
    """
    for line in reversed(read_tail(path, tail).splitlines()):
        written = MCP_LINE.match(line)
        if written is None or written.group("server") != server:
            continue
        when = stamped_at(written.group("stamp"))
        if when is not None:
            return written.group("now").lower(), when
    return None, None


def mcp_problem(state, since):
    """When the Mac session's trouble started, or None while there is none.

    Only connected is healthy. degraded and parked are what the log writes, and
    any other state is read the same way rather than assumed benign. The date is
    the log's own, never the clock, so the trouble ages. The caller applies the
    grace with unhealthy, which gives the Mac session the MCP_GRACE_SECONDS the
    transport gets: a parked session self probes only every five minutes.
    """
    if state is None or state == "connected":
        return None
    return since


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
        self.mac_reported = False
        self.mac_notified = False

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

    def forget_mac(self):
        """End the Mac session's episode, so the next one is logged and told about again."""
        self.mac_reported = False
        self.mac_notified = False


API_BASE = "https://api.plow.co"
ALERT_TEXT = (
    "I stopped receiving messages and could not reconnect after three tries, so "
    "anything you send me now will not reach me. Restarting the agent may fix it."
)
MAC_ALERT_TEXT = (
    "I lost my connection to your Mac and could not get it back after three "
    "tries, so I cannot read files or run commands there. Restarting the agent "
    "may fix it."
)
LATCH_ALERT_TEXT = (
    "I cannot reach your Mac through Latch right now, so I cannot read files or "
    "run commands there. Waking the Mac or opening Latch should fix it. Messages "
    "still reach me."
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


MCP_PROTOCOL = "2025-06-18"
HANDSHAKE = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
             "params": {"protocolVersion": MCP_PROTOCOL, "capabilities": {},
                        "clientInfo": {"name": "transport-watchdog", "version": "1"}}}


def build_handshake_request(url, token):
    """The one MCP initialize the watchdog sends Latch to ask whether the Mac answers."""
    return urllib.request.Request(
        url,
        data=json.dumps(HANDSHAKE).encode("utf-8"),
        method="POST",
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json",
                 "Accept": "application/json, text/event-stream",
                 "MCP-Protocol-Version": MCP_PROTOCOL},
    )


def handshake_answered(raw):
    """Whether an initialize answer carries a result.

    A streamable MCP endpoint may answer either as JSON or as one event stream,
    where the last data line holds the answer to this request.
    """
    text = raw.decode("utf-8", errors="replace") if isinstance(raw, bytes) else raw
    events = [line for line in text.splitlines() if line.startswith("data:")]
    try:
        payload = json.loads(events[-1][len("data:"):] if events else text)
    except ValueError:
        return False
    return isinstance(payload, dict) and "result" in payload


def latch_reachable(url, token, opener=OPENER.open):
    """Whether the owner's Mac answers one MCP handshake through Latch.

    This tells a stuck session in the gateway, which a restart fixes, from a Mac
    that is asleep, offline or without Latch, which a restart cannot. It never
    raises and never reports the url, which names the device, or the token.
    The bearer is the agent's broad Plow credential, so it goes only to an https
    url, as the alert and the repository's own Latch setup require.
    """
    if not url.startswith("https://"):
        return False
    try:
        with opener(build_handshake_request(url, token), timeout=20) as response:
            if not 200 <= getattr(response, "status", 200) < 300:
                return False
            raw = response.read()
    except Exception:  # an unanswered probe is an answer in itself, whatever went wrong
        return False
    return handshake_answered(raw)


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
    """The alert to send, in the words the failure calls for. Only its outcome is logged."""
    return lambda text=ALERT_TEXT: send(base, token, chat_uid, text=text)


def outcome(alert, text):
    """The word an alert left behind. An alert that raises must still leave a record."""
    try:
        return alert(text)
    except Exception as error:  # an episode's only alert is never retried
        return f"failed with {type(error).__name__}"


def settings(read=read_env):
    """(base, token, chat_uid, mcp_url, mcp_token) as plow-init published them.

    The first three are the alert's, with the plugin's default base. The last two
    are the Latch endpoint and the credential the Mac probe carries, which is the
    agent's own, so that endpoint and its bearer are read together.
    """
    return (read("PLOW_API_BASE") or API_BASE, read("PLOW_AGENT_TOKEN"), read("PLOW_HOME_CHANNEL"),
            read("PLOW_MCP_URL"), read("PLOW_AGENT_TOKEN"))


def mac_watch(dog, now, mcp, probe, alert, log):
    """The Mac session's problem for the policy to weigh, or None to leave it alone.

    A session Latch answers for is stuck inside the gateway, so it joins the
    transport's problem and takes the same restart, cooldown and three failures.
    A Mac that does not answer cannot be reached by restarting anything here, so
    the owner is told once for the episode and the policy is left alone.
    """
    state, since = mcp()
    problem = mcp_problem(state, since)
    if problem is None:
        if dog.mac_reported:
            log("the Mac session is connected again")
        dog.forget_mac()
        return None
    if not unhealthy(problem, now):
        return None
    if not dog.mac_reported:
        dog.mac_reported = True
        log(f"the Mac session has been {state} since {problem:%H:%M} UTC")
    if probe():
        return problem
    if not dog.mac_notified:
        dog.mac_notified = True
        log(f"cannot reach the Mac through Latch, owner notice {outcome(alert, LATCH_ALERT_TEXT)}")
    return None


def once(dog, now, doc, restart, alert, log=log, start_time_of=process_start_time,
         mcp=None, probe=None):
    """Apply one observation, log what it led to, and return the action.

    mcp and probe are the Mac session's reading and the Latch handshake. Without
    both, only the messaging transport is watched.
    """
    transport_since, unseen = assess(doc, start_time_of)
    mac_since = None if mcp is None or probe is None else mac_watch(dog, now, mcp, probe, alert, log)
    known = [moment for moment in (transport_since, mac_since) if moment is not None]
    action = dog.observe(now, min(known) if known else None, unseen)
    if action == "restart":
        log(f"transport not healthy since {dog.since:%H:%M} UTC, restarting the gateway")
        if not restart():
            log("s6 did not accept the restart")
    elif action == "recovered":
        log("transport reconnected after the restart")
    elif action == "recovery_failed":
        log(f"the restart did not reconnect the transport, {dog.failed} of {MAX_FAILED_RECOVERIES}")
    elif action == "alert":
        # The owner is told about whichever of the two went first, which is the
        # one the restarts were trying to recover.
        transport = [moment for moment in (transport_since, dog.unseen_since) if moment is not None]
        mac_first = mac_since is not None and (not transport or mac_since < min(transport))
        word = outcome(alert, MAC_ALERT_TEXT if mac_first else ALERT_TEXT)
        log(f"recovery failed {MAX_FAILED_RECOVERIES} times, owner alert {word}")
    elif action == "reconnected":
        log("transport connected again")
    return action


def main(configured=settings, sleep=time.sleep, log=log):
    base, token, chat, mcp_url, mcp_token = configured()
    missing = [name for name, value in (("PLOW_AGENT_TOKEN", token), ("PLOW_HOME_CHANNEL", chat)) if not value]
    if missing:
        # The chat platform is enabled only when both are set, and the alert needs
        # both, so there is nothing to watch and no one to tell. Standing down for a
        # day and exiting lets s6 look again, as agent-index does.
        log(f"no {' or '.join(missing)} in this container, so the iMessage line is not set up; standing down")
        sleep(86400)
        return
    alert = make_alert(base, token, chat)
    mcp = probe = None
    if mcp_url and mcp_token:
        mcp = mcp_status
        probe = lambda: latch_reachable(mcp_url, mcp_token)
    else:
        # Latch is what the Mac tools travel over. Without it there is no session
        # to watch, while the messaging transport is still worth watching.
        blank = [name for name, value in (("PLOW_MCP_URL", mcp_url), ("PLOW_AGENT_TOKEN", mcp_token)) if not value]
        log(f"no {' or '.join(blank)} in this container, so the Mac tools are not watched")
    dog = Watchdog()
    while True:
        try:
            once(dog, dt.datetime.now(dt.timezone.utc), load_state(), restart_gateway, alert,
                 log=log, mcp=mcp, probe=probe)
        except Exception as error:  # a longrun that crashes is respawned in a tight loop
            log(f"check failed with {type(error).__name__}")
        sleep(CHECK_SECONDS)


if __name__ == "__main__":
    main()
