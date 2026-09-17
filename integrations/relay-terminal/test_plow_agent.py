"""Unit tests for the one-command Plow agent install. No Plow, Docker or model calls.

The contract tests load the real pinned plow-agents client, downloading and verifying it
from GitHub only when .data/tools/plow-agents is absent.
"""
import contextlib
import io
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.parse
import urllib.request

import plow_agent


def line(uid, agent=None, number='+15550000000', name='Alder'):
    return {'uid': uid, 'agent_uid': agent, 'provider_key': number, 'display_name': name}


class FakePlow:
    """Plow's API behind the pinned client: one free line, and an agent created with its token."""

    def __init__(self):
        self.sent = []

    def request(self, method, url, **options):
        path = urllib.parse.urlsplit(url).path
        self.sent.append((method, path))
        if (method, path) == ('GET', '/v1/lines'):
            return 200, {'data': [line('ln_free')]}
        if (method, path) == ('POST', '/v1/agents'):
            return 201, {'agent': {'uid': 'ag_new'}, 'token': 'agt_fixture_token'}
        return 204, None

    def call(self, method, base, path, **options):
        return self.request(method, base + path, **options)[1]

    @contextlib.contextmanager
    def behind(self, client):
        """Route the client's network functions here; anything else reaching for the network fails the test."""
        def refuse(*arguments, **options):
            raise AssertionError('A test tried to reach the network.')
        # run_path returns a copy of the client's globals; its functions read the original dict.
        with patch.dict(client['mint'].__globals__, {'call': self.call, 'request': self.request}), \
                patch.object(urllib.request, 'urlopen', refuse), \
                patch.object(urllib.request.OpenerDirector, 'open', refuse):
            yield


class OfficialClientContractTests(unittest.TestCase):
    """The installer's mint path through the real pinned client. Only Plow's API is faked."""

    def test_mint_writes_a_private_credential_and_keeps_the_new_agent(self):
        client, plow = plow_agent.official(), FakePlow()
        with tempfile.TemporaryDirectory() as directory, plow.behind(client):
            config = Path(directory) / 'config'
            (config / 'plow').mkdir(parents=True)
            (config / 'plow/token').write_text('acct_fixture_token\n')
            credential = Path(directory) / 'plow-credentials'
            with patch.dict(os.environ, {'XDG_CONFIG_HOME': str(config)}), contextlib.redirect_stderr(io.StringIO()):
                plow_agent.mint_credential(client, credential, 'ln_free')
            mode, text = credential.stat().st_mode & 0o777, credential.read_text()
        self.assertEqual(mode, 0o600)
        self.assertIn('PLOW_API_BASE=https://api.plow.co\n', text)
        self.assertIn('PLOW_AGENT_TOKEN=agt_fixture_token\n', text)
        self.assertIn('# plow-agent-uid: ag_new', text)
        self.assertIn(('POST', '/v1/agents'), plow.sent)
        self.assertNotIn('DELETE', [method for method, _ in plow.sent])


class Installation:
    """run_agent() in a temporary checkout, with Docker, Plow, the official client and the terminal faked."""

    def __init__(self, directory):
        self.root = Path(directory)
        self.agent = self.root / 'agent'
        self.agent.mkdir()
        self.credential = self.agent / 'plow-credentials'
        self.signin = self.root / 'config/plow/token'
        self.lines = [line('ln_1')]
        self.verified = {'line': line('ln_1')}  # identity() of an existing credential, or an exception to raise
        self.up = SimpleNamespace(returncode=0)  # `compose up` result, or an exception to raise
        self.calls = []
        self.out, self.err = io.StringIO(), io.StringIO()

    def official(self):
        self.calls.append('official')
        return {'account_token': self.account_token, 'login': self.login,
                'account_lines': self.account_lines, 'mint': self.mint}

    def account_token(self, args):
        self.calls.append('account_token')
        if not self.signin.exists():
            raise SystemExit('plow-agents: no account token')
        return self.signin.read_text().strip()

    def login(self, args):
        self.calls.append('login')
        self.signin.parent.mkdir(parents=True, exist_ok=True)
        self.signin.write_text('acct_fixture_token\n')

    def account_lines(self, base, token):
        self.calls.append('account_lines')
        return self.lines

    def mint(self, args):
        self.calls.append('mint')
        Path(args.credential_file).write_text('PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=agt_fixture_token\n')

    def identity(self, path):
        self.calls.append('identity')
        if isinstance(self.verified, BaseException):
            raise self.verified
        return self.verified

    def compose(self, *arguments, capture=False):
        self.calls.append(' '.join(('compose',) + arguments))
        if arguments[0] == 'up':
            if isinstance(self.up, BaseException):
                raise self.up
            return self.up
        return SimpleNamespace(returncode=0, stdout='plow-init: configured from /var/lib/plow as cht_1\n')

    def run(self, **options):
        fakes = {'ROOT': self.root, 'AGENT': self.agent, 'CREDENTIAL': self.credential, 'preflight': lambda: [],
                 'official': self.official, 'identity': self.identity, 'compose': self.compose,
                 'speak': lambda prompt: 'I am Reach.'}
        with contextlib.ExitStack() as stack:
            for name, value in fakes.items():
                stack.enter_context(patch.object(plow_agent, name, value))
            stack.enter_context(patch.dict(os.environ, {'XDG_CONFIG_HOME': str(self.root / 'config')}))
            stack.enter_context(patch('builtins.input', side_effect=AssertionError('The installer asked a question.')))
            stack.enter_context(contextlib.redirect_stdout(self.out))
            stack.enter_context(contextlib.redirect_stderr(self.err))
            arguments = dict(agent_action=None, new_line=False, line=None)
            arguments.update(options)
            return plow_agent.run_agent(SimpleNamespace(**arguments))

    def plow_calls(self):
        return [call for call in self.calls if not call.startswith('compose')]


class ResumeTests(unittest.TestCase):
    def test_an_existing_credential_resumes_without_signing_in_or_choosing_a_line(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n')
            install.lines = [line('ln_1'), line('ln_2')]
            install.verified = {'line': line('ln_2', number='+15551234567', name='Birch')}
            self.assertEqual(install.run(), 0)
        self.assertEqual(install.plow_calls(), ['identity'])
        self.assertIn('compose up -d --build', install.calls)
        self.assertIn('Credential ........ reused', install.out.getvalue())
        self.assertIn('Text +15551234567 to talk to your agent.', install.out.getvalue())

    def test_without_a_credential_it_signs_in_chooses_a_line_and_mints(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            self.assertEqual(install.run(), 0)
            self.assertTrue(install.credential.exists())
        self.assertEqual(install.plow_calls(), ['official', 'account_token', 'login', 'account_token', 'account_lines', 'mint'])
        self.assertIn('Credential ........ minted', install.out.getvalue())

    def test_a_credential_plow_cannot_verify_stops_and_is_left_byte_identical(self):
        original = b'PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=agt_existing\n# plow-agent-uid: ag_old\n'
        for verified in (plow_agent.AgentError('API returned HTTP 401; no automatic retry was made.'), {}, {'line': {}}):
            with self.subTest(verified=verified), tempfile.TemporaryDirectory() as directory:
                install = Installation(directory)
                install.credential.write_bytes(original)
                install.verified = verified
                self.assertEqual(install.run(), 1)
                self.assertEqual(install.credential.read_bytes(), original)
                self.assertEqual(install.calls, ['identity'])
                self.assertIn('could not be verified', install.err.getvalue())
                self.assertIn('left untouched', install.err.getvalue())

    def test_identity_reports_an_unusable_credential_as_an_agent_error(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n')
            credential.chmod(0o644)
            with patch.object(urllib.request.OpenerDirector, 'open', side_effect=AssertionError('network')), \
                    self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.identity(credential)
        self.assertIn('chmod 600', str(error.exception))


class LineSelectionTests(unittest.TestCase):
    def test_single_free_line_is_selected_without_asking(self):
        asked = []
        chosen = plow_agent.choose_line([line('ln_1')], ask=lambda options: asked.append(options))
        self.assertEqual(chosen['uid'], 'ln_1')
        self.assertEqual(asked, [])

    def test_several_free_lines_are_offered_and_the_answer_is_used(self):
        lines = [line('ln_1', name='One'), line('ln_2', name='Two')]
        chosen = plow_agent.choose_line(lines, ask=lambda options: options[1])
        self.assertEqual(chosen['uid'], 'ln_2')

    def test_occupied_lines_are_never_selected(self):
        with self.assertRaises(plow_agent.AgentError) as error:
            plow_agent.choose_line([line('ln_1', agent='ag_1')], ask=lambda options: options[0])
        self.assertIn('--new-line', str(error.exception))

    def test_an_account_without_lines_explains_how_to_get_one(self):
        with self.assertRaises(plow_agent.AgentError) as error:
            plow_agent.choose_line([], ask=lambda options: options[0])
        self.assertIn('--new-line', str(error.exception))


class CredentialTests(unittest.TestCase):
    def test_existing_credential_for_another_line_stops_without_minting(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            credential.write_text('PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=x\n')
            minted = []
            with self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.ensure_credential(
                    credential, line('ln_2'),
                    identity=lambda path: {'line': {'uid': 'ln_other'}},
                    mint=lambda path, uid: minted.append(uid))
            self.assertEqual(minted, [])
            self.assertIn('ln_other', str(error.exception))
            self.assertTrue(credential.exists())

    def test_existing_credential_for_the_same_line_is_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            credential.write_text('PLOW_AGENT_TOKEN=x\n')
            minted = []
            plow_agent.ensure_credential(
                credential, line('ln_2'),
                identity=lambda path: {'line': {'uid': 'ln_2'}},
                mint=lambda path, uid: minted.append(uid))
            self.assertEqual(minted, [])

    def test_missing_credential_is_minted_for_the_selected_line(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            minted = []
            plow_agent.ensure_credential(
                credential, line('ln_2'),
                identity=lambda path: {'line': {'uid': 'ln_2'}},
                mint=lambda path, uid: minted.append(uid))
            self.assertEqual(minted, ['ln_2'])


class ReadinessTests(unittest.TestCase):
    def test_configured_message_reports_ready(self):
        state, detail = plow_agent.wait_ready(
            lambda: 'starting\nplow-init: configured from /var/lib/plow as cht_1\n',
            sleep=lambda seconds: None, timeout=10)
        self.assertEqual(state, 'ready')
        self.assertIn('cht_1', detail)

    def test_parked_message_reports_its_reason(self):
        state, detail = plow_agent.wait_ready(
            lambda: 'plow-init: credential rejected -- parking; no gateway will start\n',
            sleep=lambda seconds: None, timeout=10)
        self.assertEqual(state, 'parked')
        self.assertIn('credential rejected', detail)

    def test_silence_times_out_with_bounded_waiting(self):
        slept = []
        state, _ = plow_agent.wait_ready(
            lambda: 'still booting\n', sleep=slept.append, timeout=6)
        self.assertEqual(state, 'timeout')
        self.assertLessEqual(sum(slept), 6)


class PreflightTests(unittest.TestCase):
    def test_missing_docker_is_reported_with_its_remedy(self):
        with patch.object(plow_agent.shutil, 'which', return_value=None):
            missing = plow_agent.preflight(run=lambda command: 1)
        self.assertTrue(any('Docker' in item for item in missing))

    def test_stopped_docker_is_reported(self):
        with patch.object(plow_agent.shutil, 'which', return_value='/usr/bin/docker'):
            missing = plow_agent.preflight(run=lambda command: 1)
        self.assertTrue(any('Start Docker' in item or 'Docker' in item for item in missing))

    def test_ready_docker_reports_nothing(self):
        with patch.object(plow_agent.shutil, 'which', return_value='/usr/bin/docker'):
            self.assertEqual(plow_agent.preflight(run=lambda command: 0), [])


class LockTests(unittest.TestCase):
    def test_a_second_install_refuses_while_one_holds_the_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'install.lock'
            with plow_agent.installation_lock(path):
                with self.assertRaises(plow_agent.AgentError):
                    with plow_agent.installation_lock(path):
                        pass
            with plow_agent.installation_lock(path):
                pass


class StatusTests(unittest.TestCase):
    def test_status_reports_state_without_revealing_the_reporter_key(self):
        text = plow_agent.status_report(
            running=True, line=line('ln_2', number='+15551234567'), configured=True,
            reporter={'install_id': 'abc123', 'key': 'aik_secret_value'},
            usage={'agent': 'repro-relay', 'days': 1, 'tokens': 57922})
        self.assertNotIn('aik_secret_value', text)
        self.assertIn('repro-relay', text)
        self.assertIn('57,922', text)
        self.assertIn('+15551234567', text)

    def test_status_says_when_nothing_is_registered_yet(self):
        text = plow_agent.status_report(
            running=False, line=None, configured=False, reporter={}, usage={})
        self.assertIn('not registered', text.lower())
        self.assertIn('not running', text.lower())


class ReportedUsageTests(unittest.TestCase):
    def test_thousands_separated_totals_are_read(self):
        logs = ('agent-1  |   agentsview not installed - skipping that collector\n'
                'agent-1  |   agent=repro-relay days=1 tokens=3,078,430\n'
                'agent-1  |   agent=repro-relay days=1 tokens=3,191,866\n')
        self.assertEqual(plow_agent.parse_usage(logs),
                         {'agent': 'repro-relay', 'days': 1, 'tokens': 3191866})

    def test_logs_without_a_report_give_nothing(self):
        self.assertEqual(plow_agent.parse_usage('agent-1  |   starting\n'), {})

    def test_a_failed_collector_is_never_shown_as_a_total(self):
        logs = ('agent-1  |   COLLECTOR FAILED - hermes store state.db: configured but missing\n'
                'agent-1  |   agent=repro-relay days=0 tokens=0\n'
                'agent-1  |   a collector failed - NOT reporting a partial total\n')
        self.assertEqual(plow_agent.parse_usage(logs), {})


class DocumentationTests(unittest.TestCase):
    def test_readme_teaches_the_command_and_keeps_no_install_url(self):
        readme = (plow_agent.ROOT / 'README.md').read_text()
        start = readme.index('## Quick start')
        section = readme[start:readme.index('\n## ', start + 1)]
        self.assertIn('./relay agent', section)
        self.assertNotIn('curl', section)
        self.assertNotIn('https://', section)

    def test_agent_readme_teaches_the_same_command(self):
        readme = (plow_agent.ROOT / 'agent/README.md').read_text()
        self.assertIn('./relay agent', readme)


if __name__ == '__main__':
    unittest.main()
