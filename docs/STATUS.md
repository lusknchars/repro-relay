# Current milestone

Updated September 12, 2026. Web and Tauri now share durable investigation controls through a Hermes HTTP adapter, validated with protocol fixtures. The hosted guest beta remains separate from the local runner. Public deployment is pending Railway account sign-in. Research and roadmap documents describe the larger hackathon product.

Implemented:

- Rust Axum API, Tokio, PostgreSQL migrations, durable cases and original observation history.
- React, TypeScript, Vite, Tailwind, Frontend Lab Button/Badge primitives, and ReUI timeline and Radix tabs. Case activity exposes stored event sources and revisions. JetBrains Mono, a blue navigation rail, persistent light/dark themes, interactive landing preview, state-derived evidence path, keyboard tabs, and focused mobile inbox/detail views. Motion respects the device setting.
- New report, human-recorded observations, reviewed project memory, scoped exact-term retrieval, revocation, and Markdown exports.
- Deterministic investigator, repair, verifier, and update context views with source event IDs.
- Persisted handoff snapshots bound to case revision, current build, worker assignment, and referenced memories. The server rejects outdated snapshots and records the reason.
- Build updates preserve old observations and invalidate published memory. Concurrent writes use revision checks.
- Tauri desktop shell with native packet export and external browser links. The desktop client uses the same React case view as the web app; API and PostgreSQL run separately and must already be available. Client roles and the shared event contract are in [Client architecture](./CLIENT-ARCHITECTURE.md).
- Local Hermes adapter with capability checks, idempotent admission, one active investigation, frozen source context, durable remote IDs, restart polling, cooperative stop, and uncertain-dispatch reconciliation. Case changes and revoked source memory cancel queued work or request a remote stop. Agent answers remain proposals and do not publish evidence or memory. See [setup, limits, and recovery](./HERMES-RUNNER.md).
- Shared Agent context controls for start, stop, connection checks, reconciliation, saved run history, and reported token/cost usage. Case URLs retain selection across reload; Tauri can open the same case in the local browser.
- Desktop startup connection checks with setup commands and retry; native Workspace menu commands for new reports, case search, and connections; persisted window size, position, and maximized state. The API and PostgreSQL remain separate processes.
- Shared shadcn/ui Tooltip and Kbd components, CLI configuration, keyboard commands, and explicit pending labels. GSAP introduces panel and run-state changes with 220ms transitions. Reduced motion disables these effects and reverses an active transition when the device setting changes. Report dialogs focus their first field.
- Hosted guest workspaces with opaque HttpOnly cookies, scoped database access, seven-day expiry, capacity limits, and usefulness feedback. A landing page introduces the synthetic sample report and current capabilities.
- One deployment container serving the built React app and Rust API, Railway configuration, PostgreSQL TLS support, and graceful shutdown.

The handoff freshness check remains a local preflight and does not execute a repair or prove evidence contents. Investigation admission is a separate operation that reserves the local run slot and records source context. External actions cannot be rolled back if that context changes during dispatch. Existing handoffs and source evidence survive service restarts.

Not implemented or exercised live: Latch browser investigation and tool receipts, Plow phone intake, owner delivery, autonomous repair, independent patch verification, Mem0, runtime instruction evolution, persistent team accounts, signed installers, or App Store submission. Hermes HTTP behavior is fixture-tested; a live runtime still needs verification. There is no hard token/dollar budget or packaged backend sidecar. Unknown expired submissions retain the active slot pending operator investigation.

PostgreSQL stores each case aggregate as JSONB and the memory publication index relationally. A transaction-level advisory lock per workspace serializes mutations and cross-case memory validation within that workspace; separate workspaces can progress independently. SQL filters scope every case and memory operation to the server-derived workspace. Evidence links are not fetched automatically.

The earlier Python/SQLite prototype has been replaced. No SQLite migration is provided because it was an unfinished scaffold. Existing local SQLite files, if any, are left untouched and are not read by this build.

Next: follow [the next release plan](./ROADMAP.md). The two-day target is the hackathon build and deployment window, with the additional two days discussed reserved for operations and reliability. Exercise the adapter against the intended Hermes profile with one approved Latch action, persist its real receipt, add correction-aware conclusions and authorized owner delivery, then deploy and request verification. Phone access supports support/operations intake, clarification, approvals, and results. Desktop supports evidence review and developer work.

Validation commands and the repeatable browser flow are in README.md. Automated fixtures are separate from usage and from the local demo workspace.

Validation on September 12: the previous guest-beta milestone passed container health, static UI, guest isolation, CSRF, and feedback checks. Current runner verification is recorded below. Native save-dialog interaction has not been exercised; the available desktop accessibility bridge previously denied access.

Runner validation: `make check` passed Rust formatting, Clippy with warnings denied, 18 isolated PostgreSQL integration tests, the production frontend build, and four Chromium tests. These cover the existing case/guest flows and the fixture investigation lifecycle, reload, usage display, cancellation, and mobile width. Runner desktop-width and mobile screenshots were visually inspected. `make desktop-build` produced the macOS debug app with the shared run controls. Live Hermes/Latch execution and a native run-control interaction remain untested.

Desktop and motion validation: `make check` passed all 18 PostgreSQL integration tests and six Chromium tests, including desktop startup/reconnection with a simulated environment marker, keyboard commands, dialog focus, tooltips, and reduced motion. The native crate passed Clippy and the macOS debug bundle rebuilt. Light and dark startup screenshots were inspected. Browser tests do not exercise native menu delivery, OS window restoration, or the native save dialog; those still need an interactive desktop check.
