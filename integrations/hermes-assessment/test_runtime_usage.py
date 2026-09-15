import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from runtime_usage import read_usage


class RuntimeUsageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)

    def ledger(self):
        conn = sqlite3.connect(self.home / 'state.db')
        conn.execute('CREATE TABLE session_model_usage (model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, api_call_count INTEGER, last_seen REAL, actual_cost_usd REAL, cost_status TEXT)')
        conn.execute("INSERT INTO session_model_usage VALUES ('test-model', 100, 25, 50, 0, 1, 1789500000, 0, 'unknown')")
        conn.commit()
        return conn

    def test_reads_real_counters_without_double_counting_or_writes(self):
        conn = self.ledger()
        conn.close()
        db = self.home / 'state.db'
        before = db.read_bytes()
        (self.home / '.env').write_text('SECRET=never-returned')
        first, second = read_usage(self.home), read_usage(self.home)
        self.assertEqual(first['totals'], second['totals'])
        self.assertEqual(first['totals']['total_tokens'], 175)
        self.assertEqual(first['totals']['model_calls'], 1)
        self.assertIsNone(first['cost_usd'])
        self.assertEqual(db.read_bytes(), before)
        self.assertNotIn('never-returned', json.dumps(first))
        self.assertEqual(first['last_activity_at'], '2026-09-15T19:20:00+00:00')

    def test_changes_replace_snapshots_and_group_models(self):
        with self.ledger() as conn:
            first = read_usage(self.home)
            conn.execute('UPDATE session_model_usage SET input_tokens=120')
            conn.execute("INSERT INTO session_model_usage VALUES ('second', 20, 5, 0, 0, 1, 1789500001, 0, 'unknown')")
        second = read_usage(self.home)
        self.assertEqual(first['totals']['total_tokens'], 175)
        self.assertEqual(second['totals']['total_tokens'], 220)
        self.assertEqual(len(second['models']), 2)

    def test_missing_empty_and_incompatible_ledgers(self):
        self.assertFalse(read_usage(self.home)['available'])
        self.assertFalse((self.home / 'state.db').exists())
        with self.ledger() as conn:
            conn.execute('DELETE FROM session_model_usage')
        self.assertEqual(read_usage(self.home)['totals']['total_tokens'], 0)
        with sqlite3.connect(self.home / 'state.db') as conn:
            conn.execute('DROP TABLE session_model_usage')
        with self.assertRaises(ValueError): read_usage(self.home)

    def test_partial_negative_or_oversized_counters_are_not_zero(self):
        with self.ledger() as conn:
            for value in (None, -1, 1.5, 9007199254740992):
                conn.execute('UPDATE session_model_usage SET input_tokens=?', (value,))
                conn.commit()
                with self.assertRaises(ValueError): read_usage(self.home)

    def test_aggregate_overflow_is_rejected(self):
        with self.ledger() as conn:
            conn.execute('UPDATE session_model_usage SET input_tokens=9007199254740991')
        with self.assertRaises(ValueError): read_usage(self.home)

if __name__ == '__main__': unittest.main()
