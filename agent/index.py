#!/usr/bin/env python3
"""Run the pinned official Agent Index client for one local Hermes installation."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent / 'integrations/relay-terminal'))
import private_files  # noqa: E402  (found in the repository, beside the installer that writes these files)

# Named by the environment so one host can run several agents, defaulting to the
# single installed agent's id when nobody says otherwise.
AGENT_ID = os.environ.get('AGENT_ID', 'repro-relay')
REPO = 'https://github.com/lusknchars/repro-relay'
# The listing embeds YouTube, so the client takes a bare video ID and rejects a URL.
VIDEO = 'Q_BjDQ6bw68'


def credentials(path):
    """The agent token, read only from a file this account alone can reach.

    What that means is asked of the host rather than assumed: mode bits on POSIX, the
    file's access list on Windows, where a mode of 0600 is not kept and never was proof.
    """
    with private_files.open_private(path) as file:
        info = os.fstat(file.fileno())
        if not stat.S_ISREG(info.st_mode) or not private_files.is_private(path, info):
            raise ValueError('credential file must be readable by you alone. Run '
                             + private_files.how_to_protect(path) + ' and try again')
        raw = file.read(16385)
    if len(raw) > 16384:
        raise ValueError('credential file is too large')
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError('credential file is not UTF-8 text') from None
    found = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        key, sep, value = line.partition('=')
        if not sep or key not in ('PLOW_API_BASE', 'PLOW_AGENT_TOKEN', 'AGENT_ID') or key in found:
            raise ValueError('unexpected credential format')
        values = shlex.split(value, comments=True)
        if len(values) != 1:
            raise ValueError('unexpected credential value')
        found[key] = values[0]
    if found.get('PLOW_API_BASE') != 'https://api.plow.co' or not found.get('PLOW_AGENT_TOKEN'):
        raise ValueError('expected a Plow agent token for https://api.plow.co')
    return {key: found[key] for key in ('PLOW_API_BASE', 'PLOW_AGENT_TOKEN')}


def client(home):
    pin = dict(line.split('=', 1) for line in (ROOT / 'vendor/client.pin').read_text().splitlines()
               if line and not line.startswith('#'))
    if not re.fullmatch('[0-9a-f]{40}', pin['sha']) or pin['path'] != 'standalone/agent_index_client.py':
        raise ValueError('invalid client pin')
    cache = home / '.relay-index-client'
    private_files.make_private_directory(cache)
    dest = cache / (pin['sha'] + '.py')
    if dest.exists():
        data = dest.read_bytes()
    else:
        url = f"https://raw.githubusercontent.com/plow-pbc/agent-index-client/{pin['sha']}/{pin['path']}"
        with urllib.request.urlopen(url, timeout=60) as response:
            data = response.read(1000001)
    if hashlib.sha256(data).hexdigest() != pin['sha256']:
        raise ValueError('official client checksum mismatch')
    if not dest.exists():
        fd, name = tempfile.mkstemp(dir=cache)
        try:
            with os.fdopen(fd, 'wb') as file:
                file.write(data)
            private_files.replace_atomically(name, dest)
        finally:
            if os.path.exists(name):
                os.unlink(name)
    return dest


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['register', 'status', 'report', 'dry-run'])
    parser.add_argument('--hermes-home', type=Path, required=True)
    parser.add_argument('--credentials', type=Path)
    args = parser.parse_args(argv)
    try:
        home = args.hermes_home.resolve(strict=True)
        if not (home / 'state.db').is_file():
            raise ValueError('Hermes home must contain the actual state.db')
        env = {'HOME': str(home), 'HERMES_HOME': str(home), 'AGENT_ID': AGENT_ID,
               'PATH': '/usr/bin:/bin:/usr/local/bin', 'PYTHONUNBUFFERED': '1'}
        command = [sys.executable, str(client(home))]
        if args.action == 'register':
            if not args.credentials:
                raise ValueError('register requires --credentials pointing to your private Plow file')
            env.update(credentials(args.credentials))
            command += ['--register', '--agent', AGENT_ID, '--name', 'Repro Relay',
                        '--blurb', 'An engineering agent on your own Plow line: saves tasks with owners and source quotes from meeting notes, and digests technical talks in your browser.',
                        '--repo', REPO, '--runtime', 'Hermes', '--install-url', REPO + '/tree/main/agent',
                        '--video', VIDEO]
        elif args.action == 'status':
            command += ['status']
        else:
            # Upstream also detects globally installed agentsview. Refuse mixed
            # attribution rather than publishing unrelated coding-agent usage.
            paths = [home / '.local/bin/agentsview', Path('/opt/homebrew/bin/agentsview'),
                     Path('/usr/local/bin/agentsview')]
            if any(os.access(path, os.X_OK) for path in paths):
                raise ValueError('agentsview is installed; use the isolated image reporter to avoid mixed usage')
            command += ['--agent', AGENT_ID]
            if args.action == 'dry-run':
                command += ['--dry-run']
        return subprocess.run(command, env=env, timeout=180).returncode
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(str(error) if isinstance(error, ValueError) else type(error).__name__, file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
