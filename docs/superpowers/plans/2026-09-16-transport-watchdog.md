# Transport Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An s6 service inside the agent image that notices when the transport has stopped receiving, restarts the gateway, and texts the owner only when that does not bring it back.

**Architecture:** One standard library Python module holds the whole watchdog as small functions whose side effects are parameters: a health rule over `gateway_state.json`, a recovery policy that turns one observation at a time into wait, restart or alert, an alert sender over Plow REST, and a loop. A `longrun` s6 service beside `agent-index` runs the loop every 60 seconds. Nothing upstream changes.

**Tech Stack:** Python 3 standard library (3.12 in CI, 3.13.5 in the image); s6-overlay v3; `unittest`.

**Spec:** `docs/superpowers/specs/2026-09-16-transport-watchdog-design.md`, as amended in commit `aa4601d`.

## Global Constraints

- Watch exactly `plow_chat` and `plow_email` in `/var/lib/hermes/gateway_state.json`.
- An entry is live only when `writer_pid` names a running process that is not a zombie and whose start time, field 22 of `/proc/<pid>/stat`, equals `writer_start_time` whenever both are known.
- Grace: `GRACE_SECONDS = 360`. A live entry that is not `connected` dates from its own `updated_at`. An absent or undated entry, a missing or unreadable file, and an entry whose writer is not live are unseen problems: they date from the first observation that reported one, and that date is forgotten as soon as an observation reports none, so a long stall never shortens the grace a dead writer gets. Nothing acts at once.
- Restart only the gateway, with `/command/s6-svc -r /run/service/hermes-gateway`. Never the container.
- `VERIFY_SECONDS = 180` after a restart; at most one restart per `RESTART_COOLDOWN_SECONDS = 600`; alert after `MAX_FAILED_RECOVERIES = 3` consecutive failed recoveries.
- Alert only when recovery fails, once per failure episode, never resent: `POST {PLOW_API_BASE}/v1/chats/{PLOW_HOME_CHANNEL}/messages` with header `Authorization: Bearer {PLOW_AGENT_TOKEN}` and JSON body `{"body": text}`. `PLOW_API_BASE` defaults to `https://api.plow.co`, as in the plugin's `_transport.py`.
- Treat 408, 424 and every 5xx as delivery unknown, exactly as the plugin's `_message_delivery_unknown` does.
- The alert text is plain, short, and contains no hyphens or dashes of any kind.
- Never log or print `PLOW_AGENT_TOKEN`. Log exception type names, never exception text.
- Log every restart, a restart s6 refuses, every recovery and failed recovery, the alert's outcome, and a transport that comes back on its own after a failure.
- Never modify anything under `/opt/hermes`. Standard library only.
- The `run` script is committed with mode `100755` and also made executable in the Dockerfile, as `agent-index/run` is.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `agent/image/s6-overlay/scripts/transport_watchdog.py` | Health rule, recovery policy, alert and loop |
| `agent/image/s6-overlay/s6-rc.d/transport-watchdog/type` | Declares a `longrun` |
| `agent/image/s6-overlay/s6-rc.d/transport-watchdog/run` | Execs the module under the image's Python, as root |
| `agent/image/s6-overlay/s6-rc.d/transport-watchdog/dependencies.d/plow-init` | Starts after `plow-init` |
| `agent/image/s6-overlay/s6-rc.d/user/contents.d/transport-watchdog` | Adds the service to the user bundle |
| `agent/Dockerfile` | Makes the `run` script executable in the image |
| `.github/workflows/agent.yml` | Checks the built image holds a runnable watchdog |
| `agent/tests/test_watchdog.py` | Unit tests for all of the above |

`agent/Dockerfile` copies `image/s6-overlay/` onto `/etc/s6-overlay/`, and `agent/.dockerignore` admits `image/**`, so the module lands at `/etc/s6-overlay/scripts/transport_watchdog.py`. A directory copy merges, so upstream's own `/etc/s6-overlay/scripts/plow-init.py` stays.

The gateway runs as `hermes`, uid 10000. The watchdog runs as root, which it needs twice: s6's control files under `/run/service` and the credential under `/run/s6/container_environment` are root's alone.

Run the new tests from the repository root with:

    python3 -m unittest discover -s agent/tests -p test_watchdog.py -v

and the whole agent suite, as CI does, with:

    python3 -m unittest discover -s agent/tests -v

---

### Task 1: The health rule

**Files:**
- Create: `agent/image/s6-overlay/scripts/transport_watchdog.py`
- Create: `agent/tests/test_watchdog.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `STATE_PATH`, `PROC`, `PLATFORMS`, `GRACE_SECONDS`; `load_state(path=STATE_PATH) -> dict | None`; `process_start_time(pid: int, proc: str = PROC) -> int | None`; `writer_live(entry: dict, start_time_of=process_start_time) -> bool`; `assess(doc: dict | None, start_time_of=process_start_time) -> tuple[datetime | None, bool]`, returning `(silent_since, unseen)`; `unhealthy(since: datetime | None, now: datetime) -> bool`. Every datetime is timezone aware. Tests share the helpers `NOW`, `PID`, `STARTED`, `minutes_ago`, `entry`, `gateway`, `running`, `gone` and `assessed`.

- [ ] **Step 1: Write the failing test**

Create `agent/tests/test_watchdog.py`:

```python
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "transport_watchdog", ROOT / "image/s6-overlay/scripts/transport_watchdog.py")
watchdog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watchdog)

NOW = dt.datetime(2026, 9, 16, 12, 0, tzinfo=dt.timezone.utc)
PID, STARTED = 198, 38119734


def minutes_ago(n):
    return (NOW - dt.timedelta(minutes=n)).isoformat()


def entry(state="connected", at=None, pid=PID, started=STARTED):
    return {"state": state, "updated_at": at or minutes_ago(30),
            "writer_pid": pid, "writer_start_time": started}


def gateway(chat=None, email=None):
    """The file's shape, as the running agent wrote it on September 16."""
    return {"pid": PID, "start_time": STARTED, "gateway_state": "running",
            "platforms": {"plow_chat": chat or entry(), "plow_email": email or entry()}}


def running(pid):
    return STARTED if pid == PID else None


def gone(pid):
    return None


def assessed(doc, start_time_of=running):
    return watchdog.assess(doc, start_time_of)


class HealthRule(unittest.TestCase):
    def test_connected_entries_from_the_running_gateway_are_healthy_however_old(self):
        self.assertEqual(assessed(gateway(chat=entry(at=minutes_ago(600)))), (None, False))

    def test_a_retry_loop_that_is_still_reporting_is_left_alone(self):
        silent_since, unseen = assessed(gateway(chat=entry("disconnected", minutes_ago(5))))
        self.assertFalse(unseen)
        self.assertFalse(watchdog.unhealthy(silent_since, NOW))

    def test_a_retry_loop_silent_for_six_minutes_is_unhealthy(self):
        silent_since, unseen = assessed(gateway(chat=entry("disconnected", minutes_ago(6))))
        self.assertFalse(unseen)
        self.assertTrue(watchdog.unhealthy(silent_since, NOW))

    def test_fatal_and_retrying_count_like_disconnected(self):
        for state in ("fatal", "retrying"):
            with self.subTest(state=state):
                silent_since, unseen = assessed(gateway(email=entry(state, minutes_ago(7))))
                self.assertTrue(watchdog.unhealthy(silent_since, NOW))

    def test_the_longest_silent_entry_dates_the_problem(self):
        doc = gateway(chat=entry("disconnected", minutes_ago(3)), email=entry("retrying", minutes_ago(8)))
        self.assertEqual(assessed(doc), (NOW - dt.timedelta(minutes=8), False))

    def test_a_dead_writer_is_unseen_rather_than_dated(self):
        self.assertEqual(assessed(gateway(), start_time_of=gone), (None, True))

    def test_an_old_entry_left_by_a_previous_gateway_is_unseen_rather_than_dated(self):
        doc = gateway(chat=entry("disconnected", minutes_ago(120), pid=4242, started=1))
        self.assertEqual(assessed(doc), (None, True))

    def test_a_reused_process_id_is_not_the_writer(self):
        self.assertEqual(assessed(gateway(), start_time_of=lambda pid: STARTED + 1), (None, True))

    def test_an_absent_entry_a_missing_file_or_an_undated_entry_is_unseen(self):
        absent = gateway()
        del absent["platforms"]["plow_email"]
        undated = gateway(chat=entry("disconnected", "yesterday"))
        for doc in (absent, None, undated):
            with self.subTest(doc=doc):
                self.assertEqual(assessed(doc), (None, True))

    def test_a_silent_entry_and_an_unseen_one_are_both_reported(self):
        doc = gateway(chat=entry("disconnected", minutes_ago(8)), email=entry(pid=4242))
        self.assertEqual(assessed(doc), (NOW - dt.timedelta(minutes=8), True))

    def test_an_unreadable_file_loads_as_none(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "gateway_state.json"
            self.assertIsNone(watchdog.load_state(path))
            for text in ("{not json", "[]"):
                path.write_text(text)
                self.assertIsNone(watchdog.load_state(path))
            path.write_text(json.dumps(gateway()))
            self.assertEqual(watchdog.load_state(path)["platforms"]["plow_chat"]["writer_pid"], PID)


class ProcessStartTime(unittest.TestCase):
    def write_stat(self, folder, pid, line):
        (Path(folder) / str(pid)).mkdir()
        (Path(folder) / str(pid) / "stat").write_text(line)

    def test_reads_field_22_when_the_name_holds_spaces_and_parentheses(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write_stat(folder, PID, "198 (odd (name) x) S 35 198 198 0 -1 4194560 264364 11941 1 0 7515 568 35 2 20 0 21 0 38119734 2133876736 87693\n")
            self.assertEqual(watchdog.process_start_time(PID, proc=folder), STARTED)

    def test_a_zombie_or_a_missing_process_has_no_start_time(self):
        with tempfile.TemporaryDirectory() as folder:
            self.write_stat(folder, PID, "198 (hermes) Z 35 198 198 0 -1 4194560 264364 11941 1 0 7515 568 35 2 20 0 21 0 38119734 0 0\n")
            self.assertIsNone(watchdog.process_start_time(PID, proc=folder))
            self.assertIsNone(watchdog.process_start_time(PID + 1, proc=folder))


if __name__ == "__main__":
    unittest.main()
```

The first `stat` line is shaped like the real `/proc/198/stat` of the gateway on September 16, with a command name that would break a plain `split()`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest discover -s agent/tests -p test_watchdog.py -v`
Expected: one error, `Failed to import test module: test_watchdog`, caused by `FileNotFoundError` naming `transport_watchdog.py`.

- [ ] **Step 3: Write the module**

Create `agent/image/s6-overlay/scripts/transport_watchdog.py`:

```python
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest discover -s agent/tests -p test_watchdog.py -v`
Expected: `Ran 13 tests`, `OK`.

- [ ] **Step 5: Commit**

```bash
git add agent/image/s6-overlay/scripts/transport_watchdog.py agent/tests/test_watchdog.py
git commit -m "Tell from the gateway's own state file when the transport has stalled"
```

---

### Task 2: The recovery policy

**Files:**
- Modify: `agent/image/s6-overlay/scripts/transport_watchdog.py` (append)
- Modify: `agent/tests/test_watchdog.py` (add a test class above `if __name__`)

**Interfaces:**
- Consumes: `unhealthy(since, now)` from Task 1, and the `(silent_since, unseen)` pair its `assess` returns.
- Produces: `RESTART_COOLDOWN_SECONDS`, `VERIFY_SECONDS`, `MAX_FAILED_RECOVERIES`; class `Watchdog()` with attributes `unseen_since`, `since`, `last_restart_at`, `pending_since`, `failed`, `alerted`, and `observe(now: datetime, silent_since: datetime | None, unseen: bool) -> str` returning exactly one of `"none"`, `"restart"`, `"recovered"`, `"recovery_failed"`, `"alert"`, `"reconnected"`. `since` holds the date of the current problem as of the last observation, or None.

- [ ] **Step 1: Write the failing test**

Add to `agent/tests/test_watchdog.py`, above the `if __name__` block:

```python
def down_since(minutes):
    return NOW - dt.timedelta(minutes=minutes)


def later(minutes):
    return NOW + dt.timedelta(minutes=minutes)


class RecoveryPolicy(unittest.TestCase):
    def test_healthy_does_nothing(self):
        self.assertEqual(watchdog.Watchdog().observe(NOW, None, False), "none")

    def test_inside_the_grace_it_waits(self):
        dog = watchdog.Watchdog()
        self.assertEqual(dog.observe(NOW, down_since(2), False), "none")
        self.assertEqual(dog.observe(later(1), down_since(2), False), "none")

    def test_past_the_grace_it_restarts(self):
        self.assertEqual(watchdog.Watchdog().observe(NOW, down_since(6), False), "restart")

    def test_an_unseen_problem_waits_out_the_grace_from_its_first_sighting(self):
        dog = watchdog.Watchdog()
        self.assertEqual(dog.observe(NOW, None, True), "none")
        self.assertEqual(dog.observe(later(5), None, True), "none")
        self.assertEqual(dog.unseen_since, NOW)
        self.assertEqual(dog.observe(later(6), None, True), "restart")

    def test_a_long_stall_does_not_shorten_the_grace_a_dead_writer_gets(self):
        dog = watchdog.Watchdog()
        for minute in range(15):
            self.assertEqual(dog.observe(later(minute), later(minute - 4), False), "none")
        for minute in range(15, 21):
            self.assertEqual(dog.observe(later(minute), None, True), "none")
        self.assertEqual(dog.observe(later(21), None, True), "restart")

    def test_an_unseen_problem_that_clears_starts_its_grace_again(self):
        dog = watchdog.Watchdog()
        dog.observe(NOW, None, True)
        self.assertEqual(dog.observe(later(4), None, False), "none")
        dog.observe(later(5), None, True)
        self.assertEqual(dog.observe(later(10), None, True), "none")
        self.assertEqual(dog.observe(later(11), None, True), "restart")

    def test_healthy_again_after_a_restart_is_a_recovery(self):
        dog = watchdog.Watchdog()
        dog.observe(NOW, down_since(6), False)
        self.assertEqual(dog.observe(later(1), None, False), "recovered")
        self.assertEqual((dog.failed, dog.pending_since, dog.since), (0, None, None))

    def test_still_unhealthy_when_the_verify_window_ends_is_a_failed_recovery(self):
        dog = watchdog.Watchdog()
        since = down_since(6)
        dog.observe(NOW, since, False)
        self.assertEqual(dog.observe(later(2), since, False), "none")
        self.assertEqual(dog.observe(later(3), since, False), "recovery_failed")
        self.assertEqual(dog.failed, 1)

    def test_restarts_are_at_least_ten_minutes_apart(self):
        dog = watchdog.Watchdog()
        since = down_since(6)
        self.assertEqual(dog.observe(NOW, since, False), "restart")
        self.assertEqual(dog.observe(later(3), since, False), "recovery_failed")
        self.assertEqual(dog.observe(later(9), since, False), "none")
        self.assertEqual(dog.observe(later(10), since, False), "restart")

    def test_the_third_failed_recovery_alerts_once_and_restarts_stop(self):
        dog = watchdog.Watchdog()
        since = down_since(6)
        actions = [dog.observe(later(minute), since, False) for minute in range(40)]
        self.assertEqual(actions.count("restart"), 3)
        self.assertEqual(actions.count("recovery_failed"), 3)
        self.assertEqual(actions.count("alert"), 1)
        self.assertEqual(actions.index("alert"), 24)

    def test_coming_back_on_its_own_after_a_failure_is_noted_and_resets(self):
        dog = watchdog.Watchdog()
        dog.failed, dog.alerted = watchdog.MAX_FAILED_RECOVERIES, True
        self.assertEqual(dog.observe(NOW, None, False), "reconnected")
        self.assertEqual((dog.failed, dog.alerted), (0, False))
        self.assertEqual(dog.observe(later(1), None, False), "none")
```

With one observation a minute, restarts land at minutes 0, 10 and 20, their failures at 3, 13 and 23, and the alert at 24. In the long stall test the retry loop reports every few minutes for a quarter of an hour, then the writer dies at minute 15; the restart waits until minute 21, six minutes after the dead writer was first seen, not after the stall began.

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest discover -s agent/tests -p test_watchdog.py -v`
Expected: 11 errors, each `AttributeError: module 'transport_watchdog' has no attribute 'Watchdog'`; the 13 Task 1 tests still pass.

- [ ] **Step 3: Write the policy**

Append to `agent/image/s6-overlay/scripts/transport_watchdog.py`:

```python
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest discover -s agent/tests -p test_watchdog.py -v`
Expected: `Ran 24 tests`, `OK`.

- [ ] **Step 5: Commit**

```bash
git add agent/image/s6-overlay/scripts/transport_watchdog.py agent/tests/test_watchdog.py
git commit -m "Restart the gateway at most every ten minutes and alert after three failures"
```

---

### Task 3: The owner alert

**Files:**
- Modify: `agent/image/s6-overlay/scripts/transport_watchdog.py` (imports, then append)
- Modify: `agent/tests/test_watchdog.py` (one import, then a test class above `if __name__`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `API_BASE`, `ALERT_TEXT`; `delivery_unknown(status: int) -> bool`; `build_alert_request(base: str, token: str, chat_uid: str, text: str = ALERT_TEXT) -> urllib.request.Request`; `send_alert(base, token, chat_uid, opener=urllib.request.urlopen, text=ALERT_TEXT) -> str` returning exactly one of `"sent"`, `"failed"`, `"unknown"`.

- [ ] **Step 1: Write the failing test**

Add `import urllib.error` to the imports at the top of `agent/tests/test_watchdog.py`, keeping them in alphabetical order after `import unittest`. Then add, above the `if __name__` block:

```python
class FakeResponse:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def answering(body):
    return lambda request, timeout: FakeResponse(body)


def raising(error):
    def opener(request, timeout):
        raise error
    return opener


def http_error(code):
    return urllib.error.HTTPError("https://api.plow.co/v1/chats/cht_owner/messages", code, "error", None, None)


def alert_with(opener):
    return watchdog.send_alert("https://api.plow.co", "tok", "cht_owner", opener=opener)


class OwnerAlert(unittest.TestCase):
    def test_the_request_has_the_shape_the_plugin_sends(self):
        request = watchdog.build_alert_request("https://api.plow.co/", "tok", "cht_owner", "hello")
        self.assertEqual(request.full_url, "https://api.plow.co/v1/chats/cht_owner/messages")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Authorization"), "Bearer tok")
        self.assertEqual(json.loads(request.data), {"body": "hello"})

    def test_sent_only_when_plow_returns_the_message_uid(self):
        self.assertEqual(alert_with(answering(b'{"uid": "msg_1"}')), "sent")

    def test_an_accepted_answer_without_a_uid_is_unknown(self):
        for body in (b"{}", b"not json", b""):
            with self.subTest(body=body):
                self.assertEqual(alert_with(answering(body)), "unknown")

    def test_statuses_the_plugin_reads_as_maybe_delivered_are_unknown(self):
        for code in (408, 424, 500, 503):
            with self.subTest(code=code):
                self.assertEqual(alert_with(raising(http_error(code))), "unknown")

    def test_other_client_errors_are_failed(self):
        for code in (400, 401, 403, 404):
            with self.subTest(code=code):
                self.assertEqual(alert_with(raising(http_error(code))), "failed")

    def test_a_refused_connection_is_failed_and_a_lost_answer_is_unknown(self):
        self.assertEqual(alert_with(raising(urllib.error.URLError(ConnectionRefusedError()))), "failed")
        self.assertEqual(alert_with(raising(urllib.error.URLError(TimeoutError()))), "unknown")
        self.assertEqual(alert_with(raising(TimeoutError())), "unknown")
        self.assertEqual(alert_with(raising(ConnectionResetError())), "unknown")

    def test_the_alert_text_has_no_hyphens_or_dashes(self):
        dashes = {"-", "‐", "‑", "‒", "–", "—", "―", "−"}
        self.assertFalse(dashes & set(watchdog.ALERT_TEXT))
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest discover -s agent/tests -p test_watchdog.py -v`
Expected: `Ran 31 tests`, `FAILED (errors=15)`, every error an `AttributeError` for `build_alert_request`, `send_alert` or `ALERT_TEXT`. Seven tests fail, and unittest counts each failing subtest separately, which makes fifteen. The 24 earlier tests still pass.

- [ ] **Step 3: Write the alert sender**

Add `import http.client`, `import urllib.error` and `import urllib.request` to the module's imports, keeping them alphabetical: `datetime as dt`, `http.client`, `json`, `urllib.error`, `urllib.request`. Then append:

```python
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
```

The order of the `except` clauses matters. `HTTPError` subclasses `URLError`, and `URLError` subclasses `OSError`, so each is caught before its parent. `urlopen` wraps a failure to connect in `URLError`, so a refusal is `failed`. A timeout or dropped connection after the request went out arrives as a bare `OSError` and is `unknown`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `python3 -m unittest discover -s agent/tests -p test_watchdog.py -v`
Expected: `Ran 31 tests`, `OK`.

- [ ] **Step 5: Commit**

```bash
git add agent/image/s6-overlay/scripts/transport_watchdog.py agent/tests/test_watchdog.py
git commit -m "Text the owner over REST when the transport cannot be recovered"
```

---

### Task 4: The loop, the service and the image

**Files:**
- Modify: `agent/image/s6-overlay/scripts/transport_watchdog.py` (imports, then append)
- Create: `agent/image/s6-overlay/s6-rc.d/transport-watchdog/type`
- Create: `agent/image/s6-overlay/s6-rc.d/transport-watchdog/run`
- Create: `agent/image/s6-overlay/s6-rc.d/transport-watchdog/dependencies.d/plow-init`
- Create: `agent/image/s6-overlay/s6-rc.d/user/contents.d/transport-watchdog`
- Modify: `agent/Dockerfile:22`
- Modify: `.github/workflows/agent.yml` (append a step)
- Modify: `agent/tests/test_watchdog.py` (one import, then two test classes above `if __name__`)

**Interfaces:**
- Consumes: `load_state`, `assess`, `process_start_time` from Task 1; `Watchdog` with `observe(now, silent_since, unseen)`, `since` and `failed`, and `MAX_FAILED_RECOVERIES`, from Task 2; `API_BASE`, `send_alert` from Task 3.
- Produces: `GATEWAY_SERVICE`, `ENV_DIR`, `CHECK_SECONDS`; `read_env(name, env_dir=ENV_DIR) -> str`; `log(message: str) -> None`; `restart_gateway(run=subprocess.run) -> bool`; `make_alert(base, token, chat_uid, send=send_alert) -> Callable[[], str]`; `once(dog, now, doc, restart, alert, log=log, start_time_of=process_start_time) -> str`; `main()`.

- [ ] **Step 1: Write the failing test**

Add `import os` to the imports at the top of `agent/tests/test_watchdog.py`, keeping them alphabetical. Then add, above the `if __name__` block:

```python
def stalled():
    return gateway(chat=entry("disconnected", minutes_ago(6)))


class ServiceWiring(unittest.TestCase):
    SERVICE = ROOT / "image/s6-overlay/s6-rc.d/transport-watchdog"

    def test_is_a_longrun_after_plow_init_in_the_user_bundle(self):
        self.assertEqual((self.SERVICE / "type").read_text().strip(), "longrun")
        self.assertTrue((self.SERVICE / "dependencies.d/plow-init").is_file())
        self.assertTrue((ROOT / "image/s6-overlay/s6-rc.d/user/contents.d/transport-watchdog").is_file())

    def test_the_run_script_is_executable_and_starts_the_module(self):
        run = self.SERVICE / "run"
        self.assertTrue(os.access(run, os.X_OK))
        text = run.read_text()
        self.assertTrue(text.startswith("#!/bin/sh\n"))
        self.assertIn("exec /opt/hermes/.venv/bin/python3 /etc/s6-overlay/scripts/transport_watchdog.py", text)

    def test_the_image_makes_the_run_script_executable(self):
        chmods = [line for line in (ROOT / "Dockerfile").read_text().splitlines()
                  if line.startswith("RUN chmod 0755 ")]
        self.assertTrue(any("/etc/s6-overlay/s6-rc.d/transport-watchdog/run" in line for line in chmods))


class Loop(unittest.TestCase):
    def test_restart_asks_s6_for_the_gateway_service_only(self):
        calls = []

        class Done:
            returncode = 0

        def run(args, check):
            calls.append(args)
            return Done()

        self.assertTrue(watchdog.restart_gateway(run=run))
        self.assertEqual(calls, [["/command/s6-svc", "-r", "/run/service/hermes-gateway"]])

    def test_a_missing_s6_is_reported_rather_than_crashing(self):
        def run(args, check):
            raise FileNotFoundError(args[0])

        self.assertFalse(watchdog.restart_gateway(run=run))

    def test_a_stalled_transport_is_restarted_and_logged(self):
        restarts, lines = [], []
        action = watchdog.once(watchdog.Watchdog(), NOW, stalled(),
                               restart=lambda: restarts.append(1) or True, alert=lambda: "sent",
                               log=lines.append, start_time_of=running)
        self.assertEqual((action, len(restarts), len(lines)), ("restart", 1, 1))

    def test_a_restart_s6_refuses_is_logged(self):
        lines = []
        watchdog.once(watchdog.Watchdog(), NOW, stalled(), restart=lambda: False,
                      alert=lambda: "sent", log=lines.append, start_time_of=running)
        self.assertEqual(len(lines), 2)

    def test_a_missing_file_is_waited_on_rather_than_acted_on(self):
        restarts, lines = [], []
        action = watchdog.once(watchdog.Watchdog(), NOW, None,
                               restart=lambda: restarts.append(1) or True, alert=lambda: "sent",
                               log=lines.append, start_time_of=running)
        self.assertEqual((action, restarts, lines), ("none", [], []))

    def test_the_alert_logs_its_outcome_and_never_the_token(self):
        sent, lines = [], []
        dog = watchdog.Watchdog()
        dog.failed = watchdog.MAX_FAILED_RECOVERIES
        alert = watchdog.make_alert("https://api.plow.co", "tok_secret", "cht_owner",
                                    send=lambda base, token, chat: sent.append((base, token, chat)) or "sent")
        action = watchdog.once(dog, NOW, stalled(), restart=lambda: True, alert=alert,
                               log=lines.append, start_time_of=running)
        self.assertEqual(action, "alert")
        self.assertEqual(sent, [("https://api.plow.co", "tok_secret", "cht_owner")])
        self.assertIn("owner alert sent", lines[-1])
        self.assertNotIn("tok_secret", "\n".join(lines))

    def test_without_an_owner_chat_no_alert_is_attempted(self):
        called = []
        alert = watchdog.make_alert("https://api.plow.co", "tok", "", send=lambda *args: called.append(args) or "sent")
        self.assertIn("not sent", alert())
        self.assertEqual(called, [])
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python3 -m unittest discover -s agent/tests -p test_watchdog.py -v`
Expected: 10 tests fail or error. The service and Dockerfile tests fail on missing files or assertions, and the loop tests error with `AttributeError` for `restart_gateway`, `once` or `make_alert`. The 31 earlier tests still pass.

- [ ] **Step 3: Write the loop**

Add `import os`, `import subprocess`, `import sys` and `import time` to the module's imports, keeping them alphabetical: `datetime as dt`, `http.client`, `json`, `os`, `subprocess`, `sys`, `time`, `urllib.error`, `urllib.request`. Then append:

```python
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
    if not chat_uid:
        return lambda: "not sent, no owner chat is configured"
    return lambda: send(base, token, chat_uid)


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
        log(f"recovery failed {MAX_FAILED_RECOVERIES} times, owner alert {alert()}")
    elif action == "reconnected":
        log("transport connected again")
    return action


def main():
    token = read_env("PLOW_AGENT_TOKEN")
    if not token:
        log("no PLOW_AGENT_TOKEN in this container, so there is no transport to watch; standing down")
        time.sleep(86400)
        return
    alert = make_alert(read_env("PLOW_API_BASE") or API_BASE, token, read_env("PLOW_HOME_CHANNEL"))
    dog = Watchdog()
    while True:
        try:
            once(dog, dt.datetime.now(dt.timezone.utc), load_state(), restart_gateway, alert)
        except Exception as error:  # a longrun that crashes is respawned in a tight loop
            log(f"check failed with {type(error).__name__}")
        time.sleep(CHECK_SECONDS)


if __name__ == "__main__":
    main()
```

The `if __name__` guard keeps the tests' import from starting the loop. Standing down for a day and then exiting matches `agent-index`: s6 starts the script again and it looks for the credential afresh.

- [ ] **Step 4: Write the service files**

Create `agent/image/s6-overlay/s6-rc.d/transport-watchdog/type` containing exactly one line:

```
longrun
```

Create `agent/image/s6-overlay/s6-rc.d/transport-watchdog/run`:

```sh
#!/bin/sh
# Watch the transport, restart the gateway when it has gone silently deaf, and
# text the owner only when that does not bring it back.
#
# The gateway process can stay alive while its transport stops receiving, and
# nothing else in this image looks at the transport. Root, unlike the gateway:
# restarting a service needs s6's control files under /run/service, and the
# credential under /run/s6/container_environment is readable by root alone.

# Absolute, for the same reason agent-index's is: a service inherits the
# supervision tree's PATH, not a login shell's.
PATH=/command:/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin
export PATH

exec /opt/hermes/.venv/bin/python3 /etc/s6-overlay/scripts/transport_watchdog.py
```

Create the two empty marker files and set the mode:

```bash
mkdir -p agent/image/s6-overlay/s6-rc.d/transport-watchdog/dependencies.d
: > agent/image/s6-overlay/s6-rc.d/transport-watchdog/dependencies.d/plow-init
: > agent/image/s6-overlay/s6-rc.d/user/contents.d/transport-watchdog
chmod 0755 agent/image/s6-overlay/s6-rc.d/transport-watchdog/run
```

- [ ] **Step 5: Make the run script executable in the image**

In `agent/Dockerfile`, replace line 22:

```dockerfile
RUN chmod 0755 /etc/s6-overlay/s6-rc.d/agent-index/run
```

with:

```dockerfile
RUN chmod 0755 /etc/s6-overlay/s6-rc.d/agent-index/run /etc/s6-overlay/s6-rc.d/transport-watchdog/run
```

- [ ] **Step 6: Check the image in CI**

Append this step to the `package` job in `.github/workflows/agent.yml`, after the reporter check, at the same indentation:

```yaml
      - name: Check the transport watchdog is in the image
        run: >-
          docker run --rm --platform linux/amd64 --network none
          --entrypoint /bin/sh repro-relay-agent:local -c
          'test -x /etc/s6-overlay/s6-rc.d/transport-watchdog/run &&
          test -f /etc/s6-overlay/s6-rc.d/user/contents.d/transport-watchdog &&
          /opt/hermes/.venv/bin/python3 -m py_compile /etc/s6-overlay/scripts/transport_watchdog.py'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `python3 -m unittest discover -s agent/tests -p test_watchdog.py -v`
Expected: `Ran 41 tests`, `OK`.

Run: `python3 -m unittest discover -s agent/tests -v`
Expected: `Ran 49 tests`, `OK`, the suite's existing 8 among them.

- [ ] **Step 8: Build the image and run the CI check locally**

From the repository root:

```bash
docker compose -f agent/compose.yml build
docker run --rm --platform linux/amd64 --network none --entrypoint /bin/sh repro-relay-agent:local -c 'test -x /etc/s6-overlay/s6-rc.d/transport-watchdog/run && test -f /etc/s6-overlay/s6-rc.d/user/contents.d/transport-watchdog && /opt/hermes/.venv/bin/python3 -m py_compile /etc/s6-overlay/scripts/transport_watchdog.py && echo image-ok'
```

Expected: the build succeeds, reusing its cached layers up to the `COPY image/s6-overlay/` line, and the check prints `image-ok`. The build tags `repro-relay-agent:local`, the tag the running agent was created from. The running container keeps its own image until it is recreated, so this changes nothing live.

- [ ] **Step 9: Commit**

```bash
git add agent/image/s6-overlay/scripts/transport_watchdog.py agent/image/s6-overlay/s6-rc.d/transport-watchdog agent/image/s6-overlay/s6-rc.d/user/contents.d/transport-watchdog agent/Dockerfile .github/workflows/agent.yml agent/tests/test_watchdog.py
git commit -m "Run the transport watchdog as an s6 service beside the gateway"
git ls-files -s agent/image/s6-overlay/s6-rc.d/transport-watchdog/run
```

Expected: the last command shows mode `100755`.

---

### Task 5: Prove it on the running agent

**Not dispatched automatically. It needs the owner's explicit go ahead first.** It recreates the live agent's container, restarts its gateway, leaves the agent deaf for about forty minutes, and sends one real message to the owner's own chat.

It runs from the main checkout, `/Users/luskoliveira/repro-relay`, after this branch is merged. The running agent's credential is bound from that checkout's `agent/plow-credentials`, which is not in git, and compose names its project after the directory, so starting it from a worktree could stop the running agent and fail to start a replacement.

It uses fault injection, and says so in its report. Step 3 writes the state a stalled retry loop would leave. That proves detection and recovery, but not what upstream writes during a real hang; that assumption rests on reading `_serve`.

**Files:** none change. This task produces evidence.

- [ ] **Step 1: Rebuild and start the agent with the watchdog**

```bash
cd /Users/luskoliveira/repro-relay/agent
docker compose build
docker compose up -d
docker compose exec -T agent /command/s6-svstat /run/service/transport-watchdog
```

Expected: `up`, with a pid.

- [ ] **Step 2: Confirm silence through startup**

Wait ten minutes, then:

```bash
docker compose logs --since 15m agent 2>&1 | command grep -F "transport-watchdog:"
```

Expected: no output. A restart line here is a false positive at startup; stop and report it. A `standing down` line means the credential is missing; stop and report it.

- [ ] **Step 3: Recovery path**

Note the gateway's current writer:

```bash
docker compose exec -T agent /opt/hermes/.venv/bin/python3 -c 'import json; e = json.load(open("/var/lib/hermes/gateway_state.json"))["platforms"]["plow_chat"]; print(e["state"], e["writer_pid"])'
```

Expected: `connected` and a pid. Then write the state a stalled loop leaves, as the gateway's own user:

```bash
docker compose exec -T agent /command/s6-setuidgid hermes /opt/hermes/.venv/bin/python3 -c '
import datetime as dt, json, os
path = "/var/lib/hermes/gateway_state.json"
with open(path) as handle:
    doc = json.load(handle)
chat = doc["platforms"]["plow_chat"]
chat["state"] = "disconnected"
chat["updated_at"] = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=7)).isoformat()
with open(path + ".inject", "w") as handle:
    json.dump(doc, handle)
os.replace(path + ".inject", path)
'
```

Wait five minutes, then:

```bash
docker compose logs --since 6m agent 2>&1 | command grep -F "transport-watchdog:"
docker compose exec -T agent /opt/hermes/.venv/bin/python3 -c 'import json; e = json.load(open("/var/lib/hermes/gateway_state.json"))["platforms"]["plow_chat"]; print(e["state"], e["writer_pid"])'
```

Expected: exactly one `restarting the gateway` line, then `transport reconnected after the restart`, and no `owner alert` line. `plow_chat` reads `connected` under a writer pid different from the one noted.

- [ ] **Step 4: Failure path**

Ask the owner not to text the agent for the next forty minutes. Then hold the gateway down:

```bash
docker compose exec -T agent /command/s6-svc -d /run/service/hermes-gateway
```

When the first `restarting the gateway` line appears, about seven minutes later, confirm s6 left the gateway down:

```bash
docker compose logs --since 10m agent 2>&1 | command grep -F "transport-watchdog:"
docker compose exec -T agent /command/s6-svstat /run/service/hermes-gateway
```

Expected: `down`. If it reads `up`, s6 treats `-r` differently from what this plan assumes: go to Step 5, then report, because the failure path cannot be held this way.

About thirty five minutes after the hold:

```bash
docker compose logs --since 40m agent 2>&1 | command grep -F "transport-watchdog:"
```

Expected, in order: three `restarting the gateway` lines at least ten minutes apart, each followed about three minutes later by `the restart did not reconnect the transport, N of 3`, then one `recovery failed 3 times, owner alert sent`. The owner confirms the message arrived. If the line ends in `unknown` or `failed`, report exactly that: the second unproven assumption is then not proven.

- [ ] **Step 5: Restore**

```bash
docker compose exec -T agent /command/s6-svc -u /run/service/hermes-gateway
```

Wait three minutes, then:

```bash
docker compose logs --since 4m agent 2>&1 | command grep -F "transport-watchdog:"
```

Expected: `transport connected again`, with no further alert, and `plow_chat` reading `connected` when checked as in Step 3.

---

## Self-Review

**Spec coverage.** The rule for both platforms, with liveness by pid and start time: Task 1. The grace, with unseen problems dated from their own first sighting: Tasks 1 and 2. Restart only the gateway, three minutes to verify, one restart per ten minutes, the alert after three failures, and every outcome logged, including a later reconnection: Tasks 2 and 4. The alert over REST, sent once and never again, with the plugin's delivery unknown statuses and plain text without dashes: Tasks 2 and 3. The service in the image, with no upstream change: Task 4. The end to end proof, with the owner's go ahead: Task 5.

**Checked on the running agent and in upstream code on September 16, not assumed.** The file's shape and its `+00:00` timestamps. `writer_pid` 198 with `writer_start_time` 38119734, equal to field 22 of `/proc/198/stat` under the parse Task 1 uses. The gateway runs as `hermes` under s6 at `/run/service/hermes-gateway`, and `/opt/hermes/.venv/bin/python3` is Python 3.13.5. `write_runtime_status` stamps `updated_at` on every write to an entry, and `_serve` calls `on_drop()` after every attempt that ends. `_post_message` sends `json={"body": ...}` to `{BASE}/v1/chats/{chat_id}/messages`, where `BASE` defaults to `https://api.plow.co`, and `_message_delivery_unknown` reads 408, 424 and 5xx as maybe delivered. The Dockerfile copies `image/s6-overlay/` and makes `agent-index/run` executable, and `.dockerignore` admits `image/**`. The container has no `iptables`.

**Placeholder scan.** Every code step carries its code, and every command step its command and expected result.

**Type consistency.** `assess` takes `start_time_of` in Tasks 1 and 4 alike, and returns the `(silent_since, unseen)` pair `observe` takes in Tasks 2 and 4. `observe` returns the six strings Task 4 matches, and Task 4 logs the `since` it keeps. `send_alert` returns the three strings Task 3 asserts, and `make_alert` passes them through unchanged. Test counts run 13, 24, 31 and 41, plus the suite's existing 8.

**Corrected during execution.** Task 2's review found that a single first sighting for every kind of problem let a long stall shorten the grace a dead writer gets, restarting a starting gateway at once. `problem_since` became `assess`, which reports silent and unseen problems separately, and the `Watchdog` dates unseen problems itself.
