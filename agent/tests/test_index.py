import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / 'integrations/relay-terminal'))
spec = importlib.util.spec_from_file_location('relay_index', ROOT / 'index.py')
index = importlib.util.module_from_spec(spec)
spec.loader.exec_module(index)

from fake_windows import symlinks_available, windows_host  # noqa: E402  (the installer's own Windows fakes)
import private_files  # noqa: E402


class IndexWrapper(unittest.TestCase):
    def test_credentials_are_data_and_require_private_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'credentials'
            path.write_text('PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN="$(not-a-command)"\n')
            private_files.protect(path)  # however this host makes a file private
            self.assertEqual(index.credentials(path)['PLOW_AGENT_TOKEN'], '$(not-a-command)')
            if os.name == 'posix':
                # Opening it to other accounts is a mode change here; the Windows refusal is
                # in WindowsCredentialTests, where the access list says it.
                path.chmod(0o644)
                with self.assertRaises(ValueError):
                    index.credentials(path)
                private_files.protect(path)
            if symlinks_available():  # needs SeCreateSymbolicLinkPrivilege on Windows
                link = Path(folder) / 'link'
                link.symlink_to(path)
                with self.assertRaises((OSError, ValueError)):  # ELOOP here, a refusal by name on Windows
                    index.credentials(link)

    def test_credentials_reject_wrong_origin_and_duplicates(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'credentials'
            for body in ['PLOW_API_BASE=https://example.com\nPLOW_AGENT_TOKEN=x',
                         'PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=x\nPLOW_AGENT_TOKEN=y']:
                path.write_text(body)
                private_files.protect(path)
                with self.assertRaises(ValueError):
                    index.credentials(path)

    def test_corrupted_cached_client_never_runs(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            cache = home / '.relay-index-client'
            cache.mkdir()
            pin = dict(line.split('=', 1) for line in (ROOT / 'vendor/client.pin').read_text().splitlines()
                       if line and not line.startswith('#'))
            (cache / (pin['sha'] + '.py')).write_text('print("tampered")')
            with patch.object(index.urllib.request, 'urlopen') as network:
                with self.assertRaises(ValueError):
                    index.client(home)
                network.assert_not_called()

    def test_reporting_has_no_plow_credential_or_inherited_secret(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder)
            (home / 'state.db').touch()
            with patch.object(index, 'client', return_value=home / 'client.py'), \
                 patch.object(index.os, 'access', return_value=False), \
                 patch.object(index.subprocess, 'run') as run:
                run.return_value.returncode = 0
                self.assertEqual(index.main(['report', '--hermes-home', folder]), 0)
                env = run.call_args.kwargs['env']
                self.assertNotIn('PLOW_AGENT_TOKEN', env)
                self.assertEqual(env['HERMES_HOME'], str(home.resolve()))


class WindowsCredentialTests(unittest.TestCase):
    """The check used to demand a POSIX mode, which no file on Windows can have."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / 'plow-credentials'
        self.path.write_text('PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=agt_fixture_token\n')

    def test_a_credential_locked_to_this_account_is_read_where_a_mode_could_never_pass(self):
        with windows_host():
            self.path.chmod(0o600)  # what the old check asked for, and what Windows ignores
            with self.assertRaises(ValueError) as error:
                index.credentials(self.path)
            self.assertIn('icacls', str(error.exception))
            private_files.protect(self.path)
            self.assertEqual(index.credentials(self.path)['PLOW_AGENT_TOKEN'], 'agt_fixture_token')

    def test_a_credential_another_account_can_read_is_still_refused(self):
        with windows_host() as windows:
            windows.access[str(self.path)] = ['runneradmin', 'NT AUTHORITY\\SYSTEM', 'Everyone']
            with self.assertRaises(ValueError):
                index.credentials(self.path)

    @unittest.skipUnless(symlinks_available(), 'this host does not let this account create a link')
    def test_a_link_where_the_credential_should_be_is_refused(self):
        link = self.path.with_name('link')
        link.symlink_to(self.path)
        with windows_host():
            private_files.protect(link)
            with self.assertRaises(ValueError):
                index.credentials(link)


if __name__ == '__main__':
    unittest.main()
