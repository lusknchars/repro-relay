# Paired dashboard: conversation history authenticated by the number

Design approved September 16, 2026. It describes what to build; nothing here is
shipped yet.

Amended September 16, 2026, after the final whole branch review found the flow
could not complete in any deployment mode, although every task had passed its
own review. Changes: texter sessions use their own cookie; the hosting guard
admits the texter and agent routes by exact path; the agent writes through a
scoped tool rather than a bare skill; records are idempotent per direction; the
owner sees counts, never content, and texters are told so; revocation deletes
sessions rather than relying on salt rotation; and every route is tested in team
mode as well as local mode.

## Why

The agent talks to people every day and Relay records none of it. Reach saves
tasks through `relay-reach`, which writes into the agent's own `$HERMES_HOME`
via `tasks.py` and never reaches Relay's database. Video digests exist only as
text in a chat log. `hermes_chat_requests` stores the Team page conversation and
its `author_id` is a foreign key to `relay_accounts`, so a person texting from
iMessage has nowhere to land at all.

The result is a dashboard that cannot show the work the agent actually did. This
gives every conversation a durable home, readable from any device, where the
person reading is authenticated by the phone that already talks to the agent.

## Scope

In: a hosted deployment in team mode on one HTTPS origin; pairing that
authenticates a texter by possession of their line; per person message history;
a record type for work the agent produced; the agent's write path; and the
cross platform stance.

Out: hosting anyone's Plow credential on the server; reading history from Plow's
API; public signup or multi tenancy; posting anywhere; Windows and Linux desktop
bundles; and any relaxation of the `local_only` guard that protects local mode.

## How a person connects

1. The dashboard, served from the hosted origin, calls `POST /pair/start`. The
   server mints a pending session, sets it as the texter cookie, never the
   account cookie, and returns a short code such as `RELAY-7K2Q`.
2. The person texts that code to the agent from the phone that already talks to
   it.
3. The agent recognises the code and calls `POST /pair/claim` with its bridge
   key, reporting the code, the platform, the platform supplied display name and
   the handle.
4. The server matches an unclaimed, unexpired code, resolves or creates the
   identity behind that handle, and binds it to the pending session.
5. The browser has been polling `GET /pair/state` with its cookie. It becomes
   signed in as that person.

The session is bound to the browser that requested the code, so a code seen by
someone else is useless without that browser's cookie. Nothing secret travels
through the text message.

The trust chain is worth stating plainly: Plow tells the agent who sent a
message, and the agent tells Relay over the bridge token. Relay trusts the agent
it issued that token to. It does not independently verify a phone number, and
the spec claims no more than that.

## Units

### Principals

Texters are a separate principal, never a new role on `Identity`. Existing
handlers authorize against `identity()`, and several admit anyone holding a
role, so introducing a `texter` role there would silently widen every one of
those checks. `accounts::identity` is left untouched. New routes resolve a
texter through their own lookup, and no existing route accepts one.

This is also forced by the schema: `relay_accounts.password_hash` is `NOT NULL`
and a paired person has no password, so they cannot be an account row.

Texter and pending sessions use their own cookie, `relay_texter` locally and
`__Host-relay_texter` with `Secure` on an HTTPS origin, carrying a 64 hex value.
They never use the account cookie. Sharing that name caused two defects the
final review confirmed: the frontend's automatic local sign in overwrote a
pairing within fifteen seconds, and starting a pairing in a signed in owner's
browser signed the owner out. A separate name also makes the separation of
principals physical, rather than dependent on which table resolves a shared
cookie.

### Pairing

Codes are single use, expire in ten minutes, and are consumed on first claim
whether or not the browser is still polling. A claim naming an unknown or
expired code is refused without saying which, so the endpoint cannot be used to
probe for live codes.

### Conversation record

The agent posts each inbound message and each reply it sends. Records are
idempotent on the identity, the direction and the platform's own message
identifier together, so a transport retry replays rather than duplicates, and a
reply can never collide with the message it answers. A reply is recorded under
its own platform message id, which Plow returns when the message is sent. When a
send path returns no id, the reply is not recorded, rather than borrowing the
inbound message's id.

### Artifacts

The record type the dashboard has been missing. A digest or a saved task set is
stored with its title, source link and body, attached to the identity and to the
message that prompted it. This is what makes the dashboard show produced work
rather than only chatter.

### Agent write path

`relay-reach` has no HTTP path to Relay, so this is new rather than an
extension. Requests carry the bridge key in `x-relay-chat-key`, matching how
`/chat/pending` and `/chat/replies` already authenticate. The agent keeps
replying through Plow as it does today; recording is a side effect and a failure
to record never blocks a reply.

A skill alone cannot do this. The agent container has no Relay URL, no bridge
key and no client for these routes, so the write path is a scoped tool: a read
only connection file giving the origin and key, an allowlist of exactly the
three agent routes, the key and origin set by the tool rather than by the model,
and typed arguments so a field name cannot be misspelled. The skill describing
when to call it stays out of the agent image until that tool exists and a team
mode test proves the flow end to end.

## Data

Migration `0035`, following `0034_hermes_console.sql`.

- `chat_identities`: id, handle digest unique, display name, created, last seen.
- `chat_sessions`: token hash primary key, identity, expires at, defaulting to
  seven days to match `account_sessions`.
- `pair_requests`: code primary key, browser session hash, identity when
  claimed, claimed at, created at, expires at.
- `chat_messages`: id, identity, direction in or out, body, platform, platform
  message id, created at, unique on identity, direction and platform message id.
- `agent_artifacts`: id, identity, optional message, kind constrained to
  `digest` or `tasks`, title, source link, body, created at.

Raw handles are never stored. `handle_digest` is a salted SHA-256 computed over
the platform and the handle separately before combining, so a character cannot
shift across the field boundary. The salt is held in the `REPRO_HANDLE_SALT`
environment variable, and the server refuses to start in team mode when it is
unset, rather than failing each claim.

Rotating the salt alone revokes nothing, because an existing session never
consults it. The emergency control is to delete every row in `chat_sessions`,
which signs every paired browser out at once, and then to rotate the salt so new
claims cannot match old identities.

## Endpoints

| Route | Caller | Purpose |
| --- | --- | --- |
| `POST /pair/start` | browser | Mint a pending session, return a code |
| `GET /pair/state` | browser | Pending or signed in |
| `POST /pair/claim` | agent | Bind a code to the texter who sent it |
| `POST /conversations/messages` | agent | Record one message |
| `POST /conversations/artifacts` | agent | Record produced work |
| `GET /conversations/me` | texter | Own history, newest first |
| `DELETE /conversations/me` | texter | Erase own history |
| `GET /conversations` | owner | Who paired, last active, message and artifact counts; never content |

## Limits and refusals

| Limit | Value | On breach |
| --- | --- | --- |
| Pair code | 6 characters, 10 minutes, single use | Refuse without distinguishing unknown from expired |
| Pair attempts | 10 per calendar minute, shared | Rate limited through the same helper as `chat-connect`, which buckets by minute |
| Message body | 16 KB | Refuse rather than truncate |
| Artifact body | 128 KB | Refuse, matching the skill upload limit |
| History page | 100 messages | Paginate |
| Retention | 90 days | Purge on read, as `discord_notes::purge` already does |
| Mode | Team only | Refuse in guest mode, as accounts already do |

## Access and privacy

Hosted team mode only. Guest mode refuses, matching `accounts::available`.
Local mode is untouched and keeps rejecting foreign hosts and origins.

In team mode the hosting guard requires an account session on every API path
outside a short allowlist, which is why every route below returned 401 there.
The texter and agent routes of this design are admitted by exact path, never by
prefix: `/pair/start`, `/pair/state`, `/pair/claim`, `/conversations/messages`,
`/conversations/artifacts` and `/conversations/me`. `/conversations` itself
stays behind the account check, and mutations keep the origin requirement.

A texter reads only their own history. The owner sees who has paired, when each
was last active, and how many messages and artifacts each has, and never sees
what anyone said. The pairing page tells a texter exactly that before they pair,
because a person texting an assistant should not have to guess who else can
read it. Deletion is real deletion, not a flag, and a texter can erase their own
history from the page.

Conversation content on a server the owner operates is a genuine change in what
Relay is, and it carries retention and deletion obligations that the local only
install did not. That is the cost of the feature, accepted deliberately.

## Platforms

The hosted dashboard is the cross platform surface. It is a web page, so
Windows, Linux, macOS and a phone all reach it without a build.

The desktop app stays a macOS extra and is labelled as one. `bundle.targets` is
`app` and `dmg`, and `release.yml` runs only on `macos-15`. Tauri cannot cross
compile, so Windows and Linux bundles would need their own runners plus an
Authenticode certificate and Developer ID notarization. That spend buys nothing
the browser does not already give.

CI gains Windows and Linux coverage where it is cheap and missing: the agent
installer tests run only on `ubuntu-latest` today, through `agent.yml` and
`container.yml`. `plow_agent.py` is portable already, invoking docker as an argv
list with no shell, its single `chmod(0o700)` merely inert on Windows. Untested
is not the same as working.

Two platform facts stay true regardless. `agent/compose.yml` pins
`platform: linux/amd64`, which runs native on Windows via WSL2 and on Linux
amd64 but emulates on Apple Silicon, so the agent is faster on Windows and Linux
than on the Mac, and needs qemu on Linux arm64. And the video digest depends on
Latch driving the owner's own browser, which `video-digest/SKILL.md` describes
as a Mac. Whether Latch exists for Windows and Linux is an open question for the
Plow team, not something to assume. Reach works everywhere either way.

## Testing

Pairing: happy path; expired code; reused code; a claim from a browser that did
not request it; a claim without a bridge key; refusal in guest mode.

Records: replayed message identifier stored once; a reply stored alongside the
message it answers rather than dropped; oversized body refused; retention purge
removing content; a texter unable to read another texter's history; the owner
seeing counts but never content.

Principals: an existing owner only route refusing a texter session, which is the
regression this design is shaped to prevent; and a signed in owner who starts a
pairing staying signed in.

Every route is exercised in team mode as well as local mode, and the pairing
flow is proven end to end in team mode. The first build passed every task review
while the whole flow was refused in team mode and wiped in local mode, because
every test ran in local mode alone. A test that mocks the endpoint under test
proves nothing about that endpoint.

Platform: the installer tests running on `windows-latest` and `ubuntu-latest`.

No test performs a network call, a Plow call or a model call.

## Build order

1. Principals, sessions and pairing. Nothing else is reachable without it.
2. Message recording and the agent write path.
3. Artifacts, which is what makes the dashboard worth opening.
4. The texter's history view.
5. CI matrix, and the one failing Edge spec.

## Dependencies

- A hosted deployment with `REPRO_MODE=team` and `PUBLIC_ORIGIN`. Railway is
  documented in `docs/deployment/public-beta.md`; the Rust API cannot run on
  Vercel as an axum server because Vercel's Rust runtime builds per function
  handlers with a bounded duration, and the console follows runs over SSE for up
  to 150 seconds.
- A bridge token issued to the agent in team mode. `hermes_chat_bridge` hardcodes
  `workspace_id='local'`, which the hosted deployment must satisfy or widen.
- A new agent skill for pairing and recording, since `relay-reach` has no HTTP
  path to Relay.
- `hermes-console.spec.ts:110` fails on Windows Edge with an empty body and
  three unmocked paths reaching the catch all mock. Fifty eight specs pass in
  the same run, so Edge renders the application correctly and this is one spec's
  mocking, not a platform defect. The diagnostic should also capture `pageerror`
  so the exception names itself.
- Whether Plow Latch runs outside macOS.
