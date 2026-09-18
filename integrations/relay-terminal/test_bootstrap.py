import contextlib
import os
from pathlib import Path
import tempfile
import io
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bootstrap
from fake_windows import FakeWindows, windows_host
import private_files

WINDOWS_PATH = r'C:\Program Files\nodejs;C:\Windows\system32'
NPM = r'C:\Program Files\nodejs\npm.cmd'
NODE = r'C:\Program Files\nodejs\node.exe'


def windows_which(name, path=None, mode=None):
    """shutil.which as Windows answers it: PATHEXT is consulted, so npm is found as npm.cmd."""
    return {'node': NODE, 'npm': NPM, 'cargo': r'C:\Users\runneradmin\.cargo\bin\cargo.exe',
            'docker': r'C:\Program Files\Docker\Docker\resources\bin\docker.exe'}.get(name)


class SetupTests(unittest.TestCase):
    def test_private_env_is_literal_and_process_environment_wins(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'ROOT', Path(directory)), patch.dict(bootstrap.os.environ, {'RELAY_TWILIO_AUTH_TOKEN': 'process-token'}, clear=True):
            config = Path(directory) / '.env'
            config.write_text("RELAY_TWILIO_AUTH_TOKEN=file-token\nRELAY_TWILIO_ACCOUNT_SID=\"ACfixture\" # comment\nLITERAL='$(touch forbidden) $HOME'\n")
            env = bootstrap.environment()
            self.assertEqual(env['RELAY_TWILIO_AUTH_TOKEN'], 'process-token')
            self.assertEqual(env['RELAY_TWILIO_ACCOUNT_SID'], 'ACfixture')
            self.assertEqual(env['LITERAL'], '$(touch forbidden) $HOME')
            config.write_text('INVALID value with private content')
            with self.assertRaisesRegex(ValueError, 'line 1') as error:
                bootstrap.environment()
            self.assertNotIn('private content', str(error.exception))


    def test_health_does_not_accept_unrelated_or_hosted_services(self):
        for body in (b'[]', b'null', b'not json', b'{"status":"ok","backend":"rust","database":"postgresql","mode":"team"}'):
            with patch.object(bootstrap.urllib.request, 'build_opener') as opener:
                opener.return_value.open.return_value = io.BytesIO(body)
                self.assertFalse(bootstrap.health())

    def args(self, **kw):
        return SimpleNamespace(api=bootstrap.URL + '/api/v1', check=False, web=True, no_open=True, **kw)

    def test_lock_receipt_skips_unchanged_install_and_invalidates_on_package_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('web', 'web/reptest'):
                project = root / name
                project.mkdir(parents=True, exist_ok=True)
                (project / 'package.json').write_text('{}')
                (project / 'package-lock.json').write_text('{}')
            calls = []
            def install(command, label):
                calls.append(command)
                (Path(command[-1]) / 'node_modules').mkdir(exist_ok=True)
            bootstrap.install_dependencies(root, {}, install)
            self.assertEqual(len(calls), 2)
            bootstrap.install_dependencies(root, {}, install)
            self.assertEqual(len(calls), 2)
            (root / 'web/reptest/package-lock.json').write_text('{"changed": true}')
            bootstrap.install_dependencies(root, {}, install)
            self.assertEqual(len(calls), 3)

    @patch.object(bootstrap, 'prerequisites', return_value=[])
    @patch.object(bootstrap, 'environment', return_value={})
    def test_check_never_installs_starts_or_opens(self, *_):
        args = self.args(); args.check = True
        with patch.object(bootstrap, 'health', return_value=False), patch.object(bootstrap.subprocess, 'run') as run, patch.object(bootstrap.subprocess, 'Popen') as spawn, patch.object(bootstrap.webbrowser, 'open') as browser:
            self.assertEqual(bootstrap.run_setup(args), 0)
            run.assert_not_called(); spawn.assert_not_called(); browser.assert_not_called()

    @patch.object(bootstrap, 'prerequisites', return_value=[])
    @patch.object(bootstrap, 'environment', return_value={})
    def test_occupied_non_relay_port_aborts_before_mutations(self, *_):
        with patch.object(bootstrap, 'port_in_use', return_value=True), patch.object(bootstrap, 'health', return_value=False), patch.object(bootstrap, 'install_dependencies') as install:
            self.assertEqual(bootstrap.run_setup(self.args()), 1)
            install.assert_not_called()

    @patch.object(bootstrap, 'prerequisites', return_value=[])
    @patch.object(bootstrap, 'environment', return_value={'DATABASE_URL':'private-test-value'})
    def test_repeat_setup_reuses_service_and_preserves_database(self, *_):
        # Making .data/setup private is a subprocess call on Windows, and this test replaces
        # subprocess wholesale, so icacls is answered rather than left to a bare mock.
        host = FakeWindows(user=private_files.account_name(),
                           fallback=lambda command, **options: SimpleNamespace(returncode=0, stdout='', stderr=''))
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'ROOT', Path(directory)), patch.object(bootstrap, 'health', return_value=True), patch.object(bootstrap, 'port_in_use', return_value=True), patch.object(bootstrap, 'install_dependencies'), patch.object(bootstrap.subprocess, 'run', side_effect=host.run) as run, patch.object(bootstrap.subprocess, 'Popen') as spawn, patch.object(bootstrap.webbrowser, 'open') as browser:
            for _ in range(2):
                self.assertEqual(bootstrap.run_setup(self.args()), 0)
            spawn.assert_not_called(); browser.assert_not_called()
            self.assertFalse((Path(directory) / '.data/setup/setup.lock').exists())
            commands = [call.args[0] for call in run.call_args_list if call.args[0][0] != 'icacls']
            self.assertFalse(any('docker' in command for command in commands))
            self.assertTrue(all('build' in command for command in commands))

    def test_a_private_env_is_read_as_utf8_whatever_the_console_code_page_is(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'ROOT', Path(directory)), \
                patch.dict(bootstrap.os.environ, {}, clear=True):
            (Path(directory) / '.env').write_bytes('RELAY_TWILIO_ACCOUNT_SID=ACaçaí\n'.encode('utf-8'))
            self.assertEqual(bootstrap.environment()['RELAY_TWILIO_ACCOUNT_SID'], 'ACaçaí')

    def test_a_host_that_will_not_say_where_home_is_still_gets_a_path(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'ROOT', Path(directory)), \
                patch.dict(bootstrap.os.environ, {'PATH': '/usr/bin'}, clear=True), \
                patch.object(bootstrap.os.path, 'expanduser', lambda path: path):
            self.assertEqual(bootstrap.environment()['PATH'], '/usr/bin')


class WindowsSetupTests(unittest.TestCase):
    """Setup on the host where npm is a .cmd and only an ACL makes a file private."""

    def args(self, **kw):
        return SimpleNamespace(api=bootstrap.URL + '/api/v1', check=False, web=True, no_open=True, **kw)

    def project(self, root):
        for name in ('web', 'web/reptest'):
            project = root / name
            project.mkdir(parents=True)
            (project / 'package.json').write_text('{}')
            (project / 'package-lock.json').write_text('{}')

    def test_it_starts_the_npm_the_prerequisite_check_already_found(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.project(root)
            started = []

            def other(command, **options):
                started.append(command)
                if command[1:2] == ['ci']:
                    (Path(command[-1]) / 'node_modules').mkdir(exist_ok=True)
                return SimpleNamespace(returncode=0, stdout='', stderr='')

            with windows_host(run=other), patch.object(bootstrap, 'ROOT', root), \
                    patch.object(bootstrap.shutil, 'which', windows_which), \
                    patch.object(bootstrap, 'prerequisites', return_value=[]), \
                    patch.object(bootstrap, 'environment',
                                 return_value={'PATH': WINDOWS_PATH, 'DATABASE_URL': 'fixture'}), \
                    patch.object(bootstrap, 'health', return_value=True), \
                    patch.object(bootstrap, 'port_in_use', return_value=True):
                self.assertEqual(bootstrap.run_setup(self.args()), 0)
                self.assertEqual(bootstrap.program('npm', {'PATH': WINDOWS_PATH}), NPM)
        names = [command[0] for command in started]
        self.assertEqual(names.count(NPM), 3)  # ci for web, ci for web/reptest, and the interface build
        self.assertNotIn('npm', names)

    def test_the_setup_folder_and_the_service_log_are_locked_to_this_account(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.project(root)

            def other(command, **options):
                if command[1:2] == ['ci']:
                    (Path(command[-1]) / 'node_modules').mkdir(exist_ok=True)
                return SimpleNamespace(returncode=0, stdout='', stderr='')

            with windows_host(run=other) as windows, patch.object(bootstrap, 'ROOT', root), \
                    patch.object(bootstrap.shutil, 'which', windows_which), \
                    patch.object(bootstrap, 'prerequisites', return_value=[]), \
                    patch.object(bootstrap, 'environment',
                                 return_value={'PATH': WINDOWS_PATH, 'DATABASE_URL': 'fixture'}), \
                    patch.object(bootstrap, 'health', side_effect=[False, True]), \
                    patch.object(bootstrap, 'port_in_use', return_value=False), \
                    patch.object(bootstrap.subprocess, 'Popen') as spawn:
                self.assertEqual(bootstrap.run_setup(self.args()), 0)
                # The name Windows gives the built service, and no session of its own, which
                # Windows has no equivalent for.
                self.assertEqual(spawn.call_args.args[0], [str(root / 'target/debug/relay-api.exe')])
                self.assertFalse(spawn.call_args.kwargs['start_new_session'])
                state = root / '.data/setup'
                self.assertTrue(private_files.is_private(state))
                self.assertTrue(private_files.is_private(state / 'service.log'))
                self.assertEqual(windows.principals(state / 'service.log'),
                                 ['runneradmin', 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators'])
                # chmod is what this used to rely on, and it changes nothing here.
                self.assertNotEqual(os.stat(state / 'service.log').st_mode & 0o777, 0)

    def test_setup_stops_and_says_why_when_a_folder_cannot_be_made_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            errors = io.StringIO()
            with windows_host(), patch.object(bootstrap, 'ROOT', root), \
                    patch.object(bootstrap, 'prerequisites', return_value=[]), \
                    patch.object(bootstrap, 'environment', return_value={'PATH': WINDOWS_PATH}), \
                    patch.object(bootstrap, 'health', return_value=True), \
                    patch.object(bootstrap, 'port_in_use', return_value=True), \
                    patch.dict(bootstrap.os.environ, {'USERNAME': 'someone-else'}), \
                    contextlib.redirect_stderr(errors):
                self.assertEqual(bootstrap.run_setup(self.args()), 1)
        self.assertIn('.data', errors.getvalue())
        self.assertIn('python relay setup', errors.getvalue())


if __name__ == '__main__':
    unittest.main()
