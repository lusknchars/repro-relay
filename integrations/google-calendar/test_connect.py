import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.parse
import urllib.request

spec = importlib.util.spec_from_file_location('google_calendar', Path(__file__).with_name('connect.py'))
calendar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(calendar)


class CalendarTests(unittest.TestCase):
    def test_event_times_and_exclusive_end(self):
        event = {'id': 'one', 'summary': 'Review', 'start': {'date': '2026-09-14'}, 'end': {'date': '2026-09-16'}}
        self.assertEqual(calendar.normalize(event)['pin']['ends_on'], '2026-09-15')
        event.update(start={'dateTime': '2026-09-14T23:30:00-03:00'}, end={'dateTime': '2026-09-15T00:30:00-03:00'})
        self.assertEqual(calendar.normalize(event)['pin']['starts_on'], '2026-09-15')
        event['status'] = 'cancelled'
        self.assertIsNone(calendar.normalize(event))

    def test_pkce_state_and_private_credential(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'client.json').write_text(json.dumps({'installed': {'client_id': 'test.apps.googleusercontent.com'}}))
            opened = []
            callbacks = []

            def browser(url):
                params = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
                opened.append(params)
                def send():
                    redirect = params['redirect_uri'][0]
                    try:
                        urllib.request.urlopen(redirect + '?state=wrong&code=bad', timeout=5)
                    except urllib.error.HTTPError as e:
                        callbacks.append(e.code)
                    with urllib.request.urlopen(redirect + '?' + urllib.parse.urlencode({'state': params['state'][0], 'code': 'correct-code'}), timeout=5) as r:
                        callbacks.append(r.status)
                thread = threading.Thread(target=send)
                thread.start()
                return True

            def exchange(url, data):
                self.assertEqual(data['code'], 'correct-code')
                self.assertGreaterEqual(len(data['code_verifier']), 43)
                self.assertEqual(opened[0]['code_challenge_method'], ['S256'])
                self.assertNotEqual(opened[0]['code_challenge'][0], data['code_verifier'])
                return {'refresh_token': 'private-test-value', 'access_token': 'not-persisted', 'scope': calendar.SCOPE}

            with patch.object(calendar.webbrowser, 'open', browser), patch.object(calendar, 'request', exchange):
                self.assertTrue(calendar.connect(directory)['authorized'])
            token_path = directory / 'tokens.json'
            self.assertEqual(token_path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn('not-persisted', token_path.read_text())
            self.assertEqual(callbacks, [400, 200])

    def test_pagination_is_bounded_and_marked_incomplete(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'client.json').write_text(json.dumps({'installed': {'client_id': 'test.apps.googleusercontent.com'}}))
            (directory / 'tokens.json').write_text(json.dumps({'refresh_token': 'test', 'client_id': 'test.apps.googleusercontent.com'}))
            replies = [{'access_token': 'test'}] + [{'items': [], 'nextPageToken': 'next'}] * 4
            with patch.object(calendar, 'request', side_effect=replies) as remote:
                result = calendar.events(directory, '2026-09-01', '2026-09-30')
                self.assertTrue(result['truncated'])
                self.assertEqual(remote.call_count, 5)


if __name__ == '__main__':
    unittest.main()
