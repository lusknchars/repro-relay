import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('relay_memory', pathlib.Path(__file__).with_name('memory.py'))
memory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(memory)


class Remote:
    def __init__(self):
        self.records = []
        self.writes = 0
        self.fail = False

    def call(self, args):
        if args[0] == 'add':
            self.writes += 1
            record = {'memory': args[1], 'metadata': json.loads(args[args.index('--metadata') + 1])}
            self.records.append(record)
            assert '--no-infer' in args and '--immutable' in args
            if self.fail:
                raise ValueError('Uncertain provider outcome')
            return [{'id': 'fixture', 'event': 'ADD'}]
        if self.fail:
            raise ValueError('Offline')
        assert args[args.index('--fields') + 1] == 'id,memory,metadata'
        return copy.deepcopy(self.records)  # Deliberately ignores provider filters.


class API:
    def __init__(self):
        self.items = []
        self.reads = 0

    def call(self, path):
        self.reads += 1
        assert path.startswith('/memories?') and 'project=Repro+Relay' in path
        return copy.deepcopy(self.items)


class MemoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = pathlib.Path(self.temp.name)
        (self.path / 'config.json').write_text(json.dumps({'installation_id': 'relay-' + 'a' * 32, 'project': 'Repro Relay', 'api': 'http://127.0.0.1:8178/api/v1'}))
        self.remote, self.api = Remote(), API()
        self.pi = memory.Memory('pi', self.path, self.remote, self.api)
        self.hermes = memory.Memory('hermes', self.path, self.remote, self.api)

    def tearDown(self):
        self.pi.close()
        self.hermes.close()
        self.temp.cleanup()

    def test_agent_and_project_isolation_even_when_provider_ignores_filters(self):
        self.pi.remember('Pi draft')
        self.hermes.remember('Hermes draft')
        self.remote.records.append({'memory': 'Pi draft', 'metadata': {**self.remote.records[0]['metadata'], 'project': 'Other'}})
        found = self.pi.recall('draft')['private_notes']
        self.assertEqual([item['text'] for item in found], ['Pi draft'])
        self.assertFalse(found[0]['verified'])
        self.assertEqual([item['text'] for item in self.hermes.recall('draft')['private_notes']], ['Hermes draft'])

    def test_provider_cannot_relabel_an_old_project_note(self):
        self.pi.remember('Old project draft')
        self.pi.project = 'Other'
        self.remote.records[0]['metadata']['project'] = 'Other'
        # The journal ID binds the original project even if metadata is relabeled.
        from unittest.mock import patch
        with patch.object(self.api, 'call', return_value=[]):
            self.assertEqual(self.pi.recall('draft')['private_notes'], [])

    def test_uncertain_write_is_not_resent_and_search_reconciles(self):
        self.remote.fail = True
        result = self.pi.remember('A tentative note')
        self.assertEqual(result['state'], 'uncertain')
        self.pi.remember('A tentative note')
        self.assertEqual(self.remote.writes, 1)
        self.remote.fail = False
        self.assertEqual(len(self.pi.recall('tentative')['private_notes']), 1)
        self.assertEqual(self.pi.remember('A tentative note')['state'], 'accepted')
        self.assertEqual(self.remote.writes, 1)

    def test_forgotten_or_changed_notes_do_not_return(self):
        result = self.pi.remember('Original note')
        self.remote.records[0]['memory'] = 'Changed provider claim'
        self.assertEqual(self.pi.recall('note')['private_notes'], [])
        self.remote.records[0]['memory'] = 'Original note'
        self.pi.forget(result['note_id'])
        self.assertEqual(self.pi.recall('note')['private_notes'], [])
        self.assertEqual(self.pi.remember('Original note')['state'], 'forgotten')

    def test_reviewed_sources_are_fresh_project_scoped_and_exclude_current_case(self):
        base = {'project': 'Repro Relay', 'kind': 'reviewed_observation', 'revision': 1}
        self.api.items = [{**base, 'case_id': 'self'}, {**base, 'case_id': 'permission-cause'},
                          {**base, 'case_id': 'state-cause'}, {**base, 'case_id': 'other', 'project': 'Other'}]
        result = self.pi.recall('same symptom', 'self')
        self.assertEqual([item['case_id'] for item in result['reviewed_project_observations']], ['permission-cause', 'state-cause'])
        self.api.items = []  # Source service has invalidated stale/revoked records.
        self.assertEqual(self.pi.recall('same symptom')['reviewed_project_observations'], [])
        self.assertEqual(self.api.reads, 2)

    def test_live_search_shape_fetches_metadata_and_rejects_other_agent(self):
        from unittest.mock import patch
        self.pi.remember('Private Pi note')
        self.hermes.remember('Private Hermes note')
        records = copy.deepcopy(self.remote.records)
        for index, record in enumerate(records):
            record['id'] = str(index) * 8 + '-1111-1111-1111-111111111111'
        def call(args):
            if args[0] == 'search':
                return [{'id': record['id'], 'memory': record['memory']} for record in records]
            return next(record for record in records if record['id'] == args[1])
        with patch.object(self.remote, 'call', side_effect=call):
            found = self.pi.recall('private')['private_notes']
        self.assertEqual([item['text'] for item in found], ['Private Pi note'])

    def test_local_reviewed_lookup_survives_mem0_failure(self):
        self.remote.fail = True
        self.api.items = [{'project': 'Repro Relay', 'kind': 'reviewed_observation', 'case_id': 'fresh'}]
        result = self.pi.recall('fresh')
        self.assertEqual(len(result['reviewed_project_observations']), 1)
        self.assertTrue(result['errors'])

    def test_tools_cannot_override_agent_or_scope(self):
        for name, args in [('relay_memory_remember', {'text': 'note', 'agent': 'hermes'}),
                           ('relay_memory_recall', {'query': 'note', 'project': 'Other'}),
                           ('relay_memory_remember', {'text': 'a' * 2001}),
                           ('relay_memory_recall', {'query': '', 'exclude_case': ''})]:
            with self.assertRaises(ValueError):
                memory.execute(self.pi, name, args)
        self.assertEqual(self.remote.writes, 0)

    def test_mcp_handshake_and_memory_annotations(self):
        server = memory.Server(self.pi, memory.MANIFEST, memory.execute, 'relay-memory-pi')
        def call(method, params=None):
            return server.handle({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params or {}})
        self.assertIn('error', call('tools/list'))
        call('initialize', {'protocolVersion': '2025-11-25'})
        server.handle({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        tools = call('tools/list')['result']['tools']
        self.assertEqual(len(tools), 2)
        self.assertFalse(tools[1]['annotations']['readOnlyHint'])
        self.assertTrue(call('tools/call', {'name': 'relay_memory_recall', 'arguments': {'query': 'x', 'agent': 'hermes'}})['result']['isError'])


if __name__ == '__main__':
    unittest.main()
