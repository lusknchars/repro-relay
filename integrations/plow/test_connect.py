import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, Mock
import connect
from bridge import BridgeError

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

if __name__=='__main__':unittest.main()
