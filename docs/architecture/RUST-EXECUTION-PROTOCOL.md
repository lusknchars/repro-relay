# Rust execution protocol

September 14, 2026. Implementation contract for the requested architecture migration. The existing repair, evidence and account APIs remain in service. This document distinguishes code already controlling runs from planned replacements.

## First migration delivered

`relay-core` owns the serialized `RunStatus` vocabulary and allowed transitions. `relay-api::runs::store` checks transitions against the stored run under the workspace transaction lock. Unknown persisted states fail deserialization. Terminal states cannot restart; stopping remains active until confirmed; a stop request cannot be withdrawn. A deadline or changed context records Stopping before the runtime request leaves the API.

Completed means the adapter reported completion. There is deliberately no Verified variant. Existing repair verification still requires separate base, candidate and regression artifact references bound to the approved commands and run. It reports `checks_reported_passed` with `independently_verified:false`. No new type can prove an external test ran merely by accepting JSON.

Migration 0016 records lifecycle and cumulative reported usage changes in `run_activity`, in the same transaction as the run write. Repeated identical polls add no event. Corrections, including a return to a previous cost value, add new events. The table has no 128-event cutoff. Database triggers reject UPDATE and DELETE while the workspace exists. The existing whole-workspace retention cascade can remove its history. Database administrators can change triggers; this is application integrity, not protection from a database administrator.

Existing runs get a `run.snapshot` at migration time. Earlier events are not reconstructed with invented dates. The bounded API `GET /api/v1/runs/{id}/activity?after=0` checks workspace ownership, returns up to 100 records and a next cursor. It excludes request bodies, credentials, context and agent transcripts. Work → Activity reads this ledger; Tools and Tests retain the separate source-receipt journal. The current client polls; SSE is not implemented here.

Admission retains its existing unique workspace/case/request key. Repeating a start returns the same run and does not add another start event. This lifecycle ledger does not yet consolidate decisions, handoffs, evidence receipts or every model/tool call into one table.

## Remaining migration, in dependency order

| Stage | Implementation boundary | Required proof before enabling |
| --- | --- | --- |
| Approval and receipt types | Move the current repair admission checks into opaque `ApprovedExecution` and `ValidatedReceipt` constructors in core. Bind approval to case revision, ownership, finding review, repository/base commit, allowed paths, commands, environment and frozen context hash. | Changed source, revoked finding, altered command or mismatched artifact refuses dispatch. Deserializing input cannot manufacture either capability. Repeated request IDs return the original outcome. |
| Provider and budget gateway | Route every model request from a supported runtime through a Rust provider client. Typed errors distinguish Auth, CreditBalance, RateLimit, PlanLimit, Network and Unknown. Usage records provider/model/pricing version and Reported or Estimated provenance. | FakeProvider verifies no request leaves without reservation; concurrent reservations cannot overspend; ambiguous network outcomes retain their reservation. A bypassing runtime must be labelled unenforced or refused for a capped recipe. |
| Typed recipes | Parse bounded YAML into Recipe. Validate against the current workspace policy and a frozen version of it. Orchestration accepts only an opaque ValidRecipe. Ship investigation → human review, then investigation → human approval → isolated repair → verification → human review. | Invalid role references, cycles/unbounded loops, unknown tools, permission expansion or missing human approval on any path to edit/merge/send fail before starting. The UI shows the exact offending role/tool/path. |
| Parent and child runs | Persist parent/child identities and frozen recipe/context before spawning Tokio tasks. Use JoinSet for bounded parallel work and CancellationToken for stop requests, with explicit stopped acknowledgements. | Restart reconciliation does not duplicate children; parent remains Stopping while any child is unresolved; worker caps and workspace totals remain enforced under concurrency. |
| Architecture Selector | First child of each recipe, read-only, with a fixed reservation deducted from the same allocation. It may select only a previously validated recipe/version. | Selector output cannot expand tools, skip gates or change the frozen package. Invalid or unaffordable choices block with an explanation. |
| Role-scoped MCP | Move the evidence server to the official Rust SDK after the provider/runtime boundary is in place. Bind authenticated role identity and workspace/run scope server-side. Filter tool discovery AND tool invocation. | A verifier cannot call memory.recall directly even if it guesses the name; wrong workspace, stale run and revoked capabilities are rejected. Hermes and Pi use the same checked contract. |
| Unified readiness and activity | Move readiness into core with explicit service, runtime, provider, memory and channel states; expose bounded SSE with reconnect cursors and revocation checks. Desktop and web consume the same facts. | Reconnect resumes without gaps/duplicates; auth revocation terminates the feed; checking configuration cannot masquerade as a successful model call or phone delivery. |

The official [Rust MCP SDK](https://github.com/modelcontextprotocol/rust-sdk) and its [releases](https://github.com/modelcontextprotocol/rust-sdk/releases) support the requested Rust direction. Pin and test the selected release when integrating it; the existing Python evidence server is still the active implementation.

## Budget semantics

Use integer money units and an explicit currency, not floating point arithmetic for enforcement. A role cap is a maximum allowed spend, not available provider credit. Validate allocations with checked arithmetic: the sum of caps, including the selector, must not exceed 60% of the workspace's unreserved remaining budget.

Before sending a request, reserve a defensible maximum charge from the same durable workspace meter. That requires a known pricing version and bounded billable input/output/tool iterations. Unknown prices or an unbounded provider feature cannot support a claimed hard dollar ceiling. Settle from authoritative reported usage where available; keep estimated provenance otherwise. Timeout, cancellation or a lost response does not prove the provider did not bill. Keep the reservation until reconciled and never silently release it for an automatic retry.

The current external Hermes adapter supplies cumulative usage after execution. Its cooperative time limit and token/cost graphs are not this gateway. No hard dollar ceiling is claimed in the shipped UI.

## Context and permissions

Freeze the selected recipe, tool allowlist, approval requirements, model/pricing identity and reviewed context per run. A workspace update may narrow or revoke permission immediately. It cannot widen an active run's permission without a new reviewed package. Context from user reports, benchmarks, tool output and Mem0 remains untrusted input and cannot change those rules.

Reviewed project knowledge retains source case/build/reviewer links. Private Mem0 notes remain separate per agent/project. The verifier's context excludes unreviewed memory. Revoked or changed evidence invalidates an approval before an edit, merge or send; the UI shows the changed source and asks for a new decision.

## Settings and account onboarding

Settings groups Agents, Models, Context and memory, and Communication. Selecting a row opens configuration without disabling other connections. A border and current status identify the selection. Provider login, agent readiness, memory preferences and channel grants remain separate facts.

Plow + Latch has one primary connection action. It connects and verifies an already authorized line; desktop then requests launch of the installed Latch app. A failed launch preserves the verified line receipt and explains the next step. Web explains that Mac actions require Latch on the Mac. First-time phone ownership authorization remains in expandable terminal help; this patch does not automate the official SMS verification or claim a working Mac action.

New account creation opens a five-step guide: Team → Settings → Knowledge → Work → Usage. Each step opens the real page, explains its purpose and offers Next, Back and Skip. Settings can replay the guide. It uses existing team knowledge and makes no model calls, publishes no memory and starts no investigations.

## Acceptance evidence

- Core tests exhaustively check terminal transitions and reject unknown/Verified states.
- API tests exercise actual admission, dispatch, stop, runtime reconciliation and append-only PostgreSQL history with a controlled Hermes fixture.
- Ledger tests cover idempotent starts, repeated polls, cost corrections, pagination beyond 128 records, secret exclusion, workspace isolation and retention.
- Browser tests exercise guided registration, in-place settings navigation, narrow screens, one Plow action and native-launch failure with mocked IPC. They do not prove live SMS delivery or native Latch actions.
- Existing repair and evidence tests remain the regression proof for approvals and reported test artifacts during migration.

No paid model request, provider signup, phone message or live repair is needed to validate this first migration.

## Shipped architecture planning and calendar

`relay-core::architecture::Architecture` validates three investigation briefs through an opaque `ValidArchitecture`. Their fixed stages retain reviewed context, one Hermes investigation, evidence and usage, and human review. The layout can move those stages without changing their order or permissions. This is a bounded precursor to full typed recipes; it does not implement additional workers, dollar reservations or role-specific tool enforcement.

Migration 0017 persists versioned team settings, repository manifest snapshots and calendar activities. Team updates reject stale versions. The run preview includes the selected validated brief and version in its context hash; the dispatch request retains that frozen context after subsequent team updates. Ordinary investigations receive the selected objective. Protected repair and verification instructions retain their existing contracts.

Architecture starts with the connected repository inventory. Research improvements saves a normal case and starts a two-minute Hermes assessment, using separate idempotency keys for case creation and run admission. It asks for source-linked alternatives and a validation plan. Snapshot metadata is bounded to fit the report; total component count reveals partial coverage. Search tool availability remains a runtime requirement, and suggestions do not change code. The deterministic team-workflow suggestion is explicitly labelled as inspection of saved records.

Calendar reads recorded runs and versioned all-day team activities within a bounded date range. Saves reject conflicting revisions, support immediate identical retries and validate related-case workspace ownership. Cancellation retains the saved activity. Calendar dates do not dispatch work. iCalendar export is a dated snapshot, not external account synchronization.
