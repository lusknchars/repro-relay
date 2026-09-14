"""Repeatable source setup. Local services only; no account or provider provisioning."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[2]
URL = 'http://127.0.0.1:8178'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def health():
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(URL + '/api/v1/health', timeout=2) as response:
            data = json.loads(response.read(8192))
        return isinstance(data, dict) and data.get('status') == 'ok' and data.get('backend') == 'rust' and data.get('database') == 'postgresql' and data.get('mode') == 'local'
    except (OSError, ValueError):
        return False


def port_in_use():
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex(('127.0.0.1', 8178)) == 0


def environment():
    env = os.environ.copy()
    env['PATH'] = str(Path.home() / '.cargo/bin') + os.pathsep + env.get('PATH', '')
    return env


def prerequisites(env, desktop):
    missing = []
    for tool, hint in [('node', 'Install Node.js 24 LTS.'), ('npm', 'Install npm with Node.js.'), ('cargo', 'Install Rust stable with rustup.')]:
        if not shutil.which(tool, path=env['PATH']):
            missing.append(hint)
    if shutil.which('node', path=env['PATH']):
        result = subprocess.run(['node', '--version'], env=env, capture_output=True, text=True, timeout=10)
        if result.returncode or int(result.stdout.strip().lstrip('v').split('.')[0]) < 24:
            missing.append('Node.js 24 or newer is required.')
    if not env.get('DATABASE_URL'):
        if not shutil.which('docker', path=env['PATH']):
            missing.append('Install and start Docker with Compose, or provide DATABASE_URL for an existing PostgreSQL server.')
        else:
            for command in (['docker', 'compose', 'version'], ['docker', 'info']):
                if subprocess.run(command, env=env, capture_output=True, timeout=15).returncode:
                    missing.append('Start Docker and check that docker compose is available.')
                    break
    if desktop and subprocess.run(['xcode-select', '-p'], capture_output=True, timeout=10).returncode:
        missing.append('Install Xcode command-line tools: xcode-select --install')
    return missing


def install_dependencies(root, env, run):
    """A receipt belongs to node_modules so deleting that directory invalidates it."""
    for relative in ('web', 'web/reptest'):
        directory = root / relative
        digest = hashlib.sha256((directory / 'package-lock.json').read_bytes() + (directory / 'package.json').read_bytes()).hexdigest()
        receipt = directory / 'node_modules/.relay-install'
        if receipt.is_file() and receipt.read_text() == digest:
            print('Dependencies ready: ' + relative, flush=True)
            continue
        run(['npm', 'ci', '--prefix', str(directory)], 'Installing ' + relative)
        receipt.write_text(digest)


def run_setup(args):
    env = environment()
    desktop = sys.platform == 'darwin' and not args.web
    if args.api != URL + '/api/v1' or env.get('REPRO_MODE', 'local') != 'local':
        print('Setup starts a local installation on port 8178. Use the deployment guide for hosted/team services.', file=sys.stderr)
        return 1
    try:
        missing = prerequisites(env, desktop)
        print('Repro Relay setup · ' + ('macOS desktop' if desktop else 'local web app'), flush=True)
        for item in missing:
            print('Needed: ' + item, flush=True)
        if missing:
            return 1
        if args.check:
            print('Prerequisites ready. Local service: ' + ('running' if health() else 'not started'))
            return 0
        if port_in_use() and not health():
            print('Port 8178 is occupied by an unrecognized or unhealthy service. Resolve it before setup; no process was stopped.', file=sys.stderr)
            return 1
        state = ROOT / '.data/setup'
        state.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(state, 0o700)
        # Exclusive creation prevents simultaneous installs. The finally block
        # clears the lock on normal failures and keyboard interruption.
        lock = state / 'setup.lock'
        try:
            descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            print('Setup is already running. If it was terminated, remove .data/setup/setup.lock after checking no setup process remains.', file=sys.stderr)
            return 1
        os.close(descriptor)
        try:
            def run(command, label):
                print(label + '…', flush=True)
                subprocess.run(command, cwd=ROOT, env=env, check=True)

            install_dependencies(ROOT, env, run)
            if not env.get('DATABASE_URL'):
                run(['docker', 'compose', 'up', '-d', '--wait', 'db'], 'Starting PostgreSQL')
            run(['cargo', 'build', '-p', 'relay-api', '--locked'], 'Building the local service')
            if desktop:
                run(['npm', 'run', 'tauri', '--prefix', 'web', '--', 'build', '--debug'], 'Building Repro Relay')
            else:
                run(['npm', 'run', 'build', '--prefix', 'web'], 'Building the interface')
            if health():
                print('Using the existing local service. Restart it separately to load backend source changes.', flush=True)
            else:
                if port_in_use():
                    raise RuntimeError('Port 8178 became occupied. No process was stopped.')
                env['PORT'] = '8178'
                env['REPRO_PORT'] = '8178'
                binary = ROOT / ('target/debug/relay-api.exe' if os.name == 'nt' else 'target/debug/relay-api')
                logfile = state / 'service.log'
                fd = os.open(logfile, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600)
                os.chmod(logfile, 0o600)
                with os.fdopen(fd, 'ab') as output:
                    process = subprocess.Popen([str(binary)], cwd=ROOT, env=env, stdin=subprocess.DEVNULL, stdout=output, stderr=output, start_new_session=os.name != 'nt')
                (state / 'service.pid').write_text(str(process.pid))
                deadline = time.monotonic() + 30
                while not health():
                    if process.poll() is not None or time.monotonic() >= deadline:
                        if process.poll() is None:
                            process.terminate()
                            process.wait(timeout=5)
                        raise RuntimeError('Local service could not start. Inspect .data/setup/service.log; it may contain private configuration details.')
                    time.sleep(0.5)
            if not args.no_open:
                if desktop:
                    run(['open', str(ROOT / 'target/debug/bundle/macos/Repro Relay.app')], 'Opening Repro Relay')
                else:
                    webbrowser.open(URL)
            print('Ready. Open Account in the top-right corner to sign in or create your local account.')
            print('Desktop: target/debug/bundle/macos/Repro Relay.app' if desktop else 'Local app: ' + URL)
            print('Provider accounts are optional. Existing Plow, Pi and memory credentials are unchanged.')
            return 0
        finally:
            lock.unlink(missing_ok=True)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        # Do not echo subprocess environments, response bodies or credentials.
        print('Setup failed: ' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__) + '. Fix the failed step and run ./relay setup again.', file=sys.stderr)
        return 1
