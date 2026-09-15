import json
from pathlib import Path
import tempfile
import unittest

import launch
import prepare_notes


class ConnectedTests(unittest.TestCase):
    def test_notes_reject_custom_tools_or_automatic_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            state=Path(directory)
            launch.initialize(state)
            config=json.loads((state/'config.yaml').read_text())
            prepare_notes.validate_profile(config)
            config['mcp_servers']['extra']={}
            with self.assertRaises(ValueError): prepare_notes.validate_profile(config)
            del config['mcp_servers']['extra']
            config['memory']['memory_enabled']=True
            with self.assertRaises(ValueError): prepare_notes.validate_profile(config)

    def test_profile_is_private_stable_and_waits_for_authorization(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory) / 'profile'
            key = launch.initialize(state)
            self.assertEqual(len(key), 64)
            self.assertEqual(launch.initialize(state), key)
            self.assertEqual((state / '.env').stat().st_mode & 0o777, 0o600)
            self.assertFalse(launch.provider_setup.status(state)['credential_saved'])
            profile = json.loads((state / 'config.yaml').read_text())
            self.assertEqual(profile['platform_toolsets']['api_server'], ['relay_evidence'])
            self.assertFalse(profile['memory']['memory_enabled'])

    def test_existing_transport_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            original = 'API_SERVER_KEY=custom\nAPI_SERVER_PORT=9000\n'
            (state / '.env').write_text(original)
            with self.assertRaises(ValueError): launch.initialize(state)
            self.assertEqual((state / '.env').read_text(), original)

    def test_existing_model_selection_survives_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            launch.initialize(state)
            before = launch.provider_setup.status(state)
            launch.provider_setup.save({'revision': before['revision'], 'provider': 'openai-api',
                'model': 'test-model', 'api_key': 'fixture-not-a-real-key'}, state)
            launch.initialize(state)
            self.assertEqual(launch.provider_setup.status(state)['model'], 'test-model')
            self.assertTrue(launch.provider_setup.status(state)['credential_saved'])


if __name__ == '__main__': unittest.main()
