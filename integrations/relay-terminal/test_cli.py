import contextlib
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('relay_terminal', pathlib.Path(__file__).with_name('cli.py'))
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


class FakeAPI:
    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def call(self, path, body=None, request_key=None):
        self.calls.append((path, body, request_key))
        return self.answers[path]


class TerminalTests(unittest.TestCase):
    def test_saved_memory_selection_and_explicit_override(self):
        for enabled in (True, False):
            api = FakeAPI({'/tool-profile': {'version': 1, 'mem0': enabled}})
            self.assertEqual(cli.selected_memory(api, None), 'mem0' if enabled else 'off')
            self.assertEqual(len(api.calls), 1)
        api = FakeAPI({})
        for override in ('off', 'mem0'):
            self.assertEqual(cli.selected_memory(api, override), override)
        self.assertEqual(api.calls, [])

    def test_unknown_memory_selection_does_not_enable_tools(self):
        for profile in ({}, {'mem0': 'false'}, {'mem0': 1}, None):
            with self.assertRaises(ValueError):
                cli.selected_memory(FakeAPI({'/tool-profile': profile}), None)
        with self.assertRaises(KeyError):
            cli.selected_memory(FakeAPI({}), None)

    def test_transport_rejects_external_or_credential_urls(self):
        for url in ['https://example.com/api/v1', 'http://localhost/api/v1', 'http://user:token@127.0.0.1/api/v1', 'http://127.0.0.1/api/v1?x=1']:
            with self.assertRaises(ValueError):
                cli.API(url)
        self.assertIsNone(cli.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.com'))

    def test_writes_have_stable_intent_keys_and_reads_do_not(self):
        requests = []
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, size): return b'{}'
        api = cli.API('http://127.0.0.1:8178/api/v1')
        api.opener.open = lambda request, **kwargs: (requests.append(request) or Response())
        api.call('/x', {'b': 2, 'a': 1}); api.call('/x', {'a': 1, 'b': 2}); api.call('/x', {'a': 2}); api.call('/x')
        self.assertEqual(requests[0].get_header('Idempotency-key'), requests[1].get_header('Idempotency-key'))
        self.assertNotEqual(requests[0].get_header('Idempotency-key'), requests[2].get_header('Idempotency-key'))
        self.assertIsNone(requests[3].get_header('Idempotency-key'))

    def test_bad_ids_and_terminal_controls(self):
        for value in ['../x', 'RUN-x?approve=true', '/etc/passwd']:
            with self.assertRaises(Exception): cli.identifier(value)
        out = io.StringIO()
        with contextlib.redirect_stdout(out): cli.emit({'message': '\x1b[2J'})
        self.assertNotIn('\x1b', out.getvalue())

    def test_case_pagination_uses_offsets_and_compact_summaries(self):
        api = FakeAPI({'/cases?offset=0': [{'id': 'RR-1', 'title': 'Test', 'description': 'Large body'}]})
        with patch.object(cli, 'API', return_value=api), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(cli.main(['cases']), 0)
        result = json.loads(output.getvalue())
        self.assertEqual(result['cases'][0]['id'], 'RR-1')
        self.assertNotIn('description', result['cases'][0])

    def test_dispatch_requires_reviewed_version_and_approved_state(self):
        plan = {'version': 2, 'status': 'awaiting_approval'}
        api = FakeAPI({'/repairs/FIX-1': plan})
        for version in [1, 2]:
            with self.assertRaises(ValueError): cli.dispatch_next(api, 'FIX-1', 120, version)
        self.assertTrue(all(body is None for _, body, _ in api.calls))
        plan['status'] = 'approved'
        api.answers['/repairs/FIX-1/dispatch/repair'] = {'id': 'RUN-1'}
        self.assertEqual(cli.dispatch_next(api, 'FIX-1', 120, 2)['id'], 'RUN-1')
        self.assertEqual(api.calls[-1][1], {'version': 2, 'max_seconds': 120})
        plan['status'] = 'candidate_recorded'
        api.answers['/repairs/FIX-1/dispatch/verification'] = {'id': 'RUN-2'}
        self.assertEqual(cli.dispatch_next(api, 'FIX-1', 120, 2)['id'], 'RUN-2')

    def test_watch_never_stops_or_restarts_the_agent(self):
        api = FakeAPI({'/cases/RR-1/runs': [{'id': 'RUN-1', 'status': 'completed'}]})
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(cli.watch(api, 'RR-1', 'RUN-1', 1), 0)
            with patch.object(cli.time, 'monotonic', side_effect=[0, 2]):
                self.assertEqual(cli.watch(api, 'RR-1', 'RUN-1', 1), 2)
        self.assertTrue(all(body is None for _, body, _ in api.calls))

    def test_worktree_is_separate_and_never_overwrites_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = pathlib.Path(directory) / 'source'; repo.mkdir()
            cli.git(repo, 'init', '-q')
            cli.git(repo, 'config', 'user.name', 'Fixture'); cli.git(repo, 'config', 'user.email', 'fixture@example.invalid')
            (repo / 'code.txt').write_text('original')
            cli.git(repo, 'add', '.'); cli.git(repo, 'commit', '-qm', 'Fixture')
            base = cli.git(repo, 'rev-parse', 'HEAD')
            plan = {'id': 'FIX-1', 'status': 'awaiting_approval', 'input': {'repository': str(repo.resolve()), 'base_commit': base}}
            with self.assertRaises(ValueError): cli.prepare_worktree(plan, repo)
            plan['status'] = 'approved'
            result = cli.prepare_worktree(plan, repo)
            worktree = pathlib.Path(result['path'])
            self.assertEqual(cli.prepare_worktree(plan, repo), result)
            self.assertFalse(result['agent_started'])
            (worktree / 'code.txt').write_text('candidate')
            self.assertEqual((repo / 'code.txt').read_text(), 'original')
            with self.assertRaises(ValueError): cli.prepare_worktree(plan, repo)
            self.assertEqual(cli.git(repo, 'rev-parse', 'HEAD'), base)
            # A symlink destination must not be followed.
            plan['id'] = 'FIX-2'
            (worktree.parent / 'FIX-2').symlink_to(repo, target_is_directory=True)
            with self.assertRaises(ValueError): cli.prepare_worktree(plan, repo)

    def test_plan_freezes_observed_base_without_running_tests(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = pathlib.Path(directory) / 'repo'; repo.mkdir()
            cli.git(repo, 'init', '-q'); cli.git(repo, 'config', 'user.name', 'Fixture'); cli.git(repo, 'config', 'user.email', 'fixture@example.invalid')
            (repo / 'source').write_text('base'); cli.git(repo, 'add', '.'); cli.git(repo, 'commit', '-qm', 'base')
            setup = pathlib.Path(directory) / 'setup.json'
            setup.write_text(json.dumps({'repository': str(repo), 'allowed_paths': ['source'], 'acceptance_command': ['false'], 'regression_command': ['true'], 'environment': 'fixture', 'requested_by': 'test'}))
            api = FakeAPI({'/cases/RR-1': {'revision': 4}, '/cases/RR-1/repairs': {'id': 'FIX-1'}})
            cli.make_plan(api, 'RR-1', 'EV-1', setup)
            payload = api.calls[-1][1]
            self.assertEqual(payload['base_commit'], cli.git(repo, 'rev-parse', 'HEAD'))
            self.assertEqual(payload['revision'], 4)
            self.assertEqual(payload['acceptance_command'], ['false'])
            (repo / 'source').write_text('dirty')
            with self.assertRaises(ValueError): cli.make_plan(api, 'RR-1', 'EV-1', setup)


if __name__ == '__main__':
    unittest.main()
