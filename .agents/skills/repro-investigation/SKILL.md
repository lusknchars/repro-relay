---
name: repro-investigation
description: Capture Repro Relay observations and build engineering repair packets with traceable evidence.
---

# Repro Investigation

Read `../../../docs/research/repro-relay-build-brief.md` when changing the report-to-handoff flow.

Keep reported, expected, and observed behavior separate. A reproduced result requires a named build, an observation, and a retrievable evidence reference. A failed login produces a blocked attempt. An unsuccessful reproduction preserves what was tried.

Record new observations as a new case revision. A packet names its revision and includes evidence references, stated expectations, attempts, and unresolved questions. Repository paths, commit IDs, and commands remain unknown until supplied or observed; do not generate plausible values.

When a repair worker is added, preserve the original acceptance check outside its editable scope and capture the base-versus-patch result. Delivering a packet and verifying a patch are different states.

Complete a change when the meaningful failure paths have been exercised and the UI and exported packet agree with the persisted observation.
