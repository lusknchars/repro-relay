# Client architecture

Updated September 12, 2026.

Repro Relay has one case model and three client adapters. The Rust backend owns state. Hermes owns agent execution. Plow Latch supplies approved Mac and browser actions. Clients never write conclusions directly; they submit commands and render the resulting events.

```text
Support or operations report
          |
   Plow phone line
          |
       Hermes ---------- Plow Latch
          |
   Relay run coordinator
      /          \
 Desktop        Web
 developer    reviewers
```

## Desktop

The Tauri app is the developer control room. It uses the same React interface as the web client, with native packet export and external link opening. In local mode it connects to the loopback Rust API. In hosted mode it will connect to an authenticated remote runner.

The desktop client should add local runner controls in this order:

1. Detect whether the local API and runner are reachable.
2. Start, resume, cancel, and observe a run through the shared event stream.
3. Open the case's working directory in the user's configured terminal or editor.
4. Request an approved Latch operation and display its receipt.

The desktop must not embed credentials in the webview or grant unrestricted shell access. A packaged runner needs an explicit sidecar and a restricted Tauri capability. Until that runner is bundled and tested, the desktop is correctly described as a client for a separately running API.

## Web

The web client is the collaboration and review surface. It can create reports, answer clarifications, inspect evidence, review memory, approve named actions, and receive delivery status. It cannot execute arbitrary terminal commands or read a developer's filesystem.

The hosted web app uses the same case and event interfaces as the desktop. Workspace identity and permissions come from the server session, never from a client-supplied workspace ID.

## Phone

The first phone client is the Plow phone line through `hermes-plugin-plow`. It receives reports and sends concise state updates, clarification requests, approval requests, and completion messages. It is a projection of the canonical case, not a second database.

A native mobile app can follow later. It should consume the same event and command interfaces, with push notifications and mobile review controls added when the phone-line workflow proves useful.

## Shared run interface

Every client consumes the same event shape:

```json
{
  "case_id": "RR-...",
  "run_id": "RUN-...",
  "revision": 4,
  "kind": "conclusion.revised",
  "actor": "hermes",
  "at": "2026-09-12T12:00:00Z",
  "payload": {}
}
```

The backend rejects commands with an old revision, an unauthorized destination, or a stale handoff. Delivery records carry an idempotency key and provider receipt. A timeout is recoverable and must be reconciled before retrying.

## First technical slice

The first implementation slice is a controlled fixture: one Plow report, one Hermes run, one approved Latch action, persisted receipts, one conclusion update, and one owner message. The desktop displays the live run and the web client displays the final evidence. This proves the seam between clients before we add a terminal manager, native phone app, or broad integrations.

