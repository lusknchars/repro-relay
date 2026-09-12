# Orca and Warp dashboard benchmark

Checked September 12, 2026. This is an interaction benchmark for [Repro Relay's delivery protocol](../DELIVERY-PROTOCOL.md), based on current official documentation. It is not a hands-on competitor usability study or a measured performance comparison.

Working interpretation: “Orca Warp” refers to two products, Orca's Agent Development Environment at `onorca.dev` and Warp, including its Oz web app. The intended Orca has not yet been confirmed by the user; other products share that name. Keep the source identity provisional. None of the Relay requirements below depends on cloning either product.

Subsequent user clarification explicitly selects [Vercel for configuration](vercel-configuration-benchmark.md). This document remains supporting investigation-dashboard research; it does not override that configuration choice.

PaceUI remains the selected dashboard template. Reuse interaction principles that serve reporters, reviewers, engineers and owners. A terminal/worktree manager, general agent fleet, or replacement design system is outside this benchmark's implementation scope.

## Documented patterns and Relay requirements

The source column describes vendor-documented behavior. The adaptation and acceptance columns are our proposed Relay design decisions.

| Pattern | Documented source behavior | Relay adaptation | Acceptance and protocol mapping |
| --- | --- | --- | --- |
| Attention before inventory | Orca distinguishes agent attention states and offers a dashboard grouping them. Warp exposes run state, source, creator, usage and session access. [Orca sessions](https://www.onorca.dev/docs/model/agents-sessions), [Warp management](https://docs.warp.dev/platform/managing-cloud-agents/) | Show cases needing a decision, investigating, ready for review, or blocked; name the next action. Keep actual runtime state separate from case outcome. | D-01/D-02, RP-07: identify a pending clarification, active run and ready result without visiting unrelated cases; all statuses derive from stored state. |
| Notifications land on the work | Orca's inbox navigates to the corresponding workspace/pane. Warp documents in-app/system notifications and a shared notification center. [Orca notifications](https://www.onorca.dev/docs/notifications), [Warp agent support](https://www.warp.dev/blog/universal-agent-support-level-up-coding-agent-warp) | One attention item per meaningful case decision or actionable failure, with a direct case/event link. | D-01/D-04, RP-07/RP-10: repeated polls produce no duplicate item; an answered request shows its resolution on every client; the in-app queue works if OS notifications are denied. |
| Review is attached to its subject | Orca supports anchored diff comments, collected feedback and unresolved comments after revisions. [Orca review](https://www.onorca.dev/docs/review/annotate-ai-diff) | Attach corrections to a finding, action or artifact. Preserve original and revised conclusions and record what must be checked again. | D-03/D-05, RP-04/RP-05: rejecting one finding names the exact claim and reason; the next stage receives the correction once; unrelated evidence remains intact. |
| Inspect the output in context | Orca renders artifacts, including image comparisons and tabular views. Warp run details expose artifacts, transcript and metadata. [Orca viewers](https://www.onorca.dev/docs/editing/viewers), [Oz web app](https://docs.warp.dev/platform/oz-web-app/) | Place actual evidence beside the supported finding, with build, time, provenance and uncertainty. Provide readable summaries and accessible alternatives. | D-03, RP-03/RP-04/RP-08: a reviewer opens the supporting artifact from the finding; missing or inaccessible evidence is identified explicitly. |
| Reopening is different from restarting | Orca documents layout/history restoration and process continuity with host-restart limits. Warp describes session continuation and local forking when remote execution has stopped. [Orca restoration](https://www.onorca.dev/docs/model/session-restore), [Warp session sharing](https://docs.warp.dev/platform/viewing-cloud-agent-runs/) | Restore the selected case, review draft and last confirmed state. Reconcile remote uncertainty separately; closing the client never implicitly dispatches another run. | D-02/D-05/D-06, RP-06/RP-12/RP-14: reopen after an interruption and inspect the same evidence; expired/unknown work is labeled correctly; stale packets cannot be reused as current. |
| Phone work shares context | Orca's paired mobile companion operates against desktop-owned sessions and reports connection issues. Oz documents browser/mobile access to run management. [Orca mobile](https://www.onorca.dev/docs/mobile), [Oz web app](https://docs.warp.dev/platform/oz-web-app/) | Phone users receive and answer concise case decisions; web/desktop expose the same case and authoritative outcome. | D-06, RP-10: one reply becomes one attributed case event; offline status is explicit; a stale or previously resolved request cannot authorize another action. |
| Automation starts from a defined trigger | Warp supports configured event, schedule and API/CLI triggers, with environment setup separate from task input. [Warp triggers](https://docs.warp.dev/platform/triggers/), [Warp environments](https://docs.warp.dev/platform/environments/) | Begin with report-triggered investigation using configured targets, accounts, permissions and limits. Queue additional reports visibly. | D-02/D-04, RP-02/RP-06: one valid report starts once; missing context asks a specific question; report text cannot expand tool permissions. |
| Usage belongs near the work | Warp documents per-turn and conversation usage plus billing detail. [Warp usage](https://docs.warp.dev/support-and-community/plans-and-billing/credits) | Show reported cost/tokens, elapsed time, retries and enforced versus advisory limits beside the case; aggregate cost per useful investigation for maintainers. | RP-13/RP-14: absent usage is unknown; repeated snapshots do not double count; a time-stop request is never represented as a hard dollar cap. |

Orca's [agent hooks and memory documentation](https://www.onorca.dev/docs/agents/hooks-memory) concerns agent configuration and integration. It does not establish correction-safe engineering knowledge for Relay. Our evidence provenance, reviewed publication, supersession and revocation remain separate requirements.

## Dashboard tangibility

Use this illustrative case set for the design walkthrough. These are proposed fixture states, not current live investigations:

| Case state | What the card says | Useful action |
| --- | --- | --- |
| Missing expected behavior | “Needs your answer: should this export include archived accounts?” | Answer the specific clarification. |
| Investigator working | “Checking Export on build A. Last confirmed action: selected Last month.” | Inspect evidence and current objective; stop remains available. |
| Proposed result | “No download observed during the stated check. Evidence ready for review.” | Review the observation and supporting receipt. |
| Changed context | “Build changed since this investigation. Previous evidence is preserved.” | Inspect changes and request a new check. |
| Uncertain delivery | “The provider may have accepted this update; confirmation is missing.” | Inspect reconciliation status; no blind resend button. |

Do not use fabricated progress percentages, invented time saved, or optimistic “delivered” badges. Activity counts may remain secondary; the primary content is the current decision and the evidence needed to make it.

The role-specific emphasis is:

- Reporter: interpreted problem, missing detail, progress and result.
- Reviewer: claim, actual evidence, uncertainty and correction controls.
- Developer: current handoff, environment/build, attempts, sources and export.
- Owner: reported impact, observed outcome, responsible person and next action.
- Maintainer: readiness, blocked/uncertain work, permissions, usage and recovery.

These are views of the same case, not independent histories or additional reasoning agents. Role-specific emphasis is not an authorization mechanism; access rules remain server-enforced.

## Benchmark evaluation procedure

Run the following on the implemented Relay workflow with representative users. Record assistance, wrong turns, completion time, and evidence inspected. The observations should guide iteration; no scores or comparative wins have been measured yet.

| Task | Success condition | Failure worth recording |
| --- | --- | --- |
| Find the pending decision | User identifies the case, reason and appropriate action from Overview. | Opens unrelated cases or mistakes a running case for a pending decision. |
| Establish why a result is trustworthy | User finds the source evidence and correctly distinguishes observation from hypothesis. | Treats a model proposal or status badge as proof. |
| Correct a conclusion | User records a correction and can still inspect the original claim. | Overwrites history or cannot tell which statement the feedback concerns. |
| Continue after interruption | User returns to the same case and understands whether execution continued, stopped or is uncertain. | Starts a duplicate run or assumes client closure stopped the agent. |
| Act from a phone | User answers the pending decision and sees its server-confirmed result on desktop. | Double approval, inaccessible control, lost input, or false success while offline. |
| Continue in engineering | Engineer obtains a current packet and can proceed without avoidable clarification. | Missing build/evidence, stale context or duplicated manual transcription. |

For keyboard, screen-reader and phone trials, apply the detailed accessibility checks in [the depth review](../PRODUCT-DEPTH-REVIEW.md). A successful mouse walkthrough is not accessibility certification. Compare future Relay iterations with the same tasks before making competitor superiority claims.

## Recommendation

Keep the current template, promote the attention queue and selected-case workspace, and make evidence review the center of interaction. Borrow Orca and Warp's attention and continuity patterns where they help Relay users. Require Relay-specific proof for memory correctness, browser receipts and authorized owner delivery. Those are the product's substantive advantage to demonstrate.
