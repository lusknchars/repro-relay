# Current milestone

Updated September 12, 2026. The Rust and TypeScript workflow now includes a hosted guest beta, tested locally. Public deployment is pending Railway account sign-in. The research documents describe the larger hackathon product; they are not claims of implemented integrations.

Implemented:

- Rust Axum API, Tokio, PostgreSQL migrations, durable cases and original observation history.
- React, TypeScript, Vite, Tailwind, Frontend Lab Button/Badge primitives, and ReUI timeline and Radix tabs. Case activity exposes stored event sources and revisions. JetBrains Mono, a blue navigation rail, persistent light/dark themes, interactive landing preview, state-derived evidence path, keyboard tabs, and focused mobile inbox/detail views. Motion respects the device setting.
- New report, human-recorded observations, reviewed project memory, scoped exact-term retrieval, revocation, and Markdown exports.
- Deterministic investigator, repair, verifier, and update context views with source event IDs.
- Persisted handoff snapshots bound to case revision, current build, worker assignment, and referenced memories. The server rejects outdated snapshots and records the reason.
- Build updates preserve old observations and invalidate published memory. Concurrent writes use revision checks.
- Tauri desktop shell with native packet export and external browser links. The desktop client uses the same React case view as the web app; API and PostgreSQL run separately and must already be available. Client roles and the shared event contract are in [Client architecture](./CLIENT-ARCHITECTURE.md).
- Hosted guest workspaces with opaque HttpOnly cookies, scoped database access, seven-day expiry, capacity limits, and usefulness feedback. A landing page introduces the synthetic sample report and current capabilities.
- One deployment container serving the built React app and Rust API, Railway configuration, PostgreSQL TLS support, and graceful shutdown.

The freshness check is a local preflight. It does not run an agent, reserve a worker, prove evidence contents, or guarantee safe execution after the check. A real worker must atomically claim the current assignment at dispatch and reconcile external effects after interruption. Existing handoff records and source evidence survive service restarts.

Not implemented: Hermes/Plow browser investigation, autonomous repair, independent patch verification, Mem0, outbound GitHub/Slack delivery, runtime instruction evolution, persistent team accounts, signed installers, or App Store submission. The connections screen keeps external integrations disconnected.

PostgreSQL stores each case aggregate as JSONB and the memory publication index relationally. A transaction-level advisory lock per workspace serializes mutations and cross-case memory validation within that workspace; separate workspaces can progress independently. SQL filters scope every case and memory operation to the server-derived workspace. Evidence links are not fetched automatically.

The earlier Python/SQLite prototype has been replaced. No SQLite migration is provided because it was an unfinished scaffold. Existing local SQLite files, if any, are left untouched and are not read by this build.

Next: follow [the next release plan](./ROADMAP.md). The two-day target is the hackathon build and deployment window. Connect one bounded Hermes investigation through Plow Latch and the Plow phone-line plugin, persist real tool receipts, add correction-aware conclusions and reconciled owner delivery, then deploy and request verification. Keep the desktop app as the evidence and developer-control surface; do not build a custom terminal manager in this release.

Validation commands and the repeatable browser flow are in README.md. Automated fixtures are separate from usage and from the local demo workspace.

Validation on September 12: `make check` passed Rust formatting, Clippy with warnings denied, eight isolated PostgreSQL integration tests, the production frontend build, and three Chromium tests covering the workflow, separate guest sessions, feedback, themes, interactive preview, keyboard tabs, dialog focus restoration, reduced motion, and mobile navigation. Light, dark, and mobile screenshots were visually inspected. The Linux deployment container passed health, static UI, guest-session isolation, CSRF, and feedback checks against an isolated PostgreSQL database; the feedback row was verified directly. Desktop packaging previously passed and the executable was launched. Native save-dialog interaction has not been exercised; the available desktop accessibility bridge denied access.
