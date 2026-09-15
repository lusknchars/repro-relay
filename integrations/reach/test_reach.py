import unittest
from unittest.mock import Mock, patch
from contextlib import redirect_stdout
import io
from pathlib import Path
import tempfile
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
        self.assertEqual({tool['name'] for tool in reach.MANIFEST}, {'reach_events', 'reach_daily_brief', 'reach_propose_action', 'reach_discord_messages'})

    def test_discord_read_is_local_only_and_rejects_injected_paths(self):
        api = Mock()
        for args in ({'before': '../token'}, {'before': '18446744073709551616'}, {'before': None}, {'before': '1234567890123456&x=1'}, {'token': 'secret'}):
            with self.assertRaises(ValueError):
                reach.execute(api, 'reach_discord_messages', args)
        api.request.assert_not_called()
        reach.execute(api, 'reach_discord_messages', {})
        reach.execute(api, 'reach_discord_messages', {'before': '1234567890123456'})
        self.assertEqual([c.args for c in api.request.call_args_list], [('GET', '/discord/messages'), ('GET', '/discord/messages?before=1234567890123456')])

    def test_events_reject_invalid_cursors(self):
        api = Mock()
        for value in ('-1', '1&x=1', 0, '9223372036854775808', '', True):
            with self.assertRaises(ValueError):
                reach.execute(api, 'reach_events', {'after': value})
        api.request.assert_not_called()
        reach.execute(api, 'reach_events', {'after': '42'})
        api.request.assert_called_once_with('GET', '/reach/events?after=42')

    def test_listener_drains_pages_and_resumes_checkpoint(self):
        api = Mock()
        api.request.side_effect = [
            {'items': [{'cursor': '1'}], 'cursor': '1', 'has_more': True},
            {'items': [{'cursor': '2'}], 'cursor': '2', 'has_more': False},
            {'items': [], 'cursor': '2', 'has_more': False},
        ]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'checkpoint'
            output = io.StringIO()
            with redirect_stdout(output):
                reach.listen(api, checkpoint=path, once=True)
                reach.listen(api, checkpoint=path, once=True)
            self.assertEqual(path.read_text().strip(), '2')
            self.assertEqual(output.getvalue().splitlines(), ['{"cursor": "1"}', '{"cursor": "2"}'])
            self.assertEqual([c.args[1] for c in api.request.call_args_list], [
                '/reach/events?after=0', '/reach/events?after=1', '/reach/events?after=2'])

    def test_listener_retries_without_advancing_and_failed_output_does_not_checkpoint(self):
        api = Mock()
        api.request.side_effect = [OSError('offline'), {'items': [], 'cursor': '4', 'has_more': False}]
        with patch.object(reach.time, 'sleep', side_effect=[None, KeyboardInterrupt]), patch('sys.stderr', io.StringIO()):
            with self.assertRaises(KeyboardInterrupt):
                reach.listen(api, after='4')
        self.assertEqual([c.args[1] for c in api.request.call_args_list], ['/reach/events?after=4'] * 2)
        api.request.side_effect = None
        api.request.return_value = {'items': [{'cursor': '5'}], 'cursor': '5', 'has_more': False}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'cursor'
            path.write_text('4\n')
            with patch('builtins.print', side_effect=BrokenPipeError):
                with self.assertRaises(BrokenPipeError):
                    reach.listen(api, checkpoint=path, once=True)
            self.assertEqual(path.read_text(), '4\n')

    def test_mcp_rejects_send_tool_and_requires_initialize(self):
        api = Mock()
        server = reach.call.evidence.Server(api, manifest=reach.MANIFEST, executor=reach.execute, name='reach')
        self.assertIn('error', server.handle({'jsonrpc':'2.0','id':1,'method':'tools/list'}))
        server.handle({'jsonrpc':'2.0','id':2,'method':'initialize','params':{'protocolVersion':'2025-11-25'}})
        server.handle({'jsonrpc':'2.0','method':'notifications/initialized'})
        self.assertIn('error', server.handle({'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'reach_send','arguments':{}}}))
        api.request.assert_not_called()
