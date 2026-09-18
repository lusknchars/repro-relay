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
# connect puts the installer's own folder on the path, which is where these live.
from fake_windows import client_write, pinned_client_double, recorder, windows_host
import private_files


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
        # A client whose functions are real ones in their own namespace, as run_path's are:
        # official_client() replaces one of them through __globals__ on Windows, and a Mock
        # has none, so with Mocks that replacement was a path no host but Windows ever ran.
        self.official=pinned_client_double(account_token=Mock(return_value='fixture-private-token'),
                       account_lines=Mock(return_value=[{'uid':'ln_fixture','agent_uid':'agent_fixture','display_name':'Fixture assistant'}]),mint=Mock())
        self.client=Mock()
        self.client.call.side_effect=[(200,{'line':{'uid':'ln_fixture'}}),(200,{'has_more':False,'data':[{'uid':'cht_fixture','status':'active','participants':[{'type':'agent','relationship':'self','line':{'uid':'ln_fixture','provider_type':'imessage'}},{'type':'member','role':'owner'}]}]})]
        self.bridge=Mock();self.bridge.doctor.return_value={'plow_grant_checked':True}
        for item in [patch.object(connect,'ROOT',self.root),patch.object(connect.runpy,'run_path',return_value=self.official),patch.object(connect,'private_credentials',return_value='fixture-private-token'),patch.object(connect,'JsonHTTP',return_value=self.client),patch.object(connect,'from_config',return_value=self.bridge)]:
            item.start();self.addCleanup(item.stop)
    def test_binds_existing_credential_without_reprovisioning_or_exposing_it(self):
        result=connect.connect()
        saved=self.root/'.data/plow/bridge.json'
        self.assertEqual(json.loads(saved.read_text())['chat_id'],'cht_fixture')
        self.assertTrue(private_files.is_private(saved))
        self.assertEqual(result['line_name'],'Fixture assistant')
        self.assertNotIn('fixture-private-token',json.dumps(result)+saved.read_text())
        recorder(self.official,'mint').assert_not_called()
    def test_existing_other_chat_is_preserved(self):
        directory=self.root/'.data/plow';directory.mkdir()
        config=directory/'bridge.json';config.write_text('{"line_id":"ln_other","chat_id":"cht_other"}')
        original=config.read_bytes()
        with self.assertRaises(BridgeError):connect.connect()
        self.assertEqual(original,config.read_bytes())
    def test_multiple_lines_require_selection(self):
        recorder(self.official,'account_lines').return_value=[{'uid':'one'},{'uid':'two'}]
        with self.assertRaises(BridgeError):connect.connect()
        self.client.call.assert_not_called()
    def test_occupied_line_without_credentials_is_not_replaced(self):
        (self.root/'.data/plow-credentials').unlink()
        with self.assertRaises(BridgeError):connect.connect()
        recorder(self.official,'mint').assert_not_called()
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
            private, text = private_files.is_private(credential), credential.read_text()
        self.assertTrue(private)
        self.assertIn('PLOW_API_BASE=https://api.plow.co\n', text)
        self.assertIn('PLOW_AGENT_TOKEN=agt_fixture_token\n', text)
        self.assertIn('# plow-agent-uid: ag_new', text)
        http.assert_called_once_with(connect.ORIGIN, 'agt_fixture_token')
        self.assertIn(('POST', '/v1/agents'), plow.sent)
        self.assertNotIn('DELETE', [method for method, _ in plow.sent])


class PortableClientWrite(unittest.TestCase):
    """Replacing the client's own write happens only on Windows, so it is run here anyway.

    By faking the platform rather than waiting for a Windows host. This branch has been bitten
    three times now by a path only one platform runs, and running it everywhere is the only
    defence that has held.
    """

    def client(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        (root / '.data/tools').mkdir(parents=True)
        (root / '.data/tools/plow-agents').touch()
        return root, pinned_client_double(mint=Mock())

    def test_windows_gives_the_client_a_write_it_can_finish(self):
        root, double = self.client()
        with windows_host(), patch.object(connect, 'ROOT', root), \
                patch.object(connect.runpy, 'run_path', return_value=double):
            returned = connect.official_client()
        self.assertIs(client_write(returned), connect.write_private)

    def test_this_host_leaves_the_client_its_own_write(self):
        root, double = self.client()
        with patch.object(connect, 'ROOT', root), \
                patch.object(connect.runpy, 'run_path', return_value=double):
            returned = connect.official_client()
        self.assertIsNot(client_write(returned), connect.write_private)

    def test_the_replacement_writes_a_private_file_and_says_why_when_it_cannot(self):
        root, _ = self.client()
        written = connect.write_private(str(root / 'plow-credentials'), 'PLOW_AGENT_TOKEN=agt_fixture_token\n')
        self.assertEqual(Path(written).read_bytes(), b'PLOW_AGENT_TOKEN=agt_fixture_token\n')
        self.assertTrue(private_files.is_private(written))
        with patch.object(private_files, 'write_privately',
                          side_effect=private_files.PrivacyError('a drive that cannot keep one account apart')):
            with self.assertRaises(BridgeError) as error:
                connect.write_private(str(root / 'other'), 'x')
        self.assertIn('one account apart', str(error.exception))


if __name__=='__main__':unittest.main()
