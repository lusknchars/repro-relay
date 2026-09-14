# Repro Relay

Repro Relay connects support and operations reports to agent investigation and developer review. Its web and desktop clients share cases, recorded evidence, project memory, and engineering handoffs.

## Start Relay

Install and open Docker Desktop, then run this in Terminal:

```sh
curl -fsSL https://raw.githubusercontent.com/lusknchars/repro-relay/main/install.sh | sh
```

Relay opens at **http://127.0.0.1:8178** with a local administrator session. No signup, phone number, provider key, Node, Rust, Python or Git installation is required. The installer downloads the app, starts its database, and waits for readiness before opening the browser. A published image skips compilation; if it is unavailable, Docker builds the included source, which takes several minutes.

Already downloaded the repository? Double-click **Start Relay.command** on macOS, or run `sh start.sh`. The packaged path currently opens the browser interface; the macOS app build is described below. Connect Hermes and optional tools from Settings when you need them. Installation does not start a model or connect external accounts.

Records and settings survive restarts. Run the same command to reopen your installation. See [setup, stop, updates and sharing](docs/EASY-START.md). This is a private local workspace; cross-device team links require a shared HTTPS service.

The web and desktop clients use the supplied Reptest interface with persisted cases, investigations, reviewed evidence, usage and connection checks from the Rust/PostgreSQL backend. Account setup opens inside the app. The previous client remains available for regression testing. See [connected behavior](docs/LIVE-WORKSPACE.md).

For the next implementation work, use the [delivery protocol](docs/DELIVERY-PROTOCOL.md), [product depth review](docs/PRODUCT-DEPTH-REVIEW.md), [Orca/Warp interaction benchmark](docs/research/orca-warp-dashboard-benchmark.md), and the user-selected [Vercel configuration benchmark](docs/research/vercel-configuration-benchmark.md). The protocol defines resources, dependencies and acceptance evidence; it does not describe all of those capabilities as shipped.

The local API can submit, monitor, stop, and reconcile investigations on a configured Hermes runtime. Runs survive client reloads and retain agent answers as proposals for review. The adapter has passed protocol-fixture tests; live Hermes and Latch execution still need verification. Phone intake, outbound delivery, and automatic fixes remain planned. See [the release plan](docs/ROADMAP.md) and [client architecture](docs/CLIENT-ARCHITECTURE.md).

The [backend workflow](docs/BACKEND-WORKFLOW.md) now includes durable evidence and findings, reviewed finding memory, opt-in automatic investigation, local channel intake and delivery contracts, decisions, approved repair stages, and protected verification reports. Provider transports and live runtime enforcement remain separate integration requirements. Agent controls can display the actual stored logs and distinguish local validation from Hermes execution.

The [SwiftUI iPhone app](apple/README.md) now implements the first isolated, text-driven investigator-call simulation with report review, repair decisions, and inspectable evidence. Open `apple/ReproRelay.xcodeproj` to run it. Its [implementation plan](docs/SWIFTUI-CLIENT-PLAN.md) separates authenticated phone access, real voice execution, and native Mac adaptation into later gates.

The [local Plow bridge](integrations/plow/README.md) checks an authorized phone line, imports a selected owner report into Relay, and dispatches an exact approved update with durable receipt recovery. Setup requires Plow phone activation and a line-scoped credential. This adapter does not yet connect the SwiftUI simulation or implement live Hermes/Latch execution.

## Build the macOS app from source

From your checkout, run:

```sh
./relay setup
```

On macOS this installs frontend dependencies, starts PostgreSQL, builds the native desktop app and opens it. Local access creates or resumes the administrator profile automatically; no login, phone number, or Twilio setup is needed. Open **Team → Invite teammate by link** to add someone by name. Links from a local installation work on that computer; remote teammates need a shared HTTPS deployment. See [local access, invitations and the shared Hermes conversation](docs/LOCAL-ACCESS-AND-CHAT.md). Existing password/phone accounts remain available as optional access methods.

Source builds require Python 3.9+, Node 24+, Rust stable, and Docker with Compose. macOS desktop builds also require Xcode command-line tools. Setup lists missing prerequisites. It does not install system software, start a model, or create external accounts.

```sh
./relay setup --check         # Check prerequisites without changing anything
./relay setup --web           # Open the local web app on any supported host
./relay setup --no-open       # Build/start without opening a window
```

Linux and Windows use the web app by default. In Windows PowerShell, run `python relay setup --web`. Its interface and API share `http://127.0.0.1:8178`; signing in does not redirect to another address. Docker keeps local PostgreSQL data on port 55478 in the `repro-relay_relay-data` volume. Setup reuses a healthy running API and preserves the database and provider configuration. If you changed backend source while an older API is running, restart that service to load the new binary. A setup-started service records its PID and private log in `.data/setup/`.

For an existing PostgreSQL server, export `DATABASE_URL` before setup. It then skips Docker. Source setup reads a private `.env` as literal configuration, with existing process variables taking precedence. `.env.example` documents available variables. This command configures a trusted local installation, not a public hosted deployment.

For hot-reload development, run `make dev` after setup. For tests, the existing `make setup` also installs Chromium and prepares the test database. See [account setup and sharing](docs/ACCOUNTS-AND-TEAM.md) for local versus hosted account access.

## Try the retained backend workflow

Run `npm run dev:legacy --prefix web -- --port 5179` with the API running, then open localhost:5179. The workflow and investigator instructions below apply to that retained client. The default Reptest screens use the same persisted API; this walkthrough describes the retained client.

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

Build and open the actual macOS desktop application:

```sh
make desktop-build
open 'target/debug/bundle/macos/Repro Relay.app'
```

The bundled app loads the frontend directly and connects to its local service for account and workspace data. `make desktop` starts desktop development with Vite. Web and desktop share the same supplied source; there is no separate approximation of its layout. The existing Tauri native commands remain in Rust but need integration with the new screens. The app is a local debug build, not a signed or notarized distribution.

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

## Local investigation and repair controls

Run `./relay doctor` from this checkout, then `./relay cases` and `./relay --help`. The CLI reads the same records as the app, starts and watches configured Hermes investigations, prepares isolated Git worktrees, and dispatches approved repair stages. See [terminal setup and runtime requirements](integrations/relay-terminal/README.md). A worktree is a separate checkout, not an installed or sandboxed coding runtime.

`./relay ledger` adds local execution state for prepared repairs: fresh file observations, conditional read reuse, command proposals, and reported outcomes. It makes no model calls and never suppresses tests. Hermes action interception still needs the documented runtime adapter hooks; local ledger support alone does not establish live correction or token savings.
