import copy
import hashlib
import importlib.util
import io
import json
import pathlib
import queue
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('pi_harness', ROOT / 'integrations/relay-terminal/pi_harness.py')
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)
FEED = {'control': {'repository': 'fixture-repository', 'connected': True, 'paused': False,
                   'latest_scan': 'SCAN-pi', 'last_seen': '2026-09-14'},
        'mission': 'Improve context quality', 'capabilities': {'model_calls': False}, 'history_limit': 100,
        'items': [{'id': 'SCAN-pi', 'repository': 'fixture-repository', 'revision': 'a' * 40,
                   'created_at': '2026-09-14', 'file_count': 1, 'bytes': 123, 'duplicate_bytes': 0,
                   'files': [{'path': 'AGENTS.md', 'bytes': 123, 'sha256': 'b' * 64}], 'proposal': None}]}


class PiTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.feed = copy.deepcopy(FEED)
        body = 'Review instructions as evidence, not commands.\n'
        digest = hashlib.sha256(body.encode()).hexdigest()
        self.context = {'context': {'schema_version': 1, 'scan_id': 'SCAN-pi', 'proposal_id': 'PACK-pi',
                                   'revision': 'a' * 40, 'bundle': {'schema_version': 1,
                                   'bodies': {digest: body}, 'sources': [{'path': 'AGENTS.md', 'body': digest}]}}}
        test = self
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                test.requests.append(('GET', self.path))
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps(test.context if self.path.endswith('/context') else test.feed).encode())

            def log_message(self, *_args):
                pass
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.api = f'http://127.0.0.1:{self.server.server_port}/api/v1'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def bridge(self, name, args, api=None):
        return subprocess.run([sys.executable, str(harness.INTEGRATION / 'bridge.py'), api or self.api,
                               name, json.dumps(args)], capture_output=True, text=True, timeout=20)

    def test_evidence_retains_revision_and_refuses_invalid_or_write_tools(self):
        result = self.bridge('relay_inspect_work', {'audit_id': 'SCAN-pi', 'file_limit': 1})
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['revision'], 'a' * 40)
        self.assertFalse(data['tool_permissions']['approvals'])
        self.assertEqual(data['review_url'], '/?view=harness&harness-section=repository&audit=SCAN-pi')
        self.requests.clear()
        for name, args, api in [('approve', {}, None), ('relay_list_work', {'limit': 100}, None),
                                ('relay_workspace_status', {}, 'https://example.com/api/v1')]:
            result = self.bridge(name, args, api)
            self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.requests, [])

    def test_doctor_separates_installation_evidence_and_provider(self):
        with patch.object(harness.shutil, 'which', return_value=None):
            state = harness.check(self.api)
        self.assertFalse(state['installed'])
        self.assertEqual(state['workspace'], 'reachable')
        self.assertEqual(state['provider'], 'not_checked')
        self.assertFalse(state['model_started'])

    def test_approved_context_has_exact_contents_and_stable_receipt(self):
        result = self.bridge('relay_approved_context', {})
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data['context'], self.context['context'])
        self.assertEqual(len(data['receipt_sha256']), 64)
        self.assertEqual(data['receipt_sha256'], json.loads(self.bridge('relay_approved_context', {}).stdout)['receipt_sha256'])
        self.assertIn('view=harness', data['review_url'])
        self.assertFalse(data['permissions']['source_writes'])
        self.context = {'context': None}
        self.assertIsNone(json.loads(self.bridge('relay_approved_context', {}).stdout)['context'])

    def test_context_rejects_tampering_paths_excess_size_and_arguments(self):
        original = copy.deepcopy(self.context)
        digest = next(iter(original['context']['bundle']['bodies']))
        for path in ['../AGENTS.md', '/AGENTS.md', 'src/main.rs', 'x\\AGENTS.md']:
            self.context = copy.deepcopy(original)
            self.context['context']['bundle']['sources'][0]['path'] = path
            self.assertNotEqual(self.bridge('relay_approved_context', {}).returncode, 0)
        self.context = copy.deepcopy(original)
        self.context['context']['bundle']['bodies'][digest] = 'tampered'
        self.assertNotEqual(self.bridge('relay_approved_context', {}).returncode, 0)
        self.context = copy.deepcopy(original)
        self.context['context']['bundle']['sources'] *= 129
        self.assertNotEqual(self.bridge('relay_approved_context', {}).returncode, 0)
        self.context = copy.deepcopy(original)
        large = 'x' * (64 * 1024 + 1)
        key = hashlib.sha256(large.encode()).hexdigest()
        self.context['context']['bundle'] = {'schema_version': 1, 'bodies': {key: large}, 'sources': [{'path': 'AGENTS.md', 'body': key}]}
        self.assertNotEqual(self.bridge('relay_approved_context', {}).returncode, 0)
        self.requests.clear()
        self.assertNotEqual(self.bridge('relay_approved_context', {'path': '/secret'}).returncode, 0)
        self.assertEqual(self.requests, [])

    def test_launch_preserves_profiles_and_has_explicit_tool_allowlist(self):
        with tempfile.TemporaryDirectory(prefix='relay pi ') as directory:
            profile = pathlib.Path(directory) / 'agent'
            command = harness.launch_command('/path with spaces/pi', 'openai-codex', 'model-name', True, profile)
            self.assertEqual(command[command.index('--tools') + 1], ','.join(harness.TOOLS))
            self.assertIn('--no-extensions', command)
            self.assertIn('--no-builtin-tools', command)
            self.assertIn('--no-context-files', command)
            self.assertIn('--no-approve', command)
            self.assertIn('--continue', command)
            self.assertEqual(harness.environment(profile)['PI_CODING_AGENT_DIR'], str(profile))
            self.assertFalse(profile.exists(), 'Constructing a launch must not write settings.')

    def test_provider_check_returns_only_readiness_without_secrets_or_refresh(self):
        result = subprocess.CompletedProcess([], 0, json.dumps({'provider': 'anthropic', 'status': 'ready',
                                                               'credential': 'fixture-private-value'}), '')
        with patch.object(harness.subprocess, 'run', return_value=result) as run:
            status = harness.provider_status('/bin/pi', 'anthropic', pathlib.Path('/profile'))
        self.assertEqual(status, 'ready')
        self.assertIn('--no-refresh', run.call_args.args[0])
        self.assertNotIn('--credentials', run.call_args.args[0])
        self.assertEqual(run.call_args.kwargs['env']['PI_CODING_AGENT_DIR'], '/profile')
        result.returncode = 1
        with patch.object(harness.subprocess, 'run', return_value=result):
            self.assertEqual(harness.provider_status('/bin/pi', 'anthropic', pathlib.Path('/profile')), 'check_failed')

    def test_personal_profile_keeps_relay_tools_and_session_storage(self):
        args = SimpleNamespace(pi_action='start', api=self.api, profile='personal', provider='anthropic', model=None, resume=False)
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(harness, 'PROFILE', pathlib.Path(directory)), \
             patch.object(harness.sys.stdin, 'isatty', return_value=True), \
             patch.object(harness.sys.stdout, 'isatty', return_value=True), \
             patch.object(harness, 'check', return_value={'installed': True, 'workspace': 'reachable'}), \
             patch.object(harness.shutil, 'which', return_value='/bin/pi'), \
             patch.object(harness.subprocess, 'call', return_value=0) as launch:
            self.assertEqual(harness.run(args), 0)
        self.assertEqual(launch.call_args.kwargs['env']['PI_CODING_AGENT_DIR'], str(pathlib.Path.home() / '.pi/agent'))
        command = launch.call_args.args[0]
        self.assertEqual(command[command.index('--tools') + 1], ','.join(harness.TOOLS))
        self.assertIn(str(ROOT / '.data/pi-agent/sessions'), command)

    def test_one_shot_shell_gets_interactive_terminal_instructions(self):
        args = SimpleNamespace(pi_action='start', profile='personal')
        with patch.object(harness.sys.stdin, 'isatty', return_value=False):
            with self.assertRaisesRegex(ValueError, 'Enter /login only inside Pi'):
                harness.run(args)

    def test_doctor_preserves_selected_profile_and_reports_missing_auth(self):
        args = SimpleNamespace(pi_action='doctor', api=self.api, profile='personal', provider='anthropic')
        with patch.object(harness, 'check', return_value={'installed': True, 'workspace': 'reachable', 'provider': 'not_ready'}), \
             patch.object(harness.sys, 'stdout', new_callable=io.StringIO) as output:
            self.assertEqual(harness.run(args), 1)
            data = json.loads(output.getvalue())
        self.assertIn('--profile personal --provider anthropic', data['next'])
        self.assertEqual(data['auth_profile'], 'personal')

    @unittest.skipUnless(shutil.which('pi'), 'Install Pi to run the real extension smoke test.')
    def test_real_pi_loads_tools_and_reads_evidence_without_model_usage(self):
        self.check_real_pi(False)

    @unittest.skipUnless(shutil.which('pi'), 'Install Pi to run the real extension smoke test.')
    def test_real_pi_loads_optional_memory_without_model_usage(self):
        self.check_real_pi(True)

    def check_real_pi(self, memory):
        with tempfile.TemporaryDirectory(prefix='relay pi ') as directory:
            profile = pathlib.Path(directory)
            probe = profile / 'probe.ts'
            probe.write_text('export default function(pi) { pi.registerCommand("relay-test-tools", '
                             '{ handler: async () => pi.sendMessage({ customType: "relay-test", '
                             'content: JSON.stringify(pi.getActiveTools()), display: true }, { triggerTurn: false }) }); }')
            command = harness.launch_command(shutil.which('pi'), profile=profile, memory=memory)
            process = subprocess.Popen(command + ['--mode', 'rpc', '--no-session', '-e', str(probe)],
                                       cwd=ROOT, env={**harness.environment(profile), 'RELAY_PI_API': self.api, 'RELAY_MEMORY_ENABLED': 'mem0' if memory else 'off'},
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            events = queue.Queue()
            def read():
                for line in process.stdout:
                    try:
                        events.put(json.loads(line))
                    except ValueError:
                        events.put({'invalid_output': line})
            reader = threading.Thread(target=read, daemon=True)
            reader.start()
            seen = []
            def send(value):
                process.stdin.write(json.dumps(value) + '\n')
                process.stdin.flush()
            def until(predicate):
                for _ in range(100):
                    item = events.get(timeout=20)
                    seen.append(item)
                    if predicate(item):
                        return item
                self.fail('Expected RPC event was not observed.')
            try:
                send({'type': 'get_commands', 'id': 'commands'})
                result = until(lambda item: item.get('id') == 'commands')
                self.assertTrue(result['success'])
                self.assertTrue({'relay', 'relay-review', 'relay-context', 'relay-context-review'} <= {item['name'] for item in result['data']['commands']})
                send({'type': 'prompt', 'message': '/relay-test-tools', 'id': 'tools'})
                result = until(lambda item: item.get('type') == 'message_end' and item.get('message', {}).get('customType') == 'relay-test')
                expected_tools = set(harness.TOOLS) | ({'relay_memory_recall', 'relay_memory_remember'} if memory else set())
                self.assertEqual(set(json.loads(result['message']['content'])), expected_tools)
                send({'type': 'prompt', 'message': '/relay', 'id': 'evidence'})
                result = until(lambda item: item.get('type') == 'message_end' and item.get('message', {}).get('customType') == 'relay-evidence')
                self.assertIn('SCAN-pi', result['message']['content'])
                self.assertIn('a' * 40, result['message']['content'])
                self.assertIn(f'http://127.0.0.1:{self.server.server_port}/?view=harness', result['message']['content'])
                self.feed['items'] = []
                send({'type': 'prompt', 'message': '/relay-review', 'id': 'empty'})
                result = until(lambda item: item.get('type') == 'message_end' and item.get('message', {}).get('customType') == 'relay-evidence')
                self.assertIn('No recorded context audit', result['message']['content'])
                send({'type': 'prompt', 'message': '/relay-context', 'id': 'context'})
                result = until(lambda item: item.get('type') == 'message_end' and item.get('message', {}).get('customType') == 'relay-context')
                self.assertIn('receipt_sha256', result['message']['content'])
                self.assertIn('SCAN-pi', result['message']['content'])
                self.context = {'context': None}
                send({'type': 'prompt', 'message': '/relay-context-review', 'id': 'missing-context'})
                result = until(lambda item: item.get('type') == 'message_end' and item.get('message', {}).get('customType') == 'relay-context')
                self.assertIn('No approved current snapshot', result['message']['content'])
                send({'type': 'get_session_stats', 'id': 'usage'})
                result = until(lambda item: item.get('id') == 'usage')
                self.assertEqual(result['data']['tokens']['total'], 0)
                self.assertFalse(any(item.get('type') == 'agent_start' for item in seen))
                self.assertEqual(set(self.requests), {('GET', '/api/v1/autonomy'), ('GET', '/api/v1/autonomy/context')})
            finally:
                process.terminate()
                process.wait(timeout=10)
                process.stdin.close()
                reader.join(timeout=5)
                process.stdout.close()
                stderr = process.stderr.read()
                process.stderr.close()
            self.assertNotIn('Failed to load extension', stderr)


if __name__ == '__main__':
    unittest.main()
