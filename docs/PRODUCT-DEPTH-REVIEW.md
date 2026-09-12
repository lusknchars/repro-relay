# Product depth review and skill map

September 12, 2026. Assessment and proposed implementation plan, not a record of shipped functionality. Prepared from the current source, existing roadmap, three focused subagent reviews, a small read-only browser check, and the official sources linked below.

The user accepted this direction. The [delivery protocol](DELIVERY-PROTOCOL.md) now turns it into area ownership, resources, dependencies, dashboard requirements and acceptance gates; the [Orca/Warp benchmark](research/orca-warp-dashboard-benchmark.md) supplies documented interaction references.

The user subsequently selected [Vercel as the configuration benchmark](research/vercel-configuration-benchmark.md). Its settings contract is part of the delivery protocol.

The product outcome is a reported problem becoming an evidence-backed investigation, a useful engineering handoff, and a correctly routed owner update. Desktop, web, and phone should let different people act on the same case. More screens do not establish that outcome.

## Scope and decisions

| Status | Decision |
| --- | --- |
| Established | Support/operations supplies a problem; engineers inspect evidence and continue in their existing tools; owners receive decisions and results. |
| Established | One investigator, shared case history, PaceUI as the only dashboard template, shared React web/Tauri interface. |
| Established | The two-day target concerns hackathon build/deployment, not customer onboarding. No fresh deadline was verified in this assessment. |
| Proposed default | A sufficiently specified report automatically starts a bounded investigation under the installation's existing permissions. |
| Unresolved | Passive detection of failures while people work. Do not infer permission for continuous screen, terminal, or application monitoring. |
| Proposed expansion | Inspect mobile-web behavior after one desktop-browser investigation works; treat native-device execution as a separate adapter and validation gate. |
| Not changed here | Application code, runtime configuration, permissions, outbound messages, deployment, and account connections. |

The current Rust/PostgreSQL implementation and `STATUS.md` take precedence over historical Python/SQLite examples in the earlier research documents. Proposed verified-outcome memory in those documents must not be confused with the human-reviewed observations implemented today.

## Skill map

No installed skill named `skill-map` was found. This maps available skills to work; it does not install a new skill or add runtime agents.

| Skill | Responsibility in this plan | Deliverable or constraint |
| --- | --- | --- |
| `ui-ux` | Keyboard, touch, legibility, focus, useful feedback, responsive review | Accessibility backlog and acceptance matrix; use WCAG 2.2 AA as the proposed release target, with 44px primary touch controls as a product preference. |
| [Repro Interface](../.agents/skills/repro-interface/SKILL.md) | Adapt the selected template around actual work | Clear next action, honest blocked states, evidence close to the claim, progressive disclosure. |
| [Repro Investigation](../.agents/skills/repro-investigation/SKILL.md) | Observation and handoff integrity | Distinguish reports, observed behavior, hypotheses, checks, conclusions, and verified patches. |
| [Repro Memory](../.agents/skills/repro-memory/SKILL.md) | Applicable, correctable shared context | Source-linked retrieval, immediate revocation, no silent promotion of an agent's answer. |
| `ai-engineer` | Bounded execution, evaluation, costs | Deterministic workflow controls around model reasoning; measure useful results and missing usage. This plan does not adopt the skill's example model names or add a model provider. |
| [Repro Release](../.agents/skills/repro-release/SKILL.md) | Future integration and deployment proof | Separate fixtures, actual runs, delivery receipts, fresh installation, and adoption. |
| `grill-me` | Challenge unresolved scope choices | Use for consequential decisions; the present deliverable is the requested written assessment, not another implementation milestone. |

## Current value and missing links

| Area | Implemented evidence | Missing user benefit |
| --- | --- | --- |
| Investigation | Durable admission, polling, stop requests, reconciliation, saved final proposals | Live action evidence and a review path that avoids retyping the result |
| Context | Frozen run input, build/revision/assignment checks, scoped reviewed memory | Explain what was reused, why it applies, and which later conclusion corrected it |
| Interface | Shared dashboard, named dialogs, keyboard commands, reduced motion, responsive layouts | A case-centered sequence of progress and decisions; inventory counts currently dominate |
| Channels | Web/Tauri access to stored cases | Trusted phone intake, bound recipients, actionable clarification, delivery reconciliation |
| Operations | One active run, bounded elapsed time/context, reported usage | Enforceable token/tool limits, uncertain-run recovery workflow, actionable connection setup |

Source anchors: [App](../web/src/App.tsx), [RunPanel](../web/src/components/RunPanel.tsx), [domain](../crates/relay-api/src/domain.rs), [runner](../crates/relay-api/src/runs.rs), [HTTP routes and memory](../crates/relay-api/src/lib.rs), [runner contract](HERMES-RUNNER.md). The previous checks passed 18 database tests and six browser tests. Those tests do not establish real Hermes/Latch execution or phone delivery.

## Accessibility and user resources

Accessibility includes perceiving and operating the UI, understanding the next decision, and recovering from a failure. Hiding all technical detail would weaken the developer experience; showing it only when it helps a decision serves both audiences.

| Priority | Finding or gap | Proposed change | Acceptance |
| --- | --- | --- | --- |
| P0 | The main journey asks users to enter observations after saving a report. Final agent output is separate raw text. | Report intake resolves configured context, shows missing information, and leads directly into investigation and review. | A user reviews supported findings and prepares a handoff without copying the output into another form. |
| P0 | Current navigation styling uses active state without an explicit current-page announcement; route changes lack a deliberate focus handoff. | Add current-page semantics and focus the new main heading after user navigation, while leaving background updates alone. | Keyboard and screen-reader users can identify the current view; polling never steals focus. |
| P0 | Mobile drawer source hides its explicit close control. | Provide a visible, named close button as well as Escape/outside dismissal. | Touch and screen-reader users open, navigate, close, and return focus to the trigger. |
| P0 | Continuous decorative effects have OS reduced-motion support but no user-facing pause preference. | Add a persistent motion setting: system, paused, full. Full retains display-driven grid rendering. | Pausing stops decorative animation across clients; hidden views stop rendering; status updates remain available. Assess against [Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html). |
| P0 | Dynamic run progress and failures need an announcement policy. | Announce meaningful state changes in a polite status region; reserve alerts for actionable errors. | Started, needs input, blocked, ready for review, and stop confirmation are announced once; no repeated transcript announcements. See [Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html). |
| P1 | Small controls reduce touch comfort. | Enlarge primary mobile controls without replacing the desktop density system. | Aim for 44×44 CSS px primary targets. WCAG 2.2 AA specifies 24×24 with exceptions, including spacing; 44px is not its blanket minimum. See [Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). |
| P1 | Some source palette combinations have low contrast. | Audit actual rendered text, focus, inputs, badges, and chart marks in both themes. | Text and necessary control/focus indicators meet applicable contrast criteria; a token calculation alone is not a conformance verdict. |
| P1 | Narrow-screen checks do not cover text enlargement, virtual keyboards, or assistive technology. | Exercise reflow, 200% text size, large zoom, long findings, keyboard-open forms, and portrait/landscape. | No lost actions or obscured focused fields; two-dimensional evidence viewers retain an accessible summary. See [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). |
| P1 | Server errors are shared paragraphs rather than field-specific guidance. | Map recoverable errors to fields with descriptions and invalid state; preserve the user's draft on conflicts. | Invalid URL, missing build, stale revision and unavailable service explain the correction or next action without losing input. |
| P2 | The activity chart supplies totals but no equivalent daily-data table. | Add a compact data view and distinguish series beyond color. | Keyboard and screen-reader users can obtain the same daily information without interpreting a plotted line. |

Read-only Chromium check in this assessment: at 390×844, the overview had an H1 and a “Skip to workspace” link, no page-wide horizontal overflow, and named report fields. Escape closed the report dialog and returned focus to New report. Measured controls were 28×28 for the sidebar toggle, 32×32 for case search, and 36px high for theme/New report. These are comfort gaps against the proposed 44px preference, not proven AA target-size failures. No report was submitted. This was not a VoiceOver/TalkBack or physical-device test.

Source checks also found muted `#71717a` on soft `#f5f5f5` at approximately 4.43:1 in feedback paragraphs, and focus `#8b98c8` on white at 2.83:1. Confirm actual composed states while fixing the palette. The normal-text target is 4.5:1; necessary visual control/state indicators generally require 3:1. See [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Existing run status already uses `role=status`; extend announcements to useful new details and results rather than duplicating it. Source locations include `styles.css`, `design.css`, `ui/sidebar.tsx`, `RunPanel.tsx`, `table-7.tsx` and `chart-18.tsx`.

Proposed assistance belongs at the point of use:

| Person | Resource | Useful behavior |
| --- | --- | --- |
| Reporter | Short report example and interpreted summary | Explain expected versus reported behavior; obtain project/build from configuration when known; ask only for missing context. |
| Reviewer | Evidence guide attached to each finding | Show what was observed, what remains a hypothesis, and what accepting the finding publishes. |
| Developer | Expandable technical inspector | Build, environment, attempts, receipt IDs, memory sources, stale-context reason, exported packet. |
| Owner | Concise update and decision link | Reported impact, observed status, responsible person, next action. No unsupported severity or root-cause claim. |
| Maintainer | Connection and recovery guidance | Distinguish configured, reachable, authorized, exercised, and failed. Give the next setup/recovery action and a redacted diagnostic export. |
| First-time visitor | Clearly labeled recorded investigation | Replay actual saved receipts without implying a live run or granting guest execution. Avoid synthetic evidence presented as a real result. |

## Case-centered interaction

Keep the existing template and make the selected case the place where work happens:

```text
Case title · reported impact · current status
What Relay needs from you / the next useful action

Investigation                       Findings
Actual action and time              Observed behavior + evidence
Evidence available                  Hypothesis + supporting checks
Blocked reason or current check     Uncertainty / requested review

Related knowledge: source, applicability, what changed
Review findings · Request another check · Prepare handoff
Technical details / usage / complete history
```

On a phone, put the pending decision first, followed by the result summary and expandable evidence. On desktop, show evidence and findings together. Overview should list cases needing a decision, active work, and results ready for engineering. Counts can remain secondary.

Component responsibilities: an investigation timeline, evidence viewer, finding review panel, clarification/approval card, related-memory panel, delivery status, and an expandable technical inspector. These reuse the current case and card components; they are not another template.

Each component needs loading, empty, disconnected, pending, rejected, stale, and failed states where applicable. A receipt awaiting upload must not appear as complete evidence. A stop request stays pending until the runtime confirms its outcome.

## Memory layers and conflict prevention

One authoritative database can contain several kinds of information without creating competing memories.

| Layer | What it contains | Write rule | Reuse rule |
| --- | --- | --- | --- |
| Project configuration | Approved app, environments, roles, permissions, owner bindings | Versioned maintainer changes | Validate against the current run; conversation text cannot grant access. |
| Raw investigation history | Actual actions, artifacts, observations, unsuccessful attempts | Append with stable source IDs and provenance | Historical evidence, not executable guidance. Preserve late events even if their run is stale. |
| Working interpretation | Hypotheses, proposed findings, checks and conclusions | Append revisions and explicit supersession | Show uncertainty; unsupported model text cannot become a fact. |
| Reviewed project memory | Reusable observation/procedure plus source and applicability | Explicit review, revocation and supersession | Filter by workspace/project, load authoritative source, check freshness before use. |
| Frozen run context | Selected evidence/memory/configuration for one admitted run | Immutable snapshot | Keep a reproducible record; changed prerequisites invalidate further execution. |

Important implementation conflict: `observe` in `crates/relay-api/src/lib.rs` currently attributes observations as `human_recorded`, increments the case revision, and invalidates published memory. `context_changed` in `runs.rs` stops an active investigation when its source revision changes. Routing live agent receipts through the human observation endpoint would both misattribute them and make the run invalidate itself.

Proposed first change: persist live run events and artifact references separately from the case revision. Promote a reviewed, supported result into case evidence atomically. A subsequent investigation stage gets a new frozen context. Keep stale-context checks intact; do not make the current run silently absorb unrelated edits.

The current coordinator event array stops appending after 128 entries. It is a bounded status history, not the journal for future replay. Introduce durable, cursor-addressable run events with explicit retention/capacity behavior. Event ingestion and cursor advancement must commit together. Observation author/reviewer names are currently supplied text, not verified user identities; new runtime provenance and approval identities must come from authenticated adapters or sessions.

Minimum proposed records:

- `InvestigationEvent`: workspace/case/run, stable producer event ID, producer and server sequence, occurred/received times, kind, actor/source, schema version, payload, artifact references. Repeated identical events are deduplicated; the same ID with different contents is a conflict.
- `Finding`: statement kind, supporting event IDs, author/reviewer, source context, status, and `supersedes_id`. A correction records who changed what and why.
- `Artifact`: source action/run, content hash, media type, capture environment, availability, access scope and redaction status. Hashing establishes identity, not truth.
- `Memory`: source finding/revision, review, applicability, active/superseded/revoked state. Preserve exact local retrieval as the baseline; a future semantic index only proposes candidates.

Narrow proposed operations are `ingest_run_event`, `read_run_events(after_sequence)`, `review_assertion(expected_revision, decision)`, `publish_memory(reviewed_assertion_ids)` and `build_context(stage, token_allowance)`. Scope all references in the existing workspace transaction. Review, source promotion and dependent memory invalidation must either succeed together or leave the old state intact.

Freshness compares revisions, configuration, source validity, and environment rather than “latest timestamp wins.” Two phones or clients editing the same case must get an explicit conflict with their draft preserved. A duplicate report may suggest linking cases but must not silently merge distinct incidents.

Example: a previous export failure followed a date change; the new failure follows an account change. Reuse the previous procedure as a lead, check account permissions, and preserve the possibility of a different cause. A successful retest on build B limits guidance from build A; it does not erase what was observed on A.

“Not reproduced” means a recorded attempt did not observe the reported behavior under stated conditions. It does not mean no bug exists. A handoff is not a verified fix, and a verified fix is not proof of deployment.

## Automatic workflow

Proposed product lifecycle, distinct from today's runtime status enum:

```text
Report -> resolve context -> needs clarification or permission
                         -> queued -> investigating
                                      -> blocked / interrupted / stale
                                      -> findings ready -> reviewed
                                                         -> handoff ready
                                                         -> delivery pending
                                                         -> delivered / uncertain
```

The agent interprets the problem and proposes checks. Deterministic backend rules control identity, admission, permission, budget, persistence, and delivery. One investigator can do this; another reasoning agent is not required for routing or retries.

| Operation | Proposed automatic behavior | Boundary |
| --- | --- | --- |
| Intake | Deduplicate trusted provider events and open/update the bound case | A message's claimed workspace or owner is not authority. |
| Context | Resolve configuration and retrieve a few applicable memories | Missing build/expectation stays unknown and may require clarification. |
| Investigation | Start once after prerequisites and configured permissions pass | Case text cannot expand tool scope; permission enforcement must exist in the runtime/tool layer. |
| Evidence | Save real receipts and partial progress as work occurs | No invented screenshots, outcomes, network traces or replay. |
| Findings | Draft an explanation and suggest a next check | Human-reviewed publication remains separate from model completion. |
| Delivery | Queue an approved result to the configured destination | Changed recipients or broader disclosure require appropriate authorization. |
| Recovery | Resume known work and reconcile uncertain work | Never repeat a possibly completed external action just because its response was lost. |

Closing Relay, opening another app, backgrounding a phone, and a failed investigation are different events. Client visibility may pause decorative rendering; it must not establish that Hermes stopped or accuse the user of an interruption. Show server/runtime-backed states such as connection lost, still running, outcome unknown, or stop confirmed. The previously reported interruption issue still needs a captured reproduction before assigning a root cause.

Run and event idempotency do not make each browser action safe to replay. Persist an action intent before dispatch, a receipt afterward, and an explicit uncertain state if the acknowledgment is lost. Require adapter-supported reconciliation before replaying an action with side effects.

Current elapsed-time limits are cooperative; actual token/dollar/tool limits are not implemented by Relay. Capability checks should report which limits the runtime enforces. Configure stage, action, retry, concurrency, and spending bounds before calling the workflow cost-bounded. Missing reported usage is unknown, never zero. Retrieve memory per stage or changed question, not on every UI poll.

Distinguish cumulative usage snapshots from incremental usage events, deduplicate their identities, and track reservations only when the executor can enforce them. A local spending counter alone cannot stop an external model call. The current unknown expired/cancelled run can retain the only active slot; add an operator recovery path that reconciles evidence instead of deleting the record or assuming execution ended.

## Smartphones and channels

| Capability | What counts as proof | Proposed order |
| --- | --- | --- |
| Use Relay on a phone | Accessible mobile report/review, working authenticated links, preserved decisions after reconnect | Improve shared responsive web first. |
| Use a phone messaging channel | Trusted inbound message reaches the right case; a bound reply/approval is accepted; actual delivery receipt returns | Prove one Plow line before expanding adapters. |
| Investigate mobile-web behavior | Captured browser/environment/device profile and actual observed outcome | After the first browser path, add explicit emulation coverage and then real-device checks. |
| Investigate native mobile apps | A device/emulator adapter executes authorized actions and returns device evidence | Separate expansion; a narrow viewport does not establish this capability. |

[Playwright emulation](https://playwright.dev/docs/emulation) can model viewport, user agent, touch and related settings. This is not a claim that a physical iPhone or Android device was tested. Label every result with execution browser, environment, viewport/device profile, OS when known, and emulated versus physical execution.

The current [Plow Hermes plugin](https://github.com/plow-pbc/hermes-plugin-plow) documents inbound WebSocket transport and outbound REST delivery, line-scoped credentials and a granted home phone-line chat. Its current documentation also lists version dependencies for reply context and consent flows. These are integration prerequisites, not evidence that Relay already supports those features. Pin and test the compatible runtime/plugin/API combination. Do not promise every messaging service, or call the phone line a native mobile application.

[Latch](https://plow.co/latch) documents approved Mac/site access and local credential filling. Verify the selected adapter's receipt/artifact capabilities in a live controlled run. Latch marketing or a generic MCP connection is not proof that Relay can export video, network traces, or physical-phone evidence.

Channel records should include authenticated installation/workspace, provider/line/thread, sender role, bound case, originating message ID and authorized destinations. An approval additionally binds the exact action, target, current context, permitted actor and expiry. A forwarded or obsolete “yes” must not approve a changed action.

Persist a case transition and its delivery intent in one transaction. Delivery uses event-plus-destination identity, stores provider IDs, preserves ordering, suppresses obsolete intermediate updates and ignores Relay's own messages during intake. A timeout after a provider may have accepted the message enters an uncertain state. Reconcile first; if the provider cannot establish whether it sent, show the ambiguity instead of guaranteeing exactly-once delivery.

Suggested owner message: reported impact, observed status and build, who owns the next step, a concise requested decision if needed, and an authenticated case link. Share only the evidence the recipient is allowed to see. A screenshot URL alone is not an access-control system.

## Acceptance and benefit measurement

| Evaluation | Required observation |
| --- | --- |
| Usability | Reporter describes a problem; reviewer sees and accepts/corrects supported findings without retyping; engineer can proceed from the packet. |
| Accessibility | Keyboard completion, screen-reader announcements, focus return, touch targets, contrast, reflow and motion checks on actual views, including failure states. |
| Correctness | Same symptom/different cause, wrong build, rejected hypothesis, and successful retest preserve distinct claims and applicability. |
| Concurrent changes | Case edit during execution, memory revocation, duplicate/out-of-order receipts and late results never silently replace current knowledge. |
| Recovery | Restart before dispatch, after dispatch, during a tool action and during delivery preserves evidence and uncertainty without blind replay. |
| Channels | Duplicate intake, echo messages, wrong thread/sender, expired approval, changed owner and ambiguous send produce explicit correct outcomes. |
| Mobile | Emulated and physical runs are labeled; app switching or offline periods do not become fabricated bug conclusions. |
| Cost | Total model/tool/retry cost and active human time divided by useful investigations; blocked and failed attempts remain in the denominator. |

Retain the existing proposed pilot targets from [the build brief](research/repro-relay-build-brief.md): ten representative reports from at least three teams, six accepted investigations, at least four independently reproduced bugs, and three people returning with a new report within seven days. These are proposed gates, not achieved adoption or a hackathon-day dependency.

For memory, use the existing chronological twenty-case comparison from [the memory design](research/repro-relay-memory-architecture.md). Compare current-case context alone against scoped exact history under equal budgets; include semantic retrieval only as a later experimental arm. Prevent answer leakage from the same case or future outcomes. Measure useful handoffs, active human effort, clarification rounds, stale guidance and unsupported claims. Do not infer quality from memory count or token volume.

Zero observed unauthorized disclosures, false verified-fix claims, or stale guidance in a bounded test suite is a gate for that suite, not proof of universal reliability. Report failures and sample size.

## Implementation order

1. **Prove the live adapter.** One controlled web application, one permitted Hermes/Latch action, one stored receipt/artifact, and a measured outcome. Check one actual Plow inbound/reply path in the same spike; capability failures become explicit blockers.
2. **Define event/provenance and review contracts.** Keep raw run progress independent of case revisions. Add structured findings and atomic review/promotion with correction history. Exercise stale context and duplicate events before wiring automatic writes.
3. **Build the useful case interaction.** Timeline, evidence, pending decision, review and handoff in one case. Fix accessibility issues in the same affected controls. Preserve the selected template and expose advanced context on demand.
4. **Enable bounded report-triggered execution.** Trusted intake, prerequisite resolution, explicit queue, configured permissions, enforceable limits, partial evidence and recovery. Do not silently add passive monitoring.
5. **Complete one owner channel.** Recipient bindings, clarification/approval correlation, durable outbox and uncertain-delivery handling. Prove the whole report-to-owner loop before adding more providers.
6. **Prove correction and useful reuse.** Demonstrate a failure on build A, success on B, preserved history, rejected stale guidance, and a new case benefiting from the applicable procedure.
7. **Validate installation and phone access.** Fresh install/restart with a second person, accessible mobile review, real-device checks appropriate to the advertised scope, and measured cost/usefulness. A native phone app and broader device adapters follow demonstrated demand.

The concrete next engineering task is the live adapter proof plus a proposed event contract, not another dashboard or an unbounded memory integration. The outcome to demonstrate is: a report became observed evidence, a human could make a clear decision, and the correct person received the current result without losing context.
