# Execution ledger for isolated repairs

Reviewed September 14, 2026. Primary source: [Turning Interaction History into Execution State: A Runtime Layer for Long-Horizon Coding Agents, arXiv 2608.00808v1](https://arxiv.org/html/2608.00808v1).

## What the paper establishes

The supplied diagram matches Figure 1. Affiliations are Concordia University and Queen's University in Canada, and Tencent in China. One deterministic ledger tracks observations, modifications, and commands. Inform supplies current state before inference; Govern mediates actions before execution. The base agent remains unchanged, with no additional model calls. [Figure 1 and method](https://arxiv.org/html/2608.00808v1)

Reuse is restricted to valid inspection/search results still visible in context. Repeated tests execute with a nudge. Unsupported commands default to execution. Freshness counters track agent modifications. [Method](https://arxiv.org/html/2608.00808v1)

Across 500 SWE-bench Verified tasks, reported Pass@1 improves 56.2→64.2% for GPT-5 mini and 75.8→81.0% for MiniMax M2.5; costs fall 28.9% and 31.8%. Codex with MiniMax improves 74.8→78.2%, costing 24.4% less. Results use one run per instance, Python projects, and fixed rules; provider caching affects cost. These findings are not reproduced in Relay. [Tables 1–4 and limitations](https://arxiv.org/html/2608.00808v1)

No implementation repository is linked in the inspected paper or abstract. The listed [arXiv distribution license](https://arxiv.org/licenses/nonexclusive-distrib/1.0/license.html) does not establish an implementation's source license.

## Relay design recommendations, independent of reported results

- Keep a ledger per repair worktree and run, bound to the approved revision. Persist action IDs, file hashes, observations actually returned, outcomes, and decisions.
- Recheck filesystem state before reuse. Agent-only counters cannot establish freshness when editors, other agents, or commands outside the adapter can write files. Treat uncertain freshness as unknown and execute the read.
- Start with explicit file reads. Require complete output, unchanged content, matching coverage, and confirmation that the earlier result remains in the active model context. Never reuse failed or truncated reads.
- Run tests on every requested attempt. A duplicate-test hint must never become a passing test receipt. Keep edit, test, approval, and merge authorization separate from optimization decisions.
- Route actual Hermes actions through the adapter. A diagram or post-run event import alone cannot mediate execution. Report whether each run used the adapter.
- Chart measured tokens, cost, reused reads, and reruns. Compare equivalent tasks with the adapter enabled and disabled before claiming savings or better repairs.
