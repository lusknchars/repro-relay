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
import tempfile
import time
import traceback
from types import SimpleNamespace
import urllib.error
import urllib.request

import private_files
from private_files import host_platform, relay_command

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
OWNER_PLATFORM = 'RELAY_OWNER_PLATFORM'  # the same name agent/compose.yml passes into the container
OWNER_PLATFORM_UNKNOWN = 'unknown'  # what the container is told when nothing said which computer this is
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000  # the least OpenProcess right that answers "does this id exist"
ERROR_INVALID_PARAMETER = 87  # what Windows reports for a process id that is not in use
GATEWAY_SERVICE = '/run/service/hermes-gateway'
MODEL_ID = re.compile(r'[^/\s]+/[^/\s]+')
MODEL_CHECK_PROMPT = 'Reply in one short sentence: which model are you, and who made you?'
ENV_FILE = AGENT / '.env'  # untracked, and the file Compose reads for the values compose.yml passes in
ENV_LABEL = 'agent/.env'
ENV_LIMIT = 65536
ENV_NAME = re.compile(r'[A-Za-z_][A-Za-z0-9_]*')
SAFE_VALUE = re.compile(r'[A-Za-z0-9][\w./:-]{0,127}')  # a provider name or a model id, on one line, unquoted
CONTAINER_ENVIRONMENT = '/run/s6/container_environment'  # where the image keeps what with-contenv hands a service
PROVIDER_VARIABLE = 'HERMES_PROVIDER'  # read by the image's own boot script; agent/compose.yml passes it in
MODEL_VARIABLE = 'HERMES_MODEL'
DEFAULT_PROVIDER = 'plow'  # what an install that says nothing about providers runs on, today and after this
MODEL_LIST_TIMEOUT = 30
# Every provider this command knows how to configure. Plow has no entry of its own beyond its name: its key
# is the agent credential the install already mints, and the values its model block needs come back from a
# backup that carried them rather than from anything written here. Adding a provider is one entry plus one
# line in agent/compose.yml for its key.
PROVIDERS = {
    'plow': {'name': 'plow'},
    'kimi': {'name': 'kimi', 'base_url': 'https://api.moonshot.ai/v1', 'key_env': 'MOONSHOT_API_KEY'},
}


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
                         f'then run {relay_command()} agent again.')
    if others:
        raise AgentError(f"This folder's agent already runs under the Docker project '{others[0]}'. "
                         f'Put COMPOSE_PROJECT_NAME={others[0]} in agent/.env so every {relay_command()} agent command uses it.')


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
    """Record, owner-only, the project, the resolved agent/ folder and the computer a `compose up` used.

    The platform is one of 'macos', 'windows' or 'linux'. A record written before this
    existed has no platform key at all, which reads as not known rather than as any
    particular computer.
    """
    record.parent.mkdir(parents=True, exist_ok=True)
    with os.fdopen(os.open(record, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w',
                   encoding='utf-8', newline='') as output:
        json.dump({'project': name, 'agent_dir': str(Path(folder).resolve()),
                   'platform': host_platform()}, output)
    protect_or_stop(record)


def protect_or_stop(path, executable=False):
    """Make a path private, or stop with the reason. Nothing here is worth leaving readable."""
    try:
        private_files.protect(path, executable=executable)
    except private_files.PrivacyError as error:
        raise AgentError(str(error)) from None


def refuse_copied_credential(agents, folder):
    """Stop when an agent in another folder, in any Compose project, was installed with this folder's credential."""
    uid = agent_uid(folder / 'plow-credentials')
    if not uid:
        return
    for working_dir, _, _ in agents:
        if working_dir and not same_folder(working_dir, folder) and agent_uid(Path(working_dir) / 'plow-credentials') == uid:
            raise AgentError(f'This credential already belongs to the agent in {working_dir}. One credential runs in one '
                             f'place: remove that agent with docker compose down in {working_dir}, or delete '
                             f'agent/plow-credentials here so {relay_command()} agent mints this folder its own.')


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
                         f'Run {relay_command()} agent again.')
    return [([part.strip() for part in text.split('\t')] + [''] * fields)[:fields]
            for text in result.stdout.splitlines() if text.strip()]


def same_folder(one, other):
    """Compare the folders themselves when both exist (symlinks, letter case); otherwise their resolved paths."""
    try:
        return os.path.samefile(one, other)
    except OSError:
        return Path(one).resolve() == Path(other).resolve()


def default_command():
    """What to call this command when nobody named one: the installed agent's, spelled for this host."""
    return f'{relay_command()} agent'


def choose_line(lines, ask, wanted=None, interactive=True, command=None):
    """Select a free line. Occupied lines are never taken from their agent.

    Free lines are listed in uid order, so a position means the same line on the next run.
    command names the command whose rerun would choose a line, so a stop names the one the owner ran.
    """
    command = command or default_command()
    free = sorted((line for line in lines if not line.get('agent_uid')), key=lambda line: line['uid'])
    if not free:
        held = len(lines) - len(free)
        # The client is a file this installer downloads, not something on anybody's PATH, so
        # name it the way a person can actually run it. Telling them `plow-agents ...` sends
        # them to a command not found, which is where this message used to leave people.
        client = f'python3 {CLIENT.relative_to(ROOT)}'
        if held:
            raise DecisionNeeded(f'{held} line(s) already answer as an agent. Run '
                                 f'`{command} --new-line` to have Plow provision another, or see them with '
                                 f'`{client} lines` and retire one with `{client} revoke <line>` first.')
        raise DecisionNeeded('This account holds no assistant line at all. Run '
                             f'`{command} --new-line` to have Plow provision the first one. If that is '
                             f'refused, the account itself cannot provision yet, which is Plow\'s to answer '
                             f'rather than this installer: `{client} lines` shows what the account holds, and '
                             f'`{client} login` signs it in if it is not.')
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


def choose_later(reason, free, command=None):
    """A stop that lists the free lines and the exact command that picks one without asking."""
    command = command or default_command()
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
                         f'run {relay_command()} agent again once that is fixed.') from None
    except CredentialRejected as error:
        raise AgentError(f'The existing credential {path} could not be verified with Plow. {error} It was left untouched. '
                         f'If that agent was retired, remove the file yourself first, then run {relay_command()} agent again.') from None
    except AgentError as error:
        raise AgentError(f'The existing credential {path} could not be used: {error} It was left untouched.') from None
    line = found.get('line') if isinstance(found, dict) else None
    if not isinstance(line, dict) or not line.get('uid'):
        raise AgentError('Could not verify the existing credential with Plow right now. It was left untouched; '
                         f'run {relay_command()} agent again later.')
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
    if private_files.windows():
        return windows_process_alive(pid)
    if os.name != 'posix':
        return True  # the question cannot be asked here, so a lock is never taken away
    try:
        os.kill(pid, 0)  # signal 0 only checks
    except ProcessLookupError:
        return False
    except OSError:
        return True  # it exists but belongs to someone else
    return True


def windows_process_alive(pid, kernel32=None):
    """Whether a process id is in use on Windows, asked without touching the process.

    os.kill(pid, 0) terminates a process there, so the question goes to OpenProcess with
    the smallest right that answers it. A handle means the process exists, and is given
    straight back. No handle plus ERROR_INVALID_PARAMETER means the id is not in use.
    Anything else, being refused included, means it exists and belongs to someone else, so
    an install lock is left where it is.
    """
    try:
        if kernel32 is None:
            kernel32 = windows_kernel32()
        handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if handle:
            kernel32.CloseHandle(handle)
            return True
        return kernel32.GetLastError() != ERROR_INVALID_PARAMETER
    except (OSError, AttributeError, ValueError):
        return True  # the question could not be asked, so the lock stays where it is


def windows_kernel32():
    """kernel32, with the shapes a handle and an error code actually have.

    Without a restype a returned HANDLE comes back through a C int and a high one is
    truncated, which would read as no handle and so as a process that is not there. The error
    belongs to the call, so it is taken from ctypes rather than from a second call that
    anything in between could have reset.
    """
    import ctypes
    library = ctypes.WinDLL('kernel32', use_last_error=True)
    library.OpenProcess.restype = ctypes.c_void_p
    library.OpenProcess.argtypes = (ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32)
    library.CloseHandle.restype = ctypes.c_int
    library.CloseHandle.argtypes = (ctypes.c_void_p,)
    return SimpleNamespace(OpenProcess=library.OpenProcess, CloseHandle=library.CloseHandle,
                           GetLastError=ctypes.get_last_error)


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
        # Before the download, not only before Plow: a Windows Python often has no issuer for
        # GitHub's certificate until a bundle is pointed at, and this is the first HTTPS call.
        trust_certifi()
        CLIENT.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urllib.request.urlopen(CLIENT_URL, timeout=60) as response:
                data = response.read(2_000_001)
        except (OSError, http.client.HTTPException, ValueError) as error:
            raise AgentError(f'The official Plow client could not be downloaded from GitHub: {download_problem(error)}. '
                             f'Nothing was installed; run {relay_command()} agent again once that is fixed.') from None
        if hashlib.sha256(data).hexdigest() != CLIENT_SHA256:
            raise AgentError('The official Plow client did not match its pinned checksum. Nothing was installed.')
        CLIENT.write_bytes(data)
        protect_or_stop(CLIENT, executable=True)
    else:
        # Before the checksum, not after: one written by an installer from before any of this
        # keeps whatever it inherited, and verifying and then reading again is a window for
        # anyone who can write it.
        protect_or_stop(CLIENT, executable=True)
        if hashlib.sha256(CLIENT.read_bytes()).hexdigest() != CLIENT_SHA256:
            raise AgentError(f'{CLIENT} differs from the pinned official client. Inspect it before continuing.')
    return portable_private_write(runpy.run_path(str(CLIENT)))


def portable_private_write(client):
    """Give the official client a private write this host can actually finish.

    It writes the credential and the sign in token with os.fchmod and a plain rename.
    Windows has no os.fchmod, keeps mode 0666 whatever was asked for, so the client's own
    mode check can never pass, and refuses a rename while another process still holds the
    file. Left alone it would stop, or leave a token other accounts can read. Only the
    write is replaced and only on Windows: the client still decides what the file says,
    and macOS and Linux keep its own code exactly as it is.
    """
    if private_files.windows():
        # run_path hands back a copy of the client's globals; its functions read the original.
        client['mint'].__globals__['write_private'] = windows_write_private
    return client


def windows_write_private(path, body):
    """The client's private write, done the way this host makes a file private."""
    try:
        return private_files.write_privately(path, body)
    except private_files.PrivacyError as error:
        raise AgentError(str(error)) from None


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


def compose_environment(environ=None):
    """The environment every docker compose call runs with.

    It carries the owner's computer into the container as RELAY_OWNER_PLATFORM, because the
    agent runs on Linux inside Docker and cannot read the host's install record. agent/
    compose.yml passes it through. A container created before this existed has no value at
    all there, and an absent value means not known, never macOS.
    """
    environment = dict(os.environ if environ is None else environ)
    environment[OWNER_PLATFORM] = host_platform()
    return environment


def compose(*arguments, capture=False, input=None, cwd=None):
    """Compose in the installed agent's folder, or in another agent's own folder when one is named.

    utf-8 rather than the console code page: the container answers in the owner's own
    language, and a cp1252 decode would quietly mangle it instead of failing.
    """
    return subprocess.run(['docker', 'compose', *arguments], cwd=cwd or AGENT, env=compose_environment(),
                          capture_output=capture, text=True, encoding='utf-8', errors='replace',
                          timeout=1800, input=input)


def read_env_file(path=None):
    """agent/.env as a mapping of name to value, or a refusal naming the line that is not NAME=value.

    Compose reads this file for the variables agent/compose.yml passes into the container, so it is read
    the same way here: blank lines and comments ignored, an optional export, and quotes around a value
    removed. Nothing in a value is interpreted, and no value is ever printed.
    """
    path = Path(ENV_FILE if path is None else path)
    if not path.is_file():
        return {}
    try:
        if path.stat().st_size > ENV_LIMIT:
            raise DecisionNeeded(f'{ENV_LABEL} is larger than 64 KiB, which is not a file of variables. Point it at '
                                 'the right file, then run this again. Nothing was changed.')
        text = path.read_text(encoding='utf-8')
    except UnicodeError:
        raise DecisionNeeded(f'{ENV_LABEL} is not UTF-8 text, so neither this command nor Compose can read it. '
                             'Nothing was changed.') from None
    except OSError as error:
        raise AgentError(f'{ENV_LABEL} could not be read: {error.strerror or error}.') from None
    values = {}
    for number, raw in enumerate(text.splitlines(), start=1):
        entry = raw.strip()
        if not entry or entry.startswith('#'):
            continue
        if entry.startswith('export '):
            entry = entry[len('export '):].lstrip()
        name, separator, value = entry.partition('=')
        name = name.strip()
        if not separator or not ENV_NAME.fullmatch(name):
            raise DecisionNeeded(f'{ENV_LABEL} line {number} is not NAME=value, so Compose cannot read it either. '
                                 'Fix that line, then run this again. Nothing was changed.')
        value = value.strip()
        quoted = len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'")
        if quoted:
            value = value[1:-1]
        elif '#' in value:
            # Compose reads what follows a # in an unquoted value as a comment. Rather than guess which of
            # the two readings is the owner's, say so: a key read one way here and another way in the
            # container is exactly the kind of quiet disagreement this command must not have.
            raise DecisionNeeded(f'{ENV_LABEL} line {number} has a # in an unquoted value, which Compose reads as '
                                 'the start of a comment. Put quotes around that value, then run this again. '
                                 'Nothing was changed.')
        values[name] = value
    return values


def env_text_with(text, values):
    """The .env text with each name set to its value: the line that already defines it rewritten where it
    is, a new line at the end otherwise, and every other line left exactly as it is."""
    lines = text.splitlines(keepends=True)
    for name, value in values.items():
        for index, raw in enumerate(lines):
            entry = raw.strip()
            if entry.startswith('export '):
                entry = entry[len('export '):].lstrip()
            if not entry or entry.startswith('#') or '=' not in entry:
                continue
            if entry.partition('=')[0].strip() == name:
                lines[index] = f'{name}={value}\n'
                break
        else:
            if lines and not lines[-1].endswith('\n'):
                lines[-1] += '\n'
            lines.append(f'{name}={value}\n')
    return ''.join(lines)


def write_env_values(values, path=None):
    """Set these variables in agent/.env, keeping everything else in it, and leave the file readable only by
    this account.

    Compose reads the file when the container is built again, which is how a provider chosen here outlives
    the container it was chosen on. The owner's own lines, the provider key among them, are never touched.
    """
    path = Path(ENV_FILE if path is None else path)
    for name, value in values.items():
        if not ENV_NAME.fullmatch(name) or not SAFE_VALUE.fullmatch(str(value)):
            raise AgentError(f'{name} could not be written to {ENV_LABEL} as one plain value. Nothing was changed.')
    try:
        text = path.read_text(encoding='utf-8') if path.is_file() else ''
    except (OSError, UnicodeError) as error:
        raise AgentError(f'{ENV_LABEL} could not be read to add {", ".join(values)} to it: {error}.') from None
    write_env_file(path, env_text_with(text, values))


def write_env_file(path, text):
    """Replace agent/.env with text, through a file of its own beside it that is locked to this account
    before anything is written into it, so a key is never briefly readable by another account and a write
    that cannot be finished leaves the file that is there alone.

    private_files does the locking and the replacement, because it is the one primitive that also works on
    Windows, where mode bits decide nothing. The folder's own permissions are left as the owner has them.
    """
    descriptor, temporary = tempfile.mkstemp(dir=str(Path(path).parent), prefix='.env.', suffix='.new')
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='') as handle:
            protect_or_stop(temporary)
            handle.write(text)
        private_files.replace_atomically(temporary, str(path))
    except private_files.PrivacyError as error:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise AgentError(str(error)) from None
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise
    protect_or_stop(path)


def provider_key(entry):
    """One provider's key, read from agent/.env. Never an argument, never printed, never in a tracked file.

    The file is locked to this account before it is read, because that is where the key lives from now on.
    """
    path = Path(ENV_FILE)
    if not path.is_file():
        raise DecisionNeeded(f'There is no {ENV_LABEL}, so there is no key for {entry["name"]} to use. Create that '
                             f'file with a line reading {entry["key_env"]}=your key. Git does not track it. Then '
                             'run this again.')
    protect_or_stop(path)
    value = read_env_file(path).get(entry['key_env'], '')
    if not value:
        raise DecisionNeeded(f'{ENV_LABEL} has no {entry["key_env"]}, so {entry["name"]} cannot be asked what this '
                             f'account has and the agent could not sign its calls. Add a line reading '
                             f'{entry["key_env"]}=your key there, then run this again. Nothing was changed.')
    return value


def provider_models(entry, key, opener=None):
    """Which models a provider says this key can use, asked of the provider itself.

    The OpenAI shaped list these providers serve: GET <base_url>/models with the key as a bearer token,
    answering {"data": [{"id": ...}, ...]}. Asking beats assuming, because the list is per account: a model
    the account does not have answers 404 at the first real call, long after the switch, and reads as a
    fault in this command rather than something to fix on the account.
    """
    url = entry['base_url'].rstrip('/') + '/models'
    request = urllib.request.Request(url, headers={'Authorization': f'Bearer {key}', 'Accept': 'application/json'})
    try:
        with (opener or urllib.request.urlopen)(request, timeout=MODEL_LIST_TIMEOUT) as response:
            payload = json.loads(response.read(1 << 20).decode('utf-8'))
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise DecisionNeeded(f'{entry["name"]} did not accept that key (HTTP {error.code}). Check that '
                                 f'{entry["key_env"]} in {ENV_LABEL} is the key for the account you mean to use, '
                                 'then run this again. Nothing was changed.') from None
        raise AgentError(f'{entry["name"]} answered HTTP {error.code} when asked which models this key can use. '
                         'Nothing was changed.') from None
    except urllib.error.URLError as error:
        reason = getattr(error, 'reason', None) or error
        if isinstance(reason, ssl.SSLError):
            raise CertificateUnverified(f'{entry["name"]} could not be asked which models this key can use because '
                                        f'{certificate_hint(reason)}. Nothing was changed.') from None
        raise AgentError(f'{entry["name"]} could not be reached to ask which models this key can use ({reason}). '
                         'Nothing was changed.') from None
    except (OSError, ValueError, UnicodeError) as error:
        raise AgentError(f'{entry["name"]} did not answer with a model list this command could read ({error}). '
                         'Nothing was changed.') from None
    listed = payload.get('data') if isinstance(payload, dict) else None
    models = [item['id'] for item in listed
              if isinstance(item, dict) and isinstance(item.get('id'), str) and item['id']] \
        if isinstance(listed, list) else []
    if not models:
        raise AgentError(f'{entry["name"]} listed no models for this key, so there is nothing to switch to. '
                         'Nothing was changed.')
    return models


def choose_model(entry, key, model_id, opener=None):
    """The model to switch to, checked against what the provider says this key can actually use."""
    models = provider_models(entry, key, opener=opener)
    if not model_id:
        raise DecisionNeeded(f'No model was given. On {entry["name"]} this key can use {", ".join(models)}. Choose '
                             'one with --model. Nothing was changed.')
    if not SAFE_VALUE.fullmatch(model_id) or model_id not in models:
        raise DecisionNeeded(f'{entry["name"]} does not have "{model_id}" on this account. It has '
                             f'{", ".join(models)}. Choose one of those with --model. Nothing was changed.')
    return model_id


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


def ask_for_line(options, command=None):
    command = command or default_command()
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
        raise AgentError(f'{relay_command()} agent model needs PyYAML to read and edit the config. Install it with '
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
        raise DecisionNeeded(f'The agent config does not have the model block {relay_command()} agent model expects '
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


def _set_child_line(lines, parent, key, value, insert=True):
    """lines with parent.key set to value, in place, keeping a trailing comment on that line if it has one.

    When the key is not there at all it is added at the end of that block, unless insert is False, which is
    how model.default says it must already exist.

    Refuses (DecisionNeeded) when the parent block itself is written in flow style, the same unsupported
    shape as its providers.* siblings, by name and with a remedy -- not the generic "Could not locate"
    AgentError, which reads as an internal error rather than a decision about the owner's own config.
    Raises plain AgentError only when the line genuinely cannot be located or added some other way.
    """
    parent_index = _top_key_line(lines, parent)
    if parent_index is not None and _is_flow_style(lines[parent_index]):
        raise DecisionNeeded(f'{parent} is written in flow style ({{...}} or [...]) in the agent config; changing '
                             f'{parent}.{key} there is not supported. Edit it to block style yourself, then run '
                             'this again. Nothing was changed.')
    start, end = (None, None) if parent_index is None else _child_block(lines, parent_index)
    at = None if parent_index is None else _child_key_line(lines, start, end, key)
    if at is None:
        if parent_index is None or not insert:
            raise AgentError(f'Could not locate {parent}.{key} in the config text to edit it. Nothing was changed.')
        indent = _first_child_indent(lines, start, end, _line_indent(lines[parent_index]) + _indent_step(lines))
        while end > start and not lines[end - 1].strip():  # a blank line at the end of the block stays at the end
            end -= 1
        lines[end:end] = [f'{" " * indent}{key}: {value}\n']
        return lines
    comment_match = _TRAILING_COMMENT.search(lines[at])
    comment = comment_match.group(1) if comment_match else ''
    lines[at] = re.sub(rf'^([ \t]*{re.escape(key)}:).*$', lambda m: f'{m.group(1)} {value}{comment}',
                       lines[at], count=1)
    return lines


def _remove_child_line(lines, parent, key):
    """lines with parent.key, and anything written under it, removed in place. Absent already: unchanged.

    Blank lines after the removed block are kept: they belong to whatever follows, not to the key going
    away, and this edit changes as little of the owner's file as it can.
    """
    parent_index = _top_key_line(lines, parent)
    if parent_index is None or _is_flow_style(lines[parent_index]):
        return lines
    start, end = _child_block(lines, parent_index)
    at = _child_key_line(lines, start, end, key)
    if at is None:
        return lines
    _, last = _child_block(lines, at)
    while last > at + 1 and not lines[last - 1].strip():
        last -= 1
    del lines[at:last]
    return lines


def _set_default_line(lines, model_id):
    """lines with model.default's value replaced, in place, keeping a trailing comment on that line if it
    has one. The default: line must already exist; nothing here creates a model block."""
    return _set_child_line(lines, 'model', 'default', model_id, insert=False)


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


def provider_entry(name):
    """One provider this command knows how to configure, or a refusal naming the ones it does."""
    if not name:
        raise DecisionNeeded(f'No provider was given. This command knows {", ".join(PROVIDERS)}.')
    entry = PROVIDERS.get(name)
    if entry is None:
        raise DecisionNeeded(f'"{name}" is not a provider this command knows how to set up. It knows '
                             f'{", ".join(PROVIDERS)}. Nothing was changed.')
    return entry


def provider_summary(text):
    """The provider the agent is configured to call, the model it defaults to, the variable that holds that
    provider's key, and every provider the config knows about, from the raw config text.

    The key variable is the provider's own when its block names one, and the model block's otherwise, which
    is where Plow keeps it.
    """
    config = load_model_config(text)
    model = config['model']
    providers = config.get('providers') if isinstance(config.get('providers'), dict) else {}
    block = providers.get(model['provider'])
    block = block if isinstance(block, dict) else {}
    return {'provider': model['provider'], 'default': model['default'],
            'key_env': block.get('key_env') or model.get('key_env'), 'known': list(providers)}


def _scalar(value):
    """One value as YAML text on a single line, quoted only where YAML itself needs the quotes.

    safe_dump ends a bare scalar document with an explicit ... marker, which is not part of the value.
    """
    yaml = yaml_module()
    text = yaml.safe_dump(value, default_flow_style=True, width=10 ** 6).strip()
    if text.endswith('\n...'):
        text = text[:-len('\n...')].strip()
    if not text or '\n' in text:
        raise AgentError('A value for the agent config could not be written on one line. Nothing was changed.')
    return text


def _provider_lines(entry, model_id, indent, step):
    """The block one provider is written as: its name, where its calls go, which variable holds its key, and
    the model this switch is for."""
    inner = indent + step
    return [f'{" " * indent}{_scalar(entry["name"])}:\n',
            f'{" " * inner}name: {_scalar(entry["name"])}\n',
            f'{" " * inner}base_url: {_scalar(entry["base_url"])}\n',
            f'{" " * inner}key_env: {_scalar(entry["key_env"])}\n',
            f'{" " * inner}models:\n',
            f'{" " * (inner + step)}{_scalar(model_id)}: {{}}\n']


def _ensure_provider_block(lines, entry, model_id, original):
    """lines with providers.<provider> present and carrying model_id, in place.

    A provider that is not in the config yet is written whole. One that is already there is left exactly as
    the owner has it and only gains the model id, so a base_url or key_env they changed themselves survives
    the switch. The shapes this cannot write into are refused by name in _expected_provider first; the flow
    style ones, which only the text can show, are refused here.
    """
    name = entry['name']
    providers = original.get('providers')
    if isinstance(providers, dict) and isinstance(providers.get(name), dict):
        return _ensure_model_id(lines, name, model_id, original)
    step = _indent_step(lines)
    providers_index = _top_key_line(lines, 'providers')
    if providers_index is None:
        if lines and not lines[-1].endswith('\n'):
            lines[-1] += '\n'
        return lines + ['providers:\n'] + _provider_lines(entry, model_id, step, step)
    if _is_flow_style(lines[providers_index]):
        raise DecisionNeeded('providers is written in flow style ({...} or [...]) in the agent config; adding a '
                             'provider there is not supported. Edit it to block style yourself, then run this '
                             'again. Nothing was changed.')
    start, end = _child_block(lines, providers_index)
    indent = _first_child_indent(lines, start, end, step)
    while end > start and not lines[end - 1].strip():
        end -= 1
    lines[end:end] = _provider_lines(entry, model_id, indent, step)
    return lines


def _expected_provider(config, entry, model_id, restore):
    """The dict a correct switch must reparse to: config with model.provider, model.default, that provider's
    block and the Plow only model.base_url/model.key_env pair changed, and nothing else.

    restore is None for a provider other than Plow, and the pair is then removed, which is what the image's
    own boot script does so that no call can fall back to Plow. Switching back to Plow passes the pair its
    config actually carried, read from a backup.
    """
    name = entry['name']
    config = copy.deepcopy(config)
    model = config['model']
    model['provider'] = name
    model['default'] = model_id
    if restore is None:
        model.pop('base_url', None)
        model.pop('key_env', None)
    else:
        model['base_url'] = restore['base_url']
        model['key_env'] = restore['key_env']
    if 'providers' in config and config['providers'] is None:
        raise DecisionNeeded('providers is empty in the agent config; give it a provider with a models: '
                             'mapping yourself, or remove the providers: line so it can be created fresh, '
                             'then run this again. Nothing was changed.')
    providers = config.setdefault('providers', {})
    block = providers.get(name)
    if name in providers and not isinstance(block, dict):
        raise DecisionNeeded(f'providers.{name} in the agent config is not a block of settings. Remove that line '
                             'so this command can write the provider itself, or fix it yourself, then run this '
                             'again. Nothing was changed.')
    if block is None:
        if 'base_url' not in entry:
            raise DecisionNeeded(f'The agent config has no providers.{name} block, and this command does not carry '
                                 f'{name} settings of its own to write one. Start the agent again with '
                                 f'{relay_command()} agent, which writes that block at boot, then run this again. '
                                 'Nothing was changed.')
        providers[name] = {'name': name, 'base_url': entry['base_url'], 'key_env': entry['key_env'],
                           'models': {model_id: {}}}
        return config
    if restore is None:
        missing = [key for key in ('base_url', 'key_env') if not block.get(key)]
        if missing:
            raise DecisionNeeded(f'providers.{name} in the agent config has no ' + ' and no '.join(missing) +
                                 f', so the agent would not know where to send its calls. Give it those, or remove '
                                 f'the providers.{name} block so this command writes it, then run this again. '
                                 'Nothing was changed.')
    models = block.get('models')
    if models is None:
        block['models'] = {model_id: {}}
    elif isinstance(models, dict):
        models.setdefault(model_id, {})
    elif isinstance(models, list):
        if model_id not in models:
            models.append(model_id)
    else:
        raise DecisionNeeded(f"The agent config's providers.{name}.models is neither a mapping nor a list. "
                             'Nothing was changed.')
    return config


def set_provider(text, entry, model_id, restore=None):
    """Config text switched to one provider: model.provider and model.default, that provider's own block,
    and the model.base_url and model.key_env pair that only Plow uses.

    A minimal text edit for the same reason set_default_model is one: everything the owner wrote elsewhere
    survives untouched. The result is re-parsed and compared against the original parse with only the
    intended changes applied; anything else differing refuses, writing nothing.
    """
    yaml = yaml_module()
    original = load_model_config(text)
    expected = _expected_provider(original, entry, model_id, restore)

    lines = text.splitlines(keepends=True)
    lines = _set_default_line(lines, _scalar(model_id))
    lines = _set_child_line(lines, 'model', 'provider', _scalar(entry['name']))
    if restore is None:
        lines = _remove_child_line(lines, 'model', 'base_url')
        lines = _remove_child_line(lines, 'model', 'key_env')
    else:
        lines = _set_child_line(lines, 'model', 'base_url', _scalar(restore['base_url']))
        lines = _set_child_line(lines, 'model', 'key_env', _scalar(restore['key_env']))
    lines = _ensure_provider_block(lines, entry, model_id, original)
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
        raise DecisionNeeded(f'The agent container is not running. Start it with {relay_command()} agent, then run this again.')


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
                         f'agent` in agent/, then run {relay_command()} agent model again, or restore with '
                         f'{relay_command()} agent model --revert.')
    if compose('exec', '-T', 'agent', '/command/s6-svc', '-r', GATEWAY_SERVICE, capture=True).returncode:
        raise AgentError(f'The gateway could not be restarted. The previous config is backed up at {backup}; '
                         f'restore it with {relay_command()} agent model --revert.')
    # A fresh time.sleep lookup, not wait_for_restart's own default: its default is bound once at import
    # time, so a test patching time.sleep around a call that relies on it would still sleep for real.
    state = wait_for_restart(previous, gateway_pid, sleep=time.sleep)
    if state == 'confirmed':
        return
    if state == 'churning':
        raise AgentError('The gateway keeps restarting instead of settling on the new model. The previous '
                         f'config is backed up at {backup}; restore it with {relay_command()} agent model --revert.')
    raise AgentError(f'The gateway did not come back up within {GATEWAY_TIMEOUT} seconds after the restart. '
                     f'Check `docker compose logs agent` in agent/. The previous config is backed up at '
                     f'{backup}; restore it with {relay_command()} agent model --revert.')


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
        raise DecisionNeeded(f'No config backup exists to revert to. {relay_command()} agent model <id> makes one before '
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


def container_key_path(name):
    """Where the image keeps one variable for the services that read it with with-contenv."""
    if not ENV_NAME.fullmatch(name or ''):
        raise AgentError(f'"{name}" is not a name an environment variable can have. Nothing was changed.')
    return f'{CONTAINER_ENVIRONMENT}/{name}'


def write_container_key(name, value):
    """Put one provider key into the running container's own environment, so the gateway can use it as soon
    as it restarts, without the container having to be built again.

    The value goes in on standard input, never as an argument, so it is in no process list, and the file is
    created under umask 077 and then verified by byte count the way the config is: a truncated stream must
    not pass as a key. This runs as the container's own user rather than as hermes, like the gateway
    restart beside it, because that directory belongs to the image.
    """
    path = container_key_path(name)
    written = compose('exec', '-T', '-e', 'PATH=' + CONTAINER_PATH, 'agent', 'sh', '-c',
                      f'umask 077; cat > {path} && chmod 600 {path}', capture=True, input=value)
    size = compose('exec', '-T', '-e', 'PATH=' + CONTAINER_PATH, 'agent', 'wc', '-c', path, capture=True)
    actual = size.stdout.split()[0] if size.returncode == 0 and size.stdout.split() else None
    if written.returncode or actual != str(len(value.encode('utf-8'))):
        compose('exec', '-T', '-e', 'PATH=' + CONTAINER_PATH, 'agent', 'rm', '-f', path, capture=True)
        raise AgentError(f'{name} could not be written into the running agent, so nothing was switched and the '
                         'config was left as it is. Check `docker compose logs agent` in agent/.')


def container_key_present(name):
    """Whether the running container has a value for one variable, asked of the container itself.

    Never the value: the shell it runs prints the word set, or nothing at all. None means the container
    could not be asked, which is not the same as a key that is not there.
    """
    if not ENV_NAME.fullmatch(name or ''):
        return None
    result = compose('exec', '-T', '-e', 'PATH=' + CONTAINER_PATH, 'agent', 'with-contenv', 'sh', '-c',
                     f'printf %s "${{{name}:+set}}"', capture=True)
    return None if result.returncode else result.stdout.strip() == 'set'


def key_state(name):
    """One line about a provider key in the running container, with nothing of the key itself in it."""
    if not name:
        return 'this provider names no key variable'
    present = container_key_present(name)
    if present is None:
        return f'{name} could not be read in the container'
    return f'{name} is set in the container' if present else f'{name} is not set in the container'


def plow_restore():
    """What Plow needs in the model block, taken from the newest config backup that actually ran on Plow.

    The image's own boot script removes model.base_url and model.key_env while another provider is
    selected, and puts them back from its seed at the next boot. A switch back here restarts the gateway
    rather than the container, so it restores them itself, from values this agent's config carried rather
    than from values made up here.
    """
    for backup in reversed(list_backups()):
        with contextlib.suppress(AgentError):
            model = load_model_config(read_config(backup))['model']
            if model.get('provider') == DEFAULT_PROVIDER and model.get('base_url') and model.get('key_env'):
                return {'base_url': model['base_url'], 'key_env': model['key_env'],
                        'default': model['default'], 'backup': backup}
    raise DecisionNeeded('No config backup beside the agent config still shows what Plow needs, so switching back '
                         'would have to invent it. Put HERMES_PROVIDER=plow in agent/.env and start the agent '
                         f'again with {relay_command()} agent, which restores those settings at boot. Nothing was '
                         'changed.')


def show_provider():
    """Print the provider the agent is configured to call, its model, whether the container holds that
    provider's key, and every provider the config knows about.

    All of it is read back from the running container, never from what this command last wrote, and no key
    is ever printed.
    """
    require_agent_running()
    summary = provider_summary(read_config())
    print(status_line('Provider', summary['provider']), flush=True)
    print(status_line('Model', summary['default']), flush=True)
    print(status_line('Key', key_state(summary['key_env'])), flush=True)
    print(status_line('Known', ', '.join(summary['known']) or '(none)'), flush=True)
    print(f'To hear the agent itself, run {relay_command()} agent test "hello".', flush=True)
    return 0


def switch_provider(name, model_id, opener=None):
    """Switch the running agent to another model provider, and report what the agent itself then said.

    The order is what makes this safe to run again after it stops. The key reaches the container before
    anything is edited, so a key that cannot be written leaves the config alone. The config is backed up
    before it is replaced, the way a model switch backs it up, and every failure from here on names that
    backup. agent/.env, which is what the container reads when it is built again, is written last, only
    after the restarted agent has actually answered, so the durable choice never records a switch that was
    not observed working.
    """
    entry = provider_entry(name)
    require_agent_running()
    # Asked for the provider it is already on, nothing has to be restored, so do not go looking
    # for a backup first and refuse over one that was never needed.
    settled = provider_summary(read_config())
    if settled['provider'] == entry['name'] and model_id in (None, settled['default']):
        # The running agent is already there. That is not the whole job: agent/.env is what
        # Compose reads when the container is built again, so a container switched by hand, or
        # by a run that stopped before its last step, is on this provider only until something
        # recreates it. Record it, then say which of the two was already true.
        durable = read_env_file() if Path(ENV_FILE).is_file() else {}
        recorded = durable.get(PROVIDER_VARIABLE) == entry['name'] and \
            durable.get(MODEL_VARIABLE) == settled['default']
        print(status_line('Provider', f'{entry["name"]} already'), flush=True)
        print(status_line('Model', settled['default']), flush=True)
        print(status_line('Key', key_state(settled['key_env'])), flush=True)
        if recorded:
            print('Nothing was changed.', flush=True)
            return 0
        write_env_values({PROVIDER_VARIABLE: entry['name'], MODEL_VARIABLE: settled['default']})
        print(status_line('Recorded', ENV_LABEL), flush=True)
        print(f'The running agent was already on {entry["name"]} and {ENV_LABEL} did not say so, which '
              'would have sent it back to the default the next time the container was built. It does now.',
              flush=True)
        return 0
    restore = plow_restore() if entry['name'] == DEFAULT_PROVIDER else None
    key = None
    if 'key_env' in entry:
        key = provider_key(entry)
        model_id = choose_model(entry, key, model_id, opener=opener)
    elif model_id:
        raise DecisionNeeded(f'This command cannot ask {entry["name"]} which models the account has, so it does not '
                             f'choose one for it. Switch back first, then run {relay_command()} agent model '
                             f'{model_id}. Nothing was changed.')
    else:
        model_id = restore['default']
    text = read_config()
    before = provider_summary(text)
    if before['provider'] == entry['name'] and before['default'] == model_id:
        print(status_line('Provider', f'{entry["name"]} already'), flush=True)
        print(status_line('Model', model_id), flush=True)
        print(status_line('Key', key_state(before['key_env'])), flush=True)
        print('Nothing was changed.', flush=True)
        return 0
    new_text = set_provider(text, entry, model_id, restore)
    if key is not None:
        write_container_key(entry['key_env'], key)
    backup = backup_config()
    write_config(new_text)
    restart_and_wait(backup)
    reply = ''
    with contextlib.suppress(Exception):
        reply = speak(MODEL_CHECK_PROMPT)
    if not reply.strip():
        raise AgentError(f'The config now names {entry["name"]} and the gateway restarted, but the agent did not '
                         f'answer when it was asked, so nothing here says it is working. The previous config is '
                         f'backed up at {backup}; restore it with {relay_command()} agent model --revert. '
                         f'{ENV_LABEL} was left alone, so the container comes back on {before["provider"]} when it '
                         'is built again.')
    write_env_values({PROVIDER_VARIABLE: entry['name'], MODEL_VARIABLE: model_id})
    print(status_line('Provider', f'{before["provider"]} -> {entry["name"]}'), flush=True)
    print(status_line('Model', f'{before["default"]} -> {model_id}'), flush=True)
    print(reply, flush=True)
    print(f'The previous config is backed up at {backup}; {relay_command()} agent model --revert restores it.',
          flush=True)
    return 0


def provider_command(args):
    """./relay agent provider: show the provider the agent runs on, or switch it to another one."""
    if getattr(args, 'name', None) is None:
        return show_provider()
    return switch_provider(args.name, getattr(args, 'model', None))


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
    # newline='' everywhere this writes: Windows text mode would turn the \n into \r\n, and
    # a digest file written there would then differ from the same digest written anywhere else.
    with os.fdopen(os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w',
                   encoding='utf-8', newline='') as output:
        output.write(digest + '\n')
    protect_or_stop(marker)
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
            print('Sign-in ........... removed from this computer; it replaced an earlier sign-in, so run '
                  'plow-agents login again if you still need one', flush=True)
        else:
            print('Sign-in ........... removed from this computer; the agent keeps its own credential', flush=True)
    elif path.exists() and (recorded or minted):
        # A sign-in someone made after this installer's, or one this run minted with but did not create.
        print('Sign-in ........... kept; revoke the plow-agents session in Plow Latch if you no longer need it', flush=True)
    for note in (marker, flag):  # every outcome retires the notes; a stale marker never decides anything
        with contextlib.suppress(OSError):
            note.unlink(missing_ok=True)


def announce_line(line):
    print(f'Line .............. {line.get("display_name") or line["uid"]} {line.get("provider_key") or ""}', flush=True)


def credential_for_new_line(args, path=None, command=None, marker=None):
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
        raise AgentError(f'The first download is still running or stalled. Run {relay_command()} agent again to continue; '
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
    print(f'Next: {relay_command()} agent status, {relay_command()} agent test "prompt", {relay_command()} agent stop', flush=True)
    return 0


def plow_tokens():
    """The account sign-in and agent credential tokens on this computer, read only to keep them out of the log."""
    tokens = []
    with contextlib.suppress(OSError, UnicodeError):
        tokens.append(signin_path().read_text().strip())
    with contextlib.suppress(OSError, UnicodeError):
        tokens += [text.partition('=')[2].strip() for text in CREDENTIAL.read_text().splitlines()
                   if text.startswith('PLOW_AGENT_TOKEN=')]
    return [token for token in tokens if token]


def provider_keys():
    """Every provider key agent/.env holds, read only to keep it out of the log."""
    names = {entry['key_env'] for entry in PROVIDERS.values() if 'key_env' in entry}
    with contextlib.suppress(Exception):
        return [value for name, value in read_env_file().items() if name in names and value]
    return []


def record_failure(error, path):
    """Append the full traceback to the install log under a UTC timestamp, with any Plow token removed.

    A traceback holds code and exception text only: no environment, locals or file contents.
    It is made private while the file is still empty, and a log this call created is removed
    when that cannot be done, so the run never reports that the details could not be saved
    while a file holding them is sitting on disk for anyone who can read the folder.
    """
    text = ''.join(traceback.format_exception(type(error), error, error.__traceback__))
    for token in plow_tokens() + provider_keys():
        text = text.replace(token, '[token removed]')
    path.parent.mkdir(parents=True, exist_ok=True)
    created = not path.exists()
    try:
        with os.fdopen(os.open(path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600), 'a',
                       encoding='utf-8', newline='') as log:
            private_files.protect(path)
            log.write(f'=== {datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ} ===\n{text}\n')
    except BaseException:
        if created:
            with contextlib.suppress(OSError):
                path.unlink()
        raise


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
        if action == 'provider':
            return provider_command(args)
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
        except (OSError, private_files.PrivacyError):
            where = ' and the details could not be saved.'
        what, again = ('The install', f'{relay_command()} agent') if action is None else (f'{relay_command()} agent {action}', 'it')
        print(f'{what} stopped unexpectedly{where} Running {again} again is safe.', file=sys.stderr, flush=True)
        return 1
