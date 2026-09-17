"""Unit tests for the one-command Plow agent install. No Plow, Docker or model calls.

The contract tests load the real pinned plow-agents client, downloading and verifying it
from GitHub only when .data/tools/plow-agents is absent.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import signal
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
        self.docker = FakeDocker()  # read-only docker state; any other docker command fails the test
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
        return self.docker(command, **options)

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
        rejected = plow_agent.CredentialRejected('API returned HTTP 401; no automatic retry was made.')
        for verified in (rejected, plow_agent.PlowUnreachable('timed out'), {}, {'line': {}}):
            with self.subTest(verified=verified), tempfile.TemporaryDirectory() as directory:
                install = Installation(directory)
                install.credential.write_bytes(original)
                install.verified = verified
                self.assertEqual(install.run(), 1)
                self.assertEqual(install.credential.read_bytes(), original)
                self.assertEqual(install.calls, ['identity'])
                self.assertIn('left untouched', install.err.getvalue())
                self.assertEqual('remove the file yourself' in install.err.getvalue(), verified is rejected)

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
            with self.assertRaises(plow_agent.AgentError) as missing:
                plow_agent.identity(Path(directory) / 'absent')
        self.assertIn('chmod 600', str(error.exception))
        for local in (error.exception, missing.exception):
            self.assertNotIsInstance(local, plow_agent.PlowUnreachable)


class CredentialVerificationTests(unittest.TestCase):
    """existing_line() with the real identity() and bridge; only the HTTP opener is faked."""
    UNREACHABLE = 'Could not verify the existing credential with Plow right now. It was left untouched; run ./relay agent again later.'

    def verify(self, **opener):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            credential.write_text('PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=agt_fixture_token\n')
            credential.chmod(0o600)
            original = credential.read_bytes()
            with patch.object(urllib.request.OpenerDirector, 'open', **opener), \
                    self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.existing_line(credential, plow_agent.identity)
            self.assertEqual(credential.read_bytes(), original)
        self.assertEqual(error.exception.code, 1)
        return str(error.exception)

    def test_plow_out_of_reach_leaves_the_credential_for_a_later_run(self):
        class Garbled:
            status = 200
            def __enter__(self): return self
            def __exit__(self, *details): return False
            def read(self, size): return b'<html>not json</html>'
        for opener in ({'side_effect': urllib.error.URLError(socket.gaierror(8, 'nodename nor servname provided, or not known'))},
                       {'side_effect': TimeoutError('The read operation timed out')},
                       {'side_effect': ConnectionResetError(54, 'Connection reset by peer')},
                       {'return_value': Garbled()}):
            with self.subTest(opener=opener):
                self.assertEqual(self.verify(**opener), self.UNREACHABLE)

    def test_only_a_definitive_rejection_suggests_removing_the_credential(self):
        for code in (401, 403, 404):
            with self.subTest(code=code):
                failure = urllib.error.HTTPError('https://api.plow.co/v1/agents/cloud/me', code, 'Rejected', {}, None)
                message = self.verify(side_effect=failure)
                self.assertTrue(message.endswith(f'could not be verified with Plow. API returned HTTP {code}; no automatic '
                                                 'retry was made. It was left untouched. If that agent was retired, remove '
                                                 'the file yourself first, then run ./relay agent again.'), message)
                self.assertNotIn('reconcile', message)

    def test_a_busy_or_failing_plow_never_suggests_removing_the_credential(self):
        for code in (500, 502, 429):
            with self.subTest(code=code):
                failure = urllib.error.HTTPError('https://api.plow.co/v1/agents/cloud/me', code, 'Busy', {}, None)
                self.assertEqual(self.verify(side_effect=failure), self.UNREACHABLE)

    def test_a_certificate_failure_gets_the_certificate_hint_not_a_later_run(self):
        reason = '[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate'
        for failure in (urllib.error.URLError(ssl.SSLCertVerificationError(1, reason)), ssl.SSLCertVerificationError(1, reason)):
            with self.subTest(failure=failure):
                self.assertEqual(self.verify(side_effect=failure),
                                 f'Could not verify the existing credential with Plow: the secure connection could not be '
                                 f'verified ({reason}); if this Python has no certificates, python3 -m pip install certifi '
                                 'provides them. It was left untouched; run ./relay agent again once that is fixed.')

    def test_a_credential_file_problem_is_named_without_suggesting_removal(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            credential.write_text('PLOW_AGENT_TOKEN=agt_fixture_token\n')
            credential.chmod(0o644)
            with patch.object(urllib.request.OpenerDirector, 'open', side_effect=AssertionError('network')), \
                    self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.existing_line(credential, plow_agent.identity)
        self.assertEqual(str(error.exception), f'The existing credential {credential} could not be used: Plow credentials '
                                               'must be an owner-only regular file. Use chmod 600. It was left untouched.')


class ResumeFlagTests(unittest.TestCase):
    def resume(self, **options):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        install = Installation(directory.name)
        install.credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n# plow-agent-uid: ag_2\n')
        install.verified = {'line': line('ln_2', number='+1 (555) 000-0002', name='Birch')}
        return install, install.run(**options)

    def test_new_line_or_another_line_on_a_resume_needs_a_new_folder(self):
        for options in ({'new_line': True}, {'line': 'ln_other'}, {'line': '+1 555 000 9999'}):
            with self.subTest(**options):
                install, code = self.resume(**options)
                self.assertEqual(code, 2)
                self.assertEqual(install.err.getvalue(), 'This folder already runs an agent on Birch +1 (555) 000-0002. '
                                                         'To use another line, install in a new folder.\n')
                self.assertEqual(install.plow_calls(), ['identity'])
                self.assertNotIn('compose up -d --build', install.calls)

    def test_a_line_flag_naming_this_folders_line_continues(self):
        # A bare list position cannot be checked without signing in again, so a rerun of the same command continues.
        for value in ('ln_2', '15550000002', '+1 (555) 000-0002', '2'):
            with self.subTest(line=value):
                install, code = self.resume(line=value)
                self.assertEqual(code, 0)
                self.assertIn('compose up -d --build', install.calls)


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


    def test_the_lock_names_the_installing_process(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'install.lock'
            with plow_agent.installation_lock(path):
                self.assertEqual(path.read_text().strip(), str(os.getpid()))
            self.assertFalse(path.exists())

    def test_a_lock_left_by_a_killed_installer_is_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'install.lock'
            path.write_text('4242\n')
            asked = []
            with contextlib.redirect_stdout(io.StringIO()) as out:
                with plow_agent.installation_lock(path, alive=lambda pid: asked.append(pid) or False):
                    self.assertEqual(path.read_text().strip(), str(os.getpid()))
            self.assertFalse(path.exists())
        self.assertEqual(asked, [4242])
        self.assertEqual(out.getvalue(), 'Removed a stale install lock left by process 4242.\n')

    def test_a_lock_held_by_a_live_process_still_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'install.lock'
            path.write_text('4242\n')
            with self.assertRaises(plow_agent.AgentError) as error:
                with plow_agent.installation_lock(path, alive=lambda pid: True):
                    self.fail('entered a lock that a live process holds')
            self.assertEqual(path.read_text(), '4242\n')
        self.assertEqual(str(error.exception), f'An install is already running. If it was interrupted, delete {path} and retry.')

    def test_an_install_continues_past_a_stale_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            lock = install.root / '.data/agent/install.lock'
            lock.parent.mkdir(parents=True)
            lock.write_text('4242\n')
            with patch.object(plow_agent, 'process_alive', return_value=False):
                self.assertEqual(install.run(), 0)
            self.assertFalse(lock.exists())
        self.assertIn('Removed a stale install lock left by process 4242.', install.out.getvalue())

    @unittest.skipUnless(os.name == 'posix', 'POSIX process ids')
    def test_process_liveness_is_read_without_signalling(self):
        finished = subprocess.Popen([sys.executable, '-c', 'pass'])
        finished.wait()
        self.assertTrue(plow_agent.process_alive(os.getpid()))
        self.assertFalse(plow_agent.process_alive(finished.pid))

    @unittest.skipUnless(os.name == 'posix', 'POSIX signals')
    def test_sigterm_during_an_install_releases_the_lock_and_exits_143(self):
        before = signal.getsignal(signal.SIGTERM)
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            compose = install.compose

            def compose_until_terminated(*arguments, capture=False):
                if arguments[0] == 'up':
                    if not callable(signal.getsignal(signal.SIGTERM)):
                        raise AssertionError('No SIGTERM handler is installed while the install runs.')
                    self.assertTrue((install.root / '.data/agent/install.lock').exists())
                    os.kill(os.getpid(), signal.SIGTERM)
                return compose(*arguments, capture=capture)
            install.compose = compose_until_terminated
            with self.assertRaises(SystemExit) as stopped:
                install.run()
            self.assertFalse((install.root / '.data/agent/install.lock').exists())
        self.assertEqual(stopped.exception.code, 143)
        self.assertEqual(signal.getsignal(signal.SIGTERM), before)
        self.assertNotIn('compose up -d --build', install.calls)


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

    def test_the_log_is_private_to_the_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = RuntimeError('compose failed in an unforeseen way')
            self.assertEqual(install.run(), 1)
            mode = (install.root / '.data/agent/install.log').stat().st_mode & 0o777
        self.assertEqual(mode, 0o600)

    def test_a_log_that_cannot_be_saved_still_ends_in_one_sentence(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            (install.root / '.data').mkdir()
            (install.root / '.data/agent').write_text('a file where the folder should be')
            self.assertEqual(install.run(), 1)
        self.assertEqual(install.err.getvalue(), 'The install stopped unexpectedly and the details could not be saved. '
                                                 'Running ./relay agent again is safe.\n')

    def test_an_unsaved_log_in_another_action_names_that_action(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.data').write_text('a file where the folder should be')
            with patch.object(plow_agent, 'ROOT', root), patch.object(plow_agent, 'CREDENTIAL', root / 'agent/plow-credentials'), \
                    patch.object(plow_agent, 'compose', side_effect=FileNotFoundError('docker')), \
                    patch.dict(os.environ, {'XDG_CONFIG_HOME': str(root / 'config')}), \
                    contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(plow_agent.run_agent(SimpleNamespace(agent_action='stop')), 1)
        self.assertEqual(err.getvalue(), './relay agent stop stopped unexpectedly and the details could not be saved. '
                                         'Running it again is safe.\n')

    def test_an_interruption_keeps_its_message_and_writes_no_log(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = KeyboardInterrupt()
            self.assertEqual(install.run(), 1)
            self.assertFalse((install.root / '.data/agent/install.log').exists())
        self.assertEqual(install.err.getvalue(),
                         'Stopped before finishing. Nothing was left half-created; run it again to continue.\n')


class FakeDocker:
    """Docker's read-only answers for the install guard. Any other command fails the test."""

    CONFIG = ['docker', 'compose', 'config', '--format', 'json']

    def __init__(self, project='agent', containers='', volumes='', services=''):
        self.project = project  # the name `docker compose config` reports, or None when that command fails
        self.containers = containers  # `working_dir<TAB>state` rows for the Compose project
        self.services = services  # `working_dir<TAB>project<TAB>state` rows for every project's agent service
        self.volumes = volumes  # volume names `docker volume ls` reports
        self.commands, self.folders = [], []

    def __call__(self, command, cwd=None, **options):
        self.commands.append(command)
        if command == self.CONFIG:
            self.folders.append(cwd)
            if self.project is None:
                return SimpleNamespace(returncode=1, stdout='')
            return SimpleNamespace(returncode=0, stdout=json.dumps({'name': self.project, 'services': {}}))
        if command[:4] == ['docker', 'ps', '-a', '--filter'] and command[4].startswith('label=com.docker.compose.project='):
            return SimpleNamespace(returncode=0, stdout=self.containers)
        if command[:5] == SERVICES[:5]:
            return SimpleNamespace(returncode=0, stdout=self.services)
        if command[:3] == ['docker', 'volume', 'ls']:
            return SimpleNamespace(returncode=0, stdout=self.volumes)
        raise AssertionError(f'A test tried to run {command}')


SERVICES = ['docker', 'ps', '-a', '--filter', 'label=com.docker.compose.service=agent', '--format',
            '{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "com.docker.compose.project"}}\t{{.State}}']


def listing(name='agent'):
    return ['docker', 'ps', '-a', '--filter', f'label=com.docker.compose.project={name}',
            '--format', '{{.Label "com.docker.compose.project.working_dir"}}\t{{.State}}']


def volume_listing(name='agent'):
    return ['docker', 'volume', 'ls', '--filter', f'name=^{name}_agent-home$', '--format', '{{.Name}}']


OTHER_CREDENTIAL = 'PLOW_AGENT_TOKEN=agt_other\n# plow-agent-uid: ag_other\n'
ALONGSIDE = 'Put a different COMPOSE_PROJECT_NAME in agent/.env to install alongside it.'


class DockerGuardTests(unittest.TestCase):
    """guard_docker() against FakeDocker: which containers, credentials and volumes stop an install."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.agent = self.root / 'here/agent'
        self.agent.mkdir(parents=True)
        self.record = self.root / 'here/.data/agent/install.json'
        self.other = self.root / 'other/agent'
        self.other.mkdir(parents=True)
        (self.other / 'plow-credentials').write_text(OTHER_CREDENTIAL)

    def guard(self, docker, fresh=True, environ=None):
        return plow_agent.guard_docker(fresh, run=docker, folder=self.agent, environ=environ or {}, record=self.record)

    def refused(self, docker, fresh=True, environ=None):
        with self.assertRaises(plow_agent.AgentError) as error:
            self.guard(docker, fresh, environ)
        self.assertEqual(error.exception.code, 1)
        return str(error.exception)

    def test_an_empty_docker_lets_the_install_continue(self):
        docker = FakeDocker()
        self.assertEqual(self.guard(docker), ('agent', False))
        self.assertEqual(docker.commands, [FakeDocker.CONFIG, SERVICES, listing(), volume_listing()])
        self.assertEqual(docker.folders, [self.agent])

    def test_this_folders_own_containers_let_the_install_continue(self):
        alias = self.root / 'alias'
        alias.symlink_to(self.root / 'here', target_is_directory=True)
        for folder, state in ((self.agent, 'running'), (f'{alias}/agent', 'exited'), (f'{self.agent}/', 'running')):
            with self.subTest(folder=folder):
                docker = FakeDocker(containers=f'{folder}\t{state}\n', services=f'{folder}\tagent\t{state}\n')
                self.assertEqual(self.guard(docker), ('agent', False))

    def test_another_folders_agent_is_joined_only_under_a_lasting_project_name(self):
        for state, opening in (('running', f'An agent from {self.other} already runs under'),
                               ('exited', f'A stopped agent from {self.other} exists under')):
            with self.subTest(state=state):
                docker = FakeDocker(containers=f'{self.other}\t{state}\n', services=f'{self.other}\tagent\t{state}\n')
                self.assertEqual(self.refused(docker), f"{opening} the Docker project 'agent'. {ALONGSIDE}")

    def test_a_restarting_or_paused_agent_counts_as_running(self):
        for state in ('restarting', 'paused'):
            with self.subTest(state=state):
                self.assertIn('already runs under', self.refused(FakeDocker(containers=f'{self.other}\t{state}\n')))

    def test_an_agent_whose_credential_cannot_be_checked_is_never_joined(self):
        moved = self.root / 'moved-away/agent'
        for folder, named in ((moved, str(moved)), ('', 'an unknown folder')):
            with self.subTest(folder=folder):
                self.assertEqual(self.refused(FakeDocker(containers=f'{folder}\texited\n')),
                                 f"An agent from {named} already uses the Docker project 'agent' and its credential could "
                                 "not be checked. Confirm it is not this same agent before installing alongside it.")

    def test_this_folders_agent_under_another_project_names_that_project(self):
        for fresh in (True, False):
            with self.subTest(fresh=fresh):
                message = self.refused(FakeDocker(services=f'{self.agent}\trelay-two\texited\n'), fresh)
                self.assertEqual(message, "This folder's agent already runs under the Docker project 'relay-two'. Put "
                                          "COMPOSE_PROJECT_NAME=relay-two in agent/.env so every ./relay agent command uses it.")

    def test_this_folders_agent_under_two_projects_asks_to_keep_one(self):
        docker = FakeDocker(containers=f'{self.agent}\trunning\n',
                            services=f'{self.agent}\tagent\trunning\n{self.agent}\trelay-two\texited\n')
        message = self.refused(docker)
        self.assertIn("This folder's agent exists under more than one Docker project ('agent', 'relay-two').", message)
        self.assertNotIn('COMPOSE_PROJECT_NAME', message)

    def test_the_project_name_comes_from_compose_config(self):
        docker = FakeDocker(project='relay-two', containers=f'{self.other}\trunning\n')
        message = self.refused(docker, environ={'COMPOSE_PROJECT_NAME': 'not-this-one'})
        self.assertIn("under the Docker project 'relay-two'", message)
        self.assertEqual(docker.commands, [FakeDocker.CONFIG, SERVICES, listing('relay-two')])

    def test_without_compose_config_the_name_is_compose_project_name_or_agent(self):
        for environ, name in (({'COMPOSE_PROJECT_NAME': 'relay-three'}, 'relay-three'), ({}, 'agent')):
            with self.subTest(name=name):
                docker = FakeDocker(project=None)
                self.assertEqual(self.guard(docker, environ=environ), (name, False))
                self.assertEqual(docker.commands, [FakeDocker.CONFIG, SERVICES, listing(name), volume_listing(name)])

    def test_a_memory_volume_this_folder_did_not_create_is_refused(self):
        refusal = ("A memory volume for the Docker project 'agent' already exists and this folder did not create it. "
                   "Put a different COMPOSE_PROJECT_NAME in agent/.env to keep this agent's memory separate.")
        self.assertEqual(self.refused(FakeDocker(volumes='agent_agent-home\n')), refusal)
        self.record.parent.mkdir(parents=True)
        for saved in ({'project': 'relay-two', 'agent_dir': str(self.agent.resolve())},
                      {'project': 'agent', 'agent_dir': str(self.other.resolve())}, ['not', 'a', 'record']):
            with self.subTest(saved=saved):
                self.record.write_text(json.dumps(saved))
                self.assertEqual(self.refused(FakeDocker(volumes='agent_agent-home\n')), refusal)

    def test_this_folders_own_earlier_memory_volume_is_reused(self):
        self.record.parent.mkdir(parents=True)
        self.record.write_text(json.dumps({'project': 'agent', 'agent_dir': str(self.agent.resolve())}))
        self.assertEqual(self.guard(FakeDocker(volumes='agent_agent-home\n')), ('agent', True))

    def test_a_resume_keeps_its_own_memory_volume_without_asking(self):
        docker = FakeDocker(volumes='agent_agent-home\n')
        self.assertEqual(self.guard(docker, fresh=False), ('agent', False))
        self.assertEqual(docker.commands, [FakeDocker.CONFIG, SERVICES, listing()])

    def test_a_failed_docker_listing_stops_instead_of_assuming_nothing_is_there(self):
        docker = FakeDocker()

        def failing(command, cwd=None):
            return docker(command, cwd) if command == FakeDocker.CONFIG else SimpleNamespace(returncode=1, stdout='')
        self.assertIn('Docker did not list its containers', self.refused(failing))


class InstallGuardTests(unittest.TestCase):
    def other_folder(self, install):
        other = install.root / 'other/agent'
        other.mkdir(parents=True)
        (other / 'plow-credentials').write_text(OTHER_CREDENTIAL)
        return other

    def test_install_checks_before_signing_in_or_starting_anything(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            other = self.other_folder(install)
            install.docker.containers = f'{other}\trunning\n'
            self.assertEqual(install.run(), 1)
            self.assertFalse(install.credential.exists())
        self.assertEqual(install.docker.commands, [FakeDocker.CONFIG, SERVICES, listing()])
        self.assertEqual(install.calls, [])
        self.assertEqual(install.err.getvalue(), f"An agent from {other} already runs under the Docker project 'agent'. {ALONGSIDE}\n")

    def test_install_checks_again_immediately_before_starting_the_agent(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            other = self.other_folder(install)
            sign_in = install.login

            def login_while_another_agent_appears(args):
                sign_in(args)
                install.docker.containers = f'{other}\texited\n'
            install.login = login_while_another_agent_appears
            self.assertEqual(install.run(), 1)
        self.assertEqual(install.docker.commands, [FakeDocker.CONFIG, SERVICES, listing(), volume_listing(),
                                                   FakeDocker.CONFIG, SERVICES, listing()])
        self.assertNotIn('compose up -d --build', install.calls)
        self.assertIn(f'A stopped agent from {other} exists', install.err.getvalue())

    def test_a_started_agent_records_its_project_and_folder_privately(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.docker.project = 'relay-two'
            self.assertEqual(install.run(), 0)
            record = install.root / '.data/agent/install.json'
            saved, mode = json.loads(record.read_text()), record.stat().st_mode & 0o777
        self.assertEqual(saved, {'project': 'relay-two', 'agent_dir': str(install.agent.resolve())})
        self.assertEqual(mode, 0o600)

    def test_an_agent_docker_could_not_start_records_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = SimpleNamespace(returncode=1)
            self.assertEqual(install.run(), 1)
            self.assertFalse((install.root / '.data/agent/install.json').exists())

    def test_reinstalling_after_a_revoke_reuses_this_folders_memory(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            self.assertEqual(install.run(), 0)
            install.credential.unlink()  # plow-agents revoke removes the credential; the container and volume remain
            install.docker.containers = f'{install.agent}\texited\n'
            install.docker.services = f'{install.agent}\tagent\texited\n'
            install.docker.volumes = 'agent_agent-home\n'
            install.out = io.StringIO()
            self.assertEqual(install.run(), 0)
            self.assertTrue(install.credential.exists())
        self.assertIn("Memory ............ reused from this folder's earlier install", install.out.getvalue())
        self.assertEqual(install.calls.count('mint'), 2)

    def test_a_copied_folder_never_attaches_the_originals_memory(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            original = Installation(first)
            self.assertEqual(original.run(), 0)
            copy = Installation(second)
            (copy.root / '.data/agent').mkdir(parents=True)
            (copy.root / '.data/agent/install.json').write_bytes((original.root / '.data/agent/install.json').read_bytes())
            copy.docker.volumes = 'agent_agent-home\n'
            self.assertEqual(copy.run(), 1)
        self.assertEqual(copy.calls, [])
        self.assertEqual(copy.err.getvalue(), "A memory volume for the Docker project 'agent' already exists and this folder "
                                              "did not create it. Put a different COMPOSE_PROJECT_NAME in agent/.env to keep "
                                              "this agent's memory separate.\n")

    def test_this_folders_agent_under_another_project_stops_install_and_resume(self):
        for resuming in (False, True):
            with self.subTest(resuming=resuming), tempfile.TemporaryDirectory() as directory:
                install = Installation(directory)
                if resuming:
                    install.credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n# plow-agent-uid: ag_1\n')
                install.docker.services = f'{install.agent}\trelay-two\trunning\n'
                self.assertEqual(install.run(), 1)
                self.assertEqual(install.calls, [])
                self.assertEqual(install.err.getvalue(), "This folder's agent already runs under the Docker project "
                                                         "'relay-two'. Put COMPOSE_PROJECT_NAME=relay-two in agent/.env so "
                                                         "every ./relay agent command uses it.\n")


class CopiedCredentialTests(unittest.TestCase):
    CREDENTIAL = 'PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=agt_copied_secret\n# plow-agent-uid: ag_shared\n'

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.agent = self.root / 'copy/agent'
        self.agent.mkdir(parents=True)
        (self.agent / 'plow-credentials').write_text(self.CREDENTIAL)
        self.other = self.root / 'original/agent'
        self.other.mkdir(parents=True)

    def resume(self, docker):
        return plow_agent.guard_docker(False, run=docker, folder=self.agent, environ={}, record=self.root / 'install.json')

    def test_a_credential_another_folder_already_runs_stops_the_resume(self):
        (self.other / 'plow-credentials').write_text(self.CREDENTIAL)
        docker = FakeDocker(services=f'{self.other}\trelay-two\texited\n')
        with self.assertRaises(plow_agent.AgentError) as error:
            self.resume(docker)
        self.assertEqual(error.exception.code, 1)
        self.assertEqual(str(error.exception), f'This credential already belongs to the agent in {self.other}. One credential '
                                               f'runs in one place: remove that agent with docker compose down in {self.other}, '
                                               'or delete agent/plow-credentials here so ./relay agent mints this folder its own.')
        self.assertEqual(docker.commands, [FakeDocker.CONFIG, SERVICES])

    def test_other_credentials_unreadable_ones_and_this_folder_are_ignored(self):
        (self.other / 'plow-credentials').write_text('PLOW_AGENT_TOKEN=agt_other\n# plow-agent-uid: ag_other\n')
        (self.root / 'folder/agent/plow-credentials').mkdir(parents=True)
        rows = (f'{self.other}\tagent-one\trunning\n{self.root}/gone/agent\tagent-two\texited\n'
                f'{self.root}/folder/agent\tagent-three\trunning\n\tagent-four\trunning\n{self.agent}\tagent\trunning\n')
        docker = FakeDocker(services=rows)
        self.assertEqual(self.resume(docker), ('agent', False))
        self.assertEqual(docker.commands, [FakeDocker.CONFIG, SERVICES, listing()])

    def test_only_the_uid_is_taken_from_a_credential(self):
        self.assertEqual(plow_agent.agent_uid(self.agent / 'plow-credentials'), 'ag_shared')
        self.assertIsNone(plow_agent.agent_uid(self.root / 'missing'))

    def test_resuming_a_copied_folder_names_the_original_and_not_compose_project_name(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.credential.write_text(self.CREDENTIAL)
            (self.other / 'plow-credentials').write_text(self.CREDENTIAL)
            install.docker.containers = f'{self.other}\trunning\n'
            install.docker.services = f'{self.other}\tagent\trunning\n'
            self.assertEqual(install.run(), 1)
        self.assertEqual(install.calls, [])
        self.assertIn(f'This credential already belongs to the agent in {self.other}.', install.err.getvalue())
        self.assertNotIn('COMPOSE_PROJECT_NAME', install.err.getvalue())

    def test_resuming_checks_the_credential_again_immediately_before_starting(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.credential.write_text(self.CREDENTIAL)
            (self.other / 'plow-credentials').write_text(self.CREDENTIAL)
            verify = install.identity

            def identity_while_the_copy_starts(path):
                install.docker.services = f'{self.other}\tagent\trunning\n'
                return verify(path)
            install.identity = identity_while_the_copy_starts
            self.assertEqual(install.run(), 1)
        self.assertEqual(install.docker.commands.count(SERVICES), 2)
        self.assertNotIn('compose up -d --build', install.calls)
        self.assertIn(f'This credential already belongs to the agent in {self.other}.', install.err.getvalue())


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

    def marker(self, install):
        return install.root / '.data/agent/signin-created.sha256'

    def test_a_sign_in_this_install_created_is_removed_after_it_succeeds(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            self.assertEqual(install.run(), 0)
            self.assertIn('login', install.calls)
            self.assertFalse(install.signin.exists())
            self.assertFalse(self.marker(install).exists())
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
            self.assertTrue(self.marker(install).exists())
        self.assertNotIn('Sign-in .....', install.out.getvalue())

    def test_a_sign_in_is_kept_when_the_agent_never_reports_ready(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.logs = 'plow-init: credential rejected -- parking; no gateway will start\n'
            self.assertEqual(install.run(), 1)
            self.assertIn('login', install.calls)
            self.assertTrue(install.signin.exists())
            self.assertTrue(self.marker(install).exists())
        self.assertIn('parking; no gateway will start', install.err.getvalue())
        self.assertNotIn('Sign-in .....', install.out.getvalue())

    def test_a_sign_in_is_kept_when_hermes_does_not_answer(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.reply = plow_agent.AgentError('The agent is running but did not answer.')
            self.assertEqual(install.run(), 1)
            self.assertIn('login', install.calls)
            self.assertTrue(install.signin.exists())
            self.assertTrue(self.marker(install).exists())
        self.assertIn('did not answer', install.err.getvalue())
        self.assertNotIn('Sign-in .....', install.out.getvalue())

    def test_login_records_only_a_private_digest_of_the_sign_in(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.lines = [line('ln_a'), line('ln_b')]
            self.assertEqual(install.run(), 2)
            marker = self.marker(install)
            recorded, mode = marker.read_text(), marker.stat().st_mode & 0o777
            expected = hashlib.sha256(install.signin.read_bytes()).hexdigest()
        self.assertEqual(recorded.strip(), expected)
        self.assertEqual(mode, 0o600)
        self.assertNotIn('acct_fixture_token', recorded)

    def test_a_sign_in_written_before_login_fails_is_removed_by_a_later_success(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            sign_in = install.login

            def login_that_fails_after_writing(args):
                sign_in(args)
                raise SystemExit('plow-agents: cannot reach https://api.plow.co/v1/chats: timed out')
            install.login = login_that_fails_after_writing
            with self.assertRaises(SystemExit):
                install.run()
            self.assertTrue(install.signin.exists())
            self.assertTrue(self.marker(install).exists())
            install.login, install.out = sign_in, io.StringIO()
            self.assertEqual(install.run(), 0)
            self.assertFalse(install.signin.exists())
            self.assertFalse(self.marker(install).exists())
        self.assertIn(self.REMOVED, install.out.getvalue())

    def test_a_login_that_fails_before_writing_leaves_no_marker(self):
        for existing in (None, 'acct_owner_token\n'):
            with self.subTest(existing=existing), tempfile.TemporaryDirectory() as directory:
                install = Installation(directory)
                if existing:
                    install.signin.parent.mkdir(parents=True)
                    install.signin.write_text(existing)

                def login_that_fails_at_once(args):
                    raise SystemExit('plow-agents: activation returned no code, secret or number')
                install.login = login_that_fails_at_once
                with self.assertRaises(SystemExit):
                    install.run(new_line=True)
                self.assertFalse(self.marker(install).exists())

    def test_a_marker_that_is_not_a_digest_is_dropped_without_touching_the_sign_in(self):
        cases = [b'\xff\xfe\x00 not utf-8', b'not a digest\n', b'0' * 63 + b'\n', b'g' * 64 + b'\n']
        if os.geteuid() != 0:
            cases.append(None)  # a marker its owner cannot read
        for content in cases:
            with self.subTest(content=content), tempfile.TemporaryDirectory() as directory:
                install = Installation(directory)
                install.credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n')
                install.signin.parent.mkdir(parents=True)
                install.signin.write_text('acct_owner_token\n')
                marker = self.marker(install)
                marker.parent.mkdir(parents=True)
                marker.write_bytes(b'0' * 64 if content is None else content)
                if content is None:
                    marker.chmod(0)
                self.assertEqual(install.run(), 0)
                self.assertEqual(install.signin.read_text(), 'acct_owner_token\n')
                self.assertFalse(marker.exists())
                self.assertNotIn('Sign-in .....', install.out.getvalue())

    REPLACED = ('Sign-in ........... removed from this Mac; it replaced an earlier sign-in, so run plow-agents login again '
                'if you still need one')

    def test_removing_a_sign_in_that_replaced_an_earlier_one_says_so(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.signin.parent.mkdir(parents=True)
            install.signin.write_text('acct_earlier_token\n')
            self.assertEqual(install.run(new_line=True), 0)
            self.assertIn('login', install.calls)
            self.assertFalse(install.signin.exists())
            left = sorted(entry.name for entry in (install.root / '.data/agent').iterdir())
        self.assertIn(self.REPLACED, install.out.getvalue())
        self.assertNotIn(self.REMOVED, install.out.getvalue())
        self.assertEqual(left, ['install.json'])

    def test_a_replacement_is_still_named_when_a_later_run_removes_it(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.signin.parent.mkdir(parents=True)
            install.signin.write_text('acct_earlier_token\n')
            install.lines = [line('ln_a'), line('ln_b')]
            self.assertEqual(install.run(new_line=True), 2)
            install.out = io.StringIO()
            self.assertEqual(install.run(line='1'), 0)
            self.assertFalse(install.signin.exists())
        self.assertIn(self.REPLACED, install.out.getvalue())

    def test_a_rerun_after_choosing_a_line_removes_the_sign_in_the_first_run_created(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.lines = [line('ln_a'), line('ln_b')]
            self.assertEqual(install.run(), 2)
            install.out = io.StringIO()
            self.assertEqual(install.run(line='1'), 0)
            self.assertFalse(install.signin.exists())
            self.assertFalse(self.marker(install).exists())
        self.assertEqual(install.calls.count('login'), 1)
        self.assertIn(self.REMOVED, install.out.getvalue())

    def test_a_rerun_after_a_stalled_download_removes_the_sign_in(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = subprocess.TimeoutExpired(['docker', 'compose', 'up', '-d', '--build'], 1800)
            self.assertEqual(install.run(), 1)
            self.assertTrue(install.signin.exists() and self.marker(install).exists())
            install.up, install.out = SimpleNamespace(returncode=0), io.StringIO()
            self.assertEqual(install.run(), 0)
            self.assertFalse(install.signin.exists())
            self.assertFalse(self.marker(install).exists())
        self.assertIn('Credential ........ reused', install.out.getvalue())
        self.assertIn(self.REMOVED, install.out.getvalue())

    def test_a_sign_in_replaced_after_the_marker_is_kept(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = SimpleNamespace(returncode=1)
            self.assertEqual(install.run(), 1)
            install.signin.write_text('acct_signed_in_again\n')
            install.up, install.out = SimpleNamespace(returncode=0), io.StringIO()
            self.assertEqual(install.run(), 0)
            self.assertEqual(install.signin.read_text(), 'acct_signed_in_again\n')
            self.assertFalse(self.marker(install).exists())
        self.assertIn(self.KEPT, install.out.getvalue())
        self.assertNotIn(self.REMOVED, install.out.getvalue())

    def test_a_sign_in_written_by_another_process_without_a_marker_is_never_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.signin.parent.mkdir(parents=True)
            install.signin.write_text('acct_from_another_process\n')
            self.assertEqual(install.run(), 0)
            self.assertIn(self.KEPT, install.out.getvalue())
            install.out = io.StringIO()
            self.assertEqual(install.run(), 0)
            self.assertEqual(install.signin.read_text(), 'acct_from_another_process\n')
        self.assertIn('Credential ........ reused', install.out.getvalue())
        self.assertNotIn('Sign-in .....', install.out.getvalue())

    def test_a_marker_without_a_sign_in_is_removed_silently(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n')
            marker = self.marker(install)
            marker.parent.mkdir(parents=True)
            marker.write_text('0' * 64 + '\n')
            self.assertEqual(install.run(), 0)
            self.assertFalse(marker.exists())
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
