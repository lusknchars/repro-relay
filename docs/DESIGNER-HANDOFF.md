# Repro Relay: UI/UX designer handoff

Prepared September 14, 2026. This brief combines the founder's direction, observed setup problems, repository implementation, and design proposals. It specifies the redesign; it does not claim that every illustrated capability already works. No credentials or customer data belong in design files.

## 1. The product we are designing

Repro Relay should be a persistent workspace for investigating software problems and improving a repository. It should collect relevant context, keep investigations moving, explain findings with evidence, and bring people the decisions that need their judgment.

The intended experience: connect a repository and runtime, set standing permissions once, then return to useful work already organized for review. Users should not have to repeatedly write a task specification, diagnose their own bug, reconstruct context, or coordinate agents by hand.

Proposed product promise: **Know what needs attention, see what the agent discovered, and decide what happens next.**

Our first continuous-improvement objective is better agent context quality with less unnecessary token use. Investigation, triage, testing and isolated repairs remain central. Cost reduction is a goal that needs measurement, not an established result.

The distinction from opening a coding chat must be visible: Relay retains the issue, evidence, current source revision, decisions, execution history, memory and next action across sessions. Chat is one way to direct the work. The persistent work record is the product.

### Audience and product boundary

| Audience | Their job | What the interface must provide |
| --- | --- | --- |
| Primary: developers, technical founders, maintainers | Understand a problem, investigate, inspect changes and tests, control execution and spending | Dense but readable evidence, repository context, terminal access, exact action scope, recoverable history |
| Secondary: product/support colleagues and business owners | Explain impact, answer a clarification, review a proposed next step, follow an outcome | Plain-language summaries, sources, one clear decision, optional technical detail |

Use one shared issue record with progressive detail. Avoid two separate products or a mandatory beginner/expert mode.

The founder supplied an organizer list of business problems. The strongest proposed extension is support follow-through, with one important-work recommendation drawn from unresolved issues. Design room for a support message to become an investigation and for a verified outcome to return to its owner. This is a proposed extension, not approval to turn the whole product into a CRM or add a daily-news product. Deadline references to two days concern building/deploying for the event, not a two-day customer onboarding promise.

## 2. Current implementation versus the intended experience

Historical status entries are cumulative and sometimes superseded. Use this table as the handoff baseline; verify capability availability again during implementation.

| Area | Current evidence | What the redesign may show |
| --- | --- | --- |
| Web and desktop | React/TypeScript app shared with a Tauri desktop shell; Rust API and PostgreSQL | Common work history and navigation; explicit local-service readiness |
| Cases and evidence | Persistent cases, source revisions, observations, artifacts, saved results and review decisions | A real case-centered workspace; distinguish human observations, local test receipts and agent proposals |
| Repository monitoring | Automatic tracked-instruction audits, duplication candidates, recorded evaluations and decisions | Useful autonomous discovery within this scope; no claim that arbitrary code is continuously repaired |
| Pi terminal | Relay evidence tools and optional Mem0 tools; direct Moonshot `kimi-k3` configured | Pi as the connected terminal client; Kimi as its model provider, not a second investigator |
| Latest Kimi status | Local Pi startup/model selection verified; founder now reports it works | User-reported working connection until a current app-level diagnostic records a successful request |
| Hermes | Assessment runtime installed; scoped evidence and memory tools discovered; backend run contracts tested | Ready only after runtime/provider checks; no assumption that Pi's working Kimi login activates Hermes |
| Mem0 | Private Hermes/Pi notes stored and recalled in live service tests; local note journal | Separate private notes plus current reviewed project knowledge; no automatic promotion of private notes into facts |
| Memory connection reporting | Agent adapter is separate from the backend health flag | A redesign must unify truthful diagnostics; the current generic `mem0: false` flag does not describe adapter connectivity |
| Usage | Hermes reported-usage inspector exists; Pi reports usage separately | Coverage and source beside each chart. Mem0 charges and Kimi dollar estimates are not integrated into a unified total |
| Repairs | Git worktree preparation, approval/version contracts and execution ledger foundations | Worktree inspection/preparation where supported. Live autonomous repair and independent verification require execution proof |
| Native repository tools | Folder selection, tracked Git changes, existing worktrees, macOS Terminal handoff | Developer tools within the desktop; current terminal is external, not an embedded terminal |
| Accounts | Backend account/profile/invitation/role flows implemented and tested | Top-right identity, role and return-to-case links; no invented password recovery, SSO or remote deployment |
| Plow/Latch | User reported Plow activation; bridge and delivery contracts exist | Account activation, device connection, channel permission and actual delivery must be separate statuses; full continuous inbox loop is not proven |
| iPhone | SwiftUI foundation and explicit offline simulation | A proposed companion experience; live voice, push and remote control are not shipped facts |
| WebMCP | Read-only evidence tools exposed where browser support exists | Availability-aware inspection; no browser-based approval or repair power inferred from it |

## 3. Problems the redesign must resolve

1. Work is split across Overview, Autonomous work, Case inbox, Agent controls, Project memory, Handoffs and Connections. Users must infer how these pages relate.
2. Users cannot reliably tell whether an agent is installed, authenticated, reachable, running, waiting or finished.
3. Setup commands mix shell instructions and in-agent commands. A founder tried launching Pi from inside Pi and hit an interactive-terminal error.
4. A successful login appeared to mean usable model access. Anthropic then rejected a request for exhausted extra-usage credits despite an unused subscription allowance. The error was initially attributed to Mem0.
5. The interface historically asked users to write a diagnosis or a direction form again. The founder explicitly rejected this repetition.
6. Summary-card grids and large empty areas consume space without helping a user take the next step. The founder requested removal of the investigation statistic cards.
7. Connection cards lack obvious next actions. Decorative branding cannot substitute for Connect, Test, Fix connection or View activity.
8. Cost information has required digging into reports. It should be visible while reviewing the work, with unknown amounts clearly distinguished from zero.
9. A case can look completed when only a model response or a local fixture exists. The redesign must show the basis of every success claim.

## 4. Proposed information architecture

Reduce global navigation to four destinations. These are design proposals, not existing route names.

| Destination | Contents | Replaces or consolidates |
| --- | --- | --- |
| Work | Needs your decision, active work, blocked work, saved history, automatic discoveries | Overview, Autonomous work, Case inbox, most Agent controls |
| Knowledge | Reviewed project observations, private agent notes, freshness and source relationships | Project memory; private-note browser is new work |
| Usage | Token/time/cost charts and reporting coverage, filterable by run, runtime and provider | Existing usage inspectors plus a proposed consolidated view |
| Settings | Connections, repository/environment, permissions, automation, channels, team, preferences | Connections and distributed configuration |

Handoffs belong inside a work item. Account/profile and workspace switching live at the top right. Help and the command palette are available globally. Keep old case/run links valid during migration.

### Desktop workspace composition

```text
Workspace / Repository / Branch       Search or Cmd+K       Connections   Profile
───────────────────────────────────────────────────────────────────────────────
Work            Work history        Selected work: export failure
Knowledge       Search / filters    Impact · owner · build · last checked
Usage           Needs decision      Last confirmed step · next action
Settings        Running             ┌─────────────────┬───────────────────────┐
                Blocked             │ Conversation    │ Agent work            │
                Recent              │ and decisions   │ Findings / Changes    │
                                    │                 │ Tests / Activity      │
                                    │ Optional reply  │ Evidence detail       │
                                    └─────────────────┴───────────────────────┘
                                    Review action / actual execution status
───────────────────────────────────────────────────────────────────────────────
Repository tools: Changes · Worktrees · Terminal     Usage and connection state
```

Keep the work list stable while the selected item changes. Use resizable panes with accessible keyboard alternatives. At laptop widths collapse the list or inspector before reducing text sizes. Do not force all columns to remain visible at once.

The conversation is the issue's human/agent communication. The work pane contains structured outcomes and evidence. Raw JSON, complete transcripts and diagnostic logs belong in expandable inspectors. A full conversation beside agent work is a redesign target, not a description of the current backend's chat capabilities.

## 5. Critical journeys and screen requirements

### A. Connect once and reach a real first result

Proposed setup sequence:

1. Choose the repository and application/environment. Show discovered details for confirmation.
2. Connect the runtime appropriate to this workflow. Explain Hermes investigation versus Pi terminal review in one sentence each.
3. Choose the model provider and enter its credential through an appropriate private flow. Separate provider credits from plan/subscription limits.
4. Select standing permissions and the checks Relay may perform. Default to inspection; explicitly describe any edits or external messages.
5. Offer memory as optional. Show existing-account connection first and agent-account creation as an explicit alternative.
6. Run a bounded connection check and explain whether it makes a paid model request. A detected key is not a successful request.
7. Show the first actual scan/result. An optional guided tour appears in context and can be skipped or replayed.

Every step has Back, visible completion criteria, a recoverable error and a continuation path. No forced session title or first-prompt form. Do not automatically generate a duplicate account when a provider is already configured.

Design a connection detail panel with provider/account alias, scope, endpoint, model, credential presence, last verified request, available capabilities and next action. Mask credentials. Keep alias, provenance and last-check time visible without revealing keys.

All terminal instructions must say **Run in macOS Terminal** or **Type inside Pi**. Provide a one-command copy action for each shell step, an expected result, and guidance for returning from Pi to the shell. A native launch button must open the correct context if implemented. Copying a command cannot mark a connection successful.

### B. Open Work and understand the next decision

Work opens to an ordered list, not a wall of statistics. Each row contains title, project, short impact, state, last meaningful change, actor and the next action. Filters: Needs your decision, Working, Blocked, Finished. Search and previous selection survive refresh.

A proposed Today section can present one evidence-linked recommendation: why it matters, relation to the standing project goal, and the smallest next step. Use actual records. Do not fill an empty workspace with invented recommendations.

Empty states distinguish no work yet, no matches, paused monitoring, no connected repository and a failed refresh. Each has its own action.

### C. Inspect what the agent found

The selected-work header answers: what is being investigated, on which build/environment, by which runtime/model, and what is happening now. Opening an older run keeps its date prominent and provides **View active work**.

The result body follows this order:

1. Plain-language finding and impact.
2. Supporting evidence with a direct artifact link.
3. What remains uncertain or contradicted.
4. Suggested next action and its scope.
5. Tests, changes, memory and complete activity on demand.

Use source badges such as Agent proposal, Human observation, Local browser check and Fixture. Source labeling should be compact; detailed technical explanations belong in the inspector. Show before/after only when two real states exist. A proposal without a patch uses a proposed-change summary, not a fabricated diff.

The activity feed contains observable actions and concise conclusions. Do not present private model reasoning or invented thinking narration as an execution trace. A spinner represents a pending operation, not progress toward a known percentage.

### D. Review and execute an isolated correction

Illustrative future flow: discovery → investigation → proposal → exact-action approval → isolated worktree execution → independent checks → human merge/release decision. Feedback or failure can return the item to investigation; it is not a one-way success funnel.

The correction inspector shows base branch/commit, worktree identity, changed files, patch, allowed commands and validation environment. Separate the main checkout from the isolated worktree visually. Opening a repository never silently changes a case's authorized target.

Each decision has a specific label: **Accept finding**, **Request another check**, **Approve isolated fix**, **Approve this message**, **Merge reviewed change**. Only show executable actions that the actual runtime supports. Accepting a finding does not imply approval to edit, publish memory, merge or send a message.

Before approval, show the exact revision, intended effect and relevant risk. If evidence changes, mark the decision outdated and require a refreshed review. While submission is uncertain, show **Checking whether the action started**. Disable duplicate submission and offer reconciliation. A stop request displays **Stopping** until confirmed.

### E. Understand memory and context

Three visibly distinct layers:

| Layer | Meaning | Designer requirements |
| --- | --- | --- |
| Source evidence | Original case records, artifacts and revisions | Source, author/producer, build, time, immutable history |
| Reviewed project knowledge | Current observations approved for reuse | Reviewer, source case, revision, applicability, freshness, revoke action |
| Private agent notes | Short Mem0 working notes scoped to Hermes or Pi | Agent identity, unverified label, retrieval/use history when available, local hide versus cloud delete distinction |

For a selected run, design **Context used**: included sources and notes, inclusion reason if available, exclusions, freshness, and token measurements if actually recorded. A later run can receive updated context; an in-flight run does not silently change its frozen packet.

Use a context-change view inspired by the supplied context-rescue image: what changed, affected files/contracts, evidence, and what the agent will receive. Clearly label this as proposed until backed by real source changes and delivery receipts. Never invent “consumed by agent” from saving a note.

Retrieval returns useful leads, not proof that two bugs share a cause. Keep conflicting observations and superseded guidance inspectable with their status. Prevent revoked guidance from being offered as current advice.

### F. Inspect tests and cost without downloading files

Test triage defaults to failed, blocked or missing checks. Each row shows test name, result, environment, build/commit, source, time and artifact. Distinguish **Passed**, **Failed**, **Running**, **Not run**, **Blocked** and **Result stale**. A Chromium mobile viewport is not a physical iPhone test. Windows/Edge is its own environment. AI accessibility feedback is not a screen-reader test.

Usage belongs both near the active work and in the Usage destination. Design input/output/cache-token graphs, run duration, reported cost over time, and per-run drill-down. Separate Pi/Kimi, Hermes/provider and Mem0 service usage. Labels must distinguish measured tokens, provider-reported cost, estimates and missing coverage.

If cost is unavailable, show **Cost not reported** with available token counts. Do not plot missing values as zero or connect chart lines across unknown intervals. A subtotal must state which runs are covered. A configured spending cap is not prepaid credit, and a cooperative timer is not an enforced dollar ceiling.

Keep export as a secondary audit action. Include accessible tabular data beside charts. Cost-saving comparisons require a recorded baseline, comparable task/model, measurement method and preserved outcome quality. Context storage bytes alone cannot establish token savings.

### G. Continue on phone or through Plow

The companion's job is to keep work moving away from the desk: provide a missing fact, review an exact action, understand a blocked outcome, and reopen the same record. Phone users should not have to interpret a dense terminal trace to make a decision.

Proposed phone navigation: Work, Decisions, Activity. Show the issue, impact, agent summary, evidence preview and one next action. Technical details remain available. Account and channel settings are secondary.

Plow design must distinguish line activation, Latch availability, authorized destination, queued send, sent/delivered receipt and recipient response. Show the recipient and message before approval. A changed recipient or edited message needs a new decision. The interface must preserve an uncertain send rather than invite a blind retry.

Voice/call is a future input mode into the same work record. A simulated call must say **Demo call** and must not suggest a real person or agent was contacted. Design microphone denial, interruption, transcription review and failed delivery before considering voice launch-ready.

### H. Return with a team

Keep avatar/profile in the top-right corner. Expose workspace, role, account settings and invitation controls appropriate to that role. A shared link returns an authorized teammate to the exact case or run. Include expired/revoked invitation, signed-out return, viewer-only access and removed membership states.

A join link is not permission to approve every action. The UI must describe the access being granted. Remote desktop/iPhone sharing needs connected authentication and deployment work; don't illustrate it as shipped because local accounts exist.

## 6. State and recovery contract

| Situation | Visible message | Useful action |
| --- | --- | --- |
| Runtime installed, no provider credential | Model account needed | Connect model account |
| Credential present, no request verified | Connection not yet tested | Test connection, with request cost disclosure |
| Authenticated but model rejects credit balance | Model request blocked: provider credit balance | Open the correct provider billing page or change provider |
| Mem0 unavailable, local knowledge available | Private notes unavailable; reviewed knowledge available | Inspect connection / continue with known limits |
| Monitoring ready, no active task | Watching for changes | See monitored scope / pause |
| Work confirmed active | Investigating; last confirmed action and time | Open current work / request stop |
| Client loses runtime contact | Status unavailable; last checked at… | Reconnect / reconcile |
| Stop requested | Stopping; confirmation pending | Inspect status |
| Model returns text | Proposal ready | Review sources / decide |
| Tests pass for a particular build | Checks passed on [build, environment] | Inspect receipts / review change |
| Approved action outcome unknown | Action confirmation pending | Check outcome, preserving request identity |
| Changed source invalidates an approval | Evidence changed since this approval | Review current version |
| No candidates from an audit | No qualifying issue found in this scan | Inspect scope and scan time |

Switching apps, closing a window or going offline does not itself mean an agent was interrupted. Avoid tying execution state to browser visibility. Review and execution controls must reflect server receipts rather than optimistic success animations.

## 7. Visual and interaction direction

Use the existing licensed **PaceUI Ultimate Dashboard** as the sole template foundation, with the existing shadcn/Radix components. Recompose the hierarchy and screens; do not import another dashboard kit. Retain template licensing boundaries for any shared design assets.

The desired tone is a professional developer tool: deliberate density, clear typography, quiet surfaces, precise feedback. Kiro/Kiro Crew is the founder's reference for concise state and approachable tools. The supplied session-history image informs searchable history beside work. Roborev informs a straightforward review-to-correction loop. Vercel is the reference for scoped configuration and clear effective values. These are interaction references, not permission to copy their branding or source.

Design specifications:

- Dark and light themes with shared semantic tokens. Keep the blue accent consistent between the sidebar ASCII effect and perspective grid; do not reintroduce the mismatched purple.
- Thin card/panel borders, clear selected-state borders and restrained elevation. A neutral surface may strengthen on hover, but only interactive cards should imply clickability.
- Body text around 14–16px, concise headings, tabular numbers for usage and timings, monospace for paths/commands/diffs only. Do not shrink type to fit all panes.
- Use rows and separators for repeated work. Reserve cards for genuinely distinct decisions or grouped information. Avoid returning to a grid of oversized counters.
- Buttons show hover, focus, pressed, pending, success and failure. Adapt the existing animated approval button to real request state; never use its original random-success demo behavior.
- The expanding-dot/arrow treatment suits navigation. It must work with keyboard focus and touch, without shifting surrounding controls or hiding the label.
- Start with 120–180 ms control feedback and 180–240 ms pane transitions. Prefer opacity/transform and preserve focus. Motion is a specification to validate, not a promised frame rate.
- Ambient effects stay in navigation/settings, at low contrast. Pause when hidden, respect reduced motion, and provide a static fallback. They must not compete with findings, logs or graphs. Display-driven animation may benefit high-refresh monitors; never claim guaranteed 120 fps across devices.
- Plow and Hermes logos identify integrations and must have text labels. Preserve supplied assets with correct contrast and aspect ratio. Do not use a bot icon as a generic identity for every different service.

### Responsive and accessibility acceptance

Target WCAG 2.2 AA, using the [W3C quick reference](https://www.w3.org/WAI/WCAG22/quickref/). The brief sets a target, not a compliance claim. Normal text needs 4.5:1 contrast; large text and meaningful UI boundaries need 3:1. Provide visible focus, semantic headings, labeled controls, non-color status cues, keyboard operation and announced asynchronous outcomes.

Use a 44px touch-target design target for primary phone controls. Test at 320/390px, 768px, 1280/1440px and wide desktop sizes. Support zoom/reflow, software keyboards, reduced motion, screen readers and navigation without a mouse. A diff may scroll inside its own labeled region; the whole phone page must not require horizontal scrolling. A draggable panel needs a keyboard/alternative control. Preserve reading position when live events arrive.

## 8. Design deliverables

Deliver an editable Figma file and a linked clickable prototype with:

1. Product map and proposed navigation, including old-route migration notes.
2. Token library for color, typography, spacing, radius, elevation and motion, mapped to existing UI tokens where possible.
3. Work list and conversation/work workspace at desktop and phone widths.
4. First-run setup plus incomplete, authenticated-unfunded, provider-error and successful-request states.
5. Findings/evidence inspector, exact-action review, version conflict and uncertain-submission states.
6. Worktree/diff/test composition, clearly marking features that require backend work.
7. Knowledge and Context used views with private/reviewed/revoked distinctions.
8. Usage charts with measured, estimated, unavailable and partial-coverage variants.
9. Scoped settings and account/invitation flows.
10. Proposed phone decision and Plow handoff flow, separate from current offline SwiftUI capabilities.

Component inventory: work row, connection indicator/detail, source/provenance badge, last-confirmed-action line, conversation turn, finding summary, artifact preview, diff viewer, test row, context inclusion row, decision bar, approval button, usage chart/table, scoped settings field, secret input, empty/error state, activity event and responsive pane controls. Supply state variants, content rules, keyboard behavior and responsive behavior, not just a finished screenshot.

Every frame/action must be tagged **Existing**, **Recompose existing**, **Needs backend**, or **Future concept**. Annotate the event that makes a state change true, the data it needs, persistence expectations, permission boundaries and recovery behavior. Label all invented scenario data as prototype examples. Do not include real access tokens, personal chat history or account balances in shared Figma files.

## 9. Prototype scenarios and review criteria

Use one clearly labeled fictional export-failure case through the whole prototype. Example: an owner reports an export failure, a maintainer investigates a schema mismatch, tests identify an unresolved browser gap, an isolated correction is reviewed, and the owner sees the confirmed result. This is illustrative; do not attribute it to a real run.

Test these tasks with developers and at least one less-technical reviewer:

| Task | Proposed acceptance target |
| --- | --- |
| Open Work and identify the next decision | Within 10 seconds, without opening unrelated pages |
| Explain whether work is live or historical | Correctly distinguish ready, running, stopped and unknown states |
| Find the evidence supporting a finding | At most two actions from the finding |
| Recover from a provider-credit error | Identify the correct service and next action without blaming memory or losing the work |
| Start a second session | Reuse repository/provider context without repeating the diagnosis |
| Review an action | Explain the exact effect and scope before approving |
| Review after evidence changes | Recognize that the previous approval is outdated |
| Inspect spending | Identify source, period and missing coverage without downloading anything |
| Inspect tests | Distinguish real Windows/Edge receipts from Chromium/mobile simulation |
| Continue on a phone | Understand and complete an authorized decision without a terminal |
| Pause and return | Resume context without duplicate actions or a fabricated success |

These are evaluation targets, not measured current performance. Record task completion, time to first useful result, unnecessary inputs, wrong-service recovery attempts, source-inspection success and decision mistakes. For autonomous workflows, also measure human interventions and verified outcomes, not just agent activity volume.

## 10. Delivery order and unresolved decisions

**First design slice:** connection clarity, one Work workspace, live-versus-history status, findings with evidence, direct decisions, visible usage and recovery. This addresses the problems already observed.

**Second slice:** private/reviewed context inspection, isolated-correction review, detailed test coverage, scoped settings and team return links. Some views require new API data; design must identify it.

**Later:** continuous support-inbox intake, reliable external follow-ups, important-work nudges, phone push/voice and an embedded terminal. Do not let these future features delay a credible first loop.

Resolve before implementation: whether support follow-through becomes the launch story; which live runtime can execute protected repairs; which phone/channel workflow will be exercised first; which source provides authoritative usage totals; how remote team access will be deployed. Designers may show alternatives, but must not silently turn them into available capabilities.

## Repository references

- [Current milestone and historical validation](STATUS.md)
- [Current frontend and template constraints](FRONTEND.md)
- [Delivery protocol and state invariants](DELIVERY-PROTOCOL.md)
- [Product depth review](PRODUCT-DEPTH-REVIEW.md)
- [Vercel-inspired settings contract](research/vercel-configuration-benchmark.md)
- [Desktop tools and supplied Kiro reference](DESKTOP-DEVELOPER-WORKSPACE.md)
- [Proposed support follow-through direction](research/support-product-direction.md)
- [SwiftUI scope and simulation boundaries](SWIFTUI-CLIENT-PLAN.md)
- [Accounts and team access](ACCOUNTS-AND-TEAM.md)
- [Mem0 integration and source-of-truth rules](../integrations/mem0-memory/README.md)
- [Pi terminal integration](../integrations/pi-harness/README.md)
- [Hermes assessment setup](../integrations/hermes-assessment/README.md)

The designer's main task is to make a useful, persistent work loop understandable. Visual polish should make evidence, progress and decisions easier to read and act on.


## Tools library reference update

The supplied discovery/library screenshots add a concrete requirement: users should discover capabilities, inspect their purpose and cost, connect an account, and decide whether the agent may use them. Keep those steps distinct. A saved enable switch cannot prove authentication or successful execution.

The implemented Connections library now contains eight curated tools with search, categories, setup actions and an Enabled in Pi filter. Mem0 selection persists and affects the next Pi launch. Pi, Kimi, Hermes, context monitoring, Plow/Latch and WebMCP retain their separate setup/runtime boundaries. Design a clear detail inspector with connection evidence, permission scope, cost source and the next action. Preserve the existing PaceUI component foundation, Relay blue, keyboard focus and mobile layouts.

A general tool marketplace, arbitrary package installation, provider OAuth inside Relay, and combined third-party spending charts still require backend work. Do not present those as working in the redesign. See `web/src/components/ToolLibrary.tsx` for the current behavior.
