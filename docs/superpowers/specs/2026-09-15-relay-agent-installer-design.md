# One-command Plow agent install (`./relay agent`)

Design approved September 15, 2026. This describes what to build; it is not a record of shipped behavior.

## Why

The Agent Index sends people to `agent/`, where installing takes eight manual steps across two repositories, and the README leads with an install URL. A judge or teammate should reach a first Hermes reply with one command and one text message. Hosted one-click deployment is Plow's own mechanism, arranged with their team and expected September 16; it does not replace this command, because the Relay application still installs separately.

## What a person does

```
git clone …            # from GitHub's Code button
cd repro-relay
./relay agent
```

Requirements printed and checked by the command: Docker Desktop running, Python 3, and the phone that owns the Plow account.

The command prints one line per step: Docker checked, the activation text to send, the line it selected, the container starting, readiness, a first Hermes reply with its token count, and the number to text.

## Commands

| Command | Behavior |
| --- | --- |
| `./relay agent` | Install, or resume an interrupted install. Safe to repeat. |
| `./relay agent --new-line` | Explicitly ask Plow for a new assistant line during sign-in. Changes the Plow account, so it is never implied. |
| `./relay agent status` | Container state, selected line and number, whether Plow configured the agent, and the Index reporter's registration and last reported totals. |
| `./relay agent test "prompt"` | One prompt to the running agent; prints the reply and token usage. |
| `./relay agent stop` | Stop the container, keeping memory, install identity and reporting state. |

## Steps

Each step checks current state first, so a repeated run continues instead of redoing work.

1. **Preflight.** `docker` present, `docker compose version`, `docker info`. Missing items are listed with the action that fixes each.
2. **Official Plow client.** Reuse `.data/tools/plow-agents`; otherwise download `bin/plow-agents` pinned at commit `8ce907e220ab67018d6857e8054a41eed4ecd279` and verify SHA-256 `f69dd0eae74d82f6d9b56b66389c942df35de2665f6d8c92a62ed7b26af223aa` before use. `integrations/plow/connect.py` already reads that path.
3. **Sign in.** Only when no account token exists. The official client prints the activation phrase and destination number, then polls until the owner texts it.
4. **Select a line.** A line is free when it has no `agent_uid`. One free line is selected; several are offered as a numbered choice; none stops with the `--new-line` instruction. Occupied lines are never selected.
5. **Credential.** An existing `agent/plow-credentials` must belong to the selected line, checked through `/v1/agents/cloud/me`; a mismatch stops without changing files. Otherwise the official `mint` writes it. The client refuses occupied lines, and this command passes no override.
6. **Start.** `docker compose up -d --build` inside `agent/`, which also loads a local `compose.override.yml` when the owner has one.
7. **Wait.** Read container logs until `plow-init: configured` (ready) or `parking; no gateway will start` (stop and print the reason). After ten minutes, stop and print the log command.
8. **First result.** One prompt run through the container environment wrapper as the `hermes` user, printing the reply and its tokens. Runs after a first successful start, and whenever `test` is used.
9. **Finish.** Print the line's number to text.

## Rules

- Never select an occupied line, never overwrite a credential, and provide no force flag.
- The credential file stays mode 600, outside Git and outside the Docker build context.
- Never print tokens or keys. The activation phrase is shown because the owner must send it.
- An exclusive lock file under `.data/agent/` prevents two installs at once and is cleared on failure and interruption.
- `stop` never runs `docker compose down -v`, which would delete the agent's memory and install identity.

## Testing

Unit tests with patched client, filesystem and subprocess. No network, Docker or model calls.

- One, several and zero free lines.
- An occupied line refuses and mints nothing.
- A credential belonging to another line stops and leaves files unchanged.
- Readiness detection: configured, parked with its reason, and timeout.
- A repeated run after each step performs no new work.
- Status output with the reporter registered and unregistered, and never containing its key.
- The lock refuses a second run.
- The README's documented commands match the parser, so documentation cannot drift.

## Out of scope

Hosted one-click deployment (Plow arranges it), the Relay application installer, and showing which repository data is local versus from GitHub. The last one is the next project.
