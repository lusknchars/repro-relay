# Relay from your terminal

Start a source installation with `./relay setup`. It builds and opens the macOS desktop app, or the web app on other platforms. Use `./relay setup --check` for a read-only prerequisites check and `./relay setup --web` to choose the browser. The first build needs Node 24+, Rust, Python 3.9+, Docker/Compose or an existing `DATABASE_URL`, and Xcode command-line tools for macOS desktop.

Setup preserves existing data and provider credentials. It reuses a healthy API on port 8178, refuses to stop an unknown process occupying that port, and skips unchanged dependency installations after its first run. Account creation happens inside Relay. No Plow activation, provider billing or model run is part of installation. Runtime logs and the service PID are under ignored `.data/setup/`; these are local operational files, not artifacts to publish.


Run these commands from the Repro Relay checkout. Python 3 and Git are enough for the CLI. The local API and PostgreSQL must be running; `make dev` starts them with the web interface and context monitor. You can close the browser while the services continue.

```sh
./relay doctor
./relay cases
./relay --help
```

`doctor` reads the real API and Hermes connection. Terminal readiness is separate from runtime readiness. This CLI does not install Hermes or turn the existing context monitor into a coding agent.

For the additional Pi terminal harness, run `./relay pi doctor` and `./relay pi start`. Pi reads recorded context audits through Relay tools; `/relay-review` supplies the latest evidence to your selected model. Its session, authentication and usage are separate from Hermes. See [Pi setup and scope](../pi-harness/README.md).

## Investigate a case

```sh
./relay case RR-YOUR-CASE
./relay investigate RR-YOUR-CASE --watch
```

Case inspection groups the case, saved investigations, their typed findings, and repair plans. Hypotheses remain hypotheses; the CLI does not invent causal links. It also prints the web view path. The same runs appear in Agent controls, with their recorded evidence and reported token/cost charts.

Investigation admission freezes the current preview hash. An identical request uses the same idempotency key, so repeating it does not launch a second run. To request another investigation of an unchanged context deliberately, pass a distinct `--request-key`. Do not change that key to recover an uncertain request.

```sh
./relay watch RR-YOUR-CASE RUN-YOUR-RUN
./relay stop RUN-YOUR-RUN
```

Ctrl-C and a watch timeout stop the watcher, not the durable agent. `stop` requests a cooperative stop; use `watch` to observe confirmation. The API and runtime must remain running. JSON output escapes terminal control characters and can be piped to other tools.

## Prepare an isolated repair

Reuse one setup file for a repository, kept outside Git, such as `.data/repair-setup.json`:

```json
{
  "repository": "/absolute/path/to/target-repository",
  "allowed_paths": ["src/customer.ts"],
  "acceptance_command": ["npm", "run", "test:customer"],
  "regression_command": ["npm", "test"],
  "environment": "Local development test environment",
  "requested_by": "Your name"
}
```

Use actual test commands and reviewed edit paths. The example is not executable configuration for an unknown target. Original acceptance checks must stay outside the repair agent's editable scope. Setup is reusable; choosing a different bug may require another original acceptance check.

Select a current accepted observed-symptom finding from the case. The server rejects a hypothesis, an unreviewed finding, or stale evidence as a repair source.

```sh
./relay plan RR-YOUR-CASE --finding EV-ACCEPTED-SYMPTOM --spec .data/repair-setup.json
./relay inspect-plan FIX-RETURNED-ID
./relay approve FIX-RETURNED-ID --version 1 --actor 'Your name'
./relay worktree FIX-RETURNED-ID --repo /absolute/path/to/target-repository
```

Plan creation observes the real repository root and HEAD. It refuses a dirty source checkout rather than stashing or inventing a base. Approval records the exact reviewed version. Use the version returned by the API; do not assume later plans are still version 1.

Worktree preparation creates a detached checkout at the approved base in a sibling `.relay-worktrees/<repository-hash>/<plan-id>` directory. It reuses only an unchanged checkout belonging to the same repository at the same base. It never cleans a directory, resets changes, merges, or pushes. Git worktrees share repository metadata and are **not a process sandbox**.

## Dispatch automatic repair and verification

```sh
./relay repair FIX-RETURNED-ID --version 2 --watch
```

This invokes the canonical server repair stage. The configured runtime must advertise `isolated_repair` and `protected_acceptance`, use the intended isolated checkout, enforce the reviewed scope, and publish real candidate evidence. Preparing a local worktree does not automatically mount it into a remote runtime or configure that runtime. The CLI deliberately does not claim otherwise.

After a candidate commit and patch artifact have been recorded through the repair contract, inspect the new plan version and run the same command with that version. It dispatches protected verification using the original base, candidate and regression checks. A runtime needs `protected_verification` for this step. The backend preserves the original acceptance hash and rejects stale sources or unsupported capabilities.

The controller does not generate code by itself or manufacture candidate/test receipts. It does not auto-approve, auto-merge, or call another model behind Hermes. Runtime installation, the worktree mount, and candidate receipt publication remain adapter responsibilities. See [repair contracts](../../docs/BACKEND-WORKFLOW.md#repair-and-protected-verification) and [Hermes setup](../../docs/HERMES-RUNNER.md).

Every mutation retains the existing local-workspace and version checks. `--api http://127.0.0.1:8178/api/v1` selects another literal loopback API. Redirects, environment proxies, remote URLs and URL credentials are rejected. API bodies are bounded. No raw shell-command endpoint is exposed.

## Execution ledger: inform, govern, observe

Prepared repairs now have a persistent local ledger, based on the workflow in [this paper review](../../docs/research/execution-ledger-paper.md). It records state without another model call. These commands are adapter primitives; users do not need another prompt or per-change direction form.

```sh
./relay ledger state FIX-RETURNED-ID --repo /absolute/path/to/target-repository
./relay ledger read FIX-RETURNED-ID src/customer.ts --repo /absolute/path/to/target-repository --start 1 --end 80
./relay ledger command FIX-RETURNED-ID --repo /absolute/path/to/target-repository --category test -- npm test
./relay ledger history FIX-RETURNED-ID --repo /absolute/path/to/target-repository
```

The example path and test command are placeholders. `command` records a proposal and returns a decision; **it does not execute the command or grant permission**. Repeated tests receive a nudge and still require execution if authorized. Search, modification, and unknown command proposals also remain executable; no generic shell-result cache is enabled.

`state` rechecks previously observed files, lists recent observations and command summaries, and counts returned/reused reads. `read` returns the requested UTF-8 lines and an observation receipt. A later exact request can pass `--visible-receipt LED-RETURNED-ID`; only an unchanged file, identical range, and the caller's declaration that this receipt is still visible in the active context permit reference-only reuse. After context compaction or restart, omit visibility unless the adapter knows the earlier output remains available. The ledger cannot independently inspect the model's context.

External edits, deletion, inaccessible files, and changed/restored content observed between requests invalidate older observations. Changes are recorded without inventing an author. Freshness is checked at the read boundary; another process can change a file afterward. Only inspected files are covered. Reuse still hashes the file, so this is output deduplication, not an assertion of reduced filesystem I/O or token savings.

An adapter can record a command's outcome after execution:

```sh
./relay ledger outcome FIX-RETURNED-ID --repo /absolute/path/to/target-repository --proposal LED-COMMAND-ID --exit-code 1 --output-file /absolute/path/to/captured-output.txt
```

Outcomes are immutable and idempotent for the same proposal. They are labeled `caller_reported`, remain separate from repair verification, and do not update a case or mark a fix successful. `history --after CURSOR --limit 50` pages through observations, file changes, reuse decisions, proposals, and outcomes. Full command output is retrieved on demand instead of repeated in each state view.

The first access creates `.relay-worktrees/<repository-hash>/.ledger/<plan-id>.sqlite3`, outside the candidate checkout. It is bound to the repository/worktree and original repair contract, including the base and acceptance hash; changing plan status/version does not erase history. Modified candidate files and commits descending from the approved base are supported. Revoked or unapproved plans reject CLI ledger access. Original acceptance and edit permissions remain the runtime's responsibility.

The file is owner-readable/writable and retains selected file contents and reported output. This is local adapter state, separate from the PostgreSQL case history. It is not a security boundary against another process running as the same user. Limits are 1,000 records, 2 MiB per inspected file, 200 lines/64 KiB per read, and 64 KiB per outcome. Failed, oversized, binary, or symlinked reads are rejected without reusable receipts. No-follow file reads currently require POSIX; native Windows ledger access is unsupported and must not be advertised as tested.

### Hermes adapter contract still to connect

1. Bind the runtime to the approved worktree and original acceptance checks.
2. Call `state` before an agent turn and pass the compact state view to the existing agent.
3. Route supported file reads through `read`; track receipt visibility through context changes. Route command proposals through `command`, then apply existing runtime permissions and execute authorized commands.
4. Record actual command outcomes with their provenance. Publish candidate and protected-verification evidence through the existing backend contracts.

Until these hooks are installed and exercised, `runtime_hook_connected` remains `false`. This module does not intercept Hermes automatically, sandbox a process, perform a repair, or measure token savings. Compare equivalent tasks and actual provider usage before claiming an improvement.

## Validation

`make terminal-check` exercises loopback-only transport, stable mutation identities, dispatch gates, observer behavior, repository/base binding, changed-checkout preservation, and plan creation without executing tests. Git checks use temporary fixture repositories. A protocol-fixture run does not prove a live Hermes correction.

Ledger tests exercise exact/context-visible reuse, external changes, deletion/restoration, restart persistence, contract isolation, candidate commits, revocation, unsafe/failed reads, capacity rollback, unsuppressed tests, reported outcome immutability, and paginated history. They use temporary files and real Git worktrees, with no model invocation.
