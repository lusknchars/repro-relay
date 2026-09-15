"""Call-link state and durable local receipts. No Discord SDK or audio handling."""
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid


def snowflake(value):
    return isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{15,19}', value) is not None and int(value) < 2**64


def validate_config(value):
    if not isinstance(value, dict) or set(value) != {'token', 'guild_id', 'operator_ids', 'case_ids', 'public_url'}:
        raise ValueError('Configure the Discord call bot first.')
    if not isinstance(value['token'], str) or not re.fullmatch(r'[!-~]{20,4096}', value['token']):
        raise ValueError('Invalid bot token.')
    if not snowflake(value['guild_id']): raise ValueError('Invalid server ID.')
    if not isinstance(value['operator_ids'], list) or not 1 <= len(value['operator_ids']) <= 50 or not all(snowflake(v) for v in value['operator_ids']):
        raise ValueError('Choose 1–50 authorized Discord user IDs.')
    if not isinstance(value['case_ids'], list) or not 1 <= len(value['case_ids']) <= 100 or not all(isinstance(v, str) and re.fullmatch(r'RR-[a-f0-9]{32}', v) for v in value['case_ids']):
        raise ValueError('Choose 1–100 existing Repro work IDs.')
    if not isinstance(value['public_url'], str) or not re.fullmatch(r'[^\s<>]{1,2048}', value['public_url']):
        raise ValueError('Invalid Repro URL.')
    parsed = urllib.parse.urlsplit(value['public_url'])
    if (parsed.scheme != 'https' and not (parsed.scheme == 'http' and parsed.hostname in {'localhost', '127.0.0.1'})) or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('Use a Repro HTTPS origin, or a localhost URL for this computer only.')
    return value


def authorized(config, guild_id, user_id, case_id=None):
    return str(guild_id) == config['guild_id'] and str(user_id) in config['operator_ids'] and (case_id is None or case_id in config['case_ids'])


def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as output:
            temporary = output.name
            os.chmod(temporary, 0o600)
            json.dump(value, output)
            output.flush(); os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if temporary and os.path.exists(temporary): os.unlink(temporary)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None


class Relay:
    def __init__(self, origin='http://127.0.0.1:8178'):
        if origin != 'http://127.0.0.1:8178': raise ValueError('The call bot only connects to its trusted local Repro service.')
        self.origin = origin
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, method, path, value=None):
        request = urllib.request.Request(self.origin + '/api/v1' + path, method=method,
            headers={'Content-Type': 'application/json'}, data=json.dumps(value).encode() if value is not None else None)
        try:
            with self.opener.open(request, timeout=10) as response:
                raw = response.read(524289)
            if len(raw) > 524288: raise ValueError('Response too large')
            return json.loads(raw)
        except (OSError, ValueError):
            raise ValueError('Repro did not confirm the request. Check the local app and saved work ID.') from None

    def check_case(self, case):
        if not re.fullmatch(r'RR-[a-f0-9]{32}', case): raise ValueError('Invalid work ID.')
        value = self.request('GET', '/cases/' + case)
        if value.get('id') != case: raise ValueError('Repro returned a different work record.')

    def record(self, event):
        return self.request('POST', '/cases/' + event['case_id'] + '/discord-calls', event['body'])


class Store:
    def __init__(self, path):
        self.path = Path(path)
        if self.path.is_symlink(): raise ValueError('Refusing a linked call-state file.')
        if self.path.exists() and self.path.stat().st_size > 2_000_000: raise ValueError('Call state exceeds its limit.')
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {'active': None, 'outbox': []}
        if not isinstance(self.data, dict) or set(self.data) != {'active', 'outbox'} or not isinstance(self.data['outbox'], list):
            raise ValueError('Invalid call state. Preserve it and inspect the local installation.')

    def save(self): private_write(self.path, self.data)

    def event(self, call, status):
        if len(self.data['outbox']) >= 1000: raise ValueError('Call receipt queue is full. Reconnect Repro before joining another call.')
        self.data['outbox'].append({'case_id': call['case_id'], 'body': {
            'id': str(uuid.uuid4()), 'call_id': call['call_id'], 'guild_id': call['guild_id'],
            'channel_id': call['channel_id'], 'actor_id': call['actor_id'], 'status': status}})
        self.save()

    def recover(self):
        if self.data['active']:
            self.event(self.data['active'], 'disconnected')
            self.data['active'] = None
            self.save()

    def flush(self, relay, limit=10):
        for _ in range(min(limit, len(self.data['outbox']))):
            relay.record(self.data['outbox'][0])
            self.data['outbox'].pop(0)
            self.save()
