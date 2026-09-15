# Discord voice bot requirements

Research date: September 15, 2026. Scope: a Python bot joins an authorized user's guild voice channel, stays deafened and muted, and returns a Repro case link. These are implementation requirements and verified upstream capabilities, not evidence of a live connection.

## Library and voice protocol

Use `discord.py[voice]==2.7.1` as the known released baseline. Version 2.7.0 introduced DAVE support; 2.7.1 improves missing-DAVE-dependency errors and diagnostics. This is a verified compatible release choice, not a claim that it is the newest release. [Release](https://github.com/Rapptz/discord.py/releases/tag/v2.7.1), [maintainer changelog](https://github.com/Rapptz/discord.py/blob/master/docs/whats_new.rst).

The 2.7.1 voice extra declares `PyNaCl>=1.5.0,<1.6` and `davey>=0.1.0`. Install the voice extra, and verify that both imports succeed on the deployment machine. The project declares Python 3.8 or newer; choose Python 3.12 for this integration and resolve native wheels for that interpreter before deployment. Pinning discord.py alone does not lock its transitive dependencies. [Tagged package metadata](https://github.com/Rapptz/discord.py/blob/v2.7.1/pyproject.toml).

Discord requires DAVE for ordinary voice calls after the March 2026 transition, including bot participants. Self-deafening does not justify selecting an older protocol implementation. Discord's subsequent completion announcement identifies stage channels as an exception; exclude stages from this first version. [Voice protocol](https://docs.discord.com/developers/topics/voice-connections), [migration completion](https://discord.com/blog/every-voice-and-video-call-on-discord-is-now-end-to-end-encrypted).

The host needs outbound HTTPS/WebSocket access and bidirectional UDP through its firewall or NAT. An HTTP-only runtime is insufficient. Let the library implement the voice handshake, encryption, heartbeats and reconnection. [Voice transport requirements](https://docs.discord.com/developers/topics/voice-connections).

## Bot access

Use a bot account installed in the configured guild, with the `bot` and `applications.commands` OAuth scopes. Register commands for that guild and call `CommandTree.sync(guild=...)`. Guild commands update immediately and stay within their designated guild. [Application commands](https://docs.discord.com/developers/interactions/application-commands).

Enable `guilds` and `voice_states` starting from `discord.Intents.none()`. This design needs guild/channel metadata and voice state changes. It does not need message content, presence or a full member cache. Avoid enabling privileged intents as a blanket setup step. [Intents guide](https://discordpy.readthedocs.io/en/stable/intents.html).

Give the bot `View Channel` and `Connect` on the target voice channel. A bot that never plays audio does not need `Speak`. Normal channel posts additionally need `Send Messages`; embed previews require `Embed Links`. Check effective channel permissions because role and channel overwrites affect access. Members need `Use Application Commands` to invoke slash commands. [Permission definitions](https://docs.discord.com/developers/topics/permissions).

## Command and connection design

These are project recommendations, not Discord platform requirements:

- Accept only the configured guild and an explicit operator user/role allowlist, or an intentionally selected moderator permission. Apply the runtime check to every command, including status and case-link commands.
- Set command default permissions for discoverability, but also enforce authorization in code. Discord administrators can override command defaults; the library documents that defaults are only hints. [Command checks](https://discordpy.readthedocs.io/en/stable/interactions/api.html#discord.app_commands.default_permissions).
- Require the caller to be in a standard voice channel. Join that channel with `self_deaf=True` and `self_mute=True`; these flags are supported by the pinned library's `Connectable.connect`. Keep one active voice connection per guild and reject silent movement into another session. [Tagged connection implementation](https://github.com/Rapptz/discord.py/blob/v2.7.1/discord/abc.py).
- Defer potentially slow command responses before connecting. Return errors and case links ephemerally, with mentions disabled and previews suppressed when appropriate. Do not expose credentials, raw HTTP response bodies or case details in failures. [Interaction responses](https://discordpy.readthedocs.io/en/stable/interactions/api.html#discord.InteractionResponse.defer).
- Store the case association only after validating its identifier and workspace access. Build links from a configured Repro origin. A Discord role does not confer access to another Repro workspace.
- Describe the bot as present, deafened and muted. Do not implement audio receive hooks, recording, transcription, media playback or model calls in this version. Any future capture needs a separate consent and retention design.

## Acceptance evidence still required

Offline checks should cover rejected guilds/operators, absent voice membership, stage rejection, missing permissions, repeated joins, cross-channel conflicts, invalid case IDs, backend failure, and leave cleanup. A real configured bot must then prove slash registration, DAVE connection, visible deaf/mute flags, and disconnect behavior in a test guild. Offline tests cannot establish live Discord compatibility or successful installation of native voice dependencies.
