#!/usr/bin/env python3
"""Bind an authorized Plow account to Relay without hand-written bridge JSON.

Uses the installation's pinned official plow-agents client. No messages are sent.
Credentials stay in owner-only files. Existing occupied lines are never replaced.
"""
import argparse
import contextlib
import io
import json
import os
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace
from bridge import BridgeError, JsonHTTP, private_credentials, from_config

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'relay-terminal'))
import private_files  # noqa: E402  (found next door, the way bridge.py finds it)

ROOT = Path(__file__).resolve().parents[2]
ORIGIN = 'https://api.plow.co'


def protect_or_stop(path):
    """Make a path private, or stop with the reason rather than a general failure."""
    try:
        private_files.protect(path)
    except private_files.PrivacyError as error:
        raise BridgeError(str(error)) from None


def write_private(path, body):
    """The client's private write, done the way this host makes a file private."""
    try:
        return private_files.write_privately(path, body)
    except private_files.PrivacyError as error:
        raise BridgeError(str(error)) from None


def official_client():
    tool = next((path for path in [ROOT / '.data/tools/plow-agents', ROOT / '.data/plow-agents/bin/plow-agents'] if path.is_file()), None)
    if tool is None:
        raise BridgeError('Install the pinned official plow-agents client using integrations/plow/README.md first.')
    client = runpy.run_path(str(tool))
    if private_files.windows():
        # The client writes with os.fchmod and a plain rename, neither of which Windows has
        # in the form it expects. run_path hands back a copy of its globals; its functions
        # read the original, so the replacement goes there.
        client['mint'].__globals__['write_private'] = write_private
    return client


def connect(line_id=None):
    official = official_client()
    # Official diagnostics are safe, but keep stdout machine-readable for the API.
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        try:
            account = official['account_token'](SimpleNamespace(token_file=None))
        except SystemExit:
            raise BridgeError('Sign in first: python3 .data/tools/plow-agents login') from None
        lines = official['account_lines'](ORIGIN, account)
    if line_id:
        lines = [line for line in lines if line['uid'] == line_id]
    if not lines:
        raise BridgeError('No assistant line on this account. Run python3 .data/tools/plow-agents login --new-line first.')
    if len(lines) != 1:
        raise BridgeError('Multiple assistant lines found. Run connect.py --line LINE_ID to select the intended one.')
    line = lines[0]
    credential = ROOT / '.data/plow-credentials'
    if not credential.exists():
        if line.get('agent_uid'):
            raise BridgeError('This line already has an agent. Relay will not replace it. Choose a free line or configure its existing credential.')
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            try:
                official['mint'](SimpleNamespace(line=line['uid'],credential_file=str(credential),token_file=None,api_base=ORIGIN,agent_api_base=ORIGIN))
            except SystemExit:
                raise BridgeError('Plow could not provision a credential. Inspect account lines before retrying.') from None
    client = JsonHTTP(ORIGIN, private_credentials(credential))
    _, identity = client.call('GET', '/v1/agents/cloud/me')
    if identity.get('line', {}).get('uid') != line['uid']:
        raise BridgeError('The saved credential belongs to another line. Existing configuration was preserved.')
    _, listing = client.call('GET', '/v1/chats')
    if listing.get('has_more') is not False:
        raise BridgeError('Incomplete chat grant. Existing configuration was preserved.')
    chats = []
    for chat in listing.get('data', []):
        participants = chat.get('participants', [])
        agents = [p for p in participants if p.get('type') == 'agent' and p.get('relationship') in (None, 'self') and p.get('line', {}).get('uid') == line['uid'] and p.get('line', {}).get('provider_type') == 'imessage']
        owners = [p for p in participants if p.get('type') == 'member' and p.get('role') == 'owner']
        if chat.get('status') == 'active' and len(participants) == 2 and len(agents) == len(owners) == 1:
            chats.append(chat)
    if len(chats) != 1:
        raise BridgeError('Exactly one authorized owner chat is required. Existing configuration was preserved.')
    config = {'relay_url':'http://127.0.0.1:8178', 'credentials_file':'../plow-credentials',
              'state_dir':'../plow-receipts', 'line_id':line['uid'], 'chat_id':chats[0]['uid'], 'actor':'Local maintainer'}
    directory = ROOT / '.data/plow'
    try:
        directory.mkdir(mode=0o700, parents=True)
    except FileExistsError:
        pass  # an existing folder keeps whatever the owner set on it
    else:
        protect_or_stop(directory)
    path = directory / 'bridge.json'
    if path.exists():
        previous = json.loads(path.read_text())
        if previous.get('line_id') != config['line_id'] or previous.get('chat_id') != config['chat_id']:
            raise BridgeError('A different line or chat is already configured. It was not overwritten.')
    else:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as output:
            json.dump(config, output, indent=2)
            output.flush()
            os.fsync(output.fileno())
        protect_or_stop(path)  # the mode above is ignored on Windows
    result = from_config(path).doctor()
    result['line_name'] = line.get('display_name') or identity.get('line', {}).get('display_name') or 'Plow assistant'
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--line')
    parser.add_argument('--login', action='store_true', help='Run official phone ownership verification before connecting.')
    parser.add_argument('--new-line', action='store_true', help='Explicitly request a new assistant line during login.')
    args = parser.parse_args()
    if args.new_line and not args.login:
        parser.error('--new-line requires --login')
    try:
        if args.login:
            official_client()['login'](SimpleNamespace(api_base=ORIGIN, token_file=None, new_line=args.new_line))
        print(json.dumps(connect(args.line)))
    except BridgeError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError):
        print('Could not connect automatically. Check account login, line ownership and the existing bridge configuration. No existing line was replaced.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
