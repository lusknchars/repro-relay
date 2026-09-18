from pathlib import Path
import tempfile
import io
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import bootstrap


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
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'ROOT', Path(directory)), patch.object(bootstrap, 'health', return_value=True), patch.object(bootstrap, 'port_in_use', return_value=True), patch.object(bootstrap, 'install_dependencies'), patch.object(bootstrap.subprocess, 'run') as run, patch.object(bootstrap.subprocess, 'Popen') as spawn, patch.object(bootstrap.webbrowser, 'open') as browser:
            for _ in range(2):
                self.assertEqual(bootstrap.run_setup(self.args()), 0)
            spawn.assert_not_called(); browser.assert_not_called()
            self.assertFalse((Path(directory) / '.data/setup/setup.lock').exists())
            commands = [call.args[0] for call in run.call_args_list]
            self.assertFalse(any('docker' in command for command in commands))
            self.assertTrue(all('build' in command for command in commands))


    @patch.object(bootstrap, 'prerequisites', return_value=[])
    @patch.object(bootstrap, 'environment', return_value={'DATABASE_URL': 'private-test-value'})
    def test_command_shims_are_resolved_before_execution(self, *_):
        """Windows ships npm as npm.cmd and CreateProcess runs no PATHEXT search,
        so a bare 'npm' raises FileNotFoundError however well which() finds it."""
        shims = {'cargo': r'C:\shims\cargo.EXE', 'npm': r'C:\shims\npm.CMD'}
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'ROOT', Path(directory)), patch.object(bootstrap, 'health', return_value=True), patch.object(bootstrap, 'port_in_use', return_value=True), patch.object(bootstrap, 'install_dependencies'), patch.object(bootstrap.shutil, 'which', side_effect=lambda name, path=None: shims.get(name)), patch.object(bootstrap.subprocess, 'run') as run, patch.object(bootstrap.webbrowser, 'open'):
            self.assertEqual(bootstrap.run_setup(self.args()), 0)
            commands = [call.args[0] for call in run.call_args_list]
            self.assertEqual([command[0] for command in commands], [shims['cargo'], shims['npm']])
            self.assertEqual(commands[1][1:], ['run', 'build', '--prefix', 'web'])

    @patch.object(bootstrap, 'prerequisites', return_value=[])
    @patch.object(bootstrap, 'environment', return_value={'DATABASE_URL': 'private-test-value'})
    def test_unresolvable_command_keeps_its_name_for_the_failure(self, *_):
        """Falling back to the bare name leaves the reported failure legible."""
        with tempfile.TemporaryDirectory() as directory, patch.object(bootstrap, 'ROOT', Path(directory)), patch.object(bootstrap, 'health', return_value=True), patch.object(bootstrap, 'port_in_use', return_value=True), patch.object(bootstrap, 'install_dependencies'), patch.object(bootstrap.shutil, 'which', return_value=None), patch.object(bootstrap.subprocess, 'run') as run, patch.object(bootstrap.webbrowser, 'open'):
            self.assertEqual(bootstrap.run_setup(self.args()), 0)
            self.assertEqual([call.args[0][0] for call in run.call_args_list], ['cargo', 'npm'])


if __name__ == '__main__':
    unittest.main()
