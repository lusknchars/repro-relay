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
import ssl
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


def preflight(run=None):
    """Return the missing prerequisites, each with the action that fixes it."""
    run = run or (lambda command: subprocess.run(command, capture_output=True, timeout=20).returncode)
    if not shutil.which('docker'):
        return ['Install Docker Desktop and open it, then run this again.']
    for command in (['docker', 'compose', 'version'], ['docker', 'info']):
        if run(command):
            return ['Start Docker Desktop and wait until it reports running, then run this again.']
    return []


def refuse_other_agent(run=None, folder=None, environ=None):
    """Stop when this Compose project already runs an agent from another folder. Only reads Docker's state."""
    run = run or (lambda command: subprocess.run(command, capture_output=True, text=True, timeout=20))
    name = (os.environ if environ is None else environ).get('COMPOSE_PROJECT_NAME') or 'agent'
    result = run(['docker', 'ps', '--filter', f'label=com.docker.compose.project={name}',
                  '--format', '{{.Label "com.docker.compose.project.working_dir"}}'])
    if result.returncode:
        raise AgentError('Docker did not list its running containers, so the install stopped before changing anything. '
                         'Run ./relay agent again.')
    for other in filter(None, (text.strip() for text in result.stdout.splitlines())):
        if not same_folder(other, folder or AGENT):
            raise AgentError(f"An agent from {other} already runs under the Docker project '{name}'. "
                             'Stop it there, or set COMPOSE_PROJECT_NAME to install alongside it.')


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
    except AgentError as error:
        found, reason = None, f' {error}'
    line = found.get('line') if isinstance(found, dict) else None
    if not isinstance(line, dict) or not line.get('uid'):
        raise AgentError(f'The existing credential {path} could not be verified with Plow.{reason} It was left untouched. '
                         'Check the connection and run ./relay agent again; if that agent was retired, '
                         'remove the file yourself first.')
    return line


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
def installation_lock(path):
    """One install at a time. The lock clears on failure and interruption."""
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise AgentError(f'An install is already running. If it was interrupted, delete {path} and retry.') from None
    try:
        os.close(descriptor)
        yield
    finally:
        Path(path).unlink(missing_ok=True)


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
    """Who a credential answers as, according to Plow. When Plow cannot say, an AgentError says why."""
    sys.path.insert(0, str(ROOT / 'integrations/plow'))
    import bridge
    try:
        return bridge.JsonHTTP(ORIGIN, bridge.private_credentials(path)).call('GET', '/v1/agents/cloud/me')[1]
    except bridge.BridgeError as error:
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


def settle_signin(path, existed):
    """After a successful install: remove a sign-in this run created, keep one the owner already had."""
    if existed:
        print('Sign-in ........... kept; revoke the plow-agents session in Plow Latch if you no longer need it', flush=True)
    elif path.exists():
        path.unlink()
        print('Sign-in ........... removed from this Mac; the agent keeps its own credential', flush=True)


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
    refuse_other_agent()  # before signing in, minting or starting anything
    signin = signin_path()
    signed_in_before = signin.exists()
    resuming = CREDENTIAL.exists()
    if resuming:
        # A rerun after minting continues with that agent's own line; no sign-in or line choice.
        line = existing_line(CREDENTIAL, identity)
        announce_line(line)
        print('Credential ........ reused', flush=True)
    else:
        line = credential_for_new_line(args)
    print('Starting the agent (the first start downloads several GB) ...', flush=True)
    try:
        started = compose('up', '-d', '--build')
    except subprocess.TimeoutExpired:
        raise AgentError('The first download is still running or stalled. Run ./relay agent again to continue; '
                         'Docker keeps what it already downloaded.') from None
    if started.returncode:
        raise AgentError('Docker could not start the agent. The output above shows why.')
    state, detail = wait_ready(lambda: compose('logs', '--no-color', '--since', '15m', 'agent', capture=True).stdout)
    if state != 'ready':
        raise AgentError(detail)
    print('Agent ready ....... ' + detail.split(READY)[-1].strip(), flush=True)
    print('Testing Hermes .... ' + speak(FIRST_PROMPT), flush=True)
    if not resuming:
        settle_signin(signin, signed_in_before)
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
    with open(path, 'a', encoding='utf-8') as log:
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
        with installation_lock(state / 'install.lock'):
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
        record_failure(error, log)
        if action is None:
            print(f'The install stopped unexpectedly. Details: {log}. Running ./relay agent again is safe.',
                  file=sys.stderr, flush=True)
        else:
            print(f'./relay agent {action} stopped unexpectedly. Details: {log}. Running it again is safe.',
                  file=sys.stderr, flush=True)
        return 1
