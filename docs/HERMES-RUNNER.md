# Hermes investigation runner

Updated September 14, 2026.

The [dedicated assessment setup](../integrations/hermes-assessment/README.md) uses pinned official Hermes with captured-evidence MCP tools. Provider sign-in and a real model run remain required before claiming live integration. Native `interrupted` run status is terminal failure in Relay, with partial output retained and no automatic resubmission. The optional isolated-repair/protected-verification extension is not advertised by the pinned native runtime.

The Rust API coordinates one investigation at a time in the local workspace. Web and Tauri use the same commands and poll saved state every three seconds while Agent context is open. Closing either client does not stop execution. PostgreSQL stores the original request, runtime identity, remote run ID, state changes, context, answer, and reported usage.

This adapter has been exercised against controlled protocol fixtures. Those tests do not prove live model execution, Latch permissions, browser evidence capture, or phone delivery.

The [backend workflow](BACKEND-WORKFLOW.md) adds opt-in report scheduling, evidence ingestion, and approved repair/verification dispatch. Ordinary investigations retain their read-only instructions. Repair stages require explicit approval and additional advertised runtime capabilities. The receipt APIs accept a trusted local bridge's actual records; they do not imply that the Hermes HTTP adapter automatically streams tool receipts.

## Setup

Use a dedicated Hermes profile with its HTTP API enabled, an `API_SERVER_KEY`, and the intended tools configured by the maintainer. Start that profile's gateway with `hermes gateway`. In the Relay API process environment, set:

```text
REPRO_HERMES_URL=http://127.0.0.1:8642
REPRO_HERMES_KEY=<that runtime's API_SERVER_KEY>
```

Use HTTPS for a remote origin. Paths, embedded credentials, redirects, and public plain HTTP origins are rejected. Relay reads process environment; it does not load `.env.example`. Never put a real credential in that file or the React environment. Both variables are required together. Leaving both unset preserves the existing report and evidence workflow.

The runtime must advertise `run_submission`, `run_status`, `run_stop`, and durable run idempotency with retention of at least one hour through `/v1/capabilities`. Relay checks this before admission. The implementation follows the official [Hermes API server](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server) and [programmatic integration](https://hermes-agent.nousresearch.com/docs/developer-guide/programmatic-integration) documentation checked September 12.

Configure tool permissions, iteration limits, and spending limits in the dedicated Hermes profile. Relay's investigation instructions ask for observations and proposed conclusions, prohibit code changes, delegation, and messages, and identify case text as untrusted. These instructions are not a tool sandbox. This adapter does not implement runtime approval controls; approve requests through the trusted Hermes runtime.

## Local API

All paths below are under `/api/v1`. The existing local origin guard applies. Hosted guest mode rejects run mutations and refuses startup with configured Hermes credentials. Run reads retain workspace scoping.

| Method and path | Behavior |
| --- | --- |
| `GET /runner` | Probe required runtime capabilities; return availability and a credential-free reason. |
| `GET /cases/{id}/investigation-preview` | Preview current investigator context and its SHA-256 digest; optional `review_id` includes a requested correction. |
| `POST /cases/{id}/runs` | Admit `{revision, max_seconds, context_hash?, follow_up_review_id?}` with an `Idempotency-Key` header. |
| `GET /cases/{id}/runs` | Read saved run history, newest first. |
| `GET /cases/{id}/run-reviews` | Read the case's persisted proposal reviews, newest first. |
| `POST /runs/{id}/reviews` | Save `{case_revision, run_version, reviewer, decision, feedback}` with an `Idempotency-Key`. Decisions are `accepted`, `needs_changes`, or `dismissed`. |
| `POST /runs/{id}/stop` | Cancel an undispatched request or request a cooperative remote stop. |
| `POST /runs/{id}/reconcile` | Reconcile a run in `attention` with its original runtime. |

Admission checks the case revision, build, active slot, and runtime capabilities under the workspace transaction. It freezes the investigator context with at most five related reviewed memories. Requests over 96 KiB of context are rejected. A case retains up to 100 runs; one active or uncertain run reserves the workspace slot. Reusing an admission key returns the same run; different settings with that key conflict.

The backend checks every two seconds. Changes to the case revision, assignment, build, or validity of referenced memory cancel a queued run or request a stop for a dispatched run. Because database transactions and external execution are separate, context can change during submission. The next reconciliation marks the result stale and requests a stop; this cannot undo a tool action already performed.

## Interruption and recovery

The backend saves `dispatching` before submitting to Hermes. It uses the Relay run ID as the remote `Idempotency-Key` and keeps the exact request body. A known remote ID survives service restarts and resumes status polling. Concurrent stop requests retain their history when a submission response arrives.

A lost response, failed status request, unexpected status, or changed runtime enters `attention`. Relay holds the active slot and does not automatically resubmit uncertain work. Reconnect the original origin and credential, inspect the runtime, and choose **Reconcile run**.

For an unknown remote ID, reconciliation may replay the original request only while its context and deadline remain valid, before cancellation, and within ten minutes of admission. Durable idempotency recovers an existing run when the first request arrived; if it did not arrive, the replay may start that original authorized request. A changed, expired, or cancelled request cannot be replayed. Inspect Hermes using the Relay run ID as the idempotency key. This first version has no UI to resolve an unknown expired run manually; it keeps the slot reserved rather than claiming that execution stopped.

A stop acknowledgement is not completion. Relay keeps polling until Hermes reports `cancelled`, `completed`, or `failed`. Runtime failure can prevent confirmation. Shutting down Relay does not stop Hermes; restart the backend to resume coordination. Do not delete an active row or clear its slot to work around an uncertain execution.

## Output, memory, and cost

Agent answers remain proposals attached to the run. They do not change case observations, reproduction status, reviewed memory, or handoffs. Human review remains explicit. Stored run events describe coordinator state; they are not a browser replay or tool receipts.

The **Agent controls** workspace puts case selection, the saved investigation, and the next context packet side by side. Reviews append to history without changing the original answer. Local reviewer names are supplied by the operator, not verified team identities. A failed or cancelled run can retain partial output for review.

A `needs_changes` review can seed a bounded follow-up investigation. The preview includes the original proposal and exact feedback, marked as untrusted context. Admission checks its digest again. Newer feedback, changed source context, reassignment, or revoked memory in the source run's ancestry blocks stale follow-ups. **Use current case only** explicitly excludes the old proposal and feedback when a fresh investigation is needed. Accepting a review does not publish memory, verify a fix, or authorize source-code changes.

After an uncertain browser response, **Retry pending request** uses the original body and key. Pending requests and review drafts stay in memory while this workspace is mounted; navigating away or reloading clears them. Saved reviews and runs remain in PostgreSQL. Refreshing context preserves a draft while loading current case data.

Limits currently include one active run, 30–600 seconds until a cooperative stop request, bounded context, a 256 KiB response limit, and an answer limit of 64,000 characters. The [cost inspector](HERMES-COST-INSPECTION.md) preserves per-field usage timestamps, a bounded history of changed reports, and partial-report recovery. It shows token breakdowns, optional reported dollar cost, and case coverage, with a JSON export bound to the selected run and context. Absent usage displays **Not reported**. These controls do not enforce a hard token or dollar budget. There is no model-cost estimate or automatic owner delivery.

## Validation

`make check` includes SQL integration tests for admission races, duplicate requests, stale context, memory revocation, stop confirmation, restart recovery, unknown dispatch, cancellation during submission, runtime mismatch, and guest isolation. Review tests cover idempotency, revision checks, scoped source reviews, context digest changes, superseded feedback, revoked ancestor memory, and partial outputs. The browser fixture verifies review retry, exact preview/admission matching, bounded follow-up, preserved original output, saved history across reload, usage display, mobile width, and confirmed cancellation.

Microsoft browser testing means Edge on Windows. `.github/workflows/windows-compatibility.yml` runs a mocked UI compatibility suite in actual Edge on a Windows runner and checks the native desktop crate. It does not run the PostgreSQL/Hermes integration suite or exercise native desktop interaction. Locally, `npm run test:compatibility --prefix web` runs that UI suite in Chromium; `npm run test:edge --prefix web` requires installed Microsoft Edge. Local Chromium results are not Windows validation.

`scripts/hermes-fixture.mjs` requires `REPRO_FIXTURE_ONLY=1` and uses a test credential. Its in-memory idempotency and generated answer are only for browser tests. Do not configure it as a production runner. The next live acceptance test requires one approved Latch action and an actual receipt from the intended Hermes profile.
