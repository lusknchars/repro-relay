import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import provider_setup as setup
import runtime

class ProviderSetupTests(unittest.TestCase):
    def test_saved_selection_is_private_and_applied_only_at_gateway_start(self):
        with tempfile.TemporaryDirectory() as d:
            state=Path(d)
            with patch.object(runtime,'STATE',state),contextlib.redirect_stdout(io.StringIO()): runtime.setup()
            config=json.loads((state/'config.yaml').read_text())
            config['mcp_servers']['latch']={'url':'https://private.example/secret-latch-url'}
            setup.private_write(state/'config.yaml',config)
            before=(state/'config.yaml').read_bytes(); env_before=(state/'.env').read_bytes()
            v=setup.status(state)
            body={'revision':v['revision'],'provider':'anthropic','model':'model-from-account','api_key':'private-api-key-value'}
            saved=setup.save(body,state)
            self.assertTrue(saved['credential_saved']);self.assertFalse(saved['model_access_verified'])
            self.assertNotIn('private-api-key-value',json.dumps(saved));self.assertNotIn('secret-latch-url',json.dumps(saved))
            self.assertEqual((state/'config.yaml').read_bytes(),before)
            self.assertEqual((state/'.env').read_bytes(),env_before)
            self.assertEqual((state/'model-provider.json').stat().st_mode & 0o777,0o600)
            with self.assertRaisesRegex(ValueError,'changed'): setup.save(body,state)
            env={'ANTHROPIC_API_KEY':'different-parent-key','CLAUDE_CODE_OAUTH_TOKEN':'other-token'}
            setup.apply_runtime(state,env)
            after=json.loads((state/'config.yaml').read_text())
            self.assertEqual(after['mcp_servers'],config['mcp_servers'])
            self.assertEqual(after['platform_toolsets'],config['platform_toolsets'])
            self.assertEqual(after['model']['provider'],'anthropic')
            self.assertEqual(env['ANTHROPIC_API_KEY'],'private-api-key-value')
            self.assertNotIn('CLAUDE_CODE_OAUTH_TOKEN',env)
            self.assertEqual((state/'.env').read_bytes(),env_before)
            with patch.object(runtime,'STATE',state):self.assertTrue(runtime.has_auth())
            changed={**body,'revision':setup.status(state)['revision'],'api_key':None,'model':'another-model'}
            self.assertTrue(setup.save(changed,state)['credential_saved'])
            with self.assertRaisesRegex(ValueError,'another provider'):
                setup.save({**changed,'revision':setup.status(state)['revision'],'provider':'openai-api'},state)

    def test_first_setup_and_all_supported_providers_preserve_scope(self):
        for provider,p in setup.PROVIDERS.items():
            with self.subTest(provider=provider), tempfile.TemporaryDirectory() as d:
                state=Path(d);v=setup.status(state)
                self.assertFalse(v['profile_exists'])
                setup.save({'revision':v['revision'],'provider':provider,'model':'account-model','api_key':'provider-private-key'},state)
                env={};setup.apply_runtime(state,env)
                self.assertEqual(env[p['keys'][0]],'provider-private-key')
                self.assertEqual(env[p['base_env']],p['base_url'])
                config=json.loads((state/'config.yaml').read_text())
                self.assertEqual(config['platform_toolsets']['api_server'],['relay_assessment'])
                self.assertEqual(config['model']['provider'],provider)

    def test_invalid_requests_do_not_write_or_echo_credentials(self):
        with tempfile.TemporaryDirectory() as d:
            state=Path(d)
            v={'revision':setup.status(state)['revision'],'provider':'openai-api','model':'account-model','api_key':'private-key'}
            for body in [{**v,'provider':'custom'}, {**v,'api_key':'bad\nkey'}, {**v,'model':'model with spaces'}, {**v,'extra':True}, {**v,'api_key':None}, {**v,'provider':'anthropic','api_key':'sk-ant-oat-secret'}, {**v,'provider':'kimi-coding','api_key':'sk-kimi-secret'}]:
                with self.assertRaises(ValueError): setup.save(body,state)
                self.assertFalse((state/'model-provider.json').exists())
            (state/'config.yaml').write_text('model:\n  provider: custom')
            with self.assertRaisesRegex(ValueError,'custom YAML'): setup.status(state)

    def test_model_setup_cannot_enable_a_profile_without_explicit_tool_scope(self):
        for config in [{}, {'model': {'provider': 'openai-api'}}]:
            with tempfile.TemporaryDirectory() as d:
                state=Path(d);setup.private_write(state/'config.yaml',config)
                body={'revision':setup.status(state)['revision'],'provider':'openai-api','model':'model','api_key':'private-key'}
                with self.assertRaisesRegex(ValueError, 'tool'): setup.save(body,state)
                self.assertFalse((state/'model-provider.json').exists())
                self.assertEqual(json.loads((state/'config.yaml').read_text()),config)

    def test_existing_profile_key_is_reused_only_for_its_provider(self):
        with tempfile.TemporaryDirectory() as d:
            state=Path(d)
            with patch.object(runtime,'STATE',state),contextlib.redirect_stdout(io.StringIO()):runtime.setup()
            with (state/'.env').open('a') as f:f.write('\nKIMI_API_KEY="existing-private-key"\n')
            setup.save({'revision':setup.status(state)['revision'],'provider':'kimi-coding','model':'account-model','api_key':None},state)
            env={};setup.apply_runtime(state,env)
            self.assertEqual(env['KIMI_API_KEY'],'existing-private-key')

if __name__=='__main__':unittest.main()
