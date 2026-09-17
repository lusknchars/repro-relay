from contextlib import contextmanager
import datetime as dt
import importlib.util
import inspect
import json
import os
from pathlib import Path
import signal
import tempfile
import time
import unittest
import unittest.mock
import urllib.error
import urllib.request

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

    def test_a_symlink_a_fifo_an_oversized_or_a_deeply_nested_file_loads_as_none(self):
        with tempfile.TemporaryDirectory() as folder:
            real = Path(folder) / "gateway_state.json"
            real.write_text(json.dumps(gateway()))
            link = Path(folder) / "link.json"
            link.symlink_to(real)
            fifo = Path(folder) / "fifo.json"
            os.mkfifo(fifo)
            big = Path(folder) / "big.json"
            big.write_text(json.dumps({"pad": "x" * watchdog.STATE_LIMIT}))
            deep = Path(folder) / "deep.json"
            deep.write_text('{"a":' * 100000 + "1" + "}" * 100000)
            for path in (link, fifo, big, deep):
                with self.subTest(path=path.name):
                    self.assertIsNone(watchdog.load_state(path))
            self.assertEqual(watchdog.load_state(real)["pid"], PID)

    def test_a_directory_at_the_state_path_loads_as_none_without_leaking_descriptors(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "gateway_state.json"
            path.mkdir()
            before = len(os.listdir("/dev/fd"))
            for _ in range(50):
                self.assertIsNone(watchdog.load_state(path))
            self.assertEqual(len(os.listdir("/dev/fd")), before)


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


ARROW = "→"

# The lines the running agent wrote on September 17, verbatim.
DEGRADED = "2026-09-17 18:27:49,111 WARNING tools.mcp_tool: MCP server 'plow' keepalive failed, triggering reconnect (state: connected → degraded): MCPError: Server returned an error response"
PARKED = "2026-09-17 18:28:25,446 WARNING tools.mcp_tool: MCP server 'plow' failed after 5 reconnection attempts, parking; will self-probe every 300s until it recovers (state: degraded → parked): MCPError: Server returned an error response"
REVIVED = "2026-09-17 18:36:29,267 WARNING tools.mcp_tool: MCP server 'plow': revived — session healthy again after parking (state: parked → connected)"
UNKNOWN_TOOL = '2026-09-17 17:03:47,416 WARNING [20260915_195146_eccb6d55] agent.tool_executor: Tool mcp__plow__plow_device_status returned error (0.00s): {"error": "Unknown tool: mcp__plow__plow_device_status"}'
AGENT_LOG = "\n".join([UNKNOWN_TOOL, DEGRADED, PARKED]) + "\n"

# The same two substrings, inside lines the gateway's MCP logger did not write.
CHAT_ECHO = f'2026-09-17 18:41:02,004 INFO agent.messages: message from the owner: "{PARKED}"'
TOOL_ECHO = ('2026-09-17 18:42:11,900 WARNING [20260915_195146_eccb6d55] agent.tool_executor: '
             f'Tool mcp__plow__plow_read_file returned error (0.00s): {{"error": "{REVIVED}"}}')


def mcp_line(at, body, server="plow"):
    return f"2026-09-17 {at} WARNING tools.mcp_tool: MCP server '{server}' {body}"


@contextmanager
def deadline(seconds=5):
    """Turn a read that blocks into a failure rather than a hung suite."""
    def ring(number, frame):
        raise TimeoutError("the call blocked")

    previous = signal.signal(signal.SIGALRM, ring)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def logged(folder, text):
    path = Path(folder) / "agent.log"
    path.write_text(text, encoding="utf-8")
    return path


def at(hour, minute, second, millisecond=0):
    return dt.datetime(2026, 9, 17, hour, minute, second, millisecond * 1000, tzinfo=dt.timezone.utc)


class MacSessionLog(unittest.TestCase):
    def test_the_last_state_change_for_the_server_is_the_session_state(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(watchdog.mcp_status(logged(folder, AGENT_LOG)),
                             ("parked", at(18, 28, 25, 446)))

    def test_a_plain_arrow_reads_like_the_unicode_one_and_another_server_is_not_ours(self):
        elsewhere = mcp_line("18:40:12,000", f"keepalive failed (state: connected {ARROW} degraded)", server="github")
        text = "\n".join([AGENT_LOG, REVIVED.replace(ARROW, "->"), elsewhere]) + "\n"
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(watchdog.mcp_status(logged(folder, text)),
                             ("connected", at(18, 36, 29, 267)))

    def test_a_line_the_gateways_own_logger_did_not_write_is_not_a_reading(self):
        text = "\n".join([DEGRADED, PARKED, REVIVED, CHAT_ECHO, TOOL_ECHO]) + "\n"
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(watchdog.mcp_status(logged(folder, text)),
                             ("connected", at(18, 36, 29, 267)))
            quoted = "\n".join([CHAT_ECHO, TOOL_ECHO]) + "\n"
            self.assertEqual(watchdog.mcp_status(logged(folder, quoted)), (None, None))

    def test_a_stamp_that_names_no_moment_is_not_a_reading(self):
        impossible = PARKED.replace("2026-09-17 18:28:25,446", "2026-13-45 18:28:25,446")
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(watchdog.mcp_status(logged(folder, impossible + "\n")), (None, None))
            both = "\n".join([DEGRADED, impossible]) + "\n"
            self.assertEqual(watchdog.mcp_status(logged(folder, both)),
                             ("degraded", at(18, 27, 49, 111)))

    def test_a_quarter_megabyte_hostile_line_costs_almost_nothing(self):
        hostile = "2026-09-17 18:29:00,000 WARNING tools.mcp_tool: MCP server 'plow' " + "(state: " * 34000
        self.assertGreater(len(hostile.encode()), 256 * 1024)
        text = "\n".join([PARKED, hostile]) + "\n"
        with tempfile.TemporaryDirectory() as folder:
            path = logged(folder, text)
            started = time.perf_counter()
            answer = watchdog.mcp_status(path, tail=len(text.encode()) + 1)
            spent = time.perf_counter() - started
        self.assertEqual(answer, ("parked", at(18, 28, 25, 446)))
        self.assertLess(spent, 0.5, f"the pattern spent {spent:.1f}s on one line")

    def test_a_missing_or_unsafe_log_and_one_without_the_server_read_as_nothing(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(watchdog.mcp_status(Path(folder) / "gone.log"), (None, None))
            real = logged(folder, AGENT_LOG)
            link = Path(folder) / "link.log"
            link.symlink_to(real)
            fifo = Path(folder) / "fifo.log"
            os.mkfifo(fifo)
            directory = Path(folder) / "directory.log"
            directory.mkdir()
            quiet = Path(folder) / "quiet.log"
            quiet.write_text(UNKNOWN_TOOL + "\n", encoding="utf-8")
            for path in (link, fifo, directory, quiet):
                with self.subTest(path=path.name):
                    self.assertEqual(watchdog.mcp_status(path), (None, None))
            self.assertEqual(watchdog.mcp_status(real)[0], "parked")

    def test_only_the_end_of_the_log_is_read_and_the_partial_first_line_is_dropped(self):
        text = "\n".join([DEGRADED, PARKED, UNKNOWN_TOOL]) + "\n"
        opens_inside_the_parked_line = len(PARKED.encode()) + len(UNKNOWN_TOOL.encode()) - 3
        with tempfile.TemporaryDirectory() as folder:
            path = logged(folder, text)
            self.assertEqual(watchdog.mcp_status(path, tail=len(text.encode())),
                             ("parked", at(18, 28, 25, 446)))
            self.assertEqual(watchdog.mcp_status(path, tail=opens_inside_the_parked_line),
                             (None, None))


def down_since(minutes):
    return NOW - dt.timedelta(minutes=minutes)


class MacSessionRule(unittest.TestCase):
    def test_connected_or_nothing_read_is_no_problem(self):
        self.assertIsNone(watchdog.mcp_problem("connected", at(18, 36, 29, 267)))
        self.assertIsNone(watchdog.mcp_problem(None, None))

    def test_every_other_state_dates_the_problem_from_the_change(self):
        since = at(18, 27, 49, 111)
        for state in ("degraded", "parked", "reconnecting"):
            with self.subTest(state=state):
                self.assertEqual(watchdog.mcp_problem(state, since), since)

    def test_the_mac_session_waits_out_the_grace_the_transport_gets(self):
        self.assertEqual(watchdog.MCP_GRACE_SECONDS, watchdog.GRACE_SECONDS)
        self.assertFalse(watchdog.unhealthy(watchdog.mcp_problem("parked", down_since(5)), NOW))
        self.assertTrue(watchdog.unhealthy(watchdog.mcp_problem("parked", down_since(6)), NOW))


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
    def __init__(self, body, status=200):
        self.body = body
        self.status = status

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

    def test_a_redirect_is_refused_rather_than_followed(self):
        self.assertIsNone(watchdog.NoRedirect().redirect_request(None, None, 302, "Found", {}, "https://elsewhere.example/"))

    def test_the_default_opener_ignores_proxy_settings_and_refuses_redirects(self):
        proxy = {"https_proxy": "http://proxy.invalid:9", "HTTPS_PROXY": "http://proxy.invalid:9"}
        with unittest.mock.patch.dict(os.environ, proxy):
            stock = urllib.request.build_opener()
            opener = watchdog.plow_opener()
        self.assertTrue(any(isinstance(handler, urllib.request.ProxyHandler) for handler in stock.handlers))
        self.assertFalse(any(isinstance(handler, urllib.request.ProxyHandler) for handler in opener.handlers))
        redirects = [handler for handler in opener.handlers if isinstance(handler, urllib.request.HTTPRedirectHandler)]
        self.assertTrue(redirects)
        self.assertTrue(all(isinstance(handler, watchdog.NoRedirect) for handler in redirects))
        self.assertEqual(inspect.signature(watchdog.send_alert).parameters["opener"].default, watchdog.OPENER.open)

    def test_nothing_is_sent_to_a_malformed_chat_or_over_plain_http(self):
        sent = []

        def opener(request, timeout):
            sent.append(request)
            return FakeResponse(b'{"uid": "msg_1"}')

        for base, chat in (("https://api.plow.co", "cht_owner/../../v1/agents"),
                           ("https://api.plow.co", ""),
                           ("http://api.plow.co", "cht_owner")):
            with self.subTest(base=base, chat=chat):
                self.assertEqual(watchdog.send_alert(base, "tok", chat, opener=opener), "failed")
        self.assertEqual(sent, [])

    def test_the_alert_text_has_no_hyphens_or_dashes(self):
        dashes = {"-", "‐", "‑", "‒", "–", "—", "―", "−"}
        for text in (watchdog.ALERT_TEXT, watchdog.MAC_ALERT_TEXT, watchdog.LATCH_ALERT_TEXT):
            with self.subTest(text=text[:24]):
                self.assertFalse(dashes & set(text))

    def test_the_mac_texts_say_what_is_lost_and_what_the_owner_can_do(self):
        self.assertEqual(watchdog.MAC_ALERT_TEXT, (
            "I lost my connection to your Mac and could not get it back after three tries, "
            "so I cannot read files or run commands there. Restarting the agent may fix it."))
        self.assertEqual(watchdog.LATCH_ALERT_TEXT, (
            "I cannot reach your Mac through Latch right now, so I cannot read files or run "
            "commands there. Waking the Mac or opening Latch should fix it. Messages still reach me."))


LATCH_URL = "https://api.plow.co/v1/mcp/dev_2f8a9c"
HANDSHAKE = b'{"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-06-18", "serverInfo": {"name": "plow"}}}'


def latch_with(opener, url=LATCH_URL):
    return watchdog.latch_reachable(url, "tok", opener=opener)


class LatchProbe(unittest.TestCase):
    def test_the_handshake_has_the_shape_an_mcp_server_expects(self):
        request = watchdog.build_handshake_request(LATCH_URL, "tok")
        self.assertEqual(request.full_url, LATCH_URL)
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(request.get_header("Authorization"), "Bearer tok")
        self.assertEqual(request.get_header("Content-type"), "application/json")
        self.assertEqual(request.get_header("Accept"), "application/json, text/event-stream")
        self.assertEqual(request.get_header("Mcp-protocol-version"), "2025-06-18")
        self.assertEqual(json.loads(request.data), {
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                       "clientInfo": {"name": "transport-watchdog", "version": "1"}}})

    def test_latch_answering_the_handshake_means_the_mac_is_reachable(self):
        asked = []

        def opener(request, timeout):
            asked.append((request.full_url, timeout))
            return FakeResponse(HANDSHAKE)

        self.assertTrue(watchdog.latch_reachable(LATCH_URL, "tok", opener=opener))
        self.assertEqual(asked, [(LATCH_URL, 20)])

    def test_an_event_stream_is_read_from_its_last_data_line(self):
        stream = (b'event: message\ndata: {"jsonrpc": "2.0", "id": 0, "error": {"code": -32000}}\n'
                  b"\nevent: message\ndata: " + HANDSHAKE + b"\n\n")
        self.assertTrue(latch_with(answering(stream)))

    def test_an_answer_without_a_result_is_not_an_answer(self):
        for body in (b'{"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "no device"}}',
                     b"event: message\ndata: half a line\n\n", b"", b"not json", b"[]"):
            with self.subTest(body=body):
                self.assertFalse(latch_with(answering(body)))

    def test_an_error_a_timeout_or_a_nonsense_url_is_not_an_answer_and_never_raises(self):
        for error in (http_error(503), http_error(401), http_error(404),
                      urllib.error.URLError(TimeoutError()), urllib.error.URLError(ConnectionRefusedError()),
                      TimeoutError(), ConnectionResetError(), ValueError("unknown url type")):
            with self.subTest(error=type(error).__name__):
                self.assertFalse(latch_with(raising(error)))

    def test_only_a_2xx_answer_counts(self):
        for status in (302, 204):
            with self.subTest(status=status):
                self.assertEqual(latch_with(lambda request, timeout: FakeResponse(HANDSHAKE, status)),
                                 status == 204)

    def test_the_agent_token_never_leaves_over_plain_http(self):
        sent = []

        def opener(request, timeout):
            sent.append(request)
            return FakeResponse(HANDSHAKE)

        for url in ("http://api.plow.co/v1/mcp/dev_2f8a9c", "/v1/mcp/dev_2f8a9c", ""):
            with self.subTest(url=url):
                self.assertFalse(latch_with(opener, url=url))
        self.assertEqual(sent, [])


def stalled():
    return gateway(chat=entry("disconnected", minutes_ago(6)))


def mac(state, minutes=None):
    return lambda: (state, None if minutes is None else down_since(minutes))


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
        self.assertIn("exec /opt/hermes/.venv/bin/python3 -I -S /etc/s6-overlay/scripts/transport_watchdog.py", text)

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
        self.assertEqual(lines, ["transport not healthy since 11:54 UTC, restarting the gateway",
                                 "s6 did not accept the restart"])

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
                                    send=lambda base, token, chat, text: sent.append((base, token, chat, text)) or "sent")
        action = watchdog.once(dog, NOW, stalled(), restart=lambda: True, alert=alert,
                               log=lines.append, start_time_of=running)
        self.assertEqual(action, "alert")
        self.assertEqual(sent, [("https://api.plow.co", "tok_secret", "cht_owner", watchdog.ALERT_TEXT)])
        self.assertIn("owner alert sent", lines[-1])
        self.assertNotIn("tok_secret", "\n".join(lines))

    def test_every_outcome_after_a_restart_is_logged(self):
        lines = []
        dog = watchdog.Watchdog()

        def check(minute, doc):
            return watchdog.once(dog, later(minute), doc, restart=lambda: True, alert=lambda: "sent",
                                 log=lines.append, start_time_of=running)

        self.assertEqual(check(0, stalled()), "restart")
        self.assertEqual(check(3, stalled()), "recovery_failed")
        self.assertEqual(check(4, gateway()), "reconnected")
        self.assertEqual(check(10, stalled()), "restart")
        self.assertEqual(check(11, gateway()), "recovered")
        self.assertEqual(lines, [
            "transport not healthy since 11:54 UTC, restarting the gateway",
            "the restart did not reconnect the transport, 1 of 3",
            "transport connected again",
            "transport not healthy since 11:54 UTC, restarting the gateway",
            "transport reconnected after the restart",
        ])

    def test_an_alert_that_raises_still_leaves_a_record(self):
        lines = []
        dog = watchdog.Watchdog()
        dog.failed = watchdog.MAX_FAILED_RECOVERIES

        def alert(text):
            raise ValueError("detail that must not reach the log")

        action = watchdog.once(dog, NOW, stalled(), restart=lambda: True, alert=alert,
                               log=lines.append, start_time_of=running)
        self.assertEqual(action, "alert")
        self.assertEqual(lines, ["recovery failed 3 times, owner alert failed with ValueError"])

    def test_a_stuck_mac_session_latch_answers_for_joins_the_transports_problem(self):
        restarts, lines = [], []
        dog = watchdog.Watchdog()
        action = watchdog.once(dog, NOW, gateway(), restart=lambda: restarts.append(1) or True,
                               alert=lambda text: "sent", log=lines.append, start_time_of=running,
                               mcp=mac("parked", 7), probe=lambda: True)
        self.assertEqual((action, len(restarts)), ("restart", 1))
        self.assertEqual(dog.since, down_since(7))
        self.assertEqual(lines, ["the Mac session has been parked since 11:53 UTC",
                                 "transport not healthy since 11:53 UTC, restarting the gateway"])

    def test_the_earlier_of_the_two_problems_dates_the_trouble(self):
        dog = watchdog.Watchdog()
        watchdog.once(dog, NOW, stalled(), restart=lambda: True, alert=lambda text: "sent",
                      log=lambda line: None, start_time_of=running,
                      mcp=mac("parked", 30), probe=lambda: True)
        self.assertEqual(dog.since, down_since(30))

    def test_a_mac_session_inside_the_grace_is_left_alone_and_latch_is_not_asked(self):
        probes, restarts, lines = [], [], []
        action = watchdog.once(watchdog.Watchdog(), NOW, gateway(),
                               restart=lambda: restarts.append(1) or True,
                               alert=lambda text: "sent", log=lines.append, start_time_of=running,
                               mcp=mac("degraded", 5), probe=lambda: probes.append(1) or False)
        self.assertEqual((action, probes, restarts, lines), ("none", [], [], []))

    def test_a_mac_latch_does_not_answer_for_is_not_restarted_and_is_told_once(self):
        restarts, sent, lines = [], [], []
        dog = watchdog.Watchdog()

        def check(minute, session):
            return watchdog.once(dog, later(minute), gateway(),
                                 restart=lambda: restarts.append(1) or True,
                                 alert=lambda text: sent.append(text) or "sent",
                                 log=lines.append, start_time_of=running,
                                 mcp=session, probe=lambda: False)

        self.assertEqual(check(0, mac("parked", 7)), "none")
        self.assertEqual(check(1, mac("parked", 8)), "none")
        self.assertEqual((restarts, sent), ([], [watchdog.LATCH_ALERT_TEXT]))
        self.assertEqual(check(2, mac("connected", 0)), "none")
        self.assertEqual(check(3, mac("parked", 10)), "none")
        self.assertEqual(sent, [watchdog.LATCH_ALERT_TEXT, watchdog.LATCH_ALERT_TEXT])
        self.assertEqual(restarts, [])

    def test_the_alert_is_worded_for_whichever_problem_came_first(self):
        stale = gateway(chat=entry("disconnected", minutes_ago(20)))
        for doc, session, expected in ((stale, mac("parked", 7), watchdog.ALERT_TEXT),
                                       (stale, mac("parked", 30), watchdog.MAC_ALERT_TEXT),
                                       (gateway(), mac("parked", 30), watchdog.MAC_ALERT_TEXT),
                                       (None, mac("parked", 30), watchdog.MAC_ALERT_TEXT),
                                       (stale, mac("connected", 0), watchdog.ALERT_TEXT),
                                       (stale, None, watchdog.ALERT_TEXT)):
            with self.subTest(expected=expected[:24]):
                sent, lines = [], []
                dog = watchdog.Watchdog()
                dog.failed = watchdog.MAX_FAILED_RECOVERIES
                action = watchdog.once(dog, NOW, doc, restart=lambda: True,
                                       alert=lambda text: sent.append(text) or "sent",
                                       log=lines.append, start_time_of=running,
                                       mcp=session, probe=lambda: True)
                self.assertEqual((action, sent), ("alert", [expected]))

    def test_the_mac_session_is_logged_when_it_goes_when_latch_is_out_and_when_it_returns(self):
        lines = []
        dog = watchdog.Watchdog()

        def check(minute, session, reachable):
            return watchdog.once(dog, later(minute), gateway(), restart=lambda: True,
                                 alert=lambda text: "sent", log=lines.append, start_time_of=running,
                                 mcp=session, probe=lambda: reachable)

        check(0, mac("degraded", 7), False)
        check(1, mac("parked", 8), False)
        check(2, mac("connected", 0), True)
        check(3, mac("parked", 20), True)
        self.assertEqual(lines, [
            "the Mac session has been degraded since 11:53 UTC",
            "cannot reach the Mac through Latch, owner notice sent",
            "the Mac session is connected again",
            "the Mac session has been parked since 11:40 UTC",
            "transport not healthy since 11:40 UTC, restarting the gateway",
        ])

    def test_settings_come_from_the_names_plow_init_publishes(self):
        env = {"PLOW_API_BASE": "https://staging.plow.example", "PLOW_AGENT_TOKEN": "tok",
               "PLOW_HOME_CHANNEL": "cht_owner", "PLOW_MCP_URL": LATCH_URL}
        self.assertEqual(watchdog.settings(read=env.get),
                         ("https://staging.plow.example", "tok", "cht_owner", LATCH_URL, "tok"))
        self.assertEqual(watchdog.settings(read=lambda name: ""),
                         ("https://api.plow.co", "", "", "", ""))

    def test_without_the_token_or_the_owner_chat_it_stands_down_and_says_which(self):
        for token, chat, missing in (("", "cht_owner", "PLOW_AGENT_TOKEN"), ("tok_secret", "", "PLOW_HOME_CHANNEL")):
            with self.subTest(missing=missing):
                lines, sleeps = [], []
                watchdog.main(configured=lambda: ("https://api.plow.co", token, chat, LATCH_URL, token),
                              sleep=sleeps.append, log=lines.append)
                self.assertEqual(sleeps, [86400])
                self.assertEqual(len(lines), 1)
                self.assertIn(missing, lines[0])
                self.assertNotIn("tok_secret", lines[0])

    def test_main_watches_the_mac_only_when_latch_is_configured(self):
        class Stop(Exception):
            pass

        seen = []

        def fake_once(dog, now, doc, restart, alert, log=None, start_time_of=None, mcp=None, probe=None):
            seen.append((mcp, probe))
            return "none"

        def stop(seconds):
            raise Stop

        def run(mcp_url):
            lines = []
            with unittest.mock.patch.object(watchdog, "once", fake_once), \
                    unittest.mock.patch.object(watchdog, "load_state", lambda: None):
                with self.assertRaises(Stop):
                    watchdog.main(configured=lambda: ("https://api.plow.co", "tok_secret", "cht_owner",
                                                      mcp_url, "tok_secret"),
                                  sleep=stop, log=lines.append)
            return lines

        asked = []
        with unittest.mock.patch.object(watchdog, "mcp_status", lambda: ("parked", NOW)), \
                unittest.mock.patch.object(watchdog, "latch_reachable",
                                           lambda url, token: asked.append((url, token)) or True):
            self.assertEqual(run(LATCH_URL), [])
            read_session, probe = seen[-1]
            self.assertEqual(read_session(), ("parked", NOW))
            self.assertTrue(probe())
        self.assertEqual(asked, [(LATCH_URL, "tok_secret")])

        lines = run("")
        self.assertEqual(seen[-1], (None, None))
        self.assertEqual(len(lines), 1)
        self.assertIn("PLOW_MCP_URL", lines[0])
        self.assertNotIn("tok_secret", lines[0])

    def test_main_hands_base_token_and_chat_to_the_alert_in_that_order(self):
        class Stop(Exception):
            pass

        made = []

        def fake_make_alert(base, token, chat_uid, send=None):
            made.append((base, token, chat_uid))
            return lambda: "sent"

        def stop(seconds):
            raise Stop

        with unittest.mock.patch.object(watchdog, "make_alert", fake_make_alert), \
                unittest.mock.patch.object(watchdog, "load_state", lambda: None):
            with self.assertRaises(Stop):
                watchdog.main(configured=lambda: ("https://api.plow.co", "tok", "cht_owner", LATCH_URL, "tok"),
                              sleep=stop, log=lambda message: None)
        self.assertEqual(made, [("https://api.plow.co", "tok", "cht_owner")])


if __name__ == "__main__":
    unittest.main()
