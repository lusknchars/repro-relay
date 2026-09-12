# Repro Relay memory and agent architecture

Repro Relay should retain verified observations, reusable reproduction procedures, and confirmed fix outcomes. Relevant past cases can then help an investigator ask better questions and give a repair agent a precise task. Improvement means better retrieval and reusable procedures, measured against a baseline. It does not require training model weights.

This design extends the [initial build brief](./repro-relay-build-brief.md). It is a proposed architecture, not implemented software. Mem0 is the assumed interpretation of "memo"; the records and handoff format do not depend on that vendor.

The proposed flow is:

```text
Plow Chat / Slack / GitHub
             |
     Intake and identity
             |
     Case workflow module <--------> Evidence and case database
             |                                  |
     Scoped memory retrieval            Artifacts and event history
             |
     Hermes investigation
             |
     Versioned repair packet -----> Engineering ticket
             |
     Optional repair worker
             |
     Independent verification
             |
     Confirmed outcome recorded
             |
       Memory publication

Case transitions -> durable delivery queue -> approved channel updates
```

Keep these as modules within one application initially. They do not require separate servers. Start with a Hermes runtime, a Python workflow module, SQLite in a persistent volume, and a directory for restricted evidence artifacts. One team owns each installation. Use Mem0 as an optional retrieval adapter called through the workflow module. Multi-channel access to that installation does not require a shared database across unrelated teams.

A hosted product can move authoritative records to PostgreSQL and artifacts to object storage when several workers or installations need shared team state. PostgreSQL supports row security, but application roles and ownership must be configured and tested correctly.[1] pgvector supports vector search alongside PostgreSQL's full-text search if an in-database retrieval implementation becomes preferable.[2] Do not operate Mem0 and a second custom vector index for the same records during the hackathon.

| Module | Small interface | What the implementation owns |
| --- | --- | --- |
| Case workflow | `submit_report`, `record_result`, `get_case` | Status transitions, request identity, version checks, leases, and event history |
| Evidence | `record_artifact`, `read_evidence` | File access, hashes, provenance, redaction, and retention |
| Case memory | `retrieve_context`, `publish_verified_case`, `revoke_case_memory` | Scope filters, retrieval, freshness checks, indexing, and deduplication |
| Repair handoff | `build_packet`, `accept_patch_result` | Required evidence, allowed work, base revision, and patch metadata |
| Verification | `verify_candidate` | Original acceptance checks, regression tests, observed outputs, and exact revision |
| Delivery | `enqueue_update`, `reconcile_delivery` | Recipient rules, retries, channel-specific views, and duplicate prevention |

The interfaces are conceptual contracts, not promised SDK calls. Keep implementation choices behind them. The case-memory adapter is a real variation point because the initial fallback is structured local lookup and the optional implementation is Mem0.

Use four kinds of retained information:

| Kind | Example | Treatment |
| --- | --- | --- |
| Case evidence | On build X, the export action produced no download after changing the date range | Preserve the observation and its source; append corrections |
| Project context | Export UI belongs to the reports module; tests use a dedicated account | Versioned configuration with an owner and review date |
| Reproduction procedure | Sign in as a test analyst, change the range, then export | Reuse only when preconditions and target version remain applicable |
| Outcome knowledge | Patch Y passed the original failing test on revision Z | Record the verification scope and links; do not imply deployment |

Also preserve unsuccessful attempts and disproven hypotheses inside the case. A failed fix may tell the next investigator what was already tried. It must be labeled as rejected guidance, with the rejection reason, so retrieval cannot present it as a recommended correction.

Every memory entry should point to an authoritative case revision. Suggested fields are `memory_id`, `team_id`, `project_id`, `case_id`, `case_revision`, `kind`, `statement`, `evidence_ids`, `verification_status`, `applicability`, `last_verified_at`, and `supersedes_id`. Applicability records the code revision, affected environment, relevant dependency versions, feature flags, and account role when known. Unknown values stay unknown.

Maintain distinct assertions for an observed symptom, a suspected cause, and a verified patch result. A patch passing the regression test does not by itself prove that the agent's causal explanation is correct. An issue closure does not prove a patch passed, and a verified patch does not prove production deployment. Each assertion needs its own supporting evidence.

Mem0 is a reasonable candidate. Hermes documents Mem0 among its external memory providers, while Mem0 documents metadata filtering and direct import of supplied facts.[3][4][5] However, Hermes' general provider lifecycle includes automatic conversation syncing and context retrieval. That is useful conversational memory, but it is not the verification policy for engineering knowledge.

For this product, expose explicit memory operations through the case-memory module. Publish short, verified summaries with source identifiers. Direct import with `infer=False` avoids another extraction step when the application already has the desired summary, but it does not validate that summary and does not deduplicate it automatically.[5] The authoritative database decides whether an entry is publishable. Use a stable case-revision key and reconcile writes after ambiguous network failures.

Avoid treating `user_id` and `agent_id` as the team authorization model. Mem0 documents attribution behavior that can differ by message speaker.[6] Derive the allowed team and project from authenticated installation configuration. Enforce scope on every request in application code, require matching metadata at retrieval, and recheck each returned source record before supplying content to an agent. Metadata filtering alone is not an authorization guarantee.

Pin one Mem0 mode and version. Its platform, self-hosted, and open-source variants should not be assumed to share every operation or filter behavior. Current documentation even distinguishes logical filter handling between search and listing for some stores.[4] A small integration check must cover writing, searching, updating, deleting, and filtering against the actual selected configuration.

The retrieval path should work as follows:

1. Establish the requesting team's project and artifact permissions from trusted configuration.
2. Find exact references first, including issue IDs, normalized error strings, affected routes, and known test names.
3. Retrieve a small set of semantically related cases from the same permitted scope.
4. Load the authoritative case revisions and remove revoked, stale, inaccessible, or superseded material.
5. Rank compatible cases by evidence quality, applicability, and relevance. If more than ten candidates remain, evaluate whether reranking improves results.
6. Return at most a few compact cases, each with evidence links and an explicit reason it may be relevant.
7. Let the investigator test applicability against the current behavior. Similarity is a lead, not proof of the same root cause.

For example, a previous CSV-export case might have involved a stale date-filter dependency. A new report about exporting after changing account could share the same symptom but have a permission failure. Retrieval should suggest both the relevant earlier test and the differences to inspect. It should not instruct the repair agent to copy the old patch.

Use one shared case state, with separate worker roles. The investigator can read the permitted app and produce observations. The optional repair worker can edit an isolated checkout for an explicitly approved repair task. The verifier runs the original checks on the proposed revision and records results. The reporting module formats case events for people and does not invent technical conclusions.

These roles can run sequentially. Separate prompts or agent instances alone do not make verification independent. Preserve the original acceptance checks outside the repair worker's editable scope, execute them against the exact base and patched revisions where practical, and record the outputs. Review any proposed changes to tests separately. This prevents a patch from appearing successful simply because the repair worker weakened the test.

The versioned repair packet should contain:

```yaml
schema_version: 1
case_id: BUG-104
case_revision: 3
repository: configured-repository-id
base_commit: exact-commit-sha
target_environment: staging
observed:
  summary: Export produced no download after changing the date range
  evidence_ids: [EV-11, EV-12]
expected:
  summary: Export a CSV for the selected range
  source: confirmed-product-requirement-id
reproduction:
  account_role: test-analyst
  preconditions: [seeded-report-data]
  procedure_id: RP-8
  test_command: configured-regression-test-command
related_cases:
  - case_id: BUG-72
    relevance: Similar export symptom; different trigger
    status: verified-on-prior-revision
hypotheses:
  - statement: Filter state may not reach the export handler
    status: unverified
work_constraints:
  allowed_paths: [src/reports, tests/reports]
  no_dependency_changes: true
  delivery: patch-and-test-results
acceptance:
  - Original reproduction fails on base and passes on patch
  - Existing export regression checks pass
  - No unrelated changes
```

This is illustrative data. Real packets must resolve evidence IDs, commands, paths, and commit identifiers before a worker starts. If code access is unavailable, omit localization claims and deliver an evidence-backed engineering ticket. The initial product can generate the packet without executing repairs.

An application-controlled transition publishes reusable knowledge only after verification. The workflow is `hypothesis -> candidate patch -> verification result -> eligible memory`. Failed verification records the attempted approach and its outcome. Human feedback can correct a case and supersede its indexed summary. A rollback or reopened regression can revoke a fix recommendation without erasing the historical observation that a particular test once passed.

Recheck a retrieved entry's status before it reaches the model, even if the search index is behind. On deletion, remove the underlying artifacts and derived indexed content according to the team's retention policy; do not leave stale embeddings accessible after source access is revoked. An index outage should fall back to current case evidence and exact local lookup. Investigations should remain useful when semantic memory is unavailable.

For multi-channel reporting, store one case identifier and a set of authorized channel bindings. An event such as `reproduction.completed` updates the case and adds a delivery entry in the same database transaction. A worker delivers that event to the configured destinations. Store the external message ID so retries can edit or reconcile an existing update.

| Destination | Appropriate content |
| --- | --- |
| GitHub issue | Full internal reproduction evidence and the versioned repair packet |
| Slack engineering thread | Current result, owner, next action, and link to the case |
| Plow Chat | Request status and a concise clarification or approval request |
| Customer-facing conversation, later phase | Reviewed customer-safe wording and confirmed availability only |

Use an idempotency key containing the event ID and destination. Expect at-least-once processing; reconcile uncertain deliveries instead of promising exactly-once delivery across third-party systems. Preserve per-case ordering, suppress obsolete status updates, and track bot-origin messages so an outgoing update cannot re-enter intake as a new report. Match reports across channels only with explicit identifiers or human-confirmed links. Two similar symptoms may be different bugs.

Human and worker permissions are enforced in the application. A channel summary must not reveal evidence unavailable to its recipients. A model-suggested recipient or destination must pass configured routing rules. Reading a bug report, retrieving a memory, or seeing text on a website never grants permission to run commands or send messages. The repair worker receives task-scoped tools and should not hold the credentials used for customer communications.

The hackathon slice should add verified case history, exact retrieval, one optional Mem0 retrieval path, and a repair packet to the original investigation flow. Ship through Plow Chat and GitHub first; add Slack after the same case remains consistent across those two destinations. Autonomous patch execution and a separate verification worker are a second milestone. This sequence tests the memory benefit without making an entire repair platform a submission dependency.

Evaluate at least twenty diverse cases before calling the memory feature ready. Include related symptoms with different causes, stale fixes, contradictory feedback, missing evidence, revoked records, cross-team queries, and repeated channel events. Split evaluation chronologically so a case's own outcome and future fixes cannot enter its retrieval context. Compare no historical memory, exact lookup, and Mem0-assisted retrieval with the same model and execution budget.

| Metric | What to measure |
| --- | --- |
| Retrieval relevance | How many of the top five cases engineers judge useful; whether known relevant cases are found |
| Handoff usefulness | Fraction of packets accepted without another clarification round |
| Evidence correctness | Unsupported reproduction, root-cause, and fix claims, counted separately |
| Reproduction effort | Active human time and agent runtime until a useful observation |
| Repair usefulness, later | Original failing check passes on the patch without weakening checks |
| Isolation and freshness | Cross-team disclosures, inaccessible sources, and revoked recommendations returned |
| Delivery consistency | Duplicate messages, duplicate cases, stale updates, and unreconciled sends |

Require zero observed cross-team disclosures and false verified-fix claims in the test set before expanding pilots. Passing twenty cases is a release gate for this experiment, not proof of general reliability. Adopt semantic memory only if it improves handoff quality or effort enough to justify its cost and failure modes.

An illustrative monthly memory budget for 100 investigations is 200 published summaries of 300 tokens each, plus 100 retrieval queries of 100 tokens each: roughly 70,000 embedding-input tokens. Returning five 250-token memories once per investigation adds roughly 125,000 model-input tokens. If each case uses one summarization call with 1,500 input and 300 output tokens, add 150,000 input and 30,000 output tokens. Repeating retrieval every agent turn would increase these totals, so retrieve once per investigation stage unless new evidence changes the question.

These are workload assumptions, not observed usage or a dollar quote. Compute memory cost as embedding usage plus summarization and retrieved-context usage, provider fees, storage, and any reranking. Browser investigations, repair runs, retries, and human support are additional. Select the actual provider and model, verify their rates at implementation time, and record actual cost per useful completed case. Do not add a graph database or fine-tuning pipeline until evaluations show a problem that requires them.

Sources checked September 11, 2026:

1. PostgreSQL, [row security policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).
2. pgvector, [official repository and hybrid search guidance](https://github.com/pgvector/pgvector).
3. Nous Research, [Hermes memory providers](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory-providers).
4. Mem0, [open-source metadata filtering](https://docs.mem0.ai/open-source/features/metadata-filtering).
5. Mem0, [adding memories](https://docs.mem0.ai/core-concepts/memory-operations/add) and [direct import](https://docs.mem0.ai/platform/features/direct-import).
6. Mem0, [entity-scoped memory](https://docs.mem0.ai/platform/features/entity-scoped-memory).
