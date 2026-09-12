# Repro Relay

Read `docs/STATUS.md` before choosing the next implementation task. Product decisions and event requirements are in `docs/research/`; current behavior is defined by code and tests.

Use the repository skills for their matching tasks:
- `.agents/skills/repro-investigation/SKILL.md` for observation capture and repair handoffs.
- `.agents/skills/repro-memory/SKILL.md` for publishing, retrieving, or revoking case memory.
- `.agents/skills/repro-interface/SKILL.md` for the interface and Frontend Lab references.
- `.agents/skills/repro-release/SKILL.md` for validation, packaging, and event submission.

One local team owns an installation. Keep browser execution, external message delivery, and hosted deployment visibly disconnected until implemented and exercised. An observation entered by a person is attributed to that person; it is not independent automated verification.

Run `make check` for changes spanning the workflow or interface. Keep runtime data and credentials outside version control. Read `docs/FRONTEND.md` before importing visual assets or components.
