# Paired dashboard: conversation history authenticated by the number

Design approved September 16, 2026. It describes what to build; nothing here is
shipped yet.

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
   server mints a pending session, sets it as the existing account cookie, and
   returns a short code such as `RELAY-7K2Q`.
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

Sessions reuse the existing cookie helper unchanged, which already emits
`__Host-relay_account` with `Secure` on an HTTPS origin and a 64 hex value.

### Pairing

Codes are single use, expire in ten minutes, and are consumed on first claim
whether or not the browser is still polling. A claim naming an unknown or
expired code is refused without saying which, so the endpoint cannot be used to
probe for live codes.

### Conversation record

The agent posts each inbound message and each reply it sends. Records are
idempotent on the platform's own message identifier, so a transport retry
replays rather than duplicates.

### Artifacts

The record type the dashboard has been missing. A digest or a saved task set is
stored with its title, source link and body, attached to the identity and to the
message that prompted it. This is what makes the dashboard show produced work
rather than only chatter.

### Agent write path

`relay-reach` has no HTTP path to Relay, so this is new rather than an
extension. A skill posts to the hosted origin with the bridge key in
`x-relay-chat-key`, matching how `/chat/pending` and `/chat/replies` already
authenticate. The agent keeps replying through Plow as it does today; recording
is a side effect and a failure to record never blocks a reply.

## Data

Migration `0035`, following `0034_hermes_console.sql`.

- `chat_identities`: id, handle digest unique, display name, created, last seen.
- `chat_sessions`: token hash primary key, identity, expires at, defaulting to
  seven days to match `account_sessions`.
- `pair_requests`: code primary key, browser session hash, identity when
  claimed, claimed at, created at, expires at.
- `chat_messages`: id, identity, direction in or out, body, platform, platform
  message id, created at, unique on identity and platform message id.
- `agent_artifacts`: id, identity, optional message, kind constrained to
  `digest` or `tasks`, title, source link, body, created at.

Raw handles are never stored. `handle_digest` is a salted SHA-256 of the
platform handle, the salt held in server configuration; rotating it invalidates
every pairing, which is the intended emergency control.

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
| `GET /conversations` | owner | Every identity and thread |

## Limits and refusals

| Limit | Value | On breach |
| --- | --- | --- |
| Pair code | 6 characters, 10 minutes, single use | Refuse without distinguishing unknown from expired |
| Pair attempts | 10 per hour per origin | Rate limited, as `chat-connect` already is |
| Message body | 16 KB | Refuse rather than truncate |
| Artifact body | 128 KB | Refuse, matching the skill upload limit |
| History page | 100 messages | Paginate |
| Retention | 90 days | Purge on read, as `discord_notes::purge` already does |
| Mode | Team only | Refuse in guest mode, as accounts already do |

## Access and privacy

Hosted team mode only. Guest mode refuses, matching `accounts::available`.
Local mode is untouched and keeps rejecting foreign hosts and origins.

A texter reads only their own history. The owner reads every conversation, and
the dashboard says so where a texter can see it, because a person texting an
assistant should not have to guess who else can read it. Deletion is real
deletion, not a flag.

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

Records: replayed message identifier stored once; oversized body refused;
retention purge removing content; a texter unable to read another texter's
history; the owner able to read all.

Principals: an existing owner only route refusing a texter session, which is the
regression this design is shaped to prevent.

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
