import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('relay_index', ROOT / 'index.py')
index = importlib.util.module_from_spec(spec)
spec.loader.exec_module(index)


class IndexWrapper(unittest.TestCase):
    def test_credentials_are_data_and_require_private_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'credentials'
            path.write_text('PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN="$(not-a-command)"\n')
            path.chmod(0o600)
            self.assertEqual(index.credentials(path)['PLOW_AGENT_TOKEN'], '$(not-a-command)')
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                index.credentials(path)
            path.chmod(0o600)
            link = Path(folder) / 'link'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                index.credentials(link)

    def test_credentials_reject_wrong_origin_and_duplicates(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'credentials'
            for body in ['PLOW_API_BASE=https://example.com\nPLOW_AGENT_TOKEN=x',
                         'PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=x\nPLOW_AGENT_TOKEN=y']:
                path.write_text(body)
                path.chmod(0o600)
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


if __name__ == '__main__':
    unittest.main()
