import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

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


if __name__ == "__main__":
    unittest.main()
