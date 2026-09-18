"""One-command install for the Plow chat agent on the owner's own line.

Wraps the pinned official plow-agents client. It never selects an occupied line,
never overwrites a credential, and never deletes the agent's data volume.
"""
import contextlib
import copy
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import signal
import ssl
import stat
import subprocess
import sys
import time
import traceback
from types import SimpleNamespace
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
AGENT = ROOT / 'agent'
CREDENTIAL = AGENT / 'plow-credentials'
CLIENT = ROOT / '.data/tools/plow-agents'
CLIENT_COMMIT = '8ce907e220ab67018d6857e8054a41eed4ecd279'
CLIENT_SHA256 = 'f69dd0eae74d82f6d9b56b66389c942df35de2665f6d8c92a62ed7b26af223aa'
CLIENT_URL = f'https://raw.githubusercontent.com/plow-pbc/plow-agents/{CLIENT_COMMIT}/bin/plow-agents'
ORIGIN = 'https://api.plow.co'
READY = 'plow-init: configured'
PARKED = 'parking; no gateway will start'
CONTAINER_PATH = '/command:/usr/local/bin:/usr/bin:/bin'
FIRST_PROMPT = 'Reply in one short sentence: say who you are and what you can do with meeting notes.'
CONFIG_PATH = '/var/lib/hermes/config.yaml'
GATEWAY_SERVICE = '/run/service/hermes-gateway'
MODEL_ID = re.compile(r'[^/\s]+/[^/\s]+')
MODEL_CHECK_PROMPT = 'Reply in one short sentence: which model are you, and who made you?'


class AgentError(Exception):
    """A stop with an explanation the owner can act on."""
    code = 1


class DecisionNeeded(AgentError):
    """A stop until the owner makes a choice, such as which line to use. Exit code 2 means exactly that."""
    code = 2


class PlowUnreachable(AgentError):
    """Plow gave no usable answer (network, timeout, a busy or failing service, an unreadable reply)."""


class CredentialRejected(AgentError):
    """Plow answered definitively (401, 403 or 404) that a credential, or the agent it belonged to, is gone."""


class CertificateUnverified(AgentError):
    """This Python could not verify Plow's certificate, usually because it has no certificate bundle."""


def preflight(run=None):
    """Return the missing prerequisites, each with the action that fixes it."""
    run = run or (lambda command: subprocess.run(command, capture_output=True, timeout=20).returncode)
    if not shutil.which('docker'):
        return ['Install Docker Desktop and open it, then run this again.']
    for command in (['docker', 'compose', 'version'], ['docker', 'info']):
        if run(command):
            return ['Start Docker Desktop and wait until it reports running, then run this again.']
    return []


ACTIVE_STATES = {'running', 'restarting', 'paused'}
AGENT_CONTAINERS = ['docker', 'ps', '-a', '--filter', 'label=com.docker.compose.service=agent', '--format',
                    '{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "com.docker.compose.project"}}\t{{.State}}']
ALONGSIDE = 'Put a different COMPOSE_PROJECT_NAME in agent/.env to install alongside it.'


def guard_docker(fresh, run=None, folder=None, environ=None, record=None):
    """Stop before Compose could reach another install's agent, memory or credential. Only reads Docker's state.

    fresh means this run started without a credential. Returns the Compose project name, and whether an existing
    memory volume is this folder's own from its earlier install.
    """
    run = run or (lambda command, cwd=None: subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=20))
    folder = folder or AGENT
    name = compose_project(run, folder, os.environ if environ is None else environ)
    agents = docker_rows(run, AGENT_CONTAINERS, 'containers', fields=3)
    if not fresh:
        refuse_copied_credential(agents, folder)  # first: that stop must not suggest a project name
    refuse_split_agent(agents, folder, name)
    refuse_other_agents(run, folder, name)
    return name, fresh and own_memory(run, folder, name, record or install_record())


def refuse_split_agent(agents, folder, name):
    """Stop when this folder's own agent was started under a project other than the one Compose resolves now.
    Starting here would give the same folder, and the same credential, a second agent."""
    projects = sorted({project for working_dir, project, _ in agents
                       if project and working_dir and same_folder(working_dir, folder)})
    others = [project for project in projects if project != name]
    if len(projects) > 1:
        listed = ', '.join(f"'{project}'" for project in projects)
        raise AgentError(f"This folder's agent exists under more than one Docker project ({listed}). Remove the one you "
                         'do not use with docker compose -p <project> down in agent/, which keeps its memory volume, '
                         'then run ./relay agent again.')
    if others:
        raise AgentError(f"This folder's agent already runs under the Docker project '{others[0]}'. "
                         f'Put COMPOSE_PROJECT_NAME={others[0]} in agent/.env so every ./relay agent command uses it.')


def refuse_other_agents(run, folder, name):
    """Stop when a container from another folder already uses this project. Joining is advised only when that
    folder's own credential shows it is a different agent; otherwise it could be this same agent, moved."""
    for working_dir, state in docker_rows(run, ['docker', 'ps', '-a', '--filter', f'label=com.docker.compose.project={name}',
                                                '--format', '{{.Label "com.docker.compose.project.working_dir"}}\t{{.State}}'],
                                          'containers', fields=2):
        if working_dir and same_folder(working_dir, folder):
            continue
        origin = working_dir or 'an unknown folder'
        if not working_dir or not agent_uid(Path(working_dir) / 'plow-credentials'):
            raise AgentError(f"An agent from {origin} already uses the Docker project '{name}' and its credential could not "
                             'be checked. Confirm it is not this same agent before installing alongside it.')
        if state in ACTIVE_STATES:
            raise AgentError(f"An agent from {origin} already runs under the Docker project '{name}'. {ALONGSIDE}")
        raise AgentError(f"A stopped agent from {origin} exists under the Docker project '{name}'. {ALONGSIDE}")


def own_memory(run, folder, name, record):
    """Whether this project's memory volume exists as this folder's own; one this folder did not create stops."""
    volume = f'{name}_agent-home'
    if [volume] not in docker_rows(run, ['docker', 'volume', 'ls', '--filter', f'name=^{volume}$', '--format', '{{.Name}}'],
                                   'volumes', fields=1):
        return False
    if installed_here(record, name, folder):
        return True
    raise AgentError(f"A memory volume for the Docker project '{name}' already exists and this folder did not create it. "
                     "Put a different COMPOSE_PROJECT_NAME in agent/.env to keep this agent's memory separate.")


def install_record():
    """Where a successful start notes this folder's Compose project, so a reinstall here can reuse its memory."""
    return ROOT / '.data/agent/install.json'


def installed_here(record, name, folder):
    """Whether the install record names this project and this agent/ folder. A copied folder records another path."""
    try:
        saved = json.loads(Path(record).read_text())
    except (OSError, ValueError):
        return False
    return (isinstance(saved, dict) and saved.get('project') == name and isinstance(saved.get('agent_dir'), str)
            and bool(saved['agent_dir']) and same_folder(saved['agent_dir'], folder))


def remember_install(record, name, folder):
    """Record, owner-only, the project and resolved agent/ folder a successful `compose up` used."""
    record.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(record, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as output:
        json.dump({'project': name, 'agent_dir': str(Path(folder).resolve())}, output)
    os.chmod(record, 0o600)


def refuse_copied_credential(agents, folder):
    """Stop when an agent in another folder, in any Compose project, was installed with this folder's credential."""
    uid = agent_uid(folder / 'plow-credentials')
    if not uid:
        return
    for working_dir, _, _ in agents:
        if working_dir and not same_folder(working_dir, folder) and agent_uid(Path(working_dir) / 'plow-credentials') == uid:
            raise AgentError(f'This credential already belongs to the agent in {working_dir}. One credential runs in one '
                             f'place: remove that agent with docker compose down in {working_dir}, or delete '
                             'agent/plow-credentials here so ./relay agent mints this folder its own.')


def agent_uid(path):
    """A credential's '# plow-agent-uid:' value, or None. Only that comment is used; token lines are never kept."""
    try:
        if not stat.S_ISREG(os.stat(path).st_mode):
            return None
        with open(path, encoding='utf-8') as source:
            for text in source.read(65536).splitlines():
                if text.strip().startswith('# plow-agent-uid:'):
                    return text.partition(':')[2].strip() or None
    except (OSError, UnicodeError):
        return None
    return None


def compose_project(run, folder, environ):
    """The project name Compose itself resolves (COMPOSE_PROJECT_NAME, agent/.env, the folder); the plain rule otherwise."""
    try:
        result = run(['docker', 'compose', 'config', '--format', 'json'], cwd=folder)
        name = json.loads(result.stdout).get('name') if result.returncode == 0 else None
    except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
        name = None
    return name if isinstance(name, str) and name else (environ.get('COMPOSE_PROJECT_NAME') or 'agent')


def docker_rows(run, command, what, fields):
    """A read-only docker listing as rows of tab-separated fields. A listing Docker cannot give stops the install."""
    try:
        result = run(command)
    except (OSError, subprocess.SubprocessError):
        result = None
    if result is None or result.returncode:
        raise AgentError(f'Docker did not list its {what}, so the install stopped before starting the agent. '
                         'Run ./relay agent again.')
    return [([part.strip() for part in text.split('\t')] + [''] * fields)[:fields]
            for text in result.stdout.splitlines() if text.strip()]


def same_folder(one, other):
    """Compare the folders themselves when both exist (symlinks, letter case); otherwise their resolved paths."""
    try:
        return os.path.samefile(one, other)
    except OSError:
        return Path(one).resolve() == Path(other).resolve()


def choose_line(lines, ask, wanted=None, interactive=True, command='./relay agent'):
    """Select a free line. Occupied lines are never taken from their agent.

    Free lines are listed in uid order, so a position means the same line on the next run.
    command names the command whose rerun would choose a line, so a stop names the one the owner ran.
    """
    free = sorted((line for line in lines if not line.get('agent_uid')), key=lambda line: line['uid'])
    if not free:
        held = len(lines) - len(free)
        detail = f'{held} line(s) already answer as an agent. ' if held else 'This account holds no assistant line. '
        raise DecisionNeeded(detail + f'Run `{command} --new-line` to have Plow provision one, '
                             'or retire an existing agent with `plow-agents revoke <line>` first.')
    if wanted is not None:
        chosen = find_line(free, wanted)
        if chosen is None:
            raise choose_later(f'No free line matches --line {wanted}. The free lines are:', free, command)
        return chosen
    if len(free) == 1:
        return free[0]
    if not interactive:
        raise choose_later('Several free lines are available, and there is no terminal to ask which one to use:',
                           free, command)
    return ask(free)


def find_line(free, wanted):
    """The free line --line names: by uid, by number (digits only) or by position in the list."""
    value = str(wanted).strip()
    number = digits(value)
    for line in free:
        if line['uid'] == value:
            return line
    for line in free:
        if number and digits(line.get('provider_key')) == number:
            return line
    if value.isdecimal() and 1 <= int(value) <= len(free):
        return free[int(value) - 1]
    return None


def digits(number):
    """A phone number without spaces, dashes, parentheses or a leading +; empty unless only digits remain."""
    text = str(number or '').strip()
    text = ''.join(character for character in text.removeprefix('+') if character not in ' -()')
    return text if text.isascii() and text.isdigit() else ''


def line_choices(free):
    """The free lines as numbered rows: position, display name, number and uid."""
    return '\n'.join(f'  {position}. ' + ' '.join(part for part in (line.get('display_name') or 'assistant',
                                                                      line.get('provider_key'), f'({line["uid"]})') if part)
                     for position, line in enumerate(free, 1))


def choose_later(reason, free, command='./relay agent'):
    """A stop that lists the free lines and the exact command that picks one without asking."""
    return DecisionNeeded(f'{reason}\n{line_choices(free)}\nChoose one with: {command} --line <position>')


def existing_line(path, identity):
    """The line an existing credential answers on, as Plow reports it. The file is only ever read. Removing it is
    suggested only when Plow answered definitively; anything short of that asks for a later run."""
    try:
        found = identity(path)
    except PlowUnreachable:
        found = None
    except CertificateUnverified as error:
        raise AgentError(f'Could not verify the existing credential with Plow: {error}. It was left untouched; '
                         'run ./relay agent again once that is fixed.') from None
    except CredentialRejected as error:
        raise AgentError(f'The existing credential {path} could not be verified with Plow. {error} It was left untouched. '
                         'If that agent was retired, remove the file yourself first, then run ./relay agent again.') from None
    except AgentError as error:
        raise AgentError(f'The existing credential {path} could not be used: {error} It was left untouched.') from None
    line = found.get('line') if isinstance(found, dict) else None
    if not isinstance(line, dict) or not line.get('uid'):
        raise AgentError('Could not verify the existing credential with Plow right now. It was left untouched; '
                         'run ./relay agent again later.')
    return line


def refuse_other_line(line, args, advice='To use another line, install in a new folder.'):
    """On a resume, --new-line or a --line naming another line cannot apply: this folder's agent keeps its line.

    advice is how the owner would get another line, which differs for an agent this machine hosts for somebody else.
    """
    wanted = getattr(args, 'line', None)
    if getattr(args, 'new_line', False) or (wanted is not None and not names_line(line, wanted)):
        label = ' '.join(part for part in (line.get('display_name') or line['uid'], line.get('provider_key')) if part)
        raise DecisionNeeded(f'This folder already runs an agent on {label}. {advice}')


def names_line(line, wanted):
    """Whether --line names this line by uid or number. A bare list position cannot be checked without the account's
    lines, so it passes: rerunning the same command after an interruption must continue."""
    value = str(wanted).strip()
    if value.isdecimal() and len(value) <= 3:
        return True
    return find_line([line], value) is not None


def ensure_credential(path, line, identity, mint):
    """Reuse a credential that belongs to this line; never overwrite another one."""
    if path.exists():
        current = (identity(path) or {}).get('line', {}).get('uid')
        if current != line['uid']:
            raise AgentError(
                f'{path} already holds a credential for line {current}, not {line["uid"]}. '
                'Nothing was changed. Remove or rotate that credential deliberately before installing here.')
        return 'reused'
    mint(path, line['uid'])
    return 'minted'


def wait_ready(read_logs, sleep=time.sleep, timeout=600, step=2):
    """Watch container logs until Plow configures the agent, parks it, or time runs out."""
    waited = 0
    while True:
        logs = read_logs() or ''
        for text in logs.splitlines():
            if READY in text:
                return 'ready', text.strip()
            if PARKED in text:
                return 'parked', text.strip()
        if waited >= timeout:
            return 'timeout', 'The agent did not report readiness. Inspect `docker compose logs agent` in agent/.'
        sleep(step)
        waited += step


@contextlib.contextmanager
def installation_lock(path, alive=None):
    """One install at a time. The lock names the installer's process and clears on failure and interruption.

    A lock whose process no longer exists was left by a killed installer, and is removed.
    """
    busy = f'An install is already running. If it was interrupted, delete {path} and retry.'
    for attempt in (1, 2):
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            break
        except FileExistsError:
            holder = lock_holder(path)
            if attempt == 2 or holder is None or (alive or process_alive)(holder):
                raise AgentError(busy) from None
            Path(path).unlink(missing_ok=True)
            print(f'Removed a stale install lock left by process {holder}.', flush=True)
    try:
        os.write(descriptor, f'{os.getpid()}\n'.encode())
        os.close(descriptor)
        yield
    finally:
        Path(path).unlink(missing_ok=True)


def lock_holder(path):
    """The process id a lock file names, or None when it names none."""
    try:
        text = Path(path).read_text().strip()
    except (OSError, UnicodeError):
        return None
    return int(text) if text.isdecimal() and 0 < int(text) < 2 ** 31 else None


def process_alive(pid):
    """Whether a process with this id exists. Where that cannot be asked safely, assume it does."""
    if os.name != 'posix':
        return True  # on Windows os.kill(pid, 0) would terminate the process
    try:
        os.kill(pid, 0)  # signal 0 only checks
    except ProcessLookupError:
        return False
    except OSError:
        return True  # it exists but belongs to someone else
    return True


@contextlib.contextmanager
def exit_on_sigterm():
    """Turn SIGTERM (a tool timeout, `kill`) into SystemExit(143), so finally blocks such as the lock's still run."""
    def stop(signum, frame):
        raise SystemExit(143)
    previous = signal.signal(signal.SIGTERM, stop)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_DFL if previous is None else previous)


def status_report(running, line, configured, reporter, usage):
    """Human status. The reporter's key is never included."""
    rows = ['Agent container: ' + ('running' if running else 'not running')]
    rows.append('Line: ' + (f'{line.get("display_name") or "assistant"} {line.get("provider_key") or ""}'.strip()
                            if line else 'no line selected yet'))
    rows.append('Plow setup: ' + ('configured' if configured else 'not configured'))
    rows.append('Index reporter: ' + (f'registered (install {reporter["install_id"]})'
                                      if reporter.get('install_id') else 'not registered yet'))
    if usage.get('tokens') is not None:
        rows.append(f'Reported usage: {int(usage["tokens"]):,} tokens over {usage.get("days", 0)} day(s) '
                    f'as {usage.get("agent", "this agent")}')
    else:
        rows.append('Reported usage: none yet; the reporter publishes every five minutes')
    return '\n'.join(rows)


def trust_certifi():
    """Give HTTPS calls a certificate bundle; python.org's Python on macOS has none until one is installed."""
    if 'SSL_CERT_FILE' in os.environ:
        return
    try:
        import certifi
    except ImportError:
        return
    os.environ['SSL_CERT_FILE'] = certifi.where()


def official():
    """The pinned official client, verified before use."""
    if not CLIENT.is_file():
        CLIENT.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(CLIENT_URL, timeout=60) as response:
                data = response.read(2_000_001)
        except (OSError, http.client.HTTPException, ValueError) as error:
            raise AgentError(f'The official Plow client could not be downloaded from GitHub: {download_problem(error)}. '
                             'Nothing was installed; run ./relay agent again once that is fixed.') from None
        if hashlib.sha256(data).hexdigest() != CLIENT_SHA256:
            raise AgentError('The official Plow client did not match its pinned checksum. Nothing was installed.')
        CLIENT.write_bytes(data)
        CLIENT.chmod(0o700)
    elif hashlib.sha256(CLIENT.read_bytes()).hexdigest() != CLIENT_SHA256:
        raise AgentError(f'{CLIENT} differs from the pinned official client. Inspect it before continuing.')
    return runpy.run_path(str(CLIENT))


def download_problem(error):
    """Why a download failed, in words the owner can act on."""
    if isinstance(error, urllib.error.HTTPError):
        return f'GitHub answered HTTP {error.code}'
    reason = getattr(error, 'reason', None) or error
    if isinstance(reason, ssl.SSLError):
        return certificate_hint(reason)
    return f'the network request failed ({reason})'


def certificate_hint(reason):
    """The one explanation for a secure connection this Python could not verify, for the download and for Plow."""
    return (f'the secure connection could not be verified ({reason}); if this Python has no certificates, '
            'python3 -m pip install certifi provides them')


def mint_credential(client, path, uid):
    """Mint the line's agent credential with the official client.

    Only the client's command line fills in agent_api_base; calling mint directly must name it,
    or the client fails writing the credential and retires the agent it just created.
    """
    client['mint'](SimpleNamespace(line=uid, credential_file=str(path), token_file=None,
                                   api_base=ORIGIN, agent_api_base=ORIGIN))


def compose(*arguments, capture=False, input=None, cwd=None):
    """Compose in the installed agent's folder, or in another agent's own folder when one is named."""
    return subprocess.run(['docker', 'compose', *arguments], cwd=cwd or AGENT,
                          capture_output=capture, text=True, timeout=1800, input=input)


def identity(path):
    """Who a credential answers as, according to Plow. When Plow cannot say, an AgentError says why:
    CredentialRejected for a definitive 401, 403 or 404, CertificateUnverified when this Python cannot verify
    Plow's certificate, PlowUnreachable for any other failed request, and a plain AgentError when the local
    file cannot be used.
    """
    sys.path.insert(0, str(ROOT / 'integrations/plow'))
    import bridge
    try:
        token = bridge.private_credentials(path)
    except bridge.BridgeError as error:
        raise AgentError(str(error)) from None
    try:
        return bridge.JsonHTTP(ORIGIN, token).call('GET', '/v1/agents/cloud/me')[1]
    except bridge.BridgeError as error:
        cause = error.__context__  # the bridge raises "from None", which keeps the original as context
        if isinstance(cause, urllib.error.HTTPError) and cause.code in (401, 403, 404):
            raise CredentialRejected(str(error)) from None
        for failure in (cause, getattr(cause, 'reason', None)):  # raised directly, or as URLError.reason
            if isinstance(failure, ssl.SSLCertVerificationError):
                raise CertificateUnverified(certificate_hint(failure)) from None
        raise PlowUnreachable(str(error)) from None


def reporter_state():
    result = compose('exec', '-T', 'agent', 'cat', '/var/lib/hermes/.agent-index.json', capture=True)
    try:
        return json.loads(result.stdout) if result.returncode == 0 else {}
    except ValueError:
        return {}


def parse_usage(logs):
    """The reporter's last published total. Totals it refused to publish are never shown."""
    usage, refused = {}, False
    for text in (logs or '').splitlines():
        if 'agent=' in text and 'tokens=' in text:
            fields = dict(part.split('=', 1) for part in text.split() if '=' in part)
            try:
                # The reporter prints separated numbers, for example tokens=3,191,866.
                usage = {'agent': fields['agent'],
                         'days': int(fields.get('days', '0').replace(',', '')),
                         'tokens': int(fields['tokens'].replace(',', '').replace('_', ''))}
                refused = False
            except (KeyError, ValueError):
                continue
        elif 'COLLECTOR FAILED' in text or 'NOT reporting a partial total' in text:
            refused = True
    return {} if refused or not usage else usage


def reported_usage():
    return parse_usage(compose('logs', '--no-color', 'agent', capture=True).stdout)


def ask_for_line(options, command='./relay agent'):
    print('\nSeveral free lines are available:', flush=True)
    print(line_choices(options), flush=True)
    while True:
        try:
            answer = input('Choose a line number: ').strip()
        except EOFError:
            print(flush=True)
            raise choose_later('No line was chosen. The free lines are:', options, command) from None
        if answer.isdecimal() and 1 <= int(answer) <= len(options):
            return options[int(answer) - 1]
        print('Enter one of the listed numbers.', flush=True)


def speak(prompt):
    """One prompt through the container's own environment, as the agent user."""
    result = compose('exec', '-T', '-e', 'PATH=' + CONTAINER_PATH, 'agent', 'with-contenv', 'sh', '-c',
                     'export HOME=/var/lib/hermes; cd /opt/hermes; exec s6-setuidgid hermes '
                     "/opt/hermes/.venv/bin/hermes chat -q " + json.dumps(prompt) + ' --oneshot -Q', capture=True)
    if result.returncode:
        raise AgentError('The agent is running but did not answer. Check `docker compose logs agent` in agent/.')
    return '\n'.join(text for text in result.stdout.splitlines() if not text.startswith('session_id:')).strip()


def status_line(label, value):
    """One dot-aligned status line, like the install's own progress lines: `label` padded to the same column."""
    return f"{label} {'.' * (18 - len(label))} {value}"


def yaml_module():
    """PyYAML, loaded only here: every other command in this file needs nothing beyond the standard library."""
    try:
        import yaml
    except ImportError:
        raise AgentError('./relay agent model needs PyYAML to read and edit the config. Install it with '
                         'python3 -m pip install pyyaml, then run this again.') from None
    return yaml


def yaml_problem(error):
    """A short description of a YAMLError that keeps the line and column PyYAML found, when it gave one."""
    mark = getattr(error, 'problem_mark', None)
    problem = getattr(error, 'problem', None) or str(error).strip().splitlines()[0]
    return f'{problem} (line {mark.line + 1}, column {mark.column + 1})' if mark is not None else problem


def load_model_config(text):
    """The parsed config, or a refusal naming the problem when it will not parse or lacks the model block
    ./relay agent model expects. Only ever reads; never writes anything."""
    yaml = yaml_module()
    try:
        config = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise DecisionNeeded(f'The agent config could not be parsed: {yaml_problem(error)}. '
                             'Nothing was changed.') from None
    model = config.get('model') if isinstance(config, dict) else None
    if not isinstance(model, dict) or not model.get('default') or not model.get('provider'):
        raise DecisionNeeded('The agent config does not have the model block ./relay agent model expects '
                             '(a model.default and model.provider). Nothing was changed.')
    return config


def model_summary(text):
    """The default model id, its provider, and that provider's known ids, from the raw config text.

    providers.<provider>.models is a mapping of id -> per-model settings in the real config; a plain list of
    ids is accepted too. Either way the ids are its keys (a mapping) or its items (a list).
    """
    config = load_model_config(text)
    model = config['model']
    providers = config.get('providers')
    provider_block = providers.get(model['provider']) if isinstance(providers, dict) else None
    models = provider_block.get('models') if isinstance(provider_block, dict) else None
    ids = list(models) if isinstance(models, (dict, list)) else []
    return {'default': model['default'], 'provider': model['provider'], 'models': ids}


def validate_model_id(model_id):
    """model_id, or a refusal when none was given or it is not shaped like provider/model."""
    if not model_id:
        raise DecisionNeeded('No model id was given. Give one shaped like provider/model, for example '
                             'anthropic/claude-sonnet-5.')
    if not MODEL_ID.fullmatch(model_id):
        raise DecisionNeeded(f'"{model_id}" is not a model id shaped like provider/model, for example '
                             'anthropic/claude-sonnet-5.')
    return model_id


def _line_indent(line):
    return len(line) - len(line.lstrip(' '))


def _top_key_line(lines, key):
    """The index of `key:` at column 0, or None."""
    pattern = re.compile(rf'^{re.escape(key)}:(?:\s|$)')
    for index, line in enumerate(lines):
        if pattern.match(line):
            return index
    return None


def _child_block(lines, header_index):
    """(start, end): every line after lines[header_index] indented deeper than it, blank lines included."""
    header_indent = _line_indent(lines[header_index])
    end = header_index + 1
    while end < len(lines):
        stripped = lines[end].strip()
        if stripped and _line_indent(lines[end]) <= header_indent:
            break
        end += 1
    return header_index + 1, end


def _child_key_line(lines, start, end, key):
    """The index in [start, end) of `key:` at that block's own (shallowest) indentation. None when absent."""
    pattern = re.compile(rf'^(?:[ \t]*){re.escape(key)}:(?:\s|$)')
    child_indent = None
    for index in range(start, end):
        line = lines[index]
        if not line.strip():
            continue
        indent = _line_indent(line)
        if child_indent is None:
            child_indent = indent
        if indent != child_indent:
            continue
        if pattern.match(line):
            return index
    return None


def _first_child_indent(lines, start, end, fallback):
    for index in range(start, end):
        if lines[index].strip():
            return _line_indent(lines[index])
    return fallback


def _indent_step(lines):
    """The file's own indentation width, from its first indented line; 2 spaces when there is none."""
    for line in lines:
        if line.strip() and line[:1] == ' ':
            return _line_indent(line)
    return 2


def _model_entry_line(indent, model_id, as_list):
    return f'{" " * indent}- {model_id}\n' if as_list else f'{" " * indent}{model_id}: {{}}\n'


_TRAILING_COMMENT = re.compile(r'(\s+#.*)$')


def _set_default_line(lines, model_id):
    """lines with model.default's value replaced, in place, keeping a trailing comment on that line if it
    has one.

    Refuses (DecisionNeeded) when model: itself is written in flow style, the same unsupported shape as its
    providers.* siblings, by name and with a remedy -- not the generic "Could not locate model.default"
    AgentError, which reads as an internal error rather than a decision about the owner's own config.
    Raises plain AgentError only when the default: line genuinely cannot be located some other way.
    """
    model_index = _top_key_line(lines, 'model')
    if model_index is not None and _is_flow_style(lines[model_index]):
        raise DecisionNeeded('model is written in flow style ({...} or [...]) in the agent config; switching '
                             'the default there is not supported. Edit it to block style yourself, then run '
                             'this again. Nothing was changed.')
    start, end = (None, None) if model_index is None else _child_block(lines, model_index)
    default_index = None if model_index is None else _child_key_line(lines, start, end, 'default')
    if default_index is None:
        raise AgentError('Could not locate model.default in the config text to edit it. Nothing was changed.')
    line = lines[default_index]
    comment_match = _TRAILING_COMMENT.search(line)
    comment = comment_match.group(1) if comment_match else ''
    lines[default_index] = re.sub(r'^([ \t]*default:).*$', lambda m: f'{m.group(1)} {model_id}{comment}',
                                  line, count=1)
    return lines


def _is_flow_style(line):
    """Whether a `key: value` line's value starts a flow mapping or sequence (`key: {...}` or `key: [...]`)."""
    rest = line.split(':', 1)[1] if ':' in line else ''
    rest = rest.split('#', 1)[0].strip()
    return rest[:1] in ('{', '[')


def _ensure_model_id(lines, provider, model_id, original):
    """lines with model_id added under providers.<provider>.models, in place, when it is not already there.

    Refuses (DecisionNeeded) rather than editing when a block that needs a new line under it turns out to be
    written in flow style (`{...}` or `[...]`): this minimal edit only inserts lines under block-style YAML,
    which is what the live config uses throughout, and a text insertion under a flow scalar produces YAML
    that will not parse -- refusing by name, before touching anything, beats blaming that on the owner's
    config. Reading past a flow-style block that already has the id needs no insertion, so it is never
    refused; only writing into one is unsupported.
    """
    providers = original.get('providers')
    provider_block = providers.get(provider) if isinstance(providers, dict) else None
    models_value = provider_block.get('models') if isinstance(provider_block, dict) else None
    if isinstance(models_value, (dict, list)) and model_id in models_value:
        return lines
    as_list = isinstance(models_value, list)
    step = _indent_step(lines)

    providers_index = _top_key_line(lines, 'providers')
    if providers_index is None:
        if lines and not lines[-1].endswith('\n'):
            lines[-1] += '\n'
        return lines + ['providers:\n', f'{" " * step}{provider}:\n', f'{" " * (step * 2)}models:\n',
                        _model_entry_line(step * 3, model_id, as_list)]
    if _is_flow_style(lines[providers_index]):
        raise DecisionNeeded('providers is written in flow style ({...} or [...]) in the agent config; adding '
                             'a new provider or model id there is not supported. Edit it to block style '
                             'yourself, then run this again. Nothing was changed.')

    p_start, p_end = _child_block(lines, providers_index)
    provider_line = _child_key_line(lines, p_start, p_end, provider)
    if provider_line is None:
        indent = _first_child_indent(lines, p_start, p_end, step)
        lines[p_end:p_end] = [f'{" " * indent}{provider}:\n', f'{" " * (indent + step)}models:\n',
                              _model_entry_line(indent + step * 2, model_id, as_list)]
        return lines
    if _is_flow_style(lines[provider_line]):
        raise DecisionNeeded(f'providers.{provider} is written in flow style ({{...}} or [...]) in the agent '
                             'config; adding a new model id there is not supported. Edit it to block style '
                             'yourself, then run this again. Nothing was changed.')

    pv_start, pv_end = _child_block(lines, provider_line)
    models_line = _child_key_line(lines, pv_start, pv_end, 'models')
    if models_line is None:
        indent = _first_child_indent(lines, pv_start, pv_end, _line_indent(lines[provider_line]) + step)
        lines[pv_end:pv_end] = [f'{" " * indent}models:\n', _model_entry_line(indent + step, model_id, as_list)]
        return lines
    if _is_flow_style(lines[models_line]):
        raise DecisionNeeded(f'providers.{provider}.models is written in flow style ({{...}} or [...]) in the '
                             'agent config; adding a new model id there is not supported. Edit it to block '
                             'style yourself, then run this again. Nothing was changed.')

    m_start, m_end = _child_block(lines, models_line)
    indent = _first_child_indent(lines, m_start, m_end, _line_indent(lines[models_line]) + step)
    lines[m_end:m_end] = [_model_entry_line(indent, model_id, as_list)]
    return lines


def _expected_after_edit(config, provider, model_id):
    """The dict a correct edit must reparse to: config with only model.default and providers.<p>.models changed.

    Refuses (DecisionNeeded) rather than crashing when providers, or providers.<provider>, is present but
    explicitly null ("providers:" or "plow:" with nothing after it): setdefault only fills in an *absent*
    key, so a present-but-None one reached .get()/.setdefault() as None and raised AttributeError instead
    of a refusal naming what is wrong. A genuinely absent provider is a different shape (still created
    fresh, unrefused) and is not affected by either check below.
    """
    config = copy.deepcopy(config)
    config['model']['default'] = model_id
    if 'providers' in config and config['providers'] is None:
        raise DecisionNeeded('providers is empty in the agent config; give it a provider with a models: '
                             'mapping yourself, or remove the providers: line so it can be created fresh, '
                             'then run this again. Nothing was changed.')
    providers = config.setdefault('providers', {})
    if provider in providers and providers[provider] is None:
        raise DecisionNeeded(f'providers.{provider} is empty in the agent config; give it a models: mapping '
                             f'yourself, or remove the providers.{provider}: line so it can be created fresh, '
                             'then run this again. Nothing was changed.')
    provider_block = providers.setdefault(provider, {})
    models = provider_block.get('models')
    if models is None:
        provider_block['models'] = {model_id: {}}
    elif isinstance(models, dict):
        models.setdefault(model_id, {})
    elif isinstance(models, list):
        if model_id not in models:
            models.append(model_id)
    else:
        raise DecisionNeeded(f"The agent config's providers.{provider}.models is neither a mapping nor a list. "
                             "Nothing was changed.")
    return config


def set_default_model(text, model_id):
    """Config text with model.default set to model_id, adding it under its provider's models when missing.

    A minimal text edit, not a full reparse-and-dump: it replaces the default: line and inserts one new line
    for the id, so comments, anchors, block scalars and values PyYAML would otherwise normalise (`yes`,
    `1.10`) survive untouched everywhere else. The result is re-parsed and compared against the original
    parse with only those two changes applied; anything else differing refuses, writing nothing.
    """
    yaml = yaml_module()
    original = load_model_config(text)
    provider = original['model']['provider']
    expected = _expected_after_edit(original, provider, model_id)

    lines = text.splitlines(keepends=True)
    lines = _set_default_line(lines, model_id)
    lines = _ensure_model_id(lines, provider, model_id, original)
    new_text = ''.join(lines)

    try:
        reparsed = yaml.safe_load(new_text)
    except yaml.YAMLError as error:
        raise AgentError(f'The edited config did not parse ({yaml_problem(error)}). Nothing was written.') from None
    if reparsed != expected:
        raise AgentError('The edited config would not match the intended change exactly. Nothing was written.')
    return new_text


def require_agent_running():
    """Stop before reading, editing or restarting anything when the agent container is not running."""
    if not compose('ps', '--status', 'running', '--quiet', capture=True).stdout.strip():
        raise DecisionNeeded('The agent container is not running. Start it with ./relay agent, then run this again.')


def hermes_run(*command, input=None):
    """One command inside the agent container as the hermes user, the way speak() reaches Hermes itself."""
    return compose('exec', '-T', '-e', 'PATH=' + CONTAINER_PATH, 'agent', 'with-contenv', 's6-setuidgid', 'hermes',
                   *command, capture=True, input=input)


def read_config(path=CONFIG_PATH):
    """The text of one file beside the agent config, read inside the container. Never copied to the host disk."""
    result = hermes_run('cat', path)
    if result.returncode:
        raise AgentError(f'{path} could not be read inside the container. Check `docker compose logs agent` in agent/.')
    return result.stdout


def make_backup(kind):
    """Copy the live config beside itself as <kind>-<UTC timestamp>-<unique>, via mktemp (with the timestamp
    still leading, so names stay sortable) rather than a bare cp to a second-resolution name, which a switch
    and a revert inside the same second could otherwise collide on. Returns its path."""
    template = f'{CONFIG_PATH}.{kind}-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}-XXXXXX'
    made = hermes_run('mktemp', template)
    if made.returncode or not made.stdout.strip():
        raise AgentError('The config backup could not be created inside the container. Nothing was changed.')
    backup = made.stdout.strip()
    if hermes_run('cp', CONFIG_PATH, backup).returncode:
        hermes_run('rm', '-f', backup)
        raise AgentError('The config backup could not be written inside the container. Nothing was changed.')
    return backup


def backup_config():
    """Copy the live config beside itself as a revertable backup, before any edit. Returns its path."""
    return make_backup('backup')


def before_revert_backup():
    """Copy the live config beside itself before a revert replaces it, so a mistaken revert is itself
    reversible. Named so list_backups() -- which selects only config.yaml.backup-* -- never selects it: a
    revert's own safety copy must never become the next revert's target, or two reverts in a row would
    alternate between two configs instead of both landing on the same one."""
    return make_backup('before-revert')


def write_config(text):
    """Replace the config atomically: a unique temp file beside it (mktemp, so two runs cannot interleave),
    verified by byte count before the rename, as the hermes user. `cat > tmp && mv` alone cannot tell a
    truncated stream from a clean end, so nothing is renamed onto the live config until the byte count matches.
    """
    made = hermes_run('mktemp', f'{CONFIG_PATH}.XXXXXX')
    if made.returncode or not made.stdout.strip():
        raise AgentError('A temporary file for the new config could not be created inside the container.')
    tmp = made.stdout.strip()
    written = hermes_run('sh', '-c', f'cat > {tmp}', input=text)
    expected = str(len(text.encode('utf-8')))
    size = hermes_run('wc', '-c', tmp)
    actual = size.stdout.split()[0] if size.returncode == 0 and size.stdout.split() else None
    if written.returncode or actual != expected:
        hermes_run('rm', '-f', tmp)
        raise AgentError('The new config was not written completely inside the container. Nothing was replaced.')
    if hermes_run('mv', tmp, CONFIG_PATH).returncode:
        hermes_run('rm', '-f', tmp)
        raise AgentError('The new config could not be installed inside the container.')


def list_backups():
    """Every config backup beside the config, oldest first; a fixed-width UTC suffix sorts lexicographically.

    Uses the shell's own glob and an existence test rather than trusting ls's exit code for "no match": that
    code varies by implementation (1 or 2 are both common) and, read on its own, cannot be told apart from a
    real failure that also exits non-zero with no output. `set -- <pattern>` followed by `[ -e "$1" ]` always
    exits 0 whether or not anything matched, so here any non-zero exit really is a failure.
    """
    result = hermes_run('sh', '-c', f'set -- {CONFIG_PATH}.backup-*; if [ -e "$1" ]; then printf "%s\\n" "$@"; fi')
    if result.returncode:
        raise AgentError('Could not list config backups inside the container. Check `docker compose logs agent` in agent/.')
    return sorted(name.strip() for name in result.stdout.splitlines() if name.strip())


GATEWAY_TIMEOUT = 180


def gateway_pid():
    """The gateway's current pid according to s6-svstat, or None when it is not reported up.

    Stops at the pid's digits rather than assuming what follows them: the real line also carries a pgid and
    an uptime ("up (pid 198 pgid 198) 127022 seconds"), which `up \\(pid (\\d+)\\)` -- requiring the closing
    paren right after the digits -- does not match, verified against the running container on 2026-09-18.
    """
    result = compose('exec', '-T', 'agent', '/command/s6-svstat', GATEWAY_SERVICE, capture=True)
    if result.returncode:
        return None
    match = re.match(r'up \(pid (\d+)', result.stdout.strip())
    return int(match.group(1)) if match else None


def wait_for_restart(previous_pid, read_pid, sleep=time.sleep, timeout=GATEWAY_TIMEOUT, step=2, confirm_seconds=5):
    """Poll read_pid() for a pid other than previous_pid that is *still* there confirm_seconds later, or time
    runs out. A single sighting of a differing pid is never enough on its own: s6 respawns a gateway that
    crashes on the new model too, so one differing reading looks identical to a real restart until it is
    confirmed stable. If a confirmed candidate turns out to have changed again, it is treated as a new,
    unconfirmed candidate and waited on the same way -- within the same overall timeout, never extending it.

    Returns 'confirmed' (a pid held stable across two reads), 'timeout' (no differing pid was ever seen) or
    'churning' (one or more differing pids appeared, but none held stable before time ran out).
    """
    waited = 0
    candidate = None
    churned = False
    while waited < timeout:
        pid = read_pid()
        if pid is not None and pid != previous_pid:
            if pid == candidate:
                return 'confirmed'
            if candidate is not None:
                churned = True
            candidate = pid
            sleep(confirm_seconds)
            waited += confirm_seconds
            continue
        # Only a read of the pre-restart pid itself means genuinely nothing has happened yet. A gap where
        # the gateway is merely down (unreadable) must not erase a candidate already seen -- s6 often shows
        # exactly that between one crash and the next respawn, and forgetting it here reports the generic
        # "did not come back up" instead of "keeps restarting" for a crash loop with visible down-gaps.
        if pid == previous_pid:
            candidate = None
        sleep(step)
        waited += step
    return 'churning' if churned else 'timeout'


def restart_and_wait(backup):
    """Ask s6 to restart the gateway, as the transport watchdog does, then wait for a new, stable pid to
    appear.

    wait_ready's `plow-init: configured` marker cannot verify this: plow-init writes it once at container
    boot, and restarting only the gateway never re-emits it, so watching for it here would poll for the
    full timeout on every successful switch. s6-svstat's own pid is the real signal that it actually
    restarted. This runs without the hermes wrapper, like the transport watchdog's own restart call: s6's
    control files need the container's default user, not hermes. Every failure below names the backup so the
    owner can recover with --revert.
    """
    previous = gateway_pid()
    if previous is None:
        # Every pid read afterward would "differ" from None, so any sighting at all would otherwise
        # confirm -- reporting a switch that was never actually observed. Refuse before even attempting the
        # restart rather than guess: the new config is already written, only the restart did not happen.
        raise AgentError(f"The gateway's state could not be read before the restart, so it was not attempted "
                         f"and a switch that was not observed is never reported as done. The new config is "
                         f'written; the previous one is backed up at {backup}. Check `docker compose logs '
                         'agent` in agent/, then run ./relay agent model again, or restore with '
                         './relay agent model --revert.')
    if compose('exec', '-T', 'agent', '/command/s6-svc', '-r', GATEWAY_SERVICE, capture=True).returncode:
        raise AgentError(f'The gateway could not be restarted. The previous config is backed up at {backup}; '
                         'restore it with ./relay agent model --revert.')
    # A fresh time.sleep lookup, not wait_for_restart's own default: its default is bound once at import
    # time, so a test patching time.sleep around a call that relies on it would still sleep for real.
    state = wait_for_restart(previous, gateway_pid, sleep=time.sleep)
    if state == 'confirmed':
        return
    if state == 'churning':
        raise AgentError('The gateway keeps restarting instead of settling on the new model. The previous '
                         f'config is backed up at {backup}; restore it with ./relay agent model --revert.')
    raise AgentError(f'The gateway did not come back up within {GATEWAY_TIMEOUT} seconds after the restart. '
                     f'Check `docker compose logs agent` in agent/. The previous config is backed up at '
                     f'{backup}; restore it with ./relay agent model --revert.')


def show_model():
    """Print the live default, its provider and that provider's known ids. Never the token or any env value."""
    require_agent_running()
    summary = model_summary(read_config())
    print(status_line('Model', summary['default']), flush=True)
    print(status_line('Provider', summary['provider']), flush=True)
    print(status_line('Models', ', '.join(summary['models']) or '(none known)'), flush=True)
    return 0


def report_check():
    """After a switch: one prompt through speak(), so a wrong id shows up at once. A failed call or an empty
    reply never turns a landed switch into a failure; it says the switch landed and the check did not.

    Catches any exception, not only AgentError: the Model line is already printed by the time this runs, so
    nothing this does may turn an already-landed switch into a non-zero exit.
    """
    try:
        reply = speak(MODEL_CHECK_PROMPT)
    except Exception:
        reply = ''
    if reply.strip():
        print(reply, flush=True)
    else:
        print(status_line('Check', 'no reply from the agent; the switch itself landed'), flush=True)


def switch_model(model_id, check):
    """Back the live config up, set its default to model_id, restart the gateway, and print the transition."""
    validate_model_id(model_id)
    require_agent_running()
    text = read_config()
    old = model_summary(text)['default']
    new_text = set_default_model(text, model_id)
    backup = backup_config()
    write_config(new_text)
    restart_and_wait(backup)
    print(status_line('Model', f'{old} -> {model_id}'), flush=True)
    if check:
        report_check()
    return 0


def revert_model():
    """Restore the newest config backup the same atomic way a switch writes, and print what came back.

    Backs up the config being replaced first, so a mistaken revert is itself reversible.
    """
    require_agent_running()
    backups = list_backups()
    if not backups:
        raise DecisionNeeded('No config backup exists to revert to. ./relay agent model <id> makes one before '
                             'it switches; run that first.')
    newest = backups[-1]
    backup_text = read_config(newest)
    new_default = model_summary(backup_text)['default']
    old = 'unknown'
    with contextlib.suppress(AgentError):
        old = model_summary(read_config())['default']
    safety_backup = before_revert_backup()
    write_config(backup_text)
    restart_and_wait(safety_backup)
    print(status_line('Model', f'{old} -> {new_default}'), flush=True)
    return 0


def model_command(args):
    """./relay agent model: show it, switch it, or revert to the newest backup."""
    if args.revert:
        return revert_model()
    if args.id is None:
        return show_model()
    return switch_model(args.id, args.check)


def signin_path():
    """The full-access account sign-in, resolved exactly as the pinned client's account_token resolves it."""
    config = os.environ.get('XDG_CONFIG_HOME') or os.path.join(os.path.expanduser('~'), '.config')
    return Path(os.path.join(config, 'plow', 'token'))


def signin_marker():
    """Where the installer notes a sign-in it created: the SHA-256 of that file's bytes, never the token."""
    return ROOT / '.data/agent/signin-created.sha256'


def file_digest(path):
    """The SHA-256 of a file's bytes, or None when there is no readable file."""
    try:
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    except OSError:
        return None


def replaced_flag(marker):
    """Beside the marker, an empty file saying the noted sign-in replaced an earlier one."""
    return marker.with_name('signin-replaced')


def remember_signin(marker, digest, replaced):
    """Record a sign-in this run's activation wrote, so a later successful run can remove exactly that file."""
    marker.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as output:
        output.write(digest + '\n')
    os.chmod(marker, 0o600)
    if replaced:
        os.close(os.open(replaced_flag(marker), os.O_WRONLY | os.O_CREAT, 0o600))
    else:
        replaced_flag(marker).unlink(missing_ok=True)


@contextlib.contextmanager
def noting_signin(path, marker):
    """Around the client's login: whether it finishes, fails or is interrupted after writing the sign-in,
    note a sign-in file that is new or changed."""
    before = file_digest(path)
    try:
        yield
    finally:
        after = file_digest(path)
        if after is not None and after != before:
            remember_signin(marker, after, replaced=before is not None)


def marker_digest(marker):
    """The digest a sign-in marker holds: None when there is no marker, '' when it is unreadable or not a digest."""
    try:
        text = marker.read_bytes().decode('ascii').strip()
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError):
        return ''
    return text.lower() if re.fullmatch(r'[0-9a-fA-F]{64}', text) else ''


def settle_signin(path, marker, minted):
    """After a successful run, fresh or resumed: remove the sign-in this installer created, and only that one."""
    recorded, flag = marker_digest(marker), replaced_flag(marker)
    if recorded and file_digest(path) == recorded:
        path.unlink()
        if flag.exists():
            print('Sign-in ........... removed from this Mac; it replaced an earlier sign-in, so run plow-agents login '
                  'again if you still need one', flush=True)
        else:
            print('Sign-in ........... removed from this Mac; the agent keeps its own credential', flush=True)
    elif path.exists() and (recorded or minted):
        # A sign-in someone made after this installer's, or one this run minted with but did not create.
        print('Sign-in ........... kept; revoke the plow-agents session in Plow Latch if you no longer need it', flush=True)
    for note in (marker, flag):  # every outcome retires the notes; a stale marker never decides anything
        with contextlib.suppress(OSError):
            note.unlink(missing_ok=True)


def announce_line(line):
    print(f'Line .............. {line.get("display_name") or line["uid"]} {line.get("provider_key") or ""}', flush=True)


def credential_for_new_line(args, path=None, command='./relay agent', marker=None):
    """Sign in when needed, choose a free line and mint its credential. Returns the line.

    The credential is the installed agent's unless another agent's own path is named. Whichever it is,
    ensure_credential still refuses to write over a credential that belongs to another line.

    marker is where a sign in this run creates is noted, so that whoever created it settles it. It is
    this installer's own note unless a caller keeping its own state passes another.
    """
    path = path or CREDENTIAL
    marker = marker or signin_marker()
    client = official()
    try:
        token = client['account_token'](SimpleNamespace(token_file=None))
    except SystemExit:
        token = None
    if token is None or args.new_line:
        print('Plow sign-in ...... follow the activation text below', flush=True)
        with noting_signin(signin_path(), marker):
            client['login'](SimpleNamespace(api_base=ORIGIN, token_file=None, new_line=args.new_line))
        token = client['account_token'](SimpleNamespace(token_file=None))
    line = choose_line(client['account_lines'](ORIGIN, token), lambda options: ask_for_line(options, command),
                       getattr(args, 'line', None), interactive=bool(sys.stdin and sys.stdin.isatty()),
                       command=command)
    announce_line(line)
    outcome = ensure_credential(path, line, identity, lambda target, uid: mint_credential(client, target, uid))
    print(f'Credential ........ {outcome}', flush=True)
    return line


def install(args):
    missing = preflight()
    if missing:
        for item in missing:
            print('Needed: ' + item, file=sys.stderr, flush=True)
        return 1
    print('Docker ............ ready', flush=True)
    resuming = CREDENTIAL.exists()
    project, reused = guard_docker(fresh=not resuming)  # before signing in, minting or starting anything
    if reused:
        print("Memory ............ reused from this folder's earlier install", flush=True)
    if resuming:
        # A rerun after minting continues with that agent's own line; no sign-in or line choice.
        line = existing_line(CREDENTIAL, identity)
        refuse_other_line(line, args)
        announce_line(line)
        print('Credential ........ reused', flush=True)
    else:
        line = credential_for_new_line(args)
    project, _ = guard_docker(fresh=not resuming)  # again: signing in can take minutes
    print('Starting the agent (the first start downloads several GB) ...', flush=True)
    try:
        started = compose('up', '-d', '--build')
    except subprocess.TimeoutExpired:
        raise AgentError('The first download is still running or stalled. Run ./relay agent again to continue; '
                         'Docker keeps what it already downloaded.') from None
    if started.returncode:
        raise AgentError('Docker could not start the agent. The output above shows why.')
    remember_install(install_record(), project, AGENT)
    state, detail = wait_ready(lambda: compose('logs', '--no-color', '--since', '15m', 'agent', capture=True).stdout)
    if state != 'ready':
        raise AgentError(detail)
    print('Agent ready ....... ' + detail.split(READY)[-1].strip(), flush=True)
    print('Testing Hermes .... ' + speak(FIRST_PROMPT), flush=True)
    settle_signin(signin_path(), signin_marker(), minted=not resuming)
    print(f'\nDone. Text {line.get("provider_key") or "your line"} to talk to your agent.', flush=True)
    print('Next: ./relay agent status, ./relay agent test "prompt", ./relay agent stop', flush=True)
    return 0


def plow_tokens():
    """The account sign-in and agent credential tokens on this Mac, read only to keep them out of the log."""
    tokens = []
    with contextlib.suppress(OSError, UnicodeError):
        tokens.append(signin_path().read_text().strip())
    with contextlib.suppress(OSError, UnicodeError):
        tokens += [text.partition('=')[2].strip() for text in CREDENTIAL.read_text().splitlines()
                   if text.startswith('PLOW_AGENT_TOKEN=')]
    return [token for token in tokens if token]


def record_failure(error, path):
    """Append the full traceback to the install log under a UTC timestamp, with any Plow token removed.

    A traceback holds code and exception text only: no environment, locals or file contents.
    """
    text = ''.join(traceback.format_exception(type(error), error, error.__traceback__))
    for token in plow_tokens():
        text = text.replace(token, '[token removed]')
    path.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600), 'a', encoding='utf-8') as log:
        log.write(f'=== {datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ} ===\n{text}\n')


def run_agent(args):
    action = getattr(args, 'agent_action', None)
    try:
        trust_certifi()  # before the client download and every Plow call
        if action == 'status':
            running = compose('ps', '--status', 'running', '--quiet', capture=True).stdout.strip() != ''
            configured = READY in (compose('logs', '--no-color', 'agent', capture=True).stdout or '')
            line = None
            if CREDENTIAL.exists():
                with contextlib.suppress(Exception):
                    line = (identity(CREDENTIAL) or {}).get('line')
            print(status_report(running, line, configured, reporter_state(), reported_usage()), flush=True)
            return 0
        if action == 'test':
            print(speak(args.prompt), flush=True)
            return 0
        if action == 'stop':
            compose('stop')
            print('Stopped. Memory, install identity and reporting state are kept.', flush=True)
            return 0
        if action == 'model':
            return model_command(args)
        state = ROOT / '.data/agent'
        state.mkdir(parents=True, exist_ok=True)
        with exit_on_sigterm(), installation_lock(state / 'install.lock'):
            return install(args)
    except AgentError as error:
        print(str(error), file=sys.stderr, flush=True)
        return error.code
    except KeyboardInterrupt:
        print('Stopped before finishing. Nothing was left half-created; run it again to continue.',
              file=sys.stderr, flush=True)
        return 1
    except Exception as error:
        log = ROOT / '.data/agent/install.log'
        try:
            record_failure(error, log)
            where = f'. Details: {log}.'
        except OSError:
            where = ' and the details could not be saved.'
        what, again = ('The install', './relay agent') if action is None else (f'./relay agent {action}', 'it')
        print(f'{what} stopped unexpectedly{where} Running {again} again is safe.', file=sys.stderr, flush=True)
        return 1
