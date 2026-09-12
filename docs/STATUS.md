# Current milestone

Updated September 12, 2026. This is the Rust and TypeScript local workflow milestone. The research documents describe the larger hackathon product; they are not claims of implemented integrations.

Implemented:

- Rust Axum API, Tokio, PostgreSQL migrations, durable cases and original observation history.
- React, TypeScript, Vite, Tailwind, and Frontend Lab Button/Badge primitives. Compact case inspector adapted from the lab's composition.
- New report, human-recorded observations, reviewed project memory, scoped exact-term retrieval, revocation, and Markdown exports.
- Deterministic investigator, repair, verifier, and update context views with source event IDs.
- Persisted handoff snapshots bound to case revision, current build, worker assignment, and referenced memories. The server rejects outdated snapshots and records the reason.
- Build updates preserve old observations and invalidate published memory. Concurrent writes use revision checks.
- Tauri desktop shell with native packet export and external browser links. API and PostgreSQL run separately and must already be available.

The freshness check is a local preflight. It does not run an agent, reserve a worker, prove evidence contents, or guarantee safe execution after the check. A real worker must atomically claim the current assignment at dispatch and reconcile external effects after interruption. Existing handoff records and source evidence survive service restarts.

Not implemented: Hermes/Plow browser investigation, autonomous repair, independent patch verification, Mem0, outbound GitHub/Slack delivery, runtime instruction evolution, authenticated shared hosting, signed installers, or App Store submission. The connections screen keeps these disconnected.

PostgreSQL stores each case aggregate as JSONB and the memory publication index relationally. One transaction-level advisory lock serializes local mutations and cross-case memory validation. This is a deliberate local-team implementation; hosted concurrency needs ordered row/dependency locks and authenticated workspace isolation. Evidence links are not fetched automatically.

The earlier Python/SQLite prototype has been replaced. No SQLite migration is provided because it was an unfinished scaffold. Existing local SQLite files, if any, are left untouched and are not read by this build.

Next milestone: connect one bounded Hermes investigation against a controlled fixture application, persist real tool receipts and evidence, then produce a reviewed GitHub draft. Add external sends only after destination authorization and receipt reconciliation are implemented. Evaluate recurring workflow corrections after collecting real failed runs.

Validation commands and the repeatable browser flow are in README.md. Automated fixtures are separate from usage and from the local demo workspace.

Validation on September 12: `make check` passed Rust formatting, Clippy with warnings denied, five isolated PostgreSQL integration tests, the production frontend build, and the Chromium workflow test. Desktop packaging passed and the executable was launched. Native save-dialog interaction has not been exercised; the available desktop accessibility bridge denied access. Browser screenshots were inspected at desktop and 390 px mobile widths.
