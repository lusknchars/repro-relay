"""The one privacy primitive, on this host and on a faked Windows one.

The Windows half is exercised here rather than only on Windows: the platform, the missing
os attributes and icacls are all faked from the measurements a real Windows runner gave,
so a macOS run proves both paths.
"""
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from fake_windows import (FakeWindows, held_by_another_process, reparse_point, symlinks_available,
                          windows_host)
import private_files


class PlatformTests(unittest.TestCase):
    def test_every_host_answers_with_one_of_the_three_recorded_names(self):
        for platform, expected in (('darwin', 'macos'), ('win32', 'windows'), ('linux', 'linux'),
                                   ('freebsd14', 'linux')):
            with self.subTest(platform=platform), patch.object(sys, 'platform', platform):
                self.assertEqual(private_files.host_platform(), expected)

    def test_the_command_is_typed_the_way_each_host_types_it(self):
        for platform in ('darwin', 'linux'):
            with self.subTest(platform=platform), patch.object(sys, 'platform', platform):
                self.assertEqual(private_files.relay_command(), './relay')
        with windows_host():
            # cmd.exe and PowerShell do not run ./relay, which is why the owner types this.
            self.assertEqual(private_files.relay_command(), 'python relay')

    def test_the_home_folder_comes_from_the_variable_each_host_keeps_it_in(self):
        with patch.dict(os.environ, {'HOME': '/fixture/home', 'USERPROFILE': '/fixture/home'}):
            self.assertEqual(private_files.home_directory(), Path('/fixture/home'))
        # Windows returns '~' unchanged when neither USERPROFILE nor HOMEPATH is set, which is
        # what raised RuntimeError('Could not determine home directory.') on the runner.
        with patch.object(os.path, 'expanduser', lambda path: path):
            self.assertIsNone(private_files.home_directory())


class AnyHostTests(unittest.TestCase):
    """What holds however this host decides access."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.file = self.directory / 'credential'
        self.file.write_text('PLOW_AGENT_TOKEN=agt_fixture_token\n')

    def test_protect_raises_and_never_returns_quietly_when_it_cannot(self):
        with self.assertRaises(private_files.PrivacyError) as error:
            private_files.protect(self.directory / 'absent')
        self.assertIn('absent', str(error.exception))

    def test_replace_atomically_moves_the_finished_file_into_place(self):
        source, target = self.directory / 'new', self.directory / 'credential'
        source.write_text('replacement\n')
        private_files.replace_atomically(source, target)
        self.assertEqual(target.read_text(), 'replacement\n')
        self.assertFalse(source.exists())

    def test_a_replace_that_cannot_happen_names_both_paths(self):
        with self.assertRaises(private_files.PrivacyError) as error:
            private_files.replace_atomically(self.directory / 'absent', self.directory / 'credential')
        self.assertIn('absent', str(error.exception))
        self.assertIn('credential', str(error.exception))

    def test_protect_then_is_private_agree_on_whatever_host_this_is(self):
        private_files.protect(self.file)
        self.assertTrue(private_files.is_private(self.file))
        folder = self.directory / 'state'
        folder.mkdir()
        private_files.protect(folder)
        self.assertTrue(private_files.is_private(folder))


@unittest.skipUnless(os.name == 'posix', 'mode bits decide access here')
class PosixPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.file = self.directory / 'credential'
        self.file.write_text('PLOW_AGENT_TOKEN=agt_fixture_token\n')

    def test_protect_sets_owner_only_modes_and_is_private_agrees(self):
        self.file.chmod(0o644)
        self.assertFalse(private_files.is_private(self.file))
        private_files.protect(self.file)
        self.assertEqual(self.file.stat().st_mode & 0o777, 0o600)
        self.assertTrue(private_files.is_private(self.file))
        folder = self.directory / 'state'
        folder.mkdir(mode=0o755)
        private_files.protect(folder)
        self.assertEqual(folder.stat().st_mode & 0o777, 0o700)
        self.assertTrue(private_files.is_private(folder))
        runnable = self.directory / 'plow-agents'
        runnable.write_text('#!/usr/bin/env python3\n')
        private_files.protect(runnable, executable=True)
        self.assertEqual(runnable.stat().st_mode & 0o777, 0o700)

    def test_any_group_or_other_access_is_not_private(self):
        for mode in (0o644, 0o640, 0o604, 0o660, 0o666, 0o700 | 0o001):
            with self.subTest(mode=oct(mode)):
                self.file.chmod(mode)
                self.assertFalse(private_files.is_private(self.file))
        for mode in (0o600, 0o400, 0o700):
            with self.subTest(mode=oct(mode)):
                self.file.chmod(mode)
                self.assertTrue(private_files.is_private(self.file))

    def test_a_drive_that_takes_the_change_and_does_nothing_is_caught(self):
        # A memory stick or a network share accepts chmod and keeps the file open to everyone.
        self.file.chmod(0o666)
        with patch.object(private_files.os, 'chmod'):
            with self.assertRaises(private_files.PrivacyError) as error:
                private_files.protect(self.file)
        self.assertIn(str(self.file), str(error.exception))
        self.assertIn(f'chmod 600 {self.file}', str(error.exception))

    def test_a_stat_from_an_open_handle_is_used_instead_of_a_second_look(self):
        self.file.chmod(0o600)
        with private_files.open_private(self.file) as handle:
            info = os.fstat(handle.fileno())
            self.assertTrue(private_files.is_private(self.file, info))
            self.assertEqual(handle.read(), b'PLOW_AGENT_TOKEN=agt_fixture_token\n')
        self.file.chmod(0o644)
        # The handle's own answer is what the caller checked; a later change cannot rewrite it.
        self.assertTrue(private_files.is_private(self.file, info))
        self.assertFalse(private_files.is_private(self.file))

    def test_open_private_refuses_a_link(self):
        link = self.directory / 'link'
        link.symlink_to(self.file)
        with self.assertRaises(OSError):
            private_files.open_private(link)


class WindowsPrivacyTests(unittest.TestCase):
    """The host where chmod does nothing, run from macOS against the measured behaviour."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.file = self.directory / 'plow-credentials'
        self.file.write_text('PLOW_AGENT_TOKEN=agt_fixture_token\n')

    def test_a_file_chmod_left_alone_is_not_private_and_protect_makes_it_so(self):
        with windows_host() as windows:
            # What the runner measured after os.chmod(path, 0o600): mode 0o666 and these three.
            self.assertEqual(windows.principals(self.file),
                             ['NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators', 'OWNER RIGHTS'])
            self.assertFalse(private_files.is_private(self.file))
            private_files.protect(self.file)
            self.assertEqual(windows.calls[-2],
                             ['icacls', str(self.file), '/inheritance:r', '/grant:r', 'runneradmin:F'])
            self.assertEqual(windows.calls[-1], ['icacls', str(self.file)])  # protect reads back what it did
            self.assertEqual(windows.principals(self.file),
                             ['runneradmin', 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators'])
            self.assertTrue(private_files.is_private(self.file))

    def test_chmod_alone_never_makes_a_windows_file_private(self):
        with windows_host():
            os.chmod(self.file, 0o600)
            self.assertFalse(private_files.is_private(self.file))

    def test_another_account_with_access_is_not_private(self):
        for extra in ('Everyone', 'NT AUTHORITY\\Authenticated Users', 'DESKTOP-7QK2\\otheruser'):
            with self.subTest(extra=extra), windows_host() as windows:
                windows.access[str(self.file)] = ['runneradmin', 'NT AUTHORITY\\SYSTEM', extra]
                self.assertFalse(private_files.is_private(self.file))

    def test_the_account_is_recognised_however_the_domain_spells_it(self):
        for spelling in ('runneradmin', 'DESKTOP-7QK2\\runneradmin', 'RUNNERADMIN'):
            with self.subTest(spelling=spelling), windows_host() as windows:
                windows.access[str(self.file)] = [spelling, 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators']
                self.assertTrue(private_files.is_private(self.file))

    def test_protect_raises_when_icacls_refuses_and_says_which_path(self):
        with windows_host(FakeWindows(user='runneradmin')):
            with patch.dict(os.environ, {'USERNAME': 'someone-else'}):
                with self.assertRaises(private_files.PrivacyError) as error:
                    private_files.protect(self.file)
        self.assertIn(str(self.file), str(error.exception))

    def test_an_icacls_that_exits_zero_and_changes_nothing_is_not_taken_as_done(self):
        # A network share or a memory stick takes the grant, reports success and keeps the
        # file open. An exit code says the command ran; the listing says what is true.
        with windows_host(FakeWindows(applies=False)) as windows:
            with self.assertRaises(private_files.PrivacyError) as error:
                private_files.protect(self.file)
            self.assertEqual(windows.calls[0][2:], ['/inheritance:r', '/grant:r', 'runneradmin:F'])
            self.assertEqual(windows.calls[1], ['icacls', str(self.file)])
            self.assertFalse(private_files.is_private(self.file))
        self.assertIn(str(self.file), str(error.exception))
        self.assertIn('icacls', str(error.exception))

    def test_protect_raises_when_icacls_itself_cannot_be_run(self):
        with windows_host(), patch.object(subprocess, 'run', side_effect=FileNotFoundError(2, 'icacls')):
            with self.assertRaises(private_files.PrivacyError) as error:
                private_files.protect(self.file)
            self.assertFalse(private_files.is_private(self.file))
        self.assertIn('icacls', str(error.exception))

    def test_an_answer_that_lists_nobody_is_not_taken_as_private(self):
        with windows_host() as windows:
            windows.access[str(self.file)] = []
            self.assertFalse(private_files.is_private(self.file))
            missing = self.directory / 'never-written'
            self.assertFalse(private_files.is_private(missing))

    @unittest.skipUnless(symlinks_available(), 'this host does not let this account create a link')
    def test_open_private_refuses_a_link_and_a_reparse_point(self):
        link = self.directory / 'link'
        link.symlink_to(self.file)
        with windows_host():
            with self.assertRaises(private_files.PrivacyError) as linked:
                private_files.open_private(link)
            with reparse_point(self.file), self.assertRaises(private_files.PrivacyError) as reparse:
                private_files.open_private(self.file)
            with private_files.open_private(self.file) as handle:
                self.assertEqual(handle.read(), b'PLOW_AGENT_TOKEN=agt_fixture_token\n')
        self.assertIn(str(link), str(linked.exception))
        self.assertIn(str(self.file), str(reparse.exception))

    def test_a_windows_read_never_reaches_for_a_flag_windows_does_not_have(self):
        with windows_host():
            self.assertFalse(hasattr(os, 'O_NOFOLLOW'))
            with private_files.open_private(self.file) as handle:
                self.assertTrue(handle.read())

    def test_a_replace_retries_while_another_process_holds_the_file(self):
        source = self.directory / 'plow-credentials.new'
        source.write_text('minted\n')
        with windows_host(), patch.object(private_files.time, 'sleep') as pause, \
                held_by_another_process(self.file, times=2):
            private_files.replace_atomically(source, self.file)
        self.assertEqual(pause.call_count, 2)
        self.assertEqual(self.file.read_text(), 'minted\n')

    def test_a_file_held_for_good_stops_with_something_the_owner_can_act_on(self):
        source = self.directory / 'plow-credentials.new'
        source.write_text('minted\n')
        with windows_host(), patch.object(private_files.time, 'sleep'), \
                held_by_another_process(self.file, times=private_files.REPLACE_ATTEMPTS):
            with self.assertRaises(private_files.PrivacyError) as error:
                private_files.replace_atomically(source, self.file)
        self.assertIn(str(self.file), str(error.exception))
        self.assertIn('holding it', str(error.exception))
        self.assertEqual(self.file.read_text(), 'PLOW_AGENT_TOKEN=agt_fixture_token\n')


class UnsupportedHostTests(unittest.TestCase):
    def test_a_host_that_can_do_neither_stops_rather_than_pretending(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'credential'
            path.write_text('x')
            with patch.object(sys, 'platform', 'unknown-host'), patch.object(os, 'name', 'unknown'):
                with self.assertRaises(private_files.PrivacyError) as error:
                    private_files.protect(path)
                self.assertFalse(private_files.is_private(path))
        self.assertIn(str(path), str(error.exception))


class ParsingTests(unittest.TestCase):
    def test_account_names_with_spaces_and_domains_survive_the_listing(self):
        path = r'C:\Users\runneradmin\AppData\Local\Temp\tmp1a2b\plow-credentials'
        listing = (f'{path} NT AUTHORITY\\SYSTEM:(F)\n'
                   f'{" " * (len(path) + 1)}BUILTIN\\Administrators:(F)\n'
                   f'{" " * (len(path) + 1)}OWNER RIGHTS:(F)\n'
                   '\nSuccessfully processed 1 files; Failed processing 0 files\n')
        self.assertEqual(private_files.windows_principals(path, listing),
                         ['NT AUTHORITY\\SYSTEM', 'BUILTIN\\ADMINISTRATORS', 'OWNER RIGHTS'])

    def test_a_folder_listing_keeps_its_inheritance_flags_out_of_the_account_name(self):
        # A folder carries (I)(OI)(CI) as well as the rights, and an account is still
        # everything before the first ':('.
        path = r'C:\Users\runneradmin\repro-relay\.data\agent'
        listing = (f'{path} runneradmin:(OI)(CI)(F)\n'
                   f'{" " * (len(path) + 1)}NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)\n'
                   f'{" " * (len(path) + 1)}BUILTIN\\Administrators:(I)(OI)(CI)(F)\n'
                   '\nSuccessfully processed 1 files; Failed processing 0 files\n')
        self.assertEqual(private_files.windows_principals(path, listing),
                         ['RUNNERADMIN', 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\ADMINISTRATORS'])

    def test_the_reparse_bit_is_the_one_the_stat_module_names(self):
        self.assertEqual(stat.FILE_ATTRIBUTE_REPARSE_POINT, 0x400)


if __name__ == '__main__':
    unittest.main()
