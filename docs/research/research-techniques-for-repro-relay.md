# Research techniques for Repro Relay

Research date: September 11, 2026. This note proposes experiments for the agreed Rust backend and Tauri/React interface. It does not change application code or claim that the scaffold implements these techniques. No paper experiments or product benchmarks were run during this research.

The strongest direction is to turn an investigation into a small, replayable case with evidence, then reuse only the parts that apply to a later investigation. The product hypothesis is that this reduces repeated investigation work while preserving the quality of repair verification. This is an engineering synthesis of existing research, not a claim to have invented a new learning algorithm.

This is a targeted literature review. Searches covered agent memory, repository localization, browser workflow reuse, reflection, reproduction minimization, and repair validation. Primary papers and author publications supplied the evidence. Methods, selected experiment tables, and limitations were inspected for the central papers. Benchmark results from different papers are not directly comparable. A paper's implementation language does not determine the language of our application.

The companion [repair verification note](./repair-verification-papers.md) examines reproduction and test evidence in more detail. Earlier product assumptions remain in the [build brief](./repro-relay-build-brief.md) and [memory architecture](./repro-relay-memory-architecture.md); this note refines the proposed learning and evaluation behavior.

## 1. Use repository history to narrow the investigation

Boshi Wang and colleagues' *Improving Code Localization with Repository Memory*, initially released in 2025 and published at ICLR 2026, combines searchable historical commits and linked issues with summaries of frequently edited files. The inspected v2 uses BM25 retrieval and excludes future commits and overlapping issue material. With GPT-4o on SWE-bench Verified, file localization Acc@5 rises from 71.6% for LocAgent to 76.5%. This metric requires the five suggested files to cover the reference files; it is not repair success. Results decline for the sparse-history group, and API cost does not uniformly decrease. [Paper, sections 3–4 and tables 1–3](https://arxiv.org/html/2510.01003v2)

Our adaptation: add a history panel to each case. Show the relevant earlier change, affected files, and the source of each suggestion. Keep a separate field for the current hypothesis. Start with lexical search over one repository's permitted history; evaluate semantic retrieval only after this baseline works. Invalidate a cached module summary when its source content changes. A historical fix should suggest where to investigate, never establish the current root cause.

This also solves part of the cold-start problem. A team may have no Repro Relay memories but already have useful commits and issues. When history is insufficient, the agent must continue with ordinary source inspection.

## 2. Reuse browser procedures with checked preconditions

Zora Zhiruo Wang and colleagues' *Agent Workflow Memory*, 2024, extracts reusable subroutines from trajectories, abstracts task-specific values into parameters, and supplies these workflows to later web tasks. Its WebArena table reports 35.5% task success versus the listed BrowserGym baseline's 23.5%. This is browser task completion, not bug reproduction. The paper also identifies incorrect induced workflows as a source of failure. [Paper, sections 2, 3.1, and 3.2](https://arxiv.org/html/2409.07429v1)

Our adaptation: after a reviewed investigation, propose a reusable procedure such as opening a report, setting a date range, exporting, and checking the resulting rows. Store required page state, parameter names, observed checkpoints, and the approved environment. Resolve controls from the current page before acting. A saved procedure is guidance for fresh execution, not permission to replay clicks blindly.

In the UI, a case could offer "Reuse these investigation steps" and explain which prerequisites match. If a page or permission has changed, stop using that procedure and record why. This is a particularly visible hackathon feature because users can inspect what the agent reused.

## 3. Update individual lessons instead of rewriting the whole memory

Qizheng Zhang and colleagues' *Agentic Context Engineering*, initially released in 2025 and listed as ICLR 2026, separates generation, reflection, and curation. Its itemized context entries have identifiers and feedback counters; small updates are merged instead of repeatedly rewriting an entire context. The inspected v3 evaluates AppWorld and domain tasks. Its richer context can increase raw input tokens, so adaptation-cost savings are not a promise of cheaper per-case inference. [Paper, section 3 and appendix A.3](https://arxiv.org/html/2510.04618v3)

Our adaptation: an agent proposes a change to one lesson. Rust validates the proposed record, attaches its evidence, and saves a new revision. A reviewer sees exactly what changed and can revoke it. Keep immutable execution evidence separate from editable interpretations. A "helpful" vote is feedback, not a calibrated probability of correctness.

Useful lesson fields are applicability conditions, observed failure, action tried, measured result, next suggested check, and invalidation conditions. A concrete failed attempt can be retained immediately as an attributed observation. Promoting a general rule requires stronger review and evidence.

## 4. Reflect on external results, including failed attempts

Noah Shinn and colleagues' *Reflexion*, NeurIPS 2023, conditions subsequent attempts on verbal feedback held in episodic memory without changing model weights. The paper's ablation on 50 translated HumanEval Rust problems reports 60% for its baseline, 52% with test generation omitted, and 68% for the full method. This is a small function-generation experiment; it does not establish a gain for repository repair. Generated tests can also accept incorrect programs. [Paper, section 4.3 and table 3](https://arxiv.org/html/2303.11366v4)

Our adaptation: after a failed run, record the attempted hypothesis, the test result or observed symptom, and a proposed next check. The next agent sees that exact failure before choosing another action. Avoid promoting a guess about why a test failed into an established cause. Reflection has a bounded budget and must reference a recorded result.

Related counterevidence comes from Huang and colleagues' ICLR 2024 study of intrinsic self-correction in reasoning. Its findings concern the models and reasoning settings evaluated, not a universal impossibility theorem. We should judge our workflow using external execution results rather than agreement between agent messages. [Primary publication](https://openreview.net/forum?id=IkmD3fKBPQ)

## 5. Admit a memory only when it applies

Jiawen Zhang and colleagues' *Beyond Similarity: Trustworthy Memory Search for Personal AI Agents*, June 2026, proposes MemGate, a learned query-conditioned gate over retrieved memory representations. Its experiments cover personal-agent memory settings, not software repair. The relevant finding is that semantic similarity alone can admit context that should not influence the current task. This is a recent preprint; independent replication was not established in this review. [Paper, sections III–V](https://arxiv.org/html/2606.06054v1)

Our adaptation is deliberately different from implementing its trained neural gate. The Rust service checks workspace, project, source revision, active status, applicable environment, and evidence type before a retrieved record can enter the case instructions. These are deterministic application rules. They do not reproduce MemGate's algorithm or guarantee semantic correctness.

Then the agent checks whether the remaining record matches the present behavior. Conflicting records remain visible with their sources; neither wins merely because it is newer or more similar. Start by retrieving a small bounded set and allow the result to be empty.

## 6. Shrink the reproduction and freeze the verification check

The verification review recommends two complementary techniques: delta debugging to remove unnecessary parts of a failing example, and repair validation using a fixed reproduction check plus regression checks. The research basis and qualifications are recorded in the [companion note](./repair-verification-papers.md).

Our adaptation: once the agent can reproduce the reported behavior, try removing groups of actions or input fields in a resettable test environment. Keep a reduction only if the same failure still occurs. Record unresolved trials separately. Stop at a replay budget or when the remaining example cannot be reduced by the tested removals. Do not claim a globally minimal sequence.

Freeze the resulting check before the repair agent starts. Run that same check against the pinned baseline and the candidate patch. Add independent checks derived from the intended behavior, including nearby edge cases. A process exit code alone is insufficient; confirm that the original failure is the relevant failure and that the intended behavior holds after the change.

## Proposed case and instruction structure

The following structure is our design proposal. It is not copied from a paper and is not yet implemented.

| Record | Required content | Consumer |
|---|---|---|
| Case | Original complaint, expected behavior and its source, project, environment | Team and investigating agent |
| Execution attempt | Pinned build, permitted tools, actions, outcomes, artifact references, timestamps | Investigator and verifier |
| Reproduction | Reset/setup procedure, action sequence or test, exact failure condition | Repair agent and verifier |
| History suggestion | Prior commit or case, affected code, reason retrieved, applicability | Investigator |
| Lesson revision | Scoped claim, supporting and contradicting evidence, review status | Future investigations |
| Repair instruction | Case revision, allowed scope, baseline, reproduction, required checks, unknowns | Repair agent |
| Verification result | Baseline and candidate results for identical checks, additional checks, unresolved failures | Reviewer and delivery module |

The Rust backend owns record revisions, transition rules, retrieval eligibility, and delivery state. Hermes proposes actions and interpretations. A separate execution environment returns tool results. React displays observations, hypotheses, and verification results with distinct labels.

One application service can contain these modules. Nothing in the selected techniques requires an extra microservice per paper, a graph database, or training our own model. Mem0 remains an optional retrieval provider behind the same eligibility checks.

A repair instruction can be generated deterministically from approved records. Each assertion should link back to a source record. If a required source is revoked or the base changes, produce a new instruction revision rather than silently changing an active job's context. For the first release, mark affected jobs as requiring revalidation.

The same case revision supplies all channel updates. A short chat update links to the detailed engineering packet. This multichannel behavior is a product design choice; the selected papers do not establish its effectiveness.

## What deserves the hackathon build

Implement the reproduction and verification foundation first, then test workflow reuse on the same controlled application. Add repository history where a target repository has enough usable history. Introduce lesson curation once real executions provide material to curate.

For the live demonstration, prepare a report with extra steps, a related later bug, and a misleading old lesson. Show the actual reduced reproduction, the source of reused knowledge, and the outdated lesson being excluded. Numbers in the demonstration must come from recorded runs.

Keep these extensions out of the initial build:

- Full Monte Carlo Tree Search. *SWE-Search*, ICLR 2025, explores tree search and refinement for software tasks. It is a relevant later option, but this review only screened its publication summary. Our first experiment should establish whether one bounded investigation benefits from memory before adding a search tree. [Paper](https://arxiv.org/abs/2410.20285)
- Automatically evolving a general memory graph. *A-MEM*, 2025, proposes linked structured notes and memory evolution. Its abstract was screened. Explicit source links and versioned lessons meet our immediate need; this review does not justify adopting its full mechanism. [Paper](https://arxiv.org/abs/2502.12110)
- Unrestricted self-modification of agent instructions. Proposed lessons should be reviewable before becoming shared advice.
- Claims that another agent's approval proves a repair correct. The approval must identify the external checks and their results.

## A small experiment that can disprove the idea

This is a proposed evaluation, not a completed result or an authorized expenditure on model runs.

Prepare twelve cases in a resettable application and repository: four earlier cases to populate history, then eight held-out cases. The held-out set should include related bugs, a different cause with a similar symptom, a changed interface, stale history, and a report that is expected behavior rather than a defect. Keep the expected outcomes and verifier-only tests outside the repair agent's accessible files.

Compare three conditions on the eight held-out cases, with two repetitions each, for 48 evaluation runs:

1. The same agent with current source and tools but no historical memory.
2. The same agent with retrieval from the permitted earlier case history, supplied as ordinary notes.
3. The same agent with curated procedures and lessons from that history, using applicability checks.

Use the same model, tool access, per-run token cap, action cap, time limit, and memory-context allowance. Freeze the historical corpus before evaluation. Keep the target's solution, future commits, and held-out outcomes out of every condition. Reset the application, repository, caches, and agent session between runs, and randomize condition order to reduce warm-cache effects. Record provider caching where it cannot be controlled.

Conditions 2 and 3 should have the same authorized source material. Record history preparation and curation costs separately, then include them in total cost reporting. Condition 1's disadvantage in prior knowledge is intentional; condition 2 tests whether condition 3 adds value beyond merely giving the agent that knowledge. The combined experiment cannot identify which individual mechanism caused a change. Follow-up ablations should remove workflow reuse or eligibility filtering one at a time.

Measure:

- Correctly reproduced defects and correctly identified non-defects, against independently prepared expected outcomes.
- Incorrect declarations of a verified repair. Report the number and denominator, not only a percentage.
- Time and tokens to a valid reproduction or handoff. Include failures and timeouts, and also report successful-run timings separately.
- Reproduction actions retained versus the original sequence, plus reset and replay cost.
- Whether suggested files cover the independently identified relevant code, without confusing localization with repair success.
- Whether a reviewer can use the packet without requesting missing basics. Blind the reviewer to the experimental condition where feasible.
- Eligibility mistakes on stale or cross-project records, and cases where useful memory was wrongly rejected.

A practical decision rule is to require no observed increase in false verification, then look for less work or better completion on paired cases. Zero observed errors in this small sample does not establish a zero error rate. Publish the per-case outcomes, including failures. Do not tune prompts on held-out cases and still call them held out.

The case-reduction experiment is separable from memory evaluation. Replay identical original and reduced examples across the baseline, candidate patch, and deliberately incorrect patches. A smaller sequence is useful only if it still captures the reported failure and distinguishes the repairs we care about.

The candidate product claim is: "Repro Relay turns investigated bugs into reusable, evidence-linked cases and shows when the earlier lesson applies." A claim that it is faster, cheaper, or more accurate must wait for these measurements.
