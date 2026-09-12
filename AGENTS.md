# Repro Relay

Read `docs/STATUS.md` before choosing the next implementation task. Product decisions and event requirements are in `docs/research/`; current behavior is defined by code and tests.

Use the repository skills for their matching tasks:
- `.agents/skills/repro-investigation/SKILL.md` for observation capture and repair handoffs.
- `.agents/skills/repro-memory/SKILL.md` for publishing, retrieving, or revoking case memory.
- `.agents/skills/repro-interface/SKILL.md` for the interface and Frontend Lab references.
- `.agents/skills/repro-release/SKILL.md` for validation, packaging, and event submission.

Local mode serves one team; hosted guest mode derives each workspace from its session cookie. Preserve workspace scoping on every case, memory, handoff, and feedback operation. Read `docs/deployment/public-beta.md` before deploying or changing hosted limits. Keep browser execution and external message delivery visibly disconnected until implemented and exercised. Attribute human observations to their author; they are not independent automated verification.

Run `make check` for changes spanning the workflow or interface. Keep runtime data and credentials outside version control. Read `docs/FRONTEND.md` before importing visual assets or components.
