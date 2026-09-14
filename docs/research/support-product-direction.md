# Product proposal: support follow-through and daily priorities

September 14, 2026. Proposed direction, not an approved pivot or a statement of implemented behavior. This evaluates the two organizer screenshots supplied by the user against the current Relay repository. The screenshots are the supplied scope constraint; this review does not independently establish event rules or a submission deadline.

## Recommendation

Make Relay a support follow-through agent for the owner of a small software business. It should keep a customer issue moving from the first message to a confirmed outcome, retaining the evidence, commitments and next action. Add the organizer's important-work nudge as a daily view of that same work. One owner, one support inbox, one project, one Hermes runtime.

Proposed promise: **Relay follows up on unresolved customer problems and tells you which one deserves your attention today.**

The first use case directly maps to the organizer's support bot: handle a ticket, reach out on the owner's behalf and follow up until the issue is addressed. The second maps to the important, not necessarily urgent, daily nudge. It uses the owner's standing business goal and the existing support history. It must not become a generic morning summary or a list sorted only by urgency.

The starting audience is a hypothesis. We have not established an accessible pilot customer, measured their support workload or validated willingness to pay. The organizer's interest in support bots is a reason to investigate demand, not proof of demand for Relay's particular implementation.

## What the current application actually supports

The local `relay doctor` check during this review reported a healthy Rust/PostgreSQL API and `investigator.available=false`, with the instruction to connect a dedicated Hermes runtime. Installed software and working UI controls do not establish a working agent workflow.

| Existing area | Evidence and limits | Use in the proposed product |
| --- | --- | --- |
| Cases, history and evidence | Persistent API, reviewed memories, versioned records and tests | Keep the support issue and its sources together |
| Decisions and delivery outbox | Versioned approvals, claims, uncertain outcomes and receipts in `crates/relay-api/src/channels.rs`; that module does not send to providers | Review an exact reply, then preserve what actually happened |
| Plow bridge | Selected-message intake and approved sends to one configured owner chat, with protocol tests; no continuous inbox consumer or arbitrary customer destination | Owner interaction channel after a live test; an additional adapter is required for the support inbox |
| Report automation | Admission queue can invoke the configured investigator under project settings | Start one investigation for a new eligible issue; not a support follow-up scheduler |
| Hermes | Dedicated assessment setup exists; the live Relay runner is unavailable | Must prove an actual tool call, useful result and usage record before promising automated investigation |
| Repair tools and ledger | Worktree preparation and repair contracts exist; live repair execution remains unverified | Optional later escalation when the support issue requires a code change |
| Context audit and Pi | Real context auditing and read-only evidence inspection; Pi review needs provider access | Internal efficiency and maintenance tools, outside the main support journey |
| Desktop | Native repository selection, Git inspection and Terminal handoff | Technical investigation workspace for maintainers |
| iPhone | Explicit offline simulation in `docs/SWIFTUI-CLIENT-PLAN.md` | Keep out of the live product claim until connected |

These foundations are useful. The largest gap is integration across them: real inbound message → useful Hermes result → reviewed outbound message → reply or follow-up → confirmed outcome. Adding another UI module does not close that gap.

The two failed Pi commands also expose an onboarding defect: the application asks people to infer their working directory and distinguish shell commands from in-agent commands. The immediate workaround is `/Users/luskoliveira/repro-relay/relay pi start` in an interactive terminal, then `/login` inside Pi. Future native setup should open the appropriate session directly and show the next action based on actual connection state.

## Compare the plausible directions

Scores below are planning judgments, not measured customer demand or probability of success. Each question is scored 1–5. The three lenses each total 20; compare the weakest lens before the overall total.

| Question | Support follow-through + priority nudge | Receipt collection + unused subscriptions | Short-term rental support |
| --- | --- | --- | --- |
| Q1. Pain | **2**: plausible recurring owner burden; no interviewed pilot | **2**: organizer requests it; no pilot spending evidence | **4**: the linked owner's repository describes repeated guest questions; we lack access to that owner |
| Q2. Job | **5**: when customer problems are unresolved, keep them moving so I stop chasing updates | **4**: when reconciling spending, gather evidence so I can identify unused purchases | **5**: when guests need help, answer from property facts so the owner need not handle each message |
| Q3. Insight | **3**: waiting, commitments and confirmation are part of resolution, beyond diagnosis | **2**: low usage does not prove an unnecessary subscription; evidence needs multiple systems | **3**: property operations history grounds otherwise generic replies |
| Q4. Announcement clarity | **4**: one issue followed to a confirmed outcome | **4**: receipts assembled and cancellation candidates reviewed | **4**: a guest reply grounded in the property's operating facts |
| Problem clarity | **14/20** | **12/20** | **16/20** |
| Q5. Large advantage | **2**: fewer owner follow-up touches is testable; no 10x result established | **2**: no time or savings baseline | **2**: no advantage over the linked existing implementation established |
| Q6. Audience/theme fit | **5**: directly fits two supplied items and Relay's existing issue model | **4**: directly fits two items but changes Relay's working domain | **5**: exact item with a concrete organizer-linked example |
| Q7. Distinctiveness | **3**: evidence-linked follow-through and confirmed outcomes; differentiation still unproven | **2**: broad integrations would dominate before a distinctive result | **2**: an organizer-linked implementation already covers the obvious workflow |
| Q8. Current alternative | **4**: owner manually tracks support threads and asks teammates for status; pilot must confirm | **3**: manual mailbox/spreadsheet review, subject to pilot confirmation | **4**: the owner answers guest questions, as described in the linked repository |
| Differentiation | **14/20** | **11/20** | **13/20** |
| Q9. Small build | **3**: one inbox and one issue lifecycle reuse current records, but runtime and transport must work | **2**: receipt parsing, account matching and usage evidence are new | **2**: no property corpus, booking account or authorized guest channel available here |
| Q10. Demo moment | **5**: a stalled issue gets a grounded follow-up, then a real reply updates the same history | **4**: a missing receipt is matched to an actual payment | **5**: a guest receives a reviewed answer using a recent property update |
| Q11. Dependencies | **2**: Hermes provider access, support inbox, Plow owner channel and durable worker | **1**: mailbox, billing/usage data and provider-specific cancellation behavior | **1**: guest inbox, property data, booking integration and owner approval channel |
| Q12. Stop condition | **4**: stop expansion if one live support round trip cannot be completed in the first day | **3**: do not proceed to cancellations without a verified receipt/payment match | **3**: no rental build without an accessible owner and authorized sample conversations |
| Feasibility | **14/20** | **10/20** | **11/20** |
| Total / weakest lens | **42/60 · 14** | **33/60 · 10** | **40/60 · 11** |

The recommended direction needs reshaping around a live execution milestone; the score is not a reason to add both features immediately. Receipt/subscription management introduces a new data domain. Rental support becomes attractive if actual access to a rental operator and their systems is available, but that access is currently unknown.

Press-release tests:

- Support: Relay keeps customer problems moving after the first reply. It collects the relevant evidence, proposes the next message and remembers when a follow-up is due. Each day, it explains which unresolved issue most affects the owner's stated goal.
- Receipts: Relay gathers receipts linked to business payments. It shows missing documentation and subscription candidates with their supporting evidence. The owner decides which account changes to make.
- Rentals: Relay prepares guest replies from a property's operating history. The owner reviews the wording and its sources. The conversation remains attached to the original guest request.

## One concrete product journey

Illustrative scenario, not an observed customer incident:

1. A customer writes to a connected support inbox: “The export still fails, and I need it for tomorrow's report.” The message creates or updates one case using the provider thread and message IDs. The owner does not fill another diagnosis form.
2. Hermes reviews that thread, relevant reviewed knowledge and any approved technical evidence. It distinguishes a known workaround from a hypothesis. It asks for an essential missing fact only when the connected sources cannot supply it.
3. Relay proposes a reply with its sources and destination beside it. An owner approves that exact version, edits it or declines. Approval applies to this action; a later message does not inherit it.
4. The support connector sends it and retains the provider receipt. The case says “Waiting for customer,” identifies who owes the next action and records a follow-up time.
5. A durable worker checks for a newer reply before following up. A reply, pause, cancellation, changed destination or uncertain send prevents a blind retry. Follow-up count and frequency have explicit limits.
6. A developer can use the existing investigation workspace if code evidence is needed. A reported fix, a passed check and the customer's confirmation remain distinct events.
7. The customer confirms that the export works. Relay records who confirmed it and closes the loop according to the workspace's closure rule. A timeout can produce an unresolved/archive state, never an invented success.
8. The daily nudge identifies another neglected issue that affects the owner's standing goal, explaining why it matters and the smallest useful next action. The owner can open it, snooze it or mark it irrelevant.

The organizer-linked [STR Hermes repository](https://github.com/plow-pbc/str-hermes-agent) provides a useful structural reference: incoming message, grounded draft, owner review, delivery. Its README distinguishes working, provisioned and not-enabled capabilities. We should adopt that specificity in our own claims. Its rental logic, credentials and operating data are not part of this proposal.

## Give the interface a clear job

Keep the PaceUI template. Change which work is prominent:

- **Inbox:** cases grouped by Needs your decision, Agent working, Waiting for someone, and Resolved. A state needs a recorded cause and current owner.
- **Case workspace:** the conversation next to evidence, proposed actions and a compact next-action line. “Waiting for a customer reply since Tuesday” is more useful than a generic activity animation.
- **Today:** initially one section in the inbox, not another dashboard page. One important recommendation with goal, reason, evidence and action.
- **Settings:** inbox, owner channel, allowed actions, schedule, runtime access and cost limits. Terminal harnesses and repository tools sit under advanced settings.

Memory becomes a source-backed explanation of why a reply was drafted. Costs stay beside the run that incurred them. Git worktrees appear only for issues requiring a repair. Simulated iPhone calls remain visibly separate from the live workflow. “Autonomous work” should identify which worker is active and what it can actually do.

## Backend work required

The existing local-only channel adapter is not a customer support connector. The first support inbox must be chosen based on an accessible pilot and authorized credentials. Do not advertise Gmail, Intercom, Slack or other providers before implementing and exercising them.

| Area | Smallest new responsibility | Acceptance evidence |
| --- | --- | --- |
| Inbox consumer | Cursor/checkpoint, provider identity, normalized inbound message, deduplication and thread-to-case mapping | Duplicate delivery creates no extra case; newer reply updates the existing thread |
| Conversation state | Participants, awaiting party, next action, due time, commitments and closure evidence | Restart retains the same next action and history |
| Hermes adapter | One real investigation/drafting turn using the relevant evidence; retain tool outcomes and usage | A model result and its actual tool call are visible in Relay; failed tools remain failures |
| Delivery connector | Exact reviewed message to an authorized destination; immutable provider receipt | One approved message reaches a consenting test recipient, once |
| Follow-up worker | Durable due jobs, leases, rechecks, cancellation and uncertain-outcome reconciliation | New reply cancels pending follow-up; restart and duplicate tick do not duplicate sends |
| Priority nudge | Standing goal, explainable importance rules, quiet hours, snooze and deduplication | An important but quiet issue outranks a noisy low-impact issue for a stated reason |
| Efficiency | Process new thread events; retrieve relevant source versions; track actual usage | Report model calls/tokens and operator touches per completed case, not inferred savings |

Importance should consider goal relevance, observed customer impact, commitments and unresolved dependency blocks. Urgency is a separate signal. Missing impact data must stay unknown. Begin with inspectable rules and let the model explain the selected evidence; do not pay for repeated full-inbox reasoning on every timer tick.

## Build gates within a proposed 48-hour budget

This is a time-box proposal, not a confirmed event deadline or a delivery guarantee.

1. **First 4 hours:** establish the pilot owner and first inbox; complete Hermes provider access; execute a real tool-backed turn and show its result. If this fails, stop UI expansion and resolve the runtime/access issue.
2. **By hour 12:** ingest one real message, draft a sourced reply, obtain approval and send to an authorized test recipient. Store the receipt. If no connector access is available, use clearly labeled replay data for development and withhold the claim of live support automation.
3. **By hour 24:** ingest the reply, exercise the waiting state, restart the worker and verify duplicate prevention. End with a real confirmation or an explicit unresolved outcome. If this loop does not work, cut the daily nudge from the first release.
4. **Remaining day:** add one daily priority suggestion using that same case history, shorten onboarding and test the loop with a pilot. Package the working path; keep incomplete modules out of its default navigation.

The decisive demo is one message traveling through the whole loop with timestamps, sources, approvals and receipts that can be inspected. A visibly labeled accelerated schedule may test follow-up timing; it must not imply that a real day has elapsed.

Success measures should be captured against the owner's current process: owner follow-up touches per case, time waiting without an assigned next action, duplicate/wrong-recipient sends, unsupported claims, actual token cost per handled case and confirmed outcomes. We have no baseline or demonstrated 10x improvement yet. More installations, UI screens or generated text are not substitute measures.

## Decision to carry forward

Proceed with **support follow-through** as the first customer outcome and make the **important-work nudge** conditional on completing that loop. Preserve the useful backend, evidence and approval work. Pause new agent harnesses, general reference collection and native voice features while the live customer path is incomplete.

Still needed before implementation: one accessible pilot, one selected support inbox with credentials, the owner's definition of a resolved issue and their standing business goal. The initial release should not require a different goal or prompt for every case.
