# Calendar, team communication and call context

This implementation serves one trusted local workspace. The shared web and desktop views use the same Rust API. Hosted account isolation, global phone onboarding and live telephony are separate release work.

## Google Calendar

An application publisher creates one Google OAuth client for Relay. End users of that published application should click Connect, choose their account and grant Calendar access; they should not create Google Cloud projects. During development or independent self-hosting, the operator supplies the application client configuration.

1. Create a project in Google Cloud and enable Google Calendar API.
2. Configure Google Auth Platform branding and audience. For an external consent screen in Testing, add the account as a test user.
3. Create a **Desktop app** OAuth client and download its JSON.
4. Save it at `.data/google-calendar/client.json` in the Relay checkout. This directory is ignored by Git.
5. In Settings → Workspace calendar, click Connect Google Calendar. Alternatively:

   ```sh
   python3 integrations/google-calendar/connect.py connect
   ```

6. Complete consent in the system browser, return to Relay and select Calendar → Load Google Calendar.

The installed-app flow uses a random loopback port, random state and PKCE S256. Refresh credentials are stored in an atomic, owner-only local file; codes and tokens never appear in UI responses or logs. The Google helper has fixed provider origins, rejects redirects, bounds responses and waits at most three minutes for consent. The Rust service restricts these operations to local mode and serializes them.

Scope: `https://www.googleapis.com/auth/calendar.events.readonly`. This slice reads primary-calendar event titles and times. It excludes descriptions, attendees and meeting links from provider responses. It requests at most four pages of 250 events within a 63-day range and marks incomplete results. Timed events retain their offset in the detail view and appear on UTC dates; all-day end dates are converted from Google's exclusive end. Google event edits and invitations are not supported. Relay's iCalendar export contains Relay activities, excluding imported Google meetings to avoid converting timed meetings into all-day events.

Loading is manual and range-bound. Events are not persisted or supplied to agents automatically. They are visible to users of the local installation while loaded. Disconnect removes the local credential; full revocation is available from the Google account's connected-app controls. The saved-authorization status is not a live health check. Broad distribution still requires publisher-owned OAuth configuration and any required Google verification. This is not multi-account hosted calendar sync.

Sources: [Google installed-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [Calendar event listing](https://developers.google.com/workspace/calendar/api/v3/reference/events/list).

## Team updates

Team → Team communication stores a name, exact project name, work role, international phone number, needs and inclusion preference. Supported work roles are developer, reviewer, QA, maintainer and product. These are local maintainer records, separate from authentication roles or verified phone ownership. The API rejects callers claiming a `phone_verified` field.

`GET /api/v1/communication/cases/{case}/routing` selects enabled profiles for that case's project and produces deterministic suggestions using the report and each role's focus. Needs remain separate context, not policy. Suggestions carry current case/owner/build scope and member versions. They are not approved deliveries.

The existing [Plow bridge](../integrations/plow/README.md) can deliver only to the exact active owner chat granted to its configured assistant line. A phone typed into onboarding does not expand that grant. To send an update using the existing transport, the maintainer must review the exact destination and body through the case channel-binding and delivery APIs; the adapter rechecks the provider grant before sending. It retains exclusive claims, retry protection and uncertain-outcome reconciliation.

**Remaining for team-wide delivery:** provider-supported recipient enrollment, proof binding each phone to its provider chat, recipient consent/revocation, and a managed transport with tested delivery receipts. No automatic broadcast worker or non-owner phone delivery was added. The UI explicitly reports this boundary.

## Call-context MCP

Configure `integrations/call-context/server.py` as a stdio MCP server in a compatible voice client or Hermes session. Team supplies the command after selecting a case and a communication profile from the same project:

```sh
python3 integrations/call-context/server.py --case CASE_ID --member MEMBER_UUID --consent
```

Only use `--consent` after the participant agrees to share this case with that client. The local operator selects the participant; the server does not authenticate a telephone caller. One activation receives a random token held in process memory, hashed in PostgreSQL, scoped to one case and member version, expiring after one hour. Preference changes, explicit closure and normal MCP shutdown close access. A crash relies on backend expiry.

Tools:

- `relay_call_context`: selected case summary, participant role/needs, reproduction conditions and the latest 20 call requests. No phone numbers or unrelated case history.
- `relay_record_call_request`: persist a supplied transcript as a clarification, test request or follow-up needing review. A stable utterance UUID makes retries idempotent; changed content with the same UUID conflicts. Limits: 2,000 characters per request, 100 requests per session and 100 activations per day.

The voice host provides audio capture and transcription. MCP does not open a microphone, establish a phone call or authenticate the speaker. Plow's existing text bridge is not a voice adapter. Call requests cannot approve code changes or message delivery, widen permissions, publish memory, or rewrite an active run's frozen context. Hermes can consult the scoped tool during its conversation; continuous audio and automatic injection into an already-running Relay investigation are not implemented. Team shows recent recorded requests and lets the operator close context.

## Reproduction conditions

Work → Reproduction conditions records a test account role, browser/OS, feature flags, test prerequisites and acceptance check against the case's current revision and build. A known build is required. Conditions use optimistic version checks and are included in future investigation preview hashes and frozen run packets. Changing conditions invalidates an older preview hash without rewriting existing runs. A changed case/build marks saved conditions as not applicable; the old record remains visible for review.

These are human-recorded conditions, not automated environment provisioning or test receipts. Existing repair plans retain their protected acceptance command, environment and verification flow. A passed test still requires actual evidence. Do not place credentials or personal customer records in condition notes.

## Contribution activity

Team → Recent contributions shows four commits with Git author initials, subject, abbreviated hash and time. View all opens a searchable dialog with up to 50 recent commits on the captured HEAD. The local context harness publishes the metadata every cycle; paused or disconnected capture becomes stale after 90 seconds. No emails, source contents or diffs are included. Git authors are not verified Relay identities, and a commit does not establish review, merge, deployment or successful verification.

The backend checks the existing repository binding and workspace scope. This is a replaceable snapshot of the current branch's recent history; it is not a permanent organization-wide contribution ledger or a productivity score.

## Workflow view

The supplied September 14 recording informed the compact node library, searchable step picker, dotted/square canvas, orthogonal edges, connection markers, fit control and right-side inspector. Repository mode remains observed metadata. Team workflow keeps its four validated stages and existing template/guidance persistence. Moving nodes changes layout, not execution order or permissions. Adding arbitrary executable nodes requires the later typed-recipe protocol.

## Validation scope

Automated tests cover OAuth state/PKCE, private credential permissions, pagination/time conversion, MCP tool restrictions, call expiry/replay/scope invalidation, guest rejection, environment preview hashing, contribution binding and provider-independent UI states. Google network responses and the OAuth exchange are fixtures in these checks. Real Google authorization requires the operator's configured OAuth client and consent. No phone message, live call or paid model request is part of these tests.
