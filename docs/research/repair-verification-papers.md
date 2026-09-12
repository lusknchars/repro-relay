# Repair and verification techniques for Repro Relay

Research date: 2026-09-11. Scope: techniques for producing useful bug evidence and checking repairs. This note proposes experiments; it does not resume application implementation or claim integrations exist. The proposed Rust backend, React/TypeScript interface, and separate Hermes execution runtime remain architectural context.

The strongest opportunity is a report that contains an executable demonstration of the failure and the limits of its verification. Research supports investing in the quality of that demonstration before increasing agent count or generated test volume. The papers below were read through primary full text, with evaluation sections distinguished from our proposed adaptations.

## 1. Reduce the actions necessary to reproduce a bug

**Paper:** Andreas Zeller and Ralf Hildebrandt, *Simplifying and Isolating Failure-Inducing Input*, IEEE TSE, February 2002. [Author-hosted paper](https://www.st.cs.uni-saarland.de/papers/tse2002/tse2002.pdf).

**Evidence and technique:** Delta debugging repeatedly tests subsets and complements of a failing input. Its `ddmin` procedure produces a 1-minimal result: removing any individual remaining element cannot preserve the target failure. That does not guarantee the globally smallest input. The paper distinguishes the intended failure from passing and unresolved outcomes. A Mozilla case study reduced 95 user actions to three. These are historical case studies, not an expected reduction rate for our product.

**Our adaptation:** Offer a “simplify reproduction” operation after replay works. Preserve setup separately; remove optional actions under a bounded replay budget. Invalid navigation or missing authentication should be unresolved, not evidence that the bug disappeared. Show the original and reduced sequences side by side, including the execution evidence supporting each retained sequence.

## 2. Validate the reproduction before trusting it to judge a patch

**Paper:** Chunqiu Steven Xia, Yinlin Deng, Soren Dunn, and Lingming Zhang, *Agentless: Demystifying LLM-based Software Engineering Agents*, arXiv v2, October 29, 2024. [Full text, sections 3.3 and 5.1.3](https://arxiv.org/html/2407.01489v2).

**Evidence and technique:** Agentless generates reproduction tests and filters them against the original repository, then uses reproduction and regression outcomes during patch selection. Its evaluation produced 213 baseline-reproducing tests for 300 SWE-bench Lite problems, but only 94 indicated resolution after the known correct patches were applied. A test that triggers something on the buggy version can still encode an incorrect expectation.

**Our adaptation:** Freeze the assertion and reproduction artifact before repair. Save its expected behavior and provenance independently of the patch. Run the same artifact before and after, and label unexpected failures separately. Baseline failure plus candidate success is a useful witness, not proof of complete correctness. A generated assertion without a defensible requirement remains provisional.

## 3. Keep evaluation independent of patch construction

**Paper:** Edward K. Smith, Earl T. Barr, Claire Le Goues, and Yuriy Brun, *Is the Cure Worse Than the Disease? Overfitting in Automated Program Repair*, ESEC/FSE 2015. [Author-hosted paper](https://people.cs.umass.edu/~brun/pubs/pubs/Smith15fse.pdf).

**Evidence and technique:** The study evaluates repair with tests independent from those used to construct patches. Across 998 buggy student programs, GenProg and TrpAutoRepair could satisfy construction tests while harming undertested behavior. Its small C programs and pre-LLM tools limit direct transfer to modern repository agents; the evaluation distinction remains applicable.

**Our adaptation:** Prepare a small holdout of requirement-based edge cases before revealing candidate patches. Evaluate in a clean checkout where the repair job cannot modify those checks. A second agent reading the first agent’s patch is not automatically an independent oracle. Record who authored the checks, what information they received, and when they were frozen.

## 4. Measure useful testing rather than counting new files

**Paper:** Zhi Chen and colleagues, *Rethinking the Value of Agent-Generated Tests for LLM-Based Software Engineering Agents*, arXiv v1, February 8, 2026. [Full text, sections 5–6](https://arxiv.org/html/2602.07900v1).

**Evidence and limitation:** This preprint examines six model families under mini-SWE-agent on SWE-bench Verified and applies test-writing prompt interventions to four. Encouraging GPT-5.2 to write tests left task resolution at 359/500 while increasing token consumption. Other interventions had different outcomes; discouraging tests sometimes reduced success. The authors identify scaffold dependence, stochastic runs, and imperfect test-artifact detection. This does not show that verification or tests generally lack value.

**Our adaptation:** Spend a fixed verification budget on checks tied to explicit failure hypotheses. Stop producing near-duplicate checks when they add no new behavioral distinction. Treat debug prints as observations rather than automatically counting them as assertions.

## Proposed first experiment

Use one controlled application with ten preselected seeded defects and five no-defect reports. Include incorrect empty-state behavior, duplicate submission, filtering inconsistency, stale status, and one deliberately ambiguous report. Publish the fixture list before the runs. Keep the model, initial repository revisions, executor capabilities, token ceilings, and total execution budget identical between conditions.

Compare two conditions: the ordinary issue-to-patch workflow, and the same workflow with a frozen reproduction artifact plus reserved holdout checks. Add reproduction reduction only as a second experiment so we can attribute any difference. Reset workspace and application data between attempts. Use paired cases and repeat runs when affordable; report raw per-case outcomes because this is a small demonstration, not a population estimate.

Measure the fraction of correct repairs accepted, incorrect repairs accepted, correct repairs rejected, and cases correctly left unresolved. Separately record original versus reduced action count, replay reliability, execution time, tool calls, and model tokens. Include a knowingly bad patch that hides the error, a patch that changes a neighboring behavior, and a harmless refactor. These controls test whether our verification distinguishes behavior rather than matching code shape.

For each accepted result, retain the base and candidate commit identifiers, environment description, immutable test artifact digest, commands, exit outcomes, and evidence references. The UI should expose verification scope: “reproduction and four held-out cases passed” communicates more than an unqualified “fixed.” Failed checks need their outputs and timestamps available to the next engineer.

A failure found by a holdout can guide the next repair attempt, but that test then becomes development feedback. It no longer remains unseen evidence for that later attempt. Mark that transition in the record, and reserve fresh checks for any final evaluation claim. Otherwise repeated retries gradually convert the entire evaluation into patch-training material.

## Mapping to the proposed application

These techniques need executable records and bounded jobs, not additional microservices. The Rust backend would own immutable verification specifications, job state, cancellation, and typed outcomes. A runner would execute the target application’s existing test tools in an isolated environment. React would present before/after evidence, missing information, and the scope of each verdict. The target code can use a different language from the coordinator.

The initial implementation boundary should be narrow: one supported repository, one reproducible environment, and one artifact format. Browser action reduction should wait until reset and replay are dependable. Flaky timing, external APIs, and irreversible actions make minimization harder and can produce misleading results. Leave such cases unresolved and preserve their observations rather than turning execution uncertainty into a repair verdict.
