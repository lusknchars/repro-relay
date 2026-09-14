# Kiro usability benchmark for Relay

Reviewed September 14, 2026. The user selected Kiro as a reference for an approachable investigation workspace. PaceUI remains Relay's dashboard template. No Kiro source, assets, provider selector, or multi-agent management interface was imported.

## Relevant reference

Kiro documents shared project configuration across desktop, terminal, web, and mobile. Its documentation presents task-oriented entry points, including bug fixes, permissions, and ongoing sessions. The desktop combines chat, specifications, and editor context. These are useful references for keeping a user oriented while work moves between views. [Kiro documentation](https://kiro.dev/docs/), [IDE documentation](https://kiro.dev/docs/ide/)

## Relay's product decision

The organizing unit is a reported problem and its evidence. Users should be able to answer: What needs attention? What was inspected? What was found? What has actually been tested? What needs my decision?

The intended journey is report → triage → investigation → isolated candidate → original acceptance and regression checks → review. Bug investigation, performance comparisons, and testing share this history. They are not separate agent-provider configuration exercises. A performance conclusion requires an actual baseline, comparison, and named environment. A passing result requires retrievable test evidence.

## Applied in this change

- The overview opens status-filtered triage queues from actual saved cases. These counts are report statuses, not inferred severity or repair verification.
- All seven navigation destinations explain their purpose. Existing URLs and page names remain stable.
- Case rows explain the next inspection step and open their exact investigation directly. Phone layouts keep the report, status, and action together without horizontal scrolling.
- Investigation sections provide keyboard-operable jumps to findings, test evidence, usage, and run controls. Focus moves to the destination and stays clear of the sticky header.
- Next-step guidance accounts for unavailable connections, pending requests, active runs, stale context, and recorded findings. Navigation does not execute work.
- Findings and evidence precede usage accounting. Raw context remains inspectable in a collapsed disclosure. The existing charts and export stay available.
- Redundant overview navigation cards were removed after the triage entry point was added.

## Still required for the full workflow

Connect the Hermes execution adapter and exercise the approved worktree lifecycle before presenting automatic repair as active. Surface candidate changes and protected base-versus-candidate test receipts in the same case workspace. Add measured performance comparisons when an adapter supplies them. Keep unavailable and unreported states visible.

Do not ask users to write another task prompt to move through these stages. Obtain technical setup once where possible; retain exact revision, original tests, edit scope, and approval boundaries. Keep terminal and phone entry points attached to the same case.

## Usability acceptance

A user should open a status queue, inspect a case, reach its investigation, and find the relevant evidence without selecting a provider or creating a new task. Keyboard and 320-pixel phone layouts must expose the same actions. Navigating or opening a disclosure must never start an investigation, send a message, approve a proposal, or turn unknown testing into a passing result.

Automated browser coverage is not a complete accessibility certification. VoiceOver/NVDA sessions with users, physical devices, and Windows/Edge verification remain separate release checks.
