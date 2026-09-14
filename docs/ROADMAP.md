# Next release plan

Updated September 12, 2026.

The [product depth review and skill map](PRODUCT-DEPTH-REVIEW.md) expands the accessibility, evidence/memory consistency, mobile/channel, automation, and acceptance requirements below. It distinguishes proposed work from current functionality.

Use the [delivery protocol](DELIVERY-PROTOCOL.md) to execute that direction: RP-01 through RP-15 define coverage and dependencies, D-01 through D-06 define the dashboard's user tasks, and T-01 through T-14 define acceptance scenarios. [Orca and Warp](research/orca-warp-dashboard-benchmark.md) are interaction references; PaceUI remains the selected template.

[Vercel is the selected configuration reference](research/vercel-configuration-benchmark.md), with C-01 through C-08 covering settings behavior and validation across the implementation areas.

Repro Relay's next release is one agent that investigates a reported problem while it works, keeps its conclusions tied to evidence, and sends the current result to the configured owner. The same case is readable from the desktop workspace, a developer's terminal, and the owner's phone line.

## Product decision

The [SwiftUI plan](SWIFTUI-CLIENT-PLAN.md) adds a native iPhone conversation and later macOS adaptation. The initial N-01 slice is implemented in [the iPhone app](../apple/README.md), with an isolated text-driven simulated call and inspectable fixture evidence. Real phone execution requires authenticated device access and a conversation adapter. These gates extend the release plan without claiming that native voice, repair, or messaging is already available.

The two-day target is the hackathon build and deployment window. It is not a customer onboarding promise. The release must work after a maintainer connects the required accounts and approves access.

The planned demo path is:

```text
Support or operations receives a customer report
        -> Report enters Relay through web or Plow
        -> Hermes plans and clarifies
        -> Latch performs approved Mac/browser actions
        -> Relay records receipts, observations, and conclusions
        -> Desktop shows evidence and developer context
        -> Responsible owner receives the result on an authorized channel
```

The first supported workflow is a controlled web application bug. Phone access supports intake, clarification, approvals, and results. Business owners should not need to investigate bugs from a phone. A developer can open the same case, inspect its evidence, and continue in an existing terminal or coding agent. A custom terminal manager is outside this release.

## Agent behavior

The agent maintains separate fields for reported symptom, observed fact, hypothesis, check, and conclusion. A hypothesis cannot become a fact without a recorded check. New evidence may revise or reject an earlier conclusion; the earlier record remains in the case history.

Each run has an owner, authorized destinations, a current case revision, a build identifier, and a bounded budget. It emits meaningful updates only when the state changes: clarification, action, blocked access, reproduction, revised conclusion, or completed verification.

## Memory and correctness

The current PostgreSQL model already preserves observations, revisions, reviewed memory, revocation, workspace scope, and versioned handoffs. The next change adds correction records and applicability metadata. Retrieval must return the source observation and its status. A revoked, superseded, or stale record cannot silently become agent instructions.

Memory retrieval stays small and scoped by workspace and project. Each implemented run freezes its source context and checks its revision, assignment, build, and memory validity before further execution. Shared context caching and semantic retrieval remain future work.

## Delivery and operations

Outbound messages use a durable queue with an idempotency key, destination authorization, attempt count, and provider receipt. A timeout enters a recoverable state. Retrying first reconciles the destination and stored marker, so one event cannot create duplicate owner updates.

The maintainer view exposes active runs, heartbeats, blocked reasons, pending deliveries, token and tool usage, and budget exhaustion. Initial limits cover elapsed time, model tokens, browser actions, retries, and concurrent runs. Usage is recorded per case so cost per useful investigation can be measured.

Plow Latch is the approved Mac and browser access layer. `hermes-plugin-plow` is the phone-line adapter. We must verify the actual Latch receipts and plugin handshake in a controlled fixture before claiming replay, video, or network traces. Screenshots and a structured action log remain the baseline evidence.

## Two-day delivery order

Implemented foundation: shared Tauri/web run controls, durable admission, remote status polling, cooperative stop, uncertain-dispatch reconciliation, and saved proposals with reported usage. Protocol-fixture tests cover these behaviors. See [runner setup and limits](HERMES-RUNNER.md). Live Hermes, Latch, and phone delivery are still acceptance gates.

1. Connect Hermes to Plow and prove one inbound report, one approved Latch action, and one reply.
2. Add a bounded runner that persists action receipts, observations, hypotheses, and conclusions while the job is active.
3. Add correction-aware memory and owner delivery reconciliation, then exercise restart, timeout, stale revision, and duplicate-message cases.
4. Connect the desktop case view to live run state, export the evidence-backed handoff, deploy, and run the fresh-install verification path.

Cut first if time moves: broad integrations, a custom terminal, autonomous patching, semantic search, and dashboard polish. Keep the working report-to-evidence-to-owner loop.

Use the additional two days discussed for maintainer controls, deployment recovery, measured cost per investigation, and fresh-install testing. This extends the delivery plan; it is not a claim that those features or a public deployment are complete.

## Acceptance checks

- A phone report reaches the correct workspace and owner.
- The agent records what it observed separately from what it believes.
- A changed build or rejected hypothesis updates the conclusion without deleting history.
- A restart resumes the same run or reports it as interrupted with partial evidence.
- A delivery timeout does not produce a duplicate message.
- A developer can inspect the evidence and continue from a terminal.
- The owner receives a concise result with status, evidence links, and the next action.
- Per-run usage and cost are visible to the maintainer.
