"""Installer control-flow tests. Docker/downloads are fixtures, not live runs."""
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class EasyStart(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='relay start ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.app = self.root / 'source app'
        self.app.mkdir()
        for name in ('start.sh', 'compose.local.yaml'):
            shutil.copy(ROOT / name, self.app / name)
        self.log = self.root / 'calls'
        self.env = dict(os.environ, PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
                        RELAY_BUILD='1', RELAY_NO_OPEN='1', RELAY_INSTALL_DIR=str(self.root / 'installed app'),
                        CALLS=str(self.log), DOCKER_CONTEXT='', DOCKER_HOST='',
                        FAIL_UP='0', DOCKER_DOWN='0', ENDPOINT='unix:///test/docker.sock')
        self.env.pop('RELAY_IMAGE', None)
        self.script('docker', '''#!/bin/sh
printf '%s\\n' "$*" >> "$CALLS"
case "$*" in
  info) [ "$DOCKER_DOWN" = 0 ]; exit ;;
  context*) printf '%s\\n' "$ENDPOINT"; exit ;;
  *'up -d'*) [ "$FAIL_UP" = 0 ]; exit ;;
  pull*) exit 1 ;;
esac
exit 0
''')
        self.script('open', '#!/bin/sh\nprintf "OPEN\\n" >> "$CALLS"\n')

    def script(self, name, content):
        path = self.bin / name
        path.write_text(content)
        path.chmod(0o755)

    def run_script(self, script='start.sh', *args):
        return subprocess.run(['sh', str(self.app / script), *args], env=self.env,
                              capture_output=True, text=True)

    def calls(self):
        return self.log.read_text() if self.log.exists() else ''

    def test_start_in_path_with_spaces_waits_for_readiness(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('up -d --build --wait --wait-timeout 180', self.calls())
        self.assertIn('Ready: http://127.0.0.1:8178', result.stdout)

    def test_failed_start_does_not_claim_ready_or_open_browser(self):
        self.env.update(FAIL_UP='1', RELAY_NO_OPEN='0')
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('Ready:', result.stdout)
        self.assertNotIn('OPEN', self.calls())
        self.assertNotIn('down', self.calls())

    def test_stopped_docker_has_actionable_error(self):
        self.env['DOCKER_DOWN'] = '1'
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Docker is not running', result.stderr)
        self.assertNotIn('up -d', self.calls())

    def test_remote_context_is_rejected_even_with_local_docker_host(self):
        self.env.update(DOCKER_CONTEXT='remote', DOCKER_HOST='unix:///local.sock', ENDPOINT='ssh://remote')
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('up -d', self.calls())

    def test_stop_preserves_volumes(self):
        self.assertEqual(self.run_script('start.sh', 'stop').returncode, 0)
        self.assertIn(' stop', self.calls())
        self.assertNotIn('--volumes', self.calls())

    def test_connected_profile_is_saved_and_reused(self):
        for name in ('connect.sh', 'compose.connected.yaml'):
            shutil.copy(ROOT / name, self.app / name)
        result = self.run_script('connect.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.app / '.relay-connected').exists())
        self.assertIn('compose.connected.yaml', self.calls())
        self.assertIn('launch.py status', self.calls())
        self.assertEqual(self.run_script('start.sh', 'stop').returncode, 0)
        self.assertIn('--profile discord --profile notes stop', self.calls())

    def test_normal_start_resumes_explicitly_saved_notes_mode(self):
        (self.app / '.relay-connected').write_text('1')
        (self.app / '.relay-discord-mode').write_text('notes')
        self.assertEqual(self.run_script().returncode, 0)
        self.assertIn('--profile notes up -d', self.calls())
        self.assertNotIn('prepare_notes.py', self.calls())

    def test_bad_saved_image_is_not_executed(self):
        self.env['RELAY_BUILD'] = '0'
        (self.app / '.relay-image').write_text('$(touch SHOULD_NOT_EXIST)')
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.app / 'SHOULD_NOT_EXIST').exists())
        self.assertNotIn('up -d', self.calls())

    def test_missing_package_falls_back_without_requesting_registry_login(self):
        self.env['RELAY_BUILD'] = '0'
        result = self.run_script()
        self.assertEqual(result.returncode, 0)
        self.assertIn('Building the included source', result.stdout)
        self.assertNotIn('login', self.calls())
        self.assertEqual((self.app / '.relay-image').read_text().strip(), 'source')
        self.assertEqual(self.run_script().returncode, 0)
        self.assertEqual(self.calls().count('pull ghcr.io'), 1)

    def installer(self):
        shutil.copy(ROOT / 'install.sh', self.app / 'install.sh')
        archive = self.root / 'source.tar.gz'
        with tarfile.open(archive, 'w:gz') as output:
            output.add(self.app, arcname='repro-relay-main')
        self.env['ARCHIVE'] = str(archive)
        self.script('curl', '''#!/bin/sh
printf 'DOWNLOAD\\n' >> "$CALLS"
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then cp "$ARCHIVE" "$2"; exit; fi
  shift
done
exit 1
''')

    def test_install_then_reuse_preserves_files_and_avoids_redownload(self):
        self.installer()
        result = self.run_script('install.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        installed = Path(self.env['RELAY_INSTALL_DIR'])
        (installed / 'keep.txt').write_text('existing data')
        result = self.run_script('install.sh')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((installed / 'keep.txt').read_text(), 'existing data')
        self.assertEqual(self.calls().count('DOWNLOAD'), 1)
        self.assertFalse(Path(str(installed) + '.installing').exists())

    def test_existing_unmanaged_directory_is_not_overwritten(self):
        self.installer()
        installed = Path(self.env['RELAY_INSTALL_DIR'])
        installed.mkdir()
        (installed / 'keep.txt').write_text('data')
        result = self.run_script('install.sh')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((installed / 'keep.txt').read_text(), 'data')
        self.assertNotIn('DOWNLOAD', self.calls())

    def test_failed_download_cleans_staging_and_releases_lock(self):
        self.installer()
        self.script('curl', '#!/bin/sh\nexit 22\n')
        self.assertNotEqual(self.run_script('install.sh').returncode, 0)
        self.assertFalse(Path(self.env['RELAY_INSTALL_DIR']).exists())
        self.assertFalse(Path(self.env['RELAY_INSTALL_DIR'] + '.installing').exists())
        self.assertFalse(list(self.root.glob('.relay-download.*')))


if __name__ == '__main__':
    unittest.main()
