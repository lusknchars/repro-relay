#!/usr/bin/env python3
"""What this owner wants connected, and what their own computer gives. No network."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import sys

STATES = ('available', 'needs_owner', 'unavailable')
PLATFORMS = ('macos', 'windows', 'linux')
SLUG = re.compile(r'[a-z0-9-]{1,40}\Z')
# Known credential prefixes, at the start of a word so ordinary text is safe.
# Case sensitive on purpose: every real prefix is fixed case, and ignoring case
# turned the AWS prefix into the word Asia.
PREFIXES = re.compile(r'(?<![A-Za-z0-9_])(gh[pousr]_|github_pat_|glpat-|xox[abprs]-|'
                      r'sk-|sk_live_|sk_test_|pk_live_|AKIA|ASIA|AIza|ya29\.|npm_|'
                      r'pypi-|hf_|-----BEGIN)')
RUN = re.compile(r'[A-Za-z0-9_+=-]{24,}')


def private(value, free_text=True):
    """Refuse anything shaped like a token, a password or a key. docs/GITHUB-ACCESS.md.

    The long random run only applies to free text. A topic is already limited to
    lowercase letters, digits and dashes, and a long repository name is not a secret.
    """
    runs = free_text and [run for run in RUN.findall(value)
                          if any(c.isdigit() for c in run) and any(c.isalpha() for c in run)]
    if runs or PREFIXES.search(value):
        raise ValueError('credentials are never stored here; the owner signs in themselves, '
                         'for example gh auth login in their own terminal')
    return value


def topic(value):
    if not isinstance(value, str) or not SLUG.match(value):
        raise ValueError('topic must be 1 to 40 characters of lowercase letters, '
                         'digits and dashes')
    return private(value, free_text=False)


def wanted(value):
    if value is None:
        return None
    if value not in ('yes', 'no'):
        # Never echo the value: someone could type a secret here.
        raise ValueError('wanted must be yes or no')
    return value == 'yes'


def state(value):
    if value not in STATES:
        raise ValueError('state must be ' + ', '.join(STATES))
    return value


def text(value, name, maximum):
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f'{name} must be nonempty text, at most {maximum} characters')
    return private(value.strip())


def installed():
    """The machine the owner installed from, from the environment the installer set.

    An agent installed before that variable existed has none, and so does one
    given a value nobody recognises. Both are unknown, and unknown is not macOS.
    """
    value = os.environ.get('RELAY_OWNER_PLATFORM', '').strip().lower()
    return value if value in PLATFORMS else 'unknown'


def store():
    home = os.environ.get('HERMES_HOME')
    if not home:
        raise ValueError('HERMES_HOME must name this agent installation')
    folder = Path(home) / 'relay-setup'
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    return folder / 'relay-setup.json'


def keep(value, maximum, free_text=True):
    """A stored string that is still safe to hand back, or None."""
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        return None
    try:
        return private(value.strip(), free_text=free_text)
    except ValueError:
        return None


def clean(record):
    """Rebuild from the known fields only. A file can be edited by hand or by a
    mistake, and whatever it holds is printed straight into the agent's context,
    so anything unexpected or credential shaped is dropped rather than carried."""
    items, seen = [], set()
    for one in record['items']:
        if not isinstance(one, dict):
            continue
        name = keep(one.get('topic'), 40, free_text=False)
        if name is None or not SLUG.match(name) or name in seen:
            continue
        if one.get('state') not in STATES:
            continue
        seen.add(name)
        items.append(dict(topic=name,
                          wanted=one['wanted'] if isinstance(one.get('wanted'), bool) else None,
                          state=one['state'],
                          evidence=keep(one.get('evidence'), 300),
                          checked=keep(one.get('checked'), 40)))
    return dict(owner=keep(record.get('owner'), 100), language=keep(record.get('language'), 40),
                updated=keep(record.get('updated'), 40), items=items)


def read(path):
    if not path.exists():
        return dict(owner=None, language=None, updated=None, items=[])
    damaged = ValueError('the setup record is unreadable; forget it and set up again')
    with open(path, 'rb') as handle:
        raw = handle.read(1000001)
    if len(raw) > 1000000:
        raise damaged
    try:
        record = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise damaged from None
    if not isinstance(record, dict) or not isinstance(record.get('items'), list):
        raise damaged
    return clean(record)


def write(path, record):
    record['updated'] = dt.datetime.now(dt.timezone.utc).isoformat()
    temporary = path.with_name(path.name + f'.{os.getpid()}.part')
    with open(temporary, 'w', encoding='utf-8') as handle:
        json.dump(record, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    return record


def upsert(record, args):
    """Keep one item per topic, and keep an answer that was not asked again."""
    name = topic(args.topic)
    said = state(args.state)
    answer = wanted(args.wanted)
    evidence = text(args.evidence, 'evidence', 300)
    item = next((one for one in record['items'] if one['topic'] == name), None)
    if item is None:
        item = dict(topic=name, wanted=None, state=said, evidence=None, checked=None)
        record['items'].append(item)
    item['state'] = said
    item['checked'] = dt.datetime.now(dt.timezone.utc).isoformat()
    if answer is not None:
        item['wanted'] = answer
    if evidence is not None:
        item['evidence'] = evidence
    return item


def execute(args):
    if args.command == 'platform':
        # Reading the environment needs no record, so it answers even when the
        # home is missing. An agent that cannot get an answer here guesses.
        return {'platform': installed()}
    path = store()
    if args.command == 'forget':
        held = path.exists()
        path.unlink(missing_ok=True)
        return {'saved': True, 'forgotten': held}
    record = read(path)
    if args.command == 'show':
        return record
    if args.command == 'owner':
        record['owner'] = text(args.name, 'name', 100)
        language = text(args.language, 'language', 40)
        if language is not None:
            record['language'] = language
        write(path, record)
        return {'saved': True, 'owner': record['owner'], 'language': record['language']}
    item = upsert(record, args)
    write(path, record)
    return {'saved': True, 'item': item}


def main(argv=None):
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    commands.add_parser('show', help='the whole record, empty when there is none')
    commands.add_parser('platform', help='the machine the owner installed from: '
                                         + ', '.join(PLATFORMS) + ' or unknown')
    entry = commands.add_parser('record', help='save one answer as it comes')
    entry.add_argument('--topic', required=True, help='short slug, for example github')
    entry.add_argument('--state', required=True, help=' or '.join(STATES))
    entry.add_argument('--wanted', help='what the person answered, yes or no')
    entry.add_argument('--evidence', help='one sentence naming what proved it')
    who = commands.add_parser('owner', help='who this is and the language they use')
    who.add_argument('--name', required=True, help='the name they gave')
    who.add_argument('--language', help='the language they write in')
    commands.add_parser('forget', help='delete the record, for setting up again')
    args = parser.parse_args(argv)
    try:
        print(json.dumps(execute(args), ensure_ascii=False))
        return 0
    except (ValueError, OSError) as error:
        # Storage errors can carry paths; expose only validation messages.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        print(json.dumps({'saved': False, 'error': message}), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
