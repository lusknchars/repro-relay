import copy
import importlib.util
import json
import pathlib
import subprocess
import sys
import unittest

spec = importlib.util.spec_from_file_location("relay_server", pathlib.Path(__file__).with_name("server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

FEED = {"control": {"repository": "fixture", "connected": True, "paused": False, "latest_scan": "SCAN-fixture", "last_seen": "2026-09-14"}, "mission": "Context quality", "capabilities": {"model_calls": False}, "history_limit": 100, "items": [{"id": "SCAN-fixture", "repository": "fixture", "revision": "a"*40, "created_at": "2026-09-14", "file_count": 23, "bytes": 5000, "duplicate_bytes": 1000, "files": [{"path": f"{i}/AGENTS.md", "bytes": 100, "sha256": "f"*64} for i in range(23)], "proposal": {"id": "PROP-fixture", "version": 3, "state": "pending", "result": {"saved_bytes": 600, "token_savings": None}}}]}
class API:
    def feed(self):
        return copy.deepcopy(FEED)

class ToolTests(unittest.TestCase):
    def test_bounded_evidence_keeps_revision_and_unmeasured_cost(self):
        first = server.execute(API(), "relay_inspect_work", {"audit_id": "SCAN-fixture"})
        self.assertEqual(len(first["files"]), 10)
        self.assertEqual(first["next_file_offset"], 10)
        self.assertEqual(first["revision"], "a"*40)
        self.assertIsNone(first["proposal"]["result"]["token_savings"])
        self.assertFalse(first["tool_permissions"]["approvals"])
        final = server.execute(API(), "relay_inspect_work", {"audit_id": "SCAN-fixture", "file_offset": 20})
        self.assertEqual(len(final["files"]), 3)
        self.assertIsNone(final["next_file_offset"])

    def test_validation_precedes_network_and_no_write_tools_exist(self):
        class NoAPI:
            def feed(self):
                self.fail("Unexpected network call")
        for name, args in [("approve", {}), ("relay_list_work", {"limit": True}), ("relay_list_work", {"limit": 100}), ("relay_workspace_status", {"url": "https://evil.example"}), ("relay_inspect_work", {"audit_id": "../AGENTS.md"})]:
            with self.assertRaises(ValueError):
                server.execute(NoAPI(), name, args)
        self.assertEqual(len(server.MANIFEST), 3)

    def test_initialize_notifications_tools_and_protocol_errors(self):
        instance = server.Server(API())
        def call(method, params=None, rid=1):
            return instance.handle({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}})
        self.assertIn("error", call("tools/list"))
        self.assertEqual(call("initialize", {"protocolVersion": "2025-06-18"})["result"]["protocolVersion"], "2025-06-18")
        self.assertIsNone(instance.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}))
        self.assertEqual(len(call("tools/list")["result"]["tools"]), 3)
        result = call("tools/call", {"name": "relay_workspace_status", "arguments": {}})["result"]
        self.assertFalse(result["isError"])
        self.assertEqual(json.loads(result["content"][0]["text"]), result["structuredContent"])
        self.assertEqual(call("tools/call", {"name": "approve"})["error"]["code"], -32602)
        self.assertEqual(call("tools/call", {"name": "relay_list_work", "arguments": {"limit": -1}})["result"]["isError"], True)
        self.assertIsNone(instance.handle({"jsonrpc": "2.0", "method": "notifications/cancelled"}))
        self.assertEqual(call("unknown")["error"]["code"], -32601)
        self.assertIsNone(call("ping", rid={"invalid": "id"})["id"])

    def test_protocol_only_stdout_and_bounded_parse_failures(self):
        lines = ["not json", json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}), json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"}), json.dumps({"jsonrpc":"2.0","id":2,"method":"tools/list"})]
        process = subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name("server.py"))], input="\n".join(lines)+"\n", text=True, capture_output=True, check=True)
        responses = [json.loads(line) for line in process.stdout.splitlines()]
        self.assertEqual(len(responses), 3)
        self.assertEqual(responses[0]["error"]["code"], -32700)
        self.assertEqual(responses[-1]["id"], 2)
        self.assertEqual(process.stderr, "")

    def test_local_only_transport(self):
        for url in ["https://example.com/api/v1", "http://localhost.evil/api/v1", "http://user@localhost/api/v1", "http://localhost/api/v1?key=x"]:
            with self.assertRaises(ValueError):
                server.API(url)
        self.assertIsNone(server.NoRedirect().redirect_request(None,None,302,"",{},"https://example.com"))

class ConnectionTests(unittest.TestCase):
    def test_setup_is_project_scoped_idempotent_and_preserves_existing_config(self):
        import tempfile
        sys.path.insert(0, str(pathlib.Path(__file__).parent))
        import connect
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            self.assertTrue(connect.configure(root, '/usr/bin/python3', '/repo/server.py'))
            self.assertFalse(connect.configure(root, '/usr/bin/python3', '/repo/server.py'))
            config = root / '.codex/config.toml'
            before = config.read_bytes()
            with self.assertRaises(ValueError):
                connect.configure(root, '/another/python3', '/repo/server.py')
            self.assertEqual(config.read_bytes(), before)

if __name__ == "__main__":
    unittest.main()
