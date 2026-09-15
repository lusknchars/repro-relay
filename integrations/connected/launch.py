"""Connected Docker profile. No live model request is made by setup."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'integrations/hermes-assessment'))
import provider_setup

STATE = ROOT / '.data/hermes-assessment'


def initialize(state=STATE):
    import secrets
    with provider_setup.locked(state):
        env_path = state / '.env'
        if not env_path.exists():
            fd = os.open(env_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, 'w') as out:
                out.write('API_SERVER_KEY=' + secrets.token_hex(32) + '\nAPI_SERVER_ENABLED=true\nAPI_SERVER_HOST=127.0.0.1\nAPI_SERVER_PORT=8642\n')
                out.flush(); os.fsync(out.fileno())
        values = provider_setup.profile_env(state)
        if (not re.fullmatch(r'[a-f0-9]{64}', values.get('API_SERVER_KEY', ''))
                or values.get('API_SERVER_HOST') != '127.0.0.1'
                or values.get('API_SERVER_PORT') != '8642'):
            raise ValueError('Existing Hermes transport configuration differs. It was preserved; use the basic installer or reconcile this profile explicitly.')
        config_path = state / 'config.yaml'
        if not config_path.exists():
            provider_setup.private_write(config_path, {
                'model': {'provider': 'openai-api', 'default': 'gpt-5.4'},
                'agent': {'max_turns': 20},
                'tools': {'tool_search': {'enabled': 'off'}},
                'platform_toolsets': {'api_server': ['relay_evidence'], 'cli': ['relay_evidence']},
                'memory': {'memory_enabled': False, 'user_profile_enabled': False},
                'mcp_servers': {'relay_evidence': {
                    'command': '/usr/local/bin/python3',
                    'args': ['/app/integrations/relay-tools/server.py'],
                    'sampling': {'enabled': False}}},
            })
        provider_setup.validate_profile(provider_setup.read_json(config_path))
    return values['API_SERVER_KEY']


def application():
    key = initialize()
    env = os.environ.copy()
    if env.get('REPRO_HERMES_URL') or env.get('REPRO_HERMES_KEY'):
        raise ValueError('Connected setup will not replace an explicitly configured runner.')
    env.update(REPRO_HERMES_URL='http://127.0.0.1:8642', REPRO_HERMES_KEY=key)
    os.execve('/app/relay-api', ['/app/relay-api'], env)


def gateway():
    initialize()
    child = None
    stopping = False
    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True
        if child and child.poll() is None:
            child.terminate()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print('Hermes installed. Waiting for a model credential in Repro Settings → Models. No model runs during setup.', flush=True)
    while not stopping:
        if provider_setup.status(STATE)['credential_saved']:
            env = os.environ.copy()
            env['HERMES_HOME'] = str(STATE)
            provider_setup.apply_runtime(STATE, env)
            child = subprocess.Popen(['/opt/hermes/.venv/bin/hermes', 'gateway'], cwd=STATE, env=env)
            try:
                return child.wait()
            finally:
                if child.poll() is None:
                    child.terminate()
                    child.wait(timeout=30)
        time.sleep(2)
    return 0


def status():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:8178/api/v1/runner', timeout=8) as response:
        value = json.loads(response.read(8192))
    if value.get('available'):
        print('Hermes runtime connected. Model access is checked only when you authorize a run.')
    else:
        print('Repro is ready. Hermes needs setup: open Settings → Models and save your provider and API key. If already saved, inspect ./start.sh logs.')


if __name__ == '__main__':
    try:
        action = sys.argv[1]
        if action == 'app': application()
        elif action == 'hermes': sys.exit(gateway())
        elif action == 'status': status()
        else: raise ValueError('Unknown connected setup action.')
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        print('Connected setup could not complete. Existing settings were preserved. Inspect the private profile and service logs; do not paste credentials.', file=sys.stderr)
        sys.exit(1)
