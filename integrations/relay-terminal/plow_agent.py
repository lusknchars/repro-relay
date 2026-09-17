"""One-command install for the Plow chat agent on the owner's own line.

Wraps the pinned official plow-agents client. It never selects an occupied line,
never overwrites a credential, and never deletes the agent's data volume.
"""
import contextlib
from datetime import datetime, timezone
import hashlib
import http.client
import json
import os
from pathlib import Path
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


class AgentError(Exception):
    """A stop with an explanation the owner can act on."""
    code = 1


class DecisionNeeded(AgentError):
    """A stop until the owner makes a choice, such as which line to use. Exit code 2 means exactly that."""
    code = 2


class PlowUnreachable(AgentError):
    """Plow gave no usable answer (network, timeout or unreadable reply), so nothing was learned about a credential."""


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


def choose_line(lines, ask, wanted=None, interactive=True):
    """Select a free line. Occupied lines are never taken from their agent.

    Free lines are listed in uid order, so a position means the same line on the next run.
    """
    free = sorted((line for line in lines if not line.get('agent_uid')), key=lambda line: line['uid'])
    if not free:
        held = len(lines) - len(free)
        detail = f'{held} line(s) already answer as an agent. ' if held else 'This account holds no assistant line. '
        raise DecisionNeeded(detail + 'Run `./relay agent --new-line` to have Plow provision one, '
                             'or retire an existing agent with `plow-agents revoke <line>` first.')
    if wanted is not None:
        chosen = find_line(free, wanted)
        if chosen is None:
            raise choose_later(f'No free line matches --line {wanted}. The free lines are:', free)
        return chosen
    if len(free) == 1:
        return free[0]
    if not interactive:
        raise choose_later('Several free lines are available, and there is no terminal to ask which one to use:', free)
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


def choose_later(reason, free):
    """A stop that lists the free lines and the exact command that picks one without asking."""
    return DecisionNeeded(f'{reason}\n{line_choices(free)}\nChoose one with: ./relay agent --line <position>')


def existing_line(path, identity):
    """The line an existing credential answers on, as Plow reports it. The file is only ever read."""
    reason = ''
    try:
        found = identity(path)
    except PlowUnreachable:
        raise AgentError('Could not verify the existing credential with Plow right now. It was left untouched; '
                         'run ./relay agent again later.') from None
    except AgentError as error:
        found, reason = None, f' {error}'
    line = found.get('line') if isinstance(found, dict) else None
    if not isinstance(line, dict) or not line.get('uid'):
        raise AgentError(f'The existing credential {path} could not be verified with Plow.{reason} It was left untouched. '
                         'Check the connection and run ./relay agent again; if that agent was retired, '
                         'remove the file yourself first.')
    return line


def refuse_other_line(line, args):
    """On a resume, --new-line or a --line naming another line cannot apply: this folder's agent keeps its line."""
    wanted = getattr(args, 'line', None)
    if getattr(args, 'new_line', False) or (wanted is not None and not names_line(line, wanted)):
        label = ' '.join(part for part in (line.get('display_name') or line['uid'], line.get('provider_key')) if part)
        raise DecisionNeeded(f'This folder already runs an agent on {label}. To use another line, install in a new folder.')


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
        return (f'the secure connection could not be verified ({reason}); if this Python has no certificates, '
                'python3 -m pip install certifi provides them')
    return f'the network request failed ({reason})'


def mint_credential(client, path, uid):
    """Mint the line's agent credential with the official client.

    Only the client's command line fills in agent_api_base; calling mint directly must name it,
    or the client fails writing the credential and retires the agent it just created.
    """
    client['mint'](SimpleNamespace(line=uid, credential_file=str(path), token_file=None,
                                   api_base=ORIGIN, agent_api_base=ORIGIN))


def compose(*arguments, capture=False):
    return subprocess.run(['docker', 'compose', *arguments], cwd=AGENT,
                          capture_output=capture, text=True, timeout=1800)


def identity(path):
    """Who a credential answers as, according to Plow. When Plow cannot say, an AgentError says why.

    PlowUnreachable means no usable answer arrived: the bridge raised for a network error, a timeout or a reply
    that is not JSON, rather than for an HTTP status or its own checks.
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
        if isinstance(cause, (OSError, ValueError)) and not isinstance(cause, urllib.error.HTTPError):
            raise PlowUnreachable(str(error)) from None
        raise AgentError(str(error)) from None


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


def ask_for_line(options):
    print('\nSeveral free lines are available:', flush=True)
    print(line_choices(options), flush=True)
    while True:
        try:
            answer = input('Choose a line number: ').strip()
        except EOFError:
            print(flush=True)
            raise choose_later('No line was chosen. The free lines are:', options) from None
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


def signin_path():
    """The full-access account sign-in, resolved exactly as the pinned client's account_token resolves it."""
    config = os.environ.get('XDG_CONFIG_HOME') or os.path.join(os.path.expanduser('~'), '.config')
    return Path(os.path.join(config, 'plow', 'token'))


def signin_marker():
    """Where the installer notes a sign-in it created: the SHA-256 of that file's bytes, never the token."""
    return ROOT / '.data/agent/signin-created.sha256'


def remember_signin(path, marker):
    """Record the sign-in this run's activation just wrote, so a later successful run can remove exactly that file."""
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    marker.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as output:
        output.write(digest + '\n')
    os.chmod(marker, 0o600)


def settle_signin(path, marker, minted):
    """After a successful run, fresh or resumed: remove the sign-in this installer created, and only that one."""
    kept = 'Sign-in ........... kept; revoke the plow-agents session in Plow Latch if you no longer need it'
    try:
        recorded = marker.read_text().strip()
    except OSError:
        if minted and path.exists():
            print(kept, flush=True)
        return
    try:
        current = hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        current = None
    if current == recorded:
        path.unlink()
        print('Sign-in ........... removed from this Mac; the agent keeps its own credential', flush=True)
    elif path.exists():
        print(kept, flush=True)  # someone signed in again since; that sign-in is theirs
    marker.unlink(missing_ok=True)


def announce_line(line):
    print(f'Line .............. {line.get("display_name") or line["uid"]} {line.get("provider_key") or ""}', flush=True)


def credential_for_new_line(args):
    """Sign in when needed, choose a free line and mint its credential. Returns the line."""
    client = official()
    try:
        token = client['account_token'](SimpleNamespace(token_file=None))
    except SystemExit:
        token = None
    if token is None or args.new_line:
        print('Plow sign-in ...... follow the activation text below', flush=True)
        client['login'](SimpleNamespace(api_base=ORIGIN, token_file=None, new_line=args.new_line))
        remember_signin(signin_path(), signin_marker())
        token = client['account_token'](SimpleNamespace(token_file=None))
    line = choose_line(client['account_lines'](ORIGIN, token), ask_for_line, getattr(args, 'line', None),
                       interactive=bool(sys.stdin and sys.stdin.isatty()))
    announce_line(line)
    outcome = ensure_credential(CREDENTIAL, line, identity, lambda path, uid: mint_credential(client, path, uid))
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
