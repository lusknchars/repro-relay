import copy
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import latch_setup


class LatchSetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.config = {'model': {'provider': 'kimi-coding', 'default': 'saved-model'},
                       'mcp_servers': {'existing': {'command': 'existing-command'}},
                       'platform_toolsets': {'api_server': ['existing'], 'cli': ['existing']},
                       'memory': {'memory_enabled': False}}
        self.path = self.state / 'config.yaml'
        self.path.write_text(json.dumps(self.config))

    @patch.object(latch_setup, 'connection', return_value={'url': 'https://api.plow.co/private-test', 'token': 'private-token'})
    def test_enable_preserves_profile_and_only_adds_read_tools(self, connection):
        result = latch_setup.enable(self.state)
        self.assertTrue(result['restart_required'])
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved['model'], self.config['model'])
        self.assertEqual(saved['memory'], self.config['memory'])
        self.assertEqual(saved['mcp_servers']['existing'], self.config['mcp_servers']['existing'])
        self.assertEqual(saved['platform_toolsets']['api_server'], ['existing', 'plow_latch'])
        self.assertEqual(saved['mcp_servers']['plow_latch']['tools']['include'], latch_setup.READ_TOOLS)
        self.assertNotIn('plow_run_command', latch_setup.READ_TOOLS)
        self.assertNotIn('plow_write_file', latch_setup.READ_TOOLS)
        self.assertNotIn('private-token', self.path.read_text())
        self.assertNotIn('/private-test', self.path.read_text())
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        latch_setup.enable(self.state)
        self.assertEqual(json.loads(self.path.read_text()), saved)

    @patch.object(latch_setup, 'connection', return_value={'url': 'https://api.plow.co/current', 'token': 'current-token'})
    def test_launch_uses_current_grant_without_saving_secrets(self, connection):
        latch_setup.enable(self.state)
        before = self.path.read_bytes()
        env = {'RELAY_PLOW_MCP_URL': 'old', 'RELAY_PLOW_AGENT_TOKEN': 'old', 'OTHER': 'keep'}
        latch_setup.apply_runtime(self.state, env)
        self.assertEqual(env, {'RELAY_PLOW_MCP_URL': 'https://api.plow.co/current',
                               'RELAY_PLOW_AGENT_TOKEN': 'current-token', 'OTHER': 'keep'})
        self.assertEqual(self.path.read_bytes(), before)
        connection.side_effect = ValueError('Grant revoked')
        with self.assertRaisesRegex(ValueError, 'revoked'):
            latch_setup.apply_runtime(self.state, {})

    @patch.object(latch_setup, 'connection', return_value={})
    def test_refuses_unscoped_or_conflicting_profiles_without_editing(self, connection):
        for change in ('scope', 'server'):
            config = copy.deepcopy(self.config)
            if change == 'scope': del config['platform_toolsets']['cli']
            else: config['mcp_servers']['plow_latch'] = {'command': 'user-managed'}
            self.path.write_text(json.dumps(config))
            before = self.path.read_bytes()
            with self.assertRaises(ValueError): latch_setup.enable(self.state)
            self.assertEqual(self.path.read_bytes(), before)

    @patch.object(latch_setup, 'connection')
    def test_unconfigured_profile_never_contacts_plow(self, connection):
        env = {}
        latch_setup.apply_runtime(self.state, env)
        connection.assert_not_called()
        self.assertEqual(env, {})

    def test_connection_validates_identity_and_endpoint_before_using_token(self):
        import sys
        sys.path.insert(0, str(latch_setup.ROOT / 'integrations/plow'))
        from unittest.mock import Mock
        bridge = SimpleNamespace(line='ln_test', plow=Mock(), granted_chat=Mock())
        bridge.plow.token = 'private-token'
        with patch('bridge.from_config', return_value=bridge):
            for url in (None, 'http://api.plow.co/mcp', 'https://wrong.example/mcp',
                        'https://user@api.plow.co/mcp', 'https://api.plow.co:444/mcp',
                        'https://api.plow.co/mcp#fragment'):
                bridge.plow.call.return_value = (200, {'line': {'uid': 'ln_test'}, 'mcp_url': url})
                with self.assertRaises(ValueError): latch_setup.connection()
            bridge.plow.call.return_value = (200, {'line': {'uid': 'other'}, 'mcp_url': 'https://api.plow.co/mcp'})
            with self.assertRaises(ValueError): latch_setup.connection()
            bridge.plow.call.return_value = (200, {'line': {'uid': 'ln_test'}, 'mcp_url': 'https://api.plow.co/mcp'})
            self.assertEqual(latch_setup.connection(), {'url': 'https://api.plow.co/mcp', 'token': 'private-token'})
            bridge.granted_chat.assert_called()


if __name__ == '__main__':
    unittest.main()
