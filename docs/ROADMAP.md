# Next release plan

Updated September 12, 2026.

Repro Relay's next release is one agent that investigates a reported problem while it works, keeps its conclusions tied to evidence, and sends the current result to the configured owner. The same case is readable from the desktop workspace, a developer's terminal, and the owner's phone line.

## Product decision

The two-day target is the hackathon build and deployment window. It is not a customer onboarding promise. The release must work after a maintainer connects the required accounts and approves access.

The demo path is:

```text
Owner sends a report on Plow
        -> Hermes plans and clarifies
        -> Latch performs approved Mac/browser actions
        -> Relay records receipts, observations, and conclusions
        -> Desktop shows evidence and developer context
        -> Owner receives a reconciled result on the same line
```

The first supported workflow is a controlled web application bug. A business user can describe the symptom without knowing repositories or terminals. A developer can open the same case, inspect the action record, and continue in an existing terminal or coding agent. We will not build a general terminal manager during this release.

## Agent behavior

The agent maintains separate fields for reported symptom, observed fact, hypothesis, check, and conclusion. A hypothesis cannot become a fact without a recorded check. New evidence may revise or reject an earlier conclusion; the earlier record remains in the case history.

Each run has an owner, authorized destinations, a current case revision, a build identifier, and a bounded budget. It emits meaningful updates only when the state changes: clarification, action, blocked access, reproduction, revised conclusion, or completed verification.

## Memory and correctness

The current PostgreSQL model already preserves observations, revisions, reviewed memory, revocation, workspace scope, and versioned handoffs. The next change adds correction records and applicability metadata. Retrieval must return the source observation and its status. A revoked, superseded, or stale record cannot silently become agent instructions.

Memory retrieval stays small and scoped by workspace and project. Context is cached by case revision and build, then invalidated when either changes. Semantic retrieval can be added later behind the same source-preserving contract.

## Delivery and operations

Outbound messages use a durable queue with an idempotency key, destination authorization, attempt count, and provider receipt. A timeout enters a recoverable state. Retrying first reconciles the destination and stored marker, so one event cannot create duplicate owner updates.

The maintainer view exposes active runs, heartbeats, blocked reasons, pending deliveries, token and tool usage, and budget exhaustion. Initial limits cover elapsed time, model tokens, browser actions, retries, and concurrent runs. Usage is recorded per case so cost per useful investigation can be measured.

Plow Latch is the approved Mac and browser access layer. `hermes-plugin-plow` is the phone-line adapter. We must verify the actual Latch receipts and plugin handshake in a controlled fixture before claiming replay, video, or network traces. Screenshots and a structured action log remain the baseline evidence.

## Two-day delivery order

1. Connect Hermes to Plow and prove one inbound report, one approved Latch action, and one reply.
2. Add a bounded runner that persists action receipts, observations, hypotheses, and conclusions while the job is active.
3. Add correction-aware memory and owner delivery reconciliation, then exercise restart, timeout, stale revision, and duplicate-message cases.
4. Connect the desktop case view to live run state, export the evidence-backed handoff, deploy, and run the fresh-install verification path.

Cut first if time moves: broad integrations, a custom terminal, autonomous patching, semantic search, and dashboard polish. Keep the working report-to-evidence-to-owner loop.

## Acceptance checks

- A phone report reaches the correct workspace and owner.
- The agent records what it observed separately from what it believes.
- A changed build or rejected hypothesis updates the conclusion without deleting history.
- A restart resumes the same run or reports it as interrupted with partial evidence.
- A delivery timeout does not produce a duplicate message.
- A developer can inspect the evidence and continue from a terminal.
- The owner receives a concise result with status, evidence links, and the next action.
- Per-run usage and cost are visible to the maintainer.

