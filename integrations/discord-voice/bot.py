"""Discord voice presence and work links only. Never receives or plays audio."""
import asyncio
import getpass
import json
import os
from pathlib import Path
import sys
import time
import uuid

from core import Relay, Store, authorized, private_write, validate_config

STATE = Path(__file__).resolve().parents[2] / '.data/discord-voice'


def configure():
    print('Discord call linking: no recording, transcription, microphone access or model calls.')
    print('Create a Discord bot in the Developer Portal. Enable no privileged intents. This configuration stays private.')
    path = STATE / 'config.json'
    if path.exists():
        print('Existing configuration preserved. To use another bot, stop this service and review the private config locally.')
        return
    value = validate_config({
        'token': getpass.getpass('Bot token: ').strip(),
        'guild_id': input('Discord server ID: ').strip(),
        'operator_ids': input('Allowed Discord user IDs, comma-separated: ').replace(' ', '').split(','),
        'case_ids': input('Allowed Repro work IDs, comma-separated: ').replace(' ', '').split(','),
        'public_url': input('Repro URL [http://127.0.0.1:8178]: ').strip() or 'http://127.0.0.1:8178',
    })
    for case in value['case_ids']: Relay().check_case(case)
    private_write(path, value)
    print('Saved. The bot registers server-only slash commands when started. Localhost links work only on this computer.')


async def serve():
    import discord
    from discord import app_commands

    path = STATE / 'config.json'
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 65536:
        raise ValueError('Run sh connect.sh discord to configure the call bot.')
    config = validate_config(json.loads(path.read_text()))
    store = Store(STATE / 'calls.json')
    store.recover()
    relay = Relay()
    gate = asyncio.Lock()
    intents = discord.Intents.none()
    intents.guilds = True
    intents.voice_states = True
    guild = discord.Object(id=int(config['guild_id']))

    class Bot(discord.Client):
        async def setup_hook(self):
            print(f'Invite this bot before using it: https://discord.com/oauth2/authorize?client_id={self.application_id}&scope=bot%20applications.commands&permissions=1049600&guild_id={config["guild_id"]}', flush=True)
            await tree.sync(guild=guild)
            self.receipts = asyncio.create_task(maintain())
            self.receipts.add_done_callback(self.receipts_stopped)

        def receipts_stopped(self, task):
            if not task.cancelled() and task.exception() is not None:
                print('Call receipt maintenance failed. Disconnecting; inspect private state before retrying.', flush=True)
                asyncio.create_task(self.close())

        async def on_ready(self):
            print('Bot connected. Use /repro_join with an approved work ID. No audio capture.', flush=True)

        async def on_voice_state_update(self, member, before, after):
            if member.id == self.user.id and before.channel and before.channel != after.channel:
                async with gate:
                    if store.data['active']:
                        if after.channel and member.guild.voice_client:
                            await member.guild.voice_client.disconnect(force=True)
                        store.event(store.data['active'], 'disconnected')
                        store.data['active'] = None
                        store.save()

    bot = Bot(intents=intents, allowed_mentions=discord.AllowedMentions.none())
    tree = app_commands.CommandTree(bot)

    async def check(interaction, case=None):
        if not authorized(config, interaction.guild_id, interaction.user.id, case):
            await interaction.response.send_message('This server, operator or work ID is not authorized in the local Repro bot configuration.', ephemeral=True)
            return False
        return True

    async def maintain():
        await bot.wait_until_ready()
        while not bot.is_closed():
            await asyncio.sleep(15)
            async with gate:
                call = store.data['active']
                voice = next(iter(bot.voice_clients), None)
                if call and voice and (time.time() - call['started_at'] > 7200 or not any(not m.bot for m in voice.channel.members)):
                    await voice.disconnect(force=True)
                    store.event(call, 'left')
                    store.data['active'] = None
                    store.save()
                try:
                    await asyncio.to_thread(store.flush, relay)
                except ValueError:
                    pass  # Durable receipts stay queued; never invent confirmation.

    @tree.command(name='repro_join', description='Join your voice call and link an approved Repro work ID. No recording.', guild=guild)
    @app_commands.guild_only()
    async def join(interaction: discord.Interaction, work_id: str):
        if not await check(interaction, work_id): return
        channel = getattr(getattr(interaction.user, 'voice', None), 'channel', None)
        if not isinstance(channel, discord.VoiceChannel):
            await interaction.response.send_message('Join a standard voice channel first. Stage channels are not supported.', ephemeral=True)
            return
        permissions = channel.permissions_for(interaction.guild.me)
        if not permissions.view_channel or not permissions.connect:
            await interaction.response.send_message('The bot needs View Channel and Connect in your voice channel.', ephemeral=True)
            return
        await interaction.response.defer(ephemeral=True, thinking=True)
        async with gate:
            if interaction.guild.voice_client or store.data['active']:
                await interaction.followup.send('Already linked to a call. Use /repro_leave before starting another.', ephemeral=True)
                return
            if len(store.data['outbox']) >= 998:
                await interaction.followup.send('Receipt queue is full. Reconnect the local Repro app before joining.', ephemeral=True)
                return
            try:
                await asyncio.to_thread(relay.check_case, work_id)
                voice = await channel.connect(timeout=20, reconnect=True, self_deaf=True, self_mute=True)
                call = {'call_id': str(uuid.uuid4()), 'case_id': work_id, 'guild_id': config['guild_id'],
                        'channel_id': str(channel.id), 'actor_id': str(interaction.user.id), 'started_at': time.time()}
                try:
                    store.data['active'] = call
                    store.event(call, 'joined')
                except Exception:
                    store.data['active'] = None
                    await voice.disconnect(force=True)
                    raise
                confirmed = False
                try:
                    await asyncio.to_thread(store.flush, relay, 1)
                    confirmed = not store.data['outbox']
                except ValueError: pass
                link = config['public_url'].rstrip('/') + '/?view=work&case=' + work_id
                await interaction.followup.send(f'Joined muted and deafened. No audio is recorded or transcribed. Work: <{link}>\n' + ('Call link recorded in Repro.' if confirmed else 'Repro has not confirmed the link yet; its receipt is queued locally.') + '\nLocalhost links work only on the Repro computer.', ephemeral=True, suppress_embeds=True)
            except Exception:
                await interaction.followup.send('Call linking did not complete. Check Repro availability, bot voice permissions and network access. No recording was started.', ephemeral=True)

    @tree.command(name='repro_leave', description='Disconnect the Repro call bot. No audio is saved.', guild=guild)
    @app_commands.guild_only()
    async def leave(interaction: discord.Interaction):
        if not await check(interaction): return
        await interaction.response.defer(ephemeral=True)
        async with gate:
            voice = interaction.guild.voice_client
            call = store.data['active']
            if voice: await voice.disconnect(force=True)
            if call:
                store.event(call, 'left')
                store.data['active'] = None
                store.save()
            await interaction.followup.send('Disconnected. Call receipts sync to Repro when it is reachable. No audio was recorded.', ephemeral=True)

    try:
        async with bot: await bot.start(config['token'])
    finally:
        for voice in bot.voice_clients: await voice.disconnect(force=True)


if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['configure']: configure()
        elif not sys.argv[1:]: asyncio.run(serve())
        else: raise ValueError('Use configure, or no argument to start.')
    except (Exception, KeyboardInterrupt):
        print('Discord call bot stopped or needs setup. Check the private configuration; do not paste your bot token.', file=sys.stderr)
        sys.exit(1)
