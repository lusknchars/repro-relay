# Optional Mem0 agent memory

Relay uses one Mem0 account with separate private working-note scopes for Hermes and Pi. Reviewed project observations remain in Relay's database and are read fresh on every recall. A private note never becomes a shared finding automatically.

## Setup and ownership

Install the CLI and follow [Mem0's agent signup instructions](https://docs.mem0.ai/platform/agent-signup). This integration was exercised with `@mem0/cli@0.2.13`.

```sh
npm install -g --prefix "$HOME/.local" @mem0/cli@0.2.13
~/.local/bin/mem0 init --agent --agent-caller codex
python3 integrations/mem0-memory/memory.py setup
```

For this installation, signup is already complete. Do not create another account. The human owner can claim it in place:

```sh
~/.local/bin/mem0 init --email YOUR_EMAIL
```

Mem0 sends a verification code and preserves the existing key and memories. The key stays in `~/.mem0/config.json`, readable only by its owner. Relay never copies it into browser configuration or Git. Local scope configuration and the note journal live in ignored `.data/mem0/`.

## Enable for an agent

Pi memory starts off. Enable it for new sessions in Connections → Tools library → Mem0 memory, or override the saved choice from an interactive terminal:

```sh
./relay pi start --profile personal --provider anthropic --memory mem0
```

This adds `relay_memory_recall` and `relay_memory_remember` to the three existing evidence tools. It preserves your Pi login and reads reviewed observations from the same local API as the other Pi tools. Starting a session does not upload conversation history or call a model. The model can choose the memory tools during subsequent work.

For the dedicated Hermes assessment profile:

```sh
python3 integrations/hermes-assessment/runtime.py enable-memory
```

Restart an already running gateway to discover the tools. This command preserves its provider and model configuration. Hermes authentication is separate from Pi and Mem0. Memory setup does not activate investigation execution.

Both tool servers bind their agent identity at process startup. Models cannot choose another agent, installation or project through tool arguments. The journal and configured installation ID provide local separation, not hosted tenant authentication. The account owner still has access to both scopes through Mem0 itself. Hosted and multi-tenant use are not supported by this adapter.

## Memory behavior

- `relay_memory_remember` accepts a short note of at most 2,000 characters. It stores the text with inference disabled and immutable enabled. Notes are unverified working context. Tool instructions exclude credentials and raw conversations; this is not an automated secret detector.
- `relay_memory_recall` searches at most five private notes and reads at most five current reviewed observations from Relay. Mem0 receives the query and note text. Reviewed case records stay local. Case exclusion applies to the reviewed records.
- Search currently omits metadata even when requested. The adapter fetches up to five result details concurrently, checks agent/project/installation metadata, and requires an exact match with its local journal. Rewritten or forgotten notes are excluded.
- Identical notes are deduplicated in SQLite before sending. A timeout leaves an uncertain write that is not automatically resent. A later matching search reconciles acceptance. Provider acceptance does not prove immediate search availability.
- Memory content is data, not instructions. Similar symptoms can have different causes. Recall does not establish a root cause or verify a fix.
- If Mem0 is offline, local reviewed retrieval still works. If Relay is offline, no cached reviewed records replace it. The response reports which source failed.

To hide a private note immediately from future Relay retrieval:

```sh
python3 integrations/mem0-memory/memory.py forget --agent pi --note NOTE_ID
```

This is local suppression. It does not delete the provider copy. Use Mem0's account tools for cloud deletion. An unchanged forgotten note is not automatically republished. Keep the local journal with this installation: unjournaled provider notes are intentionally excluded.

Mem0 usage is separate from Pi/Hermes model billing. The adapter does not yet import Mem0 usage into Relay charts. Smaller retrieved context is a design choice, not measured token or dollar savings. Search plus detail requests can add latency and service operations.

## Validation on September 14

A real Mem0 account was created and connected. Harmless setup markers were stored and recalled separately for Hermes and Pi. Installed Hermes discovered both memory MCP tools without a model call. Installed Pi loaded the optional five-tool allowlist and read fixture evidence with zero model tokens.

The memory tests cover cross-agent/project rejection, the live search response shape, uncertain writes, altered and forgotten notes, source-case exclusion, current reviewed-source lookup, offline fallback, argument boundaries and MCP initialization. Existing backend tests own source revision and revocation validation. `make check` includes this suite.

No paid model investigation, model-directed memory write, hosted deployment, Windows/Edge execution or measured cost reduction is claimed.
