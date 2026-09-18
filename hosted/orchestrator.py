"""Create and manage agents this host runs for other people, one container each.

The operator names a person; that person gets an agent on its own Plow line and texts it.
Nothing is installed on their computer, which is what makes this useful to somebody on
Windows, who cannot have the tools that reach their own machine either way.

One place in this repository knows how an agent comes into being, and it is
integrations/relay-terminal/plow_agent.py. This calls into it: the same duplicate guards,
the same line choice, the same minting, the same readiness check. What is new here is that
every agent gets its own folder, its own Compose project, its own credential and its own
memory volume, and that the operator can see, stop and remove them.

Nothing here reports a container as running because a file says so. The registry records
what this tool did. Every statement about a container comes from asking Docker.
"""
import contextlib
from datetime import datetime, timezone
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import traceback

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'integrations/relay-terminal'))
import plow_agent
from plow_agent import AgentError, DecisionNeeded, status_line
import registry

ROOT = Path(__file__).resolve().parents[1]
IMAGE = 'repro-relay-agent:local'
INSTALLER = './relay agent'

# Every hosted container is limited, from the first one. One person's loop must not take the
# host down for everybody else's. These are ceilings, not reservations: an idle agent uses
# almost nothing. One CPU is enough for a gateway that spends its time waiting on a model,
# 2 GiB is above what the image needs and below what a leak needs to hurt the host, and 512
# processes is far above a normal process tree and far below a fork loop. Swap is pinned to
# the memory limit so a container cannot escape it into swap. The log is capped because a
# chatty loop filling the host's disk is the same failure by another route.
LIMITS = {'cpus': 1, 'memory': '2g', 'processes': 512, 'log_size': '10m', 'log_files': 3}

COMPOSE_FILE = """\
# Written by ./relay hosted create for {person}. Editing it changes only this one agent.
# It builds the same image as agent/, so every hosted agent runs what this repository builds.
services:
  agent:
    build: {context}
    image: {image}
    platform: linux/amd64
    environment:
      AGENT_ID: repro-relay
    volumes:
      - type: bind
        source: ./plow-credentials
        target: /var/lib/plow/credentials.host
        read_only: true
        bind:
          create_host_path: false
      - agent-home:/var/lib/hermes
    restart: unless-stopped
    stop_grace_period: 35s
{limits}\
    logging:
      driver: json-file
      options:
        max-size: {log_size}
        max-file: "{log_files}"
volumes:
  agent-home:
"""

AGENTS = ['docker', 'ps', '-a', '--filter', 'label=com.docker.compose.service=agent', '--format',
          '{{.ID}}\t{{.Label "com.docker.compose.project"}}\t'
          '{{.Label "com.docker.compose.project.working_dir"}}\t{{.State}}']
VOLUMES = ['docker', 'volume', 'ls', '--format', '{{.Name}}']
INSPECT = ('{{.HostConfig.NanoCpus}}\t{{.HostConfig.Memory}}\t'
           '{{.HostConfig.PidsLimit}}\t{{.HostConfig.Privileged}}')


class Host:
    """This machine: where hosted agents live, and how Docker is reached.

    Docker is two callables rather than one because Docker is reached two ways: read only
    listings, and Compose inside one agent's own folder. Tests give both, so no test runs Docker.
    """

    def __init__(self, root=None, run=None, compose=None, now=None, sleep=None):
        self.root = Path(root or ROOT)
        self.run = run or (lambda command, cwd=None: subprocess.run(command, cwd=cwd, capture_output=True,
                                                                    text=True, timeout=60))
        self.compose = compose or plow_agent.compose
        self.now = now or (lambda: f'{datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ}')
        self.sleep = sleep or time.sleep

    def registry(self):
        return registry.registry_path(self.root)


def rows(host, command, what, fields):
    """A read only Docker listing as rows of tab separated fields.

    A listing Docker will not give stops the command. Reporting an empty list instead would
    mean saying nothing is there when the truth is that nobody looked.
    """
    try:
        result = host.run(command)
    except (OSError, subprocess.SubprocessError):
        result = None
    if result is None or result.returncode:
        raise AgentError(f'Docker did not list its {what}, so this command stopped rather than reporting what it '
                         'could not see. Check that Docker is running, then run it again.')
    return [([part.strip() for part in text.split('\t')] + [''] * fields)[:fields]
            for text in result.stdout.splitlines() if text.strip()]


def look(host):
    """What Docker has right now: every agent container on this host, and every volume."""
    return {'containers': rows(host, AGENTS, 'containers', fields=4),
            'volumes': {name for name, in rows(host, VOLUMES, 'volumes', fields=1)}}


def containers_of(world, project):
    return [row for row in world['containers'] if row[1] == project]


def create(host, args, person):
    """Give one person an agent of their own: a folder, a project, a credential, a line and a container."""
    known = registry.find(host.registry(), person)
    if known is not None:
        raise DecisionNeeded(already_here(known))
    missing = plow_agent.preflight()
    if missing:
        for item in missing:
            print('Needed: ' + item, file=sys.stderr, flush=True)
        return 1
    print(status_line('Docker', 'ready'), flush=True)

    project = registry.project_name(person)
    folder = prepare(host, person, project)
    print(status_line('Folder', folder), flush=True)
    print(status_line('Project', project), flush=True)

    credential = folder / 'plow-credentials'
    resuming = credential.exists()
    if resuming:
        print('This folder already holds a credential from a run that did not finish. Continuing with that agent '
              'rather than minting a second one.', flush=True)
    reused = guard(host, folder, project, fresh=not resuming)
    if reused:
        print(status_line('Memory', "reused from this person's earlier agent"), flush=True)
    if resuming:
        line = plow_agent.existing_line(credential, plow_agent.identity)
        plow_agent.refuse_other_line(line, args, advice=f'To use another line, remove {person} with ./relay hosted '
                                                        f'remove {person} --confirm {person} and create them again.')
        plow_agent.announce_line(line)
        print(status_line('Credential', 'reused'), flush=True)
    else:
        line = plow_agent.credential_for_new_line(args, credential, command=f'./relay hosted create {person}')

    # Recorded before the container starts. The line is minted and billable from here on, whether
    # or not Docker manages to start anything, so losing the record would lose a line somebody pays for.
    volume = registry.volume_name(project)
    registry.record(host.registry(), registry.entry(person=person, name=args.name or person, project=project,
                                                    folder=folder, volume=volume, line=line, created=host.now()))
    print(status_line('Recorded', f'{person} in {host.registry()}'), flush=True)

    guard(host, folder, project, fresh=not resuming)  # again: signing in can take minutes
    print('Starting the agent (the first start downloads several GB) ...', flush=True)
    try:
        started = host.compose('up', '-d', cwd=folder)
    except subprocess.TimeoutExpired:
        raise AgentError('The first download is still running or stalled. Run this command again to continue; '
                         'Docker keeps what it already downloaded.') from None
    if started.returncode:
        raise AgentError('Docker could not start the agent. The output above shows why. The line and the folder '
                         'are recorded, so running this command again continues with them.')
    plow_agent.remember_install(folder / 'install.json', project, folder)
    await_ready(host, folder)
    report_limits(host, project, folder)
    # A sign in this run created is taken off the machine again, exactly as the installer does. Leaving it
    # would leave an account token here, and leave a note in the installed agent's own state that ./relay
    # agent would later act on. Sign in yourself with plow-agents login and every create reuses that instead.
    plow_agent.settle_signin(plow_agent.signin_path(), plow_agent.signin_marker(), minted=not resuming)
    print(f'\nGive {args.name or person} this number: {line.get("provider_key") or line["uid"]}', flush=True)
    print('They text it to talk to their agent. Nothing is installed on their computer.', flush=True)
    print(f'Next: ./relay hosted status {person}, ./relay hosted stop {person}', flush=True)
    return 0


def await_ready(host, folder):
    """Wait for the container to say it is configured, and report the line it said it with.

    The agent is called ready because its own log says so, not because Compose returned nothing.
    """
    state, detail = plow_agent.wait_ready(
        lambda: host.compose('logs', '--no-color', '--since', '15m', 'agent', capture=True, cwd=folder).stdout,
        sleep=host.sleep)
    if state != 'ready':
        raise AgentError(detail)
    print(status_line('Agent ready', detail.split(plow_agent.READY)[-1].strip()), flush=True)


def start(host, args):
    """Bring one person's stopped agent back, with the credential and memory it already has.

    This exists so that stopping an agent can be undone. Without it the only way back would be to
    remove the person and create them again, which would mint and bill a second line.
    """
    entry = required(host, args.person)
    folder = running_folder(entry)
    if not (folder / 'plow-credentials').is_file():
        raise AgentError(f'The folder recorded for {entry["person"]}, {folder}, holds no credential, so there is no '
                         'agent to start there. ./relay hosted status ' + entry['person'] + ' shows what is left of it.')
    guard(host, folder, entry['project'], fresh=False)
    if host.compose('up', '-d', cwd=folder).returncode:
        raise AgentError('Docker could not start the agent. The output above shows why. Nothing was changed.')
    await_ready(host, folder)
    report_limits(host, entry['project'], folder)
    print(f'Started. Text {entry["line"].get("provider_key") or entry["line"]["uid"]} to reach it.', flush=True)
    return 0


def already_here(known):
    line = known['line']
    label = ' '.join(part for part in (line.get('display_name'), line.get('provider_key')) if part)
    return (f'{known["person"]} already has an agent here, created {known["created"]}. It answers on {label}, under '
            f'the Docker project {known["project"]}, with its folder at {known["folder"]}. Nothing was created and no '
            f'line was minted. Use ./relay hosted status {known["person"]} to see what Docker says about it.')


def prepare(host, person, project):
    """The person's own folder, holding what Compose reads: the project name and the service."""
    folder = registry.folder_for(host.root, person)
    if folder.is_symlink():
        raise AgentError(f'{folder} is a symlink. This tool will not follow one, because that would put this '
                         "person's credential somewhere else. Nothing was created. Inspect it yourself.")
    folder = registry.private_folder(folder)
    write_private(folder / '.env', f'COMPOSE_PROJECT_NAME={project}\n')
    write_private(folder / 'compose.yml', COMPOSE_FILE.format(
        person=person, context=host.root / 'agent', image=IMAGE, limits=limit_lines(LIMITS),
        log_size=LIMITS['log_size'], log_files=LIMITS['log_files']))
    return folder


def write_private(path, text):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), 'w', encoding='utf-8') as output:
        output.write(text)
    os.chmod(path, 0o600)


def limit_lines(limits):
    """The limits as Compose service keys. privileged is written out even though false is the default,
    so that what this container may do can be read off the file rather than assumed."""
    lines = []
    if limits.get('cpus') is not None:
        lines.append(f'cpus: {limits["cpus"]}')
    if limits.get('memory'):
        lines += [f'mem_limit: {limits["memory"]}', f'memswap_limit: {limits["memory"]}']
    if limits.get('processes') is not None:
        lines.append(f'pids_limit: {limits["processes"]}')
    lines.append('privileged: false')
    return ''.join(f'    {text}\n' for text in lines)


def guard(host, folder, project, fresh):
    """The installer's own duplicate guards, applied to this person's folder, and the project Compose resolves.

    Two agents under one Compose project would share one memory volume and one credential, which is
    exactly what these guards exist to prevent.
    """
    resolved, reused = plow_agent.guard_docker(fresh, run=host.run, folder=folder, environ=os.environ,
                                               record=folder / 'install.json')
    if resolved != project:
        raise AgentError(f'Compose resolves the project in {folder} as {resolved!r}, not {project!r}. '
                         'COMPOSE_PROJECT_NAME in this shell overrides the one written in that folder, and two '
                         'hosted agents under one project would share one memory volume. Unset it, then run this '
                         'command again.')
    return reused


def observed_limits(host, container):
    """What Docker says this container actually got. None when Docker will not describe it."""
    try:
        found = rows(host, ['docker', 'inspect', '--format', INSPECT, container], 'container limits', fields=4)
    except AgentError:
        return None
    return dict(zip(('cpus', 'memory', 'processes', 'privileged'), found[0])) if found else None


def number(text):
    """A Docker limit as an integer. An unset limit reads as <nil>, as an empty field, or as zero."""
    try:
        return int(text)
    except (TypeError, ValueError):
        return 0


def limits_report(observed, folder):
    """What Docker reports this container got, and one sentence for each limit it reports nothing for."""
    if observed is None:
        return None, ['Docker would not describe this container, so what it was given is unknown.']
    said, problems = [], []
    if number(observed['cpus']):
        count = number(observed['cpus']) / 1_000_000_000
        said.append(f'{count:g} CPU' if count == 1 else f'{count:g} CPUs')
    else:
        problems.append('Docker reports no CPU limit on this container.' + asked_for('cpus', 'cpus', folder))
    if number(observed['memory']):
        said.append(f'{number(observed["memory"]) // 1024 ** 2} MiB of memory')
    else:
        problems.append('Docker reports no memory limit on this container.' + asked_for('memory', 'mem_limit', folder))
    if number(observed['processes']):
        said.append(f'{number(observed["processes"])} processes')
    else:
        problems.append('Docker reports no process limit on this container.'
                        + asked_for('processes', 'pids_limit', folder))
    if observed['privileged'] == 'true':
        problems.append('Docker reports this container is privileged, which this tool never asks for.')
    else:
        said.append('not privileged')
    return ('Docker reports ' + ', '.join(said) if said else None), problems


def asked_for(key, written, folder):
    """What the compose file asks for, said only when it asks for it."""
    return f' The compose file in {folder} asks for {written}: {LIMITS[key]}.' if LIMITS.get(key) is not None else ''


def report_limits(host, project, folder, label='Limits', indent=''):
    found = containers_of(look(host), project)
    if not found:
        return
    summary, problems = limits_report(observed_limits(host, found[0][0]), folder)
    if summary:
        print(status_line(label, summary), flush=True)
    for text in problems:
        print(indent + text, flush=True)


def show(host, person=None):
    """What exists here, and what Docker says about each one. Where they disagree, both are said."""
    recorded = registry.read(host.registry())['agents']
    if person is not None:
        wanted = {person: required(host, person)}
    elif not recorded:
        print('No hosted agents are recorded here. Create one with ./relay hosted create <identifier>.', flush=True)
        return 0
    else:
        wanted = recorded
    world = look(host)
    for entry in wanted.values():
        describe(host, entry, world, limits=person is not None)
    for text in unrecorded(recorded, world):
        print(text, flush=True)
    return 0


def describe(host, entry, world, limits=False):
    found = containers_of(world, entry['project'])
    header = entry['person'] if entry['name'] == entry['person'] else f'{entry["person"]}  {entry["name"]}'
    line = entry['line']
    print('\n' + header, flush=True)
    print(status_line('  Line', ' '.join(part for part in (line.get('display_name'), line.get('provider_key'))
                                         if part) or line.get('uid')), flush=True)
    print(status_line('  Project', entry['project']), flush=True)
    print(status_line('  Folder', entry['folder']), flush=True)
    print(status_line('  Container', ', '.join(f'{state} ({identifier})' for identifier, _, _, state in found)
                      or 'none'), flush=True)
    print(status_line('  Memory volume', entry['volume']), flush=True)
    print(status_line('  Created', entry['created']), flush=True)
    for text in disagreements(entry, found, world):
        print('  ' + text, flush=True)
    if limits and found:
        summary, problems = limits_report(observed_limits(host, found[0][0]), entry['folder'])
        if summary:
            print(status_line('  Limits', summary), flush=True)
        for text in problems:
            print('  ' + text, flush=True)


def disagreements(entry, found, world):
    """Where the record and Docker do not say the same thing. The record is what this tool did,
    not evidence that anything is running, so these are reported rather than reconciled."""
    notes, folder = [], Path(entry['folder'])
    if not found:
        notes.append('Docker has no container for this project, so nothing is answering on that line.')
    if len(found) > 1:
        notes.append(f'Docker has {len(found)} containers under this project, where there should be one.')
    for _, _, working_dir, _ in found:
        if working_dir and not plow_agent.same_folder(working_dir, folder):
            notes.append(f'A container under this project runs from {working_dir}, not the folder recorded here.')
    if entry['volume'] not in world['volumes']:
        notes.append(f'Docker has no volume named {entry["volume"]}, so this agent has no memory of its own here.')
    if folder.is_symlink():
        notes.append('The folder recorded here is a symlink. This tool will not follow it.')
    elif not folder.is_dir():
        notes.append('The folder recorded here is gone, so this agent cannot be started or removed from it.')
    elif not (folder / 'plow-credentials').is_file():
        notes.append('The folder recorded here holds no credential, so this agent cannot answer.')
    return notes


def unrecorded(recorded, world):
    """Agents Docker has under a hosted project that this host has no record of."""
    projects = {entry['project'] for entry in recorded.values()}
    for identifier, project, working_dir, state in world['containers']:
        if project.startswith(registry.PREFIX) and project not in projects:
            yield (f'\nDocker has an agent under the Docker project {project}, from '
                   f'{working_dir or "an unknown folder"}, that is not recorded here. Docker reports it as '
                   f'{state} ({identifier}).')


def required(host, person):
    entry = registry.find(host.registry(), registry.safe_identifier(person))
    if entry is None:
        raise DecisionNeeded(f'{person} has no agent recorded here, so nothing was changed. ./relay hosted list '
                             'shows the agents this host created.')
    return entry


def usable_folder(entry):
    folder = Path(entry['folder'])
    if folder.is_symlink():
        raise AgentError(f'The folder recorded for {entry["person"]}, {folder}, is a symlink. This tool will not '
                         'follow one, so nothing was changed. Inspect it yourself.')
    return folder


def running_folder(entry):
    """The folder Compose has to be run in, refused when it is not one."""
    folder = usable_folder(entry)
    if not folder.is_dir():
        raise AgentError(f'The folder recorded for {entry["person"]}, {folder}, is gone, so Compose cannot be run '
                         'there. ./relay hosted list shows what Docker still has under that project.')
    return folder


def stop(host, args):
    """Stop one person's container. Everything else is kept."""
    entry = required(host, args.person)
    folder = running_folder(entry)
    if host.compose('stop', cwd=folder).returncode:
        raise AgentError('Docker did not stop the agent. The output above shows why. Nothing else was changed.')
    found = containers_of(look(host), entry['project'])
    print(status_line('Container', ', '.join(f'{state} ({identifier})' for identifier, _, _, state in found)
                      or 'none'), flush=True)
    if any(state in plow_agent.ACTIVE_STATES for _, _, _, state in found):
        raise AgentError('Docker still reports this container as running after being asked to stop it. Nothing was '
                         f'deleted. Inspect it with docker ps --filter label=com.docker.compose.project={entry["project"]}.')
    print('Stopped. The line, the credential and the memory volume are kept. Start it again with '
          f'./relay hosted start {entry["person"]}.', flush=True)
    return 0


def remove(host, args, person):
    """Delete one person's container, memory volume, folder and record, in that order.

    Each step is confirmed by asking Docker again before the next one runs, so a step that did
    not happen never leads to forgetting the thing it was supposed to remove.
    """
    entry = required(host, person)
    if args.confirm != person:
        raise DecisionNeeded(removal_plan(entry, mismatched=args.confirm is not None))
    folder = usable_folder(entry)
    world = look(host)
    found = containers_of(world, entry['project'])
    if folder.is_dir():
        if host.compose('down', '--remove-orphans', cwd=folder).returncode:
            raise AgentError('Docker did not remove the agent. The output above shows why. Nothing was deleted.')
    elif found:
        host.run(['docker', 'rm', '-f', *[identifier for identifier, _, _, _ in found]])
    if containers_of(look(host), entry['project']):
        raise AgentError(f'The Docker project {entry["project"]} still has a container after being asked to remove '
                         'it, so nothing was deleted. Inspect it with docker ps -a --filter '
                         f'label=com.docker.compose.project={entry["project"]}.')
    print(status_line('Container', 'removed'), flush=True)

    if entry['volume'] in world['volumes']:
        if host.run(['docker', 'volume', 'rm', entry['volume']]).returncode:
            raise AgentError(f'Docker did not delete the volume {entry["volume"]}. The folder and the record were '
                             'kept, so this person still appears in ./relay hosted list. Delete the volume yourself '
                             'and run this command again.')
        if entry['volume'] in look(host)['volumes']:
            raise AgentError(f'Docker still reports the volume {entry["volume"]} after being asked to delete it. '
                             'The folder and the record were kept.')
        print(status_line('Memory volume', f'{entry["volume"]} deleted'), flush=True)
    else:
        print(f'Docker has no volume named {entry["volume"]}, so there was none to delete.', flush=True)

    if folder.is_dir():
        shutil.rmtree(folder)
    print(status_line('Folder', f'{folder} deleted'), flush=True)
    registry.forget(host.registry(), person)
    print(f'Removed {person}. Their Plow line {line_label(entry)} is still theirs on your Plow account: retire it '
          f'with plow-agents revoke {entry["line"]["uid"]} if you want it back.', flush=True)
    return 0


def line_label(entry):
    line = entry['line']
    return ' '.join(part for part in (line.get('uid'), line.get('provider_key')) if part)


def removal_plan(entry, mismatched):
    opening = ('The identifier you repeated did not match ' + entry['person'] + ', so nothing was deleted.'
               if mismatched else '')
    return (f'{opening}\nRemoving {entry["person"]} deletes the container for the Docker project {entry["project"]}, '
            f'the memory volume {entry["volume"]}, which holds everything that agent remembers, and the folder '
            f'{entry["folder"]}, which holds that agent\'s Plow credential. None of it can be recovered.\n'
            f'Their Plow line {line_label(entry)} is not released by this, and keeps costing what it costs. Retire it '
            f'with plow-agents revoke {entry["line"]["uid"]} if you want it back.\n'
            f'Repeat the identifier to confirm: ./relay hosted remove {entry["person"]} '
            f'--confirm {entry["person"]}').lstrip()


def hosted_tokens(host):
    """Every token this host holds, read only to keep it out of a log.

    plow_tokens() knows the installed agent's credential and the account sign in. A hosted
    agent's credential is somewhere else, so it is added here rather than left to leak.
    """
    tokens = list(plow_agent.plow_tokens())
    # Read off the filesystem rather than the registry: a registry this tool could not read is one
    # of the things that lands here, and a log must still be scrubbed then.
    for credential in sorted((host.root / '.data/hosted/agents').glob('*/plow-credentials')):
        with contextlib.suppress(OSError, UnicodeError):
            tokens += [text.partition('=')[2].strip() for text in credential.read_text().splitlines()
                       if text.startswith('PLOW_AGENT_TOKEN=')]
    return [token for token in tokens if token]


def record_failure(host, error, path):
    """Append the traceback under a UTC timestamp, with every token on this host removed."""
    text = ''.join(traceback.format_exception(type(error), error, error.__traceback__))
    for token in hosted_tokens(host):
        text = text.replace(token, '[token removed]')
    registry.private_folder(path.parent)
    with os.fdopen(os.open(path, os.O_CREAT | os.O_APPEND | os.O_WRONLY, 0o600), 'a', encoding='utf-8') as log:
        log.write(f'=== {datetime.now(timezone.utc):%Y-%m-%dT%H:%M:%SZ} ===\n{text}\n')


def installer_wording(message, command):
    """plow_agent speaks in the installed agent's command, because that is the agent it was written for.

    An operator here who followed it would install an agent in agent/ on this machine rather than touch the one
    they asked about, so the message is passed on as it is and then read for them.
    """
    if INSTALLER not in message:
        return message
    return (f'{message}\nThat wording comes from the installer this tool reuses. {INSTALLER} installs an agent in '
            f'agent/ on this machine. For this person the command is {command}.')


def run_hosted(args, host=None):
    action = getattr(args, 'hosted_action', None)
    person_named = getattr(args, 'person', None)
    command = f'./relay hosted {action} {person_named}' if person_named else f'./relay hosted {action}'
    host = host or Host()
    try:
        plow_agent.trust_certifi()  # before any Plow call
        if action == 'list':
            return show(host)
        if action == 'status':
            return show(host, registry.safe_identifier(args.person))
        if action == 'start':
            return start(host, args)
        if action == 'stop':
            return stop(host, args)
        person = registry.safe_identifier(args.person)  # before any folder is made, for create and remove
        state = registry.private_folder(host.registry().parent)
        with plow_agent.exit_on_sigterm(), plow_agent.installation_lock(state / 'hosted.lock'):
            return create(host, args, person) if action == 'create' else remove(host, args, person)
    except AgentError as error:
        print(installer_wording(str(error), command), file=sys.stderr, flush=True)
        return error.code
    except KeyboardInterrupt:
        print('Stopped before finishing. Run the command again; it continues from what is already there.',
              file=sys.stderr, flush=True)
        return 1
    except Exception as error:
        log = host.registry().parent / 'hosted.log'
        try:
            record_failure(host, error, log)
            where = f'. Details: {log}.'
        except OSError:
            where = ' and the details could not be saved.'
        print(f'./relay hosted {action} stopped unexpectedly{where} Running it again is safe.',
              file=sys.stderr, flush=True)
        return 1
