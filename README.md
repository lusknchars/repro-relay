# Repro Relay

An engineering workspace that turns bug reports into evidence-backed agent handoffs, with local and hosted guest modes. Preserve what the team observed, give each role a focused context view, and reject handoffs that reference outdated builds, worker assignments, or revoked memory.

This milestone records human observations and prepares agent context. Hermes execution, automatic fixes, and outbound channel delivery are not connected yet.

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

## Desktop

With `make dev` running, open the built desktop application. To build it:

```sh
make desktop-build
open 'target/debug/bundle/macos/Repro Relay.app'
```

For desktop development, run `make api` and then `make desktop` in a second terminal. Tauri starts Vite itself. The webview uses the same local Rust API. Packet export opens a native save dialog. This is a development app; it is not signed, notarized, self-contained, or ready for an app store.

## Check

```sh
make check
```

This runs Rust formatting, Clippy, eight PostgreSQL integration tests, the frontend production build, and two browser tests covering the workflow and guest isolation. SQLx creates isolated test databases. Browser tests use `relay_e2e` on the local PostgreSQL server, with the local workflow API at port 8180, Vite at 5180, and the guest service at 5190. They do not write into the development workspace. Test fixtures may remain in `relay_e2e` between runs.

The browser test covers intake, observation, memory review, export, stale handoff rejection, reload, and mobile overflow. Screenshots are saved under `web/test-results/` and excluded from Git. Desktop packaging is a separate `make desktop-build` check.

## Code map

- `crates/relay-api`: Rust API, input validation, transactional workflow, PostgreSQL migration, and integration tests.
- `web/src`: React interface and locally owned UI primitives.
- `web/src-tauri`: desktop shell, native save dialog, and link opening.
- `.agents/skills`: the four occasion-specific investigation, memory, interface, and release skills.
- [Current status](docs/STATUS.md), [Frontend Lab provenance](docs/FRONTEND.md), [research and experiments](docs/research/agent-techniques-aug-sep-2026.md).

The case database owns source truth. Memory retrieval provides leads, not verified root causes. Local mode serves one team on loopback. Use the configured guest runtime for public testing; its cookie sessions and workspace filters protect separate visitors.

MIT project. Copied UI primitives retain their upstream license in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Hosted guest beta

The new `REPRO_MODE=guest` runtime serves the web UI and API from one public HTTPS origin. It requires `DATABASE_URL` and `PUBLIC_ORIGIN`, or Railway's generated domain variable. Each browser receives an isolated, seven-day test workspace. Guest quotas and a feedback form are included. Existing local records stay in the `local` workspace and cannot be read by hosted guests.

See the [deployment plan and launch checklist](docs/deployment/public-beta.md). Run `make check` for both local and guest-browser workflows. `Dockerfile` and `railway.toml` package the web service; the Tauri app is excluded.
