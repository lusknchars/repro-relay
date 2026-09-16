"""Watch the transport and recover it when the agent has gone silently deaf.

The gateway process can stay alive while its transport stops receiving, which is
how the agent went deaf for ten hours on September 16. The gateway records each
platform in gateway_state.json, and the transport rewrites its entry after every
attempt that ends, so an entry that is not connected and has not been written
for six minutes means the retry loop itself has stopped. This reads that file
from outside the process; nothing upstream is modified.
"""
import datetime as dt
import json

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


def problem_since(doc, now, first_seen_bad=None, start_time_of=process_start_time):
    """When the current problem began, or None when every watched entry is healthy.

    A live entry that is not connected dates from its own updated_at. A missing
    file, an absent entry and an entry whose writer is gone carry no time worth
    trusting, so they date from when this watchdog first saw the problem. That
    covers the entries every new gateway inherits until its adapters report.
    """
    unseen = now if first_seen_bad is None else first_seen_bad
    platforms = doc.get("platforms") if isinstance(doc, dict) else None
    if not isinstance(platforms, dict):
        return unseen
    earliest = None
    for name in PLATFORMS:
        entry = platforms.get(name)
        if not isinstance(entry, dict) or not writer_live(entry, start_time_of):
            since = unseen
        elif entry.get("state") == "connected":
            continue
        else:
            try:
                since = _parse(entry["updated_at"])
            except (KeyError, TypeError, ValueError):
                since = unseen
        if earliest is None or since < earliest:
            earliest = since
    return earliest


def unhealthy(since, now):
    return since is not None and (now - since).total_seconds() >= GRACE_SECONDS
