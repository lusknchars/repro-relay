# Connect Repro

Proposed scope, September 15, 2026. This is an implementation contract, not an existing deploy button or a deployment receipt.

Local implementation update: `sh connect.sh` now assembles Repro, PostgreSQL and pinned Hermes with a persistent transport credential. See [connected setup](CONNECTED-SETUP.md). The remaining proposal below concerns hosted Plow deployment and account activation; the local stack does not implement those steps.

The requested benchmark is [Plow Life Assistant](https://github.com/plow-pbc/life-assistant-hermes-agent). The product target is a connected Repro workspace with Hermes, Plow and bundled skills, not merely a skill-file preview.

## User flow

1. Choose Connect Repro.
2. Inspect the detected workspace and existing connection state. Reuse an existing compatible installation rather than minting another agent.
3. Complete Plow's owner activation if needed, and explicitly select an available line. Never replace an occupied line automatically.
4. Provision the selected supported deployment package and persistent storage. Show progress and a recoverable error for each component.
5. Bind the agent to the intended Repro workspace. Verify Relay API access, the runtime's capabilities, scoped team-context access and bundled skill availability.
6. Open the workspace. A separately authorized sample request can then verify actual model execution. Infrastructure readiness alone is not a successful investigation.

Optional provider accounts are independent. Connecting Repro must not silently authorize Google Calendar, Discord, Sentry, a model subscription, Latch access or external message delivery. Show each as available, needs authorization, unsupported or failed based on actual checks.

## Remaining gaps and original baseline

- `compose.local.yaml` alone provisions only Relay and PostgreSQL. The new connected overlay supplies pinned Hermes and runtime credential binding locally.
- `integrations/plow/connect.py` authorizes/binds an existing local Plow account and owner chat; it does not deploy a Hermes runtime.
- `crates/relay-api/src/runs.rs` expects an authenticated runtime with `/v1/capabilities` and `/v1/runs`. The pinned local Hermes image exposes this contract; hosted packages must be checked separately.
- The Skills library's Add skills dialog only previews local text. Bundled skill seeding and user-uploaded skill installation are separate delivery work.
- A cloud agent cannot reach a desktop workspace through its own `127.0.0.1`. Hosted deployment needs an authenticated reachable workspace service or an explicitly supported connector.

## Delivery order

First build and test a distributable pinned Repro Hermes variant, with a compatible runtime endpoint and bundled first-party skills. Preserve the base image's initialization contract. Keep user credentials and generated data outside image layers and Git.

Then assemble the connected stack and resumable setup coordinator. Provisioning needs stable request identities and durable step status. Interrupted setup must reconcile what exists before creating anything new. Existing credentials, agent memory and workspace records must survive restarts and updates.

Finally expose Connect Repro in the shared interface. Hosted one-click deployment additionally requires the deployment provider's supported publication/provisioning path; a GitHub push or Agent Index metadata registration alone is not proof that path exists for Repro.

## Acceptance evidence

- A clean installation opens the correct workspace without manually editing connection JSON or environment files.
- Activation belongs to the actual installing owner; no developer credential is reused.
- Repeating or interrupting setup does not create duplicate agents or overwrite another line.
- A restart preserves workspace data, agent home and reporting identity.
- Service failures and missing provider authorization remain visible independently.
- A permitted test request reaches the real configured runtime and stores its actual result in Repro.
- No unreviewed upload executes dependencies or gains additional tools during setup.
- Cloud availability, provider consumption and external delivery are reported only after their respective real checks.

The benchmark review is recorded separately in [Plow one-click findings](research/PLOW-ONE-CLICK-BENCHMARK.md).
