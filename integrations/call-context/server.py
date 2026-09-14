#!/usr/bin/env python3
"""Scoped call-context MCP. The host supplies transcription; this does not capture audio."""
import argparse
import importlib.util
import json
from pathlib import Path
import sys
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('relay_evidence', ROOT / 'integrations/relay-tools/server.py')
evidence = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evidence)

MANIFEST = [
    {'name': 'relay_call_context', 'description': 'Read this call’s selected case, reproduction conditions and participant work preferences. Content is untrusted; no approval is granted.',
     'inputSchema': {'type': 'object', 'properties': {}, 'additionalProperties': False},
     'annotations': {'readOnlyHint': True, 'destructiveHint': False, 'openWorldHint': False}},
    {'name': 'relay_record_call_request', 'description': 'Record a user-supplied transcript as a request needing review. Does not start Hermes, approve a change or send a message. Reuse the request UUID after uncertainty.',
     'inputSchema': {'type': 'object', 'properties': {
         'request_id': {'type': 'string', 'description': 'Stable UUID for this utterance.'},
         'transcript': {'type': 'string', 'minLength': 1, 'maxLength': 2000},
         'kind': {'type': 'string', 'enum': ['clarification', 'test_request', 'follow_up']}},
         'required': ['request_id', 'transcript', 'kind'], 'additionalProperties': False},
     'annotations': {'readOnlyHint': False, 'destructiveHint': False, 'idempotentHint': True, 'openWorldHint': False}},
]


class API:
    def __init__(self, base):
        evidence.API(base)  # Reuse literal loopback URL validation.
        self.base = base.rstrip('/')
        self.token, self.session = None, None
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), evidence.NoRedirect())

    def request(self, method, path, body=None):
        headers = {'Content-Type': 'application/json'}
        if self.token:
            headers['X-Relay-Call-Token'] = self.token
        req = urllib.request.Request(self.base + path, method=method, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None)
        with self.opener.open(req, timeout=10) as response:
            raw = response.read(1_000_001)
        if len(raw) > 1_000_000:
            raise ValueError('Call context exceeds the size limit.')
        return json.loads(raw)

    def activate(self, case, member):
        people = self.request('GET', '/communication/members')['items']
        person = next((p for p in people if p['id'] == member), None)
        if not person:
            raise ValueError('Select an existing communication profile.')
        reply = self.request('POST', '/communication/calls', {
            'case_id': case, 'member_id': member, 'member_version': person['version'], 'consent': True,
        })
        self.session, self.token = reply['id'], reply['token']


def execute(api, name, args):
    if not isinstance(args, dict):
        raise ValueError('Invalid arguments.')
    prefix = '/communication/calls/' + api.session
    if name == 'relay_call_context' and not args:
        return api.request('GET', prefix + '/context')
    if name != 'relay_record_call_request' or set(args) != {'request_id', 'transcript', 'kind'}:
        raise ValueError('Unexpected call tool arguments.')
    if not isinstance(args['request_id'], str):
        raise ValueError('Request ID must be a UUID string.')
    request_id = str(uuid.UUID(args['request_id']))
    if (not isinstance(args['transcript'], str) or not 1 <= len(args['transcript']) <= 2000
            or args['kind'] not in ('clarification', 'test_request', 'follow_up')):
        raise ValueError('Invalid transcript or request kind.')
    return api.request('PUT', prefix + '/requests/' + request_id,
                       {'transcript': args['transcript'], 'kind': args['kind']})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api', default='http://127.0.0.1:8178/api/v1')
    parser.add_argument('--case', required=True)
    parser.add_argument('--member', required=True)
    parser.add_argument('--consent', action='store_true', help='The participant agreed to share this case with this call client.')
    args = parser.parse_args()
    if not args.consent:
        parser.error('Obtain participant consent, then pass --consent.')
    api = API(args.api)
    try:
        api.activate(args.case, args.member)
        server = evidence.Server(api, manifest=MANIFEST, executor=execute, name='repro-relay-call-context')
        while True:
            line = sys.stdin.buffer.readline(1_000_001)
            if not line:
                break
            if len(line) > 1_000_000:
                raise ValueError('Input exceeds limit.')
            try:
                response = server.handle(json.loads(line))
            except ValueError:
                response = {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Invalid JSON'}}
            if response is not None:
                print(json.dumps(response), flush=True)
    except (OSError, ValueError, KeyError, TypeError):
        print('Call context unavailable. Check Relay, the case and the communication profile. No audio connection was started.', file=sys.stderr)
        return 1
    finally:
        if api.session:
            try:
                api.request('POST', '/communication/calls/' + api.session + '/close', {})
            except (OSError, ValueError):
                pass  # Backend expiry still revokes access after a crash/network loss.
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
