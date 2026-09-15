# Hermes platform assessment

A dedicated Hermes home reviews captured interface state, selected source files, and actual local browser receipts. It has two read-only MCP tools: list evidence and read a bounded slice. It cannot use these tools to browse arbitrary files, run commands, edit code, approve work, or send messages. This is an assessment of captured evidence, not a simulated claim that Hermes operated a browser.

The application shows local checks separately from the later Hermes run. Test triage reads explicit journal receipts; saved or reported-running results are never presented as live execution. While Hermes is active, evidence refresh follows its checked timestamp even when the run status/version stays the same.

## Configure in Relay

**Settings → Model providers** saves an API provider, model ID and private key for the next dedicated gateway start. OpenAI API, Anthropic, Moonshot and OpenRouter are supported by this editor. Existing account sign-in and MCP permissions are preserved until you choose an API selection. See [model setup and activation](../../docs/MODEL-SETUP.md).

## Install and sign in

Prerequisites: Python 3.11–3.13 for Hermes, `uv`, the Relay development environment, and either a Moonshot API key or a ChatGPT account that can authorize Codex. The launcher itself uses Python's standard library. Setup defaults to Hermes's `openai-codex` provider; an existing Moonshot account can be used instead, as described below.

```sh
mkdir -p ~/.local/share/repro-relay
git clone --depth 1 --branch v2026.9.11 https://github.com/NousResearch/hermes-agent.git ~/.local/share/repro-relay/hermes-agent
uv sync --directory ~/.local/share/repro-relay/hermes-agent --frozen --python 3.12 --extra sms --extra mcp
python3 integrations/hermes-assessment/runtime.py setup
```

The pinned release is Hermes 0.21.2, commit `939e45c91d751fadd94dcd1b873ac3cb44846213`. The `sms` extra supplies the pinned HTTP-server dependency; no SMS account or message channel is configured. The `mcp` extra supplies the MCP client.

For Codex, run `python3 integrations/hermes-assessment/runtime.py login` and complete the device sign-in in your own browser. Do not paste credentials into chat. Setup creates a private `.data/hermes-assessment` directory, preserves its key/config on repeat, and leaves `~/.hermes` untouched. `runtime.py login` uses Hermes's official OAuth flow. Presence of saved auth is only a prerequisite; the provider still validates it when called.

The generated profile uses `gpt-5.4`, 20 maximum tool turns, memory disabled, and only this assessment MCP server. Model turns are not a dollar budget. Account/model availability is checked by the provider.

### Use an existing Moonshot / Kimi account

In `.data/hermes-assessment/config.yaml`, change only the `model` object, preserving the MCP servers and tool allowlists:

```json
{"provider":"kimi-coding","default":"kimi-k3","base_url":"https://api.moonshot.ai/v1"}
```

Use a model available to your Moonshot account. Store `KIMI_API_KEY` in the profile's private `.env`, together with `KIMI_BASE_URL=https://api.moonshot.ai/v1` and `API_SERVER_ENABLED=true`. Keep the existing `API_SERVER_KEY`, host and port. File permissions should remain `0600`.

If Pi already uses Moonshot, its API key can also authenticate this Hermes profile. Pi's login does not automatically configure Hermes. Copy the credential locally without pasting it into chat, terminal history, browser storage, or Git. Relay's dedicated model setup form can save it privately for you. This path uses the Moonshot API endpoint; a Kimi Code subscription can require a different endpoint. No Codex login is needed for this profile.

Restart the gateway after changing providers. A reachable gateway proves that Relay can submit and inspect runs; a successful model response is a separate check. Provider credit, authentication and rate-limit errors can still occur after the gateway connects.

## Capture and review

Start ordinary Relay with `make dev`, then run:

```sh
node integrations/hermes-assessment/capture.mjs
python3 integrations/hermes-assessment/publish.py
```

Capture visits the real local app on port 5178 at 1440px and 320px. It blocks API mutations, records document overflow and page errors, and captures the accessible element tree. It does not certify WCAG compliance, test screen-reader operation, run Edge on Windows, or exercise a physical phone. Those boundaries appear as explicit unrun checks. The packet records HEAD and whether the working tree was dirty.

Publishing uses the local API on port 8178. It creates a dedicated assessment case and an imported local validation record, then attaches the exact receipt and structured events. Requests have content-derived identities so an interrupted publish can be repeated without duplicate records. A newly captured packet creates a new assessment case, preserving earlier history. The printed URL opens the result in Agent controls. Packet, case identity, screenshots, logs and credentials stay outside Git.

## Connect and run Hermes

After sign-in, start the assessment gateway in one terminal:

```sh
python3 integrations/hermes-assessment/runtime.py gateway
```

Stop the ordinary `make dev` process, then start Relay with the dedicated backend credential in another terminal:

```sh
python3 integrations/hermes-assessment/runtime.py dev
./relay doctor
```

For the local desktop/backend launcher, persist `REPRO_HERMES_URL=http://127.0.0.1:8642` and `REPRO_HERMES_KEY` in the repository's private `.env`. The latter must match the profile's `API_SERVER_KEY`. Restart the Relay backend with that environment after all active runs have finished. These are backend secrets, never `VITE_` settings. Keep the gateway running separately; saving credentials does not install a service that starts after a reboot.

Open the case URL printed by `publish.py` and start its investigation, or run `./relay investigate CASE_ID --seconds 300 --watch`. The report already contains the assessment objective and evidence instructions; no new diagnosis form is required. One active/uncertain run occupies the workspace slot. A new assessment is a separate run with its own retained history, not simultaneous access to a second unrestricted worker.

Hermes loads the captured packet once when its MCP process starts. Restart the gateway after a new capture, with no active run, before reviewing that new packet. The tool replies include packet hash/build/time so the agent can check its case references. Snapshot content is untrusted evidence, never execution instructions.

Official Hermes provides durable submission/status/stop APIs. An `interrupted` terminal status now releases Relay's slot as failed while retaining partial output and usage, without automatic resubmission. Native Hermes does not advertise Relay's isolated-repair/protected-verification extension, so those actions remain unavailable. Relay currently polls status, not the optional tool-event SSE stream. Native successful runs report token totals; live usage and dollar costs may remain unreported.

## Test receipt contract

Post journal events with `event_type: "test_result"`, a producer identity/sequence, capture environment, time and artifact references. The presentation payload is:

```json
{"test_id":"connections-320-layout","name":"Connections at 320px","status":"passed","detail":"No document-level horizontal overflow observed."}
```

Statuses are `passed`, `failed`, `blocked`, `not_run`, and `running`. Highest producer sequence wins for the same producer/test ID; later arrival alone cannot replace a newer result. Counts cover loaded journal pages and are labeled partial when more records exist. Generic logs or model narrative do not establish test success. `capture_mode: "local_validation"` retains local-tool provenance, separate from `runtime_reported`, `human_recorded`, and `fixture`.

Validation: `python3 -m unittest discover -s integrations/hermes-assessment -p 'test_*.py' -v`, plus `make check` for the API/interface contracts.

References: [official API documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server), [pinned run handlers](https://github.com/NousResearch/hermes-agent/blob/v2026.9.11/gateway/platforms/api_server_runs.py), [official OAuth implementation](https://github.com/NousResearch/hermes-agent/blob/v2026.9.11/hermes_cli/auth_codex.py).

## Optional memory

`python3 integrations/hermes-assessment/runtime.py enable-memory` adds scoped Mem0 tools to this profile while preserving provider settings. See [setup, ownership and memory boundaries](../mem0-memory/README.md). Restart the gateway to load them. Memory setup does not complete provider authentication.

## Connect this Mac through Plow Latch

With the existing Plow line connected through [the bridge setup](../plow/README.md), run:

```sh
python3 integrations/hermes-assessment/runtime.py enable-latch
```

After active work finishes, stop the dedicated Hermes gateway and start it again with `runtime.py gateway`. The launcher checks the current line and owner-chat grant on each boot and passes the provider-advertised MCP endpoint and line credential directly to Hermes's environment. The profile contains variable references, not copied tokens. A revoked grant or unsupported endpoint stops startup instead of using a stale connection. Existing model, memory, evidence servers and gateway identity are preserved.

This connection adds five tools: file reading, skill listing/reading, current Mac permission status and pending-result retrieval. It does not add commands, file writing, browser actions, vault access or outgoing messages to scheduled investigations. File reads outside the shared Plow folder may need approval in Latch. Full Disk Access and macOS app permissions are separate from MCP authentication.

A gateway health response proves reachability only. Validate the connection with a real Hermes request to `plow_device_status`, followed by reading a harmless test file through `plow_read_file`. Confirm the returned content against that file and retain the run ID/output privately. Model output alone is not a tool receipt. This configuration uses the existing local gateway; it does not launch a second Plow chat agent or automatically answer the phone line.
