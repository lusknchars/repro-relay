#!/usr/bin/env python3
"""Conversation-scoped Reach task receipts. Standard library only, no network."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid


def text(value, name, maximum=500, optional=False):
    if value is None and optional:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f'{name} must be nonempty text, at most {maximum} characters')
    return value.strip()


def due(value):
    if value is None:
        return None
    if not isinstance(value, str) or dt.date.fromisoformat(value).isoformat() != value:
        raise ValueError('due must be YYYY-MM-DD')
    return value


def connect():
    home = os.environ.get('HERMES_HOME')
    if not home:
        raise ValueError('HERMES_HOME must name this agent installation')
    folder = Path(home) / 'relay-reach'
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = sqlite3.connect(folder / 'tasks.sqlite3', timeout=10)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
    CREATE TABLE IF NOT EXISTS sources (
      scope TEXT NOT NULL, id TEXT NOT NULL, digest TEXT NOT NULL,
      PRIMARY KEY(scope,id));
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, scope TEXT NOT NULL, source_id TEXT NOT NULL,
      title TEXT NOT NULL, source_quote TEXT NOT NULL, owner TEXT, role TEXT,
      due TEXT, status TEXT NOT NULL CHECK(status IN ('open','done')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(scope,source_id) REFERENCES sources(scope,id));
    ''')
    return db


def import_tasks(db, scope, payload):
    if not isinstance(payload, dict):
        raise ValueError('input must be a JSON object')
    source_id = text(payload.get('source_id'), 'source_id', 256)
    source = text(payload.get('source_text'), 'source_text', 200000)
    items = payload.get('items')
    if not isinstance(items, list) or not 1 <= len(items) <= 100:
        raise ValueError('items must contain 1 to 100 tasks')
    rows = []
    for item in items:
        if not isinstance(item, dict):
            raise ValueError('each item must be an object')
        quote = text(item.get('source_quote'), 'source_quote', 10000)
        if quote not in source:
            raise ValueError('source_quote must occur exactly in source_text')
        rows.append(dict(title=text(item.get('title'), 'title'), source_quote=quote,
                         owner=text(item.get('owner'), 'owner', optional=True),
                         role=text(item.get('role'), 'role', optional=True),
                         due=due(item.get('due'))))
    digest = hashlib.sha256(json.dumps({'source': source, 'items': rows},
                             sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with db:
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT digest FROM sources WHERE scope=? AND id=?',
                         (scope, source_id)).fetchone()
        if old:
            if old['digest'] != digest:
                raise ValueError('source ID already saved with different content; update a task')
        else:
            db.execute('INSERT INTO sources VALUES (?,?,?)', (scope, source_id, digest))
            for item in rows:
                db.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                           (uuid.uuid4().hex[:16], scope, source_id, item['title'],
                            item['source_quote'], item['owner'], item['role'], item['due'],
                            'open', now, now))
        saved = db.execute('SELECT * FROM tasks WHERE scope=? AND source_id=? ORDER BY rowid',
                           (scope, source_id)).fetchall()
    return {'saved': True, 'replayed': bool(old), 'tasks': [dict(row) for row in saved]}


def execute(args):
    scope = text(args.scope, 'scope', 256)
    with connect() as db:
        if args.command == 'import':
            with open(args.file, 'rb') as f:
                data = f.read(1000001)
            if len(data) > 1000000:
                raise ValueError('input exceeds 1 MB')
            return import_tasks(db, scope, json.loads(data))
        if args.command == 'list':
            sql, params = 'SELECT * FROM tasks WHERE scope=?', [scope]
            if not args.all:
                sql += " AND status='open'"
            if args.owner:
                sql += ' AND owner=?'
                params.append(args.owner)
            if args.through:
                sql += ' AND (due IS NULL OR due<=?)'
                params.append(due(args.through))
            sql += ' ORDER BY due IS NULL, due, created_at, id'
            return {'tasks': [dict(row) for row in db.execute(sql, params)]}
        updates = {}
        for field in ('owner', 'role', 'due'):
            value = getattr(args, field)
            if getattr(args, 'clear_' + field):
                updates[field] = None
            elif value is not None:
                updates[field] = due(value) if field == 'due' else text(value, field)
        if args.status:
            updates['status'] = args.status
        if not updates:
            raise ValueError('choose a field to update')
        updates['updated_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
        with db:
            result = db.execute('UPDATE tasks SET ' + ','.join(k + '=?' for k in updates)
                                + ' WHERE id=? AND scope=?', [*updates.values(), args.id, scope])
            if result.rowcount != 1:
                raise ValueError('task not found in this conversation')
            row = db.execute('SELECT * FROM tasks WHERE id=? AND scope=?',
                             (args.id, scope)).fetchone()
        return {'saved': True, 'task': dict(row)}


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scope', required=True, help='trusted current conversation ID')
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('import').add_argument('file', help='source and extracted items JSON')
    listing = commands.add_parser('list')
    listing.add_argument('--owner')
    listing.add_argument('--through')
    listing.add_argument('--all', action='store_true')
    update = commands.add_parser('update')
    update.add_argument('id')
    for field in ('owner', 'role', 'due'):
        group = update.add_mutually_exclusive_group()
        group.add_argument('--' + field)
        group.add_argument('--clear-' + field, action='store_true')
    update.add_argument('--status', choices=['open', 'done'])
    args = parser.parse_args(argv)
    try:
        print(json.dumps(execute(args), ensure_ascii=False))
        return 0
    except (ValueError, OSError, sqlite3.Error) as error:
        # Storage errors can contain paths; expose only validation messages.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        print(json.dumps({'saved': False, 'error': message}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
