"""Exercise the shipped container against a disposable, isolated database.

Requires an already-built relay-package:test image. Never touches a developer's
Relay services, ports or volumes. This tests real HTTP/storage, not a model.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]


def main():
    project = 'relay-package-test-' + uuid.uuid4().hex[:12]
    env = dict(os.environ, RELAY_IMAGE='relay-package:test')
    config = json.loads(subprocess.check_output(
        ['docker', 'compose', '--env-file', '/dev/null', '-f',
         str(ROOT / 'compose.local.yaml'), 'config', '--format', 'json'],
        env=env, text=True))
    # Check the actual shipped isolation before assigning a random test port.
    app = config['services']['app']
    assert app['ports'][0]['host_ip'] == '127.0.0.1'
    assert not config['services']['db'].get('ports')
    config['name'] = project
    app.pop('build', None)
    app['ports'][0]['published'] = '0'
    for category in ('volumes', 'networks'):
        for name, definition in config.get(category, {}).items():
            assert not definition.get('external')
            definition['name'] = project + '_' + name
    with tempfile.TemporaryDirectory(prefix='relay-package-') as directory:
        path = Path(directory) / 'compose.json'
        path.write_text(json.dumps(config))
        command = ['docker', 'compose', '-p', project, '-f', str(path)]

        def compose(*args):
            return subprocess.check_output(command + list(args), text=True)

        try:
            compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '180')
            endpoint = compose('port', 'app', '8178').strip()
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def request(path, data=None, origin='http://127.0.0.1:8178', host='127.0.0.1:8178'):
                headers = {'Host': host, 'Origin': origin, 'Content-Type': 'application/json'}
                req = urllib.request.Request('http://' + endpoint + path,
                    data=None if data is None else json.dumps(data).encode(), headers=headers)
                return opener.open(req, timeout=15)

            with request('/api/v1/health') as response:
                health = json.load(response)
                assert health['status'] == 'ok' and health['mode'] == 'local'
            with request('/') as response:
                assert b'<html' in response.read().lower()
            # A fresh install needs neither an existing owner nor SMS credentials.
            with request('/api/v1/account/local', {}) as response:
                assert json.load(response)['authenticated']
                assert 'HttpOnly' in response.headers['Set-Cookie']
            for headers in ({'origin': 'https://evil.example'}, {'host': 'evil.example'}):
                try:
                    request('/api/v1/cases', **headers)
                except urllib.error.HTTPError as error:
                    assert error.code == 403
                else:
                    raise AssertionError('Foreign origin or host was accepted')
            with request('/api/v1/cases', {
                'title': 'Container persistence fixture', 'project': 'Package test',
                'url': 'https://example.com', 'description': 'Synthetic installation test',
                'expected': 'Retained after restart', 'build': 'package-test',
            }) as response:
                record = json.load(response)
            compose('exec', '-T', 'app', 'sh', '-c', 'echo preserved > /app/.data/package-test')
            # Recreate both services and their anonymous filesystem layers.
            compose('down')
            compose('up', '-d', '--no-build', '--wait', '--wait-timeout', '180')
            endpoint = compose('port', 'app', '8178').strip()
            with request('/api/v1/cases/' + record['id']) as response:
                assert json.load(response)['id'] == record['id']
            assert compose('exec', '-T', 'app', 'cat', '/app/.data/package-test').strip() == 'preserved'
            with request('/api/v1/account/local', {}) as response:
                assert json.load(response)['authenticated']
            assert compose('exec', '-T', 'db', 'psql', '-U', 'relay', '-d', 'relay', '-Atc',
                           "SELECT count(*) FROM team_members WHERE role='owner'").strip() == '1'
            compose('exec', '-T', 'app', 'python3', 'integrations/google-calendar/connect.py', '--help')
            print('PASS: fresh install, frontend, no-login access, origin/host checks, '
                  'database/settings persistence, owner reuse and integration executable.')
        except Exception:
            print(compose('logs', '--tail', '50', 'app'))
            raise
        finally:
            # Only this test's randomized project and disposable volumes.
            compose('down', '--volumes')


if __name__ == '__main__':
    main()
