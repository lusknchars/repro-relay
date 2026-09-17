#!/usr/bin/env python3
"""Fail when a GitHub token is committed. The rule is docs/GITHUB-ACCESS.md.

Matches real token shapes, not bare prefixes, so the protocol and this file can
name the prefixes without tripping the check.
"""
import re
import subprocess
import sys

PATTERNS = (
    ('classic', re.compile(r'gh[pousr]_[A-Za-z0-9]{36,}')),
    ('fine grained', re.compile(r'github' + r'_pat_[A-Za-z0-9_]{60,}')),
)
READ_LIMIT = 1_048_576


def findings(text):
    """(label, line number, redacted match) for every token shape in text."""
    found = []
    for number, line in enumerate(text.splitlines(), start=1):
        for label, pattern in PATTERNS:
            for match in pattern.finditer(line):
                shown = match.group(0)[:7] + '...'
                found.append((label, number, shown))
    return found


def tracked_files(root=None):
    listing = subprocess.run(['git', 'ls-files', '-z'], cwd=root, check=True,
                             capture_output=True, text=True).stdout
    return [name for name in listing.split('\0') if name]


def scan(paths, read):
    """(path, label, line, redacted) for each finding, in listing order."""
    hits = []
    for path in paths:
        text = read(path)
        if text is None:
            continue
        for label, number, shown in findings(text):
            hits.append((path, label, number, shown))
    return hits


def reader(root=None):
    def read(path):
        full = path if root is None else f'{root}/{path}'
        try:
            with open(full, 'rb') as handle:
                raw = handle.read(READ_LIMIT)
        except OSError:
            return None
        if b'\0' in raw:
            return None
        return raw.decode('utf-8', 'replace')
    return read


def main():
    hits = scan(tracked_files(), reader())
    for path, label, number, shown in hits:
        print(f'{path}:{number}: {label} GitHub token ({shown})', file=sys.stderr)
    if hits:
        print(f'{len(hits)} GitHub token(s) in tracked files. '
              'Agents hold no GitHub credential; see docs/GITHUB-ACCESS.md.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
