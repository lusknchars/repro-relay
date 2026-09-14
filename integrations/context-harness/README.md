# Local context harness

This worker discovers repository instruction changes without a task prompt. `make dev` starts it alongside the API and web app, bound to the current repository. It continues while the browser is closed. Stopping `make dev` stops the worker; it is not an installed system service.

For another local installation, connect the repository once:

```sh
python3 integrations/context-harness/worker.py --repo /absolute/repository/root
```

`--api http://127.0.0.1:8178/api/v1` selects the local API. `--once` runs one cycle for diagnostics or a scheduler. The worker uses Git and Python 3.9+. TOML manifest inspection uses Python 3.11's standard-library parser; on older Python it requires `tomli` or the copy bundled with pip. Credentials and a model account are unnecessary for this read-only harness. One Relay workspace binds to one repository identity; a second repository needs a separate workspace/database. The identity includes a hash of the absolute repository path.

## What runs automatically

Every 15 seconds, the worker inventories tracked AGENTS.md, CLAUDE.md, and SKILL.md files. It includes current working-tree content and records HEAD separately. It does not traverse linked documentation, load untracked files, read credentials, execute instructions from those files, or call a model. Symlinks, merge-conflicted instructions, files over 64 KiB, more than 128 files, and inventories over 256 KiB stop the scan. It checks the snapshot before recording and again before publishing an evaluation. Read-only evaluation runs automatically before any human decision.

The API fingerprints the repository identity, Git revision, sorted paths, and exact content. Repeating a snapshot refreshes its heartbeat without creating another audit or proposal. A changed snapshot invalidates pending or executing proposals from previous snapshots. Returning to a historical snapshot preserves its earlier decision, including stale or declined status.

Identical whole-file contents produce an evaluation proposal. Unique files produce an audit with no proposal. This narrow detector cannot conclude that context is generally optimal or free of conflicting instructions.

Automatic evaluation builds a candidate representation with one body per unique content hash and a source-path mapping. The API independently reconstructs the expected representation and rejects altered or missing source content. It records actual serialized input/candidate bytes, including mapping overhead. A candidate can be larger. Storage reduction is not token savings, model quality, or an applied prompt optimization. No file in the checkout changes. Once the result is recorded, the user approves or declines the candidate. Approval makes the exact current bundle available at `GET /autonomy/context`; no coding agent consumes it yet.

## Harness protocol v1

All routes are under `/api/v1`, local-maintainer-only. Hosted guests are rejected. Use the existing local API host/origin protections. This is a trusted local adapter contract, not remote worker authentication.

| Operation | Request | Result |
| --- | --- | --- |
| Inspect work | `GET /autonomy` | Monitoring version, pause/heartbeat state, latest scan, and latest 100 audits/proposals. |
| Publish discovery | `POST /autonomy/scans` with `repository`, full `revision`, `files: [{path, content}]` | Stable scan ID; same snapshot is idempotent. |
| Retrieve approved context | `GET /autonomy/context` | Exact accepted candidate for the current connected, unpaused snapshot, or `context: null`. |
| Decide | `POST /autonomy/proposals/{id}/decision` with `version`, `decision: approve\|decline` | Version-bound approval/decline of a completed evaluation. Identical immediate replay is accepted. |
| Claim | `POST /autonomy/claims` with current `scan_id` | `job: null` or a v1 `lossless_context_pack_v1` task with exact files and a 60-second lease token. |
| Publish evaluation | `POST /autonomy/proposals/{id}/result` with `lease_token`, `bundle` | Validated, persisted result. Exact replay returns the same receipt. |
| Pause/resume | `POST /autonomy/control` with control `version`, `paused` | New control version. Pause invalidates active lease tokens. |

The claim carries explicit false permissions for source writes, model calls, and external messages. A different task kind requires a new evaluator and permission contract. Do not treat this task as authorization for a coding agent.

At most three claims are admitted, including the first attempt. Expired tokens cannot publish after recovery. After the third abandoned claim, the next worker cycle records failure. Source changes and pause invalidate active tokens. A lost result acknowledgment is safe to replay with its original token and bundle. Polling again finds the durable review/decision state. Approval does not bypass a stale snapshot or paused monitoring. Decisions cannot be submitted before the evaluation exists.

The API caps audit storage at 1,000 immutable snapshots and reports a full-history error thereafter. Automatic archival and UI pagination beyond the latest 100 audits are not implemented. Earlier saved conversation previews remain under Earlier notes; the manual creation and direction composer were removed.

## Validation and remaining work

`make context-check` covers tracked-only access, symlinks, limits, exact Unicode/newline reconstruction, local-only transport, pause, and source drift. PostgreSQL tests exercise the proposal state machine and fencing. The browser suite uses a temporary Git repository and the actual Python worker against an isolated test API. Fixture findings are separate from the real repository audit.

Next execution milestone: a versioned adapter for task-specific context selection, protected model evaluation, hard spend reservations, and isolated code changes. That adapter must prove cancellation and recovery before the UI offers code approval. Hermes and voice are not connected by this worker. Windows/Edge and a persistent OS service require separate validation.

## Repository architecture inventory

When the API advertises `repository_architecture`, each unpaused cycle also publishes a manifest inventory to `POST /architectures/repository`. Architecture opens this recorded view by default. The worker reads tracked `Cargo.toml`, `package.json` and `pyproject.toml` files, extracting package names, selected declared framework dependencies, relative local dependencies, Git revision and SHA-256 hashes. It never executes package scripts or uploads entire manifests, source files or credentials.

Limits are 64 manifests, 64 KiB each, and a 2 MiB tracked-path listing. Symlinks and conflicted manifests fail inspection. Two matching inventories are required before publication. The API accepts only the repository already bound to this workspace. After 90 seconds without publication, the UI marks the snapshot stale and disables starting architecture research from it. Pausing monitoring stops publication.

This inventory is not a complete runtime or call graph. Unsupported manifests and dependencies inherited from workspace configuration are not resolved. The separate Research improvements action creates a bounded Hermes investigation using the observed metadata and selected team brief. The local worker itself makes no model calls.
