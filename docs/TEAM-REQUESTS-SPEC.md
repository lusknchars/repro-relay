# Team requests through Plow

Status: proposed implementation specification, September 14, 2026. This document does not claim that team delegation, recipient agents or new Plow destinations are implemented.

## Outcome

From a work item, a person can delegate a specific outcome to one teammate, review the context being shared, send an approved notification through an authorized Plow destination, and receive an attributable result on the original record.

The primary action is **Delegate to teammate**. Users should not need to copy terminal commands, open an agent profile, or assemble context manually to perform an ordinary delegation.

Example: an owner asks Maya to investigate an export failure. Maya receives a short notification, opens the request, accepts it and connects an agent if desired. The agent receives only the approved context and submits findings. The owner reviews those findings in Work. Neither delivery nor result acceptance means the bug is fixed.

## Existing foundation and gaps

| Area | Existing behavior | Required addition |
| --- | --- | --- |
| Work | Cases, revision-bound runs, evidence, handoffs and reviews | A durable team request linked to one case |
| Team | One shared Hermes conversation and member invitations | Request list, request-specific discussion and recipient actions |
| Agents | Hermes catalog and Architecture workflow briefs | Request-level skill selection and recipient-bound agent access |
| Plow | Approved delivery to the configured, granted owner chat | Verified recipient-to-destination binding and an in-app dispatch path |
| Context | Scoped chat/call tools and frozen investigation context | Approved request snapshots and request-only result tools |
| Events | Durable local Reach metadata events | Request events with recipient-aware authorization |

Evidence: [local access and chat](LOCAL-ACCESS-AND-CHAT.md), [team communication](TEAM-CALENDAR-CALLS.md), [Plow adapter](../integrations/plow/README.md), [channel implementation](../crates/relay-api/src/channels.rs), and [Reach event reader](../crates/relay-api/src/reach/events.rs).

The current Plow adapter explicitly rejects group chats and peer agents. A saved phone number or Relay invitation does not extend its provider grant. Arbitrary teammate delivery is a release dependency, not a flag to enable in the existing adapter. Verify supported provider authorization before implementation; preserve the existing rejection behavior until a tested replacement exists.

The current local installation is also not a remote team service. Cross-device requests require a reachable HTTPS deployment with supported administrator provisioning and authenticated recipient sessions. Do not send loopback links to remote recipients or silently publish a tunnel.

## First-release scope

- One existing teammate, one case and one authorized destination per request.
- Owner-only creation, send approval, cancellation and result review initially. Existing restricted teammates may accept and answer requests assigned to them without gaining general write or execution rights.
- Human responses work without an agent. One recipient-authorized agent connection may assist with an accepted request.
- Three built-in request skills: Investigate, Review evidence and Prepare a fix plan. The last produces a proposal, not code execution.
- An immutable approved context snapshot, one notification delivery chain and versioned result submissions.
- Request history appears in Work and Team. Reach lists actionable requests without creating duplicate todos automatically.

Not included: broadcast, group chat, agent-to-agent Plow messaging, autonomous reassignment, automatic reminders, custom skill installation, per-agent memory isolation, automatic code changes, merge/deployment, meeting capture or a new model scheduler. The whole Team page redesign is not required to ship this request workflow.

## User experience

### Delegate from Work

Open **Delegate to teammate** beside the selected work item's actions. A single drawer contains:

1. **Teammate**: existing member, identity and current eligibility. Do not infer identity from a phone number.
2. **Requested outcome**: a required, editable instruction and completion condition.
3. **Skill**: an inline selector with a short purpose. **View instructions** reveals the exact versioned instructions and tool requirements without leaving the drawer.
4. **Shared context**: suggested case summary and evidence references. The sender explicitly includes or excludes each item and can inspect the exact content.
5. **Delivery**: destination identity, authorization status and the exact notification preview. The default notification contains a short request summary and authenticated link, not the evidence bundle.

**Save draft** never sends. **Approve and send** is enabled only when recipient, context, permissions, expiry, destination grant and shared link checks pass. It approves the displayed message and context together. It does not approve a model run or code action.

Context assembly is deterministic by default and requires no model call. An optional future writing assistant must not silently change approved content.

If delivery setup is missing, retain the draft and offer **Connect destination** with guided setup and a real check result. A copyable request link is a separately labelled manual-sharing fallback after context approval. Copying does not mark the notification delivered. CLI commands remain in a collapsed Developer setup section.

### Receive and respond

The notification opens the request, not the entire case. After signing in, the assigned teammate sees the outcome, skill, approved context, expiry and sender. A forwarded link grants no access to another identity.

Actions are **Accept request**, **Decline**, and **Ask a question**. Acceptance does not start a model. After acceptance, **Use my agent** offers supported host setup, identifies the requesting agent and explains the limited read/write scope. Unsupported hosts show a specific setup limitation; a Copy command is not a successful connection.

The recipient can submit a human result without connecting any host. Agent results show the agent identity and sponsoring teammate; they never impersonate that teammate.

### Track and review

Work shows a compact request card with recipient, skill, progress, delivery status and next action. Team provides searchable request rows and a selected request thread. The context inspector shows the exact approved snapshot and freshness, not a silently refreshed full-case view.

The sender can **Accept result** or **Request changes** with a reason. Acceptance closes the request, but does not mark tests passed, publish memory, authorize repair or close the case automatically. Those remain existing, separate review actions.

Use the current color, type, spacing and glass-material preferences. At narrow widths, stack request/thread/context with labelled navigation. Preserve drafts on failed writes; restore drawer focus on close; announce pending and failed actions accessibly.

## Domain records

All records carry workspace scope, server-derived actor identity and timestamps. Client-supplied actor names are display text, never authorization.

| Record | Required contents |
| --- | --- |
| Team request | ID, case ID, sender, recipient membership/version, outcome, completion condition, skill ID/version, snapshot ID/hash, destination binding/version, version, expiry, lifecycle state |
| Context snapshot | Case revision, build and owner version; approved text; allowlisted evidence IDs and content hashes; source attribution and trust labels; skill instructions/hash; sender exclusions |
| Context approval | Request version, snapshot hash, recipient/version, destination/version, notification body hash, expiry, approving identity and time |
| Destination binding | Recipient identity, provider, line/chat identifiers, provider authorization evidence, version, active/revoked state and check time |
| Request agent grant | Request and recipient, agent identity, snapshot version, allowed operations, expiry, revocation and last successful access |
| Result submission | Stable submission ID, request/snapshot/skill versions, human or agent author, summary, findings, evidence references, limitations and revision |
| Request event | Ordered ID, request ID, actor, event type, record version and timestamp; metadata only in notification feeds |

Reuse existing delivery records, claims and receipts where their contracts fit. Do not create a second sender that bypasses the channel approval path. Existing locally supplied adapter identities must not become authenticated team identities merely by copying their fields.

Suggested initial limits: 4,000 characters each for outcome and completion condition, 20 evidence items and 128 KiB of approved text per snapshot, 32 KiB per result, 20 open requests per recipient, and 100 rows per paginated read. Return explicit size errors; never silently truncate approved context. Binary files remain out of the first version; expose only supported, authorized evidence through bounded readers.

## State and concurrency

Request lifecycle:

`draft → offered → accepted → result_submitted → completed`

- `offered` means context approval committed and the request is available to its recipient. It does not mean Plow delivered a notification.
- The recipient may decline an offered request. The sender may cancel any nonterminal request. Expiry closes any nonterminal request at its deadline.
- The sender may request changes from `result_submitted`, returning the request to `accepted` while retaining the earlier result and review.
- Declined, cancelled, expired and completed requests are terminal. Follow-up work creates a new linked request.
- Questions and replies are appended messages, not lifecycle transitions. There is no inferred “working” status based on an agent heartbeat.

Delivery is separate: `not_requested`, `pending`, `dispatching`, `delivered`, `confirmed_not_sent`, `uncertain`. The UI uses the canonical adapter state; these labels must not replace existing delivery retry rules. A manual link share can yield an accepted request while notification delivery remains unconfirmed.

Every mutation requires an expected record version and idempotency key. Same key and same body return the original result; same key with different content conflicts. State changes, approvals and event records commit atomically. Concurrent accept, cancel, expiry and result submission have one transactionally ordered outcome.

Changing recipient, skill, outcome, snapshot, destination, body or expiry invalidates an unsent approval. After offering, these fields are immutable: cancel and create a linked replacement. Discussion does not mutate instructions. Reassignment never transfers an old recipient's credential.

## Context and agent security

- Suggested context is not authorization. Only approved snapshot content can leave Relay through the request grant.
- Recipient read access is the intersection of current membership, request assignment, approved evidence scope and any source-specific restrictions. A request-only agent credential cannot list workspace cases, knowledge, members or the shared Hermes inbox.
- Existing teammates may already have broader workspace visibility. This feature limits request-agent access; it must not claim to make those human accounts case-isolated.
- A notification link contains an opaque request identifier, never a bearer credential. Agent grants require authenticated recipient consent and secure credential transfer. Store server-side credential digests, keep secrets out of URLs/logs and redact them from diagnostics.
- Proposed default request expiry is seven days; agent grants last at most 24 hours and never outlive the request. Renewal requires fresh authenticated consent and current access checks.
- Removal, grant revocation, cancellation or expiry denies subsequent tool access. Completion denies further agent writes and revokes its grant. Revocation cannot erase information already downloaded by a host; disclose that limitation.
- A changed case revision marks the snapshot stale without rewriting it. Results retain the snapshot version they used. Review must disclose staleness and require explicit acknowledgement before accepting an otherwise valid historical result.
- Revoked evidence becomes unreadable even through old snapshots. Affected requests become blocked for further context use; replace or cancel them. Preserve audit metadata, not revoked content in an agent-readable duplicate.
- Treat reports, messages and evidence as untrusted content. Separate skill instructions from source text. Source text cannot grant tools, widen scope or override human approval.
- A request skill describes instructions, expected output and permitted context operations. It does not grant shell, repository, browser, provider or model access. The host may have independent tools; Relay cannot claim to sandbox them.
- Record the accepted skill version in every execution context and result. Changes to the built-in catalog affect future requests only.

## Plow delivery and reply contract

Before sending, validate current membership, request approval/hash, snapshot availability, destination version and provider grant. The configured grant must cover the exact recipient destination. An owner-chat credential is insufficient for an unrelated teammate.

Persist an exclusive send claim and recovery receipt before contacting Plow. Only a newly committed claim permits an attempt. Provider acceptance plus a valid provider message ID establishes delivered status, not a read receipt or request acceptance.

Timeouts, malformed responses and lost confirmations become uncertain. Do not automatically resend uncertain attempts. Reconcile the original attempt using available provider evidence; if that cannot establish an outcome, keep the uncertainty visible. Confirmed-not-sent attempts may be retried only through the canonical retry contract and fresh authorization checks. Do not promise exactly-once delivery if the provider cannot enforce it.

Cancellation prevents new claims. An already dispatched message may still arrive; its link must show the cancelled state and deny new agent access. Persist late receipts without reopening the request.

First-release replies and results arrive through authenticated Relay UI or request tools, not free-form Plow text parsing. Notification delivery is Plow's job; request context and result exchange are Relay's. Importing phone replies later requires sender verification, provider-message deduplication and unambiguous request correlation. Phone prose must never count as execution approval.

## Proposed API and tools

Names below are new contracts, not existing endpoints. Implement them with the existing Rust workspace transaction and authorization conventions.

| Operation | Proposed route |
| --- | --- |
| List permitted requests | `GET /api/v1/team-requests?case_id=&cursor=` |
| Create a draft | `POST /api/v1/cases/{case_id}/team-requests` |
| Inspect or edit a draft | `GET/PATCH /api/v1/team-requests/{id}` |
| Generate the exact approval preview | `POST /api/v1/team-requests/{id}/preview` |
| Approve context and optionally queue delivery | `POST /api/v1/team-requests/{id}/offer` |
| Accept, decline or cancel | `POST /api/v1/team-requests/{id}/transitions` |
| Append a question or reply | `POST /api/v1/team-requests/{id}/messages` |
| Submit an immutable result revision | `POST /api/v1/team-requests/{id}/results` |
| Accept a result or request changes | `POST /api/v1/team-requests/{id}/reviews` |
| Issue or revoke recipient agent access | `POST/DELETE /api/v1/team-requests/{id}/agent-grant` |

Offer commits the request, its approval, optional pending delivery and metadata event together. A managed dispatch worker consumes delivery claims; it does not run models. The exact worker placement must respect the current Plow adapter's loopback-only Relay boundary. Supporting a remote HTTPS service needs a reviewed adapter change, not disabling origin checks.

Request-only agent tools:

- `request_context`: approved instructions and snapshot manifest for the granted request.
- `request_evidence`: bounded content for an allowlisted evidence ID.
- `request_question`: append an attributed question with a stable message ID.
- `request_submit_result`: append an attributed, snapshot-bound result using a stable submission ID.

No approval, delivery, arbitrary URL fetch, workspace search, shell or identity-management tools are included. Agent submissions cannot choose a human author or change their recipient binding. A host connects voluntarily; tool availability is not proof that it is running a model.

Publish metadata events for offer, acceptance, decline, cancellation, expiry, delivery change, question, result and review. Commit them with their source change. Do not expose the current workspace-wide Reach event stream to request-only credentials; provide a filtered request stream or polling endpoint with authorization on every read and replay. Consumers resume by cursor and deduplicate event IDs.

## Acceptance criteria

1. An owner completes delegation from Work without opening the Agents detail page or using a terminal. Missing setup retains the draft and explains the actual blocker.
2. Preview lists exactly what the recipient agent can retrieve. Excluded evidence, secrets, unrelated cases and unreviewed memory are not added implicitly.
3. A member without owner permissions cannot create or send requests by bypassing the UI. An assigned restricted teammate can accept and submit a result without gaining investigation-start permissions.
4. A forwarded request link and a grant from another request or workspace fail access checks. Public guest workspaces cannot use local Plow credentials.
5. Duplicate offer clicks, concurrent workers, restarts and lost HTTP responses produce one logical offer and no unauthorized repeat provider attempt.
6. Fixtures cover wrong destination, expired grant, membership removal, changed approval, provider timeout, malformed receipt and late acceptance. Unknown delivery never becomes success or an automatic resend.
7. An agent reads the approved skill/context and submits a result through the scoped tools. Unsupported tool calls and attribution spoofing fail server-side.
8. Results retain source versions and author identity. Human review preserves earlier submissions. Completion cannot claim a verified fix, publish knowledge or approve repair.
9. Revocation and expiry deny new reads/writes. Source changes are visibly stale; evidence revocation blocks old content. Cancellation during dispatch preserves the actual delivery receipt.
10. Refresh preserves requests, drafts and reviews. Both themes and narrow layouts retain all actions, focus handling and readable status labels.
11. A live release test demonstrates an authorized teammate receiving a Plow notification, opening it from another device, granting an agent access and returning a result. Save redacted receipts. Fixture success alone does not meet this gate.

## Delivery sequence and release gates

1. Build durable requests, snapshots, permissions and human result/review flows. Ship in-app/manual-link mode only with explicit delivery status.
2. Add built-in request skills and request-only tools. Exercise grants, expiry, revocation and host attribution through fixtures and a supported host.
3. Verify a supported Plow recipient authorization path and deploy authenticated HTTPS access. If unavailable, keep Plow teammate delivery blocked and document the supported recipient scope.
4. Connect the in-app approval to the managed delivery worker, recovery receipts and request events. Run adversarial and concurrent-send tests before live delivery.
5. Validate the complete live loop with consenting participants, then enable it for eligible workspaces. Readiness depends on receipts and access tests, not a green generic connection badge.

Run `make check`, rebuild the desktop app and test the affected UI for implementation milestones. Track delivery failures, uncertain attempts, time to acceptance, returned results and review outcomes separately. Do not log context bodies or credentials as operational telemetry. No real delivery, deployment, account creation or model execution is authorized by writing this spec.
