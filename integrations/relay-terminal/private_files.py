"""Files only their owner can reach, on macOS, Linux and Windows.

os.chmod is the POSIX answer and Windows ignores it: a credential written there with
mode 0600 keeps mode 0666 and stays reachable by other accounts, so the privacy the
installer promises was never applied. Every part of the install path goes through this
module instead. protect() either makes a path private or raises; nothing calls it and
carries on regardless, because a credential that could not be protected must never be
written as though it had been.

This is also where the installer keeps the few host facts it needs: which computer it is
running on, how the command is typed, and where the account's home folder is.
"""
import contextlib
import getpass
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time

FILE_MODE = 0o600
DIRECTORY_MODE = 0o700
EXECUTABLE_MODE = 0o700
# Every Windows file carries these two, and removing them is neither possible nor useful:
# SYSTEM is the operating system itself and Administrators can take ownership regardless.
WINDOWS_ALWAYS_PRESENT = ('NT AUTHORITY\\SYSTEM', 'BUILTIN\\ADMINISTRATORS')
# OWNER RIGHTS grants whoever owns the file, so it is not this account by name and is not
# accepted as one. /inheritance:r removes inherited entries and this one is explicit, so it
# outlives the grant and has to be removed by hand. Its well known SID rather than its name:
# the name is localised and this has to work in any language.
OWNER_RIGHTS = '*S-1-3-4'
SHARING_VIOLATION = 32  # WinError 32: another process is still holding the file
REPLACE_ATTEMPTS = 5
REPLACE_PAUSE = 0.2
ICACLS_TIMEOUT = 30


class PrivacyError(ValueError):
    """A path could not be made private, or could not be shown to be private.

    A ValueError because that is what the terminal, the installer and the index wrapper
    already print in full; a privacy failure is exactly the kind of stop the owner needs
    to read rather than a type name.
    """


def windows():
    """Whether this host decides file access with ACLs rather than with mode bits."""
    return sys.platform == 'win32'


def posix():
    """Whether this host decides file access with mode bits.

    A function rather than a bare os.name check at each site, because a test that wants the
    third case, a host that can do neither, cannot patch os.name: pathlib picks its path
    class from it, so patching it hands every later Path the wrong kind.
    """
    return os.name == 'posix'


def host_platform():
    """This computer, as exactly one of 'macos', 'windows' or 'linux'.

    Any other POSIX host answers 'linux', because what it shares with Linux is what the
    rest of the installer asks about: mode bits, a POSIX shell and Docker on the host.
    """
    if sys.platform == 'darwin':
        return 'macos'
    if windows():
        return 'windows'
    return 'linux'


def relay_command():
    """How this host types the repository command, for a message that tells someone what to run.

    cmd.exe and PowerShell do not run ./relay, which is why a Windows owner types python relay.
    """
    return 'python relay' if windows() else './relay'


def home_directory():
    """This account's home folder, or None when the host does not say where it is.

    Windows keeps it in USERPROFILE and POSIX in HOME. Python answers '~' unchanged when
    neither is set, which would otherwise put files in a folder actually named '~', so a
    caller gets None and can carry on without the thing it only wanted for convenience.
    """
    home = os.path.expanduser('~')
    return None if not home or home.startswith('~') else Path(home)


def account_name():
    """The name of the account running this, as icacls expects to be given it."""
    name = os.environ.get('USERNAME')
    if name:
        return name
    try:
        return getpass.getuser()
    except (OSError, KeyError) as error:
        raise PrivacyError('Windows did not say which account you are signed in as, so a file cannot be '
                           'locked to you. Set USERNAME in your environment and run this again.') from error


def icacls(*arguments):
    """One icacls call. Every Windows access decision in this module is made through here."""
    try:
        return subprocess.run(['icacls', *arguments], capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=ICACLS_TIMEOUT)
    except (OSError, subprocess.SubprocessError) as error:
        raise PrivacyError('icacls could not be run, so file privacy cannot be applied or checked on this '
                           f'computer: {error}. icacls is part of Windows; check that the System32 folder is '
                           'on your PATH and run this again.') from error


def protect(path, executable=False):
    """Make a file or directory reachable only by the account that owns it.

    POSIX sets mode 0600, or 0700 for a directory or something meant to be run. Windows
    drops inherited access and grants this account alone, which is what 0600 means there.

    The result is then read back and checked, because a command that exits 0 has only said
    it ran. A drive that cannot keep per account permissions, a memory stick or a network
    share, takes the change and keeps the file open to everyone. Raises either way: the
    caller decides what to do, and it is never nothing.
    """
    path = Path(path)
    if windows():
        # A folder grants (OI)(CI) as well, which is what 0700 means there: what the owner
        # makes inside it is theirs too. Without it a new file inherits nothing at all.
        rights = '(OI)(CI)F' if path.is_dir() else 'F'
        result = icacls(str(path), '/inheritance:r', '/grant:r', f'{account_name()}:{rights}')
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or '').strip().replace('\n', ' ')
            raise PrivacyError(f'{path} could not be locked to your account: {detail or "icacls failed"}. '
                               'Check that you own it and that the folder it is in allows a permission '
                               'change, then run this again.')
        # Then the one entry the grant cannot reach. Its exit code is not acted on, because
        # the read back below is what decides whether this worked; on a path that never had
        # it, this is a no op.
        icacls(str(path), '/remove:g', OWNER_RIGHTS)
    elif not posix():
        raise PrivacyError(f'{path} cannot be made private on this computer, so nothing that depends on it '
                           'was written. Run this on macOS, Linux or Windows.')
    else:
        mode = DIRECTORY_MODE if path.is_dir() else EXECUTABLE_MODE if executable else FILE_MODE
        try:
            os.chmod(path, mode)
        except OSError as error:
            raise PrivacyError(f'{path} could not be made private: {error.strerror or error}. '
                               'Check that you own it, then run this again.') from error
    if not is_private(path):
        raise PrivacyError(f'{path} is still reachable by more than your own account after it was made '
                           'private, so nothing that depends on it was written. A drive that cannot keep '
                           'one account apart from another does this, such as a memory stick or a network '
                           f'share. Keep it on your own drive, or run {how_to_protect(path)} and check the '
                           f'result before running this again.{access_report(path)}')


def access_report(path):
    """What the host said about a path, for a refusal that has to be acted on remotely.

    Empty on POSIX, where the mode in the message is the whole story. On Windows it carries
    the listing icacls actually printed, because otherwise a host that disagrees with this
    code gives no way to tell which of the two is wrong.
    """
    if not windows():
        return ''
    try:
        result = icacls(str(Path(path)))
    except PrivacyError:
        return ' icacls could not be run to say what access it has.'
    listing = ' '.join(result.stdout.split())
    return f' icacls exited {result.returncode} and reported: {listing[:400]}'


def how_to_protect(path):
    """The command that makes a path private on this host, for a message someone can act on."""
    if windows():
        try:
            account = account_name()
        except PrivacyError:
            account = '%USERNAME%'
        return f'icacls "{path}" /inheritance:r /grant:r "{account}":F'
    return f'chmod 600 {path}'


def windows_principals(path, output):
    """The accounts icacls lists for a path.

    icacls prints the path, then one `ACCOUNT:(permissions)` entry per line, the first on
    the path's own line and the rest indented, and ends with a processed count. Account
    names hold spaces and backslashes, so an entry is split at the first `:(`.
    """
    principals = []
    for line in output.splitlines():
        if line.startswith(path):
            line = line[len(path):]
        line = line.strip()
        marker = line.find(':(')
        if marker > 0:
            principals.append(line[:marker].upper())
    return principals


def is_private(path, info=None):
    """Whether only this account can reach the path.

    `info` is an os.stat_result already taken from an open handle, which is how a caller
    closes the gap between the check and the read. Windows keeps access in the ACL rather
    than in the mode, so it asks icacls about the path and accepts nobody beyond this
    account, SYSTEM and Administrators. An answer it cannot read counts as not private.
    """
    path = Path(path)
    if windows():
        try:
            result = icacls(str(path))
        except PrivacyError:
            return False  # nothing said this file is private, so it is treated as though it is not
        if result.returncode != 0:
            return False
        allowed = {name.upper() for name in WINDOWS_ALWAYS_PRESENT}
        user = account_name().upper()
        principals = windows_principals(str(path), result.stdout)
        return bool(principals) and all(
            principal in allowed or principal == user or principal.rsplit('\\', 1)[-1] == user
            for principal in principals)
    if not posix():
        return False
    if info is None:
        info = os.stat(path)
    return not info.st_mode & 0o077 and info.st_uid == os.getuid()


def refuse_link(path):
    """Stop when a path is a link to somewhere else, rather than the thing itself.

    A link could point at a file that is not yours, or outside the folder being read.
    POSIX asks the kernel for this inside open_private; on Windows, and for the folders on
    the way to a file, it has to be asked here.
    """
    path = Path(path)
    if os.path.islink(path):
        raise PrivacyError(f'{path} is a link, and a link can point at something that is not yours. '
                           'Put the real file or folder there and run this again.')
    if windows():
        attributes = getattr(os.stat(path, follow_symlinks=False), 'st_file_attributes', 0)
        if attributes & stat.FILE_ATTRIBUTE_REPARSE_POINT:
            raise PrivacyError(f'{path} is a reparse point, and it can lead somewhere that is not yours. '
                               'Put the real file or folder there and run this again.')


def open_private(path):
    """Open a file for reading as bytes, refusing to follow a link to somewhere else.

    POSIX asks the kernel with O_NOFOLLOW, which leaves no gap at all. Windows has no such
    flag, so the link and the reparse point are checked first: the same refusal, with a
    gap the kernel would have closed.
    """
    path = Path(path)
    if windows():
        refuse_link(path)
        return open(path, 'rb')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        return os.fdopen(descriptor, 'rb')
    except BaseException:
        os.close(descriptor)
        raise


def make_private_directory(path, mode=DIRECTORY_MODE):
    """Create a directory this code owns, private from the moment it exists.

    The mode argument to mkdir is the POSIX half and Windows ignores it, so a folder whose
    privacy rests on that alone is not private there. Returns whether it was created: one
    that was already there is left exactly as it is, because it belongs to whoever made it,
    and the caller decides whether to accept it.
    """
    try:
        Path(path).mkdir(parents=True, mode=mode)
    except FileExistsError:
        return False
    protect(path)
    return True


def write_privately(path, body):
    """Write one private file beside its destination, then move it into place.

    It is locked to this account before the contents are written, so a token is never even
    briefly readable by anyone else, and a write that cannot be finished leaves whatever was
    there alone. newline='' because Windows text mode would turn each \n into \r\n, and the
    file would then not hold the bytes it was given.
    """
    destination = os.path.abspath(path)
    directory = os.path.dirname(destination) or '.'
    make_private_directory(directory)
    descriptor, temporary = tempfile.mkstemp(dir=directory, prefix='.private.', suffix='.new')
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='') as handle:
            protect(temporary)
            handle.write(body)
        replace_atomically(temporary, destination)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temporary)
        raise
    protect(destination)
    return destination


def replace_atomically(source, target):
    """Move a finished temporary file onto its destination, with no half written file in between.

    Close every handle on the source before calling this, and do not keep one on the
    target: Windows refuses to move a file that another process is still holding, which a
    virus scanner or a backup tool does for a moment after a write, so the move is retried
    a few times before it gives up.
    """
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            os.replace(source, target)
            return
        except OSError as error:
            held = isinstance(error, PermissionError) and getattr(error, 'winerror', None) == SHARING_VIOLATION
            if held and attempt < REPLACE_ATTEMPTS - 1:
                time.sleep(REPLACE_PAUSE)
                continue
            reason = ('another program is still holding it. Close anything that has it open, such as an '
                      'editor, a backup tool or a virus scanner, then run this again.'
                      if held else f'{error.strerror or error}.')
            raise PrivacyError(f'{target} could not be replaced with {source}: {reason}') from error
