import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'skills/relay-setup/scripts/setup.py'


class SetupRecord(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.file = self.home / 'relay-setup/relay-setup.json'

    def call(self, *args, success=True):
        result = subprocess.run([sys.executable, str(SCRIPT), *args],
                                env={**os.environ, 'HERMES_HOME': str(self.home)},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0 if success else 1, result.stderr)
        return json.loads(result.stdout if success else result.stderr)

    def test_an_answer_is_recorded_and_read_back(self):
        self.assertEqual(self.call('show'), dict(owner=None, language=None, updated=None, items=[]))
        saved = self.call('record', '--topic', 'imessage', '--state', 'available',
                          '--wanted', 'yes', '--evidence', 'plow_list_skills listed imessage')
        self.assertTrue(saved['saved'])
        item = self.call('show')['items'][0]
        self.assertEqual(item['topic'], 'imessage')
        self.assertEqual(item['state'], 'available')
        self.assertIs(item['wanted'], True)
        self.assertEqual(item['evidence'], 'plow_list_skills listed imessage')
        self.assertTrue(item['checked'].startswith('20'))

    def test_a_second_answer_updates_its_topic_and_keeps_the_others(self):
        self.call('record', '--topic', 'imessage', '--state', 'available', '--wanted', 'yes')
        self.call('record', '--topic', 'github', '--state', 'needs_owner', '--wanted', 'yes',
                  '--evidence', 'gh auth status exited 1')
        first = self.call('show')
        self.call('record', '--topic', 'github', '--state', 'available',
                  '--evidence', 'gh auth status exited 0')
        record = self.call('show')
        self.assertEqual([item['topic'] for item in record['items']], ['imessage', 'github'])
        self.assertEqual(record['items'][1]['state'], 'available')
        self.assertEqual(record['items'][1]['evidence'], 'gh auth status exited 0')
        self.assertIs(record['items'][1]['wanted'], True)
        self.assertNotEqual(record['updated'], first['updated'])

    def test_an_unasked_question_is_null_until_it_is_answered(self):
        self.call('record', '--topic', 'whatsapp-history', '--state', 'available')
        self.assertIsNone(self.call('show')['items'][0]['wanted'])
        self.assertIsNone(self.call('show')['items'][0]['evidence'])
        self.call('record', '--topic', 'whatsapp-history', '--state', 'available', '--wanted', 'no')
        self.assertIs(self.call('show')['items'][0]['wanted'], False)

    def test_the_owner_and_their_language_are_kept_with_the_items(self):
        self.call('record', '--topic', 'contacts', '--state', 'available')
        self.call('owner', '--name', 'Ana', '--language', 'Portuguese')
        record = self.call('show')
        self.assertEqual((record['owner'], record['language']), ('Ana', 'Portuguese'))
        self.assertEqual(len(record['items']), 1)
        self.call('owner', '--name', 'Ana Paula')
        self.assertEqual(self.call('show')['language'], 'Portuguese')

    def test_a_topic_is_a_short_slug(self):
        for topic in ['', 'a' * 41, 'GitHub', 'google workspace', 'repo/relay', 'café']:
            failure = self.call('record', '--topic', topic, '--state', 'available', success=False)
            self.assertIn('topic', failure['error'])
            self.assertFalse(failure['saved'])
        self.call('record', '--topic', 'a' * 40, '--state', 'available')
        self.assertEqual(len(self.call('show')['items']), 1)

    def test_a_state_is_one_of_the_three_words(self):
        failure = self.call('record', '--topic', 'github', '--state', 'maybe', success=False)
        self.assertIn('state', failure['error'])
        for state in ['available', 'needs_owner', 'unavailable']:
            self.call('record', '--topic', 'github', '--state', state)
        self.assertEqual(self.call('show')['items'][0]['state'], 'unavailable')

    def test_evidence_is_one_sentence(self):
        failure = self.call('record', '--topic', 'github', '--state', 'available',
                            '--evidence', 'word ' * 61, success=False)
        self.assertIn('evidence', failure['error'])
        self.assertEqual(self.call('show')['items'], [])
        self.call('record', '--topic', 'github', '--state', 'available', '--evidence', 'x' * 300)

    def test_nothing_that_looks_like_a_credential_is_stored(self):
        github = 'ghp' + '_' + 'A9' * 18
        for value in [github, 'the key is ' + 'sk-' + 'b3' * 14, 'x7fK9' * 6,
                      'AKIA' + 'J7QW' * 5, 'glpat-' + 'z4' * 12]:
            failure = self.call('record', '--topic', 'github', '--state', 'available',
                                '--evidence', value, success=False)
            self.assertIn('credentials are never stored here', failure['error'])
            self.assertNotIn(value[-8:], json.dumps(failure))
        self.call('owner', '--name', github, success=False)
        self.assertEqual(self.call('show'), dict(owner=None, language=None, updated=None, items=[]))

    def test_an_honest_sentence_about_a_check_is_not_a_credential(self):
        for value in ['gh auth status exited 0', 'plow_list_skills listed 6 skills on this Mac',
                      'the owner approved google-workspace in Latch']:
            self.call('record', '--topic', 'github', '--state', 'available', '--evidence', value)
        self.assertEqual(self.call('show')['items'][0]['evidence'],
                         'the owner approved google-workspace in Latch')

    def test_setting_up_again_forgets_everything_and_starts_over(self):
        self.call('owner', '--name', 'Ana', '--language', 'Portuguese')
        self.call('record', '--topic', 'imessage', '--state', 'available', '--wanted', 'yes')
        self.assertTrue(self.call('forget')['forgotten'])
        self.assertFalse(self.file.exists())
        self.assertEqual(self.call('show'), dict(owner=None, language=None, updated=None, items=[]))
        self.assertFalse(self.call('forget')['forgotten'])
        self.call('record', '--topic', 'imessage', '--state', 'unavailable')
        self.assertEqual(len(self.call('show')['items']), 1)

    def test_the_record_stays_private_and_is_replaced_whole(self):
        self.call('record', '--topic', 'contacts', '--state', 'available')
        self.call('record', '--topic', 'github', '--state', 'needs_owner')
        self.assertEqual(self.file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.file.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual([path.name for path in self.file.parent.iterdir()], [self.file.name])

    def test_a_damaged_record_is_reported_rather_than_crashing(self):
        self.call('record', '--topic', 'contacts', '--state', 'available')
        for damage in ['{"owner": ', '[]', json.dumps(dict(items=[{'state': 'available'}]))]:
            self.file.write_text(damage)
            failure = self.call('record', '--topic', 'contacts', '--state', 'available',
                                success=False)
            self.assertIn('unreadable', failure['error'])
        self.assertTrue(self.call('forget')['forgotten'])

    def test_a_home_is_needed_before_anything_is_written(self):
        result = subprocess.run([sys.executable, str(SCRIPT), 'show'],
                                env={key: value for key, value in os.environ.items()
                                     if key != 'HERMES_HOME'},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('HERMES_HOME', json.loads(result.stderr)['error'])


if __name__ == '__main__':
    unittest.main()
