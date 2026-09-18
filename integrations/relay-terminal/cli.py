"""Local terminal controls for Relay's canonical investigation and repair APIs."""
import argparse
import hashlib
import json
import pathlib
import re
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from execution_ledger import Ledger

TERMINAL = {'completed', 'failed', 'cancelled'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class API:
    def __init__(self, origin):
        url = urllib.parse.urlsplit(origin)
        if (url.scheme != 'http' or url.hostname not in {'127.0.0.1', '::1'}
                or url.username or url.password or url.query or url.fragment
                or url.path.rstrip('/') != '/api/v1'):
            raise ValueError('Use a literal loopback HTTP address ending in /api/v1.')
        self.origin = origin.rstrip('/')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, path, body=None, request_key=None):
        headers = {'Accept': 'application/json'}
        data = None
        if body is not None:
            data = json.dumps(body, sort_keys=True, separators=(',', ':')).encode()
            headers['Content-Type'] = 'application/json'
            # Retrying the same concrete intent must not start another operation.
            headers['Idempotency-Key'] = request_key or 'terminal:' + hashlib.sha256(path.encode() + b'\0' + data).hexdigest()
        request = urllib.request.Request(self.origin + path, data=data, headers=headers)
        try:
            with self.opener.open(request, timeout=15) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError('Relay response exceeded 4 MiB.')
            return json.loads(raw)
        except urllib.error.HTTPError as error:
            raw = error.read(4096)
            try:
                detail = json.loads(raw).get('error', 'Request rejected')
            except (ValueError, AttributeError):
                detail = 'Request rejected'
            raise ValueError(f'Relay HTTP {error.code}: {detail}') from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ValueError('Relay is unreachable or did not confirm the request. Start make dev. For a write, inspect saved work before retrying the same command.') from error

    def pages(self, path):
        items = []
        after = 0
        for _ in range(10):
            page = self.call(f'{path}?after={after}&limit=100')
            items.extend(page['items'])
            cursor = page.get('next_cursor')
            if cursor is None:
                return items
            if not isinstance(cursor, int) or cursor <= after:
                raise ValueError('Relay returned an invalid pagination cursor.')
            after = cursor
        raise ValueError('More than 1,000 records. Use the application to inspect this history.')


def identifier(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,99}', value):
        raise argparse.ArgumentTypeError('Use a Relay record ID, without slashes or query parameters.')
    return value


def emit(value):
    # JSON escapes terminal control characters from reports and agent output.
    print(json.dumps(value, ensure_ascii=True, indent=2))


def git(repo, *args):
    result = subprocess.run(['git', '-C', str(repo), *args], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise ValueError('Git operation failed: ' + result.stderr.strip())
    return result.stdout.strip()


def repository(path):
    repo = pathlib.Path(path).expanduser().resolve(strict=True)
    if pathlib.Path(git(repo, 'rev-parse', '--show-toplevel')).resolve() != repo:
        raise ValueError('Supply the repository root, not a subdirectory.')
    return repo


def prepare_worktree(plan, source):
    if plan['status'] not in {'approved', 'repair_dispatched'}:
        raise ValueError('Approve the exact repair plan before preparing its checkout.')
    repo = repository(source)
    if str(repo) != plan['input']['repository']:
        raise ValueError('This repository does not match the approved plan identity.')
    base = plan['input']['base_commit']
    if not re.fullmatch(r'[a-fA-F0-9]{40}|[a-fA-F0-9]{64}', base):
        raise ValueError('The plan does not name an exact base commit.')
    base = git(repo, 'rev-parse', '--verify', base + '^{commit}')
    plan_id = identifier(plan['id'])
    namespace = hashlib.sha256(str(repo).encode()).hexdigest()[:16]
    parent = repo.parent / '.relay-worktrees' / namespace
    # Do not follow an existing symlink into another checkout or directory.
    for path in [parent.parent, parent, parent / plan_id]:
        if path.is_symlink():
            raise ValueError('Worktree destinations must not be symlinks.')
    destination = parent / plan_id
    if destination.exists():
        top = git(destination, 'rev-parse', '--show-toplevel')
        common = pathlib.Path(git(destination, 'rev-parse', '--path-format=absolute', '--git-common-dir')).resolve()
        source_common = pathlib.Path(git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')).resolve()
        if (pathlib.Path(top).resolve() != destination.resolve() or common != source_common
                or git(destination, 'rev-parse', 'HEAD') != base
                or git(destination, 'status', '--porcelain')):
            raise ValueError('The existing checkout has changed or belongs to another repository. Inspect it; Relay will not overwrite it.')
    else:
        parent.mkdir(parents=True, exist_ok=True)
        git(repo, 'worktree', 'add', '--detach', str(destination), base)
    return {'plan_id': plan_id, 'path': str(destination), 'base_commit': base,
            'prepared_only': True, 'agent_started': False,
            'boundary': 'Separate Git checkout, not a process sandbox. The repair runtime must explicitly use this path and enforce its own permissions.'}


def inspect_case(api, case_id):
    case = api.call('/cases/' + case_id)
    branches = []
    for run in api.call(f'/cases/{case_id}/runs'):
        findings = api.pages(f'/runs/{run["id"]}/findings')
        branches.append({'run_id': run['id'], 'status': run['status'],
                         'execution_kind': run.get('execution_kind', 'hermes'),
                         'usage': run.get('usage'), 'findings': findings})
    return {'case': case, 'investigations': branches,
            'repairs': api.call(f'/cases/{case_id}/repairs'),
            'interpretation': 'Case -> investigation -> recorded finding. This groups evidence; it does not infer causal links or mark a fix verified.',
            'view_path': '/?view=agents&case=' + case_id}


def repair_ledger(plan, source):
    if plan['status'] not in {'approved', 'repair_dispatched', 'candidate_recorded', 'verification_dispatched', 'checks_reported_passed', 'checks_reported_failed'}:
        raise ValueError('Ledger access requires an approved, non-revoked repair contract.')
    repo = repository(source)
    if str(repo) != plan['input']['repository']:
        raise ValueError('This repository does not match the repair contract.')
    base = plan['input']['base_commit']
    if not re.fullmatch(r'[a-fA-F0-9]{40}|[a-fA-F0-9]{64}', base):
        raise ValueError('The repair must name an exact base commit.')
    namespace = hashlib.sha256(str(repo).encode()).hexdigest()[:16]
    parent = repo.parent / '.relay-worktrees' / namespace
    destination = parent / identifier(plan['id'])
    if any(path.is_symlink() for path in (parent.parent, parent, destination)):
        raise ValueError('Worktree destinations must not be symlinks.')
    if not destination.is_dir():
        raise ValueError('Prepare this approved checkout with relay worktree first.')
    common = git(destination, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    source_common = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
    if (repository(destination) != destination or pathlib.Path(common).resolve() != pathlib.Path(source_common).resolve()
            or git(destination, 'merge-base', base, 'HEAD').lower() != base.lower()):
        raise ValueError('Checkout does not belong to this repository and repair base.')
    # Dirty files and candidate commits are expected. Never reset or recreate the checkout.
    anchor = {key: plan[key] for key in ('id', 'case_id', 'owner_version', 'build', 'input', 'acceptance_hash')}
    return Ledger(destination, parent / '.ledger' / (plan['id'] + '.sqlite3'), anchor)


def make_plan(api, case_id, finding_id, spec_path):
    raw = pathlib.Path(spec_path).read_bytes()
    if len(raw) > 65536:
        raise ValueError('Repair setup exceeds 64 KiB.')
    spec = json.loads(raw)
    required = {'repository', 'allowed_paths', 'acceptance_command', 'regression_command', 'environment', 'requested_by'}
    if not isinstance(spec, dict) or set(spec) != required:
        raise ValueError('Setup must contain repository, allowed_paths, acceptance_command, regression_command, environment, and requested_by.')
    repo = repository(spec['repository'])
    if git(repo, 'status', '--porcelain'):
        raise ValueError('Commit or set aside working changes before freezing a repair base. Relay will not stash them.')
    case = api.call('/cases/' + case_id)
    spec.update(repository=str(repo), base_commit=git(repo, 'rev-parse', 'HEAD'),
                revision=case['revision'], finding_id=finding_id)
    return api.call(f'/cases/{case_id}/repairs', spec)


def dispatch_next(api, plan_id, seconds, expected_version):
    plan = api.call('/repairs/' + plan_id)
    if plan['version'] != expected_version:
        raise ValueError('The repair plan changed. Inspect its new version before starting it.')
    state = plan['status']
    if state in {'approved', 'repair_dispatched'}:
        stage = 'repair'
    elif state in {'candidate_recorded', 'verification_dispatched'}:
        stage = 'verification'
    else:
        raise ValueError(f'Repair is {state}. Inspect the plan; approval and stage evidence cannot be skipped.')
    return api.call(f'/repairs/{plan_id}/dispatch/{stage}', {'version': expected_version, 'max_seconds': seconds})


def watch(api, case_id, run_id, seconds):
    deadline = time.monotonic() + seconds
    previous = None
    while time.monotonic() < deadline:
        run = next((r for r in api.call(f'/cases/{case_id}/runs') if r['id'] == run_id), None)
        if run is None:
            raise ValueError('Run is not present in this case history. Inspect the case before continuing.')
        changed = json.dumps(run, sort_keys=True)
        if changed != previous:
            emit(run)
            previous = changed
        if run['status'] in TERMINAL:
            return 0 if run['status'] == 'completed' else 1
        time.sleep(2)
    emit({'watch_ended': True, 'run_id': run_id, 'agent_stopped': False,
          'next': 'Watching timed out. The durable run continues; use relay watch or relay stop.'})
    return 2


def selected_memory(api, override):
    if override is not None:
        return override
    profile = api.call('/tool-profile')
    if not isinstance(profile, dict) or type(profile.get('mem0')) is not bool:
        raise ValueError('Could not read the saved Tools library selection. Refresh Connections or use --memory off explicitly.')
    return 'mem0' if profile['mem0'] else 'off'


def main(argv=None):
    parser = argparse.ArgumentParser(prog='relay', description='Relay investigations and approved repairs from your terminal.')
    parser.add_argument('--api', default='http://127.0.0.1:8178/api/v1')
    sub = parser.add_subparsers(dest='action', required=True)
    reach = sub.add_parser('reach', help='Daily team coordination, MCP and call context')
    reach.add_argument('reach_args', nargs=argparse.REMAINDER)
    agent = sub.add_parser('agent', help='Install and run the Plow chat agent on your own line')
    agent.add_argument('--new-line', action='store_true', help='Ask Plow to provision a new assistant line during sign-in')
    agent.add_argument('--line', metavar='VALUE', help='Use this free line without asking: its position in the list, its number or its uid')
    agent_actions = agent.add_subparsers(dest='agent_action')
    agent_actions.add_parser('status', help='Agent, line, Plow setup and reported usage')
    agent_test = agent_actions.add_parser('test', help='Send one prompt to the running agent')
    agent_test.add_argument('prompt')
    agent_actions.add_parser('stop', help='Stop the agent, keeping its memory and identity')
    agent_model = agent_actions.add_parser('model', help='See or change the model the agent runs on')
    agent_model.add_argument('id', nargs='?', help='A provider/model id to switch to; omit to show the current model')
    agent_model.add_argument('--check', action='store_true',
                             help='After switching, send one prompt through the agent and print the reply (spends Plow credits)')
    agent_model.add_argument('--revert', action='store_true',
                             help='Restore the config from the newest backup and restart the gateway')
    hosted = sub.add_parser('hosted', help='Run agents on this machine for other people, one container each')
    hosted_actions = hosted.add_subparsers(dest='hosted_action', required=True)
    hosted_create = hosted_actions.add_parser('create', help='Give one person an agent on its own Plow line')
    hosted_create.add_argument('person', help='A short identifier for this person: lowercase letters, digits and dashes')
    hosted_create.add_argument('--name', help="The person's name, for your own records and the handover")
    hosted_create.add_argument('--new-line', action='store_true', help='Ask Plow to provision a new assistant line')
    hosted_create.add_argument('--line', metavar='VALUE',
                               help='Use this free line: its position in the list, its number or its uid')
    hosted_actions.add_parser('list', help='Every agent recorded here, and what Docker says about each one')
    hosted_status = hosted_actions.add_parser('status', help='One agent, and the limits Docker reports for it')
    hosted_status.add_argument('person')
    hosted_stop = hosted_actions.add_parser('stop', help='Stop one agent, keeping its line, credential and memory')
    hosted_stop.add_argument('person')
    hosted_remove = hosted_actions.add_parser('remove', help="Delete one agent's container, memory volume and folder")
    hosted_remove.add_argument('person')
    hosted_remove.add_argument('--confirm', metavar='IDENTIFIER',
                               help='Repeat the identifier to confirm; without it nothing is deleted')
    setup = sub.add_parser('setup', help='Install dependencies, start the local service and open Relay')
    setup.add_argument('--check', action='store_true', help='Check prerequisites without installing or starting anything')
    setup.add_argument('--web', action='store_true', help='Use the local web app instead of building the macOS desktop app')
    setup.add_argument('--no-open', action='store_true', help='Set up services without opening a window')
    pi = sub.add_parser('pi', help='Connect the Pi terminal harness to Relay evidence')
    pi_actions = pi.add_subparsers(dest='pi_action', required=True)
    pi_doctor = pi_actions.add_parser('doctor', help='Check Pi installation, local evidence and optional provider credentials; no model call')
    pi_start = pi_actions.add_parser('start', help='Open Pi with Relay tools and its own local session profile')
    for pi_command in (pi_doctor, pi_start):
        pi_command.add_argument('--profile', choices=('relay', 'personal'), default='relay',
                                help='Pi authentication/settings profile; personal reuses ~/.pi/agent without copying credentials')
        pi_command.add_argument('--provider', help='Optional Pi provider name; doctor checks local credential readiness without refreshing')
    pi_start.add_argument('--model', help='Optional Pi model name; use /model inside Pi')
    pi_start.add_argument('--resume', action='store_true', help='Continue the latest Relay Pi session')
    pi_start.add_argument('--memory', choices=('off', 'mem0'), default=None, help='Override the saved Tools library choice for this session')
    sub.add_parser('doctor', help='Check the API and investigator connection without starting work')
    sub.add_parser('cases', help='List saved cases')
    case = sub.add_parser('case', help='Inspect case, runs, evidence and repair plans'); case.add_argument('case', type=identifier)
    plan = sub.add_parser('plan', help='Freeze a plan from an accepted symptom and reusable repository setup')
    plan.add_argument('case', type=identifier); plan.add_argument('--finding', required=True, type=identifier); plan.add_argument('--spec', required=True)
    worktree = sub.add_parser('worktree', help='Prepare a separate checkout for an approved plan')
    worktree.add_argument('plan', type=identifier); worktree.add_argument('--repo', required=True)
    ledger = sub.add_parser('ledger', help='Inspect and record local repair execution state without model calls')
    ledger_actions = ledger.add_subparsers(dest='ledger_action', required=True)
    for action in ('state', 'read', 'command', 'outcome', 'history'):
        action_parser = ledger_actions.add_parser(action)
        action_parser.add_argument('plan', type=identifier)
        action_parser.add_argument('--repo', required=True)
        if action == 'read':
            action_parser.add_argument('path')
            action_parser.add_argument('--start', type=int, default=1)
            action_parser.add_argument('--end', type=int, default=200)
            action_parser.add_argument('--visible-receipt', action='append', default=[], type=identifier)
        elif action == 'command':
            action_parser.add_argument('--category', choices=('test', 'search', 'modify', 'unknown'), default='unknown')
            action_parser.add_argument('argv', nargs='+')
        elif action == 'outcome':
            action_parser.add_argument('--proposal', required=True, type=identifier)
            action_parser.add_argument('--exit-code', required=True, type=int)
            action_parser.add_argument('--output-file', required=True)
        elif action == 'history':
            action_parser.add_argument('--after', type=int, default=0)
            action_parser.add_argument('--limit', type=int, default=50)
    approve = sub.add_parser('approve', help='Approve the exact reviewed plan version')
    approve.add_argument('plan', type=identifier); approve.add_argument('--version', required=True, type=int); approve.add_argument('--actor', required=True)
    repair = sub.add_parser('repair', help='Dispatch the next approved repair or verification stage')
    repair.add_argument('plan', type=identifier); repair.add_argument('--version', required=True, type=int); repair.add_argument('--seconds', type=int, default=120); repair.add_argument('--watch', action='store_true')
    inspect = sub.add_parser('inspect-plan', help='Read a repair contract and its current version'); inspect.add_argument('plan', type=identifier)
    investigate = sub.add_parser('investigate', help='Start a real configured Hermes investigation')
    investigate.add_argument('case', type=identifier); investigate.add_argument('--seconds', type=int, default=120); investigate.add_argument('--watch', action='store_true'); investigate.add_argument('--request-key')
    monitor = sub.add_parser('watch', help='Follow saved run state and reported usage')
    monitor.add_argument('case', type=identifier); monitor.add_argument('run', type=identifier); monitor.add_argument('--seconds', type=int, default=600)
    stop = sub.add_parser('stop', help='Request a cooperative stop'); stop.add_argument('run', type=identifier)
    args = parser.parse_args(argv)
    if args.action == 'reach':
        return subprocess.call([sys.executable, str(pathlib.Path(__file__).resolve().parents[1] / 'reach/reach.py'), '--api', args.api, *args.reach_args])
    if args.action == 'agent':
        from plow_agent import run_agent
        return run_agent(args)
    if args.action == 'hosted':
        hosted_tool = str(pathlib.Path(__file__).resolve().parents[2] / 'hosted')
        if hosted_tool not in sys.path:
            sys.path.insert(0, hosted_tool)
        from orchestrator import run_hosted
        return run_hosted(args)
    if args.action == 'setup':
        from bootstrap import run_setup
        return run_setup(args)
    if hasattr(args, 'seconds') and not 1 <= args.seconds <= 3600:
        parser.error('--seconds must be between 1 and 3600')
    api = API(args.api)
    if args.action == 'pi':
        from pi_harness import run
        if args.pi_action == 'start':
            args.memory = selected_memory(api, args.memory)
        return run(args)
    if args.action == 'doctor':
        emit({'health': api.call('/health'), 'investigator': api.call('/runner'),
              'terminal': 'ready', 'repair': 'Checked by the server at stage admission. Requires isolated_repair/protected_verification and protected_acceptance.',
              'local_checkout': 'relay worktree prepares a checkout; it does not install a runtime.'})
    elif args.action == 'cases':
        cases = []
        for offset in range(0, 1000, 100):
            batch = api.call(f'/cases?offset={offset}')
            cases.extend({key: item.get(key) for key in ('id', 'title', 'status', 'build', 'revision')} for item in batch)
            if len(batch) < 100:
                break
        emit({'cases': cases, 'limit': 1000, 'possibly_more': len(cases) == 1000})
    elif args.action == 'case':
        emit(inspect_case(api, args.case))
    elif args.action == 'plan':
        emit(make_plan(api, args.case, args.finding, args.spec))
    elif args.action == 'inspect-plan':
        emit(api.call('/repairs/' + args.plan))
    elif args.action == 'worktree':
        emit(prepare_worktree(api.call('/repairs/' + args.plan), args.repo))
    elif args.action == 'ledger':
        state = repair_ledger(api.call('/repairs/' + args.plan), args.repo)
        if args.ledger_action == 'state':
            emit(state.inform())
        elif args.ledger_action == 'read':
            emit(state.read(args.path, args.start, args.end, args.visible_receipt))
        elif args.ledger_action == 'command':
            emit(state.govern_command(args.argv, args.category))
        elif args.ledger_action == 'history':
            emit(state.history(args.after, args.limit))
        else:
            with open(args.output_file, 'rb') as output:
                raw = output.read(65537)
            if len(raw) > 65536:
                raise ValueError('Command output exceeds 64 KiB; preserve the full output elsewhere.')
            emit(state.outcome(args.proposal, args.exit_code, raw.decode('utf8')))
    elif args.action == 'approve':
        emit(api.call('/repairs/' + args.plan + '/commands', {'action': 'approve', 'version': args.version, 'actor': args.actor}))
    elif args.action == 'stop':
        emit(api.call('/runs/' + args.run + '/stop', {}))
    elif args.action == 'watch':
        return watch(api, args.case, args.run, args.seconds)
    else:
        if args.action == 'investigate':
            preview = api.call(f'/cases/{args.case}/investigation-preview')
            result = api.call(f'/cases/{args.case}/runs', {'revision': preview['case_revision'], 'context_hash': preview['context_hash'], 'max_seconds': args.seconds}, args.request_key)
        else:
            result = dispatch_next(api, args.plan, args.seconds, args.version)
        emit(result)
        if args.watch:
            return watch(api, result['case_id'], result['id'], args.seconds + 30)
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        emit({'watch_ended': True, 'agent_stopped': False, 'next': 'Use relay stop RUN-ID to request an agent stop.'})
        sys.exit(130)
    except (ValueError, OSError, sqlite3.Error, subprocess.SubprocessError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=True), file=sys.stderr)
        sys.exit(1)
