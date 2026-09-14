import unittest
from unittest.mock import Mock
import reach

class ReachTests(unittest.TestCase):
    def test_daily_brief_is_bounded_by_day_and_rejects_remote(self):
        api = Mock()
        reach.execute(api, 'reach_daily_brief', {'on': '2026-09-14'})
        api.request.assert_called_once_with('GET', '/reach?on=2026-09-14')
        for value in ('2026-09-14&x=1', '2026-02-31', None):
            with self.assertRaises(ValueError):
                reach.execute(api, 'reach_daily_brief', {'on': value})
        with self.assertRaises(ValueError):
            reach.call.API('https://example.com/api/v1')

    def test_proposals_cannot_inject_decisions_or_paths(self):
        api = Mock()
        args = {'id': 'calendar-11111111-1111-4111-8111-111111111111', 'on': '2026-09-14', 'version': 0,
                'source_hash': 'a'*64, 'title': 'Test viewer access', 'member_id': None, 'due_on': None}
        reach.execute(api, 'reach_propose_action', args)
        self.assertEqual(api.request.call_args.args[2]['status'], 'proposed')
        for bad in ({**args, 'status': 'planned'}, {**args, 'id': '../decision'}):
            with self.assertRaises(ValueError):
                reach.execute(api, 'reach_propose_action', bad)
        self.assertEqual({tool['name'] for tool in reach.MANIFEST}, {'reach_daily_brief', 'reach_propose_action'})

    def test_mcp_rejects_send_tool_and_requires_initialize(self):
        api = Mock()
        server = reach.call.evidence.Server(api, manifest=reach.MANIFEST, executor=reach.execute, name='reach')
        self.assertIn('error', server.handle({'jsonrpc':'2.0','id':1,'method':'tools/list'}))
        server.handle({'jsonrpc':'2.0','id':2,'method':'initialize','params':{'protocolVersion':'2025-11-25'}})
        server.handle({'jsonrpc':'2.0','method':'notifications/initialized'})
        self.assertIn('error', server.handle({'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'reach_send','arguments':{}}}))
        api.request.assert_not_called()
