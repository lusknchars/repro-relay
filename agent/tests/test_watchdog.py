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


def since_for(doc, now=NOW, first_seen_bad=None, start_time_of=running):
    return watchdog.problem_since(doc, now, first_seen_bad, start_time_of)


class HealthRule(unittest.TestCase):
    def test_connected_entries_from_the_running_gateway_are_healthy_however_old(self):
        self.assertIsNone(since_for(gateway(chat=entry(at=minutes_ago(600)))))

    def test_a_retry_loop_that_is_still_reporting_is_left_alone(self):
        since = since_for(gateway(chat=entry("disconnected", minutes_ago(5))))
        self.assertFalse(watchdog.unhealthy(since, NOW))

    def test_a_retry_loop_silent_for_six_minutes_is_unhealthy(self):
        since = since_for(gateway(chat=entry("disconnected", minutes_ago(6))))
        self.assertTrue(watchdog.unhealthy(since, NOW))

    def test_fatal_and_retrying_count_like_disconnected(self):
        for state in ("fatal", "retrying"):
            with self.subTest(state=state):
                since = since_for(gateway(email=entry(state, minutes_ago(7))))
                self.assertTrue(watchdog.unhealthy(since, NOW))

    def test_a_dead_writer_waits_out_the_grace_from_first_sighting(self):
        self.assertEqual(since_for(gateway(), start_time_of=gone), NOW)
        later = NOW + dt.timedelta(minutes=6)
        since = since_for(gateway(), now=later, first_seen_bad=NOW, start_time_of=gone)
        self.assertTrue(watchdog.unhealthy(since, later))

    def test_an_old_entry_left_by_a_previous_gateway_does_not_act_at_once(self):
        since = since_for(gateway(chat=entry("disconnected", minutes_ago(120), pid=4242, started=1)))
        self.assertEqual(since, NOW)
        self.assertFalse(watchdog.unhealthy(since, NOW))

    def test_a_reused_process_id_is_not_the_writer(self):
        self.assertEqual(since_for(gateway(), start_time_of=lambda pid: STARTED + 1), NOW)

    def test_an_absent_entry_or_file_dates_from_first_sighting(self):
        doc = gateway()
        del doc["platforms"]["plow_email"]
        self.assertEqual(since_for(doc), NOW)
        self.assertEqual(since_for(None), NOW)
        earlier = NOW - dt.timedelta(minutes=2)
        self.assertEqual(since_for(None, first_seen_bad=earlier), earlier)

    def test_the_earliest_problem_wins(self):
        doc = gateway(chat=entry("disconnected", minutes_ago(3)), email=entry("retrying", minutes_ago(8)))
        self.assertEqual(since_for(doc), NOW - dt.timedelta(minutes=8))

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
        self.assertEqual(watchdog.Watchdog().observe(NOW, None), "none")

    def test_inside_the_grace_it_waits_and_remembers_the_first_sighting(self):
        dog = watchdog.Watchdog()
        self.assertEqual(dog.observe(NOW, down_since(2)), "none")
        self.assertEqual(dog.observe(later(1), down_since(2)), "none")
        self.assertEqual(dog.first_seen_bad, NOW)

    def test_past_the_grace_it_restarts(self):
        self.assertEqual(watchdog.Watchdog().observe(NOW, down_since(6)), "restart")

    def test_healthy_again_after_a_restart_is_a_recovery(self):
        dog = watchdog.Watchdog()
        dog.observe(NOW, down_since(6))
        self.assertEqual(dog.observe(later(1), None), "recovered")
        self.assertEqual((dog.failed, dog.pending_since, dog.first_seen_bad), (0, None, None))

    def test_still_unhealthy_when_the_verify_window_ends_is_a_failed_recovery(self):
        dog = watchdog.Watchdog()
        since = down_since(6)
        dog.observe(NOW, since)
        self.assertEqual(dog.observe(later(2), since), "none")
        self.assertEqual(dog.observe(later(3), since), "recovery_failed")
        self.assertEqual(dog.failed, 1)

    def test_restarts_are_at_least_ten_minutes_apart(self):
        dog = watchdog.Watchdog()
        since = down_since(6)
        self.assertEqual(dog.observe(NOW, since), "restart")
        self.assertEqual(dog.observe(later(3), since), "recovery_failed")
        self.assertEqual(dog.observe(later(9), since), "none")
        self.assertEqual(dog.observe(later(10), since), "restart")

    def test_the_third_failed_recovery_alerts_once_and_restarts_stop(self):
        dog = watchdog.Watchdog()
        since = down_since(6)
        actions = [dog.observe(later(minute), since) for minute in range(40)]
        self.assertEqual(actions.count("restart"), 3)
        self.assertEqual(actions.count("recovery_failed"), 3)
        self.assertEqual(actions.count("alert"), 1)
        self.assertEqual(actions.index("alert"), 24)

    def test_coming_back_on_its_own_after_a_failure_is_noted_and_resets(self):
        dog = watchdog.Watchdog()
        dog.failed, dog.alerted = watchdog.MAX_FAILED_RECOVERIES, True
        self.assertEqual(dog.observe(NOW, None), "reconnected")
        self.assertEqual((dog.failed, dog.alerted), (0, False))
        self.assertEqual(dog.observe(later(1), None), "none")


if __name__ == "__main__":
    unittest.main()
