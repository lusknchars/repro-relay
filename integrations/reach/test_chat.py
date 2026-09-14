import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, MagicMock
import uuid
import chat
import reach

class ChatTests(unittest.TestCase):
    def test_tools_only_read_pending_and_answer_one_request(self):
        api=Mock()
        chat.execute(api,'hermes_team_inbox',{})
        api.request.assert_called_once_with('GET','/chat/pending')
        body={'request_id':str(uuid.uuid4()),'reply_id':str(uuid.uuid4()),'body':'Consider the due date first.'}
        chat.execute(api,'hermes_team_reply',body)
        api.request.assert_called_with('POST','/chat/replies',body)
        for name,args in [('execute',{}),('hermes_team_reply',{**body,'approve':True}),('hermes_team_reply',{**body,'request_id':1})]:
            with self.assertRaises(ValueError): chat.execute(api,name,args)

    def test_capability_is_scoped_and_requires_secure_remote_origin(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'key.json'
            for base in ['http://public.example/api/v1','https://user:secret@example.com/api/v1','https://example.com/api/v1?redirect=x','https://example.com/other']:
                path.write_text(json.dumps({'api':base,'token':'a'*64}))
                with self.assertRaises(ValueError): chat.API(path,reach.call.evidence)
            path.write_text(json.dumps({'api':'https://team.example.com/api/v1','token':'a'*64}))
            api=chat.API(path,reach.call.evidence)
            with self.assertRaises(ValueError): api.request('POST','/chat/bridge',{})
            with self.assertRaises(ValueError): api.request('GET','/cases')
            api.opener=MagicMock()
            response=api.opener.open.return_value.__enter__.return_value
            response.read.return_value=b'{"items":[]}'
            self.assertEqual(api.request('GET','/chat/pending'),{'items':[]})
            request=api.opener.open.call_args.args[0]
            self.assertEqual(request.get_header('Origin'),'https://team.example.com')
            self.assertEqual(request.get_header('X-relay-chat-key'),'a'*64)

    def test_agent_handshake_does_not_offer_member_or_execution_tools(self):
        server=reach.call.evidence.Server(Mock(),manifest=chat.MANIFEST,executor=chat.execute,name='hermes-team-chat')
        server.handle({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25'}})
        server.handle({'jsonrpc':'2.0','method':'notifications/initialized'})
        result=server.handle({'jsonrpc':'2.0','id':2,'method':'tools/list'})
        self.assertEqual({t['name'] for t in result['result']['tools']},{'hermes_team_inbox','hermes_team_reply'})
