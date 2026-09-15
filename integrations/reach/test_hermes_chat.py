import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
import uuid

import hermes_chat


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.state = Path(self.tmp.name)
        self.identity = str(uuid.uuid4())
        self.api, self.hermes = Mock(), Mock()
        self.api.request.return_value = {'items': [{'id': self.identity, 'body': 'Explain the next step.'}]}
        self.run = 'run_' + 'a' * 32
        self.worker = hermes_chat.Worker(self.api, self.hermes, self.state, clock=lambda: 100)

    def saved(self):
        return json.loads((self.state / (self.identity + '.json')).read_text())

    def test_restart_reuses_admission_and_reply_identities(self):
        self.hermes.request.side_effect = [{}, OSError('lost admission response')]
        with self.assertRaises(OSError): self.worker.tick()
        before = self.saved()
        first = self.hermes.request.call_args
        self.hermes.request.side_effect = [{}, {'run_id': self.run}]
        self.assertEqual(self.worker.tick(), 'started')
        self.assertEqual(self.hermes.request.call_args, first)
        self.assertEqual(before['reply_id'], self.saved()['reply_id'])
        self.hermes.request.side_effect = [{}, {'status': 'completed', 'output': 'Actual model response.', 'usage': {'total_tokens': 20}}]
        self.api.request.side_effect = [{'items': [{'id': self.identity, 'body': 'Explain the next step.'}]}, OSError('lost reply response')]
        with self.assertRaises(OSError): self.worker.tick()
        reply = self.api.request.call_args
        self.hermes.request.side_effect = [{}]
        self.api.request.side_effect = [{'items': [{'id': self.identity, 'body': 'Explain the next step.'}]}, {}]
        self.assertEqual(self.worker.tick(), 'replied')
        self.assertEqual(self.api.request.call_args, reply)
        self.assertEqual(self.saved()['reply'], 'Actual model response.')
        self.assertEqual((self.state / (self.identity + '.json')).stat().st_mode & 0o777, 0o600)

    def test_failed_or_partial_runs_never_fabricate_reply_or_resubmit(self):
        self.hermes.request.side_effect = [{}, {'run_id': self.run}]
        self.worker.tick()
        self.hermes.request.side_effect = [{}, {'status': 'failed', 'error': 'provider error'}]
        self.assertEqual(self.worker.tick(), 'blocked')
        self.assertNotIn('reply', self.saved())
        self.hermes.request.side_effect = [{}]
        self.assertEqual(self.worker.tick(), 'idle')
        self.assertFalse(any(c.args[0] == 'POST' for c in self.api.request.call_args_list))

    def test_revoked_connection_does_not_admit_model_work(self):
        self.hermes.request.return_value = {}
        self.api.request.side_effect = OSError('revoked')
        with self.assertRaises(OSError): self.worker.tick()
        self.assertEqual(self.hermes.request.call_args.args, ('GET', '/health'))
        self.assertEqual(list(self.state.iterdir()), [])

    def test_stale_uncertain_admission_requires_reconciliation(self):
        self.hermes.request.side_effect = [{}, OSError('lost')]
        with self.assertRaises(OSError): self.worker.tick()
        self.worker.clock = lambda: 4000
        self.hermes.request.side_effect = [{}]
        self.assertEqual(self.worker.tick(), 'blocked')
        self.assertIn('reconciliation', self.saved()['blocked'])

    def test_timeout_requests_stop_without_claiming_completion(self):
        self.hermes.request.side_effect = [{}, {'run_id': self.run}]
        self.worker.tick()
        self.worker.clock = lambda: 300
        self.hermes.request.side_effect = [{}, {'status': 'running'}, {'status': 'stopping'}]
        self.assertEqual(self.worker.tick(), 'blocked')
        self.assertEqual(self.hermes.request.call_args.args, ('POST', '/v1/runs/' + self.run + '/stop', {}))
        self.assertNotIn('reply', self.saved())

    def test_only_bounded_completed_output_can_be_delivered(self):
        self.hermes.request.side_effect = [{}, {'run_id': self.run}]
        self.worker.tick()
        self.hermes.request.side_effect = [{}, {'status': 'completed', 'output': 'x' * 8001}]
        self.assertEqual(self.worker.tick(), 'blocked')
        self.assertNotIn('reply', self.saved())

    def test_call_notes_pass_whole_bounded_transcript_and_clear_worker_copy_after_reply(self):
        message={'id':self.identity,'body':'Call transcript ' + 'x'*8000,'call_notes':True,'expires_at':1000}
        self.api.request.return_value={'items':[message]}
        self.hermes.request.side_effect=[{}, {'run_id':self.run}]
        self.assertEqual(self.worker.tick(),'started')
        self.assertEqual(self.saved()['request']['input'],message['body'])
        self.assertNotIn('conversation_history',self.saved()['request'])
        self.hermes.request.side_effect=[{}, {'status':'completed','output':'A summary, not an executed action.'}]
        self.assertEqual(self.worker.tick(),'replied')
        self.assertNotIn('request',self.saved())
        self.assertNotIn('reply',self.saved())

    def test_expired_call_notes_are_removed_from_private_worker_state(self):
        hermes_chat.provider_setup.private_write(self.state/(self.identity+'.json'),{'call_notes':True,'expires_at':99,'request':{'input':'private transcript'}})
        self.api.request.return_value={'items':[]}
        self.hermes.request.return_value={}
        self.assertEqual(self.worker.tick(),'idle')
        self.assertFalse((self.state/(self.identity+'.json')).exists())


if __name__ == '__main__': unittest.main()
