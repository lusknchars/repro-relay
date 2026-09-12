# Repro Relay

Repro Relay connects support and operations reports to agent investigation and developer review. Its web and desktop clients share cases, recorded evidence, project memory, and engineering handoffs.

Both clients use the selected PaceUI Ultimate Dashboard template, adapted to investigation activity, case search, and Hermes controls. See [the migration record](docs/PACEUI-MIGRATION.md).

For the next implementation work, use the [delivery protocol](docs/DELIVERY-PROTOCOL.md), [product depth review](docs/PRODUCT-DEPTH-REVIEW.md), [Orca/Warp interaction benchmark](docs/research/orca-warp-dashboard-benchmark.md), and the user-selected [Vercel configuration benchmark](docs/research/vercel-configuration-benchmark.md). The protocol defines resources, dependencies and acceptance evidence; it does not describe all of those capabilities as shipped.

The local API can submit, monitor, stop, and reconcile investigations on a configured Hermes runtime. Runs survive client reloads and retain agent answers as proposals for review. The adapter has passed protocol-fixture tests; live Hermes and Latch execution still need verification. Phone intake, outbound delivery, and automatic fixes remain planned. See [the release plan](docs/ROADMAP.md) and [client architecture](docs/CLIENT-ARCHITECTURE.md).

The [backend workflow](docs/BACKEND-WORKFLOW.md) now includes durable evidence and findings, reviewed finding memory, opt-in automatic investigation, local channel intake and delivery contracts, decisions, approved repair stages, and protected verification reports. Provider transports and live runtime enforcement remain separate integration requirements. Agent controls can display the actual stored logs and distinguish local validation from Hermes execution.

## Run locally

Requires Node 24, Rust stable, Docker Compose, and PostgreSQL client tools (`psql` and `createdb`). macOS desktop builds also require Xcode command-line tools.

```sh
make setup
make dev
```

Open http://127.0.0.1:5178. The API binds to localhost:8178 and PostgreSQL to localhost:55478. Docker keeps data in the `repro-relay_relay-data` volume. The Compose credentials are for local development only. The API also serves `web/dist` at http://127.0.0.1:8178 after a frontend build.

For an existing PostgreSQL server, export `DATABASE_URL` before running `make api`. Environment variables are read from the process; `.env.example` is documentation, not an automatically loaded config file.

## Try the workflow

1. Create a bug report and name its current build.
2. Record what you observed. A reproduced result requires steps, a build, an evidence URL, and a named author.
3. Review the observation for project memory. Another report in the same project can retrieve it by matching terms.
4. Open **Agent context**, choose a role, and prepare a handoff. Check its freshness.
5. Change the build or reassign the worker, then check the saved handoff again. The server rejects it and preserves the reason in Activity.
6. Reload the page. The report, observations, and saved handoff remain. Export the repair packet from its tab.

An evidence URL is a reference supplied by the recorder. The application has not fetched or independently verified its contents. A successful freshness check does not execute a repair.

`node scripts/seed-demo.mjs` adds two explicitly labeled fixture reports through the API for a quick walkthrough. It does not contact an external system.

## Connect an investigator

Run a dedicated Hermes gateway with its authenticated run API enabled. Pass `REPRO_HERMES_URL` and `REPRO_HERMES_KEY` to the Relay API process, then open **Agent controls**. Select a case, inspect the exact context packet, check the connection, and start a bounded investigation. Review its saved proposal, request a correction, and inspect the next context before starting a follow-up. Both web and desktop read the same saved history; reviews preserve the original output and do not automatically publish evidence or memory.

See [runner setup and recovery](docs/HERMES-RUNNER.md) for the required capabilities, endpoints, limits, and interruption behavior. Runtime credentials stay in the backend. Hosted guest workspaces cannot operate this runner. Time limits request a cooperative stop; token and spending limits must be configured in Hermes.

## Desktop

With `make dev` running, open the built desktop application. To build it:

```sh
make desktop-build
open 'target/debug/bundle/macos/Repro Relay.app'
```

For desktop development, run `make api` and then `make desktop` in a second terminal. Tauri starts Vite itself. The webview uses the same local Rust API. Packet export opens a native save dialog. The current desktop is a client for a separately running API; it does not yet bundle Hermes, Plow, Latch, or a local runner. It is not signed, notarized, self-contained, or ready for an app store.

The desktop checks its local service at startup. If unavailable, it shows setup commands and a connection retry. It remembers window size and position and includes a native **Workspace** menu. Keyboard commands are `Cmd/Ctrl+Shift+N` for a report, `Cmd/Ctrl+K` to find a case, and `Cmd/Ctrl+,` for connections. The same shortcuts work in the web workspace. They leave an open report dialog in control of focus.

Shared shadcn controls include shortcut tooltips, button press feedback, and explicit pending labels for investigation actions. GSAP introduces changed panels, results, and confirmations with short transitions. Reduced motion disables those transitions, including when the setting changes while the app is open.

## Check

```sh
make check
```

This runs Rust formatting, Clippy, PostgreSQL integration tests, the frontend production build, and browser tests covering the workflow, guest isolation, themes, keyboard interaction, mobile navigation, and the Hermes protocol fixture. SQLx creates isolated test databases. Browser tests use `relay_e2e` on the local PostgreSQL server. The workflow API uses port 8180, runner tests use API 8182 and fixture 8654, Vite uses 5180, and the guest service uses 5190. Tests do not write into the development workspace. Test fixtures may remain in `relay_e2e` between runs.

The browser test covers intake, observation, memory review, export, stale handoff rejection, reload, and mobile overflow. Screenshots are saved under `web/test-results/` and excluded from Git. Desktop packaging is a separate `make desktop-build` check.

The investigation fixture also covers proposal review retries and corrective follow-ups. `npm run test:compatibility --prefix web` checks the responsive review view and keyboard interaction against explicit mock data on port 5186. `npm run test:edge --prefix web` runs the same UI checks in installed Microsoft Edge. The Windows compatibility workflow runs Edge on Windows and checks native desktop compilation; it does not prove native interaction or live Hermes execution.

## Code map

- `crates/relay-api`: Rust API, input validation, transactional workflow, PostgreSQL migration, and integration tests.
- `web/src`: React interface and locally owned UI primitives.
- `web/src-tauri`: desktop shell, native save dialog, and link opening.
- `.agents/skills`: the four occasion-specific investigation, memory, interface, and release skills.
- [Current status](docs/STATUS.md), [Frontend Lab provenance](docs/FRONTEND.md), [research and experiments](docs/research/agent-techniques-aug-sep-2026.md).

The case database owns source truth. Memory retrieval provides leads, not verified root causes. Local mode serves one team on loopback. Use the configured guest runtime for public testing; its cookie sessions and workspace filters protect separate visitors.

Repro Relay's original code is MIT. PaceUI template source retains its product license; other components and packages retain their upstream licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Hosted guest beta

The new `REPRO_MODE=guest` runtime serves the web UI and API from one public HTTPS origin. It requires `DATABASE_URL` and `PUBLIC_ORIGIN`, or Railway's generated domain variable. Each browser receives an isolated, seven-day test workspace. Guest quotas and a feedback form are included. Existing local records stay in the `local` workspace and cannot be read by hosted guests.

See the [deployment plan and launch checklist](docs/deployment/public-beta.md). Run `make check` for both local and guest-browser workflows. `Dockerfile` and `railway.toml` package the web service; the Tauri app is excluded.
