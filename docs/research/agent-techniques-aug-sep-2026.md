# Recent agent techniques for Repro Relay

Research date: September 11, 2026. Inclusion window: first arXiv submissions from August 1 through September 11, 2026. Dates below come from primary submission histories, not search-engine crawl dates or later revisions. This is a targeted update to the [earlier research](./research-techniques-for-repro-relay.md). Application implementation remains paused.

The most useful new direction is to separate durable execution evidence from the context prepared for each decision. Add explicit freshness checks and recovery semantics, then use repeated failures across cases to propose changes to the workflow. These are proposed engineering adaptations. This review did not reproduce any experiment, verify production readiness, or establish independent replication of the reported gains.

## Papers within the requested window

| Paper | First submission | Evidence inspected | Decision for our build |
|---|---|---|---|
| MemPrism: Task-Conditioned Relational Memory Views for Long-Horizon Agents | August 7, 2026 | Primary metadata, methods, experiment tables, ablations, and public repository page | Prototype decision-specific views of the same event history |
| Beyond Memory: A Transactional Continuity Kernel for Long-Lived AI Agents | August 12, 2026 | Primary metadata and protocol analysis via companion review | Specify crash recovery before automatic retries |
| Selective Forgetting: A Graph-Based Memory Framework for Long-Term LLM Agents | August 29, 2026 | Primary metadata, methods, evaluation, and limitations | Preserve exact evidence while testing context selection |
| ChurnBench: A Drift-Aware Benchmark Demonstrating That Refresh Scheduling, Not Cache Age, Governs Staleness in Agentic AI | September 10, 2026 | Primary metadata, full PDF methods/results/validity discussion, and public repository page | Add changing-state scenarios to our evaluation |
| Ecdysis: Efficient and Effective Training of Runtime Harnesses for LLM Agents | September 10, 2026 | Primary metadata, methods and evaluation via companion review | Diagnose recurring workflow failures across cases |

All five are treated here as recent preprints. Publication recency does not establish stronger evidence than the earlier papers. Their experiments or analyses address different settings; none establishes the effectiveness of the complete Repro Relay system. The companion [execution research note](./agent-execution-aug-sep-2026.md) covers the continuity and runtime papers in detail.

## MemPrism: prepare context for the next decision

The paper stores events persistently, selects a view according to the current decision, and deterministically composes and renders that view. Its full method learns the view router and includes optical presentation. It evaluates embodied tasks and offline web action prediction; Mind2Web evaluation follows human trajectories rather than recovering from the model's own wrong clicks. On ALFWorld, it reports 40.71% success versus 31.43% with full text history, using a frozen Qwen2.5-VL-7B task model. These results do not establish a gain for modern coding agents. [Submission record](https://arxiv.org/abs/2608.06745), [methods and results](https://arxiv.org/html/2608.06745v1)

Our proposed adaptation is a text-based, untrained context builder with an inspectable output. This borrows the separation between stored evidence and decision-time presentation. It does not reproduce the learned router or optical method.

For one bug case, produce these views from the same source records:

- The investigator receives the action sequence and repeated attempts with their outcomes.
- The repair agent receives the validated reproduction, code locations under investigation, prior unsuccessful corrections, and the pinned base revision.
- The verifier receives the frozen requirements and checks, candidate revision, and exact results. Keep repair-agent explanations separate so they cannot substitute for evidence.
- The engineering update receives the current case status, verification scope, blockers, and links to evidence.

Each view must retain source event IDs. Missing or conflicting information stays visible. Switching views cannot create a new fact or silently turn a hypothesis into an observation. Keep the original report and artifacts accessible even when their text is omitted from the current prompt.

First experiment: on saved investigation states, compare a chronological text history with a task-specific text view derived from exactly the same events. Use the same model and context budget. Ask for the next useful action or the unresolved requirement, and score against independently prepared answers. After this offline check, test full executions because good single-step choices may not produce good completed investigations.

The paper links a [public implementation](https://github.com/Feld-maxiu/MemPrism). Repository availability was checked; the code, checkpoints, and experiment outputs were not executed or audited for reproducibility in this review.

## ChurnBench: distinguish stale knowledge from faulty reasoning

ChurnBench generates changing enterprise data and derives expected answers from a separate event ledger at retrieval and evaluation times. Its matched 180-task cells report 4 freshness errors with tiered refresh versus 45 without it at a 28-day cache age. The study uses one model, one framework, and synthetic software-asset data; it freezes the world during each run and does not compare multiple grounding architectures. Its title should not be generalized into a claim that age never matters. [Submission record](https://arxiv.org/abs/2609.11515), [paper, sections IV–VII](https://arxiv.org/pdf/2609.11515)

Our proposed adaptation: store the revision and observation time of every dependency used in a repair instruction. Before executing a repair or reporting a verified result, revalidate the relevant source versions. A merged patch, changed deployment, revoked observation, or changed requirement can invalidate different parts of the case.

Use targeted checks where the application exposes reliable versions. For sources that cannot be inspected cheaply, define a maximum freshness interval and return an explicit unresolved state when refresh fails. Time alone is a fallback policy, not evidence of compatibility. A source revision matching the earlier revision also does not prove that every external dependency stayed unchanged.

First experiment: prepare a case at time A, then change its build, requirement, or evidence status at time B. Compare static retrieval, interval-based refresh, and version-triggered revalidation. Independently record expected validity at both times. Count stale-context acceptance, useful-context rejection, refresh calls, and time spent blocked.

Include a change after context construction but before execution. That extends beyond ChurnBench's frozen-run setting and tests a real gap in our proposed workflow. Use controlled fixtures to know the correct answer; on live cases, freshness-versus-reasoning attribution can remain uncertain.

The [benchmark repository](https://github.com/vsingh45/churnbench) is public. We should borrow its evaluation idea before considering its infrastructure.

## Ecdysis: improve the workflow from recurring failures

Ecdysis aggregates failures across task instances and distinguishes systematic runtime problems from model-specific errors before proposing changes. Its evidence comes from small airline and retail task subsets, not software bug repair. The [companion review](./agent-execution-aug-sep-2026.md) records the evaluated models, comparisons, and scope. [First submission, September 10](https://arxiv.org/abs/2609.11677)

Our proposed adaptation: record failure signatures with the tool, stage, input schema, source state, observable error, and the next action attempted. Review a batch of cases before changing shared instructions. One agent choosing the wrong file is weak evidence that the workflow needs redesign; repeated inability to distinguish "process started" from "process completed" points to a more specific interface problem.

A candidate workflow correction should name the observed pattern, affected cases, proposed change, and the check that would demonstrate improvement. Apply it to a versioned workflow configuration in development, then evaluate it on separate cases. This is offline improvement of our agent integration, not a license for production agents to rewrite their own runtime.

First experiment: inject the same adapter defect into several different tasks and mix in unrelated model mistakes. Check whether batch analysis identifies the common defect without producing a broad rule that harms unaffected tasks. Compare the old and proposed workflow versions on held-out cases under the same execution budget.

## Transactional continuity: recover the action state after interruption

The August 12 continuity paper separates recorded execution commitments from conversational memory and studies a finite protocol model. That is formal evidence under modeled assumptions, not an end-to-end benchmark of resilient deployed agents. [Submission record](https://arxiv.org/abs/2608.11632), [detailed review](./agent-execution-aug-sep-2026.md)

Our proposed adaptation: persist action intent before dispatch, attach a stable action identifier, and record the external receipt when available. After a desktop restart or worker crash, distinguish an action known not to have run from an action whose outcome is unknown. For unknown outcomes, reconcile against the external system before retrying.

Also bind each worker's proposed transition to the case revision and execution-owner version it observed. Activate that transition only if both still match in the database transaction. If another worker has advanced the case, retain the late result as a proposal for review rather than overwriting newer state. This adapts the paper's predecessor and ownership checks to our case workflow.

This matters when a GitHub issue was created but the response was lost, or a repair job continued while the desktop app disconnected. Resuming the last chat message cannot resolve those cases by itself. Exactly-once external effects require cooperation from the external system or a reliable reconciliation mechanism; Rust and a local transaction cannot supply that guarantee alone.

First experiment: interrupt a fake connector before dispatch, after the external effect, and before recording the receipt. Restart the worker and inspect what it does. The acceptable outcome can be a reconciled result or an explicit need for review. Silently repeating an uncertain external action is a failure.

## Selective Forgetting: keep the raw evidence available

The August 29 study compares an extracted graph with flat retrieval on 500 LongMemEval questions. Its graph scores lower in token F1, 0.417 versus 0.468. The paper attributes some losses to discarding the original form of earlier statements. Pruning reduces storage, but uncertainty remains around quality effects. This uses one small extraction model and a conversational benchmark; it is not a general verdict against graph memory. [Submission record](https://arxiv.org/abs/2608.28978), [methods and limitations](https://arxiv.org/html/2608.28978v1)

Our proposed adaptation: remove low-value material from default prompt selection without deleting original bug evidence or required audit records. Keep rare but critical failed-repair counterexamples retrievable. Separate retention policy from relevance ranking.

First experiment: insert an exact error message, a rarely accessed counterexample, and a later conflicting observation. Test whether context selection preserves the facts needed for the next decision. Measure factual loss and token use separately. Do not optimize only for a smaller memory store.

## Revised next implementation step

The recent papers make the following slice more useful than immediately building a self-improving agent swarm:

1. Define the execution event and action-receipt records in the Rust domain model.
2. Build deterministic context views from those records, initially selected by workflow stage.
3. Add source-version checks to the repair and verification boundaries.
4. Test restart recovery and unknown external outcomes with a fake connector.
5. Collect enough real failure traces to evaluate batch-level workflow corrections.

A proposed minimum event contains case ID, run ID, event ID, parent event ID, event kind, action ID where applicable, timestamp, source revision, tool name, outcome, evidence reference, and evidence digest. Keep authored explanations in separate fields from tool-observed outcomes. This schema is our engineering proposal, not a schema provided by the papers.

In the desktop application, users could inspect the event timeline, the exact context sent to each role, stale sources, and outstanding actions after reconnecting. The same facts can populate channel-specific updates. These UI views make the architecture testable without exposing every implementation detail to ordinary users.

The first demo should exercise a realistic interruption. Start a reproduction, disconnect the desktop, change one source revision, then resume. Show the preserved evidence, the action reconciled correctly, and the outdated instruction rejected. A later replay can demonstrate that a reviewed workflow correction prevents a recurring failure.

None of these papers removes the need for the earlier fixed reproduction and independent verification checks. This update changes what we should instrument and test next. It does not justify claiming that the product already learns reliably, resumes safely, or outperforms a baseline.
