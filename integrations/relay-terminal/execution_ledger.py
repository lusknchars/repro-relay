"""Deterministic observation ledger. No model calls and no arbitrary execution."""
import hashlib
import contextlib
import json
import os
import pathlib
import sqlite3
import stat
import time
import uuid

import private_files

MAX_FILE = 2 * 1024 * 1024
MAX_RECORDS = 1000


def observe(descriptor):
    """Read an already opened file, and refuse what changed while it was being read.

    The size and both timestamps are taken before and after, so an edit that lands mid read
    is reported rather than recorded as an observation of something that no longer exists.
    """
    before = os.fstat(descriptor)
    if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_FILE:
        raise ValueError('Ledger reads require a regular file no larger than 2 MiB.')
    chunks = []
    size = 0
    while size <= MAX_FILE:
        chunk = os.read(descriptor, min(65536, MAX_FILE + 1 - size))
        if not chunk: break
        chunks.append(chunk); size += len(chunk)
    after = os.fstat(descriptor)
    if size > MAX_FILE or (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError('File changed during observation. Read it again.')
    data = b''.join(chunks)
    if b'\0' in data:
        raise ValueError('Binary files are not supported by ledger reads.')
    data.decode('utf8')
    return data


class Ledger:
    def __init__(self, worktree, database, anchor):
        self.root = pathlib.Path(worktree).resolve(strict=True)
        self.database = pathlib.Path(database).absolute()
        if any(path.is_symlink() for path in [self.database, *self.database.parents]):
            raise ValueError('Ledger storage must not traverse symlinks.')
        self.database = self.database.resolve()
        if self.database.is_relative_to(self.root):
            raise ValueError('Keep the ledger outside the repair checkout.')
        self.database.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.database.is_symlink():
            raise ValueError('Ledger database must not be a symlink.')
        self.anchor = anchor
        self.identity = hashlib.sha256((str(self.root) + '\0' + json.dumps(anchor, sort_keys=True)).encode()).hexdigest()
        with self.connect() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, fingerprint TEXT, changes INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS actions (id TEXT PRIMARY KEY, at REAL NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
            ''')
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute("SELECT value FROM metadata WHERE key='identity'").fetchone()
            if previous and previous[0] != self.identity:
                raise ValueError('Ledger belongs to another worktree or repair contract.')
            db.execute("INSERT OR IGNORE INTO metadata VALUES('identity', ?)", (self.identity,))
        private_files.protect(self.database)

    @contextlib.contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=10)
        try:
            db.execute('PRAGMA busy_timeout=10000')
            with db:
                yield db
        finally:
            db.close()

    def content(self, relative):
        path = pathlib.PurePosixPath(relative)
        if (not relative or path.is_absolute() or '\\' in relative or ':' in relative
                or any(part in {'', '.', '..', '.git'} for part in relative.split('/'))):
            raise ValueError('Use a relative file path inside the worktree, outside .git.')
        if private_files.windows():
            return self.windows_content(path)
        if not hasattr(os, 'O_NOFOLLOW') or os.open not in os.supports_dir_fd:
            raise ValueError('Protected ledger reads currently require a POSIX host with no-follow file access.')
        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptor = None
        try:
            for part in path.parts[:-1]:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
                os.close(directory); directory = child
            descriptor = os.open(path.parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
            return observe(descriptor)
        finally:
            if descriptor is not None: os.close(descriptor)
            os.close(directory)

    def windows_content(self, path):
        """The same read, made with the refusals Windows can make.

        Windows has no O_NOFOLLOW and no directory descriptors, so each folder on the way is
        refused if it is a link or a reparse point before the next one is opened, and the
        file itself is opened through the same refusal. A link swapped in between the check
        and the open is the one thing the descriptor walk stops and this cannot.
        """
        walked = self.root
        for part in path.parts[:-1]:
            walked = walked / part
            private_files.refuse_link(walked)
            if not walked.is_dir():
                raise ValueError('Use a relative file path inside the worktree, outside .git.')
        with private_files.open_private(walked / path.parts[-1]) as handle:
            return observe(handle.fileno())

    def sync(self, db, path, fingerprint):
        previous = db.execute('SELECT fingerprint, changes FROM files WHERE path=?', (path,)).fetchone()
        changes = previous[1] + (previous[0] != fingerprint) if previous else 0
        if previous and previous[0] != fingerprint:
            self.record(db, 'file_changed', {'path': path, 'before_sha256': previous[0],
                                           'after_sha256': fingerprint, 'change_counter': changes,
                                           'source': 'observed_at_boundary', 'actor': 'unknown'})
        db.execute('INSERT INTO files VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET fingerprint=excluded.fingerprint, changes=excluded.changes', (path, fingerprint, changes))
        return changes

    def record(self, db, kind, payload):
        if db.execute('SELECT COUNT(*) FROM actions').fetchone()[0] >= MAX_RECORDS:
            raise ValueError('Ledger reached 1,000 records. Preserve it and begin a new repair contract.')
        record_id = 'LED-' + uuid.uuid4().hex
        db.execute('INSERT INTO actions VALUES(?,?,?,?)', (record_id, time.time(), kind, json.dumps(payload, sort_keys=True)))
        return record_id

    def read(self, relative, start=1, end=200, visible=()):
        if type(start) is not int or type(end) is not int or start < 1 or end < start or end - start >= 200:
            raise ValueError('Request 1 to 200 lines, starting at line 1 or later.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            data = self.content(relative)
            fingerprint = hashlib.sha256(data).hexdigest()
            changes = self.sync(db, relative, fingerprint)
            lines = data.decode('utf8').splitlines(keepends=True)
            text = ''.join(lines[start - 1:end])
            if len(text.encode()) > 65536:
                raise ValueError('Requested lines exceed 64 KiB. Use a smaller range.')
            request = {'path': relative, 'start': start, 'end': end, 'sha256': fingerprint, 'change_counter': changes}
            # Reference-only reuse requires both exact freshness and caller-declared context visibility.
            for record_id in list(visible)[:100]:
                row = db.execute("SELECT payload FROM actions WHERE id=? AND kind='read'", (record_id,)).fetchone()
                if row:
                    old = json.loads(row[0])
                    if old['request'] == request:
                        result = {'decision': 'reuse', 'receipt_id': record_id, 'request': request,
                                  'reason': 'Exact file content and range are unchanged; caller declared this receipt visible.',
                                  'freshness': 'checked_at_read_boundary', 'model_calls': 0}
                        result['decision_id'] = self.record(db, 'reuse', result)
                        return result
            result = {'decision': 'allow', 'request': request, 'content': text,
                      'covered_lines': [start, min(end, len(lines))] if start <= len(lines) else None,
                      'freshness': 'checked_at_read_boundary', 'model_calls': 0}
            record_id = self.record(db, 'read', result)
            result['receipt_id'] = record_id
            return result

    def inform(self):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for path, in db.execute('SELECT path FROM files').fetchall():
                try: fingerprint = hashlib.sha256(self.content(path)).hexdigest()
                except (OSError, ValueError): fingerprint = None
                self.sync(db, path, fingerprint)
            files = {row[0]: {'sha256': row[1], 'changes': row[2]} for row in db.execute('SELECT * FROM files')}
            rows = db.execute("SELECT id,payload FROM actions WHERE kind='read' ORDER BY rowid DESC LIMIT 20").fetchall()
            observations = []
            for record_id, payload in rows:
                request = json.loads(payload)['request']
                current = files[request['path']]
                observations.append({'receipt_id': record_id, **request,
                                     'fresh': current['sha256'] is not None and current['sha256'] == request['sha256'] and current['changes'] == request['change_counter']})
            commands = []
            for record_id, kind, payload in db.execute("SELECT id,kind,payload FROM actions WHERE kind IN ('command_proposed','command_outcome') ORDER BY rowid DESC LIMIT 10"):
                action = json.loads(payload)
                if kind == 'command_proposed':
                    commands.append({'receipt_id': record_id, 'kind': kind, 'category': action['category'],
                                     'argv_preview': [arg[:120] for arg in action['argv'][:6]],
                                     'full_command_in_history': True, 'executed': False, 'decision': action['decision']})
                else:
                    commands.append({'receipt_id': record_id, 'kind': kind, 'proposal_id': action['proposal_id'],
                                     'exit_code': action['exit_code'], 'provenance': action['provenance'],
                                     'independently_verified': False, 'output_in_history': True})
            counts = dict(db.execute('SELECT kind,COUNT(*) FROM actions GROUP BY kind'))
            return {'schema_version': 1, 'anchor': self.anchor, 'worktree': str(self.root),
                    'observations': observations, 'observed_files': files,
                    'commands': commands, 'read_decisions': {'returned': counts.get('read', 0), 'reused': counts.get('reuse', 0)},
                    'observed_change_count': sum(f['changes'] for f in files.values()),
                    'records': db.execute('SELECT COUNT(*) FROM actions').fetchone()[0],
                    'coverage': 'Only files inspected through this ledger. Hashes are checked now; later edits can invalidate them.',
                    'model_calls': 0, 'runtime_hook_connected': False}

    def govern_command(self, argv, category='unknown'):
        if category not in {'test', 'search', 'modify', 'unknown'} or not isinstance(argv, list) or not 1 <= len(argv) <= 40 or any(not isinstance(arg, str) or not arg or len(arg) > 1000 or '\0' in arg for arg in argv):
            raise ValueError('Supply a typed category and 1 to 40 nonempty command arguments.')
        # Generic command dependencies and runtime context are unknown. Never suppress execution.
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            identity = json.dumps({'argv': argv, 'category': category}, sort_keys=True)
            prior = db.execute("SELECT id FROM actions WHERE kind='command_proposed' AND json_extract(payload, '$.identity')=? ORDER BY rowid DESC LIMIT 1", (identity,)).fetchone()
            result = {'decision': 'nudge' if prior else 'allow', 'execute_required': True,
                      'authorized': False, 'reason': 'Repeated proposal; still execute if the repair runtime authorizes it.' if prior else 'Apply the repair runtime permissions before execution.',
                      'argv': argv, 'category': category, 'identity': identity,
                      'prior_proposal': prior[0] if prior else None, 'executed': False, 'model_calls': 0}
            result['receipt_id'] = self.record(db, 'command_proposed', result)
            return result

    def outcome(self, proposal_id, exit_code, output):
        if type(exit_code) is not int or not -255 <= exit_code <= 255 or not isinstance(output, str) or len(output.encode()) > 65536:
            raise ValueError('Supply an exit code from -255 to 255 and at most 64 KiB of output.')
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            if not db.execute("SELECT id FROM actions WHERE id=? AND kind='command_proposed'", (proposal_id,)).fetchone():
                raise ValueError('Command proposal is not in this ledger.')
            previous = db.execute("SELECT id,payload FROM actions WHERE kind='command_outcome' AND json_extract(payload, '$.proposal_id')=?", (proposal_id,)).fetchone()
            result = {'proposal_id': proposal_id, 'exit_code': exit_code, 'output': output,
                      'provenance': 'caller_reported', 'independently_verified': False}
            if previous:
                if json.loads(previous[1]) != result:
                    raise ValueError('An outcome is already recorded. Preserve it and create a new command proposal.')
                result['receipt_id'] = previous[0]
                return result
            result['receipt_id'] = self.record(db, 'command_outcome', result)
            return result

    def history(self, after=0, limit=50):
        if type(after) is not int or after < 0 or type(limit) is not int or not 1 <= limit <= 50:
            raise ValueError('Use a nonnegative history cursor and a limit from 1 to 50.')
        with self.connect() as db:
            rows = db.execute('SELECT rowid,id,at,kind,payload FROM actions WHERE rowid>? ORDER BY rowid LIMIT ?', (after, limit + 1)).fetchall()
            return {'items': [{'cursor': row[0], 'id': row[1], 'at': row[2], 'kind': row[3], 'payload': json.loads(row[4])} for row in rows[:limit]],
                    'next_cursor': rows[limit - 1][0] if len(rows) > limit else None}
