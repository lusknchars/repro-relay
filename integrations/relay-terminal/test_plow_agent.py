"""Unit tests for the one-command Plow agent install. No Plow, Docker or model calls.

The contract tests load the real pinned plow-agents client, downloading and verifying it
from GitHub only when .data/tools/plow-agents is absent.
"""
import contextlib
import io
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse
import urllib.request

import cli
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

    def test_sign_in_is_found_where_the_client_itself_keeps_it(self):
        client = plow_agent.official()
        for config in ('/fixture/config', '', None):
            with self.subTest(XDG_CONFIG_HOME=config), patch.dict(os.environ, {'HOME': '/fixture/home'}):
                os.environ.pop('XDG_CONFIG_HOME', None)
                if config is not None:
                    os.environ['XDG_CONFIG_HOME'] = config
                self.assertEqual(plow_agent.signin_path(), Path(client['token_path'](None)))


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
        self.running = ''  # working directories `docker ps` reports for the Compose project
        self.docker = []  # read-only docker commands the installer ran
        self.terminal = False  # whether stdin is a terminal the installer may ask on
        self.logs = 'plow-init: configured from /var/lib/plow as cht_1\n'  # what `compose logs` shows
        self.reply = 'I am Reach.'  # speak()'s answer, or an exception to raise
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
        if args.agent_api_base != plow_agent.ORIGIN:
            raise AssertionError(f'mint was called with agent_api_base={args.agent_api_base!r}')
        self.minted = args.line
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
        return SimpleNamespace(returncode=0, stdout=self.logs)

    def speak(self, prompt):
        if isinstance(self.reply, BaseException):
            raise self.reply
        return self.reply

    def subprocess_run(self, command, **options):
        if command[:2] != ['docker', 'ps']:
            raise AssertionError(f'A test tried to run {command}')
        self.docker.append(command)
        return SimpleNamespace(returncode=0, stdout=self.running)

    @staticmethod
    def record_failure(error, path, record=plow_agent.record_failure):
        """run_agent logs unexpected errors; a tripwire (AssertionError) must reach the test instead."""
        if isinstance(error, AssertionError):
            raise error
        return record(error, path)

    def run(self, **options):
        fakes = {'ROOT': self.root, 'AGENT': self.agent, 'CREDENTIAL': self.credential, 'preflight': lambda: [],
                 'official': self.official, 'identity': self.identity, 'compose': self.compose,
                 'speak': self.speak, 'record_failure': self.record_failure}
        with contextlib.ExitStack() as stack:
            for name, value in fakes.items():
                stack.enter_context(patch.object(plow_agent, name, value))
            stack.enter_context(patch.object(subprocess, 'run', self.subprocess_run))
            stack.enter_context(patch.dict(os.environ, {'XDG_CONFIG_HOME': str(self.root / 'config')}))
            stack.enter_context(patch('builtins.input', side_effect=AssertionError('The installer asked a question.')))
            stack.enter_context(patch('sys.stdin', SimpleNamespace(isatty=lambda: self.terminal)))
            stack.enter_context(contextlib.redirect_stdout(self.out))
            stack.enter_context(contextlib.redirect_stderr(self.err))
            arguments = dict(agent_action=None, new_line=False, line=None)
            arguments.update(options)
            return plow_agent.run_agent(SimpleNamespace(**arguments))

    def plow_calls(self):
        return [call for call in self.calls if not call.startswith('compose')]


class InstallFlowTests(unittest.TestCase):
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

    def test_several_free_lines_without_a_terminal_exit_2_before_minting(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.lines = [line('ln_a', name='Alder'), line('ln_b', name='Birch')]
            self.assertEqual(install.run(), 2)
            self.assertFalse(install.credential.exists())
        self.assertNotIn('mint', install.calls)
        self.assertNotIn('compose up -d --build', install.calls)
        self.assertIn('./relay agent --line <position>', install.err.getvalue())

    def test_line_flag_installs_on_the_named_line(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.lines = [line('ln_a', name='Alder'), line('ln_b', name='Birch', number='+15550000002')]
            self.assertEqual(install.run(line='+1 555 000 0002'), 0)
        self.assertEqual(install.minted, 'ln_b')
        self.assertIn('Line .............. Birch +15550000002', install.out.getvalue())

    def test_a_tripwire_inside_the_installer_reaches_the_test(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.terminal = True
            install.lines = [line('ln_a', name='Alder'), line('ln_b', name='Birch')]
            with self.assertRaisesRegex(AssertionError, 'The installer asked a question.'):
                install.run()

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

    def test_line_flag_matches_a_free_line_by_uid_number_or_position(self):
        lines = [line('ln_b', number='+1 (555) 000-0002', name='Birch'), line('ln_a', number='+15550000001', name='Alder'),
                 line('ln_c', agent='ag_c', number='+15550000003', name='Cedar')]
        for wanted, uid in [('ln_b', 'ln_b'), ('+1 555-000-0001', 'ln_a'), ('1 (555) 000 0002', 'ln_b'), ('1', 'ln_a'), ('2', 'ln_b')]:
            with self.subTest(wanted=wanted):
                chosen = plow_agent.choose_line(lines, ask=lambda options: self.fail('asked'), wanted=wanted, interactive=False)
                self.assertEqual(chosen['uid'], uid)

    def test_line_flag_naming_no_free_line_lists_the_free_lines(self):
        lines = [line('ln_a', number='+15550000001', name='Alder'), line('ln_c', agent='ag_c', number='+15550000003', name='Cedar')]
        for wanted in ('ln_c', '+15550000003', '2', 'ln_missing'):
            with self.subTest(wanted=wanted), self.assertRaises(plow_agent.DecisionNeeded) as error:
                plow_agent.choose_line(lines, ask=lambda options: self.fail('asked'), wanted=wanted)
            self.assertEqual(error.exception.code, 2)
            self.assertIn('  1. Alder +15550000001 (ln_a)', str(error.exception))
            self.assertNotIn('Cedar', str(error.exception))

    def test_several_free_lines_without_a_terminal_list_them_with_the_rerun_command(self):
        lines = [line('ln_b', number='+15550000002', name='Birch'), line('ln_a', number='+15550000001', name='Alder')]
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.choose_line(lines, ask=lambda options: self.fail('asked'), interactive=False)
        self.assertEqual(error.exception.code, 2)
        self.assertIn('  1. Alder +15550000001 (ln_a)\n  2. Birch +15550000002 (ln_b)', str(error.exception))
        self.assertIn('./relay agent --line <position>', str(error.exception))

    def test_a_single_free_line_needs_no_terminal(self):
        chosen = plow_agent.choose_line([line('ln_1'), line('ln_2', agent='ag_2')],
                                        ask=lambda options: self.fail('asked'), interactive=False)
        self.assertEqual(chosen['uid'], 'ln_1')

    def test_no_free_line_is_a_decision_with_new_line_guidance(self):
        for wanted in (None, '1'):
            with self.subTest(wanted=wanted), self.assertRaises(plow_agent.DecisionNeeded) as error:
                plow_agent.choose_line([line('ln_1', agent='ag_1')], ask=lambda options: self.fail('asked'),
                                       wanted=wanted, interactive=False)
            self.assertEqual(error.exception.code, 2)
            self.assertIn('./relay agent --new-line', str(error.exception))

    def test_end_of_input_while_asking_is_a_decision_not_an_eoferror(self):
        with patch('builtins.input', side_effect=EOFError), contextlib.redirect_stdout(io.StringIO()), \
                self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.ask_for_line([line('ln_a', name='Alder'), line('ln_b', name='Birch')])
        self.assertIn('./relay agent --line <position>', str(error.exception))


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


class FailureTests(unittest.TestCase):
    def test_a_stalled_first_download_explains_how_to_continue(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = subprocess.TimeoutExpired(['docker', 'compose', 'up', '-d', '--build'], 1800)
            self.assertEqual(install.run(), 1)
        self.assertEqual(install.err.getvalue(), 'The first download is still running or stalled. Run ./relay agent again '
                                                 'to continue; Docker keeps what it already downloaded.\n')

    def test_an_unexpected_failure_is_logged_and_explained_in_one_sentence(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = RuntimeError('compose failed in an unforeseen way')
            with patch.dict(os.environ, {'RELAY_FIXTURE_SETTING': 'environment-marker'}):
                self.assertEqual(install.run(), 1)
                self.assertEqual(install.run(), 1)
            log = install.root / '.data/agent/install.log'
            text = log.read_text()
            self.assertFalse((install.root / '.data/agent/install.lock').exists())
        sentence = f'The install stopped unexpectedly. Details: {log}. Running ./relay agent again is safe.'
        self.assertEqual(install.err.getvalue().splitlines(), [sentence, sentence])
        self.assertEqual(len(re.findall(r'^=== \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ ===$', text, re.MULTILINE)), 2)
        self.assertEqual(text.count('Traceback (most recent call last):'), 2)
        self.assertIn('RuntimeError: compose failed in an unforeseen way', text)
        self.assertNotIn('environment-marker', text)

    def test_the_log_leaves_out_the_credential_and_sign_in_tokens(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = RuntimeError('agt_fixture_token and acct_fixture_token')
            self.assertEqual(install.run(), 1)
            self.assertTrue(install.credential.exists() and install.signin.exists())
            text = (install.root / '.data/agent/install.log').read_text()
        self.assertIn('RuntimeError:', text)
        self.assertNotIn('agt_fixture_token', text)
        self.assertNotIn('acct_fixture_token', text)

    def test_an_unexpected_failure_in_another_action_names_that_action(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(plow_agent, 'ROOT', root), patch.object(plow_agent, 'CREDENTIAL', root / 'agent/plow-credentials'), \
                    patch.object(plow_agent, 'compose', side_effect=FileNotFoundError('docker')), \
                    patch.dict(os.environ, {'XDG_CONFIG_HOME': str(root / 'config')}), \
                    contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(plow_agent.run_agent(SimpleNamespace(agent_action='status')), 1)
            log = root / '.data/agent/install.log'
            self.assertIn('FileNotFoundError: docker', log.read_text())
        self.assertEqual(err.getvalue(), f'./relay agent status stopped unexpectedly. Details: {log}. Running it again is safe.\n')

    def test_an_interruption_keeps_its_message_and_writes_no_log(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = KeyboardInterrupt()
            self.assertEqual(install.run(), 1)
            self.assertFalse((install.root / '.data/agent/install.log').exists())
        self.assertEqual(install.err.getvalue(),
                         'Stopped before finishing. Nothing was left half-created; run it again to continue.\n')


class ComposeProjectTests(unittest.TestCase):
    LISTING = ['docker', 'ps', '--filter', 'label=com.docker.compose.project=agent',
               '--format', '{{.Label "com.docker.compose.project.working_dir"}}']

    def runner(self, stdout, returncode=0):
        commands = []
        return commands, lambda command: commands.append(command) or SimpleNamespace(returncode=returncode, stdout=stdout)

    def test_an_agent_from_another_folder_stops_the_install(self):
        with tempfile.TemporaryDirectory() as directory:
            agent = Path(directory) / 'agent'
            agent.mkdir()
            commands, run = self.runner('/Users/someone/repro-relay/agent\n')
            with self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.refuse_other_agent(run=run, folder=agent, environ={})
        self.assertEqual(error.exception.code, 1)
        self.assertEqual(str(error.exception), "An agent from /Users/someone/repro-relay/agent already runs under the Docker "
                                               "project 'agent'. Stop it there, or set COMPOSE_PROJECT_NAME to install alongside it.")
        self.assertEqual(commands, [self.LISTING])

    def test_no_agent_or_this_checkouts_own_agent_lets_the_install_continue(self):
        with tempfile.TemporaryDirectory() as directory:
            agent = Path(directory) / 'agent'
            agent.mkdir()
            alias = Path(directory) / 'alias'
            alias.symlink_to(directory, target_is_directory=True)
            for listing in ('', f'{agent}\n', f'{alias}/agent\n', f'{agent}/\n\n'):
                with self.subTest(listing=listing):
                    commands, run = self.runner(listing)
                    plow_agent.refuse_other_agent(run=run, folder=agent, environ={})
                    self.assertEqual(commands, [self.LISTING])

    def test_the_project_name_comes_from_compose_project_name(self):
        with tempfile.TemporaryDirectory() as directory:
            agent = Path(directory) / 'agent'
            agent.mkdir()
            commands, run = self.runner('/Users/someone/other/agent\n')
            with self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.refuse_other_agent(run=run, folder=agent, environ={'COMPOSE_PROJECT_NAME': 'relay-two'})
        self.assertIn('label=com.docker.compose.project=relay-two', commands[0])
        self.assertIn("under the Docker project 'relay-two'", str(error.exception))

    def test_a_failed_docker_listing_stops_instead_of_assuming_nothing_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            commands, run = self.runner('', returncode=1)
            with self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.refuse_other_agent(run=run, folder=Path(directory), environ={})
        self.assertIn('did not list its running containers', str(error.exception))

    def test_install_checks_before_signing_in_or_starting_anything(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.running = '/Users/someone/repro-relay/agent\n'
            self.assertEqual(install.run(), 1)
            self.assertFalse(install.credential.exists())
        self.assertEqual(install.docker, [self.LISTING])
        self.assertEqual(install.calls, [])
        self.assertIn("An agent from /Users/someone/repro-relay/agent already runs under the Docker project 'agent'.",
                      install.err.getvalue())


class ClientDownloadTests(unittest.TestCase):
    def refused(self, **download):
        with tempfile.TemporaryDirectory() as directory:
            client = Path(directory) / 'tools/plow-agents'
            with patch.object(plow_agent, 'CLIENT', client), patch.object(urllib.request, 'urlopen', **download), \
                    self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.official()
            self.assertFalse(client.exists())
        return str(error.exception)

    def test_network_failures_are_named(self):
        for failure, named in [
                (urllib.error.URLError(socket.gaierror(8, 'nodename nor servname provided, or not known')), 'nodename nor servname'),
                (TimeoutError('The read operation timed out'), 'timed out'),
                (urllib.error.HTTPError(plow_agent.CLIENT_URL, 404, 'Not Found', {}, None), 'HTTP 404')]:
            with self.subTest(failure=failure):
                message = self.refused(side_effect=failure)
                self.assertIn('could not be downloaded', message)
                self.assertIn(named, message)

    def test_a_certificate_failure_is_named(self):
        failure = urllib.error.URLError(ssl.SSLCertVerificationError(1, '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed'))
        message = self.refused(side_effect=failure)
        self.assertIn('could not be verified', message)
        self.assertIn('CERTIFICATE_VERIFY_FAILED', message)

    def test_a_download_that_does_not_match_the_pin_is_refused(self):
        self.assertIn('checksum', self.refused(return_value=io.BytesIO(b'not the official client')))


class SignInTests(unittest.TestCase):
    REMOVED = 'Sign-in ........... removed from this Mac; the agent keeps its own credential'
    KEPT = 'Sign-in ........... kept; revoke the plow-agents session in Plow Latch if you no longer need it'

    def test_a_sign_in_this_install_created_is_removed_after_it_succeeds(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            self.assertEqual(install.run(), 0)
            self.assertIn('login', install.calls)
            self.assertFalse(install.signin.exists())
        self.assertIn(self.REMOVED, install.out.getvalue())
        self.assertNotIn(self.KEPT, install.out.getvalue())

    def test_a_sign_in_that_existed_before_the_install_is_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.signin.parent.mkdir(parents=True)
            install.signin.write_text('acct_owner_token\n')
            self.assertEqual(install.run(), 0)
            self.assertNotIn('login', install.calls)
            self.assertEqual(install.signin.read_text(), 'acct_owner_token\n')
        self.assertIn(self.KEPT, install.out.getvalue())
        self.assertNotIn(self.REMOVED, install.out.getvalue())

    def test_a_failed_install_keeps_the_sign_in_it_created(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = SimpleNamespace(returncode=1)
            self.assertEqual(install.run(), 1)
            self.assertIn('login', install.calls)
            self.assertTrue(install.signin.exists())
        self.assertNotIn('Sign-in .....', install.out.getvalue())

    def test_a_sign_in_is_kept_when_the_agent_never_reports_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.logs = 'plow-init: credential rejected -- parking; no gateway will start\n'
            self.assertEqual(install.run(), 1)
            self.assertIn('login', install.calls)
            self.assertTrue(install.signin.exists())
        self.assertIn('parking; no gateway will start', install.err.getvalue())
        self.assertNotIn('Sign-in .....', install.out.getvalue())

    def test_a_sign_in_is_kept_when_hermes_does_not_answer(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.reply = plow_agent.AgentError('The agent is running but did not answer.')
            self.assertEqual(install.run(), 1)
            self.assertIn('login', install.calls)
            self.assertTrue(install.signin.exists())
        self.assertIn('did not answer', install.err.getvalue())
        self.assertNotIn('Sign-in .....', install.out.getvalue())

    def test_resuming_says_nothing_about_the_sign_in(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n')
            install.signin.parent.mkdir(parents=True)
            install.signin.write_text('acct_owner_token\n')
            self.assertEqual(install.run(), 0)
            self.assertTrue(install.signin.exists())
        self.assertNotIn('Sign-in .....', install.out.getvalue())

    def test_the_sign_in_path_follows_xdg_config_home(self):
        with patch.dict(os.environ, {'XDG_CONFIG_HOME': '/fixture/config', 'HOME': '/fixture/home'}):
            self.assertEqual(plow_agent.signin_path(), Path('/fixture/config/plow/token'))
            os.environ['XDG_CONFIG_HOME'] = ''
            self.assertEqual(plow_agent.signin_path(), Path('/fixture/home/.config/plow/token'))
            del os.environ['XDG_CONFIG_HOME']
            self.assertEqual(plow_agent.signin_path(), Path('/fixture/home/.config/plow/token'))


class CertificateTests(unittest.TestCase):
    def certifi(self):
        module = ModuleType('certifi')
        module.where = lambda: '/fixture/certifi/cacert.pem'
        return module

    def test_certifi_supplies_the_bundle_when_none_is_set(self):
        with patch.dict(sys.modules, {'certifi': self.certifi()}), patch.dict(os.environ):
            os.environ.pop('SSL_CERT_FILE', None)
            plow_agent.trust_certifi()
            self.assertEqual(os.environ.get('SSL_CERT_FILE'), '/fixture/certifi/cacert.pem')

    def test_a_bundle_the_owner_set_is_kept(self):
        with patch.dict(sys.modules, {'certifi': self.certifi()}), patch.dict(os.environ, {'SSL_CERT_FILE': '/owner/bundle.pem'}):
            plow_agent.trust_certifi()
            self.assertEqual(os.environ['SSL_CERT_FILE'], '/owner/bundle.pem')

    def test_nothing_changes_without_certifi(self):
        with patch.dict(sys.modules, {'certifi': None}), patch.dict(os.environ):
            os.environ.pop('SSL_CERT_FILE', None)
            plow_agent.trust_certifi()
            self.assertNotIn('SSL_CERT_FILE', os.environ)

    def test_the_bundle_is_set_before_the_install_reaches_the_network(self):
        seen = []
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            load = install.official
            install.official = lambda: seen.append(os.environ.get('SSL_CERT_FILE')) or load()
            with patch.dict(sys.modules, {'certifi': self.certifi()}), patch.dict(os.environ):
                os.environ.pop('SSL_CERT_FILE', None)
                self.assertEqual(install.run(), 0)
        self.assertEqual(seen, ['/fixture/certifi/cacert.pem'])


class CommandLineTests(unittest.TestCase):
    def test_line_flag_reaches_the_installer_and_its_exit_code_is_returned(self):
        received = []
        with patch.object(plow_agent, 'run_agent', side_effect=lambda args: received.append(args) or 2):
            self.assertEqual(cli.main(['agent', '--line', '+1 (555) 000-0002']), 2)
            self.assertEqual(cli.main(['agent']), 2)
        self.assertEqual([args.line for args in received], ['+1 (555) 000-0002', None])


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

    def test_agent_readme_teaches_choosing_a_line_without_being_asked(self):
        readme = (plow_agent.ROOT / 'agent/README.md').read_text()
        self.assertIn('./relay agent --line', readme)


if __name__ == '__main__':
    unittest.main()
