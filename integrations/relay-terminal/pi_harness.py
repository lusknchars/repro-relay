"""Launch Pi with Relay evidence tools and a separate local profile."""
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
INTEGRATION = ROOT / 'integrations/pi-harness'
PROFILE = ROOT / '.data/pi-agent'
TOOLS = ('relay_workspace_status', 'relay_list_work', 'relay_inspect_work')


def environment(profile=PROFILE):
    return {**os.environ, 'PI_CODING_AGENT_DIR': str(profile),
            'RELAY_PI_PYTHON': sys.executable, 'PI_OFFLINE': '1'}


def provider_status(executable, provider, profile):
    try:
        result = subprocess.run([executable, 'auth', 'check', '--provider', provider, '--json', '--no-refresh'],
                                capture_output=True, text=True, timeout=15, env=environment(profile))
        data = json.loads(result.stdout)
        # Never return credentials, provider error bodies or arbitrary CLI output.
        if isinstance(data, dict) and data.get('provider') == provider:
            if result.returncode == 0 and data.get('status') == 'ready':
                return 'ready'
            if data.get('status') == 'not_ready':
                return 'not_ready'
    except (OSError, ValueError, subprocess.SubprocessError):
        pass
    return 'check_failed'


def check(api, executable=None, profile=PROFILE, provider=None):
    executable = executable or shutil.which('pi')
    result = {'harness': 'pi', 'installed': False, 'version': None,
              'workspace': 'unavailable', 'provider': 'not_checked',
              'model_started': False, 'tools': list(TOOLS),
              'next': 'Install Pi from https://pi.dev, then run ./relay pi doctor.'}
    if executable:
        version = subprocess.run([executable, '--version'], capture_output=True, text=True, timeout=10, env=environment(profile))
        if version.returncode == 0 and re.fullmatch(r'\d+\.\d+\.\d+(?:[-+][\w.-]+)?', version.stdout.strip()):
            result.update(installed=True, version=version.stdout.strip())
            if provider:
                result.update(provider=provider_status(executable, provider, profile), provider_name=provider,
                              provider_check='Local credential readiness only; no refresh or model request.')
    connection = subprocess.run([sys.executable, str(INTEGRATION / 'bridge.py'), api,
                                 TOOLS[0], '{}'], capture_output=True, text=True, timeout=15)
    if connection.returncode == 0:
        data = json.loads(connection.stdout)
        result.update(workspace='reachable', repository=data.get('repository'),
                      monitor_connected=data.get('connected'), monitor_paused=data.get('paused'))
    if result['installed']:
        result['next'] = ('Run ./relay pi start, then /login if needed. /relay reads evidence; '
                          '/relay-review asks your selected model to assess it.' if result['workspace'] == 'reachable'
                          else 'Start make dev, then run ./relay pi doctor again.')
    return result


def launch_command(executable, provider=None, model=None, resume=False, profile=PROFILE):
    command = [executable, '--no-extensions', '--no-skills', '--no-prompt-templates',
               '--no-themes', '--no-context-files', '--no-approve', '--no-builtin-tools',
               '--tools', ','.join(TOOLS), '-e', str(INTEGRATION / 'relay.ts'),
               '--session-dir', str(profile / 'sessions'), '--append-system-prompt', str(INTEGRATION / 'instructions.md')]
    if provider:
        command += ['--provider', provider]
    if model:
        command += ['--model', model]
    if resume:
        command += ['--continue']
    return command


def run(args):
    profile = pathlib.Path.home() / '.pi/agent' if args.profile == 'personal' else PROFILE
    if args.pi_action == 'start' and (not sys.stdin.isatty() or not sys.stdout.isatty()):
        raise ValueError('Pi needs an interactive terminal. Open Terminal and run ' + str(ROOT / 'relay')
                         + ' pi start --profile ' + args.profile
                         + '. Enter /login only inside Pi, not at the shell prompt. Plain pi start treats start as a message.')
    state = check(args.api, profile=profile, provider=args.provider)
    state['auth_profile'] = args.profile
    if state['installed'] and state['workspace'] == 'reachable':
        start = [str(ROOT / 'relay'), 'pi', 'start', '--profile', args.profile]
        if args.provider:
            start += ['--provider', args.provider]
        state['next'] = ('Run ' + shlex.join(start) + ' in an interactive terminal. '
                         'Use /login inside Pi if needed, then /relay to inspect evidence.')
    if args.pi_action == 'doctor':
        print(json.dumps(state, ensure_ascii=True, indent=2))
        return 0 if state['installed'] and state['workspace'] == 'reachable' and (not args.provider or state['provider'] == 'ready') else 1
    if not state['installed'] or state['workspace'] != 'reachable':
        raise ValueError(state['next'])
    PROFILE.mkdir(parents=True, exist_ok=True, mode=0o700)
    print('Starting Pi with Relay evidence tools. Use /relay to inspect or /relay-review to request a model review.\n'
          'Use /login for provider access. Pi usage stays in its session; Hermes is unchanged.', flush=True)
    print('Pi authentication profile: ' + args.profile + '. Relay session history stays separate.', flush=True)
    env = {**environment(profile), 'RELAY_PI_API': args.api}
    try:
        return subprocess.call(launch_command(shutil.which('pi'), args.provider, args.model, args.resume), cwd=ROOT, env=env)
    except KeyboardInterrupt:
        print('\nPi session interrupted. Use ./relay pi start --resume to return to saved history.')
        return 130
