# Publish Repro Relay on the Agent Index

The installable Plow edition lives in [`agent/`](../agent/README.md). It derives
from the official Plow Hermes base and supplies Relay's Reach persona and task
skill. Its Docker context includes only agent content, license notices and the
reporting service. It excludes the app's private configuration and frontend.

## Pinned upstreams

- Base `plow-hermes-agent`: `8088c7f77f5ffd536a80c9dc302ebdb39e6be1d2`,
  image digest in `agent/Dockerfile`.
- Reporting service copied unchanged from `life-assistant-hermes-agent`:
  `7592281e9b6264e3b433f3f06e2c0d697f57cc3e`.
- Official `agent-index-client`: `87901f8b182a8a7c65ee3dd7267f8f835ee2a545`,
  fetched and checked against `agent/vendor/client.pin` during the build.

The upstream supervisor uses the client's `status` command to distinguish an
unregistered installation from unreadable state. It registers only the former.
The report-only key and install identity survive restarts with the Hermes home.
Plow authorization is exchanged by the official client, never by a Relay-owned
replacement authentication protocol.

## Register the listing

Only the publisher needs to provide page metadata. Installers use the image's
reporting service and their own Plow authorization.

With the container running, the publisher can use the already provisioned
credential through the official boot environment:

```sh
cd agent
docker compose exec agent /command/with-contenv /bin/sh -c '
  exec /command/s6-setuidgid hermes env HOME=/var/lib/hermes \
    /opt/hermes/.venv/bin/python3 /opt/plow/agent-index-client.py \
    --register --agent repro-relay --name "Repro Relay" \
    --blurb "An engineering agent on your own Plow line: saves tasks with owners and source quotes from meeting notes, and digests technical talks in your browser." \
    --repo https://github.com/lusknchars/repro-relay --runtime Hermes \
    --install-url https://github.com/lusknchars/repro-relay/tree/main/agent
'
```

Keep the same installation state when updating metadata. An ID already owned
by another publisher cannot be claimed; the client reports joining instead.
Do not mistake that result for publishing your own page.

## Verification

1. Open the resulting agent page from [the index](https://aiworthusing.com/agent-index).
2. Check the name, public repository and working installation link.
3. Choose **Get my agent verified** and follow the organizer's instructions.
   On September 15 the public button still showed an informational dialog,
   not a submission form. Organizer verification remains pending.
4. Have a real tester install with their own free Plow line, send meeting notes,
   retrieve the saved items after a restart and report a task completed.
5. Confirm actual usage appears after a reporting interval.

The organizer controls verification and hosted deployment. Registration does
not itself make this a one-click hosted agent. This release supplies a Docker
installation tutorial. The native desktop app and the packaged chat agent have
separate stores; neither should be presented as synchronized with the other.

## Local checks

```sh
python3 -m unittest discover -s agent/tests -v
docker compose -f agent/compose.yml build
docker run --rm --platform linux/amd64 --network none \
  --entrypoint /opt/hermes/.venv/bin/python3 repro-relay-agent:local \
  /opt/plow/agent-index-client.py --self-check
```

These tests use fixtures and make no Plow messages or model calls. Live phone
receipts, model runs and accepted usage reports are separate evidence.

Sources: [Plow Quickstart](https://github.com/plow-pbc/plow-agents#quickstart),
[official base](https://github.com/plow-pbc/plow-hermes-agent),
[working reporter example](https://github.com/plow-pbc/life-assistant-hermes-agent),
[client contract](https://github.com/plow-pbc/agent-index-client).

## Existing local Hermes installation

For the local macOS runtime, the wrapper fetches the same pinned client and
checks its hash. It passes credentials as process environment, never shell code.
Use the actual Hermes home so usage and installation identity remain together:

```sh
python3 agent/index.py register --hermes-home .data/hermes-assessment \
  --credentials .data/plow-credentials
python3 agent/index.py status --hermes-home .data/hermes-assessment
python3 agent/index.py report --hermes-home .data/hermes-assessment
```

Registration is a one-time action; schedule only `report` every 300 seconds.
The wrapper refuses reporting if a global agentsview installation would add
unrelated coding-agent usage. The container reporter remains the simplest path
for new installations. Never point both local and container reporters at the
same Hermes database.

## Validation on September 15, 2026

The public listing `repro-relay` was created using the existing Plow account.
The Index accepted a report from the dedicated local Relay Hermes store with
48,945 tokens for `kimi-k3`, including cache tokens. This is one developer
installation, not evidence of independent user adoption. Organizer verification
and hosted deployment remain pending.

The amd64 Docker image built locally. The official client passed its offline
self-check inside that image. Eight tests cover task persistence, duplicate
intake, source validation, conversation query isolation, dates, private
credentials, client integrity and report credential separation.

An isolated container used real Kimi inference with synthetic meeting notes.
Hermes saved two tasks with source quotes, dates and owners and retrieved only
Ana's task. A second container invocation read the same task from the persistent
home. This exercised model-driven task storage, not live meeting capture or
phone delivery. No Plow credential was supplied to that test container.

Repository Python checks, Rust formatting, Clippy, Rust tests and both frontend
builds passed. The 75 browser checks passed across the suites and a focused
rerun of the legacy session tests. That rerun fixed a test race: wait for the
pause request's response before reloading. Browser checks used fresh databases
to avoid an older checkout's retained repository binding.
