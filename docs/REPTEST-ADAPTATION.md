# Reptest frontend adaptation

The user supplied `reptest.zip` on September 14, 2026 as the new frontend reference. The archive identifies itself as a PaceUI/shadcn recomposition of Relay's designer brief. Its SHA-256 is `e82b16132b20d333228267a2b97e0faa272612780ca40b94da73494a7df5452d`.

The adaptation keeps the installed PaceUI/Radix components, React version, service APIs and desktop bridge. It does not install the archive's package tree or import its fictional `lib/data.ts` records. The supplied design informs the shell, color tokens, typography, compact work navigation, quiet borders, settings controls and appearance panel.

## Screen mapping

| Prototype | Working Relay adaptation |
| --- | --- |
| Work | Work navigation groups Overview, Autonomous work, Case inbox, Agent controls and Handoffs. Reports appear before aggregate activity. Existing investigation findings, reviews, evidence and context retain their APIs. |
| Team | Existing account creation, sign-in, profile, invitations, member access and security. Team chat and DMs remain unavailable and are identified as such. |
| Knowledge | Reviewed project observations and their source history. Private Mem0 notes remain in the agent tools; no fictional memory list is imported. |
| Usage | A dedicated case and attempt selector, existing Hermes token/cost charts, coverage, reporting history and audit export. Local validation is excluded from Hermes spending. Errors retain the last values with a stale-data message. |
| Settings | The new Tools library and existing Pi/Codex/WebMCP/Plow setup. Credentials remain outside browser configuration. |
| Setup | Existing guided tour with real page navigation. Returning users get a compact replay bar. No simulated completion of authentication or provider credit checks. |
| Appearance | Device/browser preferences for accent, radius, sidebar variant/collapse, width, density, text size, ambient effects and reduced motion. Existing light/dark account and topbar controls stay synchronized. |

Mobile adds five bottom destinations. The sidebar drawer retains detailed work navigation and keyboard controls. Tauri renders the same interface and retains native repository tools and account management in the browser.

## Deliberate implementation boundaries

Prototype balances, active agents, cloud endpoints, run budgets, context packets, test results and chat messages are examples, not backend facts. They are not shipped as live records. Relay does not yet offer the prototype's unified team messaging, arbitrary tool marketplace, per-phase spending attribution, provider OAuth, or enforced runtime dollar budgets.

The account invitation allowlist now accepts the actual Team and Usage routes. Existing case identifiers and workspace checks still apply. The appearance store contains display preferences only and validates stored values before applying them.
