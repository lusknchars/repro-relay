import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock
import uuid

spec = importlib.util.spec_from_file_location('call_context', Path(__file__).with_name('server.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CallToolsTests(unittest.TestCase):
    def test_cannot_invoke_delivery_or_inject_destination(self):
        api = Mock(session='session')
        for name, args in [('send_message', {}), ('relay_call_context', {'case_id': 'other'}),
                           ('relay_record_call_request', {'request_id': True, 'transcript': 'test', 'kind': 'test_request'}),
                           ('relay_record_call_request', {'request_id': str(uuid.uuid4()), 'transcript': 'yes', 'kind': 'approve'})]:
            with self.assertRaises(ValueError):
                module.execute(api, name, args)
        api.request.assert_not_called()

    def test_utterance_identity_survives_retry(self):
        api = Mock(session='session')
        args = {'request_id': str(uuid.uuid4()), 'transcript': 'Test this as a viewer on Windows.', 'kind': 'test_request'}
        module.execute(api, 'relay_record_call_request', args)
        module.execute(api, 'relay_record_call_request', args)
        self.assertEqual(api.request.call_args_list[0], api.request.call_args_list[1])

    def test_remote_api_rejected(self):
        with self.assertRaises(ValueError):
            module.API('https://example.com/api/v1')


if __name__ == '__main__':
    unittest.main()
