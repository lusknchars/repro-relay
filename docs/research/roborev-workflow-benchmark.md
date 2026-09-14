# RoboRev workflow reference

Reviewed September 14, 2026. The user selected RoboRev as a reference for accessible automatic work. No source, visual assets, hooks, or dependencies were copied or installed.

## Observed behavior

[RoboRev's README](https://github.com/kenn-io/roborev) describes post-commit background reviews, persistent findings, coding-agent hooks, and a fix/review loop. Its refinement command uses an isolated worktree with an iteration limit. It offers a review queue, filtering, inspection, and cost/outcome analytics. These are documented capabilities, not behavior tested in this session.

Its [domain model](https://github.com/kenn-io/roborev/blob/main/CONTEXT.md) distinguishes the result users see from individual execution jobs. Multiple reviewers can form a panel whose synthesis produces one logical review. This is relevant to the user's request for several workers without requiring users to coordinate them manually.

## Adaptation proposed for Relay

| Useful pattern | Relay behavior to build |
| --- | --- |
| Automatic work after a relevant change | Wake a versioned mission after a relevant commit or reference update, with deduplication and a spending allowance. |
| One inspectable result above individual jobs | Present an improvement proposal with sources, patch, evaluation, cost, and next decision. Offer worker details as an expansion. |
| Findings returned to ongoing work | Reuse accepted findings and rejection reasons in subsequent experiments, subject to current scope and revision. |
| Bounded fix/review loop | Try a change in isolation, run protected checks, and stop on success, inconclusive results, or an exhausted allowance. |
| Persistent queue | Keep interrupted and pending work visible across sessions; resume only after checking the current repository state. |

Connect the repository once and derive work from its signals and established project goals. Do not require users to write an outcome or configure a roster of agents before each task. Present proposals with approve/decline decisions. A later coordinator may request specialist research, implementation, or evaluation when the task justifies its cost. Preserve one writer per checkout and one merge queue. Multiple reviewers do not by themselves establish independent verification; evaluator data and permissions still matter.

For the selected context-quality mission, the result should show which evidence changed, whether quality gates passed, and the measured token/cost difference. A source link or a favorable model opinion is insufficient.

## Current delivery

The manual session form was replaced with automatic instruction audits, collected evidence, proposal decisions, and a repository monitor inside PaceUI. A separate local harness watches the repository and evaluates lossless context-pack candidates before requesting a decision. Notes from the earlier interface remain archived. This is a working read-only discovery/review loop, not RoboRev's coding loop or the proposed multi-worker coding coordinator. No RoboRev source or hook is active. Protected model evaluation and isolated source editing remain separate execution milestones.
