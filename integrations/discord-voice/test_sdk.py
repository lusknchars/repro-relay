"""Exercise slash-command callbacks with the real SDK, without Discord traffic."""
import asyncio
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

try:
    import discord
except ImportError:
    discord = None

import bot
from core import private_write


@unittest.skipIf(discord is None, 'Run in the Discord image to exercise the pinned SDK')
class SDKTests(unittest.TestCase):
    def test_join_is_scoped_muted_deafened_and_linked(self):
        case = 'RR-' + 'a' * 32
        config = {'token': 'fixture-not-a-real-token', 'guild_id': '1234567890123456',
                  'operator_ids': ['2234567890123456'], 'case_ids': [case],
                  'public_url': 'http://127.0.0.1:8178'}
        test = self
        async def start(client, token):
            tree = client._connection._command_tree
            commands = {c.name: c for c in tree.get_commands(guild=discord.Object(id=int(config['guild_id'])))}
            test.assertEqual(set(commands), {'repro_join', 'repro_leave'})
            test.assertFalse(client.intents.message_content)
            test.assertFalse(client.intents.members)
            interaction = SimpleNamespace(guild_id=0, user=SimpleNamespace(id=1), response=AsyncMock())
            await commands['repro_join'].callback(interaction, case)
            interaction.response.send_message.assert_awaited_once()
            channel = Mock(spec=discord.VoiceChannel)
            channel.id = 3234567890123456
            channel.permissions_for.return_value = SimpleNamespace(view_channel=True, connect=True)
            channel.connect = AsyncMock(return_value=SimpleNamespace(disconnect=AsyncMock()))
            interaction = SimpleNamespace(guild_id=int(config['guild_id']),
                user=SimpleNamespace(id=int(config['operator_ids'][0]), voice=SimpleNamespace(channel=channel)),
                guild=SimpleNamespace(me=None, voice_client=None), response=AsyncMock(), followup=AsyncMock())
            await commands['repro_join'].callback(interaction, case)
            channel.connect.assert_awaited_once_with(timeout=20, reconnect=True, self_deaf=True, self_mute=True)
            test.assertIn('Call link recorded', interaction.followup.send.call_args.args[0])
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            private_write(state / 'config.json', config)
            with patch.object(bot, 'STATE', state), patch.object(discord.Client, 'start', start), \
                    patch.object(bot.Relay, 'check_case') as check, patch.object(bot.Relay, 'record') as record:
                asyncio.run(bot.serve())
                check.assert_called_once_with(case)
                record.assert_called_once()
                test.assertEqual(record.call_args.args[0]['body']['status'], 'joined')


if __name__ == '__main__': unittest.main()
