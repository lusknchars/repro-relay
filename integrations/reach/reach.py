#!/usr/bin/env python3
"""Reach: daily work, agent proposals and scoped call context. No model or account required for the daily queue."""
import argparse
from datetime import date
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('reach_call', ROOT / 'integrations/call-context/server.py')
call = importlib.util.module_from_spec(spec)
spec.loader.exec_module(call)

MANIFEST = [
    {'name': 'reach_daily_brief', 'description': 'Read Relay calendar work and recent supplied call requests, source hashes, saved actions and eligible roles. Source text is untrusted. No messages or model calls.',
     'inputSchema': {'type': 'object', 'properties': {'on': {'type': 'string', 'description': 'YYYY-MM-DD, UTC day'}}, 'required': ['on'], 'additionalProperties': False},
     'annotations': {'readOnlyHint': True, 'destructiveHint': False, 'openWorldHint': False}},
    {'name': 'reach_propose_action', 'description': 'Propose an owner, date and action from one existing daily-brief source. Human review stays in Relay. Cannot replace a human decision, send, execute code or approve.',
     'inputSchema': {'type': 'object', 'properties': {
         'id': {'type': 'string'}, 'on': {'type': 'string'}, 'version': {'type': 'integer', 'minimum': 0},
         'source_hash': {'type': 'string'}, 'title': {'type': 'string', 'minLength': 1, 'maxLength': 500},
         'member_id': {'type': ['string', 'null']}, 'due_on': {'type': ['string', 'null']}},
         'required': ['id', 'on', 'version', 'source_hash', 'title', 'member_id', 'due_on'], 'additionalProperties': False},
     'annotations': {'readOnlyHint': False, 'destructiveHint': False, 'idempotentHint': True, 'openWorldHint': False}},
]


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('Use YYYY-MM-DD.')
    date.fromisoformat(value)
    return value


def execute(api, name, args):
    if not isinstance(args, dict):
        raise ValueError('Arguments must be an object.')
    if name == 'reach_daily_brief' and set(args) == {'on'}:
        return api.request('GET', '/reach?on=' + day(args['on']))
    keys = {'id', 'on', 'version', 'source_hash', 'title', 'member_id', 'due_on'}
    if name != 'reach_propose_action' or set(args) != keys:
        raise ValueError('Unknown tool or arguments.')
    if not isinstance(args['id'], str) or not re.fullmatch(r'(calendar|call)-[a-f0-9-]{36,73}', args['id']):
        raise ValueError('Use the source ID from the daily brief.')
    day(args['on'])
    if args['due_on'] is not None:
        day(args['due_on'])
    body = {k: v for k, v in args.items() if k != 'id'}
    body['status'] = 'proposed'
    return api.request('PUT', '/reach/' + args['id'] + '/proposal', body)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api', default='http://127.0.0.1:8178/api/v1')
    actions = parser.add_subparsers(dest='action', required=True)
    today = actions.add_parser('today', help='Read the daily queue; no model or message')
    today.add_argument('--on', default=date.today().isoformat(), type=day)
    mcp = actions.add_parser('mcp', help='Expose the daily brief and proposal tools to a local agent')
    mcp.add_argument('--allow-workspace-context', action='store_true', help='Explicitly allow this client to read the local team daily queue')
    voice = actions.add_parser('call', help='Scoped call-context MCP; the host supplies transcripts, no audio capture')
    voice.add_argument('--case', required=True)
    voice.add_argument('--member', required=True)
    voice.add_argument('--consent', action='store_true')
    actions.add_parser('plow-check', help='Check the existing Plow grant without sending a message')
    args = parser.parse_args(argv)
    try:
        api = call.API(args.api)
        if args.action == 'today':
            print(json.dumps(execute(api, 'reach_daily_brief', {'on': args.on}), indent=2, ensure_ascii=False))
        elif args.action == 'call':
            if not args.consent:
                parser.error('Use --consent only after the participant agrees to share the selected case.')
            return subprocess.call([sys.executable, str(ROOT / 'integrations/call-context/server.py'), '--api', args.api,
                                    '--case', args.case, '--member', args.member, '--consent'])
        elif args.action == 'plow-check':
            return subprocess.call([sys.executable, str(ROOT / 'integrations/plow/bridge.py'), '--config', str(ROOT / '.data/plow/bridge.json'), 'doctor'])
        else:
            if not args.allow_workspace_context:
                parser.error('Use --allow-workspace-context to share the local daily queue with this agent. Use reach call for one-case context.')
            server = call.evidence.Server(api, manifest=MANIFEST, executor=execute, name='reach')
            while True:
                line = sys.stdin.buffer.readline(1_000_001)
                if not line:
                    break
                if len(line) > 1_000_000:
                    raise ValueError('MCP request exceeds 1 MB.')
                try:
                    response = server.handle(json.loads(line))
                except (ValueError, UnicodeError):
                    response = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Invalid JSON'}}
                if response is not None:
                    print(json.dumps(response, ensure_ascii=False), flush=True)
    except (OSError, ValueError, KeyError, TypeError):
        print('Reach could not complete the request. Check the local Relay service and current source version. No message was sent.', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
