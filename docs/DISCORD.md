# Discord discussion in Reach

Relay can collect discussion from one selected Discord server channel and turn selected messages into Reach todos. The connector is optional and runs in the trusted local backend. Teammates keep using their existing Discord accounts; only the administrator configures the bot.

## Connect a channel

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), create an application and open its **Bot** page.
2. Enable **Message Content Intent**. Copy the **bot token**; do not use a personal account token or share the token in chat.
3. In Relay, open **Settings → Discord**, paste the token and choose **Connect Discord bot**. Relay checks the bot's identity before saving the token privately.
4. Use **Add bot to your Discord server**. Discord asks someone with server management access to authorize it. The requested permissions are **View Channels** and **Read Message History**; sending messages is not requested. Use channel overrides to limit the bot's access.
5. Back in Relay, choose **Load Discord servers**, select the server and a text or announcement channel, then **Start collecting channel**. Let channel participants know the discussion will be saved in Relay.
6. Choose **Sync Discord now**, or leave the backend running for the next scheduled fetch. Open **Reach → Discord discussion** to inspect the captured text, authors, timestamps and original message links.
7. Select **Make Reach todo**, review its title and due date, then save. The todo appears in Reach and Calendar; assign its teammate using Reach's existing controls.

The bot token is kept in `.data/discord/connection.json` under the backend root, with private filesystem permissions. It is not returned by the API or saved in browser storage. The backend needs outbound HTTPS access to `discord.com`; there is no public callback URL, Discord Gateway connection, or additional model key to configure.

## What collection does

- One selected channel per local installation. The server chooser returns up to 200 servers and the channel chooser up to 500 text/announcement channels.
- First capture requests the latest 50 messages. Subsequent polling requests up to 100 new messages every 30 seconds, using a persisted cursor. It also refreshes the most recent 50 messages for edits.
- Ordinary human messages and replies are captured. Bots, webhook posts, blank messages, DMs, thread channels, attachments and voice are excluded. A reply's text is saved; its referenced conversation is not fetched separately.
- Messages retain their Discord user ID, displayed author name, channel, timestamp and source link. Names are not verified phone numbers or Relay team identities.
- Repeated capture updates the same message instead of duplicating it. The local store is limited to 10,000 messages; reaching the limit stops capture with an actionable error rather than silently discarding history.
- History is a set of captured snapshots. Discord deletions and edits outside the recent window are not continuously mirrored. A removed source can remain in saved history.
- Saving a todo rechecks the selected message against Discord. If the content changed, Relay refreshes the saved source and asks you to select it again. If the source is deleted or inaccessible, it does not create a new todo. Retrying the same successful request returns the existing result.
- Chat text remains untrusted source context. It does not authorize repository edits, shell commands, external messaging or autonomous work. Creating a todo does not send a Discord or Plow message.

The worker runs while the backend is running, including when the Reach page is closed. Sleeping or stopping the host pauses collection. A full page of new messages marks the connection as **Catching up**. Rate limits delay all connector requests until Discord's retry interval expires. Failed requests do not advance the capture cursor.

**Pause Discord collection** preserves history. **Disconnect Discord** pauses collection and deletes the saved bot token; it does not remove the bot from your server. **Clear captured messages**, under Stored discussion, deletes the installation's captured messages and pauses collection. Todos already created retain their copied source text and links. Switching channels also retains prior captures.

## Terminal and MCP

Read the latest saved messages without contacting Discord:

```sh
./relay reach discord
./relay reach discord --before MESSAGE_ID
```

`next_before` in the response provides the cursor for an older page. Each page contains up to 50 messages.

An agent can use the existing Reach stdio MCP server with explicit workspace-context access:

```sh
python3 integrations/reach/reach.py mcp --allow-workspace-context
```

The `reach_discord_messages` tool accepts an optional `before` message ID and reads only saved local discussion. It does not change Discord settings, trigger collection, create todos or message users. Configure this command in the MCP client you use with Hermes or Pi; installing the connector alone does not grant an agent access to the discussion.

## Troubleshooting and limits

- **Bot connected** confirms bot credentials, not a successful channel capture. Check the last successful fetch and captured text in Reach.
- **Enable Message Content Intent**: enable it on the application's Bot page and retry. Discord may require approval for privileged intents depending on the application's verification status.
- **No new text returned**: this can mean no new human text, but missing Read Message History may also return an empty list. Check channel permissions and the selected channel; Relay does not infer that an empty result proves access is correct.
- **Cannot reach Discord**: inspect network access and [Discord's status page](https://discordstatus.com/). This connector does not require voice or livestream access.
- **Rate limit**: wait for the delay. Repeatedly clicking sync does not bypass it.
- **Discord is syncing**: a capture or another connection operation is in progress; retry after it finishes.

This version supports the trusted local administrator installation. Hosted guest workspaces are denied access to its bot and captured history. Shared hosted organizations need their own workspace-scoped credential and authorization design.

Voice/video attendance, call transcription, automatic action extraction, phone identity matching and team-wide message delivery are separate work. Existing Daily video calls remain optional.

## Validation

Rust tests exercise a local Discord API fixture: read-only requests, identity/intent checks, channel filtering, capture deduplication, source edits/deletion, idempotent todo creation, rate-limit delays, private token storage, guest isolation and history clearing. Browser tests exercise setup and source-backed todo creation with mocked API responses. Python tests cover the read-only MCP/CLI boundary. These checks do not establish that a live Discord bot has connected; that requires the administrator's token and selected channel.

API references: [applications](https://docs.discord.com/developers/resources/application), [messages](https://docs.discord.com/developers/resources/message), [permissions](https://docs.discord.com/developers/topics/permissions), [OAuth2 bot authorization](https://docs.discord.com/developers/topics/oauth2).
