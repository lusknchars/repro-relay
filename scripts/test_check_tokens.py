"""Tests for the committed GitHub token check.

Token shapes are built at runtime so this file never contains one itself.
"""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('check_tokens', ROOT / 'check_tokens.py')
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)

CLASSIC = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
FINE = 'github' + '_pat_' + '11ABCDEFG0' + 'z' * 60


class Findings(unittest.TestCase):
    def test_a_classic_token_is_found_and_redacted(self):
        found = check.findings(f'token = "{CLASSIC}"')
        self.assertEqual([(label, number) for label, number, _ in found], [('classic', 1)])
        self.assertEqual(found[0][2], CLASSIC[:7] + '...')
        self.assertNotIn(CLASSIC, found[0][2])

    def test_a_fine_grained_token_is_found(self):
        found = check.findings(f'export GH_TOKEN={FINE}')
        self.assertEqual([label for label, _, _ in found], ['fine grained'])

    def test_prose_about_the_prefixes_is_not_a_token(self):
        prose = 'Never commit a token beginning with gh' + 'p_ or ' + 'github' + '_pat_.'
        self.assertEqual(check.findings(prose), [])

    def test_the_line_number_is_the_token_line(self):
        found = check.findings('first\nsecond\n' + CLASSIC)
        self.assertEqual([number for _, number, _ in found], [3])


class Scan(unittest.TestCase):
    def test_binary_and_unreadable_files_are_skipped(self):
        files = {'notes.md': f'a {CLASSIC} b', 'image.png': None, 'gone.txt': None}
        hits = check.scan(list(files), files.get)
        self.assertEqual([(path, label) for path, label, _, _ in hits], [('notes.md', 'classic')])

    def test_a_clean_tree_has_no_hits(self):
        self.assertEqual(check.scan(['a.md', 'b.py'], lambda path: 'nothing to see'), [])


class ThisRepository(unittest.TestCase):
    def test_no_tracked_file_carries_a_token(self):
        root = ROOT.parent
        hits = check.scan(check.tracked_files(root), check.reader(root))
        self.assertEqual(hits, [])


if __name__ == '__main__':
    unittest.main()
