# Discord call notes

This optional mode captures a consented voice call, transcribes locally and queues one Hermes reply in the existing shared Team conversation. It replaces the join-only bot while enabled. It is not a hosted one-click Discord application.

## Launch

From this checkout, with Docker running and port 8178 available:

```sh
sh connect.sh discord-notes
```

The local prompt collects the bot token, server ID, allowed operator IDs and approved work IDs if not already configured. It does not print the token. The setup creates or reuses the local Team bridge and limits the dedicated read-only Hermes gateway to one concurrent run. It restarts that Docker gateway. Existing hosted chat connections and custom Hermes tool scopes are not replaced.

Open Repro and save your provider credential in Settings → Models if needed. Speech recognition uses the bundled local Whisper tiny model, not that API key. Hermes summaries use the configured model and can incur provider usage. The Team worker also answers existing authorized Team requests; it does not automatically run investigations.

Run `./start.sh logs`, open the bot invite URL and authorize View Channel, Connect and Send Messages. Leave privileged intents disabled. If you invited it after its first startup, restart the notes service:

```sh
docker compose --env-file /dev/null -f compose.local.yaml -f compose.connected.yaml --profile notes restart discord-notes
```

Do not run the Python join-only bot with the same token at the same time. `sh connect.sh discord-notes` stops the Docker join-only service. A separately launched host bot must be stopped by its operator. `sh connect.sh discord` switches the Docker services back to join-only mode and stops the Team worker started by notes mode.

## In the call

1. An authorized operator joins a standard voice channel and runs `/repro_notes work_id:RR-…`.
2. The bot posts consent controls in that voice channel's text chat. Every human participant clicks **I consent**. The bot stays deafened until all agree.
3. A visible recording notice appears. The bot remains muted, receives the consenting accounts' audio and buffers it in memory.
4. Before ten minutes, an authorized operator clicks **Stop and share with Hermes**. Capture stops, local speech recognition runs and the transcript appears in Repro → Team. The existing Hermes worker posts its conversational reply there when the configured runtime completes.
5. **Cancel and discard** is available to every original participant before submission. A membership change, receiver error, lost connection, process shutdown or ten-minute deadline cancels capture. Calls do not resume automatically.

Use a short test first. The limit is five human participants and ten minutes. Automatic summaries on everyone leaving, continuous live replies, Stage channels, multiple simultaneous calls, shared hosted bot onboarding and user-installed skill execution are not included. Leaving before **Stop and share** cancels rather than publishing an incomplete call.

## Data and retention

Raw PCM stays in memory during capture. Transcription uses temporary WAV files on the container's memory-backed `/tmp`. The files and buffers are discarded after processing or cancellation. A process or container restart discards the capture; it does not recover audio. No third-party speech-to-text API receives the audio.

The transcript goes to the local Repro API, its Team chat worker, Hermes and the configured model provider after **Stop and share**. Speaker labels come from Discord account IDs, not verified real-world identities. Whisper output can omit or mishear words, and silent/audio-loss cases can be incomplete. A synthetic speech check does not establish live Discord recording quality. Summaries are suggestions, not verified facts or authorized actions.

Team transcripts and their replies expire after seven days by default. Choose 1, 7 or 30 days when starting:

```sh
RELAY_DISCORD_RETENTION_DAYS=1 sh connect.sh discord-notes
```

Expiry removes those chat rows on the next Team read or inbox poll. The worker clears its transcript/reply copy after successful delivery and removes expired private call-note receipts on its next tick. Minimal call receipt metadata remains. Hermes runtime history, provider retention and backups have separate policies; the Team expiry setting does not erase them. This limitation is stated before consent.

An uncertain network response retries the same transcript ID. Repro admits at most one transcript per call. A failed or unconfirmed submission is not shown as a completed Hermes reply. After an uncertain submission, inspect Team before attempting another call. Transcripts over 24,000 text characters or 500 segments are rejected, not silently truncated. Local transcription has a five-minute processing timeout.

## Validation and implementation

The receiver uses locked `discord.js` 14.27.0 and `@discordjs/voice` 0.19.2 with its DAVE dependency. The [maintainer documents audio receive as unsupported by Discord and therefore not guaranteed stable](https://github.com/discordjs/discord.js/tree/main/packages/voice). The inspected release includes DAVE receive decryption.

Speech recognition uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 1.2.1 and [Systran's tiny model](https://huggingface.co/Systran/faster-whisper-tiny), pinned to `d90ca5fe260221311c53c58e660288d3deb8d356`. No speech model downloads occur during a call. The CPU-only tiny model prioritizes a small install; accuracy must be checked on the team's languages and microphones.

Tests cover consent gating, cancellation, membership changes, duration limits, receipt identity, malformed speakers, Team queue admission and expiry. A synthetic spoken sample was transcribed correctly inside the real image with networking disabled. A live Discord server test and a separately authorized real Hermes response are still required before calling this deployment verified.
