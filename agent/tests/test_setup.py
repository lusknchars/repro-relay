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
        # A permissive mask, so the record's own mode is what makes it private.
        # Another test in this suite leaves 0o077 behind in the runner.
        self.addCleanup(os.umask, os.umask(0o022))

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
                      'the owner approved google-workspace in Latch', 'the owner works in Asia',
                      'timezone Asia/Sao_Paulo', 'asia pacific team']:
            self.call('record', '--topic', 'github', '--state', 'available', '--evidence', value)
        self.assertEqual(self.call('show')['items'][0]['evidence'], 'asia pacific team')

    def test_a_long_repository_topic_is_a_topic_and_not_a_credential(self):
        self.call('record', '--topic', 'my-very-long-repository-name-2026', '--state', 'available')
        self.assertEqual(self.call('show')['items'][0]['topic'], 'my-very-long-repository-name-2026')
        refused = self.call('record', '--topic', 'glpat-a1b2c3d4', '--state', 'available',
                            success=False)
        self.assertIn('credentials are never stored here', refused['error'])
        refused = self.call('record', '--topic', 'github', '--state', 'available',
                            '--evidence', 'ghp' + '_' + 'A9' * 18, success=False)
        self.assertIn('credentials are never stored here', refused['error'])

    def test_an_answer_that_is_not_yes_or_no_is_refused_without_echoing_it(self):
        secret = 'ghp' + '_' + 'A9' * 18
        for value in ['maybe', secret]:
            result = subprocess.run([sys.executable, str(SCRIPT), 'record', '--topic', 'github',
                                     '--state', 'available', '--wanted', value],
                                    env={**os.environ, 'HERMES_HOME': str(self.home)},
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertIn('wanted', json.loads(result.stderr)['error'])
            self.assertNotIn(value, result.stderr + result.stdout)
        self.assertEqual(self.call('show')['items'], [])

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
        first, body = self.file.stat().st_ino, self.file.read_text()
        self.call('record', '--topic', 'github', '--state', 'needs_owner')
        # A new file moved into place, never the old one opened and truncated.
        self.assertNotEqual(self.file.stat().st_ino, first)
        self.assertEqual(self.file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.file.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual([path.name for path in self.file.parent.iterdir()], [self.file.name])
        refused = self.file.stat().st_ino
        self.call('record', '--topic', 'github', '--state', 'available',
                  '--evidence', 'ghp' + '_' + 'A9' * 18, success=False)
        self.assertEqual(self.file.stat().st_ino, refused)
        self.assertIn('contacts', self.file.read_text())
        self.assertNotEqual(self.file.read_text(), body)

    def test_a_damaged_record_is_reported_rather_than_crashing(self):
        self.call('record', '--topic', 'contacts', '--state', 'available')
        for damage in ['{"owner": ', '[]', '"a string"']:
            self.file.write_text(damage)
            failure = self.call('record', '--topic', 'contacts', '--state', 'available',
                                success=False)
            self.assertIn('unreadable', failure['error'])
        self.assertTrue(self.call('forget')['forgotten'])

    def test_a_planted_record_is_cleaned_on_the_way_out(self):
        secret = 'ghp' + '_' + 'A9' * 18
        self.call('record', '--topic', 'contacts', '--state', 'available')
        self.file.write_text(json.dumps(dict(
            owner=secret, language='Portuguese', updated='2026-09-17T00:00:00+00:00',
            items=[dict(topic='github', wanted='sure', state='available',
                        evidence='the token is ' + secret, checked='2026-09-17T00:00:00+00:00',
                        extra=dict(nested=secret)),
                   dict(state='available'),
                   dict(topic='imessage', wanted=True, state='available',
                        evidence='plow_list_skills listed imessage',
                        checked='2026-09-17T00:00:00+00:00')])))
        shown = self.call('show')
        self.assertNotIn(secret, json.dumps(shown))
        self.assertIsNone(shown['owner'])
        self.assertEqual(shown['language'], 'Portuguese')
        self.assertEqual([item['topic'] for item in shown['items']], ['github', 'imessage'])
        self.assertEqual(sorted(shown['items'][0]),
                         ['checked', 'evidence', 'state', 'topic', 'wanted'])
        self.assertIsNone(shown['items'][0]['evidence'])
        self.assertIsNone(shown['items'][0]['wanted'])
        self.assertEqual(shown['items'][1]['evidence'], 'plow_list_skills listed imessage')
        self.call('record', '--topic', 'github', '--state', 'needs_owner')
        self.assertNotIn(secret, self.file.read_text())

    def test_the_mac_topic_survives_a_platform_that_cannot_have_latch(self):
        # Windows has no Latch, so the topic is recorded from that fact, and the
        # name stays the one earlier records already use.
        self.call('record', '--topic', 'mac', '--state', 'unavailable',
                  '--evidence', 'RELAY_OWNER_PLATFORM is windows, and Latch is a Mac app')
        item = self.call('show')['items'][0]
        self.assertEqual(item['topic'], 'mac')
        self.assertEqual(item['state'], 'unavailable')
        self.assertIsNone(item['wanted'])

    def test_a_home_is_needed_before_anything_is_written(self):
        result = subprocess.run([sys.executable, str(SCRIPT), 'show'],
                                env={key: value for key, value in os.environ.items()
                                     if key != 'HERMES_HOME'},
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('HERMES_HOME', json.loads(result.stderr)['error'])


class OwnerPlatform(unittest.TestCase):
    """The machine the owner installed from, so the questions match it."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)

    def platform(self, value=None, home=True):
        environment = {key: item for key, item in os.environ.items()
                       if key not in ('RELAY_OWNER_PLATFORM', 'HERMES_HOME')}
        if value is not None:
            environment['RELAY_OWNER_PLATFORM'] = value
        if home:
            environment['HERMES_HOME'] = str(self.home)
        result = subprocess.run([sys.executable, str(SCRIPT), 'platform'],
                                env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)['platform']

    def test_the_three_installed_platforms_are_reported_as_they_were_written(self):
        for value in ['macos', 'windows', 'linux']:
            self.assertEqual(self.platform(value), value)

    def test_an_agent_installed_before_the_variable_existed_is_unknown(self):
        self.assertEqual(self.platform(), 'unknown')

    def test_anything_unexpected_is_unknown_and_never_macos(self):
        for value in ['', '   ', 'darwin', 'osx', 'mac', 'win32', 'windows linux', 'unknown']:
            self.assertEqual(self.platform(value), 'unknown')

    def test_spacing_and_capitals_are_still_the_same_three_answers(self):
        self.assertEqual(self.platform(' Windows\n'), 'windows')
        self.assertEqual(self.platform('MACOS'), 'macos')

    def test_the_platform_answers_without_a_home_and_writes_nothing(self):
        self.assertEqual(self.platform('windows', home=False), 'windows')
        self.assertEqual(self.platform('macos'), 'macos')
        self.assertEqual(list(self.home.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
