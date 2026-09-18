"""What the operator created here: one private record per person, and the names Docker sees.

The registry is a record of what this tool did. It is not evidence that anything is
running: it holds no state that could go stale, and every command that talks about a
container asks Docker instead.
"""
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import unicodedata

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'integrations/relay-terminal'))
from plow_agent import AgentError, DecisionNeeded

ROOT = Path(__file__).resolve().parents[1]
IDENTIFIER = re.compile(r'[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?')
PREFIX = 'relay-hosted-'
VERSION = 1


def safe_identifier(value):
    """The identifier that names a person's folder, Compose project and memory volume.

    Anything else is refused with the identifier to use instead. Quietly renaming the
    person would mean the operator hands over one name and this host records another.
    """
    text = str(value or '')
    if IDENTIFIER.fullmatch(text):
        return text
    suggestion = derived(text)
    if not suggestion:
        raise DecisionNeeded(f'{text!r} has no letters or digits in it, so it cannot name a folder or a Docker '
                             'project. Give this person a short identifier such as dana or dana-whitfield.')
    raise DecisionNeeded(f'{text!r} is not a safe identifier: use lowercase letters, digits and dashes, at most 32 '
                         f'characters. Use {suggestion} instead, or another identifier you prefer.')


def derived(value):
    """The identifier a name would become, offered as a suggestion and never applied on its own."""
    plain = unicodedata.normalize('NFKD', str(value or '')).encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]', '-', plain)).strip('-')[:32].strip('-')


def project_name(person):
    """The Compose project for one person. The prefix keeps hosted agents apart from the installed one."""
    return PREFIX + person


def volume_name(project):
    """The memory volume Compose creates for a project, named as Compose itself names it."""
    return f'{project}_agent-home'


def folder_for(root, person):
    """One person's own folder: their Compose project's working directory and their credential's home."""
    return Path(root) / '.data/hosted/agents' / person


def registry_path(root):
    return Path(root) / '.data/hosted/registry.json'


def entry(person, name, project, folder, volume, line, created):
    """One record, built field by field, so nothing a caller happens to be holding reaches the file.

    Plow's line carries more than this. Only the three fields the operator needs to identify
    a line are kept, and a credential or token is never one of them.
    """
    return {'person': person, 'name': name, 'project': project, 'folder': str(folder), 'volume': volume,
            'line': {key: line.get(key) for key in ('uid', 'provider_key', 'display_name')},
            'created': created}


def read(path):
    """Every agent recorded here. A registry that cannot be read stops the command.

    Starting over from an empty registry would lose the record of agents that exist,
    and each one is a Plow line the operator is paying for.
    """
    path = Path(path)
    try:
        saved = json.loads(path.read_bytes())
    except FileNotFoundError:
        return {'version': VERSION, 'agents': {}}
    except (OSError, ValueError) as error:
        raise AgentError(f'The hosted agent registry {path} could not be read: {error}. Nothing was changed. '
                         'Inspect that file; this tool will not replace it.') from None
    if (not isinstance(saved, dict) or saved.get('version') != VERSION
            or not isinstance(saved.get('agents'), dict)):
        raise AgentError(f'The hosted agent registry {path} is not a registry this tool wrote (it needs version '
                         f'{VERSION} and an agents object). Nothing was changed. Inspect that file.')
    return saved


def write(path, data):
    """Replace the registry in one step, private to the operator, or leave the old one untouched."""
    path = Path(path)
    private_folder(path.parent)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.registry-', suffix='.json')
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(data, output, indent=2, sort_keys=True)
            output.write('\n')
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def private_folder(path):
    """Create a folder and its missing parents owner only, and keep this one owner only on every write.

    Folders above it that were already there are left as they are: .data holds the installed agent's
    state too, and this tool does not change the modes of a folder it did not create. The folder named
    here is this tool's own, so a loosened one is made private again rather than used as it is.
    """
    path = Path(path)
    missing = [folder for folder in (path, *path.parents) if not folder.exists()]
    path.mkdir(parents=True, exist_ok=True)
    for folder in missing:
        os.chmod(folder, 0o700)
    if path.exists():
        os.chmod(path, 0o700)
    return path


def record(path, agent):
    """Note one person's agent. Recording the same person again replaces that record only."""
    data = read(path)
    data['agents'][agent['person']] = agent
    write(path, data)


def forget(path, person):
    """Remove one person's record. A person who is not recorded leaves the file untouched."""
    data = read(path)
    if data['agents'].pop(person, None) is None:
        return False
    write(path, data)
    return True


def find(path, person):
    """One person's record, or None."""
    return read(path)['agents'].get(person)
