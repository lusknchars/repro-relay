# Continuous repository improvement

Proposed September 14, 2026. This records the user's expanded direction for discussion. It does not enable a background worker, change execution permissions, or replace the current implemented contracts.

## Product promise

Connect a repository, choose an outcome, and let Relay find, test, and retain useful improvements while you work. Speak to the same agent to change priorities, inspect its reasoning, or stop work. The mission continues without a new prompt for every task.

Bug investigation becomes one source of work and a way to validate changes. Other sources include relevant technical references, upstream releases, measured slow paths, accessibility problems, stale context, and LLM evaluation failures. Success means a measured improvement or a useful rejected experiment, not the number of generated patches or collected links.

## What should distinguish Relay

An external reference earns a place when Relay can explain its relevance to a named part of the repository and test a specific hypothesis about it. Preserve the complete chain:

```text
Project outcome
  -> relevant signal or reference
  -> affected module and testable hypothesis
  -> isolated experiment against a recorded baseline
  -> measured result and reviewable change
  -> accepted or rejected project knowledge
```

Background coding alone is an existing product category. [GitHub Agentic Workflows](https://github.github.com/gh-aw/) documents event-triggered and scheduled repository improvements with scoped outputs and cost controls. [Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) supports repository research, implementation plans, and changes on a branch. These are benchmarks for execution, not evidence that Relay's proposed combination is unique.

For LLM experiments, [DSPy's GEPA guide](https://dspy.ai/getting-started/gepa-optimization/) describes candidate instruction generation and evaluation using examples, metrics, and feedback. Relay can adopt the principle of measured selection without committing to DSPy as a dependency. No external benchmark score establishes a gain on Relay's own tasks. Sources checked September 14.

## Persistent missions

A mission names the repository, intended outcome, scope, baseline revision, evaluation contract, reference sources, work allowance, and permitted actions. The first setup checks repository access, runtime health, a runnable test command, and an isolated checkout before enabling work. Missing credentials produce a specific setup task.

Use one active Hermes worker initially. A deterministic coordinator schedules research, experiments, and review preparation. A lightweight watcher can detect changes while that worker executes; it queues follow-up work rather than starting a second competing editor. Voice addresses the same mission and history.

Wake on a relevant commit, upstream source change, failed check, an explicit priority change, or a configured schedule. Deduplicate repeated signals and stop when there is no useful next experiment, when the allowance is exhausted, or when prerequisites are missing. Continuous means persistent responsibility, not constant inference.

## Reference capture

Each candidate records source URL, publisher, publication/version information where available, retrieval time, a content digest, a permitted excerpt or summary, affected code paths, applicability, and its proposed experiment. A design reference, a research claim, and a reproducible performance benchmark are different kinds of evidence.

Prefer official documentation, release notes, maintained source repositories, and original papers. Rank candidates by connection to the mission, applicability to installed versions, expected benefit, implementation effort, and evaluation cost. Store rejection reasons and reconsider only when relevant source, code, or objective versions change.

External material is evidence, never authority to change tools, access rules, or the mission. Search queries must not disclose private source, credentials, or customer data. Reference capture is not permission to copy proprietary implementations or licensed assets into the project.

## Experiments and autonomy

The worker can research, edit an isolated branch, and run the checks allowed by the mission without asking again for each step. Freeze the base revision and evaluation contract at admission. Keep acceptance checks outside the candidate's editable scope; compare baseline and candidate under the same conditions. Never validate a proposal only by asking its author whether it improved the code.

For LLM work, record model and prompt versions, input set, quality metric, latency, tokens, and evaluation spend. Keep optimization examples separate from held-out acceptance examples. Repeat stochastic trials where the decision depends on variance. A cheaper result that fails quality requirements is a rejected experiment.

Fresh commits invalidate affected assumptions. Use isolated worktrees and one apply queue so background work cannot overwrite the developer's working tree. Before applying a result, check the current head and policy; rerun relevant checks after a conflict resolution. Preserve the attempted patch and result if it is rejected or superseded.

Start with autonomous branch work and review before merging. A later explicit policy may permit selected low-risk merges when current checks pass; deployment and external delivery remain separately scoped actions. Ordinary task execution cannot expand its own scope, raise its budget, or weaken its evaluator. This document grants no new runtime authority.

Enforce mission-wide limits across research, model calls, tools, retries, and evaluations. Timeouts alone are insufficient. Reserve estimated spend before dispatch, settle actual usage when available, and block new work if cost cannot be bounded. Cache unchanged references, use inexpensive deterministic checks before model calls, and cap the candidate queue.

## Memory that prevents repeated mistakes

Retain why a reference applied, the affected revision, the measured result, and whether the maintainer accepted it. An untested reference remains a candidate. A rejected technique is useful memory with an applicability scope, not a universal prohibition. Superseded and revoked knowledge remains visible in history but cannot silently become current instructions.

Keep source facts, worker hypotheses, test results, and maintainer preferences distinguishable. A new preference changes the mission version. Pending work must observe that version before its next authorized action.

## What the user sees and says

The main workspace should answer: what outcome is active, why the agent chose this work, what changed, what measured better or worse, what it cost, and what needs a decision. Keep the selected PaceUI template and adapt its content.

Use a mission list, an active-work/evidence view, and a proposed-change view. The reference is linked to the hypothesis and patch, not left in an unrelated bookmarks feed. Present baseline and candidate results with test scope and uncertainty. Terminal users can inspect the same branch and artifacts.

Voice provides short controls such as "focus on response time", "explain this experiment", or "pause work". It should not require continuous conversation. Ending the conversation preserves the mission; stopping the mission requests cancellation and retains partial results. An uncertain transcription must not authorize merging, spending more, or sending an external message. Provide text equivalents and visible recording state. Always-on listening is outside the first slice.

Plow Chat can carry intake and selected progress updates; Latch can supply approved Mac/browser actions. Native voice capture, transcription, and authenticated mission control still need implementation. Latch activation alone does not supply those features.

## First implementation slice

The user selected improved agent context quality and reduced token cost as the first mission. Use Relay itself as the proposed first repository, with unnecessary context reduction as a hypothesis to test. No target reduction percentage or quality gain has been measured yet.

Build the evaluation set from reviewed tasks with explicit expected evidence IDs and applicability. Include revoked memory, changed builds, corrections, duplicate passages, and cases where the agent should report insufficient evidence. Measure relevant evidence coverage, stale/revoked evidence leakage, unsupported conclusions, input/output tokens, latency, and total trial cost. Hard freshness and scope requirements must pass before comparing cost. Count failures and retries in the cost per successful task.

Compare the current context builder with a bounded selection strategy first. Keep model and task inputs fixed so changes can be attributed to context selection. Freeze a held-out set before trying variants; keep its scoring out of the worker's editable scope. Token counts need a named tokenizer or provider usage record. Byte or character savings alone cannot be reported as token or dollar savings.

1. Connect a live runtime and prove read, isolated execution, cancellation, and result persistence.
2. Store a versioned mission and one reference with a repository-specific hypothesis. Do not force improvement work into a fabricated bug report.
3. Establish a protected baseline dataset and metric. Test one candidate change in an isolated checkout.
4. Show the reference, affected module, exact diff, baseline/candidate results, and cost in the existing application.
5. Record acceptance or rejection. Trigger a second cycle after a relevant change and prove it does not duplicate the first proposal.

Test restart recovery, source drift, budget exhaustion, developer edits during execution, stale memory, and a rejected candidate that stays rejected until its applicability changes. The demo succeeds when the loop produces an inspectable result. Live voice and automatic merging should follow that proof.

## Session workspace request

The user selected conversation beside the agent's work and supplied an Agent Session History screenshot with search, project grouping, expandable first/latest turn previews, and continuation actions. Retain PaceUI and adapt this interaction model. [RoboRev](research/roborev-workflow-benchmark.md) is an additional benchmark for automatic review and coordinated work.

A session is an interaction with the continuing mission. It presents the same task/run state as the coordinator. Conversation, references, context selection, proposed changes, and evaluation artifacts remain linked by IDs and versions. Closing a session does not stop its mission. The user must be able to resume, inspect partial results, redirect priorities, and explicitly pause work.

For the selected first mission, show the current context beside the proposed context, explain why each evidence item was included or excluded, and expose baseline/candidate quality and token usage. Preserve a path back to the full source evidence. A small summary should say whether the candidate is better, worse, inconclusive, or blocked and name the supporting checks. Chat and a future voice control are ways to steer this work, not prerequisites for each scheduled cycle.

Desktop displays history, conversation, and recorded case work together; narrow screens switch between the panels. The first implementation persists local user notes and session ancestry. It does not send those notes to Hermes or start a mission. Pending writes can be retried after reload with their original request IDs. Live conversation and the continuous mission evaluator remain later work.

## Existing foundation and gaps

Relay already has a PostgreSQL evidence history, reviewed memory, revision checks, a single investigation slot, an automatic report queue, and repair/verification contracts. These are useful foundations, not a completed general-purpose scheduler. The current queue is tied to cases and its time limit is cooperative; the API reports no hard token or dollar limit.

New work includes mission records, reference capture, repository watching, an experiment evaluator, enforced aggregate budgets, a proven runtime, authenticated voice controls, and a user-facing improvement workflow. Preserve current case compatibility while adding mission-linked experiments. Keep Latch's verified Mac session distinct from Relay's still-unconfigured line and runtime.
