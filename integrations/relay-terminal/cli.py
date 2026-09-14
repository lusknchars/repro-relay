"""Local terminal controls for Relay's canonical investigation and repair APIs."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

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


def main(argv=None):
    parser = argparse.ArgumentParser(prog='relay', description='Relay investigations and approved repairs from your terminal.')
    parser.add_argument('--api', default='http://127.0.0.1:8178/api/v1')
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('doctor', help='Check the API and investigator connection without starting work')
    sub.add_parser('cases', help='List saved cases')
    case = sub.add_parser('case', help='Inspect case, runs, evidence and repair plans'); case.add_argument('case', type=identifier)
    plan = sub.add_parser('plan', help='Freeze a plan from an accepted symptom and reusable repository setup')
    plan.add_argument('case', type=identifier); plan.add_argument('--finding', required=True, type=identifier); plan.add_argument('--spec', required=True)
    worktree = sub.add_parser('worktree', help='Prepare a separate checkout for an approved plan')
    worktree.add_argument('plan', type=identifier); worktree.add_argument('--repo', required=True)
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
    if hasattr(args, 'seconds') and not 1 <= args.seconds <= 3600:
        parser.error('--seconds must be between 1 and 3600')
    api = API(args.api)
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
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=True), file=sys.stderr)
        sys.exit(1)
