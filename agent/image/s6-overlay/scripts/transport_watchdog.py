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
import urllib.error
import urllib.request

STATE_PATH = "/var/lib/hermes/gateway_state.json"
PROC = "/proc"
PLATFORMS = ("plow_chat", "plow_email")
GRACE_SECONDS = 360


def load_state(path=STATE_PATH):
    """The parsed state file, or None when it is missing or not a JSON object."""
    try:
        with open(path, encoding="utf-8") as handle:
            doc = json.load(handle)
    except (OSError, ValueError):
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

    The reading the plugin's own _message_delivery_unknown gives these statuses.
    """
    return status >= 500 or status in (408, 424)


def build_alert_request(base, token, chat_uid, text=ALERT_TEXT):
    return urllib.request.Request(
        f"{base.rstrip('/')}/v1/chats/{chat_uid}/messages",
        data=json.dumps({"body": text}).encode("utf-8"),
        method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )


def send_alert(base, token, chat_uid, opener=urllib.request.urlopen, text=ALERT_TEXT):
    """sent, failed or unknown. Called once per failure episode and never retried.

    Unknown means Plow may have the message, so sending again risks a double
    send. The plugin sends over REST and only receives over the websocket, so
    this path can stay open while the transport is deaf.
    """
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
