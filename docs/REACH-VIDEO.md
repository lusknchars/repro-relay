# Reach video calls

Reach can create a private Daily room, host an embedded call, save host-captured transcription, and turn a selected passage into a Reach todo. This is the first video-call integration; it does not automatically extract action items or send team messages.

## Connect and use

1. Open **Settings → Communication → Daily video** on the administrator's local installation. Create or use an account at [Daily](https://dashboard.daily.co/) and enter its API key in the password field. The backend checks account access before saving the key in `.data/daily/connection.json` (0700 directory / 0600 file on Unix). Do not commit this directory.
2. Open **Reach → Team calls**, enter a title and choose a room lifetime. Click **Create call**, then **Copy meeting link**. Share that guest link with teammates. Their browser opens Daily's waiting room; they need neither a Relay installation nor an API key.
3. Click **Join in Relay**. Grant camera/microphone access when requested. Admit participants through the embedded call. The host token is kept in memory, bound to this room and its expiry, and is never included in the shared link.
4. After participants agree, acknowledge consent and click **Start transcription**. The Live badge appears only after a Daily transcription-started event. Daily may require billing/transcription access to be enabled. Keep the Reach page open: only transcript events received by this host are saved. No background recorder or call-joining Hermes bot is installed.
5. Select **Make todo** on a saved passage, edit its title and due date, then save. The resulting Calendar follow-up appears in Reach with meeting, speaker-label, timestamp and passage references. Use Reach to assign a teammate and review any message.
6. Stop transcription before leaving or ending the room. **Leave call** leaves other participants in the room. **End room for everyone** asks Daily to expire the room immediately (two-second grace), and records closure only after the provider confirms the expiry configuration. Room expiry remains the fallback if the host loses connection.

Rooms are limited to 12 participants, 10–120 minutes from creation and 20 new room records per day on this installation. A failed creation remains visible: **Check room** reuses its deterministic name and saved request, rather than creating another room. Close or let rooms expire before disconnecting/changing the Daily account.

## What the transcript means

Speaker labels come from the call and are not verified identities or phone numbers. Transcript text is source material, not permission to execute code or send messages. Saving a todo is a human selection; no model call or Plow delivery occurs.

Daily processes audio for enabled transcription. Relay stores text passages in Postgres and disables Daily transcript-file storage on room creation. Existing Daily account policies still apply. Latest 500 passages are shown; the backend accepts up to 5000 per meeting. Passage and todo identifiers make retrying a failed save safe. If saving fails, the interface shows unsaved passages with retry and download controls. Keep the page open until saved or exported; unsaved browser state is not a durable recording.

Transcription can outlive a disconnected host until the provider stops it or the room expires. Live transcription state is taken from Daily events, not inferred from a saved preference. Saved transcripts are host-captured and may be incomplete.

## Implementation and limits

- Rust endpoints: `/connections/daily`, `/meetings`, and room-scoped `/join`, `/close`, `/capture`, `/transcript`, `/actions` under `/api/v1`.
- Local administrator manages credentials, rooms and transcript-derived todos. Guest/hosted workspace requests cannot access this installation's meeting APIs; remote participants use the public Daily URL.
- Daily Prebuilt owns audio/video transport, waiting-room admission and in-call controls. Relay owns room metadata, text persistence and Reach todos.
- macOS includes camera/microphone usage descriptions and permits Daily frames in its CSP. Device permission, network policy and supported WebView/browser behavior still need a real call test on the target Mac.
- Participant minutes and transcription are billed by Daily. Relay does not yet ingest Daily usage into its Usage ledger.
- Not implemented: automatic task extraction, speaker-to-phone matching, shared Team chat publication, video-call MCP tools, background Hermes attendance, or delivery to every invited teammate. Plow retains its existing authorized-line delivery scope.

## Validation

Provider-fixture tests cover response-loss reconciliation without duplicate rooms, private links, scoped host tokens, access restrictions, explicit transcript consent, idempotent passages/todos, closure and retained history. A browser test replaces only the Daily SDK boundary and exercises connection, embedded-call controls, transcript-save failure/retry and todo creation. These fixtures do not prove real media, transcription quality, billing, or phone delivery. Activate a real Daily account and test with two participants before relying on the call in a team session.

Sources: [Daily room API](https://docs.daily.co/reference/rest-api/rooms/create-room), [meeting tokens](https://docs.daily.co/reference/rest-api/meeting-tokens/create-meeting-token), [transcription](https://docs.daily.co/guides/products/transcription). The pinned Daily SDK is BSD-2-Clause; its [license](licenses/daily-js.txt) is retained.
