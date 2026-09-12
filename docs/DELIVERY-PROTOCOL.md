# Repro Relay delivery protocol

Version 1, September 12, 2026. The user accepted the [product depth review](PRODUCT-DEPTH-REVIEW.md) and requested a concrete protocol covering its areas and resources. This document governs how that work is specified, built, checked, and represented in the interface. It does not mean the planned capabilities are implemented.

Use the [domain glossary](../CONTEXT.md) for state meanings and the [Orca/Warp benchmark](research/orca-warp-dashboard-benchmark.md) for dashboard interaction requirements. Current code and `STATUS.md` remain the evidence of shipped behavior.

The user selected [Vercel as the configuration benchmark](research/vercel-configuration-benchmark.md). C-01 through C-08 define scope, effective values, validated saves, connection checks, credentials, change effects and accessible settings. These apply across RP-01/RP-02/RP-05/RP-06/RP-10/RP-13/RP-14; configuration is part of those deliverables, not a separate decorative page.

## Product contract

A person reports a problem. Relay investigates within configured permissions, preserves actual evidence, presents a reviewable result, and delivers the current outcome to its authorized owner. The same case is available to support, engineering, and the owner through the appropriate client.

The first automatic trigger is a valid report. Continuous observation of a person's desktop, terminal, or applications is not included by implication. PaceUI remains the only dashboard template. One investigator performs the reasoning; deterministic workflow modules handle identity, storage, routing, and retries.

## Work item and completion rules

Every implementation item uses an `RP-xx` area ID and records:

```text
ID / title:
User and problem:
Responsible implementer / reviewer:
Current state and source evidence:
Required resources and dependencies:
Trigger -> operation -> persisted result -> visible result:
Permission and budget boundary:
Loading / empty / denied / failed / stale / uncertain behavior:
Acceptance scenarios and test locations:
Evidence from the actual run, build and environment:
Remaining limitations and rollback/recovery:
Status:
```

The roles in the coverage table identify responsibility, not people already assigned. Name the implementer and reviewer before starting an item. Review is a responsibility and does not require a second runtime agent.

Allowed delivery statuses are `planned`, `ready`, `in progress`, `blocked`, and `accepted`. `ready` requires its inputs and prerequisites. `blocked` names the exact unavailable resource, responsible person, and next check. `accepted` requires all acceptance criteria for that item and explicit evidence; it is never inferred from a screenshot or passing unrelated tests.

Record evidence scope separately: `source inspection`, `protocol fixture`, `browser fixture`, `live integration`, `physical device`, or `user evaluation`. A fixture-tested item can be accepted as a fixture implementation while a separate live-integration item stays open. Never relabel fixture evidence as live.

## Complete area coverage

The status column below describes the starting baseline. All listed deliverables still require work or further verification. Dependencies refer to accepted contracts needed for final integration; independent interface work can use labeled fixtures beforehand.

Implementation update, September 12: the first review increment adds persisted proposal decisions, frozen corrective context, and a three-column investigation workspace. It contributes to RP-04, RP-05, RP-07, and RP-08. Findings are still free-form proposals; typed findings, evidence promotion, live receipts, automatic source repair, and independent retesting remain open. The correction path is a user-initiated follow-up investigation. It does not satisfy RP-06 automatic workflow. [Runner documentation](HERMES-RUNNER.md) records the API, trust boundaries, recovery behavior, and fixture scope. Microsoft testing is Edge/Windows compatibility, separate from smartphone and physical-device checks.

| ID | Area and responsible role | Starting baseline | Concrete deliverable | Dependencies | Proof required |
| --- | --- | --- | --- | --- | --- |
| RP-01 | Runtime/setup · integration maintainer | Coordinator fixture-tested; live adapter unproven | Capability check, authorized target configuration, live action and receipt | Approved test app, build, account, Hermes/Latch access | Known action produces persisted real evidence; denied/unavailable access produces an actionable blocker. |
| RP-02 | Intake/context · workflow implementer | Manual web reports; no phone intake | Configured defaults, short report flow, missing-context clarification, trusted request identity | Maintainer-supplied project/target context | Duplicate intake opens one case; unknown expectation/build stays unknown; reporter does not supply authority. |
| RP-03 | Evidence journal · backend implementer | Status events and user evidence URLs | Durable run events, artifacts, cursor replay, provenance and availability | RP-01 | Duplicate/out-of-order/late events preserve one complete history, including more than 128 events; live receipts do not change the active case revision. |
| RP-04 | Findings/review · workflow + interface implementers | Saved raw proposals; manual observations | Typed findings, supporting evidence, review/promotion, corrections | RP-03 | Accept or reject a supported finding without retyping; atomic promotion uses expected revision and correct attribution. |
| RP-05 | Project memory · backend implementer | Scoped exact retrieval and revocation | Reviewed finding references, applicability, correction/supersession reasons | RP-04 | Stale/revoked guidance excluded; same symptom/different cause remains distinguishable; original history remains available. |
| RP-06 | Automatic workflow · runtime implementer | User-initiated runs with cooperative stop | Report-triggered admission, visible queue, prerequisite checks, action recovery | RP-01, RP-02, RP-03, RP-04, RP-13 | Valid report starts once under configured permissions; unknown action outcome is reconciled before any retry. |
| RP-07 | Dashboard/case workspace · interface implementer | PaceUI inventory and separate run controls | Decision queue, investigation timeline, evidence/review workspace, technical inspector | RP-04 | D-01 through D-06 below pass using real persisted states or explicitly labeled development fixtures. |
| RP-08 | Accessibility · interface implementer + accessibility reviewer | Basic semantics, keyboard and narrow-layout checks | Focus/navigation fixes, drawer close, motion setting, contrast and error recovery | RP-07 for final full-flow evaluation | Keyboard, assistive technology, reflow, touch and motion checks include failure states; no blanket conformance claim from an automated scan. |
| RP-09 | User resources · product/interface owner | Setup docs and empty-state guidance | Contextual examples, finding explanations, recovery help, redacted diagnostics | RP-02, RP-07 | Reporter, reviewer and maintainer each recover from a defined blocker using the displayed guidance. |
| RP-10 | Phone/channels · channel implementer | Planned; connection card disconnected | One Plow line, trusted case/thread bindings, decision correlation, durable outbox | RP-02, RP-04, RP-06 | One inbound report and one owner result have actual provider identifiers; duplicate/echo/stale/uncertain cases behave correctly. |
| RP-11 | Smartphone investigation · browser/device implementer | Relay has narrow-screen checks only | Explicit mobile-web execution profile and evidence metadata; later physical/native adapter | RP-03, RP-06; RP-08 for review usability | Reproduce a controlled mobile-web issue with labeled emulation; claim a physical/native result only after testing that device path. |
| RP-12 | Engineering handoff · workflow/interface implementers | Versioned snapshots and exports | Reviewed findings populate a current, inspectable packet with unresolved questions | RP-04, RP-05 | Engineer can proceed; changed build/assignment/source invalidates use; export and UI agree. |
| RP-13 | Costs and limits · runtime/operations implementer | Reported usage; no Relay hard spending cap | Enforced-limit capability reporting, stage/action/retry limits, accurate usage accounting | RP-01 | Demonstrate supported limit enforcement; missing usage remains unknown; replayed usage does not double count. |
| RP-14 | Maintainer/recovery · operations implementer | Durable coordination; uncertain runs can reserve the only slot | Health and heartbeat view, pending work, reconciliation guidance and supported resolution | RP-03, RP-06, RP-10, RP-13 | Restart/lost acknowledgment preserves evidence and uncertainty; recovery does not silently duplicate execution or messages. |
| RP-15 | Release and benefit · release owner | Local builds/tests; live workflow incomplete | Fresh-install evidence, claim checklist, failure matrix and user evaluation record | RP-08, RP-09, RP-10, RP-12, RP-14 | Another person completes the advertised workflow; each public claim has matching evidence and recorded limitations. |

RP-11 is an expansion gate. Phone access through RP-10 is part of the first full workflow; native mobile investigation is not a prerequisite for that release unless it is advertised. A separately built native Relay phone app also remains a later client decision.

## Resource inventory

| Resource | Supplied or controlled by | Protocol requirement | If absent |
| --- | --- | --- | --- |
| Approved application and test data | Maintainer/application owner | Exact target/environment and permitted account actions; known failing and healthy behavior | Mark RP-01 live proof blocked; use a labeled fixture only for development. |
| Build identity and expected result | Application owner/configuration | Observed or supplied build and confirmed acceptance condition | Clarify; never generate a plausible commit, root cause or expectation. |
| Hermes/Latch runtime | Integration maintainer | Compatible version, capabilities, tool permissions, action/receipt contract | Preserve manual case access; explain the missing runtime capability. |
| Database/event storage | Backend maintainer | Workspace-scoped durable records, atomic transitions and recovery | Do not dispatch work that cannot be recorded durably. |
| Evidence storage | Backend maintainer | Authorized artifact access, digest/provenance, redaction and availability | Mark evidence pending/unavailable; do not publish a broken link as proof. |
| Identity, owner and destinations | Workspace administrator | Trusted actor roles and permitted provider/line/thread bindings | Keep delivery disabled; an owner-version counter is not a person. |
| Credentials | Account owner/maintainer | Backend or provider-managed secret storage; no credentials in case text, client bundles or screenshots | Provide setup guidance without requesting secrets in chat. |
| Budget and usage | Maintainer/runtime provider | Explicit supported limits, usage units, reporting semantics and unknown state | Do not promise a hard monetary ceiling or display zero usage. |
| Devices and browser profiles | Validation owner | Named emulated/physical environment and accessibility test tools | Restrict claims to exercised platforms. |
| Evaluation cases and reviewers | Product/release owner | Representative reports and people able to judge whether a handoff is useful | Report demo evidence separately; no invented adoption or success rate. |

RP-01 still needs the approved live application, build/account context and intended runtime to be established for an actual test. This protocol does not choose credentials, connect accounts, send a message or perform a browser action on that application's behalf.

## Record and command contracts

These are implementation requirements, not new endpoints already available in Relay.

| Record | Required meaning | Rejection or uncertainty rule |
| --- | --- | --- |
| Intake | Trusted origin, stable request identity, reported/expected behavior, resolved project | Conflicting reuse of identity is not a second interpretation of the same request. |
| Run context | Case revision, build/environment, assignment, permitted sources and configuration | Changed dependencies prevent fresh execution; old results remain historical. |
| Investigation event | Stable producer identity, run/case scope, producer/server sequence, capture/receipt times, typed payload | Same identity/different payload is a conflict; late events do not regress terminal run state. |
| Artifact | Action provenance, storage reference, digest, media type, target context, access and availability | An inaccessible or incomplete artifact cannot support a published observation. |
| Finding | Statement kind, source events, uncertainty, review and supersession | Hypothesis, observed symptom, causal explanation and verified patch remain separate claims. |
| Decision | Specific question/action, permitted actor, case/run context, expiry, recorded answer | Wrong actor, expired request or changed scope cannot approve execution. |
| Memory publication | Reviewed source, applicability, status and correction reason | Retrieval rechecks the authoritative source; indexed text never grants authority. |
| Delivery intent | Reviewed content/version, permitted destination, event identity and attempt history | Provider acceptance is delivered; timeout after possible acceptance is uncertain. |

The useful small operations are `submit_report`, `ingest_run_event`, `read_run_events`, `review_finding`, `resolve_decision`, `retrieve_context`, `prepare_handoff` and `reconcile_delivery`. Names describe the proposed contracts; final HTTP route names can be chosen during implementation.

Every write must resolve workspace and actor from trusted authentication, validate the expected source context, deduplicate where appropriate, commit state and dependent intents together, and return the persisted outcome. Commands cannot trust case text or a client-supplied workspace label as authorization.

### Critical invariants

1. Raw investigation progress does not use the human-observation endpoint. That endpoint changes case revision and labels the observation human-recorded; the running investigation would invalidate itself.
2. Event ingestion and cursor advancement commit together. Review, case promotion and dependent memory invalidation also commit together.
3. A frozen run does not silently absorb another client's execution-relevant edits. New reviewed context begins a deliberate new stage or run. Theme and motion preferences do not change execution configuration or invalidate the run.
4. Run deduplication, tool-action deduplication and message deduplication are separate responsibilities. An unknown side effect is not safe to repeat without a provider-supported reconciliation or idempotency contract.
5. Closing a client or switching applications does not prove execution stopped. Client visibility and runtime status stay distinct.
6. A stop request is not stop confirmation. A queued message is not delivered. A delivered update is not read. A completed run is not a verified finding.
7. New evidence may supersede a conclusion while preserving its earlier support and review history.
8. Source access revocation applies to evidence views, retrieval, handoffs and future delivery, not just a memory index.
9. Missing cost and unsupported capabilities remain unknown/unavailable. UI polling cannot generate usage or duplicate events.

## Dashboard contract

The dashboard answers six user questions. These requirements apply inside the existing PaceUI layout; the [benchmark](research/orca-warp-dashboard-benchmark.md) explains the source patterns and proposed adaptations.

| ID | User question | Visible content and action | Acceptance scenario |
| --- | --- | --- | --- |
| D-01 | What needs me now? | Needs your decision queue, reason, case, due/expiry when real, primary action | Among active and completed cases, locate the unresolved clarification without opening unrelated cases. |
| D-02 | What is happening? | Current objective, last confirmed action/time, execution state and connection freshness | Losing the client connection shows stale/unknown status rather than fabricated progress; reopening does not start another run. |
| D-03 | What can I trust? | Finding beside its evidence, build/environment, provenance and uncertainty | Open the actual artifact from the claim; unavailable evidence is explicit; raw model text never appears as verified. |
| D-04 | What should happen next? | Answer, approve/decline a specific action, review finding, request check, or prepare handoff | Each action changes persisted state or names the missing prerequisite; no decorative action buttons. |
| D-05 | What changed since last time? | New evidence, revised finding, invalidated memory and pending decisions | Return after a correction; identify what changed and inspect both old and current claims. |
| D-06 | Can I continue elsewhere? | Stable case/decision links, current packet, phone-safe summary | Open the same case on another authorized client; a resolved/expired decision cannot be acted on again. |

Suggested desktop composition:

```text
Overview                         Workspace readiness / Help / Preferences
Needs your decision             Investigating              Ready for review
Case + reason + next action     Last confirmed step        Result + evidence

Selected case
Objective / reported impact / build / status / primary action
Timeline and evidence           Findings and pending decision
Related memory and corrections  Handoff / owner delivery state
Technical details               Usage / recovery information
```

At phone widths, use a single vertical flow: pending decision, current result, evidence, history. Do not compress a developer console into several narrow columns. Developers retain details and export; business users see plain-language states and next actions. Help and accessibility preferences remain discoverable.

An inbox notification links to an exact case event or decision. Deduplication prevents repeated notifications from polling or delivery retries. Resolved notifications show the resolution. Motion may mark a real transition but never imply progress that has not occurred.

Loading, no cases, no runtime, denied permission, queued, stale context, missing artifact, uncertain action and uncertain delivery are required designed states. The dashboard must distinguish them in text and preserve a useful next action.

## Acceptance matrix

| Test ID | Scenario | Expected result | Areas |
| --- | --- | --- | --- |
| T-01 | Real known failure and same check on healthy build | Record both actual outcomes and evidence without inventing cause or deployment | RP-01, RP-03, RP-04, RP-12 |
| T-02 | Duplicate intake and echoed outbound message | One case/run per intended request; Relay's reply does not create a new case | RP-02, RP-06, RP-10 |
| T-03 | Replayed, conflicting, out-of-order and >128 events | Complete ordered history with deduplication/conflict reporting; no state regression | RP-03 |
| T-04 | Review/build change races with running agent or publication | Current evidence/memory remains consistent; old-run results retain their actual provenance | RP-04, RP-05, RP-06 |
| T-05 | Similar symptom but different cause; revoked source | Prior memory is only a lead; invalid sources excluded before use | RP-05 |
| T-06 | Tool action happens but acknowledgment is lost | Preserve unknown outcome; reconcile before repeating the side effect | RP-06, RP-14 |
| T-07 | Wrong sender, forwarded reply, expired decision, changed target | No action approved; correct user sees the reason and current request | RP-02, RP-10 |
| T-08 | Provider accepts update before Relay loses response | Recover one intended delivery where supported; otherwise show uncertainty without blind resend | RP-10, RP-14 |
| T-09 | App switch, phone disconnect, client close and backend restart | No inferred user fault or duplicate dispatch; saved case/evidence survives | RP-06, RP-07, RP-14 |
| T-10 | Budget boundary, absent usage and replayed usage | Enforced limits respected where supported; missing data explicit; no double accounting | RP-13 |
| T-11 | Keyboard, assistive technology, mobile keyboard, zoom and reduced motion | Complete primary workflow and recover from errors without lost focus, content or input | RP-07, RP-08, RP-09 |
| T-12 | Cross-workspace artifact, case, memory or destination reference | No unauthorized read, association, mutation or delivery | RP-02, RP-03, RP-05, RP-10 |
| T-13 | Mobile-web bug on emulated profile; later physical device | Capture actual conditions; label execution type; do not infer native-device support | RP-11 |
| T-14 | Another person installs and handles a report | Intended outcome works with documented setup; limitations and measured effort/cost recorded | RP-15 |

Also exercise C-01 through C-08 from the [configuration contract](research/vercel-configuration-benchmark.md), including concurrent settings saves, stale connection checks, changed recipients, read-only managed settings, and UI preferences that must not interrupt execution.

Existing tests are a baseline, not a substitute for these scenarios. Add tests for meaningful new behavior through the module's public interface. Use isolated test data for mutations. For interface/workflow implementation run `make check`; rebuild desktop when shipping shared-client changes. Native accessibility and actual provider delivery need separate verification.

## Delivery gates

| Gate | Must be demonstrated | Work enabled next |
| --- | --- | --- |
| G0 · Live capability | Real action receipt and a checked channel integration path; precise blockers for unavailable resources | Finalize actual adapter/event contracts. |
| G1 · Evidence and review | Durable journal, attributable findings, correct review promotion and current handoff | Integrate the case-centered dashboard and contextual help. |
| G2 · Automatic case workflow | Bounded admission, permission/clarification, accessible decisions, interruption recovery | Enable the report-triggered experience in a controlled installation. |
| G3 · Owner loop | One authorized phone channel, real intake/result, durable outbox, correction and memory demonstration | Advertise the complete report-to-evidence-to-owner workflow. |
| G4 · Release readiness | Fresh installation, affected failure matrix, accessibility evidence, cost accounting and claim audit | Release to the stated scope and start the proposed pilot evaluation. |
| G5 · Device expansion | Mobile-web and physical/native acceptance evidence for each claimed platform | Expand supported investigation targets. |

G0 is a compatibility spike, not a demand to finish the channel system before evidence work. Independent work can proceed against explicit contracts; integration cannot be claimed complete until the relevant gate has evidence.

## First implementable slice

**RP-01/RP-03: one authorized action becomes one durable receipt.**

- Inputs: approved test application/build/account; compatible dedicated Hermes/Latch runtime; an agreed observational action; database and artifact location; existing permission and time bounds.
- Output: one actual action receipt with run/action identity, timestamp, observed result, environment and accessible artifact when captured.
- Backend acceptance: store it independently of the case revision; duplicate ingestion is harmless; restart retains it; no fabricated human attribution; no automatic memory publication.
- UI acceptance: the case shows the received action and actual evidence availability. Missing receipt, permission or artifact has a specific state. Use the selected template.
- Recovery acceptance: lost acknowledgment remains uncertain until reconciled; no second external action is dispatched as a convenience retry.
- Evidence record: exact tested versions/build, permission scope, actual case/run/receipt identifiers, checks run, observed outcome and unresolved limitations. Store sensitive artifacts outside the public repository.

This slice is ready to implement once its live resources are supplied or confirmed. It is not completed by adding another chart, inventing a receipt, or treating the protocol fixture as a browser investigation.

Resolve three adapter choices during the spike: which authenticated transport supplies stable event identities and ordering/cursors; how revoked source access is enforced when reading retained context snapshots; and which runtime controls actually enforce continuation and budgets. Record the observed provider behavior and chosen contract before marking G0 accepted. Unsupported behavior remains an explicit capability limit.

## Benefit record and release claims

For each evaluated case, record active human minutes, elapsed time to an actionable result, accepted handoff or actionable blocker, avoidable clarification rounds, actual/unknown cost, and evidence correctness. Retain unsuccessful cases in the denominator. Keep adoption pilots separate from controlled demonstrations.

Use the existing proposed pilot and chronological memory evaluations from the [depth review](PRODUCT-DEPTH-REVIEW.md). Dashboard usability trials must record participants, tasks, assistance, wrong actions and observed completion time; the benchmark is not a claim that Relay outperforms Orca or Warp.

Before changing a capability label to available, attach the evidence that matches its scope. “Runtime reachable,” “action exercised,” “receipt saved,” “result reviewed,” “handoff ready,” “provider accepted update,” and “user acted” are different milestones.
