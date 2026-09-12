# Recent agent execution research: August–September 2026

Research cutoff: September 11, 2026. Included papers must have their **first arXiv submission between August 1 and September 11, 2026**, inclusive. Dates below were checked against the primary submission histories; these are new preprints, not claims of peer-reviewed publication. Application implementation remains paused.

| Paper | Verified first submission | Evidence type |
| --- | --- | --- |
| [Ecdysis: Efficient and Effective Training of Runtime Harnesses for LLM Agents](https://arxiv.org/abs/2609.11677) | September 10, 2026, 15:09 UTC | Controlled harness comparison on selected agent benchmark tasks |
| [Beyond Memory: A Transactional Continuity Kernel for Long-Lived AI Agents](https://arxiv.org/abs/2608.11632) | August 12, 2026, 04:28 UTC | Bounded executable protocol model |
| [Agent Safety Should Be a Runtime Contract](https://arxiv.org/abs/2608.11274) | August 11, 2026, 08:01 UTC | Position paper supported by public-document audits |

## Ecdysis: learn from repeated execution failures

Ruiqing Yue and colleagues aggregate failures across tasks before modifying the harness. Table 1 reports 59.33% accuracy versus 46.67% serial self-evolution and 51.67% human-fixed harness. Evolution uses Qwen3-8B and DeepSeek-V4-Pro; transfer evaluation covers five models, with 20 training/20 test tasks per airline/retail subset and three trials. Recurrence is an attribution heuristic. This small sample is not a software-repair benchmark or proof of gains for us. [Methods and results](https://arxiv.org/html/2609.11677v1)

**Repro Relay proposal:** Aggregate failures such as repeatedly checking stale builds or invoking a tool before its prerequisites exist. Propose a narrowly scoped workflow change with its triggering condition, supporting cases, and counterexamples. Review and evaluate that proposal before activation; do not let a single unsuccessful investigation rewrite the active runner. This is our limited adaptation, not a reproduction of the paper's full optimizer.

## Continuity Kernel: stop stale agents from becoming authoritative

Jun He and Deying Yu separate candidate preparation from atomic activation, rechecking predecessor, authority, and freshness. Their depth-seven finite model explores 2,808,230 states without encoded invariant violations. It uses one active branch and abstract storage; it establishes neither production crash safety nor LLM performance gains. Remote actions remain outside atomicity. Appendix D names a Python artifact, but no downloadable author repository was verified in this search. [Protocol and model scope](https://arxiv.org/html/2608.11632v1)

**Repro Relay proposal:** A resumed investigation carries the case revision, run identity, and execution-owner version it originally received. If another worker has advanced the case or ownership, the old result becomes an inspectable proposal rather than replacing current state. Resume preparation can happen outside a short database transaction. Linked channel updates should have their own recorded delivery identities and reconciliation; an internal commit cannot prove a remote message was delivered once.

## Runtime Contract: require evidence before marking work complete

Albus W. Ng and colleagues propose task-specific evidence requirements checked by the harness, alongside action restrictions. Their contribution includes a trajectory schema and evidence-chain formulation. Support comes from audits of 52 incidents, 31 uncontested false-completion cases plus one disputed example, 12 systems, and publication titles—not an intervention demonstrating a repair-success gain. The audits favor English-language public coverage. Applicability depends on having meaningful correctness criteria; bad or flaky verifiers remain bad gates. [Contract definition and limitations](https://arxiv.org/html/2608.11274v1)

**Repro Relay proposal:** Separate “agent says fixed,” “required checks completed,” and “human accepted.” A repair run can submit a candidate only with evidence tied to the exact base revision, patch, and test artifact. Missing evidence blocks that status transition. A stored screenshot or log alone does not establish the asserted behavior; the checker must validate the specific claim. Evidence collection should remain visible in the interface.

## A combined experiment we could actually build

Start with one controlled application and twelve seeded investigation tasks. Keep model, budget, repository snapshots, and runner capabilities constant. Divide tasks before development into six workflow-improvement cases and six held-out cases. Use two repeated failure mechanisms across otherwise different reports, plus a case that superficially resembles them but needs a different action.

Compare the fixed initial workflow against one reviewed revision developed from the first six cases. Keep holdout results out of revision development. Measure completion with valid evidence, incorrect completion, regression on previously successful cases, tool calls, and total tokens. With this sample size, publish raw per-case outcomes and present findings as a demonstration, not a general performance estimate.

Separately inject runtime faults: terminate a worker after evidence capture, resume the same run twice, advance the case while a worker is paused, and change execution ownership before the old worker returns. Check that evidence survives, stale results cannot overwrite current state, and queued notification intents do not multiply. Simulate an uncertain remote delivery acknowledgment and verify the UI shows uncertainty rather than declaring success or blindly retrying. These are proposed fault tests for our implementation, not tests already performed by any cited paper.

The Rust service can own the state transitions and evidence checks; the existing runner boundary can execute tools; React can show pending proposals and their evidence. None of these research ideas requires another microservice. The distinctive product behavior would be inspectable improvement: the team sees which recurring failure motivated a workflow change, how it was tested, and which active revision each investigation used.

## Selection limits

The [author's Ecdysis repository](https://github.com/cuiyu-ai/Ecdysis) is public and contains implementation, scripts, and tests. Its README describes an ongoing research release that excludes raw benchmarks, generated traces, and private run artifacts. Repository availability is not reproduction of the paper's results; no code was run.

Searches covered primary arXiv records for runtime contracts, execution recovery, checkpointing, and repair verification. Full methods/evaluation sections were read for the three selected papers. The search is targeted rather than exhaustive. No independent reproduction of the reported results or supplied artifacts was performed. Ecdysis offers the strongest measured technique here; the other two offer useful protocol designs with materially different evidence strength.

Older relevant work was excluded from this dated shortlist. For example, [AgenticRepair](https://arxiv.org/abs/2607.29422) first appeared July 31, 2026, just outside the requested window. Earlier Agentless and delta-debugging recommendations remain background research, not qualifying new papers.
