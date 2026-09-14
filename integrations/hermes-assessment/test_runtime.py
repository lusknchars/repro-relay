import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import runtime


class RuntimeSetupTests(unittest.TestCase):
    def test_setup_preserves_private_identity_and_exposes_only_evidence_tools(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(runtime, "STATE", Path(directory)), contextlib.redirect_stdout(io.StringIO()):
            runtime.setup()
            key = (Path(directory) / ".env").read_text()
            config_path = Path(directory) / "config.yaml"
            config = json.loads(config_path.read_text())
            self.assertEqual(config["platform_toolsets"]["api_server"], ["relay_assessment"])
            self.assertFalse(config["mcp_servers"]["relay_assessment"]["sampling"]["enabled"])
            config["model"]["default"] = "maintainer-selected-model"
            config_path.write_text(json.dumps(config))
            runtime.setup()
            self.assertEqual((Path(directory) / ".env").read_text(), key)
            self.assertEqual(json.loads(config_path.read_text())["model"]["default"], "maintainer-selected-model")
            self.assertEqual((Path(directory) / ".env").stat().st_mode & 0o777, 0o600)
            self.assertEqual(Path(directory).stat().st_mode & 0o777, 0o700)
            self.assertFalse(runtime.has_auth())

    def test_own_profile_auth_presence_not_unrelated_provider(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(runtime, "STATE", Path(directory)):
            auth = Path(directory) / "auth.json"
            auth.write_text(json.dumps({"providers": {"unrelated": {"configured": True}}}))
            self.assertFalse(runtime.has_auth())
            auth.write_text(json.dumps({"credential_pool": {"openai-codex": [{"fixture": True}]}}))
            self.assertTrue(runtime.has_auth())
            self.assertEqual(runtime.environment()["HERMES_HOME"], directory)


if __name__ == "__main__":
    unittest.main()
