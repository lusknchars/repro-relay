"""Unit tests for the hosted agent operator tool. No Plow, Docker or model calls.

Docker is a fake that keeps its state as data and answers every listing from the filters
and the format template it is actually given, so a command asking for the wrong thing gets
the wrong answer here too. Plow is faked at the same seam the installer's own tests use.
"""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HOSTED = Path(__file__).resolve().parent
sys.path[:0] = [str(HOSTED), str(HOSTED.parent / 'integrations/relay-terminal')]
import cli
import orchestrator
import plow_agent
import registry


def setUpModule():
    """No test in this module may start a process. Docker is the fake below, and there is no other."""
    global NO_PROCESSES
    NO_PROCESSES = patch.object(subprocess, 'run', side_effect=AssertionError('a test tried to run a process'))
    NO_PROCESSES.start()


def tearDownModule():
    NO_PROCESSES.stop()


def block(said, project):
    """The one listed block naming this project, so an assertion cannot be satisfied by another person's."""
    found = [part for part in said.split('\n\n') if project in part]
    assert len(found) == 1, f'{project} appears in {len(found)} blocks'
    return found[0]


def line(uid, agent=None, number='+15550000000', name='Alder'):
    return {'uid': uid, 'agent_uid': agent, 'provider_key': number, 'display_name': name}


def installed_agent(folder='/repo/agent', state='running'):
    """The agent installed on this machine, under the Compose project the installer resolves for agent/."""
    return {'ID': 'aaaaaaaaaaaa', 'Names': 'agent-agent-1', 'State': state,
            'com.docker.compose.project': 'agent', 'com.docker.compose.service': 'agent',
            'com.docker.compose.project.working_dir': folder}


FIELD = re.compile(r'\{\{\s*(?:\.Label\s+"([^"]+)"|\.([\w.]+))\s*\}\}')
READY_LOG = 'plow-init: configured from /var/lib/plow as cht_1\n'


def render(template, record):
    """One Go template of the kind Docker's --format takes, filled from a record's own fields."""
    return FIELD.sub(lambda found: str(record.get(found.group(1) or found.group(2), '')), template)


def flags(argv):
    """The --filter values, the --format template and the positional arguments of a docker command."""
    filters, template, rest, index = [], None, [], 0
    while index < len(argv):
        if argv[index] == '--filter':
            filters.append(argv[index + 1])
            index += 2
        elif argv[index] == '--format':
            template = argv[index + 1]
            index += 2
        elif argv[index].startswith('-'):
            index += 1
        else:
            rest.append(argv[index])
            index += 1
    return filters, template, rest


def service_limits(path):
    """What a generated compose file asks Docker for, read back out of the file itself."""
    text = Path(path).read_text()
    return dict(re.findall(r'^ {4}(cpus|mem_limit|memswap_limit|pids_limit|privileged): *(\S+) *$', text, re.M))


def as_bytes(value):
    scale = {'k': 1024, 'm': 1024 ** 2, 'g': 1024 ** 3}
    return int(value[:-1]) * scale[value[-1].lower()] if value[-1].lower() in scale else int(value)


class FakeDocker:
    """Docker's state on this host, as data. Any command it does not know fails the test."""

    def __init__(self):
        self.containers = []  # one record per container, keyed by the labels and fields Docker reports
        self.volumes = []
        self.commands = []
        self.environ = {}  # COMPOSE_PROJECT_NAME in the shell, which overrides the one in a project's .env
        self.logs = READY_LOG
        self.up = 0  # the exit code `compose up` gives
        self.ignore = ()  # compose subcommands Docker accepts and then does nothing about
        self.speechless = False  # `docker compose config` cannot answer: no compose file, or a rejected one
        self.down = False  # the daemon is not running, so every docker command fails
        self.refuse_volume_removal = ()
        self.limits_override = {}  # what Docker reports, when it is not what the compose file asked for
        self.next_id = 0

    # Compose resolves a project name from the shell, then the project folder's .env, then the folder name.
    def project_of(self, cwd):
        if self.environ.get('COMPOSE_PROJECT_NAME'):
            return self.environ['COMPOSE_PROJECT_NAME']
        found = re.search(r'^COMPOSE_PROJECT_NAME=(\S+)$', (Path(cwd) / '.env').read_text(), re.M) \
            if (Path(cwd) / '.env').exists() else None
        return found.group(1) if found else Path(cwd).name

    def of_project(self, project):
        return [item for item in self.containers if item['com.docker.compose.project'] == project]

    def compose(self, *arguments, capture=False, input=None, cwd=None):
        return self.run(['docker', 'compose', *arguments], cwd=cwd)

    def run(self, command, cwd=None):
        self.commands.append((list(command), str(cwd) if cwd is not None else None))
        if self.down:
            return SimpleNamespace(returncode=1, stdout='')
        if command[:2] == ['docker', 'stop']:
            for item in self.containers:
                if item['ID'] in command[2:]:
                    item['State'] = 'exited'
            return SimpleNamespace(returncode=0, stdout='\n'.join(command[2:]) + '\n')
        if command[:2] == ['docker', 'compose']:
            return self.composed(command[2:], cwd)
        if command[:2] == ['docker', 'ps']:
            return self.listed(command[2:], self.containers)
        if command[:3] == ['docker', 'volume', 'ls']:
            return self.listed(command[3:], [{'Name': name} for name in self.volumes])
        if command[:3] == ['docker', 'volume', 'rm']:
            return self.removed_volume(command[3])
        if command[:2] == ['docker', 'inspect']:
            return self.inspected(command[2:])
        if command[:3] == ['docker', 'rm', '-f']:
            self.containers = [item for item in self.containers if item['ID'] not in command[3:]]
            return SimpleNamespace(returncode=0, stdout='\n'.join(command[3:]) + '\n')
        raise AssertionError(f'A test tried to run {command}')

    def composed(self, arguments, cwd):
        if cwd is None or not Path(cwd).is_dir():
            raise AssertionError(f'compose {arguments} ran in {cwd!r}, which is not a project folder')
        project = self.project_of(cwd)
        if arguments[:2] == ['config', '--format']:
            if self.speechless or not (Path(cwd) / 'compose.yml').is_file():
                return SimpleNamespace(returncode=1, stdout='')
            return SimpleNamespace(returncode=0, stdout=json.dumps({'name': project, 'services': {}}))
        if arguments[0] in self.ignore:
            return SimpleNamespace(returncode=0, stdout='')
        if arguments[:2] == ['up', '-d']:
            return self.started(project, cwd)
        if arguments[0] == 'logs':
            return SimpleNamespace(returncode=0, stdout=self.logs if self.of_project(project) else '')
        if arguments == ['stop']:
            for item in self.of_project(project):
                item['State'] = 'exited'
            return SimpleNamespace(returncode=0, stdout='')
        if arguments == ['down', '--remove-orphans']:
            self.containers = [item for item in self.containers if item['com.docker.compose.project'] != project]
            return SimpleNamespace(returncode=0, stdout='')
        raise AssertionError(f'A test tried to run docker compose {arguments}')

    def started(self, project, cwd):
        # The credential is bound in with create_host_path false, so Compose refuses when it is not there.
        if not (Path(cwd) / 'plow-credentials').is_file():
            return SimpleNamespace(returncode=1, stdout='')
        if self.up:
            return SimpleNamespace(returncode=self.up, stdout='')
        limits = service_limits(Path(cwd) / 'compose.yml')
        self.next_id += 1
        volume = f'{project}_agent-home'
        if volume not in self.volumes:
            self.volumes.append(volume)
        for item in self.of_project(project):
            item['State'] = 'running'
            return SimpleNamespace(returncode=0, stdout='')
        container = {
            'ID': f'{self.next_id:012x}', 'Names': f'{project}-agent-1', 'State': 'running',
            'com.docker.compose.project': project, 'com.docker.compose.service': 'agent',
            'com.docker.compose.project.working_dir': str(Path(cwd).resolve()),
            'HostConfig.NanoCpus': int(float(limits['cpus']) * 1_000_000_000) if 'cpus' in limits else 0,
            'HostConfig.Memory': as_bytes(limits['mem_limit']) if 'mem_limit' in limits else 0,
            'HostConfig.PidsLimit': int(limits['pids_limit']) if 'pids_limit' in limits else '<nil>',
            'HostConfig.Privileged': limits.get('privileged', 'false')}
        container.update(self.limits_override)
        self.containers.append(container)
        return SimpleNamespace(returncode=0, stdout='')

    def listed(self, arguments, records):
        wanted, template, _ = flags(arguments)
        rows = [record for record in records if all(self.matches(record, item) for item in wanted)]
        return SimpleNamespace(returncode=0, stdout=''.join(render(template, row) + '\n' for row in rows))

    @staticmethod
    def matches(record, wanted):
        key, _, value = wanted.partition('=')
        if key == 'label':
            label, _, expected = value.partition('=')
            return record.get(label) == expected
        if key == 'name':
            pattern = value.strip('^$')
            return record.get('Name') == pattern if value.startswith('^') and value.endswith('$') \
                else pattern in record.get('Name', '')
        raise AssertionError(f'A test filtered on {wanted}')

    def removed_volume(self, name):
        if name in self.refuse_volume_removal:
            return SimpleNamespace(returncode=1, stdout='')
        if name not in self.volumes:
            return SimpleNamespace(returncode=1, stdout='')
        self.volumes.remove(name)
        return SimpleNamespace(returncode=0, stdout=name + '\n')

    def inspected(self, arguments):
        _, template, rest = flags(arguments)
        found = [item for item in self.containers if item['ID'] in rest]
        if not found:
            return SimpleNamespace(returncode=1, stdout='')
        return SimpleNamespace(returncode=0, stdout=''.join(render(template, item) + '\n' for item in found))


class Creation:
    """run_hosted() against a temporary checkout, with Docker, Plow and the terminal faked."""

    def __init__(self, directory):
        self.root = Path(directory)
        (self.root / 'agent').mkdir()
        self.docker = FakeDocker()
        self.signin = self.root / 'config/plow/token'  # the account sign in, where the pinned client keeps it
        self.signin.parent.mkdir(parents=True)
        self.signin.write_text('acct_fixture_token\n')
        self.lines = [line('ln_1')]  # one free line, so a create that names none is not a choice
        self.preflight = lambda: []
        self.minted = []
        self.logged_in = 0
        self.verified = None  # what identity() says about an existing credential, or an exception to raise
        self.out, self.err = io.StringIO(), io.StringIO()

    @staticmethod
    def no_processes(command, **options):
        raise AssertionError(f'A test tried to run {command}')

    @staticmethod
    def record_failure(host, error, path, record=orchestrator.record_failure):
        """run_hosted logs unexpected failures; a tripwire (AssertionError) must reach the test instead."""
        if isinstance(error, AssertionError):
            raise error
        return record(host, error, path)

    def official(self):
        return {'account_token': self.account_token, 'login': self.login,
                'account_lines': lambda base, token: self.lines, 'mint': self.mint}

    def account_token(self, args):
        if not self.signin.exists():
            raise SystemExit('plow-agents: no account token')
        return self.signin.read_text().strip()

    def login(self, args):
        self.logged_in += 1
        self.signin.parent.mkdir(parents=True, exist_ok=True)
        self.signin.write_text('acct_fixture_token\n')

    def mint(self, args):
        if args.agent_api_base != plow_agent.ORIGIN:
            raise AssertionError(f'mint was called with agent_api_base={args.agent_api_base!r}')
        self.minted.append((args.line, args.credential_file))
        found = next(item for item in self.lines if item['uid'] == args.line)
        found['agent_uid'] = 'ag_' + args.line
        with os.fdopen(os.open(args.credential_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w') as output:
            output.write(f'PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=agt_{args.line}\n'
                         f'# plow-agent-uid: ag_{args.line}\n')

    def identity(self, path):
        if isinstance(self.verified, BaseException):
            raise self.verified
        if self.verified is not None:
            return self.verified
        uid = plow_agent.agent_uid(path)
        found = next((item for item in self.lines if item['agent_uid'] == uid), None)
        if found is None:
            raise plow_agent.CredentialRejected('Plow does not know this agent.')
        return {'line': found}

    def host(self):
        return orchestrator.Host(root=self.root, run=self.docker.run, compose=self.docker.compose,
                                 now=lambda: '2026-09-18T12:00:00Z', sleep=lambda seconds: None)

    def run(self, action, **options):
        arguments = dict(hosted_action=action, person=None, name=None, line=None, new_line=False, confirm=None)
        assert action in ('create', 'list', 'status', 'start', 'stop', 'remove'), action
        arguments.update(options)
        fakes = {'preflight': self.preflight, 'official': self.official, 'identity': self.identity,
                 'trust_certifi': lambda: None}
        with contextlib.ExitStack() as stack:
            for name, value in fakes.items():
                stack.enter_context(patch.object(plow_agent, name, value))
            stack.enter_context(patch.object(plow_agent, 'ROOT', self.root))
            # Nothing here may reach a real process. Docker is the fake above, and there is no other.
            stack.enter_context(patch.object(subprocess, 'run', self.no_processes))
            stack.enter_context(patch.object(orchestrator, 'record_failure', self.record_failure))
            stack.enter_context(patch.dict(os.environ, dict(self.docker.environ,
                                                            XDG_CONFIG_HOME=str(self.root / 'config')), clear=False))
            if not self.docker.environ.get('COMPOSE_PROJECT_NAME'):
                os.environ.pop('COMPOSE_PROJECT_NAME', None)
            stack.enter_context(patch('builtins.input', side_effect=AssertionError('The tool asked a question.')))
            stack.enter_context(patch('sys.stdin', SimpleNamespace(isatty=lambda: False)))
            stack.enter_context(contextlib.redirect_stdout(self.out))
            stack.enter_context(contextlib.redirect_stderr(self.err))
            return orchestrator.run_hosted(SimpleNamespace(**arguments), host=self.host())

    def create(self, person='dana', **options):
        return self.run('create', person=person, **options)

    def create_two(self):
        """dana on the one free line, then mel on a second one the account gains afterwards."""
        assert self.create('dana', name='Dana Whitfield') == 0
        self.lines.append(line('ln_2', number='+15551234567', name='Birch'))
        assert self.create('mel') == 0
        self.out, self.err = io.StringIO(), io.StringIO()

    def folder(self, person='dana'):
        return registry.folder_for(self.root, person)

    def recorded(self):
        return registry.read(registry.registry_path(self.root))['agents']

    def printed(self):
        return self.out.getvalue()

    def said(self):
        return self.out.getvalue() + self.err.getvalue()


class CreationTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.made = Creation(directory.name)

    def test_a_person_gets_their_own_folder_project_credential_line_and_container(self):
        self.assertEqual(self.made.create('dana', name='Dana Whitfield'), 0)
        folder = self.made.folder()
        self.assertEqual(self.made.minted, [('ln_1', str(folder / 'plow-credentials'))])
        self.assertEqual(plow_agent.agent_uid(folder / 'plow-credentials'), 'ag_ln_1')
        self.assertEqual(self.made.recorded()['dana'],
                         {'person': 'dana', 'name': 'Dana Whitfield', 'project': 'relay-hosted-dana',
                          'folder': str(folder), 'volume': 'relay-hosted-dana_agent-home',
                          'line': {'uid': 'ln_1', 'provider_key': '+15550000000', 'display_name': 'Alder'},
                          'created': '2026-09-18T12:00:00Z'})
        container, = self.made.docker.containers
        self.assertEqual(container['com.docker.compose.project'], 'relay-hosted-dana')
        self.assertEqual(container['com.docker.compose.project.working_dir'], str(folder.resolve()))
        self.assertEqual(self.made.docker.volumes, ['relay-hosted-dana_agent-home'])

    def test_the_handover_names_the_line_and_nothing_secret(self):
        self.made.create('dana', name='Dana Whitfield')
        printed = self.made.said()  # stderr as well, or a secret printed there would pass
        self.assertIn('+15550000000', printed)
        self.assertIn('Dana Whitfield', printed)
        for secret in ('agt_', 'PLOW_AGENT_TOKEN', 'acct_fixture_token'):
            with self.subTest(secret=secret):
                self.assertNotIn(secret, printed)

    def test_two_people_get_their_own_project_folder_volume_line_and_container(self):
        self.assertEqual(self.made.create('dana'), 0)
        self.made.lines.append(line('ln_2', number='+15551234567', name='Birch'))
        self.assertEqual(self.made.create('mel'), 0)
        self.assertEqual([item['line']['uid'] for item in self.made.recorded().values()], ['ln_1', 'ln_2'])
        self.assertEqual(sorted(self.made.docker.volumes),
                         ['relay-hosted-dana_agent-home', 'relay-hosted-mel_agent-home'])
        self.assertEqual(sorted(item['com.docker.compose.project'] for item in self.made.docker.containers),
                         ['relay-hosted-dana', 'relay-hosted-mel'])
        self.assertNotEqual(*[plow_agent.agent_uid(self.made.folder(who) / 'plow-credentials')
                              for who in ('dana', 'mel')])

    def test_the_same_person_twice_mints_nothing_and_says_what_already_exists(self):
        self.made.create('dana')
        before = dict(self.made.recorded())
        self.made.out, self.made.err = io.StringIO(), io.StringIO()
        self.assertEqual(self.made.create('dana'), 2)
        self.assertEqual(self.made.minted, [('ln_1', str(self.made.folder() / 'plow-credentials'))])
        self.assertEqual(self.made.recorded(), before)
        self.assertEqual(len(self.made.docker.containers), 1)
        said = self.made.said()
        self.assertIn('dana already has an agent here', said)
        self.assertIn('+15550000000', said)
        self.assertIn('./relay hosted status dana', said)

    def test_an_unsafe_identifier_is_refused_before_anything_is_created(self):
        self.assertEqual(self.made.create('Dana Whitfield'), 2)
        self.assertIn('Use dana-whitfield instead', self.made.said())
        self.assertEqual(self.made.minted, [])
        self.assertEqual(self.made.docker.containers, [])
        self.assertFalse((self.made.root / '.data/hosted').exists())

    def test_the_line_is_recorded_before_the_container_starts(self):
        # A minted line costs money whether or not the container came up, so the record must never be lost.
        self.made.docker.up = 1
        self.assertEqual(self.made.create('dana'), 1)
        self.assertEqual(self.made.minted, [('ln_1', str(self.made.folder() / 'plow-credentials'))])
        self.assertEqual(self.made.recorded()['dana']['line']['uid'], 'ln_1')
        self.assertIn('Docker could not start', self.made.said())

    def test_an_interrupted_create_continues_with_the_credential_it_already_minted(self):
        self.made.docker.up = 1
        self.assertEqual(self.made.create('dana'), 1)
        registry.forget(registry.registry_path(self.made.root), 'dana')  # as if it stopped before recording
        self.made.docker.up = 0
        self.assertEqual(self.made.create('dana'), 0)
        self.assertEqual(len(self.made.minted), 1)
        self.assertEqual(self.made.recorded()['dana']['line']['uid'], 'ln_1')
        self.assertEqual(self.made.logged_in, 0)

    def test_several_free_lines_without_a_terminal_stop_before_minting_and_name_this_command(self):
        self.made.lines.append(line('ln_2', number='+15551234567', name='Birch'))
        self.assertEqual(self.made.create('dana'), 2)
        self.assertIn('Choose one with: ./relay hosted create dana --line <position>', self.made.said())
        self.assertEqual(self.made.minted, [])
        self.assertEqual(self.made.recorded(), {})

    def test_the_line_flag_picks_which_line_this_person_gets(self):
        self.made.lines.append(line('ln_2', number='+15551234567', name='Birch'))
        self.assertEqual(self.made.create('dana', line='ln_2'), 0)
        self.assertEqual(self.made.minted, [('ln_2', str(self.made.folder() / 'plow-credentials'))])
        self.assertEqual(self.made.recorded()['dana']['line']['provider_key'], '+15551234567')

    def test_an_account_with_no_free_line_says_how_to_get_one_with_this_command(self):
        self.made.lines = [line('ln_1', agent='ag_taken')]
        self.assertEqual(self.made.create('dana'), 2)
        self.assertIn('./relay hosted create dana --new-line', self.made.said())
        self.assertEqual(self.made.minted, [])

    def test_another_line_on_a_resumed_create_is_refused(self):
        self.made.docker.up = 1
        self.made.create('dana')
        registry.forget(registry.registry_path(self.made.root), 'dana')
        self.made.docker.up = 0
        self.made.lines.append(line('ln_2', number='+15551234567', name='Birch'))
        self.made.out, self.made.err = io.StringIO(), io.StringIO()
        self.assertEqual(self.made.create('dana', line='ln_2'), 2)
        self.assertIn('./relay hosted remove dana --confirm dana', self.made.said())
        self.assertEqual(len(self.made.minted), 1)

    def test_a_credential_in_the_folder_that_plow_will_not_verify_stops_without_minting_again(self):
        self.made.docker.up = 1
        self.made.create('dana')
        registry.forget(registry.registry_path(self.made.root), 'dana')
        self.made.docker.up = 0
        self.made.verified = plow_agent.PlowUnreachable('Plow did not answer.')
        before = (self.made.folder() / 'plow-credentials').read_bytes()
        self.assertEqual(self.made.create('dana'), 1)
        self.assertEqual(len(self.made.minted), 1)
        self.assertEqual((self.made.folder() / 'plow-credentials').read_bytes(), before)
        said = self.made.said()
        self.assertIn('It was left untouched', said)
        # The installer's own words name its own command, so the message says which one applies here.
        self.assertIn('Here the command is ./relay hosted create dana', said)

    def test_a_project_name_in_the_shell_stops_the_create_before_anything_is_minted(self):
        self.made.docker.environ = {'COMPOSE_PROJECT_NAME': 'everyone'}
        self.assertEqual(self.made.create('dana'), 1)
        self.assertEqual(self.made.minted, [])
        self.assertEqual(self.made.docker.containers, [])
        said = self.made.said()
        self.assertIn("'everyone'", said)
        self.assertIn('relay-hosted-dana', said)
        self.assertIn('COMPOSE_PROJECT_NAME', said)

    def test_another_folders_agent_under_this_project_stops_the_create(self):
        elsewhere = self.made.root / 'elsewhere'
        elsewhere.mkdir()
        (elsewhere / 'plow-credentials').write_text('PLOW_AGENT_TOKEN=agt_other\n# plow-agent-uid: ag_other\n')
        self.made.docker.containers.append({
            'ID': 'ffff', 'Names': 'other', 'State': 'running', 'com.docker.compose.project': 'relay-hosted-dana',
            'com.docker.compose.service': 'agent', 'com.docker.compose.project.working_dir': str(elsewhere)})
        self.assertEqual(self.made.create('dana'), 1)
        self.assertEqual(self.made.minted, [])
        self.assertIn(f'An agent from {elsewhere} already runs under the Docker project', self.made.said())

    def test_a_container_that_never_reports_ready_stops_with_what_to_inspect(self):
        self.made.docker.logs = 'starting\n'
        self.assertEqual(self.made.create('dana'), 1)
        self.assertIn('The agent did not report readiness', self.made.said())
        self.assertEqual(self.made.recorded()['dana']['line']['uid'], 'ln_1')

    def test_the_folder_and_the_files_in_it_are_private(self):
        self.made.create('dana')
        folder = self.made.folder()
        self.assertEqual(stat.S_IMODE(folder.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE((folder / 'plow-credentials').stat().st_mode), 0o600)
        for name in ('compose.yml', '.env', 'install.json'):
            with self.subTest(name=name):
                self.assertTrue((folder / name).is_file())
                self.assertEqual(stat.S_IMODE((folder / name).stat().st_mode) & 0o077, 0)

    def test_the_project_name_is_written_where_compose_reads_it(self):
        self.made.create('dana')
        self.assertIn('COMPOSE_PROJECT_NAME=relay-hosted-dana', (self.made.folder() / '.env').read_text())
        self.assertEqual(self.made.docker.project_of(self.made.folder()), 'relay-hosted-dana')

    def test_the_compose_file_asks_for_cpu_memory_and_process_limits_and_no_privileged_mode(self):
        self.made.create('dana')
        asked = service_limits(self.made.folder() / 'compose.yml')
        self.assertEqual(asked, {'cpus': str(orchestrator.LIMITS['cpus']), 'mem_limit': orchestrator.LIMITS['memory'],
                                 'memswap_limit': orchestrator.LIMITS['memory'],
                                 'pids_limit': str(orchestrator.LIMITS['processes']), 'privileged': 'false'})
        text = (self.made.folder() / 'compose.yml').read_text()
        self.assertIn(f'build: {self.made.root / "agent"}', text)
        self.assertIn('max-size:', text)

    def test_create_reports_the_limits_docker_says_the_container_got(self):
        # Docker's answer, not the compose file's request. The fake reports numbers the file never asked for,
        # so a report built from LIMITS instead of from docker inspect cannot pass this.
        self.made.docker.limits_override = {'HostConfig.NanoCpus': 500_000_000,
                                            'HostConfig.Memory': 512 * 1024 ** 2, 'HostConfig.PidsLimit': 64}
        self.made.create('dana')
        printed = self.made.printed()
        self.assertIn('Docker reports 0.5 CPUs, 512 MiB of memory, 64 processes, not privileged', printed)
        self.assertNotIn('2048 MiB', printed)

    def test_a_container_docker_gave_no_process_limit_is_reported_as_that(self):
        with patch.object(orchestrator, 'LIMITS', dict(orchestrator.LIMITS, processes=None)):
            self.made.create('dana')
        self.assertEqual(self.made.docker.containers[0]['HostConfig.PidsLimit'], '<nil>')
        self.assertIn('Docker reports no process limit on this container', self.made.printed())

    def test_a_container_docker_reports_as_privileged_is_reported_as_that(self):
        self.made.create('dana')
        self.made.docker.containers[0]['HostConfig.Privileged'] = 'true'
        self.made.out = io.StringIO()
        self.assertEqual(self.made.run('status', person='dana'), 0)
        self.assertIn('Docker reports this container is privileged', self.made.printed())

    def test_nothing_secret_reaches_the_registry_file(self):
        # Plow's own line payload carries more than the three fields kept, so put something in it
        # that must not survive: writing the whole line dict through then fails this.
        self.made.lines[0]['token'] = 'agt_line_secret'
        self.made.create('dana')
        self.assertNotIn('agt_line_secret', registry.registry_path(self.made.root).read_text())
        saved = registry.registry_path(self.made.root).read_text()
        for secret in ('agt_', 'PLOW_AGENT_TOKEN', 'acct_'):
            with self.subTest(secret=secret):
                self.assertNotIn(secret, saved)

    def test_a_folder_that_is_a_symlink_is_refused_before_anything_is_written(self):
        target = self.made.root / 'elsewhere'
        target.mkdir()
        folder = self.made.folder('dana')
        folder.parent.mkdir(parents=True)
        folder.symlink_to(target, target_is_directory=True)
        self.assertEqual(self.made.create('dana'), 1)
        self.assertIn('symlink', self.made.said())
        self.assertEqual(self.made.minted, [])
        self.assertEqual(list(target.iterdir()), [])

    def test_a_create_that_had_to_sign_in_takes_that_sign_in_off_the_machine_again(self):
        self.made.signin.unlink()
        self.assertEqual(self.made.create('dana'), 0)
        self.assertEqual(self.made.logged_in, 1)
        self.assertFalse(self.made.signin.exists())
        self.assertIn('Sign-in', self.made.printed())

    def test_a_create_that_used_a_sign_in_already_there_keeps_it(self):
        self.assertEqual(self.made.create('dana'), 0)
        self.assertEqual(self.made.logged_in, 0)
        self.assertTrue(self.made.signin.exists())

    def test_a_create_never_touches_the_installed_agents_sign_in_note_or_its_sign_in(self):
        # Both tools used one note in the installed agent's own state, with no lock between them,
        # so a hosted create could settle a sign in the installer had created and not been told about.
        installers = self.made.root / '.data/agent/signin-created.sha256'
        installers.parent.mkdir(parents=True)
        digest = hashlib.sha256(self.made.signin.read_bytes()).hexdigest()
        installers.write_text(digest + '\n')
        self.assertEqual(self.made.create('dana'), 0)
        self.assertEqual(installers.read_text(), digest + '\n')
        self.assertTrue(self.made.signin.exists())

    def test_a_create_settles_its_own_sign_in_note_and_leaves_none_behind(self):
        self.made.signin.unlink()
        self.assertEqual(self.made.create('dana'), 0)
        for note in ('signin-created.sha256', 'signin-replaced'):
            with self.subTest(note=note):
                self.assertFalse((self.made.root / '.data/hosted' / note).exists())
                self.assertFalse((self.made.root / '.data/agent' / note).exists())

    def test_a_message_naming_the_installed_agents_env_file_is_read_for_this_operator(self):
        # A leftover volume makes the installer's guard say "Put a different COMPOSE_PROJECT_NAME
        # in agent/.env". An operator who did that would repoint the installed agent, not this one.
        self.made.docker.volumes.append('relay-hosted-dana_agent-home')
        self.assertEqual(self.made.create('dana'), 1)
        said = self.made.said()
        self.assertIn('agent/.env', said)
        self.assertIn(f'the folder is {self.made.folder()}', said)
        self.assertIn('./relay hosted create dana', said)
        self.assertEqual(self.made.minted, [])

    def test_a_message_naming_the_installed_agents_folder_is_read_for_this_operator(self):
        # A readiness timeout says "Inspect `docker compose logs agent` in agent/".
        self.made.docker.logs = 'starting\n'
        self.assertEqual(self.made.create('dana'), 1)
        said = self.made.said()
        self.assertIn('in agent/', said)
        self.assertIn(f'the folder is {self.made.folder()}', said)

    def test_a_message_of_this_tools_own_is_left_as_it_is(self):
        self.assertEqual(self.made.create('Dana Whitfield'), 2)
        self.assertNotIn('That wording comes from the installer', self.made.said())

    def test_a_symlink_above_the_persons_folder_is_refused_too(self):
        # Checking only the leaf let a symlinked agents folder put credentials outside .data,
        # and let remove rmtree through it.
        agents = self.made.root / '.data/hosted/agents'
        elsewhere = self.made.root / 'elsewhere'
        elsewhere.mkdir()
        agents.parent.mkdir(parents=True)
        agents.symlink_to(elsewhere, target_is_directory=True)
        self.assertEqual(self.made.create('dana'), 1)
        self.assertIn('symlink', self.made.said())
        self.assertEqual(list(elsewhere.iterdir()), [])
        self.assertEqual(self.made.minted, [])

    def test_docker_that_is_not_ready_stops_before_creating_anything(self):
        self.made.preflight = lambda: ['Start Docker Desktop and wait.']
        self.assertEqual(self.made.create('dana'), 1)
        self.assertEqual(self.made.minted, [])
        self.assertIn('Start Docker Desktop and wait.', self.made.said())

    def test_an_unexpected_failure_is_logged_without_any_agents_token(self):
        self.made.create('dana')
        with patch.object(orchestrator, 'look', side_effect=ValueError('agt_ln_1 leaked into a message')):
            self.assertEqual(self.made.run('status', person='dana'), 1)
        log = (self.made.root / '.data/hosted/hosted.log').read_text()
        self.assertIn('ValueError', log)
        self.assertIn('[token removed]', log)
        self.assertNotIn('agt_ln_1', log)
        self.assertIn('./relay hosted status stopped unexpectedly', self.made.said())


class ListingTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.made = Creation(directory.name)

    def listing(self, action='list', **options):
        self.made.out, self.made.err = io.StringIO(), io.StringIO()
        code = self.made.run(action, **options)
        return code, self.made.said()

    def test_nothing_recorded_says_so_and_how_to_create_one(self):
        code, said = self.listing()
        self.assertEqual(code, 0)
        self.assertIn('No hosted agents are recorded here.', said)
        self.assertIn('./relay hosted create', said)

    def test_each_agent_is_listed_with_the_state_docker_reports(self):
        self.made.create_two()
        self.made.docker.of_project('relay-hosted-mel')[0]['State'] = 'exited'
        code, said = self.listing()
        self.assertEqual(code, 0)
        dana, mel = block(said, 'relay-hosted-dana'), block(said, 'relay-hosted-mel')
        self.assertRegex(dana, r'Container[. ]+running')
        self.assertNotIn('exited', dana)
        self.assertRegex(mel, r'Container[. ]+exited')
        self.assertNotIn('running', mel)
        self.assertIn('+15550000000', dana)
        self.assertIn('relay-hosted-dana_agent-home', dana)

    def test_a_record_whose_container_docker_does_not_have_is_named_as_a_disagreement(self):
        self.made.create('dana')
        self.made.docker.containers.clear()
        code, said = self.listing()
        self.assertEqual(code, 0)
        self.assertIn('Docker has no container for this project', said)
        self.assertNotIn('running', said)

    def test_a_record_whose_volume_docker_does_not_have_is_named_as_a_disagreement(self):
        self.made.create('dana')
        self.made.docker.volumes.clear()
        code, said = self.listing()
        self.assertIn('Docker has no volume named relay-hosted-dana_agent-home', said)

    def test_a_container_running_from_another_folder_is_named_as_a_disagreement(self):
        self.made.create('dana')
        self.made.docker.containers[0]['com.docker.compose.project.working_dir'] = '/somewhere/else'
        code, said = self.listing()
        self.assertIn('runs from /somewhere/else', said)

    def test_a_container_docker_has_is_reported_even_when_the_registry_is_empty(self):
        # The registry being gone is when it is most likely to be wrong, so this is when Docker
        # most needs asking. Returning the empty line before looking skipped exactly that case.
        self.made.create('dana')
        registry.registry_path(self.made.root).unlink()
        code, said = self.listing()
        self.assertEqual(code, 0)
        self.assertIn('No hosted agents are recorded here', said)
        self.assertIn('relay-hosted-dana', said)
        self.assertIn('not recorded here', said)

    def test_a_hosted_container_docker_has_that_is_not_recorded_here_is_reported(self):
        self.made.create('dana')
        self.made.docker.containers.append({
            'ID': 'aaaa', 'Names': 'ghost', 'State': 'running', 'com.docker.compose.project': 'relay-hosted-ghost',
            'com.docker.compose.service': 'agent', 'com.docker.compose.project.working_dir': '/gone'})
        code, said = self.listing()
        self.assertIn('relay-hosted-ghost', said)
        self.assertIn('not recorded here', said)

    def test_a_folder_that_is_gone_is_named_as_a_disagreement(self):
        self.made.create('dana')
        shutil.rmtree(self.made.folder())
        code, said = self.listing()
        self.assertIn('The folder recorded here is gone', said)

    def test_status_shows_one_person_and_the_limits_docker_reports(self):
        self.made.create_two()
        self.made.docker.of_project('relay-hosted-dana')[0].update(
            {'HostConfig.NanoCpus': 2_000_000_000, 'HostConfig.Memory': 256 * 1024 ** 2, 'HostConfig.PidsLimit': 99})
        code, said = self.listing('status', person='dana')
        self.assertEqual(code, 0)
        self.assertIn('relay-hosted-dana', said)
        self.assertNotIn('relay-hosted-mel', said)
        self.assertIn('Docker reports 2 CPUs, 256 MiB of memory, 99 processes, not privileged', said)

    def test_status_for_someone_without_an_agent_here_says_so(self):
        code, said = self.listing('status', person='dana')
        self.assertEqual(code, 2)
        self.assertIn('dana has no agent recorded here', said)

    def test_a_listing_docker_refuses_to_give_stops_instead_of_reporting_nothing(self):
        self.made.create('dana')
        self.made.out = io.StringIO()
        with patch.object(self.made.docker, 'listed', lambda *a: SimpleNamespace(returncode=1, stdout='')):
            code, said = self.listing()
        self.assertEqual(code, 1)
        self.assertIn('Docker did not list its', said)


class StopTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.made = Creation(directory.name)

    def test_stop_keeps_the_folder_the_credential_the_volume_and_the_record(self):
        self.made.create('dana')
        before = dict(self.made.recorded())
        self.made.out = io.StringIO()
        self.assertEqual(self.made.run('stop', person='dana'), 0)
        self.assertEqual(self.made.docker.of_project('relay-hosted-dana')[0]['State'], 'exited')
        self.assertEqual(self.made.docker.volumes, ['relay-hosted-dana_agent-home'])
        self.assertTrue((self.made.folder() / 'plow-credentials').is_file())
        self.assertEqual(self.made.recorded(), before)
        self.assertIn('exited', self.made.printed())

    def test_stop_says_so_when_docker_still_reports_the_container_running(self):
        self.made.create('dana')
        self.made.out, self.made.err = io.StringIO(), io.StringIO()
        self.made.docker.ignore = ('stop',)  # Docker takes the command and the container keeps running
        self.assertEqual(self.made.run('stop', person='dana'), 1)
        self.assertIn('Docker still reports this container as running', self.made.said())

    def test_stop_only_touches_that_persons_project(self):
        self.made.create_two()
        self.assertEqual(self.made.run('stop', person='dana'), 0)
        self.assertEqual(self.made.docker.of_project('relay-hosted-dana')[0]['State'], 'exited')
        self.assertEqual(self.made.docker.of_project('relay-hosted-mel')[0]['State'], 'running')

    def test_a_project_name_in_the_shell_cannot_make_stop_reach_another_project(self):
        # Compose reads COMPOSE_PROJECT_NAME from the shell before the .env in the project folder,
        # so without a guard `compose stop` in dana's folder stops whatever the shell names.
        self.made.create_two()
        self.made.docker.environ = {'COMPOSE_PROJECT_NAME': 'relay-hosted-mel'}
        self.assertEqual(self.made.run('stop', person='dana'), 1)
        self.assertEqual(self.made.docker.of_project('relay-hosted-mel')[0]['State'], 'running')
        self.assertEqual(self.made.docker.of_project('relay-hosted-dana')[0]['State'], 'running')
        self.assertIn("as 'relay-hosted-mel', not 'relay-hosted-dana'", self.made.said())

    def test_a_project_name_in_the_shell_cannot_make_stop_reach_the_installed_agent(self):
        self.made.create('dana')
        self.made.docker.containers.append(installed_agent())
        self.made.docker.environ = {'COMPOSE_PROJECT_NAME': 'agent'}
        self.made.out, self.made.err = io.StringIO(), io.StringIO()
        self.assertEqual(self.made.run('stop', person='dana'), 1)
        self.assertEqual(self.made.docker.of_project('agent')[0]['State'], 'running')
        self.assertIn("as 'agent', not 'relay-hosted-dana'", self.made.said())

    def test_a_record_naming_another_folder_or_volume_is_refused_rather_than_obeyed(self):
        # The registry is a file. Nothing downstream should treat a path or a volume name in it as
        # authority to delete, so both are derived again from the identifier and compared.
        self.made.create('dana')
        elsewhere = self.made.root / 'elsewhere'
        elsewhere.mkdir()
        (elsewhere / 'keep.txt').write_text('keep')
        path = registry.registry_path(self.made.root)
        written = path.read_bytes()  # the record as create wrote it, restored before each field
        for field, value in (('folder', str(elsewhere)), ('volume', 'some-other-volume'),
                             ('project', 'relay-hosted-someone-else')):
            with self.subTest(field=field):
                registry.write(path, registry.read(path))  # no op, to keep the folder private
                path.write_bytes(written)
                saved = registry.read(path)
                self.assertEqual(saved['agents']['dana'][field], registry.read(path)['agents']['dana'][field])
                saved['agents']['dana'][field] = value
                registry.write(path, saved)
                self.made.out, self.made.err = io.StringIO(), io.StringIO()
                self.assertEqual(self.made.run('remove', person='dana', confirm='dana'), 2)
                self.assertIn('does not match', self.made.said())
                self.assertIn(repr(value), self.made.said())
                self.assertTrue((elsewhere / 'keep.txt').is_file())
                self.assertEqual(self.made.docker.volumes, ['relay-hosted-dana_agent-home'])
                self.assertEqual(list(self.made.recorded()), ['dana'])

    def test_stop_for_someone_without_an_agent_here_says_so(self):
        self.assertEqual(self.made.run('stop', person='dana'), 2)
        self.assertIn('dana has no agent recorded here', self.made.said())


class StartTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.made = Creation(directory.name)

    def stopped(self):
        self.made.create('dana')
        self.assertEqual(self.made.run('stop', person='dana'), 0)
        self.made.out, self.made.err = io.StringIO(), io.StringIO()

    def test_start_brings_a_stopped_agent_back_without_minting_or_recording_anything(self):
        self.stopped()
        before = dict(self.made.recorded())
        self.assertEqual(self.made.run('start', person='dana'), 0)
        self.assertEqual(self.made.docker.of_project('relay-hosted-dana')[0]['State'], 'running')
        self.assertEqual(len(self.made.minted), 1)
        self.assertEqual(self.made.recorded(), before)
        self.assertIn('Agent ready', self.made.printed())

    def test_stop_says_how_to_start_it_again(self):
        self.made.create('dana')
        self.made.out = io.StringIO()
        self.made.run('stop', person='dana')
        self.assertIn('./relay hosted start dana', self.made.printed())

    def test_start_waits_for_the_agent_to_report_ready(self):
        self.stopped()
        self.made.docker.logs = 'starting\n'
        self.assertEqual(self.made.run('start', person='dana'), 1)
        self.assertIn('The agent did not report readiness', self.made.said())

    def test_start_only_touches_that_persons_project(self):
        self.made.create_two()
        self.made.run('stop', person='dana')
        self.made.run('stop', person='mel')
        self.assertEqual(self.made.run('start', person='dana'), 0)
        self.assertEqual(self.made.docker.of_project('relay-hosted-dana')[0]['State'], 'running')
        self.assertEqual(self.made.docker.of_project('relay-hosted-mel')[0]['State'], 'exited')

    def test_start_for_someone_without_an_agent_here_says_so(self):
        self.assertEqual(self.made.run('start', person='dana'), 2)
        self.assertIn('dana has no agent recorded here', self.made.said())

    def test_start_without_a_credential_in_the_folder_says_so_rather_than_minting(self):
        self.stopped()
        (self.made.folder() / 'plow-credentials').unlink()
        self.assertEqual(self.made.run('start', person='dana'), 1)
        self.assertEqual(len(self.made.minted), 1)
        self.assertIn('holds no credential', self.made.said())


class RemovalTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.made = Creation(directory.name)
        self.made.create_two()

    def remove(self, person='dana', confirm=None):
        self.made.out, self.made.err = io.StringIO(), io.StringIO()
        return self.made.run('remove', person=person, confirm=confirm), self.made.said()

    def test_remove_without_the_identifier_repeated_deletes_nothing_and_names_what_it_would(self):
        code, said = self.remove()
        self.assertEqual(code, 2)
        self.assertIn('relay-hosted-dana_agent-home', said)
        self.assertIn(str(self.made.folder()), said)
        self.assertIn('./relay hosted remove dana --confirm dana', said)
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])
        self.assertEqual(len(self.made.docker.containers), 2)
        self.assertEqual(len(self.made.docker.volumes), 2)

    def test_remove_says_the_plow_line_is_not_released(self):
        code, said = self.remove()
        self.assertEqual(code, 2)
        self.assertIn('ln_1', said)
        self.assertIn('plow-agents revoke', said)
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])
        self.assertEqual(len(self.made.docker.volumes), 2)

    def test_a_mismatched_confirmation_deletes_nothing(self):
        code, said = self.remove(confirm='mel')
        self.assertEqual(code, 2)
        self.assertIn('did not match', said)
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])
        self.assertEqual(len(self.made.docker.volumes), 2)

    def test_remove_deletes_the_container_the_volume_the_folder_and_the_record(self):
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 0)
        self.assertEqual(list(self.made.recorded()), ['mel'])
        self.assertEqual(self.made.docker.of_project('relay-hosted-dana'), [])
        self.assertEqual(self.made.docker.volumes, ['relay-hosted-mel_agent-home'])
        self.assertFalse(self.made.folder('dana').exists())
        self.assertIn('Removed', said)

    def test_removing_one_person_never_touches_anothers_volume_container_or_folder(self):
        self.remove(confirm='dana')
        self.assertEqual(self.made.docker.volumes, ['relay-hosted-mel_agent-home'])
        self.assertEqual([item['com.docker.compose.project'] for item in self.made.docker.containers],
                         ['relay-hosted-mel'])
        self.assertTrue((self.made.folder('mel') / 'plow-credentials').is_file())
        self.assertEqual(self.made.recorded()['mel']['line']['uid'], 'ln_2')
        removals = [command for command, _ in self.made.docker.commands if command[:3] == ['docker', 'volume', 'rm']]
        self.assertEqual(removals, [['docker', 'volume', 'rm', 'relay-hosted-dana_agent-home']])

    def test_a_volume_docker_will_not_delete_keeps_the_record_and_the_folder(self):
        self.made.docker.refuse_volume_removal = ('relay-hosted-dana_agent-home',)
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 1)
        self.assertIn('relay-hosted-dana_agent-home', said)
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])
        self.assertTrue(self.made.folder('dana').exists())

    def test_a_container_that_survives_the_removal_keeps_the_volume_and_the_record(self):
        self.made.docker.ignore = ('down',)  # Docker takes the command and the container is still there
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 1)
        self.assertIn('still has a container', said)
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])
        self.assertEqual(len(self.made.docker.volumes), 2)

    def test_a_volume_docker_no_longer_has_is_not_an_obstacle(self):
        self.made.docker.volumes.remove('relay-hosted-dana_agent-home')
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 0)
        self.assertIn('no volume named relay-hosted-dana_agent-home', said)
        self.assertEqual(list(self.made.recorded()), ['mel'])

    def test_remove_for_someone_without_an_agent_here_says_so(self):
        code, said = self.remove(person='nobody', confirm='nobody')
        self.assertEqual(code, 2)
        self.assertIn('nobody has no agent recorded here', said)

    def test_a_project_name_in_the_shell_cannot_make_remove_reach_another_project(self):
        # The worst case: compose down in dana's folder destroying whatever the shell names instead.
        self.made.docker.environ = {'COMPOSE_PROJECT_NAME': 'relay-hosted-mel'}
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 1)
        self.assertIn("as 'relay-hosted-mel', not 'relay-hosted-dana'", said)
        self.assertEqual(sorted(item['com.docker.compose.project'] for item in self.made.docker.containers),
                         ['relay-hosted-dana', 'relay-hosted-mel'])
        self.assertEqual(len(self.made.docker.volumes), 2)
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])

    def test_a_shell_override_cannot_make_remove_destroy_the_installed_agent(self):
        self.made.docker.containers.append(installed_agent())
        self.made.docker.environ = {'COMPOSE_PROJECT_NAME': 'agent'}
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 1)
        self.assertIn("as 'agent', not 'relay-hosted-dana'", said)
        self.assertEqual(len(self.made.docker.of_project('agent')), 1)
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])

    def test_a_shell_override_is_caught_even_when_this_person_has_no_container(self):
        # The state a create that failed at `up` leaves behind, which is where the README sends
        # the operator to remove from, and where every check keyed on this project passes vacuously.
        self.made.docker.containers = [item for item in self.made.docker.containers
                                       if item['com.docker.compose.project'] != 'relay-hosted-dana']
        self.made.docker.environ = {'COMPOSE_PROJECT_NAME': 'relay-hosted-mel'}
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 1)
        self.assertIn("as 'relay-hosted-mel', not 'relay-hosted-dana'", said)
        self.assertEqual([item['com.docker.compose.project'] for item in self.made.docker.containers],
                         ['relay-hosted-mel'])
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])

    def test_a_folder_that_lost_its_compose_file_can_still_be_removed(self):
        wanted = self.made.docker.of_project('relay-hosted-dana')[0]['ID']
        (self.made.folder('dana') / 'compose.yml').unlink()
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 0)
        self.assertEqual([command for command, _ in self.made.docker.commands if command[:3] == ['docker', 'rm', '-f']],
                         [['docker', 'rm', '-f', wanted]])
        self.assertEqual(list(self.made.recorded()), ['mel'])
        self.assertFalse(self.made.folder('dana').exists())

    def test_a_folder_that_is_already_gone_still_removes_the_container_by_its_own_id(self):
        wanted = self.made.docker.of_project('relay-hosted-dana')[0]['ID']
        shutil.rmtree(self.made.folder('dana'))
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 0)
        self.assertEqual([command for command, _ in self.made.docker.commands if command[:3] == ['docker', 'rm', '-f']],
                         [['docker', 'rm', '-f', wanted]])
        self.assertEqual(list(self.made.recorded()), ['mel'])
        self.assertEqual(self.made.docker.volumes, ['relay-hosted-mel_agent-home'])
        self.assertEqual([item['com.docker.compose.project'] for item in self.made.docker.containers],
                         ['relay-hosted-mel'])

    def test_a_folder_that_is_a_symlink_is_never_followed(self):
        target = self.made.root / 'elsewhere'
        target.mkdir()
        (target / 'keep.txt').write_text('keep')
        shutil.rmtree(self.made.folder('dana'))
        self.made.folder('dana').symlink_to(target, target_is_directory=True)
        code, said = self.remove(confirm='dana')
        self.assertEqual(code, 1)
        self.assertTrue((target / 'keep.txt').is_file())
        self.assertIn('symlink', said)


class CommandLineTests(unittest.TestCase):
    """The hosted subcommands as ./relay parses them, and the exit code it gives back."""

    def reaching(self, argv, code=0):
        received = []
        with patch.object(orchestrator, 'run_hosted', side_effect=lambda args: received.append(args) or code):
            returned = cli.main(argv)
        self.assertEqual(len(received), 1)
        return received[0], returned

    def test_create_carries_the_person_the_name_and_the_line_flags(self):
        args, _ = self.reaching(['hosted', 'create', 'dana', '--name', 'Dana Whitfield', '--line', '2'])
        self.assertEqual((args.hosted_action, args.person, args.name, args.line, args.new_line),
                         ('create', 'dana', 'Dana Whitfield', '2', False))
        args, _ = self.reaching(['hosted', 'create', 'dana'])
        self.assertEqual((args.name, args.line, args.new_line), (None, None, False))
        args, _ = self.reaching(['hosted', 'create', 'dana', '--new-line'])
        self.assertTrue(args.new_line)

    def test_remove_carries_the_repeated_identifier_and_asks_for_nothing_by_default(self):
        args, _ = self.reaching(['hosted', 'remove', 'dana', '--confirm', 'dana'])
        self.assertEqual((args.hosted_action, args.person, args.confirm), ('remove', 'dana', 'dana'))
        args, _ = self.reaching(['hosted', 'remove', 'dana'])
        self.assertIsNone(args.confirm)

    def test_list_status_start_and_stop_reach_the_tool(self):
        args, _ = self.reaching(['hosted', 'list'])
        self.assertEqual((args.hosted_action, getattr(args, 'person', None)), ('list', None))
        for action in ('status', 'start', 'stop'):
            with self.subTest(action=action):
                args, _ = self.reaching(['hosted', action, 'dana'])
                self.assertEqual((args.hosted_action, args.person), (action, 'dana'))

    def test_the_exit_code_reaches_the_shell_unchanged(self):
        for code in (0, 1, 2):
            with self.subTest(code=code):
                _, returned = self.reaching(['hosted', 'list'], code)
                self.assertEqual(returned, code)

    def test_an_action_and_a_person_are_required(self):
        for argv in (['hosted'], ['hosted', 'create'], ['hosted', 'remove']):
            with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit):
                    cli.main(argv)

    def test_no_relay_api_call_is_needed_to_run_a_hosted_command(self):
        # The real tool runs here. Patching run_hosted out would have tested the parser and nothing else.
        with tempfile.TemporaryDirectory() as directory:
            made = Creation(directory)
            made.create('dana')
            built = made.host()
            with patch.object(cli, 'API', side_effect=AssertionError('hosted reached for the Relay API')), \
                    patch.object(orchestrator, 'Host', lambda: built), \
                    patch.object(plow_agent, 'trust_certifi', lambda: None), \
                    contextlib.redirect_stdout(io.StringIO()) as printed:
                self.assertEqual(cli.main(['hosted', 'list']), 0)
        self.assertIn('relay-hosted-dana', printed.getvalue())


class NoRealDockerTests(unittest.TestCase):
    """The fake is the only Docker these tests have. This proves it, rather than trusting it."""

    def test_a_command_that_escaped_the_fake_would_fail_the_test(self):
        with tempfile.TemporaryDirectory() as directory:
            made = Creation(directory)
            made.create('dana')  # so that listing has somebody to ask Docker about
            plain = orchestrator.Host(root=made.root, now=lambda: 'now')  # a host with the real Docker
            with patch.object(made, 'host', lambda: plain), self.assertRaises(AssertionError) as escaped:
                made.run('list')
        self.assertIn('docker', str(escaped.exception))


class BrokenAgentTests(unittest.TestCase):
    """Every state a broken agent can be in still has a route out, and none of them is blamed on an override.

    A guard that cannot be satisfied is worse than the risk it was added for when what it blocks is
    removing an agent the operator is paying for.
    """

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.made = Creation(directory.name)
        self.made.create_two()

    def removes(self, person='dana'):
        self.made.out, self.made.err = io.StringIO(), io.StringIO()
        code = self.made.run('remove', person=person, confirm=person)
        return code, self.made.said()

    def gone(self, person='dana'):
        """Everything of this person's is gone, and the other person still has everything."""
        self.assertEqual(self.made.docker.of_project(f'relay-hosted-{person}'), [])
        self.assertNotIn(f'relay-hosted-{person}_agent-home', self.made.docker.volumes)
        self.assertFalse(self.made.folder(person).exists())
        self.assertNotIn(person, self.made.recorded())
        self.assertEqual(self.made.docker.volumes, ['relay-hosted-mel_agent-home'])
        self.assertEqual(len(self.made.docker.of_project('relay-hosted-mel')), 1)
        self.assertTrue((self.made.folder('mel') / 'plow-credentials').is_file())

    def test_a_person_with_no_container_can_still_be_removed(self):
        self.made.docker.containers = [item for item in self.made.docker.containers
                                       if item['com.docker.compose.project'] != 'relay-hosted-dana']
        code, said = self.removes()
        self.assertEqual(code, 0)
        self.assertIn('no container', said)
        self.gone()

    def test_a_person_whose_env_file_is_gone_can_still_be_removed(self):
        # Compose then falls back to the folder basename, which is not an override and must not be called one.
        (self.made.folder('dana') / '.env').unlink()
        code, said = self.removes()
        self.assertEqual(code, 0)
        self.assertNotIn('COMPOSE_PROJECT_NAME', said)
        self.gone()

    def test_a_person_whose_compose_file_is_gone_can_still_be_removed(self):
        (self.made.folder('dana') / 'compose.yml').unlink()
        code, said = self.removes()
        self.assertEqual(code, 0)
        self.assertNotIn('COMPOSE_PROJECT_NAME', said)
        self.gone()

    def test_a_folder_left_half_deleted_can_still_be_removed(self):
        # rmtree deletes in scandir order and can die partway, so .env can go and compose.yml stay.
        # Before this, every rerun refused and told the operator to unset something that was not set.
        (self.made.folder('dana') / '.env').unlink()
        (self.made.folder('dana') / 'install.json').unlink()
        code, said = self.removes()
        self.assertEqual(code, 0)
        self.gone()

    def test_docker_that_is_not_running_is_named_as_that_and_nothing_is_forgotten(self):
        self.made.docker.down = True
        code, said = self.removes()
        self.assertEqual(code, 1)
        self.assertIn('Docker did not list its', said)
        self.assertNotIn('COMPOSE_PROJECT_NAME', said)
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])
        self.assertTrue(self.made.folder('dana').exists())

    def test_compose_that_cannot_answer_is_never_reported_as_a_shell_override(self):
        # The commonest failure of all is a Docker that is not running. Naming a confident wrong
        # cause for it is the one thing this tool is least allowed to do.
        self.made.docker.speechless = True
        for action, extra in (('stop', {}), ('start', {}), ('remove', {'confirm': 'dana'})):
            with self.subTest(action=action):
                self.made.out, self.made.err = io.StringIO(), io.StringIO()
                self.made.run(action, person='dana', **extra)
                said = self.made.said()
                self.assertNotIn('COMPOSE_PROJECT_NAME', said)
                self.assertNotIn('would have reached', said)
                # And no project is attributed to Compose either. Compose said nothing at all here,
                # so a name reached for anywhere else is still a cause nobody observed.
                self.assertIn('could not be read by Compose', said)
                self.assertNotIn(' to Compose, not ', said)

    def test_stop_still_works_when_compose_cannot_be_asked(self):
        self.made.docker.speechless = True
        self.made.out, self.made.err = io.StringIO(), io.StringIO()
        self.assertEqual(self.made.run('stop', person='dana'), 0)
        self.assertEqual(self.made.docker.of_project('relay-hosted-dana')[0]['State'], 'exited')
        self.assertEqual(self.made.docker.of_project('relay-hosted-mel')[0]['State'], 'running')

    def test_a_shell_override_is_still_refused_when_compose_can_answer(self):
        # The fallback must not have become a way round the guard the Critical was about.
        self.made.docker.environ = {'COMPOSE_PROJECT_NAME': 'relay-hosted-mel'}
        code, said = self.removes()
        self.assertEqual(code, 1)
        self.assertIn("as 'relay-hosted-mel', not 'relay-hosted-dana'", said)
        self.assertEqual(sorted(self.made.recorded()), ['dana', 'mel'])
        self.assertEqual(len(self.made.docker.volumes), 2)

    def test_start_says_what_it_could_not_confirm_rather_than_starting_anyway(self):
        self.made.run('stop', person='dana')
        self.made.docker.speechless = True
        self.made.out, self.made.err = io.StringIO(), io.StringIO()
        self.assertEqual(self.made.run('start', person='dana'), 1)
        said = self.made.said()
        self.assertIn('could not say', said)
        self.assertIn('./relay hosted remove dana', said)
        self.assertEqual(self.made.docker.of_project('relay-hosted-dana')[0]['State'], 'exited')


class MovedCheckoutTests(unittest.TestCase):
    """A record written when the repository was somewhere else. Reading about it must not be refused."""

    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.made = Creation(directory.name)
        self.made.create('dana', name='Dana Whitfield')
        path = registry.registry_path(self.made.root)
        saved = registry.read(path)
        saved['agents']['dana']['folder'] = '/somewhere/else/.data/hosted/agents/dana'
        registry.write(path, saved)
        self.made.out, self.made.err = io.StringIO(), io.StringIO()

    def test_status_reports_the_mismatch_instead_of_refusing_over_it(self):
        self.assertEqual(self.made.run('status', person='dana'), 0)
        said = self.made.said()
        self.assertIn('/somewhere/else', said)
        self.assertIn('relay-hosted-dana', said)
        self.assertIn('does not match', said)

    def test_list_reports_the_mismatch_too(self):
        self.assertEqual(self.made.run('list'), 0)
        self.assertIn('does not match', self.made.said())

    def test_a_command_that_would_act_refuses_as_a_decision_and_names_the_fix(self):
        for action, extra in (('stop', {}), ('start', {}), ('remove', {'confirm': 'dana'})):
            with self.subTest(action=action):
                self.made.out, self.made.err = io.StringIO(), io.StringIO()
                self.assertEqual(self.made.run(action, person='dana', **extra), 2)
                said = self.made.said()
                self.assertIn('does not match', said)
                self.assertIn(str(registry.registry_path(self.made.root)), said)
                # Correcting the registry is not enough on its own, and the message has to say so.
                self.assertIn('compose.yml', said)
        self.assertEqual(list(self.made.recorded()), ['dana'])


class DocumentationTests(unittest.TestCase):
    def setUp(self):
        self.readme = (orchestrator.ROOT / 'hosted/README.md').read_text()

    def test_the_readme_teaches_the_commands(self):
        for command in ('./relay hosted create', './relay hosted list', './relay hosted status',
                        './relay hosted start', './relay hosted stop', './relay hosted remove'):
            with self.subTest(command=command):
                self.assertIn(command, self.readme)

    def test_the_readme_says_it_creates_real_plow_agents_and_lines(self):
        self.assertIn('Plow account', self.readme)
        self.assertIn('costs', self.readme)

    def test_the_readme_says_what_this_does_not_do_yet(self):
        section = self.readme[self.readme.index('## What this does not do yet'):]
        for absent in ('shell', 'browser', 'signup'):
            with self.subTest(absent=absent):
                self.assertIn(absent, section)

    def test_the_readme_has_no_dashes_for_punctuation_and_no_emoji(self):
        for text in (self.readme, Path(orchestrator.__file__).read_text()):
            with self.subTest(text=text[:20]):
                self.assertNotIn('—', text)
                self.assertNotIn('–', text)
                self.assertTrue(text.isascii())


if __name__ == '__main__':
    unittest.main()
