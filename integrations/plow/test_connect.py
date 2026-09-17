import contextlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import urllib.parse
import urllib.request
import connect
from bridge import BridgeError


def pinned_client():
    """The real pinned plow-agents client, loaded as the installer loads it: verified cache or verified download."""
    spec = importlib.util.spec_from_file_location('plow_agent', Path(__file__).resolve().parents[1] / 'relay-terminal/plow_agent.py')
    installer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(installer)
    return installer.official()


class FakePlow:
    """Plow's API behind the pinned client: an owner chat on one free line, and an agent created with its token."""
    def __init__(self):
        self.sent = []
    def request(self, method, url, **options):
        path = urllib.parse.urlsplit(url).path
        self.sent.append((method, path))
        if (method, path) == ('GET', '/v1/chats'):
            return 200, {'data': [{'status': 'active', 'participants': [{'type': 'agent', 'relationship': 'self', 'line': {'uid': 'ln_free'}}]}]}
        if (method, path) == ('GET', '/v1/lines'):
            return 200, {'data': [{'uid': 'ln_free', 'agent_uid': None, 'display_name': 'Fixture assistant'}]}
        if (method, path) == ('POST', '/v1/agents'):
            return 201, {'agent': {'uid': 'ag_new'}, 'token': 'agt_fixture_token'}
        return 204, None
    def call(self, method, base, path, **options):
        return self.request(method, base + path, **options)[1]
    @contextlib.contextmanager
    def behind(self, client):
        def refuse(*arguments, **options):
            raise AssertionError('A test tried to reach the network.')
        # run_path returns a copy of the client's globals; its functions read the original dict.
        with patch.dict(client['mint'].__globals__, {'call': self.call, 'request': self.request}), patch.object(urllib.request, 'urlopen', refuse), patch.object(urllib.request.OpenerDirector, 'open', refuse):
            yield

class AutoConnectTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        (self.root/'.data/tools').mkdir(parents=True)
        (self.root/'.data/tools/plow-agents').touch()
        (self.root/'.data/plow-credentials').touch()
        self.official={'account_token':Mock(return_value='fixture-private-token'),
                       'account_lines':Mock(return_value=[{'uid':'ln_fixture','agent_uid':'agent_fixture','display_name':'Fixture assistant'}]),'mint':Mock()}
        self.client=Mock()
        self.client.call.side_effect=[(200,{'line':{'uid':'ln_fixture'}}),(200,{'has_more':False,'data':[{'uid':'cht_fixture','status':'active','participants':[{'type':'agent','relationship':'self','line':{'uid':'ln_fixture','provider_type':'imessage'}},{'type':'member','role':'owner'}]}]})]
        self.bridge=Mock();self.bridge.doctor.return_value={'plow_grant_checked':True}
        for item in [patch.object(connect,'ROOT',self.root),patch.object(connect.runpy,'run_path',return_value=self.official),patch.object(connect,'private_credentials',return_value='fixture-private-token'),patch.object(connect,'JsonHTTP',return_value=self.client),patch.object(connect,'from_config',return_value=self.bridge)]:
            item.start();self.addCleanup(item.stop)
    def test_binds_existing_credential_without_reprovisioning_or_exposing_it(self):
        result=connect.connect()
        saved=self.root/'.data/plow/bridge.json'
        self.assertEqual(json.loads(saved.read_text())['chat_id'],'cht_fixture')
        self.assertEqual(saved.stat().st_mode&0o777,0o600)
        self.assertEqual(result['line_name'],'Fixture assistant')
        self.assertNotIn('fixture-private-token',json.dumps(result)+saved.read_text())
        self.official['mint'].assert_not_called()
    def test_existing_other_chat_is_preserved(self):
        directory=self.root/'.data/plow';directory.mkdir()
        config=directory/'bridge.json';config.write_text('{"line_id":"ln_other","chat_id":"cht_other"}')
        original=config.read_bytes()
        with self.assertRaises(BridgeError):connect.connect()
        self.assertEqual(original,config.read_bytes())
    def test_multiple_lines_require_selection(self):
        self.official['account_lines'].return_value=[{'uid':'one'},{'uid':'two'}]
        with self.assertRaises(BridgeError):connect.connect()
        self.client.call.assert_not_called()
    def test_occupied_line_without_credentials_is_not_replaced(self):
        (self.root/'.data/plow-credentials').unlink()
        with self.assertRaises(BridgeError):connect.connect()
        self.official['mint'].assert_not_called()
    def test_other_credential_identity_is_not_rebound(self):
        self.client.call.side_effect=[(200,{'line':{'uid':'ln_other'}})]
        with self.assertRaises(BridgeError):connect.connect()
        self.assertFalse((self.root/'.data/plow/bridge.json').exists())

class OfficialClientMintTests(unittest.TestCase):
    """connect.py's mint call through the real pinned client. Only Plow's API and the bridge are faked."""
    def test_free_line_gets_a_private_credential_and_keeps_the_new_agent(self):
        official, plow = pinned_client(), FakePlow()
        chat = {'uid': 'cht_fixture', 'status': 'active', 'participants': [
            {'type': 'agent', 'relationship': 'self', 'line': {'uid': 'ln_free', 'provider_type': 'imessage'}},
            {'type': 'member', 'role': 'owner', 'uid': 'mbr_fixture'}]}
        client = Mock()
        client.call.side_effect = [(200, {'line': {'uid': 'ln_free'}}), (200, {'has_more': False, 'data': [chat]})]
        bridge = Mock(); bridge.doctor.return_value = {'plow_grant_checked': True}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'config/plow').mkdir(parents=True)
            (root/'config/plow/token').write_text('acct_fixture_token\n')
            with plow.behind(official), patch.dict(os.environ, {'XDG_CONFIG_HOME': str(root/'config')}), \
                    patch.object(connect, 'ROOT', root), patch.object(connect, 'official_client', return_value=official), \
                    patch.object(connect, 'JsonHTTP', return_value=client) as http, patch.object(connect, 'from_config', return_value=bridge):
                connect.connect()
            credential = root/'.data/plow-credentials'
            mode, text = credential.stat().st_mode & 0o777, credential.read_text()
        self.assertEqual(mode, 0o600)
        self.assertIn('PLOW_API_BASE=https://api.plow.co\n', text)
        self.assertIn('PLOW_AGENT_TOKEN=agt_fixture_token\n', text)
        self.assertIn('# plow-agent-uid: ag_new', text)
        http.assert_called_once_with(connect.ORIGIN, 'agt_fixture_token')
        self.assertIn(('POST', '/v1/agents'), plow.sent)
        self.assertNotIn('DELETE', [method for method, _ in plow.sent])

if __name__=='__main__':unittest.main()
