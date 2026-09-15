# Discord call linking

For the optional consented transcription and Hermes Team flow, see [Discord call notes](DISCORD-CALL-NOTES.md). The join-only behavior below remains available with `sh connect.sh discord`.

The first version joins and links calls only. No audio is recorded, played, transcribed or sent to a model. It does not join automatically at startup.

## Setup

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications). Keep all privileged intents disabled. Copy its bot token privately.
2. Create a Repro work record. Copy its full `RR-…` ID from the work URL. Enable Discord Developer Mode to copy your server ID and each operator's user ID.
3. From the checkout, run `sh connect.sh discord`. Enter the token, one server, allowed operators and allowed work IDs. These values stay in the Docker settings volume, not the image or repository. Do not paste the token into chat or logs.
4. Run `./start.sh logs` and open the bot's invite URL. Approve it for the configured server. Only View Channel and Connect permissions are requested, plus the bot and application-command scopes. If the first startup preceded the invitation, Docker retries startup after invitation. Check for the `Bot connected` log before using commands.
5. An allowed operator joins a standard voice channel and runs `/repro_join work_id:RR-…`. The bot joins muted and deafened and responds privately with a work link. `/repro_leave` disconnects it.

Stage channels and multiple simultaneous calls are not supported. Both commands enforce the configured server and operator list; joining also enforces the work-ID allowlist and checks the work record in Repro. Moving the bot to another channel disconnects it rather than silently changing the linked call. It leaves when no human participants remain or after two hours. A process restart does not rejoin a call.

## What is stored

Repro records a random call ID, event ID, server/channel/operator IDs, joined/left/disconnected status and the server receipt time. Work activity labels these as adapter reports, not independently verified observations. It never marks tests passed, drafts messages or approves work.

The bot keeps private pending receipts and retries them with the same IDs when Repro is temporarily unavailable. A queued receipt is not a confirmed Repro link. The queue and per-work event history are each limited to 1,000 events. Configuration allows at most 50 operators and 100 work IDs. Resolve a full or rejected queue locally before further use; do not delete receipts to manufacture a successful sync.

The endpoint `GET /api/v1/cases/{id}/discord-calls` returns the latest 100 receipts. `POST` accepts metadata only and rejects unknown fields. Both are restricted to the trusted local workspace; hosted deployment is unsupported in this version. The bot shares the app's private loopback namespace and trusts that local administrator service. A localhost link opens only on the machine running Repro. Choosing a public URL does not create hosting or grant remote access.

To change configuration, stop the bot before editing its private `config.json` inside the settings volume. Never expose that volume or add it to Git. Rotate compromised tokens in Discord's Developer Portal.

The SDK is pinned to `discord.py[voice]==2.7.1` with DAVE support. Requirements and official sources are recorded in [voice research](research/DISCORD-VOICE-BOT-REQUIREMENTS.md). A real server invitation and live voice join must be tested separately from fixture and container checks.
