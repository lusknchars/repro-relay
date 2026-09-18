"""Windows as a real Windows runner measured it, so a macOS run proves the Windows path too.

Every answer here is rendered from the arguments the call is actually given, in the shapes
that runner produced: icacls listings and their exit codes, the accounts chmod 0600 leaves
on a file, and the sharing violation a replace hits while another process holds the file.
Nothing answers from a fixed reply the code under test could quietly stop matching.

Measured on that runner, and reproduced here:
  sys.platform is 'win32' and os.name is 'nt'
  os.chmod(path, 0o600) leaves mode 0o666, and icacls still lists
    NT AUTHORITY\\SYSTEM:(F), BUILTIN\\Administrators:(F) and OWNER RIGHTS:(F)
  icacls <path> /inheritance:r /grant:r <USERNAME>:F exits 0 and leaves that user,
    SYSTEM and Administrators, and OWNER RIGHTS with them: /inheritance:r removes the
    inherited entries and OWNER RIGHTS is explicit, so it outlives the grant until it is
    removed by its own SID
  os.O_NOFOLLOW, os.geteuid, os.getuid and os.fchmod do not exist, and
    os.open is not in os.supports_dir_fd
  replacing a file another process holds raises PermissionError [WinError 32]
"""
import contextlib
import os
from pathlib import Path
import stat as stat_module
import subprocess
import sys
from unittest.mock import patch

SHARING_VIOLATION = 32
HELD = 'The process cannot access the file because it is being used by another process'
# Windows lacks all of these. They are removed rather than flagged, so a Windows code path
# that reaches for one fails here exactly as it failed on the runner.
ABSENT = ('O_NOFOLLOW', 'O_DIRECTORY', 'geteuid', 'getuid', 'fchmod', 'fchown', 'chown')


class FakeWindows:
    """The access a Windows file has, and the icacls that reads and changes it."""

    INHERITED = ('NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators', 'OWNER RIGHTS')

    def __init__(self, user='runneradmin', fallback=None, applies=True):
        self.user = user
        self.access = {}  # path -> the accounts icacls lists; absent means a file nobody locked down
        self.calls = []
        self.fallback = fallback  # anything that is not icacls, for a test that fakes other commands too
        # A drive that cannot keep one account apart from another, a memory stick or a network
        # share, takes the grant, reports success and leaves the file open to everyone.
        self.applies = applies

    def principals(self, path):
        """The accounts that can reach a path right now."""
        return self.access.get(os.fspath(path), list(self.INHERITED))

    def listing(self, path):
        """What `icacls <path>` prints: the first account on the path's line, the rest indented.

        A folder's entries carry the inheritance flags as well as the rights, which is the
        shape the parser has to survive.
        """
        rights = '(OI)(CI)(F)' if os.path.isdir(path) else '(F)'
        accounts = self.principals(path)
        rows = [f'{path} {accounts[0]}:{rights}'] if accounts else [path]
        rows += [' ' * (len(path) + 1) + f'{account}:{rights}' for account in accounts[1:]]
        return '\n'.join(rows) + '\n\nSuccessfully processed 1 files; Failed processing 0 files\n'

    def run(self, command, **options):
        command = list(command)
        if not command or command[0] != 'icacls':
            if self.fallback is None:
                raise AssertionError(f'A faked Windows ran {command[0]!r}, which nothing here answers.')
            return self.fallback(command, **options)
        self.calls.append(command)
        path = command[1]
        if command[2:3] == ['/remove:g']:
            removed = {'*S-1-3-4': 'OWNER RIGHTS'}.get(command[3])
            if removed is None:
                raise AssertionError(f'A faked Windows was asked to remove an account it does not know: {command}')
            if self.applies:
                self.access[os.fspath(path)] = [name for name in self.principals(path) if name != removed]
            return subprocess.CompletedProcess(
                command, 0, f'processed file: {path}\nSuccessfully processed 1 files; Failed processing 0 files\n', '')
        if not os.path.exists(path):
            return subprocess.CompletedProcess(
                command, 1, 'Successfully processed 0 files; Failed processing 1 files\n',
                f'{path}: The system cannot find the file specified.\n')
        if len(command) == 2:
            return subprocess.CompletedProcess(command, 0, self.listing(path), '')
        granted = self.granted(command)
        if granted is None:
            raise AssertionError(f'A faked Windows was given an icacls call it cannot answer: {command}')
        if granted.upper() != self.user.upper():
            return subprocess.CompletedProcess(
                command, 1332, 'Successfully processed 0 files; Failed processing 1 files\n',
                f'{path}: No mapping between account names and security IDs was done.\n')
        if self.applies:
            self.access[os.fspath(path)] = [granted, 'NT AUTHORITY\\SYSTEM', 'BUILTIN\\Administrators',
                                            'OWNER RIGHTS']
        return subprocess.CompletedProcess(
            command, 0, f'processed file: {path}\nSuccessfully processed 1 files; Failed processing 0 files\n', '')

    @staticmethod
    def granted(command):
        """The account an `/inheritance:r /grant:r <account>:<rights>` call names, or None otherwise.

        A folder is granted (OI)(CI)F so that what is made inside it belongs to that account
        too; a file is granted F. Anything else is not a call this answers.
        """
        if '/inheritance:r' not in command or '/grant:r' not in command:
            return None
        grant = command[command.index('/grant:r') + 1]
        account, separator, rights = grant.rpartition(':')
        wanted = '(OI)(CI)F' if os.path.isdir(command[1]) else 'F'
        return account if separator and rights == wanted else None


def symlinks_available():
    """Whether this host lets this account create a symbolic link.

    Asked by making one rather than assumed: Windows refuses without the create symbolic
    link privilege, so a test that needs a real link says so instead of failing.
    """
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / 'target'
        target.write_bytes(b'x')
        try:
            (Path(directory) / 'link').symlink_to(target)
            return True
        except (OSError, NotImplementedError):
            return False


@contextlib.contextmanager
def missing(module, *names):
    """Take attributes off a module for the duration, the way another host simply does not have them."""
    saved = {name: getattr(module, name) for name in names if hasattr(module, name)}
    for name in saved:
        delattr(module, name)
    try:
        yield
    finally:
        for name, value in saved.items():
            setattr(module, name, value)


@contextlib.contextmanager
def windows_host(fake=None, run=None):
    """Run the block on Windows: its platform, its missing os attributes and its icacls."""
    fake = fake or FakeWindows(fallback=run)
    with patch.object(sys, 'platform', 'win32'), missing(os, *ABSENT), \
            patch.object(os, 'supports_dir_fd', frozenset()), \
            patch.dict(os.environ, {'USERNAME': fake.user}), \
            patch.object(subprocess, 'run', fake.run):
        yield fake


class Attributes:
    """An os.stat_result carrying the Windows file attributes it has there and POSIX does not."""

    def __init__(self, info, st_file_attributes):
        self._info = info
        self.st_file_attributes = st_file_attributes

    def __getattr__(self, name):
        return getattr(self._info, name)


@contextlib.contextmanager
def reparse_point(path):
    """Report one path the way Windows reports a junction or a link: the reparse bit set."""
    real = os.stat

    def fake_stat(target, *arguments, **options):
        info = real(target, *arguments, **options)
        if Path(os.fspath(target)) == Path(os.fspath(path)):
            return Attributes(info, stat_module.FILE_ATTRIBUTE_REPARSE_POINT | stat_module.FILE_ATTRIBUTE_ARCHIVE)
        return info

    with patch.object(os, 'stat', fake_stat):
        yield


@contextlib.contextmanager
def held_by_another_process(target, times=1):
    """Refuse the first `times` moves onto a path the way Windows does while something holds it."""
    real = os.replace
    remaining = [times]

    def fake_replace(source, destination, **options):
        if Path(os.fspath(destination)) == Path(os.fspath(target)) and remaining[0]:
            remaining[0] -= 1
            error = PermissionError(13, HELD)
            error.winerror = SHARING_VIOLATION
            error.filename, error.filename2 = os.fspath(source), os.fspath(destination)
            raise error
        return real(source, destination, **options)

    with patch.object(os, 'replace', fake_replace):
        yield
