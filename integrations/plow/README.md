# Plow bridge

This local adapter connects a Plow owner's phone chat to Repro Relay's intake and approved-delivery APIs. It runs beside the local Rust API, uses Python's standard library, and keeps Plow credentials out of web, Tauri, and SwiftUI. It does not start a second agent.

Implemented operations:

- Check the credential's granted phone chat, line identity, advertised Latch access, and Relay runner availability.
- Register a disabled intake source and explicitly enable its reviewed version.
- Import a selected, provider-fetched owner message into a case using operator-reviewed report fields. Preserve the original message text and identity.
- Send one already-approved delivery to the exact configured owner chat, recording the provider message ID.
- Recover an accepted provider receipt after a local API failure without sending the message again.

The adapter has protocol tests. Live activation, a real phone report, provider delivery, and a Latch action each need separate evidence. The SwiftUI app remains an offline simulation until authenticated native access is implemented. This bridge does not add telephony, a voice session, or a Hermes conversation adapter.

## Choose the agent and model

Latch works with MCP-compatible agents, including Claude, Codex and Hermes. MCP supplies the tool connection; the agent authenticates with its model provider separately. In Relay, **Settings → Model providers** configures the dedicated Hermes runtime. Claude, Codex and Pi retain their own authentication. A line grant does not establish a working model or MCP connection. See [model and Latch setup](../../docs/MODEL-SETUP.md).

## Set up a line

For a first-time Plow user, Latch's setup creates the account from the phone number that sends its displayed activation message. Finish that setup to link the Mac. A Connected Mac with zero agents is a valid intermediate state; it does not provide Relay with a line credential or a running investigator. The CLI login below is a separate authorization flow for the local agent tooling. Use the current code and destination displayed by each flow.

Run Plow's official `plow-agents` tool. Its login flow requires an activation text from the account owner's phone. `--new-line` requests a new assistant line; omit that flag when using an existing line. Follow the printed activation instructions, then inspect the available lines.

```sh
git clone https://github.com/plow-pbc/plow-agents.git .data/plow-agents
git -C .data/plow-agents checkout 8ce907e220ab67018d6857e8054a41eed4ecd279
python3 .data/plow-agents/bin/plow-agents login --new-line
python3 .data/plow-agents/bin/plow-agents lines
python3 .data/plow-agents/bin/plow-agents mint ln_YOUR_NEW_LINE --credential-file .data/plow-credentials
```

Run these commands from the repository root. The account credential stays in the official tool's private configuration directory. `mint` writes a separate line-scoped credential, mode 600. Never paste either credential into chat or source code. Avoid minting onto another agent's occupied line.

During the initial local setup, the same pinned CLI may already be installed at `.data/tools/plow-agents`. That ignored installation is not required by the committed adapter.

The official [Plow CLI](https://github.com/plow-pbc/plow-agents/tree/8ce907e220ab67018d6857e8054a41eed4ecd279) owns account activation, line provisioning, credential rotation, and revocation. This project does not duplicate those authentication endpoints.

## Automatic configuration

After installing the official CLI above, reuse an existing line with `python3 integrations/plow/connect.py --login`, or explicitly request a new line with `python3 integrations/plow/connect.py --login --new-line`. Complete the ownership text printed by Plow. The helper then verifies the account's sole line and owner chat and writes the private bridge configuration. Multiple lines require `--line LINE_ID`. Existing occupied lines and differently bound configurations are preserved.

If this Mac is already authorized, use **Settings → Plow + Latch → Connect authorized Plow account**, or run `python3 integrations/plow/connect.py`. The helper finds the official CLI at either `.data/tools/plow-agents` or the pinned checkout above. It does not send messages or launch Hermes. Check connection returns the line's name, grant-check time and whether Latch was advertised; Mac actions and phone delivery remain separately unverified.

## Configure and check

```sh
mkdir -p .data/plow
cp integrations/plow/bridge.example.json .data/plow/bridge.json
```

Edit the line and chat IDs in `.data/plow/bridge.json`. Obtain the chat ID from the Plow dashboard or the granted chat listing available to the authenticated account. Both file paths in the example resolve relative to the configuration file, so the example works from `.data/plow/bridge.json`. `actor` names the local maintainer for Relay's audit trail; it is not an authenticated team identity.

Start or restart Relay with `make dev` after updating its backend, then run:

```sh
python3 integrations/plow/bridge.py --config .data/plow/bridge.json doctor
```

Doctor performs reads only. A positive `plow_grant_checked` means the provider recognized this credential and its configured owner chat at that time. `latch_advertised` means Plow returned a Mac relay URL; the URL itself is withheld. Neither proves a Latch action, provider delivery, or live Hermes investigation. `hermes_runner` comes from Relay's actual capability probe.

This first adapter supports only an active, one-to-one iMessage chat with one owner and the agent's own line. It rejects group chats, peer agents, incomplete grants, other lines, and non-phone providers. It refreshes the grant before mutations and immediately before sending. It does not follow redirects or forward the bearer token to Relay. The provider origin is fixed to `https://api.plow.co`; Relay must be a literal `127.0.0.1` HTTP origin.

## Import a phone report

```sh
python3 integrations/plow/bridge.py --config .data/plow/bridge.json register-source --project 'Repro Relay'
python3 integrations/plow/bridge.py --config .data/plow/bridge.json enable-source --source SRC_FROM_REGISTRATION --version 1
```

Registration returns an existing matching non-revoked source when one is present. Use the returned version when enabling it. Inspect the source's project and line before enabling. The backend still describes these records as local bridge grants; it does not authenticate a webhook independently.

Choose a phone message ID from the configured owner chat. Save reviewed fields in an ignored file, such as `.data/plow/report-fields.json`:

```json
{
  "title": "Customer address does not save",
  "url": "https://YOUR-APP.example/customer",
  "expected": "REPLACE with the reporter's actual expected result",
  "build": ""
}
```

Use the real application URL and expected behavior. Leave an unknown build empty. The adapter fetches the selected message directly from Plow, verifies its inbound direction and owner identity, and supplies the description itself. It does not trust a caller-supplied message body, sender, project, or destination.

```sh
python3 integrations/plow/bridge.py --config .data/plow/bridge.json import-report \
  --source SRC_FROM_REGISTRATION --message MESSAGE_ID --fields .data/plow/report-fields.json
```

The command returns a case ID and a case path for the local web application, typically `http://127.0.0.1:5178`. The case is immediately part of the same PostgreSQL history used by web/Tauri. It is a reported problem, not a verified observation. Attachments require a separate ingestion contract and are rejected in this slice.

Message history uses Plow's newest-first `starting_after` cursor. Search stops after 1,000 entries without advancing a checkpoint or claiming an unseen message was handled. This is selected-message import, not a daemon that consumes an entire phone inbox. The official Hermes plugin remains responsible for its WebSocket conversation lifecycle.

If the project automatically queues investigations, the importer requires `--allow-automatic`. It also sends `expected_config_version`; the backend checks that version in the same transaction that creates the report and queue entry. A policy change between preview and import rejects admission. Repeating the same admitted message returns its original case even if policy later changes. Other local bridge callers can omit this optional precondition for compatibility.

## Deliver an approved update

Prepare the destination binding and exact approved message through the [channel API](../../docs/BACKEND-WORKFLOW.md#decisions-and-channels). Binding provider must be `plow`, with this connection's line and chat IDs. The adapter never generates a destination or message, creates an approval, or treats phone prose as an approval of code execution.

```sh
python3 integrations/plow/bridge.py --config .data/plow/bridge.json preview-delivery --delivery DLV_APPROVED
python3 integrations/plow/bridge.py --config .data/plow/bridge.json send-approved \
  --delivery DLV_APPROVED --version REVIEWED_VERSION --body-sha256 REVIEWED_BODY_SHA256
```

Inspect the preview's exact body, destination, and source scope. Only run `send-approved` when sending that update is intended. A newly committed Relay claim must return HTTP 201 before the adapter contacts Plow. A replayed claim returns HTTP 200 and never grants another send. Relay checks source and destination versions during the claim.

The adapter writes an owner-only attempt receipt before contacting Plow. It records provider acceptance only when Plow returns a valid message ID. A timeout, error, or malformed response becomes uncertain. Provider acceptance is not a read receipt. Current grant checks reduce the scope-change window but are not atomic with Plow's send operation.

If Plow accepted the message but the Relay outcome request failed, recover the saved receipt:

```sh
python3 integrations/plow/bridge.py --config .data/plow/bridge.json record-outcome --attempt ATT_FROM_DELIVERY
```

This only records the existing attempt; it never calls Plow's send endpoint. If the process died before persisting the provider message ID, the attempt remains uncertain. Inspect provider history and use Relay's explicit reconciliation contract. Do not reset the delivery or blindly resend. Keep `.data/plow-receipts` across restarts; it contains attempt metadata and provider IDs, never credentials or message bodies.

Stored `connected`/`transport_connected` flags are not a managed bridge heartbeat. Bindings alone remain disconnected and receipts remain attributed to a local adapter. A future managed service needs durable connection health rather than turning a successful doctor check into a permanent connected badge.

## Hermes, Latch, and native access

Relay's dedicated local Hermes profile can now connect to the existing line's Latch MCP endpoint with `python3 integrations/hermes-assessment/runtime.py enable-latch`, followed by a gateway restart after active work finishes. This adds read and diagnostic tools only and rechecks the live grant on every gateway start. See [local Latch setup and verification](../hermes-assessment/README.md#connect-this-mac-through-plow-latch). The bridge's line check, a real MCP call, model inference and phone delivery remain separate checks.

The official Plow Hermes base owns gateway boot, its pinned chat plugin, and credential-derived Latch configuration. Do not replace that plugin with this REST adapter or start a second gateway manually. This bridge only links selected reports and approved outbound records to Relay.

The next runtime integration must prove that the chosen Plow Hermes image exposes Relay's required durable run capabilities, preserves one investigator slot across chat and API work, and produces actual Latch receipts. A Mac relay URL is not evidence that browser inspection or isolated repair is supported. Keep original acceptance checks outside a repair's editable scope.

The native iPhone app needs authenticated device access to the canonical case API. A Plow line token must not become an iPhone credential, and this host-local adapter must not be exposed on the LAN or Internet.

## Tests and protocol references

`make plow-check` runs adapter tests. `make check` includes them plus backend and web regression checks. Fixtures exercise grant boundaries, original-message import, pagination, policy-version forwarding, exact-body delivery, replay protection, uncertain outcomes, receipt recovery, and redirect rejection. PostgreSQL tests cover the atomic policy precondition and compatible message replay.

Protocol research checked September 13, 2026:

- [Plow Chat adapter at 5bff152](https://github.com/plow-pbc/hermes-plugin-plow/tree/5bff152abe98db219c5d4c414a6b57b6eea1cd51): granted chats, message history cursor, direction/sender fields, message POST, returned UID, and uncertain-send behavior.
- [Plow Hermes base at 8cf91f1](https://github.com/plow-pbc/plow-hermes-agent/tree/8cf91f12a7d6a9755a5da4c513031ecd1ceb25a3): identity endpoint, Latch advertisement, gateway initialization, and variant boundaries.
- [Relay's backend workflow](../../docs/BACKEND-WORKFLOW.md): source activation, scoped decisions, exclusive delivery claims, outcomes, and reconciliation.

The bridge is original Relay code; it does not vendor Plow's platform plugin.
