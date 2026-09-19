"""Unit tests for the one-command Plow agent install. No Plow, Docker or model calls.

The contract tests load the real pinned plow-agents client, downloading and verifying it
from GitHub only when .data/tools/plow-agents is absent.
"""
import contextlib
import difflib
import fnmatch
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
import time
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.parse
import urllib.request

import cli
from fake_windows import (FakeWindows, asked_for_exact_bytes, client_write, held_by_another_process,
                          pinned_client_double, symlinks_available, text_opens, windows_host)
import plow_agent
import private_files

# How this host types the repository command. The installer renders it per platform, so a
# test that spelled one of them would pass on its author's machine and fail on the others.
RELAY = private_files.relay_command()


def denial_is_enforced():
    """Whether a file its owner denied themselves really cannot be read here.

    Not as root, and not on Windows, where the mode bits do not decide access at all.
    """
    with tempfile.TemporaryDirectory() as directory:
        probe = Path(directory) / 'probe'
        probe.write_bytes(b'x')
        probe.chmod(0)
        try:
            probe.read_bytes()
            return False
        except OSError:
            return True
        finally:
            probe.chmod(0o600)


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
            private, text = private_files.is_private(credential), credential.read_text()
        self.assertTrue(private)
        self.assertIn('PLOW_API_BASE=https://api.plow.co\n', text)
        self.assertIn('PLOW_AGENT_TOKEN=agt_fixture_token\n', text)
        self.assertIn('# plow-agent-uid: ag_new', text)
        self.assertIn(('POST', '/v1/agents'), plow.sent)
        self.assertNotIn('DELETE', [method for method, _ in plow.sent])

    def test_sign_in_is_found_where_the_client_itself_keeps_it(self):
        client = plow_agent.official()
        for config in ('/fixture/config', '', None):
            with self.subTest(XDG_CONFIG_HOME=config), patch.dict(
                    os.environ, {'HOME': '/fixture/home', 'USERPROFILE': '/fixture/home'}):
                os.environ.pop('XDG_CONFIG_HOME', None)
                if config is not None:
                    os.environ['XDG_CONFIG_HOME'] = config
                self.assertEqual(plow_agent.signin_path(), Path(client['token_path'](None)))

    def test_sign_in_is_found_where_the_client_keeps_it_on_windows_too(self):
        # Both read XDG_CONFIG_HOME and then os.path.expanduser('~'), which Windows answers
        # from USERPROFILE, so the installer removes the sign in the client actually wrote.
        client = plow_agent.official()
        with windows_host(), patch.dict(os.environ, {'HOME': '/fixture/home', 'USERPROFILE': '/fixture/home'}):
            for config in ('/fixture/config', '', None):
                with self.subTest(XDG_CONFIG_HOME=config):
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
        # Whatever host this runs on, the installer makes files private; on Windows that is an
        # icacls call, and this harness owns subprocess.run. A Windows test replaces this fake
        # with its own; here it answers as the account this host actually signs in as.
        self.windows = FakeWindows(user=private_files.account_name())
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

    def compose(self, *arguments, capture=False, input=None):
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
        if command and command[0] == 'icacls':
            return self.windows.run(command, **options)
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
        self.assertIn(f'{RELAY} agent --line <position>', install.err.getvalue())

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

    @unittest.skipUnless(os.name == 'posix', 'opening a file to other accounts with a mode')
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
        self.assertIn(private_files.how_to_protect(credential), str(error.exception))
        for local in (error.exception, missing.exception):
            self.assertNotIsInstance(local, plow_agent.PlowUnreachable)


class CredentialVerificationTests(unittest.TestCase):
    """existing_line() with the real identity() and bridge; only the HTTP opener is faked."""
    UNREACHABLE = ('Could not verify the existing credential with Plow right now. It was left untouched; '
                   f'run {RELAY} agent again later.')

    def verify(self, **opener):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            credential.write_text('PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=agt_fixture_token\n')
            private_files.protect(credential)  # however this host does that
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
                                                 f'the file yourself first, then run {RELAY} agent again.'), message)
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
                                 f'provides them. It was left untouched; run {RELAY} agent again once that is fixed.')

    @unittest.skipUnless(os.name == 'posix', 'opening a file to other accounts with a mode')
    def test_a_credential_file_problem_is_named_without_suggesting_removal(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            credential.write_text('PLOW_AGENT_TOKEN=agt_fixture_token\n')
            credential.chmod(0o644)
            with patch.object(urllib.request.OpenerDirector, 'open', side_effect=AssertionError('network')), \
                    self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.existing_line(credential, plow_agent.identity)
        self.assertEqual(str(error.exception), f'The existing credential {credential} could not be used: Plow credentials '
                                               'must be a regular file only you can read. Run '
                                               f'{private_files.how_to_protect(credential)} and try again. '
                                               'It was left untouched.')


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
        self.assertIn(f'{RELAY} agent --line <position>', str(error.exception))

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
            self.assertIn(f'{RELAY} agent --new-line', str(error.exception))

    def test_end_of_input_while_asking_is_a_decision_not_an_eoferror(self):
        with patch('builtins.input', side_effect=EOFError), contextlib.redirect_stdout(io.StringIO()), \
                self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.ask_for_line([line('ln_a', name='Alder'), line('ln_b', name='Birch')])
        self.assertIn(f'{RELAY} agent --line <position>', str(error.exception))


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
        self.assertEqual(install.err.getvalue(), f'The first download is still running or stalled. Run {RELAY} agent again '
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
        sentence = f'The install stopped unexpectedly. Details: {log}. Running {RELAY} agent again is safe.'
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
        self.assertEqual(err.getvalue(), f'{RELAY} agent status stopped unexpectedly. Details: {log}. Running it again is safe.\n')

    def test_the_log_is_private_to_the_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.up = RuntimeError('compose failed in an unforeseen way')
            self.assertEqual(install.run(), 1)
            # Through whatever this host used to make it private, which on Windows is the
            # icacls this harness answered rather than the real one.
            with patch.object(subprocess, 'run', install.subprocess_run):
                self.assertTrue(private_files.is_private(install.root / '.data/agent/install.log'))

    def test_a_log_that_cannot_be_made_private_is_not_left_behind(self):
        # The one caller that used to catch a privacy failure and carry on. It wrote the
        # traceback, failed to protect it, told the owner nothing had been saved, and left the
        # file there, so the owner had no reason to go and remove it.
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n')
            install.up = RuntimeError('compose failed in an unforeseen way')
            with patch.object(private_files, 'protect',
                              side_effect=private_files.PrivacyError('a drive that cannot keep one account apart')):
                self.assertEqual(install.run(), 1)
            self.assertFalse((install.root / '.data/agent/install.log').exists())
        self.assertIn('the details could not be saved', install.err.getvalue())

    def test_the_log_is_made_private_before_the_traceback_reaches_it(self):
        # The order the two happen in, not the size on disk: a write sits in the buffer until
        # the file closes, so the file can be empty on disk while the traceback is already
        # handed over. What matters is that nothing is handed over before it is locked down.
        order = []
        real_protect, real_fdopen = private_files.protect, plow_agent.os.fdopen

        class Recording:
            def __init__(self, handle):
                self.handle = handle

            def write(self, text):
                order.append('write')
                return self.handle.write(text)

            def __enter__(self):
                self.handle.__enter__()
                return self

            def __exit__(self, *details):
                return self.handle.__exit__(*details)

        def protect(path, executable=False):
            order.append('protect')
            return real_protect(path, executable=executable)

        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n')
            install.up = RuntimeError('compose failed in an unforeseen way')
            with patch.object(private_files, 'protect', protect), \
                    patch.object(plow_agent.os, 'fdopen',
                                 lambda *arguments, **options: Recording(real_fdopen(*arguments, **options))):
                self.assertEqual(install.run(), 1)
            self.assertIn('RuntimeError', (install.root / '.data/agent/install.log').read_text())
        self.assertEqual(order, ['protect', 'write'])

    def test_a_log_that_cannot_be_saved_still_ends_in_one_sentence(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            (install.root / '.data').mkdir()
            (install.root / '.data/agent').write_text('a file where the folder should be')
            self.assertEqual(install.run(), 1)
        self.assertEqual(install.err.getvalue(), 'The install stopped unexpectedly and the details could not be saved. '
                                                 f'Running {RELAY} agent again is safe.\n')

    def test_an_unsaved_log_in_another_action_names_that_action(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.data').write_text('a file where the folder should be')
            with patch.object(plow_agent, 'ROOT', root), patch.object(plow_agent, 'CREDENTIAL', root / 'agent/plow-credentials'), \
                    patch.object(plow_agent, 'compose', side_effect=FileNotFoundError('docker')), \
                    patch.dict(os.environ, {'XDG_CONFIG_HOME': str(root / 'config')}), \
                    contextlib.redirect_stderr(io.StringIO()) as err:
                self.assertEqual(plow_agent.run_agent(SimpleNamespace(agent_action='stop')), 1)
        self.assertEqual(err.getvalue(), f'{RELAY} agent stop stopped unexpectedly and the details could not be saved. '
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

    @unittest.skipUnless(symlinks_available(), 'creating a link needs SeCreateSymbolicLinkPrivilege here')
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
                                          f"COMPOSE_PROJECT_NAME=relay-two in agent/.env so every {RELAY} agent command uses it.")

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

    def test_a_started_agent_records_the_project_folder_and_computer_it_ran_on(self):
        # The platform is whatever this host is, so the expectation follows the host rather
        # than naming one. All three are covered, because recording the wrong one silently is
        # the whole failure this key exists to prevent.
        # host_platform() rather than sys.platform: faking the platform would also fake the
        # mechanism that makes the record private, which is a different question and is asked
        # by its own test below.
        for expected in ('macos', 'linux', 'windows'):
            with self.subTest(platform=expected), tempfile.TemporaryDirectory() as directory:
                install = Installation(directory)
                install.docker.project = 'relay-two'
                with patch.object(plow_agent, 'host_platform', lambda: expected):
                    self.assertEqual(install.run(), 0)
                saved = json.loads((install.root / '.data/agent/install.json').read_text())
                self.assertEqual(saved, {'project': 'relay-two', 'agent_dir': str(install.agent.resolve()),
                                         'platform': expected})

    def test_every_file_the_install_writes_asks_for_the_bytes_it_was_given(self):
        # The install record, the sign in marker and the credential the client writes. Windows
        # would turn each newline into two without this, and the marker is compared by digest.
        recorded = []
        with tempfile.TemporaryDirectory() as directory, text_opens(recorded):
            install = Installation(directory)
            self.assertEqual(install.run(), 0)  # all the way through, so the record is written too
        self.assertTrue(asked_for_exact_bytes(recorded), recorded)

    def test_the_install_log_asks_for_the_bytes_it_was_given_too(self):
        recorded = []
        with tempfile.TemporaryDirectory() as directory, text_opens(recorded):
            install = Installation(directory)
            install.credential.write_text('PLOW_AGENT_TOKEN=agt_existing\n')
            install.up = RuntimeError('compose failed in an unforeseen way')
            self.assertEqual(install.run(), 1)
        self.assertTrue(asked_for_exact_bytes(recorded), recorded)

    def test_a_started_agent_records_that_privately(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            self.assertEqual(install.run(), 0)
            # Through whatever this host used to make it private, which on Windows is the
            # icacls this harness answered.
            with patch.object(subprocess, 'run', install.subprocess_run):
                self.assertTrue(private_files.is_private(install.root / '.data/agent/install.json'))

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
                                                         f"every {RELAY} agent command uses it.\n")


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
                                               f'or delete agent/plow-credentials here so {RELAY} agent mints this folder its own.')
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
    REMOVED = 'Sign-in ........... removed from this computer; the agent keeps its own credential'
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
            with patch.object(subprocess, 'run', install.subprocess_run):
                recorded, private = marker.read_text(), private_files.is_private(marker)
            expected = hashlib.sha256(install.signin.read_bytes()).hexdigest()
        self.assertEqual(recorded.strip(), expected)
        self.assertTrue(private)
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
        if denial_is_enforced():
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

    REPLACED = ('Sign-in ........... removed from this computer; it replaced an earlier sign-in, so run '
                'plow-agents login again if you still need one')

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
        # USERPROFILE as well as HOME: each host reads only its own, and both name the same folder.
        with patch.dict(os.environ, {'XDG_CONFIG_HOME': '/fixture/config', 'HOME': '/fixture/home',
                                     'USERPROFILE': '/fixture/home'}):
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


try:
    plow_agent.yaml_module()
    HAVE_YAML = True
except plow_agent.AgentError:
    HAVE_YAML = False

# The real shape: providers.<provider>.models is a mapping of id -> per-model settings, not a list.
SAMPLE_MODEL_CONFIG = '''model:
  default: anthropic/claude-sonnet-5
  provider: plow
  base_url: ${PLOW_API_BASE}/v1
  key_env: HERMES_CUSTOM_PLOW_API_KEY
providers:
  plow:
    models:
      anthropic/claude-sonnet-5:
        prompt_caching: true
      anthropic/claude-haiku-4: {}
'''

# The live config, verbatim from the running container before the provider switch was done by hand on
# 2026-09-18: the model block carries the base_url and key_env that only Plow uses, and the plow provider
# block carries its own name, base_url, key_env and stale timeout beside its models. Nothing here is
# idealized; a fixture that dropped those keys would let a switch that cannot handle them pass.
LIVE_MODEL_CONFIG = '''model:
  default: anthropic/claude-sonnet-5
  provider: plow
  base_url: ${PLOW_API_BASE}/v1
  key_env: HERMES_CUSTOM_PLOW_API_KEY
providers:
  plow:
    name: plow
    base_url: https://api.plow.co/v1
    key_env: HERMES_CUSTOM_PLOW_API_KEY
    stale_timeout_seconds: 55
    models:
      anthropic/claude-sonnet-5:
        prompt_caching: true
'''

# What was added by hand to make the agent answer on Kimi with no Plow credits at all.
KIMI_BLOCK = {'name': 'kimi', 'base_url': 'https://api.moonshot.ai/v1', 'key_env': 'MOONSHOT_API_KEY',
              'models': {'kimi-k2.7-code': {}}}

# Exercises what a minimal text edit must leave untouched: a comment, a folded block with non-ASCII text,
# `enabled: yes` and `version: 1.10` (both of which yaml.safe_dump would silently renormalise), and an
# anchor with a merge key -- all outside the two lines a switch actually edits.
EXOTIC_MODEL_CONFIG = '''# Hermes runtime configuration
model:
  default: anthropic/claude-sonnet-5
  provider: plow
  base_url: ${PLOW_API_BASE}/v1
  key_env: HERMES_CUSTOM_PLOW_API_KEY
providers:
  plow:
    models:
      anthropic/claude-sonnet-5:
        prompt_caching: true
      anthropic/claude-haiku-4: {}
notes: >
  Support contact: José Núñez <jose@example.com>.
  日本語のメモもあります。
enabled: yes
version: 1.10
shared: &shared_defaults
  timeout_seconds: 30
fallback:
  <<: *shared_defaults
  name: plow
'''


def _safe_load(text):
    return plow_agent.yaml_module().safe_load(text)


@unittest.skipUnless(HAVE_YAML, 'PyYAML is not installed')
class ModelEditTests(unittest.TestCase):
    """model_summary() and set_default_model(): pure functions over the config's raw YAML text."""

    def test_reads_the_default_provider_and_known_models(self):
        self.assertEqual(plow_agent.model_summary(SAMPLE_MODEL_CONFIG),
                         {'default': 'anthropic/claude-sonnet-5', 'provider': 'plow',
                          'models': ['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4']})

    def test_switching_to_a_known_id_does_not_duplicate_it(self):
        new_text = plow_agent.set_default_model(SAMPLE_MODEL_CONFIG, 'anthropic/claude-haiku-4')
        summary = plow_agent.model_summary(new_text)
        self.assertEqual(summary['default'], 'anthropic/claude-haiku-4')
        self.assertEqual(summary['models'], ['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4'])

    def test_switching_keeps_every_existing_per_model_setting(self):
        new_text = plow_agent.set_default_model(SAMPLE_MODEL_CONFIG, 'anthropic/claude-haiku-4')
        parsed = _safe_load(new_text)
        self.assertEqual(parsed['providers']['plow']['models']['anthropic/claude-sonnet-5'],
                         {'prompt_caching': True})

    def test_switching_to_a_new_id_adds_it_as_a_key_with_an_empty_body(self):
        new_text = plow_agent.set_default_model(SAMPLE_MODEL_CONFIG, 'anthropic/claude-opus-4')
        summary = plow_agent.model_summary(new_text)
        self.assertEqual(summary['default'], 'anthropic/claude-opus-4')
        self.assertEqual(summary['models'],
                         ['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4', 'anthropic/claude-opus-4'])
        self.assertEqual(_safe_load(new_text)['providers']['plow']['models']['anthropic/claude-opus-4'], {})

    def test_a_list_shaped_models_is_still_accepted(self):
        text = ('model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\n'
                'providers:\n  plow:\n    models:\n      - anthropic/claude-sonnet-5\n')
        new_text = plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(plow_agent.model_summary(new_text)['models'],
                         ['anthropic/claude-sonnet-5', 'anthropic/claude-opus-4'])
        self.assertIsInstance(_safe_load(new_text)['providers']['plow']['models'], list)

    def test_a_missing_models_key_is_created_as_a_mapping(self):
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\nproviders:\n  plow:\n    other: true\n'
        new_text = plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(plow_agent.model_summary(new_text),
                         {'default': 'anthropic/claude-opus-4', 'provider': 'plow', 'models': ['anthropic/claude-opus-4']})
        parsed = _safe_load(new_text)
        self.assertEqual(parsed['providers']['plow']['other'], True)
        self.assertEqual(parsed['providers']['plow']['models'], {'anthropic/claude-opus-4': {}})

    def test_a_missing_provider_is_created_as_a_mapping(self):
        text = ('model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\n'
                'providers:\n  other:\n    models:\n      x: {}\n')
        new_text = plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(plow_agent.model_summary(new_text)['models'], ['anthropic/claude-opus-4'])
        parsed = _safe_load(new_text)
        self.assertEqual(parsed['providers']['other']['models'], {'x': {}})
        self.assertEqual(parsed['providers']['plow']['models'], {'anthropic/claude-opus-4': {}})

    def test_a_missing_providers_block_is_created(self):
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\n'
        new_text = plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(plow_agent.model_summary(new_text)['models'], ['anthropic/claude-opus-4'])

    def test_a_flow_style_provider_is_refused_not_silently_reshaped(self):
        # providers:\n  plow: {}\n succeeded under the old yaml.safe_dump-based edit, which just re-serialized
        # the whole file in block style regardless of how it started. The minimal text edit cannot safely
        # insert a new line under a one-line flow scalar (it produced YAML that would not parse), so this now
        # refuses by name up front instead. This narrows what the old dump-based version accepted; refusing
        # clearly beats corrupting, and the live config is block style throughout.
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\nproviders:\n  plow: {}\n'
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('flow style', str(error.exception))
        self.assertIn('providers.plow', str(error.exception))
        self.assertIn('Nothing was changed', str(error.exception))
        self.assertIn('then run this again', str(error.exception))  # names a remedy, not just the problem

    def test_a_flow_style_models_mapping_is_refused(self):
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\nproviders:\n  plow:\n    models: {}\n'
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('flow style', str(error.exception))
        self.assertIn('providers.plow.models', str(error.exception))
        self.assertIn('then run this again', str(error.exception))

    def test_a_flow_style_models_list_is_refused(self):
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\nproviders:\n  plow:\n    models: []\n'
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('flow style', str(error.exception))
        self.assertIn('providers.plow.models', str(error.exception))
        self.assertIn('then run this again', str(error.exception))

    def test_a_flow_style_providers_block_is_refused(self):
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\nproviders: {}\n'
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('flow style', str(error.exception))
        self.assertIn('then run this again', str(error.exception))

    def test_a_null_provider_body_is_refused_not_crashed(self):
        # providers:\n  plow:\n (a present key with an explicit null value, not a missing one) made
        # _expected_after_edit's providers.setdefault(...).setdefault(...) crash with AttributeError,
        # since setdefault only fills in an *absent* key, not one already present-but-None -- surfacing to
        # the owner as "stopped unexpectedly", not a refusal naming what is wrong.
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\nproviders:\n  plow:\n'
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('providers.plow', str(error.exception))
        self.assertIn('empty', str(error.exception))
        self.assertIn('Nothing was changed', str(error.exception))
        self.assertIn('then run this again', str(error.exception))

    def test_a_null_providers_block_is_refused_not_crashed(self):
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\nproviders:\n'
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('providers', str(error.exception))
        self.assertIn('empty', str(error.exception))
        self.assertIn('then run this again', str(error.exception))

    def test_a_provider_missing_entirely_is_still_created_fresh_not_refused(self):
        # A null body ("plow:" with nothing after it) is a decision to state; a genuinely absent provider
        # is not the same shape and must keep working exactly as test_a_missing_provider_is_created_as_a_
        # mapping already covers -- this pins that the new null check does not over-reach into that case.
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\nproviders:\n  other:\n    models: {}\n'
        new_text = plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(plow_agent.model_summary(new_text)['models'], ['anthropic/claude-opus-4'])

    def test_flow_style_is_never_a_problem_when_the_id_is_already_present(self):
        # No insertion is needed, so a flow-style models mapping that already has the id is never touched
        # and never refused -- only writing into a flow scalar is unsupported, not merely reading past one.
        text = ('model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\n'
                'providers:\n  plow:\n    models: {anthropic/claude-opus-4: {}}\n')
        new_text = plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(plow_agent.model_summary(new_text)['default'], 'anthropic/claude-opus-4')

    def test_reading_never_needs_the_models_key_to_exist(self):
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\n'
        self.assertEqual(plow_agent.model_summary(text),
                         {'default': 'anthropic/claude-sonnet-5', 'provider': 'plow', 'models': []})

    def test_only_the_default_and_that_providers_models_change(self):
        new_text = plow_agent.set_default_model(SAMPLE_MODEL_CONFIG, 'anthropic/claude-opus-4')
        self.assertIn('base_url: ${PLOW_API_BASE}/v1', new_text)
        self.assertIn('key_env: HERMES_CUSTOM_PLOW_API_KEY', new_text)

    def test_switching_keeps_a_trailing_comment_on_the_default_line(self):
        text = ('model:\n  default: anthropic/claude-sonnet-5  # the production model\n  provider: plow\n'
                'providers:\n  plow:\n    models:\n      anthropic/claude-sonnet-5: {}\n')
        new_text = plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertIn('default: anthropic/claude-opus-4  # the production model', new_text)

    def test_a_switch_leaves_everything_else_byte_for_byte(self):
        new_text = plow_agent.set_default_model(EXOTIC_MODEL_CONFIG, 'anthropic/claude-opus-4')
        old_lines = EXOTIC_MODEL_CONFIG.splitlines(keepends=True)
        new_lines = new_text.splitlines(keepends=True)
        matcher = difflib.SequenceMatcher(None, old_lines, new_lines)
        opcodes = matcher.get_opcodes()
        inserted = sum(j2 - j1 for tag, i1, i2, j1, j2 in opcodes if tag == 'insert')
        deleted = sum(i2 - i1 for tag, i1, i2, j1, j2 in opcodes if tag == 'delete')
        replaced_old = sum(i2 - i1 for tag, i1, i2, j1, j2 in opcodes if tag == 'replace')
        replaced_new = sum(j2 - j1 for tag, i1, i2, j1, j2 in opcodes if tag == 'replace')
        self.assertEqual((inserted, deleted, replaced_old, replaced_new), (1, 0, 1, 1))
        # the untouched lines carry the comment, the folded block's non-ASCII text, and the anchor/merge
        untouched = ''.join(tag == 'equal' and ''.join(old_lines[i1:i2]) or '' for tag, i1, i2, j1, j2 in opcodes)
        self.assertIn('# Hermes runtime configuration', untouched)
        self.assertIn('José Núñez', untouched)
        self.assertIn('enabled: yes', untouched)
        self.assertIn('version: 1.10', untouched)
        self.assertIn('&shared_defaults', untouched)
        self.assertIn('<<: *shared_defaults', untouched)

    def test_a_config_that_will_not_parse_is_refused(self):
        for bad in ('not: valid: yaml: [', '- just\n- a list\n', 'model: not-a-mapping\n', '', 'model: {}\n'):
            with self.subTest(bad=bad):
                with self.assertRaises(plow_agent.DecisionNeeded) as summary_error:
                    plow_agent.model_summary(bad)
                self.assertEqual(summary_error.exception.code, 2)
                with self.assertRaises(plow_agent.DecisionNeeded) as edit_error:
                    plow_agent.set_default_model(bad, 'anthropic/claude-opus-4')
                self.assertEqual(edit_error.exception.code, 2)

    def test_a_parse_error_keeps_its_line_and_column(self):
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.model_summary('model: [\n')
        self.assertRegex(str(error.exception), r'line \d+, column \d+')

    def test_a_config_missing_the_model_block_is_refused(self):
        with self.assertRaises(plow_agent.DecisionNeeded):
            plow_agent.model_summary('providers:\n  plow:\n    models: {}\n')

    def test_a_duplicate_default_key_makes_the_edit_not_match_and_refuses(self):
        # YAML keeps only the last of two duplicate keys, but the line-based editor finds and edits the
        # first: the edited text would reparse with the *second* line's value still governing, silently
        # discarding the switch. This is exactly what the reparse-and-compare check exists to catch.
        text = ('model:\n  default: anthropic/claude-sonnet-5\n  default: anthropic/claude-untouched\n'
                '  provider: plow\nproviders:\n  plow:\n    models:\n      anthropic/claude-untouched: {}\n')
        with self.assertRaises(plow_agent.AgentError) as error:
            plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertNotIsInstance(error.exception, plow_agent.DecisionNeeded)
        self.assertIn('would not match the intended change', str(error.exception))

    def test_a_flow_style_model_block_is_refused_by_name_not_could_not_locate(self):
        # model: {...} parses fine -- model.default exists -- but is written in flow style, the same
        # unsupported shape as its four providers.* siblings: a clear, named DecisionNeeded (exit 2) beats
        # the generic "Could not locate model.default" AgentError (exit 1), which reads as an internal
        # error rather than a decision about the owner's own config.
        text = ('model: {default: anthropic/claude-sonnet-5, provider: plow}\n'
                'providers:\n  plow:\n    models:\n      anthropic/claude-sonnet-5: {}\n')
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_default_model(text, 'anthropic/claude-opus-4')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('flow style', str(error.exception))
        self.assertIn('model', str(error.exception))
        self.assertIn('then run this again', str(error.exception))

    def test_set_default_line_directly_refuses_when_it_cannot_locate_the_default_line(self):
        # Not flow style (that is caught earlier, by name, before this is reached) -- genuinely no model:
        # block at all, tested directly since load_model_config would already refuse this in the full
        # set_default_model pipeline before _set_default_line ever ran.
        lines = ['providers:\n', '  plow: {}\n']
        with self.assertRaises(plow_agent.AgentError) as error:
            plow_agent._set_default_line(lines, 'anthropic/claude-opus-4')
        self.assertNotIsInstance(error.exception, plow_agent.DecisionNeeded)
        self.assertIn('Could not locate', str(error.exception))


@unittest.skipUnless(HAVE_YAML, 'PyYAML is not installed')
class ProviderEditTests(unittest.TestCase):
    """provider_summary() and set_provider(): pure functions over the config's raw YAML text.

    Measured against the live config above and the hand switch that made the agent answer on Kimi with no
    Plow credits: the provider block that was added, and the model.base_url and model.key_env pair that was
    removed so that no call could fall back to Plow.
    """

    KIMI = plow_agent.PROVIDERS['kimi']
    PLOW = plow_agent.PROVIDERS['plow']
    RESTORE = {'base_url': '${PLOW_API_BASE}/v1', 'key_env': 'HERMES_CUSTOM_PLOW_API_KEY',
               'default': 'anthropic/claude-sonnet-5'}

    def test_reads_the_provider_its_model_its_key_variable_and_the_known_providers(self):
        self.assertEqual(plow_agent.provider_summary(LIVE_MODEL_CONFIG),
                         {'provider': 'plow', 'default': 'anthropic/claude-sonnet-5',
                          'key_env': 'HERMES_CUSTOM_PLOW_API_KEY', 'known': ['plow']})

    def test_switching_to_kimi_writes_exactly_the_block_the_hand_switch_wrote(self):
        new_text = plow_agent.set_provider(LIVE_MODEL_CONFIG, self.KIMI, 'kimi-k2.7-code')
        parsed = _safe_load(new_text)
        self.assertEqual(parsed['providers']['kimi'], KIMI_BLOCK)
        self.assertEqual(parsed['model']['provider'], 'kimi')
        self.assertEqual(parsed['model']['default'], 'kimi-k2.7-code')

    def test_switching_away_from_plow_removes_the_pair_that_could_fall_back_to_plow(self):
        new_text = plow_agent.set_provider(LIVE_MODEL_CONFIG, self.KIMI, 'kimi-k2.7-code')
        model = _safe_load(new_text)['model']
        self.assertNotIn('base_url', model)
        self.assertNotIn('key_env', model)
        self.assertNotIn('${PLOW_API_BASE}', new_text.split('providers:')[0])

    def test_the_plow_provider_block_itself_is_left_alone(self):
        new_text = plow_agent.set_provider(LIVE_MODEL_CONFIG, self.KIMI, 'kimi-k2.7-code')
        self.assertEqual(_safe_load(new_text)['providers']['plow'], _safe_load(LIVE_MODEL_CONFIG)['providers']['plow'])

    def test_the_switch_to_kimi_is_the_whole_file_byte_for_byte(self):
        # The live config as the switch leaves it, written out in full: two lines rewritten, two removed,
        # one block added, and every other byte, including the plow block's stale timeout and its per model
        # setting, exactly where it was.
        self.assertEqual(plow_agent.set_provider(LIVE_MODEL_CONFIG, self.KIMI, 'kimi-k2.7-code'),
                         'model:\n'
                         '  default: kimi-k2.7-code\n'
                         '  provider: kimi\n'
                         'providers:\n'
                         '  plow:\n'
                         '    name: plow\n'
                         '    base_url: https://api.plow.co/v1\n'
                         '    key_env: HERMES_CUSTOM_PLOW_API_KEY\n'
                         '    stale_timeout_seconds: 55\n'
                         '    models:\n'
                         '      anthropic/claude-sonnet-5:\n'
                         '        prompt_caching: true\n'
                         '  kimi:\n'
                         '    name: kimi\n'
                         '    base_url: https://api.moonshot.ai/v1\n'
                         '    key_env: MOONSHOT_API_KEY\n'
                         '    models:\n'
                         '      kimi-k2.7-code: {}\n')

    def test_a_round_trip_back_to_plow_leaves_the_file_as_it_started_apart_from_the_new_block(self):
        switched = plow_agent.set_provider(LIVE_MODEL_CONFIG, self.KIMI, 'kimi-k2.7-code')
        back = plow_agent.set_provider(switched, self.PLOW, self.RESTORE['default'], restore=self.RESTORE)
        parsed, started = _safe_load(back), _safe_load(LIVE_MODEL_CONFIG)
        self.assertEqual(parsed['model'], started['model'])
        self.assertEqual(parsed['providers']['plow'], started['providers']['plow'])
        self.assertEqual(parsed['providers']['kimi'], KIMI_BLOCK)  # the one thing deliberately added
        opcodes = difflib.SequenceMatcher(None, LIVE_MODEL_CONFIG.splitlines(keepends=True),
                                          back.splitlines(keepends=True)).get_opcodes()
        changed = [(tag, ''.join(back.splitlines(keepends=True)[j1:j2]))
                   for tag, i1, i2, j1, j2 in opcodes if tag != 'equal']
        self.assertEqual([tag for tag, _ in changed], ['insert'])
        self.assertEqual(changed[0][1], '  kimi:\n    name: kimi\n    base_url: https://api.moonshot.ai/v1\n'
                                        '    key_env: MOONSHOT_API_KEY\n    models:\n      kimi-k2.7-code: {}\n')

    def test_switching_back_restores_the_pair_that_was_removed(self):
        switched = plow_agent.set_provider(LIVE_MODEL_CONFIG, self.KIMI, 'kimi-k2.7-code')
        back = plow_agent.set_provider(switched, self.PLOW, self.RESTORE['default'], restore=self.RESTORE)
        model = _safe_load(back)['model']
        self.assertEqual(model['base_url'], '${PLOW_API_BASE}/v1')  # the variable, not an expanded URL
        self.assertEqual(model['key_env'], 'HERMES_CUSTOM_PLOW_API_KEY')
        self.assertIn('base_url: ${PLOW_API_BASE}/v1\n', back)

    def test_a_provider_block_already_there_keeps_its_own_settings_and_only_gains_the_model(self):
        text = LIVE_MODEL_CONFIG + ('  kimi:\n    name: kimi\n    base_url: https://proxy.example/v1\n'
                                    '    key_env: MOONSHOT_API_KEY\n    models:\n      kimi-k2.6: {}\n')
        new_text = plow_agent.set_provider(text, self.KIMI, 'kimi-k2.7-code')
        block = _safe_load(new_text)['providers']['kimi']
        self.assertEqual(block['base_url'], 'https://proxy.example/v1')  # theirs, not this command's
        self.assertEqual(sorted(block['models']), ['kimi-k2.6', 'kimi-k2.7-code'])

    def test_a_provider_block_without_a_base_url_is_refused_by_name(self):
        text = LIVE_MODEL_CONFIG + '  kimi:\n    key_env: MOONSHOT_API_KEY\n    models:\n      kimi-k2.6: {}\n'
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_provider(text, self.KIMI, 'kimi-k2.7-code')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('providers.kimi', str(error.exception))
        self.assertIn('base_url', str(error.exception))
        self.assertIn('then run this again', str(error.exception))

    def test_a_null_provider_block_is_refused_not_crashed(self):
        text = LIVE_MODEL_CONFIG + '  kimi:\n'
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_provider(text, self.KIMI, 'kimi-k2.7-code')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('providers.kimi', str(error.exception))

    def test_a_flow_style_providers_block_is_refused_before_anything_is_written(self):
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\nproviders: {}\n'
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_provider(text, self.KIMI, 'kimi-k2.7-code')
        self.assertEqual(error.exception.code, 2)
        self.assertIn('flow style', str(error.exception))

    def test_switching_to_plow_without_a_plow_block_says_what_writes_one(self):
        text = ('model:\n  default: kimi-k2.7-code\n  provider: kimi\n'
                'providers:\n  kimi:\n    base_url: https://api.moonshot.ai/v1\n    key_env: MOONSHOT_API_KEY\n'
                '    models:\n      kimi-k2.7-code: {}\n')
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.set_provider(text, self.PLOW, 'anthropic/claude-sonnet-5', restore=self.RESTORE)
        self.assertEqual(error.exception.code, 2)
        self.assertIn('providers.plow', str(error.exception))
        self.assertIn(f'{RELAY} agent', str(error.exception))

    def test_a_missing_providers_block_is_created_with_the_provider_in_it(self):
        text = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\n'
        new_text = plow_agent.set_provider(text, self.KIMI, 'kimi-k2.7-code')
        self.assertEqual(_safe_load(new_text)['providers']['kimi'], KIMI_BLOCK)

    def test_a_config_that_will_not_parse_is_refused_with_nothing_written(self):
        for bad in ('not: valid: yaml: [', 'model: not-a-mapping\n', ''):
            with self.subTest(bad=bad), self.assertRaises(plow_agent.DecisionNeeded) as error:
                plow_agent.set_provider(bad, self.KIMI, 'kimi-k2.7-code')
            self.assertEqual(error.exception.code, 2)

    def test_a_duplicate_provider_key_makes_the_edit_not_match_and_refuses(self):
        # The same trap set_default_model's reparse check exists for: YAML keeps the last of two duplicate
        # keys while the line editor rewrites the first, so the switch would silently not take effect.
        text = LIVE_MODEL_CONFIG.replace('  provider: plow\n', '  provider: plow\n  provider: plow\n')
        with self.assertRaises(plow_agent.AgentError) as error:
            plow_agent.set_provider(text, self.KIMI, 'kimi-k2.7-code')
        self.assertNotIsInstance(error.exception, plow_agent.DecisionNeeded)
        self.assertIn('would not match the intended change', str(error.exception))

    def test_everything_else_in_an_exotic_config_survives_the_switch(self):
        text = EXOTIC_MODEL_CONFIG.replace('  plow:\n', '  plow:\n    base_url: https://api.plow.co/v1\n'
                                                        '    key_env: HERMES_CUSTOM_PLOW_API_KEY\n')
        new_text = plow_agent.set_provider(text, self.KIMI, 'kimi-k2.7-code')
        self.assertIn('# Hermes runtime configuration', new_text)
        self.assertIn('José Núñez', new_text)
        self.assertIn('enabled: yes', new_text)
        self.assertIn('version: 1.10', new_text)
        self.assertIn('<<: *shared_defaults', new_text)

    def test_an_unknown_provider_name_names_the_ones_it_knows(self):
        for name in ('', None, 'openai'):
            with self.subTest(name=name), self.assertRaises(plow_agent.DecisionNeeded) as error:
                plow_agent.provider_entry(name)
            self.assertEqual(error.exception.code, 2)
            self.assertIn('kimi', str(error.exception))
            self.assertIn('plow', str(error.exception))


class FakeMoonshot:
    """Moonshot's model list behind the provider command, answering from the request it is given.

    The body is the shape the live API returned on this owner's account on 2026-09-18: an OpenAI style
    list whose items carry an id, an object and an owner. The ids are that account's own, which is the
    whole point of asking: kimi-k2-0905-preview is not on it and answers 404 at the first real call.
    """
    MODELS = ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2.6']

    def __init__(self, key='sk-fixture-moonshot-key', models=None, error=None, body=None):
        self.key = key
        self.models = self.MODELS if models is None else models
        self.error = error
        self.body = body
        self.requests = []

    def __call__(self, request, timeout=None):
        self.requests.append((request.full_url, dict(request.headers), timeout))
        if self.error is not None:
            raise self.error
        if request.headers.get('Authorization') != f'Bearer {self.key}':
            raise urllib.error.HTTPError(request.full_url, 401, 'Unauthorized', {}, None)
        body = self.body if self.body is not None else json.dumps(
            {'object': 'list', 'data': [{'id': name, 'object': 'model', 'owned_by': 'moonshot'}
                                        for name in self.models]})
        return contextlib.closing(io.BytesIO(body.encode('utf-8')))


class ProviderKeyFileTests(unittest.TestCase):
    """agent/.env: where the provider key lives, read the way Compose reads it and written back privately."""

    KIMI = plow_agent.PROVIDERS['kimi']

    @contextlib.contextmanager
    def env_file(self, text=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env'
            if text is not None:
                path.write_text(text, encoding='utf-8')
            with patch.object(plow_agent, 'ENV_FILE', path):
                yield path

    def test_the_key_is_read_from_agent_env(self):
        with self.env_file('COMPOSE_PROJECT_NAME=relay\nMOONSHOT_API_KEY=sk-fixture-moonshot-key\n') as path:
            self.assertEqual(plow_agent.provider_key(self.KIMI), 'sk-fixture-moonshot-key')
            self.assertTrue(private_files.is_private(path))  # reading it also locks it to this account

    def test_comments_blank_lines_export_and_quotes_are_read_the_way_compose_reads_them(self):
        text = ('# the provider key\n\nexport MOONSHOT_API_KEY="sk-quoted-key"\n'
                "OTHER='single'\nCOMPOSE_PROJECT_NAME=relay\n")
        with self.env_file(text):
            self.assertEqual(plow_agent.read_env_file(),
                             {'MOONSHOT_API_KEY': 'sk-quoted-key', 'OTHER': 'single',
                              'COMPOSE_PROJECT_NAME': 'relay'})

    def test_no_file_at_all_says_what_to_create(self):
        with self.env_file():
            with self.assertRaises(plow_agent.DecisionNeeded) as error:
                plow_agent.provider_key(self.KIMI)
            self.assertEqual(error.exception.code, 2)
            self.assertIn('MOONSHOT_API_KEY', str(error.exception))
            self.assertIn('agent/.env', str(error.exception))

    def test_a_file_without_that_key_names_the_variable_to_add(self):
        with self.env_file('COMPOSE_PROJECT_NAME=relay\n'):
            with self.assertRaises(plow_agent.DecisionNeeded) as error:
                plow_agent.provider_key(self.KIMI)
            self.assertEqual(error.exception.code, 2)
            self.assertIn('MOONSHOT_API_KEY', str(error.exception))

    def test_a_line_that_is_not_name_value_is_refused_with_its_number(self):
        with self.env_file('GOOD=1\nnot a variable line\n'):
            with self.assertRaises(plow_agent.DecisionNeeded) as error:
                plow_agent.read_env_file()
            self.assertEqual(error.exception.code, 2)
            self.assertIn('line 2', str(error.exception))

    def test_a_hash_in_an_unquoted_value_is_refused_rather_than_read_two_ways(self):
        with self.env_file('MOONSHOT_API_KEY=sk-with#hash\n'):
            with self.assertRaises(plow_agent.DecisionNeeded) as error:
                plow_agent.read_env_file()
            self.assertIn('quotes', str(error.exception))

    def test_writing_keeps_every_other_line_including_the_key(self):
        with self.env_file('# mine\nCOMPOSE_PROJECT_NAME=relay\nMOONSHOT_API_KEY=sk-fixture-moonshot-key\n') as path:
            plow_agent.write_env_values({plow_agent.PROVIDER_VARIABLE: 'kimi',
                                         plow_agent.MODEL_VARIABLE: 'kimi-k2.7-code'})
            self.assertEqual(path.read_text(),
                             '# mine\nCOMPOSE_PROJECT_NAME=relay\nMOONSHOT_API_KEY=sk-fixture-moonshot-key\n'
                             'HERMES_PROVIDER=kimi\nHERMES_MODEL=kimi-k2.7-code\n')
            self.assertTrue(private_files.is_private(path))

    def test_writing_a_variable_that_is_already_there_rewrites_it_where_it_is(self):
        with self.env_file('HERMES_PROVIDER=kimi\nMOONSHOT_API_KEY=sk-fixture-moonshot-key\n') as path:
            plow_agent.write_env_values({plow_agent.PROVIDER_VARIABLE: 'plow'})
            self.assertEqual(path.read_text(), 'HERMES_PROVIDER=plow\nMOONSHOT_API_KEY=sk-fixture-moonshot-key\n')

    def test_a_file_that_does_not_end_in_a_newline_still_gains_a_whole_line(self):
        with self.env_file('COMPOSE_PROJECT_NAME=relay') as path:
            plow_agent.write_env_values({plow_agent.PROVIDER_VARIABLE: 'kimi'})
            self.assertEqual(path.read_text(), 'COMPOSE_PROJECT_NAME=relay\nHERMES_PROVIDER=kimi\n')

    def test_writing_creates_the_file_privately_when_there_is_none(self):
        with self.env_file() as path:
            plow_agent.write_env_values({plow_agent.PROVIDER_VARIABLE: 'plow'})
            self.assertEqual(path.read_text(), 'HERMES_PROVIDER=plow\n')
            self.assertTrue(private_files.is_private(path))

    def test_a_value_that_is_not_one_plain_word_is_never_written(self):
        with self.env_file('HERMES_PROVIDER=plow\n') as path:
            for value in ('two words', 'has"quote', ''):
                with self.subTest(value=value), self.assertRaises(plow_agent.AgentError):
                    plow_agent.write_env_values({plow_agent.PROVIDER_VARIABLE: value})
            self.assertEqual(path.read_text(), 'HERMES_PROVIDER=plow\n')


class ProviderModelListTests(unittest.TestCase):
    """provider_models() and choose_model(): what the provider itself says this key can use."""

    KIMI = plow_agent.PROVIDERS['kimi']

    def test_it_asks_the_providers_own_models_url_with_the_key_as_a_bearer_token(self):
        moonshot = FakeMoonshot()
        models = plow_agent.provider_models(self.KIMI, moonshot.key, opener=moonshot)
        url, headers, timeout = moonshot.requests[0]
        self.assertEqual(url, 'https://api.moonshot.ai/v1/models')
        self.assertEqual(headers['Authorization'], f'Bearer {moonshot.key}')
        self.assertEqual(models, FakeMoonshot.MODELS)  # in the order the provider listed them
        self.assertTrue(0 < timeout <= 60)

    def test_a_rejected_key_is_a_decision_naming_the_variable_and_the_file(self):
        for code in (401, 403):
            with self.subTest(code=code):
                moonshot = FakeMoonshot(error=urllib.error.HTTPError(
                    'https://api.moonshot.ai/v1/models', code, 'Denied', {}, None))
                with self.assertRaises(plow_agent.DecisionNeeded) as error:
                    plow_agent.provider_models(self.KIMI, 'sk-wrong-key', opener=moonshot)
                self.assertEqual(error.exception.code, 2)
                self.assertIn('MOONSHOT_API_KEY', str(error.exception))
                self.assertIn('agent/.env', str(error.exception))
                self.assertNotIn('sk-wrong-key', str(error.exception))

    def test_another_http_answer_is_a_failure_rather_than_a_decision(self):
        for code in (404, 500):
            with self.subTest(code=code):
                moonshot = FakeMoonshot(error=urllib.error.HTTPError(
                    'https://api.moonshot.ai/v1/models', code, 'Nope', {}, None))
                with self.assertRaises(plow_agent.AgentError) as error:
                    plow_agent.provider_models(self.KIMI, 'sk-fixture-moonshot-key', opener=moonshot)
                self.assertNotIsInstance(error.exception, plow_agent.DecisionNeeded)
                self.assertIn(str(code), str(error.exception))

    def test_a_provider_that_cannot_be_reached_says_so_without_the_key(self):
        moonshot = FakeMoonshot(error=urllib.error.URLError('Name or service not known'))
        with self.assertRaises(plow_agent.AgentError) as error:
            plow_agent.provider_models(self.KIMI, 'sk-fixture-moonshot-key', opener=moonshot)
        self.assertIn('could not be reached', str(error.exception))
        self.assertNotIn('sk-fixture-moonshot-key', str(error.exception))

    def test_a_certificate_failure_gets_the_certificate_hint(self):
        moonshot = FakeMoonshot(error=urllib.error.URLError(ssl.SSLCertVerificationError('unverified')))
        with self.assertRaises(plow_agent.CertificateUnverified) as error:
            plow_agent.provider_models(self.KIMI, 'sk-fixture-moonshot-key', opener=moonshot)
        self.assertIn('certifi', str(error.exception))

    def test_a_body_that_is_not_a_model_list_is_refused(self):
        for body in ('{"error": "nope"}', 'not json at all', '{"data": []}', '{"data": [{"name": "kimi-k3"}]}'):
            with self.subTest(body=body):
                moonshot = FakeMoonshot(body=body)
                with self.assertRaises(plow_agent.AgentError):
                    plow_agent.provider_models(self.KIMI, moonshot.key, opener=moonshot)

    def test_a_model_the_account_does_not_have_is_refused_naming_what_it_has(self):
        # The exact 404 an owner would otherwise hit at the first real call: this account has no
        # kimi-k2-0905-preview, and the model list is per account, so it is asked for rather than assumed.
        moonshot = FakeMoonshot()
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.choose_model(self.KIMI, moonshot.key, 'kimi-k2-0905-preview', opener=moonshot)
        self.assertEqual(error.exception.code, 2)
        self.assertIn('kimi-k2-0905-preview', str(error.exception))
        for model in FakeMoonshot.MODELS:
            self.assertIn(model, str(error.exception))

    def test_no_model_at_all_lists_what_the_key_can_use(self):
        moonshot = FakeMoonshot()
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.choose_model(self.KIMI, moonshot.key, None, opener=moonshot)
        self.assertEqual(error.exception.code, 2)
        self.assertIn('--model', str(error.exception))
        self.assertIn('kimi-k2.7-code', str(error.exception))

    def test_a_model_the_account_has_passes_through_after_it_was_asked_for(self):
        moonshot = FakeMoonshot()
        self.assertEqual(plow_agent.choose_model(self.KIMI, moonshot.key, 'kimi-k2.7-code', opener=moonshot),
                         'kimi-k2.7-code')
        self.assertEqual(len(moonshot.requests), 1)  # the provider is asked every time, never assumed


class ModelIdValidationTests(unittest.TestCase):
    def test_a_well_shaped_id_passes_through(self):
        self.assertEqual(plow_agent.validate_model_id('anthropic/claude-opus-4'), 'anthropic/claude-opus-4')

    def test_an_empty_or_malformed_id_is_refused(self):
        for bad in ('', 'no-slash-at-all', '/leading-slash', 'trailing-slash/', 'has space/model',
                   'a/b/c', None):
            with self.subTest(bad=bad):
                with self.assertRaises(plow_agent.DecisionNeeded) as error:
                    plow_agent.validate_model_id(bad)
                self.assertEqual(error.exception.code, 2)
                self.assertIn('provider/model', str(error.exception))

    def test_no_id_says_so_instead_of_quoting_none_or_empty(self):
        for bad in (None, ''):
            with self.subTest(bad=bad), self.assertRaises(plow_agent.DecisionNeeded) as error:
                plow_agent.validate_model_id(bad)
            self.assertIn('No model id was given', str(error.exception))
            self.assertNotIn('"None"', str(error.exception))

    def test_a_malformed_id_is_quoted_in_the_message(self):
        with self.assertRaises(plow_agent.DecisionNeeded) as error:
            plow_agent.validate_model_id('no-slash-here')
        self.assertIn('"no-slash-here"', str(error.exception))


class FakeContainer:
    """docker compose exec/ps behind ./relay agent model. No shell parsing: dispatches on argv shape.

    files simulates everything beside the agent config inside /var/lib/hermes. gateway_pid/gateway_up and
    restart_fails simulate s6-svstat and s6-svc -r. corrupt_write simulates a truncated stream reaching the
    temp file. Any call this does not recognise fails the test, and real docker is never touched.
    """

    def __init__(self, config=SAMPLE_MODEL_CONFIG, running=True, gateway_pid=1000):
        self.running = running
        self.files = {plow_agent.CONFIG_PATH: config}
        self.modes = {}  # what a file was left at, so a key written under umask 077 can be checked
        self.restarts = 0
        self.gateway_pid = gateway_pid
        self.gateway_up = True
        self.restart_fails = False
        self.corrupt_write = False
        self.cp_fails = False
        self.baseline_unreadable = False
        self._tmp_counter = 0
        self.calls = []

    def __call__(self, *arguments, capture=False, input=None):
        self.calls.append(arguments)
        if arguments[0] == 'ps':
            return SimpleNamespace(returncode=0, stdout=('cid123\n' if self.running else ''))
        if arguments[0] != 'exec':
            raise AssertionError(f'unexpected compose call: {arguments}')
        # Exact trailing shape, not a loose "is the binary named somewhere in here" check: the service
        # argument carries real meaning (querying or restarting the wrong service would be a live bug), so
        # a call naming the right binary but the wrong service falls through to the tripwire below instead
        # of being answered as if it were fine.
        if arguments[-2:] == ('/command/s6-svstat', plow_agent.GATEWAY_SERVICE):
            if self.baseline_unreadable and self.restarts == 0:
                return SimpleNamespace(returncode=1, stdout='')
            if not self.gateway_up:
                return SimpleNamespace(returncode=0, stdout='down 0 seconds, normally up\n')
            # Real shape (verified against the running container on 2026-09-18): "up (pid 198 pgid 198)
            # 127022 seconds" -- a pgid and an uptime follow the pid inside the parens. An idealized
            # "up (pid N) ..." here previously matched a since-fixed over-tight regex and hid the bug.
            return SimpleNamespace(returncode=0, stdout=f'up (pid {self.gateway_pid} pgid {self.gateway_pid}) 5 seconds\n')
        if arguments[-3:] == ('/command/s6-svc', '-r', plow_agent.GATEWAY_SERVICE):
            self.restarts += 1
            if self.restart_fails:
                return SimpleNamespace(returncode=1, stdout='')
            self.gateway_pid += 1
            return SimpleNamespace(returncode=0, stdout='')
        # The container's own user rather than hermes, which is what the provider key write and the key
        # check run as: the environment directory belongs to the image, the way s6's control files do.
        service = next((i for i, part in enumerate(arguments) if part == 'agent'), None)
        tail = () if service is None else arguments[service + 1:]
        if tail[:1] == ('with-contenv',) and tail[1:3] != ('s6-setuidgid', 'hermes'):
            return self._contenv(tail[1:])
        if tail and tail[0] in ('sh', 'wc', 'rm'):
            return self._root(tail, input)
        # The exact consecutive wrapper, not "with-contenv and hermes are present somewhere": dropping
        # s6-setuidgid (e.g. replacing it with env) would run every config read, write and backup as
        # whatever user docker exec defaults to -- root -- instead of hermes, so that step is pinned too,
        # not just the two ends of the chain.
        wrap = ('with-contenv', 's6-setuidgid', 'hermes')
        wrap_at = next((i for i in range(len(arguments) - 2) if arguments[i:i + 3] == wrap), None)
        if wrap_at is None:
            raise AssertionError(f'unexpected exec call, not run as hermes via with-contenv + s6-setuidgid: {arguments}')
        return self._hermes(arguments[wrap_at + 3:], input)

    def _root(self, tail, input):
        """What runs as the container's own user: the key write, and the two calls that check or undo it."""
        if tail[:2] == ('sh', '-c'):
            return self._shell(tail[2], input)
        if tail[:2] == ('wc', '-c'):
            return self._wc(tail[2])
        if tail[0] == 'rm':
            return self._remove(tail[-1])
        raise AssertionError(f'unexpected command as the container user: {tail}')

    def _contenv(self, tail):
        """with-contenv: a process that can see the container's environment, which is what the key check asks.

        It answers from the environment directory this container actually holds, so it can never report a
        key as set that nothing wrote.
        """
        if tail[:2] != ('sh', '-c'):
            raise AssertionError(f'unexpected with-contenv command: {tail}')
        match = re.fullmatch(r'printf %s "\$\{(\w+):\+set\}"', tail[2])
        if match is None:
            raise AssertionError(f'unexpected with-contenv script: {tail[2]}')
        value = self.files.get(f'{plow_agent.CONTAINER_ENVIRONMENT}/{match.group(1)}', '')
        return SimpleNamespace(returncode=0, stdout='set' if value else '')

    def _hermes(self, tail, input):
        if tail[0] == 'cat':
            return self._read(tail[1])
        if tail[0] == 'cp':
            return self._copy(tail[1], tail[2])
        if tail[0] == 'mktemp':
            return self._mktemp(tail[1])
        if tail[:2] == ('wc', '-c'):
            return self._wc(tail[2])
        if tail[0] == 'mv':
            return self._move(tail[1], tail[2])
        if tail[0] == 'rm':
            return self._remove(tail[-1])
        if tail[:2] == ('sh', '-c'):
            return self._shell(tail[2], input)
        raise AssertionError(f'unexpected hermes command: {tail}')

    def _read(self, path):
        if path not in self.files:
            return SimpleNamespace(returncode=1, stdout='')
        return SimpleNamespace(returncode=0, stdout=self.files[path])

    def _copy(self, source, destination):
        if self.cp_fails or source not in self.files:
            return SimpleNamespace(returncode=1, stdout='')
        self.files[destination] = self.files[source]
        return SimpleNamespace(returncode=0, stdout='')

    def _mktemp(self, template):
        self._tmp_counter += 1
        name = template.replace('XXXXXX', f'{self._tmp_counter:06d}')
        self.files[name] = ''
        return SimpleNamespace(returncode=0, stdout=name + '\n')

    def _wc(self, path):
        if path not in self.files:
            return SimpleNamespace(returncode=1, stdout='')
        size = len(self.files[path].encode('utf-8'))
        return SimpleNamespace(returncode=0, stdout=f'{size} {path}\n')

    def _move(self, source, destination):
        if source not in self.files:
            return SimpleNamespace(returncode=1, stdout='')
        self.files[destination] = self.files.pop(source)
        return SimpleNamespace(returncode=0, stdout='')

    def _remove(self, path):
        self.files.pop(path, None)
        return SimpleNamespace(returncode=0, stdout='')

    def _shell(self, script, input):
        if script.startswith('set -- '):
            # Reads the glob production actually passed, rather than a pattern of its own: a real shell
            # without nullglob leaves the literal pattern in "$1" when nothing matches, so [ -e "$1" ] fails
            # and nothing is printed -- fnmatch.filter against real file names naturally returns [] the same
            # way, never the pattern itself, since no real name is ever literally the unexpanded pattern.
            #
            # But that guard is script text, not a law of nature: if it is missing from the script, honour
            # that honestly too. A real shell without it would still leave the literal, unexpanded pattern
            # in "$1" on no match and printf it unconditionally, so a caller (list_backups) would then try
            # to read/restore a "backup" that is really just the glob text -- not the clean "no backups
            # exist" the guard exists to produce.
            pattern = script[len('set -- '):script.index(';')].strip()
            matches = sorted(fnmatch.filter(self.files, pattern))
            if not matches and '[ -e "$1" ]' not in script:
                matches = [pattern]
            return SimpleNamespace(returncode=0, stdout=''.join(name + '\n' for name in matches))
        if script.startswith('cat > '):
            target = script[len('cat > '):]
            self.files[target] = input[:-5] if self.corrupt_write and input else input
            return SimpleNamespace(returncode=0, stdout='')
        if script.startswith('umask '):
            return self._sequence(script, input)
        raise AssertionError(f'unexpected shell script: {script}')

    def _sequence(self, script, input):
        """The umask, redirect and chmod the provider key write uses, carried out in order like a shell.

        It reads the script the command actually produced rather than matching one fixed string, so a
        change to that script is carried out here too instead of being answered as though it were fine.
        """
        mode = None
        for part in re.split(r'\s*(?:;|&&)\s*', script.strip()):
            words = part.split()
            if not words:
                continue
            if words[0] == 'umask' and len(words) == 2:
                mode = 0o666 & ~int(words[1], 8)
            elif words[:2] == ['cat', '>'] and len(words) == 3:
                self.files[words[2]] = input[:-5] if self.corrupt_write and input else (input or '')
                self.modes[words[2]] = mode
            elif words[0] == 'chmod' and len(words) == 3:
                if words[2] not in self.files:
                    return SimpleNamespace(returncode=1, stdout='')
                self.modes[words[2]] = int(words[1], 8)
            else:
                raise AssertionError(f'unexpected shell command: {part}')
        return SimpleNamespace(returncode=0, stdout='')


def run_model(container, **options):
    """run_agent(agent_action='model', ...) with the same tripwires Installation.run() gives the install flow:
    no question asked, no terminal assumed, and os.environ restored so trust_certifi() cannot leak
    SSL_CERT_FILE into the rest of the suite. time.sleep is patched too: wait_for_restart's confirm step
    means even a successful restart sleeps for real once, and restart_and_wait takes a fresh time.sleep
    lookup specifically so this patch (rather than only an explicit sleep= override) reaches it.
    """
    out, err = io.StringIO(), io.StringIO()
    arguments = dict(agent_action='model', id=None, check=False, revert=False)
    arguments.update(options)
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch.object(plow_agent, 'compose', container))
        stack.enter_context(patch.dict(os.environ, {}))
        stack.enter_context(patch('builtins.input', side_effect=AssertionError('./relay agent model asked a question.')))
        stack.enter_context(patch('sys.stdin', SimpleNamespace(isatty=lambda: False)))
        stack.enter_context(patch('time.sleep', lambda seconds: None))
        stack.enter_context(contextlib.redirect_stdout(out))
        stack.enter_context(contextlib.redirect_stderr(err))
        code = plow_agent.run_agent(SimpleNamespace(**arguments))
    return code, out.getvalue(), err.getvalue()


class RestartWaitTests(unittest.TestCase):
    """wait_for_restart(): pure polling logic, independent of compose/svstat.

    Returns 'confirmed' only once a new pid has been seen on two consecutive reads, so a single sighting of
    a differing pid -- which a gateway crashing and being respawned by s6 would also produce -- is never
    enough on its own. 'timeout' means no differing pid was ever seen; 'churning' means one or more were,
    but none held stable within the budget.
    """

    def test_a_new_pid_confirmed_on_the_next_read_reports_success(self):
        self.assertEqual(plow_agent.wait_for_restart(111, read_pid=lambda: 222, sleep=lambda s: None, timeout=10),
                         'confirmed')

    def test_the_same_pid_keeps_waiting_then_times_out(self):
        slept = []
        self.assertEqual(plow_agent.wait_for_restart(111, read_pid=lambda: 111, sleep=slept.append, timeout=6),
                         'timeout')
        self.assertLessEqual(sum(slept), 6)

    def test_no_pid_yet_also_times_out(self):
        self.assertEqual(plow_agent.wait_for_restart(111, read_pid=lambda: None, sleep=lambda s: None, timeout=4),
                         'timeout')

    def test_a_later_candidate_can_still_confirm_after_an_earlier_one_changed(self):
        # 222 appears once and is abandoned when 333 appears next, but 333 itself is then read twice in a
        # row: it genuinely stabilized, so this is a real success, not a crash loop. (Previously named
        # "...is_not_accepted" while asserting 'confirmed' -- asserting the opposite of its own name.)
        seen = iter([222, 333, 333])
        self.assertEqual(plow_agent.wait_for_restart(111, read_pid=lambda: next(seen), sleep=lambda s: None,
                                                      timeout=30), 'confirmed')

    def test_a_gateway_that_keeps_respawning_a_fresh_pid_every_poll_reports_churning(self):
        pids = iter(range(200, 300))  # a fresh pid every single poll: it never repeats, so never confirms
        slept = []
        result = plow_agent.wait_for_restart(111, read_pid=lambda: next(pids), sleep=slept.append,
                                             timeout=20, confirm_seconds=5)
        self.assertEqual(result, 'churning')
        self.assertLessEqual(sum(slept), 20)

    def test_a_crash_loop_that_goes_down_between_respawns_still_reports_churning(self):
        # Down between two distinct candidates must not erase the fact that more than one was already seen:
        # otherwise a crash loop with visible down-gaps would report "did not come back up" (timeout)
        # instead of "keeps restarting" (churning).
        pids = iter([200, None, None, 300])

        def read():
            try:
                return next(pids)
            except StopIteration:
                return None  # stays down forever after the seeded sequence is exhausted
        result = plow_agent.wait_for_restart(111, read_pid=read, sleep=lambda s: None, timeout=30, confirm_seconds=5)
        self.assertEqual(result, 'churning')

    def test_confirm_seconds_defaults_to_a_real_gap_not_an_instant_recheck(self):
        # A crash loop that respawns quickly could pass two back-to-back reads with no gap between them;
        # confirm_seconds=0 would leave 201 tests green while removing the protection entirely.
        slept = []
        plow_agent.wait_for_restart(111, read_pid=lambda: 222, sleep=slept.append, timeout=10)
        self.assertGreaterEqual(slept[0], 5)


class RestartBaselineTests(unittest.TestCase):
    """restart_and_wait() must never treat an unreadable pre-restart baseline as proof of anything: if
    gateway_pid() cannot be read before the restart (a momentary read failure, or the gateway happening to
    be down right then), every pid read afterward "differs" from None, so any sighting at all would
    otherwise confirm -- reporting a switch that was never actually observed.
    """

    def test_an_unreadable_baseline_refuses_before_attempting_the_restart(self):
        with patch.object(plow_agent, 'gateway_pid', return_value=None), \
                patch.object(plow_agent, 'compose', side_effect=AssertionError('should not attempt the restart')):
            with self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.restart_and_wait('/var/lib/hermes/config.yaml.backup-x')
        self.assertNotIsInstance(error.exception, plow_agent.DecisionNeeded)
        self.assertIn('could not be read before the restart', str(error.exception))
        self.assertIn('config.yaml.backup-x', str(error.exception))
        self.assertIn('--revert', str(error.exception))


class GatewayPidTests(unittest.TestCase):
    """gateway_pid(): parses s6-svstat's real output, not an idealized one.

    REAL_UP is verbatim from the running container on 2026-09-18:
        $ docker compose exec -T agent /command/s6-svstat /run/service/hermes-gateway
        up (pid 198 pgid 198) 127022 seconds
    Do not tighten the pattern to assume nothing follows the pid's digits: that was fix round 1's bug.
    """
    REAL_UP = 'up (pid 198 pgid 198) 127022 seconds\n'

    def fake_compose(self, stdout, returncode=0):
        return lambda *arguments, **options: SimpleNamespace(returncode=returncode, stdout=stdout)

    def test_the_real_svstat_line_is_parsed(self):
        with patch.object(plow_agent, 'compose', self.fake_compose(self.REAL_UP)):
            self.assertEqual(plow_agent.gateway_pid(), 198)

    def test_a_down_line_is_not_up(self):
        with patch.object(plow_agent, 'compose', self.fake_compose('down 0 seconds, normally up\n')):
            self.assertIsNone(plow_agent.gateway_pid())

    def test_an_unrecognised_line_is_not_up(self):
        with patch.object(plow_agent, 'compose', self.fake_compose('something else entirely\n')):
            self.assertIsNone(plow_agent.gateway_pid())

    def test_a_nonzero_exit_is_not_up_even_with_an_up_looking_line(self):
        with patch.object(plow_agent, 'compose', self.fake_compose(self.REAL_UP, returncode=1)):
            self.assertIsNone(plow_agent.gateway_pid())


class BackupNamingTests(unittest.TestCase):
    """backup_config() and before_revert_backup(): both go through mktemp, and land in different namespaces."""

    def test_backup_config_uses_mktemp_so_same_second_backups_do_not_collide(self):
        container = FakeContainer()
        with patch.object(plow_agent, 'compose', container):
            first = plow_agent.backup_config()
            second = plow_agent.backup_config()
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith(f'{plow_agent.CONFIG_PATH}.backup-'))
        leaves = [call[call.index('hermes') + 1:][0] for call in container.calls
                 if call[0] == 'exec' and 'hermes' in call]
        self.assertEqual(leaves.count('mktemp'), 2)

    def test_before_revert_backup_uses_mktemp_and_a_name_list_backups_never_selects(self):
        container = FakeContainer()
        with patch.object(plow_agent, 'compose', container):
            first = plow_agent.before_revert_backup()
            second = plow_agent.before_revert_backup()
        self.assertNotEqual(first, second)
        self.assertTrue(first.startswith(f'{plow_agent.CONFIG_PATH}.before-revert-'))
        self.assertNotIn('.backup-', first)

    def test_a_failing_cp_leaves_no_empty_stub_behind(self):
        # mktemp creates the file first, then cp fills it; if cp fails, a bare failure used to leave an
        # empty file at the mktemp'd name, which list_backups() would then find, select (it sorts newest
        # first) and restore -- wedging every future --revert on an empty config.
        container = FakeContainer()
        container.cp_fails = True
        with patch.object(plow_agent, 'compose', container):
            with self.assertRaises(plow_agent.AgentError):
                plow_agent.backup_config()
        self.assertEqual(list(container.files), [plow_agent.CONFIG_PATH])


@unittest.skipUnless(HAVE_YAML, 'PyYAML is not installed')
class ModelCommandTests(unittest.TestCase):
    def test_prints_the_default_provider_and_known_models(self):
        code, out, err = run_model(FakeContainer())
        self.assertEqual(code, 0)
        self.assertEqual(err, '')
        self.assertIn(plow_agent.status_line('Model', 'anthropic/claude-sonnet-5'), out)
        self.assertIn(plow_agent.status_line('Provider', 'plow'), out)
        self.assertIn(plow_agent.status_line('Models', 'anthropic/claude-sonnet-5, anthropic/claude-haiku-4'), out)

    def test_prints_none_known_when_the_provider_has_no_models_yet(self):
        config = 'model:\n  default: anthropic/claude-sonnet-5\n  provider: plow\n'
        code, out, err = run_model(FakeContainer(config=config))
        self.assertEqual(code, 0)
        self.assertIn(plow_agent.status_line('Models', '(none known)'), out)

    def test_a_container_not_running_refuses_with_exit_2_before_any_edit(self):
        for options in ({}, {'id': 'anthropic/claude-opus-4'}, {'revert': True}):
            with self.subTest(**options):
                container = FakeContainer(running=False)
                code, out, err = run_model(container, **options)
                self.assertEqual(code, 2)
                self.assertIn('not running', err)
                self.assertEqual(container.calls, [('ps', '--status', 'running', '--quiet')])

    def test_an_empty_or_malformed_id_is_refused_before_touching_docker(self):
        for bad in ('', 'no-slash-here'):
            with self.subTest(bad=bad):
                container = FakeContainer()
                code, out, err = run_model(container, id=bad)
                self.assertEqual(code, 2)
                self.assertIn('provider/model', err)
                self.assertEqual(container.calls, [])

    def test_a_config_that_will_not_parse_is_refused_with_exit_2(self):
        for options in ({}, {'id': 'anthropic/claude-opus-4'}):
            with self.subTest(**options):
                code, out, err = run_model(FakeContainer(config='not: valid: yaml: ['), **options)
                self.assertEqual(code, 2)
                self.assertIn('could not be parsed', err)

    def test_switching_backs_up_writes_the_new_default_and_restarts(self):
        container = FakeContainer()
        code, out, err = run_model(container, id='anthropic/claude-haiku-4')
        self.assertEqual(code, 0)
        self.assertEqual(err, '')
        self.assertIn(plow_agent.status_line('Model', 'anthropic/claude-sonnet-5 -> anthropic/claude-haiku-4'), out)
        self.assertEqual(container.restarts, 1)
        self.assertEqual(plow_agent.model_summary(container.files[plow_agent.CONFIG_PATH])['default'],
                         'anthropic/claude-haiku-4')
        others = [name for name in container.files if name != plow_agent.CONFIG_PATH]
        self.assertEqual(len(others), 1)  # exactly the backup; the mktemp file was renamed away, not left behind
        self.assertRegex(others[0], r'\.backup-\d{8}T\d{6}Z-\w+$')
        self.assertEqual(plow_agent.model_summary(container.files[others[0]])['default'], 'anthropic/claude-sonnet-5')

    def test_switching_to_a_new_id_adds_it_to_the_provider_inside_the_container(self):
        container = FakeContainer()
        code, out, err = run_model(container, id='anthropic/claude-opus-4')
        self.assertEqual(code, 0)
        summary = plow_agent.model_summary(container.files[plow_agent.CONFIG_PATH])
        self.assertEqual(summary['models'],
                         ['anthropic/claude-sonnet-5', 'anthropic/claude-haiku-4', 'anthropic/claude-opus-4'])

    def test_the_atomic_write_uses_a_unique_tmp_file_verified_before_the_rename(self):
        # Scoped to write_config's own mktemp template (CONFIG_PATH.XXXXXX), not just "mktemp appears
        # somewhere in the calls": backup_config() also goes through mktemp since M1, with a
        # config.yaml.backup-<ts>-XXXXXX template, so a looser check here would stay green even if
        # write_config's own mktemp/wc/mv were replaced with a naive `cat > config.yaml`.
        container = FakeContainer()
        run_model(container, id='anthropic/claude-haiku-4')
        hermes_calls = [call[call.index('hermes') + 1:] for call in container.calls
                        if call[0] == 'exec' and 'hermes' in call]
        write_template = f'{plow_agent.CONFIG_PATH}.XXXXXX'
        self.assertEqual([c for c in hermes_calls if c[:2] == ('mktemp', write_template)],
                         [('mktemp', write_template)])
        self.assertTrue(any(c[:2] == ('wc', '-c') for c in hermes_calls))
        self.assertTrue(any(c[0] == 'mv' and c[-1] == plow_agent.CONFIG_PATH for c in hermes_calls))

    def test_a_truncated_write_is_refused_and_the_live_config_is_untouched(self):
        container = FakeContainer()
        container.corrupt_write = True
        original = container.files[plow_agent.CONFIG_PATH]
        code, out, err = run_model(container, id='anthropic/claude-haiku-4')
        self.assertEqual(code, 1)
        self.assertIn('not written completely', err)
        self.assertEqual(container.files[plow_agent.CONFIG_PATH], original)
        self.assertEqual(container.restarts, 0)
        leftover_tmp = [name for name in container.files
                        if name != plow_agent.CONFIG_PATH and '.backup-' not in name]
        self.assertEqual(leftover_tmp, [])

    def test_a_failing_backup_leaves_no_stub_and_revert_still_works_afterwards(self):
        container = FakeContainer()
        container.files[f'{plow_agent.CONFIG_PATH}.backup-20260101T000000Z-aaaaaa'] = SAMPLE_MODEL_CONFIG.replace(
            'default: anthropic/claude-sonnet-5', 'default: anthropic/claude-haiku-4')
        container.cp_fails = True
        code, out, err = run_model(container, id='anthropic/claude-opus-4')
        self.assertEqual(code, 1)
        # only the live config and the one pre-existing backup remain: no empty stub was left at the
        # mktemp'd name, so it can never be selected as "the newest backup" by a later revert
        self.assertEqual(sorted(container.files),
                         sorted([plow_agent.CONFIG_PATH, f'{plow_agent.CONFIG_PATH}.backup-20260101T000000Z-aaaaaa']))
        container.cp_fails = False
        code2, out2, err2 = run_model(container, revert=True)
        self.assertEqual(code2, 0)
        self.assertEqual(err2, '')
        self.assertEqual(plow_agent.model_summary(container.files[plow_agent.CONFIG_PATH])['default'],
                         'anthropic/claude-haiku-4')

    def test_check_is_off_by_default_and_never_calls_speak(self):
        container = FakeContainer()
        with patch.object(plow_agent, 'speak', side_effect=AssertionError('spoke without --check')):
            code, out, err = run_model(container, id='anthropic/claude-haiku-4')
        self.assertEqual(code, 0)

    def test_check_sends_one_prompt_after_a_successful_switch_and_prints_the_reply(self):
        container = FakeContainer()
        spoken = []
        with patch.object(plow_agent, 'speak', side_effect=lambda prompt: spoken.append(prompt) or 'I am Reach.'):
            code, out, err = run_model(container, id='anthropic/claude-haiku-4', check=True)
        self.assertEqual(code, 0)
        self.assertEqual(len(spoken), 1)
        model_line = out.index(plow_agent.status_line('Model', 'anthropic/claude-sonnet-5 -> anthropic/claude-haiku-4'))
        self.assertGreater(out.index('I am Reach.'), model_line)

    def test_check_failing_does_not_fail_a_landed_switch(self):
        container = FakeContainer()
        with patch.object(plow_agent, 'speak', side_effect=plow_agent.AgentError('did not answer')):
            code, out, err = run_model(container, id='anthropic/claude-haiku-4', check=True)
        self.assertEqual(code, 0)
        self.assertEqual(err, '')
        self.assertIn('the switch itself landed', out)

    def test_check_with_an_empty_reply_says_so_without_failing(self):
        container = FakeContainer()
        with patch.object(plow_agent, 'speak', return_value='   '):
            code, out, err = run_model(container, id='anthropic/claude-haiku-4', check=True)
        self.assertEqual(code, 0)
        self.assertIn('the switch itself landed', out)

    def test_check_raising_something_other_than_agenterror_still_does_not_fail_the_switch(self):
        container = FakeContainer()
        with patch.object(plow_agent, 'speak', side_effect=RuntimeError('unexpected')):
            code, out, err = run_model(container, id='anthropic/claude-haiku-4', check=True)
        self.assertEqual(code, 0)
        self.assertEqual(err, '')
        self.assertIn('the switch itself landed', out)

    def test_the_restart_command_failing_names_the_backup_and_revert(self):
        container = FakeContainer()
        container.restart_fails = True
        code, out, err = run_model(container, id='anthropic/claude-haiku-4')
        self.assertEqual(code, 1)
        self.assertIn('could not be restarted', err)
        self.assertIn('--revert', err)
        backups = [name for name in container.files if '.backup-' in name]
        self.assertEqual(len(backups), 1)
        self.assertIn(backups[0], err)

    def test_an_unreadable_baseline_refuses_and_never_restarts_through_the_command(self):
        container = FakeContainer()
        container.baseline_unreadable = True
        code, out, err = run_model(container, id='anthropic/claude-haiku-4')
        self.assertEqual(code, 1)
        self.assertIn('could not be read before the restart', err)
        self.assertEqual(container.restarts, 0)
        backups = [name for name in container.files if '.backup-' in name]
        self.assertEqual(len(backups), 1)
        self.assertIn(backups[0], err)

    def test_the_gateway_not_reporting_a_new_pid_names_the_backup_and_revert(self):
        container = FakeContainer()
        with patch.object(plow_agent, 'wait_for_restart', return_value='timeout'):
            code, out, err = run_model(container, id='anthropic/claude-haiku-4')
        self.assertEqual(code, 1)
        self.assertIn('did not come back up', err)
        self.assertIn('--revert', err)
        backups = [name for name in container.files if '.backup-' in name]
        self.assertEqual(len(backups), 1)
        self.assertIn(backups[0], err)

    def test_a_churning_gateway_says_so_and_names_the_backup_and_revert(self):
        # s6 keeps respawning a gateway that crashes on the new model: exits non-zero rather than reading
        # some transient pid sighting as success.
        container = FakeContainer()
        with patch.object(plow_agent, 'wait_for_restart', return_value='churning'):
            code, out, err = run_model(container, id='anthropic/claude-haiku-4')
        self.assertEqual(code, 1)
        self.assertIn('keeps restarting', err)
        self.assertIn('--revert', err)
        backups = [name for name in container.files if '.backup-' in name]
        self.assertEqual(len(backups), 1)
        self.assertIn(backups[0], err)

    def test_restart_waits_for_a_new_pid_not_just_the_restart_command(self):
        container = FakeContainer()
        code, out, err = run_model(container, id='anthropic/claude-haiku-4')
        self.assertEqual(code, 0)
        svstat_calls = [call for call in container.calls if '/command/s6-svstat' in call]
        self.assertGreaterEqual(len(svstat_calls), 2)  # once before the restart, at least once after

    def test_revert_restores_the_newest_backup_and_restarts(self):
        container = FakeContainer()
        container.files[f'{plow_agent.CONFIG_PATH}.backup-20260101T000000Z'] = SAMPLE_MODEL_CONFIG.replace(
            'default: anthropic/claude-sonnet-5', 'default: anthropic/claude-too-old')
        container.files[f'{plow_agent.CONFIG_PATH}.backup-20260917T120000Z'] = SAMPLE_MODEL_CONFIG.replace(
            'default: anthropic/claude-sonnet-5', 'default: anthropic/claude-haiku-4')
        code, out, err = run_model(container, revert=True)
        self.assertEqual(code, 0)
        self.assertEqual(err, '')
        self.assertEqual(container.restarts, 1)
        self.assertIn(plow_agent.status_line('Model', 'anthropic/claude-sonnet-5 -> anthropic/claude-haiku-4'), out)
        self.assertEqual(plow_agent.model_summary(container.files[plow_agent.CONFIG_PATH])['default'],
                         'anthropic/claude-haiku-4')

    def test_revert_backs_up_the_config_it_replaces(self):
        container = FakeContainer()
        # An ordinary date: the safety copy no longer needs to be dated in the past to pass this test,
        # because it is no longer named so that list_backups() could ever select it (see the ping-pong
        # test below) -- unlike before this fix round, when only an artificially old seed date kept it out
        # of the way of the next revert's own selection.
        container.files[f'{plow_agent.CONFIG_PATH}.backup-20260101T000000Z-aaaaaa'] = SAMPLE_MODEL_CONFIG.replace(
            'default: anthropic/claude-sonnet-5', 'default: anthropic/claude-haiku-4')
        code, out, err = run_model(container, revert=True)
        self.assertEqual(code, 0)
        revertable = sorted(name for name in container.files if '.backup-' in name)
        self.assertEqual(len(revertable), 1)  # only the one seeded backup; the safety copy is not one of these
        safety = [name for name in container.files if '.before-revert-' in name]
        self.assertEqual(len(safety), 1)
        self.assertEqual(plow_agent.model_summary(container.files[safety[0]])['default'], 'anthropic/claude-sonnet-5')

    def test_two_reverts_in_a_row_land_on_the_same_config_not_alternating(self):
        container = FakeContainer()
        container.files[f'{plow_agent.CONFIG_PATH}.backup-20260101T000000Z-aaaaaa'] = SAMPLE_MODEL_CONFIG.replace(
            'default: anthropic/claude-sonnet-5', 'default: anthropic/claude-too-old')
        container.files[f'{plow_agent.CONFIG_PATH}.backup-20260917T120000Z-bbbbbb'] = SAMPLE_MODEL_CONFIG.replace(
            'default: anthropic/claude-sonnet-5', 'default: anthropic/claude-haiku-4')
        code1, out1, err1 = run_model(container, revert=True)
        self.assertEqual(code1, 0)
        after_first = plow_agent.model_summary(container.files[plow_agent.CONFIG_PATH])['default']
        code2, out2, err2 = run_model(container, revert=True)
        self.assertEqual(code2, 0)
        after_second = plow_agent.model_summary(container.files[plow_agent.CONFIG_PATH])['default']
        self.assertEqual(after_first, 'anthropic/claude-haiku-4')
        self.assertEqual(after_second, after_first)  # not toggled back to anthropic/claude-too-old

    def test_revert_uses_the_same_atomic_write_as_a_switch(self):
        container = FakeContainer()
        container.files[f'{plow_agent.CONFIG_PATH}.backup-20260101T000000Z-aaaaaa'] = SAMPLE_MODEL_CONFIG.replace(
            'default: anthropic/claude-sonnet-5', 'default: anthropic/claude-haiku-4')
        run_model(container, revert=True)
        leaves = [call[call.index('hermes') + 1:][0] for call in container.calls
                 if call[0] == 'exec' and 'hermes' in call]
        self.assertIn('mktemp', leaves)
        self.assertIn('wc', leaves)
        self.assertIn('mv', leaves)

    def test_revert_with_no_backup_refuses_with_exit_2(self):
        container = FakeContainer()
        code, out, err = run_model(container, revert=True)
        self.assertEqual(code, 2)
        self.assertIn('No config backup', err)
        self.assertEqual(container.restarts, 0)

    def test_a_broken_backup_listing_is_a_real_failure_not_no_backups(self):
        # Any non-zero exit is now unambiguously a real failure: the shell command itself no longer relies
        # on ls's own "no match" exit code (which varies by implementation and was previously allow-listed
        # as harmless, return code 1 included -- indistinguishable, by code alone, from a genuine failure
        # exiting 1 with no output).
        for returncode in (1, 2, 127):
            with self.subTest(returncode=returncode):
                container = FakeContainer()
                real_shell = container._shell

                def failing_shell(script, input, returncode=returncode):
                    if script.startswith('set -- '):
                        return SimpleNamespace(returncode=returncode, stdout='')
                    return real_shell(script, input)
                container._shell = failing_shell
                code, out, err = run_model(container, revert=True)
                self.assertEqual(code, 1)
                self.assertIn('Could not list config backups', err)
                self.assertNotIn('No config backup exists', err)

    def test_revert_still_works_when_the_live_config_cannot_be_parsed(self):
        container = FakeContainer(config='not: valid: yaml: [')
        container.files[f'{plow_agent.CONFIG_PATH}.backup-20260917T120000Z'] = SAMPLE_MODEL_CONFIG
        code, out, err = run_model(container, revert=True)
        self.assertEqual(code, 0)
        self.assertIn(plow_agent.status_line('Model', 'unknown -> anthropic/claude-sonnet-5'), out)


class ProviderRun:
    """./relay agent provider against a fake container, a fake Moonshot and a temporary agent/.env.

    Nothing here reaches docker, the network or the owner's own agent/.env, and time.sleep is patched the
    way run_model patches it, because even a successful restart waits once for real.
    """

    KEY = 'sk-fixture-moonshot-key'

    def __init__(self, container=None, env=f'MOONSHOT_API_KEY={KEY}\n',
                 reply='I am Kimi, a model made by Moonshot AI.', moonshot=None):
        self.container = FakeContainer(config=LIVE_MODEL_CONFIG) if container is None else container
        self.env = env
        self.reply = reply
        self.moonshot = FakeMoonshot(key=self.KEY) if moonshot is None else moonshot
        self.spoken = []
        self.written = None

    def speak(self, prompt):
        self.spoken.append(prompt)
        if isinstance(self.reply, BaseException):
            raise self.reply
        return self.reply

    def run(self, name=None, model=None):
        out, err = io.StringIO(), io.StringIO()
        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            env_path = Path(directory) / '.env'
            if self.env is not None:
                env_path.write_text(self.env, encoding='utf-8')
            stack.enter_context(patch.object(plow_agent, 'ENV_FILE', env_path))
            stack.enter_context(patch.object(plow_agent, 'compose', self.container))
            stack.enter_context(patch.object(plow_agent, 'speak', self.speak))
            stack.enter_context(patch.object(urllib.request, 'urlopen', self.moonshot))
            stack.enter_context(patch.dict(os.environ, {}))
            stack.enter_context(patch('builtins.input',
                                      side_effect=AssertionError('the provider command asked a question.')))
            stack.enter_context(patch('sys.stdin', SimpleNamespace(isatty=lambda: False)))
            stack.enter_context(patch('time.sleep', lambda seconds: None))
            stack.enter_context(contextlib.redirect_stdout(out))
            stack.enter_context(contextlib.redirect_stderr(err))
            code = plow_agent.run_agent(SimpleNamespace(agent_action='provider', name=name, model=model))
            self.written = env_path.read_text() if env_path.is_file() else None
            self.env = self.written  # so a second run through the same container reads what the first wrote
        return code, out.getvalue(), err.getvalue()

    def config(self):
        return self.container.files[plow_agent.CONFIG_PATH]

    def container_key(self, name='MOONSHOT_API_KEY'):
        return self.container.files.get(f'{plow_agent.CONTAINER_ENVIRONMENT}/{name}')

    def backups(self):
        return [name for name in self.container.files if '.backup-' in name]


@unittest.skipUnless(HAVE_YAML, 'PyYAML is not installed')
class ProviderCommandTests(unittest.TestCase):
    """./relay agent provider: what it shows, what it switches, and what it refuses to claim."""

    PLOW_KEY = f'{plow_agent.CONTAINER_ENVIRONMENT}/HERMES_CUSTOM_PLOW_API_KEY'
    KIMI_KEY = f'{plow_agent.CONTAINER_ENVIRONMENT}/MOONSHOT_API_KEY'

    def test_show_reads_the_provider_model_and_key_from_the_running_container(self):
        run = ProviderRun()
        run.container.files[self.PLOW_KEY] = 'plow-key-inside-the-container'
        code, out, err = run.run()
        self.assertEqual((code, err), (0, ''))
        self.assertIn(plow_agent.status_line('Provider', 'plow'), out)
        self.assertIn(plow_agent.status_line('Model', 'anthropic/claude-sonnet-5'), out)
        self.assertIn(plow_agent.status_line('Key', 'HERMES_CUSTOM_PLOW_API_KEY is set in the container'), out)
        self.assertIn(plow_agent.status_line('Known', 'plow'), out)
        self.assertNotIn('plow-key-inside-the-container', out)  # the name of the variable, never its value

    def test_show_says_when_the_container_does_not_have_that_key(self):
        code, out, err = ProviderRun().run()
        self.assertEqual(code, 0)
        self.assertIn('HERMES_CUSTOM_PLOW_API_KEY is not set in the container', out)

    def test_a_container_that_is_not_running_refuses_with_exit_2_before_anything_else(self):
        for arguments in ({}, {'name': 'kimi', 'model': 'kimi-k2.7-code'}, {'name': 'plow'}):
            with self.subTest(**arguments):
                run = ProviderRun(container=FakeContainer(config=LIVE_MODEL_CONFIG, running=False))
                code, out, err = run.run(**arguments)
                self.assertEqual(code, 2)
                self.assertIn('not running', err)
                self.assertEqual(run.container.calls, [('ps', '--status', 'running', '--quiet')])
                self.assertEqual(run.moonshot.requests, [])

    def test_a_provider_it_does_not_know_is_refused_before_touching_docker(self):
        run = ProviderRun()
        code, out, err = run.run(name='openai', model='gpt-5')
        self.assertEqual(code, 2)
        self.assertIn('kimi', err)
        self.assertEqual(run.container.calls, [])

    def test_a_missing_key_is_refused_before_the_provider_is_asked_or_anything_is_written(self):
        run = ProviderRun(env='COMPOSE_PROJECT_NAME=relay\n')
        code, out, err = run.run(name='kimi', model='kimi-k2.7-code')
        self.assertEqual(code, 2)
        self.assertIn('MOONSHOT_API_KEY', err)
        self.assertIn('agent/.env', err)
        self.assertEqual(run.moonshot.requests, [])
        self.assertEqual(run.config(), LIVE_MODEL_CONFIG)
        self.assertEqual(run.container.restarts, 0)

    def test_a_model_the_account_does_not_have_stops_before_the_config_is_touched(self):
        run = ProviderRun()
        code, out, err = run.run(name='kimi', model='kimi-k2-0905-preview')
        self.assertEqual(code, 2)
        self.assertIn('kimi-k2-0905-preview', err)
        self.assertIn('kimi-k2.7-code', err)  # what the account does have
        self.assertEqual(len(run.moonshot.requests), 1)
        self.assertEqual(run.config(), LIVE_MODEL_CONFIG)
        self.assertEqual(run.container.restarts, 0)
        self.assertIsNone(run.container_key())

    def test_no_model_lists_what_the_key_can_use_and_changes_nothing(self):
        run = ProviderRun()
        code, out, err = run.run(name='kimi')
        self.assertEqual(code, 2)
        self.assertIn('--model', err)
        for model in FakeMoonshot.MODELS:
            self.assertIn(model, err)
        self.assertEqual(run.config(), LIVE_MODEL_CONFIG)

    def test_a_switch_writes_the_key_then_the_config_then_restarts_and_asks_the_agent(self):
        run = ProviderRun()
        code, out, err = run.run(name='kimi', model='kimi-k2.7-code')
        self.assertEqual((code, err), (0, ''))
        self.assertEqual(run.container_key(), run.KEY)
        self.assertEqual(run.container.modes[self.KIMI_KEY], 0o600)
        summary = plow_agent.provider_summary(run.config())
        self.assertEqual((summary['provider'], summary['default']), ('kimi', 'kimi-k2.7-code'))
        self.assertEqual(run.container.restarts, 1)
        self.assertEqual(len(run.spoken), 1)
        self.assertIn(plow_agent.status_line('Provider', 'plow -> kimi'), out)
        self.assertIn(plow_agent.status_line('Model', 'anthropic/claude-sonnet-5 -> kimi-k2.7-code'), out)
        self.assertIn('I am Kimi, a model made by Moonshot AI.', out)
        self.assertEqual(len(run.backups()), 1)
        self.assertIn(run.backups()[0], out)  # the switch names its backup, and so how to undo it

    def test_the_key_reaches_the_container_before_the_config_is_replaced(self):
        run = ProviderRun()
        run.run(name='kimi', model='kimi-k2.7-code')
        wrote_key = next(i for i, call in enumerate(run.container.calls) if self.KIMI_KEY in ' '.join(call))
        replaced = next(i for i, call in enumerate(run.container.calls)
                        if 'mv' in call and call[-1] == plow_agent.CONFIG_PATH)
        self.assertLess(wrote_key, replaced)

    def test_the_key_is_never_an_argument_and_never_printed(self):
        run = ProviderRun()
        code, out, err = run.run(name='kimi', model='kimi-k2.7-code')
        self.assertEqual(code, 0)
        self.assertNotIn(run.KEY, out)
        self.assertNotIn(run.KEY, err)
        for call in run.container.calls:
            self.assertNotIn(run.KEY, ' '.join(str(part) for part in call))

    def test_agent_env_records_the_choice_only_after_the_agent_answered(self):
        run = ProviderRun()
        run.run(name='kimi', model='kimi-k2.7-code')
        self.assertEqual(run.written, f'MOONSHOT_API_KEY={run.KEY}\nHERMES_PROVIDER=kimi\n'
                                      'HERMES_MODEL=kimi-k2.7-code\n')

    def test_an_agent_that_does_not_answer_is_a_failure_that_names_the_backup_and_the_undo(self):
        for reply in ('', '   ', plow_agent.AgentError('did not answer'), RuntimeError('unexpected')):
            with self.subTest(reply=reply):
                run = ProviderRun(reply=reply)
                code, out, err = run.run(name='kimi', model='kimi-k2.7-code')
                self.assertEqual(code, 1)
                self.assertIn('did not answer', err)
                self.assertIn('--revert', err)
                self.assertIn(run.backups()[0], err)
                self.assertEqual(run.written, f'MOONSHOT_API_KEY={run.KEY}\n')  # the choice was not recorded
                self.assertNotIn('HERMES_PROVIDER', run.written)

    def test_a_restart_that_fails_leaves_agent_env_alone_and_names_the_backup(self):
        run = ProviderRun()
        run.container.restart_fails = True
        code, out, err = run.run(name='kimi', model='kimi-k2.7-code')
        self.assertEqual(code, 1)
        self.assertIn('could not be restarted', err)
        self.assertIn(run.backups()[0], err)
        self.assertEqual(run.written, f'MOONSHOT_API_KEY={run.KEY}\n')
        self.assertEqual(run.spoken, [])

    def test_a_key_that_cannot_be_written_whole_stops_before_the_config_is_touched(self):
        run = ProviderRun()
        run.container.corrupt_write = True
        code, out, err = run.run(name='kimi', model='kimi-k2.7-code')
        self.assertEqual(code, 1)
        self.assertIn('MOONSHOT_API_KEY could not be written', err)
        self.assertEqual(run.config(), LIVE_MODEL_CONFIG)
        self.assertEqual(run.backups(), [])
        self.assertEqual(run.container.restarts, 0)
        self.assertIsNone(run.container_key())  # the half written file is removed, not left as a key

    def test_the_provider_it_is_already_on_and_already_recorded_changes_nothing(self):
        run = ProviderRun(env='HERMES_PROVIDER=plow\nHERMES_MODEL=anthropic/claude-sonnet-5\n')
        code, out, err = run.run(name='plow')
        self.assertEqual((code, err), (0, ''))
        self.assertIn('Nothing was changed.', out)
        self.assertEqual(run.config(), LIVE_MODEL_CONFIG)
        self.assertEqual(run.container.restarts, 0)
        self.assertEqual(run.spoken, [])

    def test_a_container_on_this_provider_that_agent_env_does_not_record_is_recorded(self):
        """The durable half is the point. A container switched by hand, or by a run that stopped
        before its last step, is on this provider only until something builds it again: Compose
        reads agent/.env, and an unrecorded provider sends the agent back to the default."""
        run = ProviderRun(env='MOONSHOT_API_KEY=sk-fixture-moonshot-key\n')
        code, out, err = run.run(name='plow')
        self.assertEqual((code, err), (0, ''))
        self.assertNotIn('Nothing was changed.', out)
        self.assertIn('Recorded', out)
        self.assertIn('HERMES_PROVIDER=plow', run.written)
        self.assertIn('HERMES_MODEL=anthropic/claude-sonnet-5', run.written)
        self.assertIn('MOONSHOT_API_KEY=', run.written)  # the owner's own line is kept
        self.assertEqual(run.config(), LIVE_MODEL_CONFIG)  # the running agent was already right
        self.assertEqual(run.container.restarts, 0)        # so it is not restarted for a file
        self.assertEqual(run.spoken, [])

    def test_plow_with_a_model_points_at_the_model_command_rather_than_guessing(self):
        run = ProviderRun(container=FakeContainer(config=LIVE_MODEL_CONFIG))
        run.run(name='kimi', model='kimi-k2.7-code')
        code, out, err = run.run(name='plow', model='anthropic/claude-haiku-4')
        self.assertEqual(code, 2)
        self.assertIn(f'{RELAY} agent model', err)

    def test_switching_back_to_plow_restores_what_plow_needs_and_keeps_the_new_block(self):
        run = ProviderRun()
        self.assertEqual(run.run(name='kimi', model='kimi-k2.7-code')[0], 0)
        code, out, err = run.run(name='plow')
        self.assertEqual((code, err), (0, ''))
        self.assertIn(plow_agent.status_line('Provider', 'kimi -> plow'), out)
        self.assertEqual(run.config(), LIVE_MODEL_CONFIG +
                         '  kimi:\n    name: kimi\n    base_url: https://api.moonshot.ai/v1\n'
                         '    key_env: MOONSHOT_API_KEY\n    models:\n      kimi-k2.7-code: {}\n')
        self.assertEqual(run.written, f'MOONSHOT_API_KEY={run.KEY}\nHERMES_PROVIDER=plow\n'
                                      'HERMES_MODEL=anthropic/claude-sonnet-5\n')
        self.assertEqual(run.container.restarts, 2)

    def test_switching_back_with_no_backup_of_plows_own_settings_says_what_restores_them(self):
        config = plow_agent.set_provider(LIVE_MODEL_CONFIG, plow_agent.PROVIDERS['kimi'], 'kimi-k2.7-code')
        run = ProviderRun(container=FakeContainer(config=config))
        code, out, err = run.run(name='plow')
        self.assertEqual(code, 2)
        self.assertIn('HERMES_PROVIDER=plow', err)
        self.assertIn(f'{RELAY} agent', err)
        self.assertEqual(run.container.restarts, 0)

    def test_show_after_a_switch_reports_what_the_container_holds(self):
        run = ProviderRun()
        run.run(name='kimi', model='kimi-k2.7-code')
        code, out, err = run.run()
        self.assertEqual((code, err), (0, ''))
        self.assertIn(plow_agent.status_line('Provider', 'kimi'), out)
        self.assertIn(plow_agent.status_line('Model', 'kimi-k2.7-code'), out)
        self.assertIn('MOONSHOT_API_KEY is set in the container', out)
        self.assertIn(plow_agent.status_line('Known', 'plow, kimi'), out)

    def test_a_config_that_will_not_parse_is_refused_with_exit_2(self):
        run = ProviderRun(container=FakeContainer(config='not: valid: yaml: ['))
        code, out, err = run.run()
        self.assertEqual(code, 2)
        self.assertIn('could not be parsed', err)


class AnotherFolderTests(unittest.TestCase):
    """The installer works in agent/. These are the only two seams that let a second agent live somewhere else,
    and both keep agent/ as the answer when no folder is named."""

    def test_compose_runs_in_the_installed_agents_folder_unless_another_is_named(self):
        calls = []

        def run(command, **options):
            calls.append((command, options))
            return SimpleNamespace(returncode=0, stdout='')

        with patch.object(subprocess, 'run', run):
            plow_agent.compose('ps', '--quiet', capture=True)
            plow_agent.compose('up', '-d', cwd='/fixture/dana')
        self.assertEqual([command for command, _ in calls],
                         [['docker', 'compose', 'ps', '--quiet'], ['docker', 'compose', 'up', '-d']])
        self.assertEqual([options['cwd'] for _, options in calls], [plow_agent.AGENT, '/fixture/dana'])
        self.assertEqual([options['capture_output'] for _, options in calls], [True, False])

    def minting(self, directory, path=None):
        """credential_for_new_line() with Plow faked, minting either where it is told or where it defaults to."""
        minted = []

        def mint(args):
            minted.append(args.credential_file)
            Path(args.credential_file).write_text('PLOW_AGENT_TOKEN=agt_fixture_token\n')

        client = {'account_token': lambda args: 'acct_fixture_token', 'login': lambda args: None,
                  'account_lines': lambda base, token: [line('ln_1')], 'mint': mint}
        arguments = SimpleNamespace(new_line=False, line=None)
        with patch.object(plow_agent, 'official', lambda: client), \
                patch.object(plow_agent, 'CREDENTIAL', Path(directory) / 'agent/plow-credentials'), \
                patch.object(plow_agent, 'identity', lambda path: {'line': line('ln_1')}), \
                contextlib.redirect_stdout(io.StringIO()):
            chosen = plow_agent.credential_for_new_line(arguments, path) if path else \
                plow_agent.credential_for_new_line(arguments)
        return chosen, minted

    def test_a_new_lines_credential_is_minted_into_the_folder_it_is_given(self):
        with tempfile.TemporaryDirectory() as directory:
            elsewhere = Path(directory) / 'dana/plow-credentials'
            elsewhere.parent.mkdir(parents=True)
            chosen, minted = self.minting(directory, elsewhere)
            self.assertEqual(minted, [str(elsewhere)])
            self.assertTrue(elsewhere.exists())
            self.assertFalse((Path(directory) / 'agent/plow-credentials').exists())
        self.assertEqual(chosen['uid'], 'ln_1')

    def test_without_a_folder_it_still_mints_into_the_installed_agents_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / 'agent').mkdir()
            chosen, minted = self.minting(directory)
            self.assertEqual(minted, [str(Path(directory) / 'agent/plow-credentials')])
        self.assertEqual(chosen['uid'], 'ln_1')


class CommandLineTests(unittest.TestCase):
    def test_model_id_and_flags_reach_the_installer(self):
        received = []
        with patch.object(plow_agent, 'run_agent', side_effect=lambda args: received.append(args) or 0):
            cli.main(['agent', 'model'])
            cli.main(['agent', 'model', 'anthropic/claude-opus-4'])
            cli.main(['agent', 'model', 'anthropic/claude-opus-4', '--check'])
            cli.main(['agent', 'model', '--revert'])
        self.assertEqual([(a.id, a.check, a.revert) for a in received],
                         [(None, False, False), ('anthropic/claude-opus-4', False, False),
                          ('anthropic/claude-opus-4', True, False), (None, False, True)])

    def test_line_flag_reaches_the_installer_and_its_exit_code_is_returned(self):
        received = []
        with patch.object(plow_agent, 'run_agent', side_effect=lambda args: received.append(args) or 2):
            self.assertEqual(cli.main(['agent', '--line', '+1 (555) 000-0002']), 2)
            self.assertEqual(cli.main(['agent']), 2)
        self.assertEqual([args.line for args in received], ['+1 (555) 000-0002', None])


class EveryCommandWeNameCanBeRun(unittest.TestCase):
    """A message that names a command has to name one the reader can actually type.

    The line refusal used to say `plow-agents revoke <line>`. That client is a file this
    installer downloads into .data/tools, never on anybody's PATH, so the advice ended at
    command not found for the one person following it exactly.
    """

    def refusal(self, lines):
        with self.assertRaises(plow_agent.DecisionNeeded) as stopped:
            plow_agent.choose_line(lines, ask=None, command='./relay agent')
        return str(stopped.exception)

    def test_no_line_at_all_names_a_runnable_client(self):
        said = self.refusal([])
        self.assertIn('python3 .data/tools/plow-agents', said)
        self.assertNotIn('`plow-agents', said)

    def test_every_line_taken_names_a_runnable_client(self):
        said = self.refusal([{'uid': 'ln_1', 'agent_uid': 'a1'}])
        self.assertIn('python3 .data/tools/plow-agents', said)
        self.assertNotIn('`plow-agents', said)


class DocumentationTests(unittest.TestCase):
    def test_readme_teaches_the_command_and_never_pipes_a_download_into_a_shell(self):
        """The rule this protects is that nobody runs code they have not been given a chance to read.

        It began as a ban on any URL in the quick start, which also banned the clone line the
        install now uses. A clone is not the thing the ban was for: it fetches source that sits
        on disk before anything executes. Downloading a script straight into an interpreter is,
        and that stays banned, because the install is the first thing this product teaches and
        it is taught to people who will install agents for others.
        """
        readme = (plow_agent.ROOT / 'README.md').read_text()
        start = readme.index('## Quick start')
        section = readme[start:readme.index('\n## ', start + 1)]
        self.assertIn('./relay agent', section)
        self.assertNotIn('curl', section)
        self.assertNotIn('wget', section)
        self.assertNotIn('iwr', section)
        self.assertNotIn('Invoke-WebRequest', section)
        for fetched in re.findall(r'^.*https?://.*$', section, re.MULTILINE):
            self.assertNotIn('|', fetched, 'a line that fetches something must not pipe it anywhere')

    def test_the_quick_start_line_is_the_one_install_teaches(self):
        """The README and INSTALL.md must not drift into teaching two different commands."""
        readme = (plow_agent.ROOT / 'README.md').read_text()
        install = (plow_agent.ROOT / 'agent/INSTALL.md').read_text()
        one_line = 'git clone https://github.com/lusknchars/repro-relay.git && cd repro-relay && ./relay agent'
        self.assertIn(one_line, readme)
        self.assertIn(one_line, install)

    def test_install_says_what_windows_types_and_what_needs_a_mac(self):
        install = (plow_agent.ROOT / 'agent/INSTALL.md').read_text()
        self.assertIn('python relay agent', install)
        self.assertIn('Latch', install)
        self.assertNotIn('curl', install)

    def test_readme_teaches_the_model_command(self):
        readme = (plow_agent.ROOT / 'README.md').read_text()
        start = readme.index('## Quick start')
        section = readme[start:readme.index('\n## ', start + 1)]
        self.assertIn('./relay agent model', section)

    def test_agent_readme_teaches_the_same_command(self):
        readme = (plow_agent.ROOT / 'agent/README.md').read_text()
        self.assertIn('./relay agent', readme)

    def test_agent_readme_teaches_choosing_a_line_without_being_asked(self):
        readme = (plow_agent.ROOT / 'agent/README.md').read_text()
        self.assertIn('./relay agent --line', readme)

    def test_agent_readme_teaches_the_model_command(self):
        readme = (plow_agent.ROOT / 'agent/README.md').read_text()
        self.assertIn('./relay agent model', readme)


class FakeKernel32:
    """kernel32 as Windows answers it, from the process id each call is given.

    OpenProcess hands back a handle for an id that is in use, and nothing plus
    ERROR_INVALID_PARAMETER for one that is not. An id that exists but belongs to another
    account is refused with ERROR_ACCESS_DENIED, which still means it exists.
    """

    ACCESS_DENIED = 5

    def __init__(self, running=(), refused=()):
        self.running, self.refused = set(running), set(refused)
        self.error = 0
        self.open_handles = 0

    def OpenProcess(self, access, inherit, pid):
        if access != plow_agent.PROCESS_QUERY_LIMITED_INFORMATION:
            raise AssertionError(f'A process was opened with more than it needed: {access:#x}')
        if pid in self.running:
            self.open_handles += 1
            return 0x100 + pid
        self.error = self.ACCESS_DENIED if pid in self.refused else plow_agent.ERROR_INVALID_PARAMETER
        return 0

    def CloseHandle(self, handle):
        self.open_handles -= 1
        return 1

    def GetLastError(self):
        return self.error


class WindowsCredentialTests(unittest.TestCase):
    """The install path on the host where reading a credential used to crash outright."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.credential = self.directory / 'plow-credentials'
        self.credential.write_text('PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=agt_fixture_token\n')

    @staticmethod
    def bridge_module():
        """The bridge the installer itself reaches, found the way the installer finds it."""
        sys.path.insert(0, str(plow_agent.ROOT / 'integrations/plow'))
        import bridge
        return bridge

    def test_a_resumed_install_reads_its_credential_instead_of_stopping_unexpectedly(self):
        # This used to raise AttributeError on os.O_NOFOLLOW before the file was touched, on
        # every run after the first, and the generic handler then said running again was safe.
        bridge = self.bridge_module()

        class Unreachable:
            """Plow out of reach, without an HTTPS context a faked platform cannot build."""

            def __init__(self, *arguments, **options):
                pass

            def call(self, *arguments, **options):
                raise bridge.BridgeError('Plow request failed: The read operation timed out')

        with windows_host():
            private_files.protect(self.credential)
            self.assertEqual(bridge.private_credentials(self.credential), 'agt_fixture_token')
            with patch.object(bridge, 'JsonHTTP', Unreachable), \
                    self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.existing_line(self.credential, plow_agent.identity)
            self.assertEqual(self.credential.read_text(),
                             'PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=agt_fixture_token\n')
        self.assertIn('run python relay agent again later', str(error.exception))
        self.assertNotIn('./relay', str(error.exception))

    def test_a_credential_another_account_can_read_is_refused_with_the_command_that_fixes_it(self):
        bridge = self.bridge_module()
        with windows_host() as windows:
            windows.access[str(self.credential)] = ['runneradmin', 'NT AUTHORITY\\SYSTEM', 'Everyone']
            with patch.object(bridge, 'JsonHTTP', side_effect=AssertionError('network')), \
                    self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.existing_line(self.credential, plow_agent.identity)
        self.assertIn(f'icacls "{self.credential}"', str(error.exception))
        self.assertIn('It was left untouched.', str(error.exception))

    def mint(self, plow, directory):
        """Mint through the real pinned client, with only Plow and the host faked."""
        client = plow_agent.official()
        config = directory / 'config'
        (config / 'plow').mkdir(parents=True)
        (config / 'plow/token').write_text('acct_fixture_token\n')
        credential = directory / 'agent' / 'plow-credentials'
        with plow.behind(client), patch.dict(os.environ, {'XDG_CONFIG_HOME': str(config)}), \
                contextlib.redirect_stderr(io.StringIO()):
            plow_agent.mint_credential(client, credential, 'ln_free')
        return credential

    def test_the_official_client_mints_a_private_credential_on_windows(self):
        # The client's own write uses os.fchmod and checks for mode 0600, neither of which
        # Windows has, so left alone it stops before the token reaches a file.
        with tempfile.TemporaryDirectory() as directory, windows_host() as windows:
            self.assertFalse(hasattr(os, 'fchmod'))
            credential = self.mint(FakePlow(), Path(directory))
            self.assertIn('PLOW_AGENT_TOKEN=agt_fixture_token\n', credential.read_text())
            self.assertTrue(private_files.is_private(credential))
            self.assertTrue(private_files.is_private(credential.parent))
            self.assertEqual(windows.principals(credential),
                             ['runneradmin', 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators'])
            self.assertEqual(list(credential.parent.glob('.plow-agents.*')), [])

    def test_a_credential_another_program_is_holding_is_retried_rather_than_lost(self):
        with tempfile.TemporaryDirectory() as directory, windows_host():
            destination = Path(directory) / 'agent' / 'plow-credentials'
            with held_by_another_process(destination, times=2), \
                    patch.object(private_files.time, 'sleep') as pause:
                credential = self.mint(FakePlow(), Path(directory))
            self.assertEqual(pause.call_count, 2)
            self.assertIn('PLOW_AGENT_TOKEN=agt_fixture_token\n', credential.read_text())
            self.assertTrue(private_files.is_private(credential))

    def test_a_credential_that_can_never_be_written_retires_the_agent_it_just_created(self):
        plow = FakePlow()
        with tempfile.TemporaryDirectory() as directory, windows_host():
            destination = Path(directory) / 'agent' / 'plow-credentials'
            with held_by_another_process(destination, times=private_files.REPLACE_ATTEMPTS), \
                    patch.object(private_files.time, 'sleep'), \
                    self.assertRaises(plow_agent.AgentError) as error:
                self.mint(plow, Path(directory))
            self.assertIn('holding it', str(error.exception))
            self.assertFalse(destination.exists())
            self.assertEqual(list(destination.parent.glob('.plow-agents.*')), [])
        self.assertIn('DELETE', [method for method, _ in plow.sent])


class PortableClientWrite(unittest.TestCase):
    """Replacing the client's own write happens only on Windows, so it is run here anyway.

    The contract tests reach it through the real pinned client, which is a real function with
    real globals and so happens to accept the replacement. This asks the question directly, so
    that it is intent rather than luck, and so a host that never runs the branch still proves it.
    """

    def test_a_client_already_on_disk_is_protected_before_it_is_read(self):
        # The download branch protected it; a resumed install went straight from the checksum
        # to run_path, so one written by an installer from before any of this kept whatever it
        # inherited, and verify then read again is a window for anyone who can write it.
        with tempfile.TemporaryDirectory() as directory:
            cached = Path(directory) / 'plow-agents'
            cached.write_bytes(b'print("pinned client")\n')
            order = []
            real = private_files.protect

            def protect(path, executable=False):
                order.append(('protect', str(path), executable))
                return real(path, executable=executable)

            def run_path(name):
                order.append(('read', name))
                return pinned_client_double(mint=Mock())

            with patch.object(plow_agent, 'CLIENT', cached), \
                    patch.object(plow_agent, 'CLIENT_SHA256', hashlib.sha256(cached.read_bytes()).hexdigest()), \
                    patch.object(private_files, 'protect', protect), \
                    patch.object(plow_agent.runpy, 'run_path', run_path):
                plow_agent.official()
            self.assertEqual(order, [('protect', str(cached), True), ('read', str(cached))])
            self.assertTrue(private_files.is_private(cached))

    def test_windows_gives_the_client_a_write_it_can_finish(self):
        client = pinned_client_double(mint=Mock())
        with windows_host():
            self.assertIs(plow_agent.portable_private_write(client), client)
        self.assertIs(client_write(client), plow_agent.windows_write_private)

    def test_the_client_keeps_its_own_write_unless_this_host_needs_the_swap(self):
        # Whatever host runs this, including a Windows one, where the swap is what should
        # happen. The faked host test above is where the behaviour is pinned per platform.
        client = pinned_client_double(mint=Mock())
        self.assertIs(plow_agent.portable_private_write(client), client)
        self.assertEqual(client_write(client) is plow_agent.windows_write_private,
                         private_files.windows())

    def test_the_replacement_writes_a_private_file_and_says_why_when_it_cannot(self):
        with tempfile.TemporaryDirectory() as directory:
            written = plow_agent.windows_write_private(
                str(Path(directory) / 'agent' / 'plow-credentials'), 'PLOW_AGENT_TOKEN=agt_fixture_token\n')
            self.assertEqual(Path(written).read_bytes(), b'PLOW_AGENT_TOKEN=agt_fixture_token\n')
            self.assertTrue(private_files.is_private(written))
            self.assertTrue(private_files.is_private(Path(written).parent))
            with patch.object(private_files, 'write_privately',
                              side_effect=private_files.PrivacyError('a drive that cannot keep one account apart')):
                with self.assertRaises(plow_agent.AgentError) as error:
                    plow_agent.windows_write_private(str(Path(directory) / 'other'), 'x')
            self.assertIn('one account apart', str(error.exception))


class OwnerPlatformTests(unittest.TestCase):
    """What the installer records about this computer, and what it tells the container."""

    def test_the_install_record_names_the_computer_it_was_installed_from(self):
        with tempfile.TemporaryDirectory() as directory, windows_host() as windows:
            install = Installation(directory)
            install.windows = windows
            install.docker.project = 'relay-two'
            self.assertEqual(install.run(), 0)
            record = install.root / '.data/agent/install.json'
            saved = json.loads(record.read_text())
            self.assertTrue(private_files.is_private(record))
        self.assertEqual(saved, {'project': 'relay-two', 'agent_dir': str(install.agent.resolve()),
                                 'platform': 'windows'})

    def test_the_sign_in_marker_is_locked_to_this_account_on_windows(self):
        with tempfile.TemporaryDirectory() as directory, windows_host() as windows:
            install = Installation(directory)
            install.windows = windows
            install.lines = [line('ln_a'), line('ln_b')]
            self.assertEqual(install.run(), 2)
            marker = install.root / '.data/agent/signin-created.sha256'
            self.assertTrue(private_files.is_private(marker))
            self.assertEqual(windows.principals(marker),
                             ['runneradmin', 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators'])

    def test_a_record_written_before_this_existed_still_identifies_its_install(self):
        with tempfile.TemporaryDirectory() as directory:
            record = Path(directory) / 'install.json'
            folder = Path(directory) / 'agent'
            folder.mkdir()
            record.write_text(json.dumps({'project': 'agent', 'agent_dir': str(folder.resolve())}))
            self.assertTrue(plow_agent.installed_here(record, 'agent', folder))

    def test_every_docker_compose_call_carries_the_owner_platform_as_utf8(self):
        for platform, expected in (('darwin', 'macos'), ('win32', 'windows'), ('linux', 'linux')):
            with self.subTest(platform=platform), patch.object(sys, 'platform', platform), \
                    patch.object(subprocess, 'run') as run:
                run.return_value = SimpleNamespace(returncode=0, stdout='')
                plow_agent.compose('ps')
                self.assertEqual(run.call_args.kwargs['env'][plow_agent.OWNER_PLATFORM], expected)
                self.assertEqual(run.call_args.kwargs['encoding'], 'utf-8')

    def test_the_compose_file_hands_the_container_the_same_name_and_calls_absence_unknown(self):
        text = (plow_agent.ROOT / 'agent/compose.yml').read_text()
        self.assertIn(f'{plow_agent.OWNER_PLATFORM}: ${{{plow_agent.OWNER_PLATFORM}:-'
                      f'{plow_agent.OWNER_PLATFORM_UNKNOWN}}}', text)

    def test_the_rest_of_the_environment_reaches_docker_unchanged(self):
        with patch.dict(os.environ, {'COMPOSE_PROJECT_NAME': 'relay-two'}):
            self.assertEqual(plow_agent.compose_environment()['COMPOSE_PROJECT_NAME'], 'relay-two')


class WindowsProcessTests(unittest.TestCase):
    """Whether an install lock is stale, asked without terminating the process it names."""

    def test_an_id_in_use_a_free_one_and_a_refused_one_are_told_apart(self):
        kernel = FakeKernel32(running=[4321], refused=[8765])
        self.assertTrue(plow_agent.windows_process_alive(4321, kernel))
        self.assertFalse(plow_agent.windows_process_alive(9999, kernel))
        self.assertTrue(plow_agent.windows_process_alive(8765, kernel))  # refused still means it exists
        self.assertEqual(kernel.open_handles, 0)  # every handle it took, it gave back

    def test_a_question_that_cannot_be_asked_leaves_the_lock_alone(self):
        class Unavailable:
            def OpenProcess(self, *arguments):
                raise OSError(126, 'The specified module could not be found')
        self.assertTrue(plow_agent.windows_process_alive(4321, Unavailable()))

    def test_windows_never_reaches_for_the_signal_that_would_kill_the_process(self):
        with windows_host(), patch.object(os, 'kill', side_effect=AssertionError('os.kill would terminate it')), \
                self.asking(FakeKernel32(running=[])):
            self.assertFalse(plow_agent.process_alive(os.getpid()))

    def test_the_whole_chain_from_process_alive_to_kernel32_is_the_real_one(self):
        kernel = FakeKernel32(running=[4321], refused=[8765])
        with windows_host(), self.asking(kernel):
            self.assertTrue(plow_agent.process_alive(4321))
            self.assertFalse(plow_agent.process_alive(9999))
            self.assertTrue(plow_agent.process_alive(8765))
        self.assertEqual(kernel.open_handles, 0)

    @staticmethod
    def asking(kernel):
        """Hand this kernel32 to the code that looks one up, so the whole chain is the real one."""
        return patch.object(plow_agent, 'windows_kernel32', lambda: kernel)

    def test_a_kernel32_that_cannot_be_reached_leaves_the_lock_where_it_is(self):
        # The real lookup can only run on Windows. What is pinned here is that it is the branch
        # taken, and that a question this host cannot ask never takes a lock away.
        asked = []

        def unavailable():
            asked.append(True)
            raise OSError(126, 'The specified module could not be found')

        with windows_host(), patch.object(plow_agent, 'windows_kernel32', unavailable):
            self.assertTrue(plow_agent.process_alive(4321))
        self.assertEqual(asked, [True])

    def test_a_lock_left_by_a_killed_installer_is_cleared_on_windows_too(self):
        with tempfile.TemporaryDirectory() as directory, windows_host(), \
                self.asking(FakeKernel32(running=[os.getpid()])):
            path = Path(directory) / 'install.lock'
            path.write_text('4242\n')
            with contextlib.redirect_stdout(io.StringIO()) as out, plow_agent.installation_lock(path):
                self.assertEqual(path.read_text().strip(), str(os.getpid()))
            self.assertFalse(path.exists())
        self.assertEqual(out.getvalue(), 'Removed a stale install lock left by process 4242.\n')

    def test_a_lock_a_running_installer_holds_is_still_refused_and_names_the_file(self):
        with tempfile.TemporaryDirectory() as directory, windows_host(), \
                self.asking(FakeKernel32(running=[4242])):
            path = Path(directory) / 'install.lock'
            path.write_text('4242\n')
            with self.assertRaises(plow_agent.AgentError) as error:
                with plow_agent.installation_lock(path):
                    self.fail('entered a lock that a live process holds')
            self.assertEqual(path.read_text(), '4242\n')
        self.assertIn(str(path), str(error.exception))


class WindowsWordingTests(unittest.TestCase):
    def test_what_to_run_is_typed_the_way_this_host_types_it(self):
        with tempfile.TemporaryDirectory() as directory, windows_host() as windows:
            install = Installation(directory)
            install.windows = windows
            install.lines = [line('ln_a', name='Alder'), line('ln_b', name='Birch')]
            self.assertEqual(install.run(), 2)
            told = install.err.getvalue()
        self.assertIn('python relay agent --line <position>', told)
        self.assertNotIn('./relay', told)

    def test_the_same_message_is_typed_for_this_host_when_nothing_is_faked(self):
        with tempfile.TemporaryDirectory() as directory:
            install = Installation(directory)
            install.lines = [line('ln_a', name='Alder'), line('ln_b', name='Birch')]
            self.assertEqual(install.run(), 2)
        self.assertIn(f'{RELAY} agent --line <position>', install.err.getvalue())


if __name__ == '__main__':
    unittest.main()
