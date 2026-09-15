import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/relay-reach/scripts/tasks.py'


class TaskFlow(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.payload = dict(source_id='meeting-1', source_text='Ana will review export on Friday.',
                            items=[dict(title='Review export', owner='Ana', role='Reviewer',
                                        due='2026-09-18', source_quote='Ana will review export')])
        self.file = self.home / 'input.json'

    def call(self, *args, scope='team-a', success=True):
        result = subprocess.run([sys.executable, str(SCRIPT), '--scope', scope, *args],
                                env={**os.environ, 'HERMES_HOME': str(self.home)},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if success else 1, result.stderr)
        return json.loads(result.stdout if success else result.stderr)

    def save(self, success=True):
        self.file.write_text(json.dumps(self.payload))
        return self.call('import', str(self.file), success=success)

    def test_persists_replays_and_updates_without_duplicate(self):
        saved = self.save()['tasks'][0]
        again = self.save()
        self.assertTrue(again['replayed'])
        self.assertEqual(again['tasks'][0]['id'], saved['id'])
        self.call('update', saved['id'], '--status', 'done')
        self.assertEqual(self.call('list')['tasks'], [])
        self.assertEqual(self.call('list', '--all')['tasks'][0]['status'], 'done')
        self.call('update', saved['id'], '--status', 'open', '--clear-owner', '--clear-due')
        self.assertIsNone(self.call('list')['tasks'][0]['due'])
        mode = (self.home / 'relay-reach/tasks.sqlite3').stat().st_mode & 0o777
        self.assertEqual(mode, 0o600)

    def test_conversation_boundary(self):
        task = self.save()['tasks'][0]
        self.assertEqual(self.call('list', scope='team-b')['tasks'], [])
        self.call('update', task['id'], '--status', 'done', scope='team-b', success=False)
        self.assertEqual(self.call('list')['tasks'][0]['status'], 'open')

    def test_evidence_and_changed_retry_rejected_atomically(self):
        self.save()
        self.payload['items'][0]['owner'] = 'Another person'
        self.save(success=False)
        self.assertEqual(self.call('list')['tasks'][0]['owner'], 'Ana')
        self.payload['source_id'] = 'meeting-2'
        self.payload['items'].append(dict(title='Invented', source_quote='Never said'))
        self.save(success=False)
        self.assertEqual(len(self.call('list')['tasks']), 1)

    def test_dates_and_filters(self):
        self.save()
        self.assertEqual(self.call('list', '--through', '2026-09-17')['tasks'], [])
        self.assertEqual(len(self.call('list', '--through', '2026-09-18', '--owner', 'Ana')['tasks']), 1)
        self.call('list', '--through', '2026-02-30', success=False)
        self.payload['source_id'] = 'meeting-2'
        self.payload['items'][0]['due'] = 'Friday'
        self.save(success=False)


if __name__ == '__main__':
    unittest.main()
