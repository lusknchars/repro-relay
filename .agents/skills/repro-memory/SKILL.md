---
name: repro-memory
description: Implement reviewed case memory, scoped retrieval, and revocation for Repro Relay.
---

# Repro Memory

Read `../../../docs/research/repro-relay-memory-architecture.md` for memory and repair roles.

The case database owns truth. Retrieval returns leads with case ID, revision, reviewer, and evidence. Human-reviewed reproduction observations are not verified root causes or verified fixes.

Recheck the current source revision and status before returning memory. New observations invalidate older published guidance until reviewed again. Revocation must remove an entry from retrieval immediately, even when a future external index is behind.

One installation currently has one team. Match projects before ranking results. Future shared hosting must derive tenant identity from authentication, not caller-supplied labels. Keep semantic providers optional; the local exact lookup remains usable without credentials.

Evaluate a memory change against same-symptom/different-cause cases, stale revisions, revoked entries, and source-case exclusion. Use chronological splits for future LLM evaluations so a case cannot retrieve its own eventual answer.
