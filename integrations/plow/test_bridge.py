import copy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import unittest

from bridge import ADAPTER, Bridge, BridgeError, JsonHTTP, ReceiptStore, digest, from_config, private_credentials
from fake_windows import windows_host  # bridge puts the installer's own folder on the path
import private_files


class FakePlow:
    def __init__(self):
        self.chat = {"uid": "cht_owner", "status": "active", "participants": [
            {"type": "agent", "relationship": "self", "line": {"uid": "ln_relay", "provider_type": "imessage"}},
            {"type": "member", "role": "owner", "uid": "member_owner"}]}
        self.message = {"uid": "msg_report", "direction": "inbound", "sender": {"type": "member", "uid": "member_owner"}, "body": "The address form fails.\nPlease inspect it.", "attachments": []}
        self.posts = []
        self.fail = False
        self.truncated = False
        self.pages = None
        self.reads = []

    def call(self, method, path, body=None, key=None):
        self.reads.append((method, path))
        if method == "GET" and path == "/v1/chats":
            return 200, {"data": [copy.deepcopy(self.chat)], "has_more": self.truncated}
        if path == "/v1/agents/cloud/me":
            return 200, {"line": {"uid": "ln_relay"}, "mcp_url": "https://not-exposed.example/secret"}
        if method == "GET":
            if self.pages is not None:
                return 200, self.pages.pop(0)
            return 200, {"data": [copy.deepcopy(self.message)], "has_more": False}
        assert path == "/v1/chats/cht_owner/messages"
        self.posts.append(body)
        if self.fail:
            raise BridgeError("Provider response lost.")
        return 201, {"uid": "msg_sent"}


class FakeRelay:
    def __init__(self):
        self.record = {"id": "DLV_1", "version": 1, "status": "pending", "body": "Reviewed owner update", "body_sha256": digest("Reviewed owner update"), "destination": {"provider": "plow", "line": "ln_relay", "thread": "cht_owner"}, "attempts": []}
        self.intake = []
        self.fail_outcome = False
        self.replay_claim = False
        self.automatic = False
        self.source = {"id": "SRC_1", "provider": "plow", "line": "ln_relay", "project": "Example project", "enabled": True, "revoked": False}

    def call(self, method, path, body=None, key=None):
        assert path.startswith("/api/v1/")
        if path.endswith("/runner"):
            return 200, {"available": False}
        if path.endswith("/config"):
            return 200, {"config": {"version": 3, "automatic": self.automatic}}
        if path == "/api/v1/intake/sources/SRC_1":
            return 200, copy.deepcopy(self.source)
        if path == "/api/v1/intake/SRC_1/reports":
            self.intake.append(body)
            return 201, {"case": {"id": "RR_example"}, "receipt": {"external_message_id": body["external_message_id"]}}
        if method == "GET":
            return 200, copy.deepcopy(self.record)
        assert key
        if path.endswith("/claim"):
            self.record.update(version=2, status="dispatching", attempts=[{"id": "ATT_1", "adapter": ADAPTER}])
            return 200 if self.replay_claim else 201, copy.deepcopy(self.record)
        if self.fail_outcome:
            raise BridgeError("Local API unavailable.")
        assert path.endswith(("/outcome", "/reconcile"))
        assert body["attempt_id"] == "ATT_1" and body["expected_version"] == self.record["version"]
        self.record.update(status=body["outcome"], version=self.record["version"] + 1)
        self.record["attempts"][-1]["provider_message_id"] = body["provider_message_id"]
        return 200, copy.deepcopy(self.record)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.plow, self.relay = FakePlow(), FakeRelay()
        self.bridge = Bridge(self.relay, self.plow, "ln_relay", "cht_owner", "Test maintainer", ReceiptStore(Path(self.temp.name) / "receipts"))
        self.fields = {"title": "Address failure", "url": "https://example.com", "expected": "Address should save", "build": ""}

    def send(self):
        return self.bridge.send("DLV_1", 1, digest("Reviewed owner update"))

    def test_doctor_distinguishes_advertised_latch_from_verified_action(self):
        result = self.bridge.doctor()
        self.assertTrue(result["latch_advertised"])
        self.assertFalse(result["latch_action_verified"])
        self.assertNotIn("secret", json.dumps(result))
        self.assertEqual(self.plow.posts, [])

    def test_import_preserves_original_text_and_passes_policy_version(self):
        result = self.bridge.import_report("SRC_1", "msg_report", self.fields)
        self.assertEqual(result["case_id"], "RR_example")
        payload = self.relay.intake[0]
        self.assertTrue(payload["report"]["description"].endswith(self.plow.message["body"]))
        self.assertEqual(payload["expected_config_version"], 3)
        self.assertEqual(payload["external_message_id"], "msg_report")

    def test_automatic_work_needs_explicit_intake_intent(self):
        self.relay.automatic = True
        with self.assertRaises(BridgeError):
            self.bridge.import_report("SRC_1", "msg_report", self.fields)
        self.assertEqual(self.relay.intake, [])
        self.bridge.import_report("SRC_1", "msg_report", self.fields, allow_automatic=True)
        self.assertEqual(len(self.relay.intake), 1)

    def test_echo_peer_and_different_sender_are_rejected(self):
        for direction, sender in [("outbound", {"type": "member", "uid": "member_owner"}), ("inbound", {"type": "agent", "uid": "member_owner"}), ("inbound", {"type": "member", "uid": "other"})]:
            with self.subTest(direction=direction, sender=sender):
                self.plow.message.update(direction=direction, sender=sender)
                with self.assertRaises(BridgeError):
                    self.bridge.import_report("SRC_1", "msg_report", self.fields)
        self.assertEqual(self.relay.intake, [])

    def test_group_and_wrong_line_cannot_receive_owner_updates(self):
        self.plow.chat["participants"].append({"type": "member", "uid": "outsider"})
        with self.assertRaises(BridgeError): self.send()
        self.plow.chat["participants"].pop()
        self.plow.chat["participants"][0]["line"]["uid"] = "ln_other"
        with self.assertRaises(BridgeError): self.send()
        self.assertEqual(self.plow.posts, [])
        self.assertEqual(self.relay.record["status"], "pending")

    def test_truncated_grant_fails_closed(self):
        self.plow.truncated = True
        with self.assertRaises(BridgeError): self.send()
        self.assertEqual(self.plow.posts, [])

    def test_selected_message_paginates_with_provider_cursor(self):
        self.plow.pages = [{"data": [{"uid": "msg_newer"}], "has_more": True}, {"data": [self.plow.message], "has_more": False}]
        self.bridge.import_report("SRC_1", "msg_report", self.fields)
        self.assertTrue(any("starting_after=msg_newer" in path for _, path in self.plow.reads))

    def test_repeated_cursor_never_imports_an_unseen_message(self):
        self.plow.pages = [{"data": [{"uid": "msg_newer"}], "has_more": True}] * 2
        with self.assertRaises(BridgeError): self.bridge.message("msg_absent")

    def test_disabled_source_attachments_and_forged_description_are_rejected(self):
        self.relay.source["enabled"] = False
        with self.assertRaises(BridgeError): self.bridge.import_report("SRC_1", "msg_report", self.fields)
        self.relay.source["enabled"] = True
        with self.assertRaises(BridgeError): self.bridge.import_report("SRC_1", "msg_report", dict(self.fields, description="Forged"))
        self.plow.message["attachments"] = [{"url": "https://example.com/private"}]
        with self.assertRaises(BridgeError): self.bridge.import_report("SRC_1", "msg_report", self.fields)
        self.assertEqual(self.relay.intake, [])

    def test_exact_approved_body_is_sent_once(self):
        result = self.send()
        self.assertEqual(result["status"], "delivered")
        self.assertEqual(self.plow.posts, [{"body": "Reviewed owner update"}])
        with self.assertRaises(BridgeError): self.send()
        self.bridge.record_outcome("ATT_1")
        self.assertEqual(len(self.plow.posts), 1)

    def test_report_limit_includes_provider_attribution(self):
        self.plow.message["body"] = "x" * 8_000
        with self.assertRaisesRegex(BridgeError, "8,000-character"):
            self.bridge.import_report("SRC_1", "msg_report", self.fields)
        self.assertEqual(self.relay.intake, [])

    def test_changed_preview_or_destination_never_sends(self):
        with self.assertRaises(BridgeError): self.bridge.send("DLV_1", 2, self.relay.record["body_sha256"])
        self.relay.record["destination"]["thread"] = "cht_other"
        with self.assertRaises(BridgeError): self.send()
        self.assertEqual(self.plow.posts, [])

    def test_replayed_claim_never_sends(self):
        self.relay.replay_claim = True
        self.assertEqual(self.send()["status"], "not_sent")
        self.assertEqual(self.plow.posts, [])

    def test_provider_timeout_is_uncertain_and_cannot_resend(self):
        self.plow.fail = True
        self.assertEqual(self.send()["status"], "uncertain")
        with self.assertRaises(BridgeError): self.send()
        self.assertEqual(len(self.plow.posts), 1)
        self.assertEqual(self.bridge.record_outcome("ATT_1")["status"], "uncertain")

    def test_provider_receipt_recovers_after_local_api_failure(self):
        self.relay.fail_outcome = True
        with self.assertRaises(BridgeError): self.send()
        self.assertEqual(self.bridge.receipts.read("ATT_1")["provider_message_id"], "msg_sent")
        self.relay.fail_outcome = False
        self.relay.record.update(status="uncertain", version=3)
        self.assertEqual(self.bridge.record_outcome("ATT_1")["status"], "delivered")
        self.assertEqual(len(self.plow.posts), 1)

    def test_receipt_write_failure_prevents_provider_post(self):
        self.bridge.receipts.write = lambda *args: (_ for _ in ()).throw(OSError("disk unavailable"))
        with self.assertRaises(OSError): self.send()
        self.assertEqual(self.plow.posts, [])


class BoundaryTests(unittest.TestCase):
    def test_credentials_private_and_never_sourced_as_shell(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "credentials"
            path.write_text("PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=test-token\n")
            path.chmod(0o600)
            self.assertEqual(private_credentials(path), "test-token")
            path.chmod(0o644)
            with self.assertRaises(BridgeError): private_credentials(path)
            path.chmod(0o600)
            path.write_text("PLOW_API_BASE=https://other.example\nPLOW_AGENT_TOKEN=test-token\n")
            with self.assertRaises(BridgeError): private_credentials(path)

    def test_remote_relay_rejected_before_loading_credentials(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps({"relay_url": "https://relay.example"}))
            with self.assertRaisesRegex(BridgeError, "loopback"): from_config(path)

    def test_http_redirect_never_forwards_bearer(self):
        seen = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                seen.append(self.path)
                self.send_response(302)
                self.send_header("Location", "/credential-leak")
                self.end_headers()
            def log_message(self, *args): pass
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = JsonHTTP(f"http://127.0.0.1:{server.server_port}", "fixture-only")
            with self.assertRaisesRegex(BridgeError, "302"): client.call("GET", "/start")
            self.assertEqual(seen, ["/start"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


class WindowsBoundaryTests(unittest.TestCase):
    """Reading the credential on the host where this used to crash before touching the file."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / "plow-credentials"
        self.path.write_text("PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=test-token\n")

    def test_a_credential_locked_to_this_account_is_read_where_a_mode_could_never_pass(self):
        with windows_host():
            self.assertFalse(hasattr(os, "O_NOFOLLOW"))  # what this reached for, and crashed on
            self.path.chmod(0o600)  # what the old check asked for, and what Windows ignores
            with self.assertRaises(BridgeError) as error:
                private_credentials(self.path)
            self.assertIn("icacls", str(error.exception))
            private_files.protect(self.path)
            self.assertEqual(private_credentials(self.path), "test-token")

    def test_a_credential_another_account_can_read_is_still_refused(self):
        with windows_host() as windows:
            windows.access[str(self.path)] = ["runneradmin", "NT AUTHORITY\\SYSTEM", "Everyone"]
            with self.assertRaises(BridgeError):
                private_credentials(self.path)

    def test_a_link_where_the_credential_should_be_is_refused(self):
        link = self.path.with_name("link")
        link.symlink_to(self.path)
        with windows_host():
            private_files.protect(link)
            with self.assertRaises(BridgeError):
                private_credentials(link)


if __name__ == "__main__":
    unittest.main()
