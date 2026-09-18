"""Unit tests for the hosted agent registry: safe identifiers and a private record file."""
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

HOSTED = Path(__file__).resolve().parent
sys.path[:0] = [str(HOSTED), str(HOSTED.parent / 'integrations/relay-terminal')]
import plow_agent
import registry


class IdentifierTests(unittest.TestCase):
    """The operator names a person; the identifier naming their folder, project and volume is checked, never fixed."""

    def test_a_safe_identifier_is_returned_unchanged(self):
        for value in ('dana', 'dana-whitfield', 'd', 'a1', '9lives', 'a' * 32):
            with self.subTest(value=value):
                self.assertEqual(registry.safe_identifier(value), value)

    def test_an_unsafe_name_is_refused_and_names_the_identifier_to_use(self):
        for value, suggestion in (('Dana Whitfield', 'dana-whitfield'), ('Dana', 'dana'), ('dana_w', 'dana-w'),
                                  ('  dana  ', 'dana'), ('Renée', 'renee'), ('-dana-', 'dana'),
                                  ('dana.whitfield', 'dana-whitfield'), ('a' * 40, 'a' * 32)):
            with self.subTest(value=value):
                with self.assertRaises(plow_agent.DecisionNeeded) as refusal:
                    registry.safe_identifier(value)
                self.assertIn(f'Use {suggestion} instead', str(refusal.exception))
                self.assertEqual(registry.safe_identifier(suggestion), suggestion)

    def test_a_name_with_nothing_usable_in_it_is_refused_without_a_suggestion(self):
        for value in ('', '   ', '...', '!!!'):
            with self.subTest(value=value):
                with self.assertRaises(plow_agent.DecisionNeeded) as refusal:
                    registry.safe_identifier(value)
                self.assertIn('no letters or digits', str(refusal.exception))
                self.assertNotIn('instead', str(refusal.exception))

    def test_a_path_or_option_is_never_taken_as_an_identifier(self):
        for value in ('..', '../other', 'a/b', '/etc', '.', '--force', 'a b'):
            with self.subTest(value=value):
                with self.assertRaises(plow_agent.DecisionNeeded):
                    registry.safe_identifier(value)

    def test_the_names_docker_sees_are_built_from_the_identifier(self):
        self.assertEqual(registry.project_name('dana'), 'relay-hosted-dana')
        self.assertEqual(registry.volume_name('relay-hosted-dana'), 'relay-hosted-dana_agent-home')
        root = Path('/fixture/root')
        self.assertEqual(registry.folder_for(root, 'dana'), root / '.data/hosted/agents/dana')
        self.assertEqual(registry.registry_path(root), root / '.data/hosted/registry.json')

    def test_every_accepted_identifier_makes_a_name_docker_accepts(self):
        # Compose project names are lowercase letters, digits, dashes and underscores, starting with a letter or digit.
        for value in ('d', 'dana-whitfield', '9lives', 'a' * 32):
            with self.subTest(value=value):
                project = registry.project_name(registry.safe_identifier(value))
                self.assertRegex(project, r'^[a-z0-9][a-z0-9_-]*$')
                self.assertLess(len(registry.volume_name(project)), 64)


class EntryTests(unittest.TestCase):
    def test_an_entry_keeps_the_line_fields_it_names_and_drops_the_rest(self):
        record = registry.entry(person='dana', name='Dana Whitfield', project='relay-hosted-dana',
                                folder=Path('/fixture/dana'), volume='relay-hosted-dana_agent-home',
                                line={'uid': 'ln_1', 'provider_key': '+15550000000', 'display_name': 'Alder',
                                      'agent_uid': 'ag_1', 'token': 'agt_secret'},
                                created='2026-09-18T12:00:00Z')
        self.assertEqual(record, {'person': 'dana', 'name': 'Dana Whitfield', 'project': 'relay-hosted-dana',
                                  'folder': '/fixture/dana', 'volume': 'relay-hosted-dana_agent-home',
                                  'line': {'uid': 'ln_1', 'provider_key': '+15550000000', 'display_name': 'Alder'},
                                  'created': '2026-09-18T12:00:00Z'})
        self.assertNotIn('agt_secret', json.dumps(record))


class RegistryFileTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = registry.registry_path(self.root)

    def entry(self, person='dana'):
        project = registry.project_name(person)
        return registry.entry(person=person, name='Dana Whitfield', project=project,
                              folder=registry.folder_for(self.root, person), volume=registry.volume_name(project),
                              line={'uid': 'ln_1', 'provider_key': '+15550000000', 'display_name': 'Alder'},
                              created='2026-09-18T12:00:00Z')

    def test_a_registry_that_is_not_there_yet_reads_as_no_agents(self):
        self.assertEqual(registry.read(self.path), {'version': 1, 'agents': {}})
        self.assertFalse(self.path.exists())

    def test_a_recorded_agent_survives_a_round_trip(self):
        registry.record(self.path, self.entry())
        self.assertEqual(registry.read(self.path)['agents'], {'dana': self.entry()})

    def test_the_file_and_the_folders_this_tool_creates_are_private(self):
        registry.record(self.path, self.entry())
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o600)
        for folder in (self.path.parent, self.path.parent.parent):
            with self.subTest(folder=folder.name):
                self.assertEqual(stat.S_IMODE(folder.stat().st_mode), 0o700)

    def test_a_loosened_hosted_folder_is_made_private_again_on_the_next_write(self):
        registry.record(self.path, self.entry())
        os.chmod(self.path.parent, 0o755)
        registry.record(self.path, self.entry('mel'))
        self.assertEqual(stat.S_IMODE(self.path.parent.stat().st_mode), 0o700)

    def test_a_shared_data_folder_that_already_exists_is_left_as_it_is(self):
        # .data also holds the installed agent's own state, so this tool does not change a folder it did not create.
        shared = self.root / '.data'
        shared.mkdir(mode=0o755)
        registry.record(self.path, self.entry())
        self.assertEqual(stat.S_IMODE(shared.stat().st_mode), 0o755)

    def test_an_entry_holds_the_line_but_never_a_token(self):
        registry.record(self.path, self.entry())
        saved = self.path.read_text()
        self.assertIn('ln_1', saved)
        self.assertIn('+15550000000', saved)
        for secret in ('token', 'TOKEN', 'agt_'):
            with self.subTest(secret=secret):
                self.assertNotIn(secret, saved)

    def test_a_registry_that_cannot_be_read_stops_instead_of_starting_over(self):
        self.path.parent.mkdir(parents=True)
        for text in ('{ not json', '[]', '{"version": 2, "agents": {}}', '{"agents": []}', '{"version": 1}'):
            with self.subTest(text=text):
                self.path.write_text(text)
                with self.assertRaises(plow_agent.AgentError) as refusal:
                    registry.read(self.path)
                self.assertIn(str(self.path), str(refusal.exception))
                self.assertEqual(self.path.read_text(), text)

    def test_a_write_that_fails_leaves_the_earlier_registry_and_no_half_file(self):
        registry.record(self.path, self.entry())
        before = self.path.read_bytes()
        with patch.object(registry.os, 'replace', side_effect=OSError('no space left on device')):
            with self.assertRaises(OSError):
                registry.record(self.path, self.entry('mel'))
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual([item.name for item in self.path.parent.iterdir()], ['registry.json'])

    def test_forgetting_one_agent_keeps_the_others(self):
        registry.record(self.path, self.entry('dana'))
        registry.record(self.path, self.entry('mel'))
        registry.forget(self.path, 'dana')
        self.assertEqual(list(registry.read(self.path)['agents']), ['mel'])

    def test_forgetting_an_agent_that_is_not_recorded_changes_nothing(self):
        registry.record(self.path, self.entry('mel'))
        before = self.path.read_bytes()
        registry.forget(self.path, 'dana')
        self.assertEqual(self.path.read_bytes(), before)

    def test_recording_the_same_person_twice_replaces_that_one_record(self):
        registry.record(self.path, self.entry('dana'))
        second = dict(self.entry('dana'), created='2026-09-19T12:00:00Z')
        registry.record(self.path, second)
        self.assertEqual(registry.read(self.path)['agents'], {'dana': second})


if __name__ == '__main__':
    unittest.main()
