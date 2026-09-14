#!/usr/bin/env python3
"""Google Calendar for one trusted local workspace. Credentials never reach the UI."""
import argparse
import base64
import datetime as dt
import hashlib
import http.server
import json
import os
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[2]
DIRECTORY = ROOT / '.data/google-calendar'
SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def request(url, data=None, token=None):
    headers = {'Authorization': 'Bearer ' + token} if token else {}
    if data is not None:
        data = urllib.parse.urlencode(data).encode()
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    req = urllib.request.Request(url, data=data, headers=headers)
    opener = urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(req, timeout=15) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Google response exceeds the size limit.')
        return json.loads(raw)
    except urllib.error.HTTPError as error:
        if error.code in (400, 401):
            raise ValueError('Google authorization expired or was rejected. Reconnect Calendar.') from None
        raise ValueError('Google Calendar request failed (HTTP %s). Check API access and quota.' % error.code) from None


def write_private(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as file:
            json.dump(value, file)
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def client(directory):
    try:
        value = json.loads((directory / 'client.json').read_text())['installed']
        if not isinstance(value['client_id'], str) or not value['client_id'].endswith('.apps.googleusercontent.com'):
            raise ValueError()
        return value
    except (OSError, KeyError, ValueError, TypeError):
        raise ValueError('Save a Google Desktop app OAuth client as .data/google-calendar/client.json first.') from None


def connect(directory):
    config = client(directory)
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    result = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass  # Authorization codes must not enter access logs.

        def do_GET(self):
            parsed = urllib.parse.urlsplit(self.path)
            params = urllib.parse.parse_qs(parsed.query)
            valid = parsed.path == '/' and params.get('state') == [state]
            if valid and (len(params.get('code', [])) == 1 or 'error' in params):
                result.update(code=params.get('code', [None])[0])
            self.send_response(200 if valid else 400)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            self.wfile.write(b'Return to Relay to check the connection.' if valid else b'Invalid authorization state.')

    with http.server.HTTPServer(('127.0.0.1', 0), Callback) as server:
        server.timeout = 1
        redirect = 'http://127.0.0.1:%s/' % server.server_port
        url = 'https://accounts.google.com/o/oauth2/v2/auth?' + urllib.parse.urlencode({
            'client_id': config['client_id'], 'redirect_uri': redirect, 'response_type': 'code',
            'scope': SCOPE, 'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256',
            'access_type': 'offline', 'prompt': 'consent',
        })
        if not webbrowser.open(url):
            raise ValueError('Could not open the system browser. Run the Calendar connect command in your local terminal.')
        deadline = time.monotonic() + 180
        while not result and time.monotonic() < deadline:
            server.handle_request()
    if not result.get('code'):
        raise ValueError('Google connection cancelled or timed out. You can try again.')
    tokens = request('https://oauth2.googleapis.com/token', {
        'code': result['code'], 'client_id': config['client_id'], 'client_secret': config.get('client_secret', ''),
        'redirect_uri': redirect, 'grant_type': 'authorization_code', 'code_verifier': verifier,
    })
    if not tokens.get('refresh_token') or SCOPE not in tokens.get('scope', '').split():
        raise ValueError('Calendar permission was not granted. Reconnect and allow read access.')
    # Only the refresh credential is persisted, scoped to this OAuth client.
    write_private(directory / 'tokens.json', {'refresh_token': tokens['refresh_token'], 'client_id': config['client_id']})
    return {'authorized': True}


def normalize(event):
    if event.get('status') == 'cancelled':
        return None
    start, end = event.get('start', {}), event.get('end', {})
    if start.get('date') and end.get('date'):
        first = dt.date.fromisoformat(start['date'])
        last = dt.date.fromisoformat(end['date']) - dt.timedelta(days=1)
        timing = 'All day'
    else:
        a = dt.datetime.fromisoformat(start['dateTime'].replace('Z', '+00:00'))
        b = dt.datetime.fromisoformat(end['dateTime'].replace('Z', '+00:00'))
        if a.tzinfo is None or b.tzinfo is None or b <= a:
            raise ValueError('Invalid Google event times.')
        first = a.astimezone(dt.timezone.utc).date()
        last = (b.astimezone(dt.timezone.utc) - dt.timedelta(microseconds=1)).date()
        timing = a.isoformat() + ' to ' + b.isoformat()
    return {'id': 'google:' + event['id'], 'version': 0, 'source': 'google', 'pin': {
        'title': (event.get('summary') or 'Busy')[:160], 'starts_on': str(first), 'ends_on': str(last),
        'category': 'google', 'status': 'recorded', 'notes': timing, 'case_id': None,
    }}


def events(directory, start, end):
    first, last = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    if not 0 <= (last - first).days <= 62:
        raise ValueError('Choose a calendar range of up to 63 days.')
    config = client(directory)
    try:
        tokens = json.loads((directory / 'tokens.json').read_text())
    except (OSError, ValueError):
        raise ValueError('Connect Google Calendar first.') from None
    if tokens.get('client_id') != config['client_id']:
        raise ValueError('Google client changed. Reconnect Calendar.')
    access = request('https://oauth2.googleapis.com/token', {
        'client_id': config['client_id'], 'client_secret': config.get('client_secret', ''),
        'refresh_token': tokens['refresh_token'], 'grant_type': 'refresh_token',
    })['access_token']
    query = {'timeMin': start + 'T00:00:00Z', 'timeMax': str(last + dt.timedelta(days=1)) + 'T00:00:00Z',
             'singleEvents': 'true', 'orderBy': 'startTime', 'maxResults': 250,
             'fields': 'nextPageToken,items(id,summary,status,start,end)'}
    items, page = [], None
    for _ in range(4):
        if page:
            query['pageToken'] = page
        data = request('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + urllib.parse.urlencode(query), token=access)
        for event in data.get('items', []):
            item = normalize(event)
            if item:
                items.append(item)
        page = data.get('nextPageToken')
        if not page:
            break
    return {'items': items, 'truncated': bool(page), 'timezone': 'UTC', 'fetched_at': dt.datetime.now(dt.timezone.utc).isoformat()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['connect', 'status', 'events', 'disconnect'])
    parser.add_argument('--from', dest='start')
    parser.add_argument('--to', dest='end')
    args = parser.parse_args()
    try:
        if args.command == 'connect':
            result = connect(DIRECTORY)
        elif args.command == 'status':
            try:
                client(DIRECTORY)
                configured = True
            except ValueError:
                configured = False
            result = {'configured': configured, 'authorized': configured and (DIRECTORY / 'tokens.json').is_file()}
        elif args.command == 'disconnect':
            (DIRECTORY / 'tokens.json').unlink(missing_ok=True)
            result = {'authorized': False}
        else:
            result = events(DIRECTORY, args.start, args.end)
        print(json.dumps(result))
    except (OSError, ValueError, KeyError, TypeError):
        # No provider body, URL, token or traceback reaches API logs.
        print(json.dumps({'error': 'Calendar request failed. Check the OAuth client, Calendar permission, network, or reconnect.'}))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
