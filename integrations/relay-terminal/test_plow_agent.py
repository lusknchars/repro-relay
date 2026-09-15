"""Unit tests for the one-command Plow agent install. No network, Docker or model calls."""
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import plow_agent


def line(uid, agent=None, number='+15550000000', name='Alder'):
    return {'uid': uid, 'agent_uid': agent, 'provider_key': number, 'display_name': name}


class LineSelectionTests(unittest.TestCase):
    def test_single_free_line_is_selected_without_asking(self):
        asked = []
        chosen = plow_agent.choose_line([line('ln_1')], ask=lambda options: asked.append(options))
        self.assertEqual(chosen['uid'], 'ln_1')
        self.assertEqual(asked, [])

    def test_several_free_lines_are_offered_and_the_answer_is_used(self):
        lines = [line('ln_1', name='One'), line('ln_2', name='Two')]
        chosen = plow_agent.choose_line(lines, ask=lambda options: options[1])
        self.assertEqual(chosen['uid'], 'ln_2')

    def test_occupied_lines_are_never_selected(self):
        with self.assertRaises(plow_agent.AgentError) as error:
            plow_agent.choose_line([line('ln_1', agent='ag_1')], ask=lambda options: options[0])
        self.assertIn('--new-line', str(error.exception))

    def test_an_account_without_lines_explains_how_to_get_one(self):
        with self.assertRaises(plow_agent.AgentError) as error:
            plow_agent.choose_line([], ask=lambda options: options[0])
        self.assertIn('--new-line', str(error.exception))


class CredentialTests(unittest.TestCase):
    def test_existing_credential_for_another_line_stops_without_minting(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            credential.write_text('PLOW_API_BASE=https://api.plow.co\nPLOW_AGENT_TOKEN=x\n')
            minted = []
            with self.assertRaises(plow_agent.AgentError) as error:
                plow_agent.ensure_credential(
                    credential, line('ln_2'),
                    identity=lambda path: {'line': {'uid': 'ln_other'}},
                    mint=lambda path, uid: minted.append(uid))
            self.assertEqual(minted, [])
            self.assertIn('ln_other', str(error.exception))
            self.assertTrue(credential.exists())

    def test_existing_credential_for_the_same_line_is_reused(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            credential.write_text('PLOW_AGENT_TOKEN=x\n')
            minted = []
            plow_agent.ensure_credential(
                credential, line('ln_2'),
                identity=lambda path: {'line': {'uid': 'ln_2'}},
                mint=lambda path, uid: minted.append(uid))
            self.assertEqual(minted, [])

    def test_missing_credential_is_minted_for_the_selected_line(self):
        with tempfile.TemporaryDirectory() as directory:
            credential = Path(directory) / 'plow-credentials'
            minted = []
            plow_agent.ensure_credential(
                credential, line('ln_2'),
                identity=lambda path: {'line': {'uid': 'ln_2'}},
                mint=lambda path, uid: minted.append(uid))
            self.assertEqual(minted, ['ln_2'])


class ReadinessTests(unittest.TestCase):
    def test_configured_message_reports_ready(self):
        state, detail = plow_agent.wait_ready(
            lambda: 'starting\nplow-init: configured from /var/lib/plow as cht_1\n',
            sleep=lambda seconds: None, timeout=10)
        self.assertEqual(state, 'ready')
        self.assertIn('cht_1', detail)

    def test_parked_message_reports_its_reason(self):
        state, detail = plow_agent.wait_ready(
            lambda: 'plow-init: credential rejected -- parking; no gateway will start\n',
            sleep=lambda seconds: None, timeout=10)
        self.assertEqual(state, 'parked')
        self.assertIn('credential rejected', detail)

    def test_silence_times_out_with_bounded_waiting(self):
        slept = []
        state, _ = plow_agent.wait_ready(
            lambda: 'still booting\n', sleep=slept.append, timeout=6)
        self.assertEqual(state, 'timeout')
        self.assertLessEqual(sum(slept), 6)


class PreflightTests(unittest.TestCase):
    def test_missing_docker_is_reported_with_its_remedy(self):
        with patch.object(plow_agent.shutil, 'which', return_value=None):
            missing = plow_agent.preflight(run=lambda command: 1)
        self.assertTrue(any('Docker' in item for item in missing))

    def test_stopped_docker_is_reported(self):
        with patch.object(plow_agent.shutil, 'which', return_value='/usr/bin/docker'):
            missing = plow_agent.preflight(run=lambda command: 1)
        self.assertTrue(any('Start Docker' in item or 'Docker' in item for item in missing))

    def test_ready_docker_reports_nothing(self):
        with patch.object(plow_agent.shutil, 'which', return_value='/usr/bin/docker'):
            self.assertEqual(plow_agent.preflight(run=lambda command: 0), [])


class LockTests(unittest.TestCase):
    def test_a_second_install_refuses_while_one_holds_the_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'install.lock'
            with plow_agent.installation_lock(path):
                with self.assertRaises(plow_agent.AgentError):
                    with plow_agent.installation_lock(path):
                        pass
            with plow_agent.installation_lock(path):
                pass


class StatusTests(unittest.TestCase):
    def test_status_reports_state_without_revealing_the_reporter_key(self):
        text = plow_agent.status_report(
            running=True, line=line('ln_2', number='+15551234567'), configured=True,
            reporter={'install_id': 'abc123', 'key': 'aik_secret_value'},
            usage={'agent': 'repro-relay', 'days': 1, 'tokens': 57922})
        self.assertNotIn('aik_secret_value', text)
        self.assertIn('repro-relay', text)
        self.assertIn('57,922', text)
        self.assertIn('+15551234567', text)

    def test_status_says_when_nothing_is_registered_yet(self):
        text = plow_agent.status_report(
            running=False, line=None, configured=False, reporter={}, usage={})
        self.assertIn('not registered', text.lower())
        self.assertIn('not running', text.lower())


class ReportedUsageTests(unittest.TestCase):
    def test_thousands_separated_totals_are_read(self):
        logs = ('agent-1  |   agentsview not installed - skipping that collector\n'
                'agent-1  |   agent=repro-relay days=1 tokens=3,078,430\n'
                'agent-1  |   agent=repro-relay days=1 tokens=3,191,866\n')
        self.assertEqual(plow_agent.parse_usage(logs),
                         {'agent': 'repro-relay', 'days': 1, 'tokens': 3191866})

    def test_logs_without_a_report_give_nothing(self):
        self.assertEqual(plow_agent.parse_usage('agent-1  |   starting\n'), {})

    def test_a_failed_collector_is_never_shown_as_a_total(self):
        logs = ('agent-1  |   COLLECTOR FAILED - hermes store state.db: configured but missing\n'
                'agent-1  |   agent=repro-relay days=0 tokens=0\n'
                'agent-1  |   a collector failed - NOT reporting a partial total\n')
        self.assertEqual(plow_agent.parse_usage(logs), {})


class DocumentationTests(unittest.TestCase):
    def test_readme_teaches_the_command_and_keeps_no_install_url(self):
        readme = (plow_agent.ROOT / 'README.md').read_text()
        start = readme.index('## Quick start')
        section = readme[start:readme.index('\n## ', start + 1)]
        self.assertIn('./relay agent', section)
        self.assertNotIn('curl', section)
        self.assertNotIn('https://', section)

    def test_agent_readme_teaches_the_same_command(self):
        readme = (plow_agent.ROOT / 'agent/README.md').read_text()
        self.assertIn('./relay agent', readme)


if __name__ == '__main__':
    unittest.main()
