import json
from pathlib import Path
import tempfile
import unittest
import uuid

from core import Store, authorized, validate_config

CASE = 'RR-' + 'a' * 32
CONFIG = {'token': 'fixture-token-not-real', 'guild_id': '1234567890123456',
    'operator_ids': ['2234567890123456'], 'case_ids': [CASE], 'public_url': 'http://127.0.0.1:8178'}


class CallTests(unittest.TestCase):
    def test_authorization_scopes_server_operator_and_work(self):
        config = validate_config(CONFIG.copy())
        self.assertTrue(authorized(config, config['guild_id'], config['operator_ids'][0], CASE))
        self.assertFalse(authorized(config, 'other', config['operator_ids'][0], CASE))
        self.assertFalse(authorized(config, config['guild_id'], 'other', CASE))
        self.assertFalse(authorized(config, config['guild_id'], config['operator_ids'][0], 'other'))

    def test_configuration_rejects_unsafe_ids_and_origins(self):
        for field, value in [('guild_id', '1'), ('case_ids', ['../../secret']),
                             ('operator_ids', []), ('public_url', 'http://remote.example'),
                             ('public_url', 'https://user:password@example.com')]:
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_config({**CONFIG, field: value})

    def test_receipts_retry_same_id_and_recovery_never_rejoins(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'calls.json'
            store = Store(path)
            call = {'call_id': str(uuid.uuid4()), 'case_id': CASE, 'guild_id': CONFIG['guild_id'],
                    'channel_id': '3234567890123456', 'actor_id': CONFIG['operator_ids'][0]}
            store.data['active'] = call
            store.event(call, 'joined')
            event_id = store.data['outbox'][0]['body']['id']
            class Offline:
                def record(self, event): raise ValueError('offline')
            with self.assertRaises(ValueError): store.flush(Offline())
            recovered = Store(path)
            recovered.recover()
            self.assertIsNone(recovered.data['active'])
            self.assertEqual(recovered.data['outbox'][0]['body']['id'], event_id)
            self.assertEqual(recovered.data['outbox'][1]['body']['status'], 'disconnected')
            delivered = []
            class Online:
                def record(self, event): delivered.append(event)
            recovered.flush(Online())
            self.assertEqual(len(delivered), 2)
            self.assertEqual(Store(path).data['outbox'], [])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn('audio', json.dumps(delivered))

    def test_queue_bound(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / 'calls.json')
            store.data['outbox'] = [{}] * 1000
            with self.assertRaises(ValueError): store.event({}, 'joined')

    def test_receipt_flush_is_batched(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / 'calls.json')
            store.data['outbox'] = [{'fixture': True}] * 12
            class Online:
                def record(self, event): pass
            store.flush(Online())
            self.assertEqual(len(store.data['outbox']), 2)


if __name__ == '__main__': unittest.main()
