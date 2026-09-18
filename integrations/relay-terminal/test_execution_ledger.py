import contextlib
import io
import json
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import cli
from execution_ledger import Ledger, MAX_FILE
from fake_windows import reparse_point, symlinks_available, windows_host
import private_files


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name).resolve()
        self.root = self.directory / 'checkout'
        self.root.mkdir()
        self.file = self.root / 'code.txt'
        self.file.write_text('first\nsecond\nthird\n')
        self.database = self.directory / 'state' / 'ledger.sqlite3'
        self.anchor = {'plan': 'FIX-1', 'base': 'observed-fixture-base'}
        self.ledger = Ledger(self.root, self.database, self.anchor)

    def test_reuse_requires_visible_receipt_exact_content_and_range(self):
        first = self.ledger.read('code.txt', 1, 2)
        self.assertEqual(first['content'], 'first\nsecond\n')
        self.assertEqual(self.ledger.read('code.txt', 1, 2)['decision'], 'allow')
        reused = self.ledger.read('code.txt', 1, 2, [first['receipt_id']])
        self.assertEqual(reused['decision'], 'reuse')
        self.assertNotIn('content', reused)
        self.assertEqual(self.ledger.read('code.txt', 1, 3, [first['receipt_id']])['decision'], 'allow')
        self.assertEqual(self.ledger.read('code.txt', 1, 2, ['LED-unknown'])['decision'], 'allow')
        # An external editor changes bytes, even if the requested lines match.
        self.file.write_text('first\nsecond\nchanged\n')
        fresh = self.ledger.read('code.txt', 1, 2, [first['receipt_id']])
        self.assertEqual(fresh['decision'], 'allow')
        self.assertEqual(fresh['request']['change_counter'], 1)
        observations = {row['receipt_id']: row for row in self.ledger.inform()['observations']}
        self.assertFalse(observations[first['receipt_id']]['fresh'])
        self.assertTrue(observations[fresh['receipt_id']]['fresh'])

    def test_state_detects_external_change_deletion_and_restore(self):
        first = self.ledger.read('code.txt')
        original = self.file.read_text()
        self.file.write_text('external change')
        self.assertFalse(self.ledger.inform()['observations'][0]['fresh'])
        self.file.unlink()
        self.assertIsNone(self.ledger.inform()['observed_files']['code.txt']['sha256'])
        self.file.write_text(original)
        state = self.ledger.inform()
        self.assertEqual(state['observed_change_count'], 3)
        self.assertFalse(state['runtime_hook_connected'])
        self.assertEqual(self.ledger.read('code.txt', visible=[first['receipt_id']])['decision'], 'allow')
        changes = [item for item in self.ledger.history()['items'] if item['kind'] == 'file_changed']
        self.assertEqual(len(changes), 3)
        self.assertTrue(all(item['payload']['actor'] == 'unknown' for item in changes))

    def test_restart_retains_history_but_does_not_assume_context_visibility(self):
        first = self.ledger.read('code.txt')
        restarted = Ledger(self.root, self.database, self.anchor)
        self.assertEqual(restarted.read('code.txt')['decision'], 'allow')
        self.assertEqual(restarted.read('code.txt', visible=[first['receipt_id']])['decision'], 'reuse')
        self.assertTrue(private_files.is_private(self.database))
        with self.assertRaises(ValueError):
            Ledger(self.root, self.database, {'plan': 'FIX-other'})
        other = self.directory / 'other'; other.mkdir()
        with self.assertRaises(ValueError): Ledger(other, self.database, self.anchor)

    def test_failed_oversized_binary_and_unsafe_reads_are_not_recorded(self):
        outside = self.directory / 'outside'; outside.write_text('outside')
        (self.root / 'link').symlink_to(outside)
        (self.root / 'folder-link').symlink_to(self.directory, target_is_directory=True)
        (self.root / 'binary').write_bytes(b'binary\0data')
        (self.root / 'large').write_bytes(b'a' * (MAX_FILE + 1))
        (self.root / 'long-line').write_text('a' * 65537)
        (self.root / 'invalid-utf8').write_bytes(b'\xff')
        for path in ('../outside', '/etc/passwd', '.git/config', 'link', 'folder-link/outside', 'binary', 'large', 'long-line', 'missing', 'invalid-utf8', 'code.txt/..'):
            with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                self.ledger.read(path)
        self.assertEqual(self.ledger.inform()['records'], 0)
        self.assertEqual(self.ledger.inform()['observed_files'], {})
        with patch.object(self.ledger, 'content', side_effect=ValueError('Changed during observation')):
            with self.assertRaises(ValueError): self.ledger.read('code.txt')
        self.assertEqual(self.ledger.inform()['records'], 0)

    def test_storage_cannot_be_inside_checkout_or_follow_symlinks(self):
        with self.assertRaises(ValueError): Ledger(self.root, self.root / 'state.db', self.anchor)
        link = self.directory / 'link'; link.symlink_to(self.database.parent, target_is_directory=True)
        with self.assertRaises(ValueError): Ledger(self.root, link / 'other.db', self.anchor)
        link_file = self.database.parent / 'link.db'; link_file.symlink_to(self.database)
        with self.assertRaises(ValueError): Ledger(self.root, link_file, self.anchor)

    def test_edit_during_descriptor_read_rejects_partial_observation(self):
        real_read = os.read
        changed = False
        def concurrent_read(descriptor, count):
            nonlocal changed
            chunk = real_read(descriptor, count)
            if not changed:
                changed = True
                self.file.write_text('updated while reading')
            return chunk
        with patch('execution_ledger.os.read', side_effect=concurrent_read):
            with self.assertRaisesRegex(ValueError, 'changed during observation'):
                self.ledger.read('code.txt')
        self.assertEqual(self.ledger.inform()['records'], 0)

    def test_repeated_tests_and_unknown_commands_never_execute_or_reuse(self):
        marker = self.root / 'must-not-exist'
        for category in ('test', 'search', 'modify', 'unknown'):
            first = self.ledger.govern_command(['touch', str(marker)], category)
            second = self.ledger.govern_command(['touch', str(marker)], category)
            self.assertEqual(first['decision'], 'allow')
            self.assertEqual(second['decision'], 'nudge')
            self.assertTrue(second['execute_required'])
            self.assertFalse(second['authorized'])
            self.assertFalse(second['executed'])
        self.assertFalse(marker.exists())
        with self.assertRaises(ValueError): self.ledger.govern_command('npm test', 'test')

    def test_outcomes_are_reported_immutable_idempotent_and_paginated(self):
        command = self.ledger.govern_command(['npm', 'test'], 'test')
        result = self.ledger.outcome(command['receipt_id'], 1, 'Fixture: one failure')
        self.assertFalse(result['independently_verified'])
        self.assertEqual(result['provenance'], 'caller_reported')
        self.assertEqual(self.ledger.outcome(command['receipt_id'], 1, 'Fixture: one failure'), result)
        with self.assertRaises(ValueError): self.ledger.outcome(command['receipt_id'], 0, 'changed')
        with self.assertRaises(ValueError): self.ledger.outcome('LED-other', 0, '')
        page = self.ledger.history(limit=1)
        self.assertEqual(page['items'][0]['kind'], 'command_proposed')
        following = self.ledger.history(after=page['next_cursor'])
        self.assertEqual(following['items'][0]['kind'], 'command_outcome')
        self.assertIsNone(following['next_cursor'])
        summary = self.ledger.inform()['commands']
        self.assertEqual(summary[0]['exit_code'], 1)
        self.assertNotIn('output', summary[0])
        self.assertEqual(summary[1]['argv_preview'], ['npm', 'test'])

    def test_capacity_failure_rolls_back_observation_and_modification_state(self):
        first = self.ledger.read('code.txt')
        self.file.write_text('candidate')
        with patch('execution_ledger.MAX_RECORDS', 1):
            with self.assertRaises(ValueError): self.ledger.read('code.txt')
        history = self.ledger.history()['items']
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]['id'], first['receipt_id'])
        current = self.ledger.read('code.txt')
        self.assertEqual(current['request']['change_counter'], 1)

    def test_cli_binds_approved_worktree_and_preserves_dirty_candidate(self):
        cli.git(self.root, 'init', '-q')
        cli.git(self.root, 'config', 'user.name', 'Fixture')
        cli.git(self.root, 'config', 'user.email', 'fixture@example.invalid')
        cli.git(self.root, 'add', '.'); cli.git(self.root, 'commit', '-qm', 'Fixture')
        base = cli.git(self.root, 'rev-parse', 'HEAD')
        plan = {'id': 'FIX-1', 'case_id': 'RR-1', 'owner_version': 1, 'build': 'fixture',
                'acceptance_hash': 'fixture-hash', 'status': 'approved',
                'input': {'repository': str(self.root), 'base_commit': base, 'revision': 1}}
        with self.assertRaises(ValueError): cli.repair_ledger(plan, self.root)
        worktree = pathlib.Path(cli.prepare_worktree(plan, self.root)['path'])
        (worktree / 'code.txt').write_text('candidate')
        ledger = cli.repair_ledger(plan, self.root)
        self.assertEqual(ledger.read('code.txt')['content'], 'candidate')
        self.assertEqual(self.file.read_text(), 'first\nsecond\nthird\n')
        cli.git(worktree, 'add', '.'); cli.git(worktree, 'commit', '-qm', 'Candidate')
        plan.update(status='candidate_recorded', version=4)
        self.assertEqual(cli.repair_ledger(plan, self.root).inform()['records'], 1)
        # Exercise actual parser, API plan lookup, and command mediation without execution.
        with patch.object(cli.API, 'call', return_value=plan), contextlib.redirect_stdout(io.StringIO()) as output:
            cli.main(['ledger', 'command', 'FIX-1', '--repo', str(self.root), '--category', 'test', '--', 'npm', 'test'])
        self.assertEqual(json.loads(output.getvalue())['argv'], ['npm', 'test'])
        plan['status'] = 'revoked'
        with self.assertRaises(ValueError): cli.repair_ledger(plan, self.root)


class WindowsLedgerTests(unittest.TestCase):
    """The ledger used to refuse Windows outright. It now reads there, with the same refusals."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = pathlib.Path(self.temporary.name).resolve()
        self.root = self.directory / 'checkout'
        self.root.mkdir()
        (self.root / 'code.txt').write_text('first\nsecond\nthird\n')
        (self.root / 'src').mkdir()
        (self.root / 'src/deep.txt').write_text('deep\n')
        self.database = self.directory / 'state' / 'ledger.sqlite3'
        self.anchor = {'plan': 'FIX-1', 'base': 'observed-fixture-base'}

    def test_a_windows_host_reads_the_ledger_instead_of_being_refused(self):
        with windows_host():
            ledger = Ledger(self.root, self.database, self.anchor)
            self.assertTrue(private_files.is_private(self.database))
            self.assertEqual(ledger.read('code.txt', 1, 2)['content'], 'first\nsecond\n')
            self.assertEqual(ledger.read('src/deep.txt')['content'], 'deep\n')
            self.assertEqual(ledger.inform()['observed_change_count'], 0)

    def test_a_windows_read_never_reaches_for_a_flag_windows_does_not_have(self):
        with windows_host():
            self.assertFalse(hasattr(os, 'O_NOFOLLOW'))
            self.assertNotIn(os.open, os.supports_dir_fd)
            self.assertEqual(Ledger(self.root, self.database, self.anchor).read('code.txt')['decision'], 'allow')

    @unittest.skipUnless(symlinks_available(), 'this host does not let this account create a link')
    def test_links_reparse_points_and_escapes_are_still_refused_on_windows(self):
        outside = self.directory / 'outside'
        outside.write_text('outside')
        (self.root / 'link').symlink_to(outside)
        (self.root / 'folder-link').symlink_to(self.directory, target_is_directory=True)
        with windows_host():
            ledger = Ledger(self.root, self.database, self.anchor)
            for path in ('../outside', 'link', 'folder-link/outside', '.git/config', 'missing', '/etc/passwd'):
                with self.subTest(path=path), self.assertRaises((ValueError, OSError)):
                    ledger.read(path)
            with reparse_point(self.root / 'code.txt'), self.assertRaises(private_files.PrivacyError):
                ledger.read('code.txt')
            with reparse_point(self.root / 'src'), self.assertRaises(private_files.PrivacyError):
                ledger.read('src/deep.txt')
            self.assertEqual(ledger.inform()['records'], 0)

    def test_an_edit_during_a_windows_read_rejects_the_partial_observation(self):
        real_read = os.read
        changed = False

        def concurrent_read(descriptor, count):
            nonlocal changed
            chunk = real_read(descriptor, count)
            if not changed:
                changed = True
                (self.root / 'code.txt').write_text('updated while reading')
            return chunk
        with windows_host():
            ledger = Ledger(self.root, self.database, self.anchor)
            with patch('execution_ledger.os.read', side_effect=concurrent_read):
                with self.assertRaisesRegex(ValueError, 'changed during observation'):
                    ledger.read('code.txt')
            self.assertEqual(ledger.inform()['records'], 0)


if __name__ == '__main__':
    unittest.main()
