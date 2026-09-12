# Vercel configuration benchmark and Relay settings contract

September 12, 2026. Vercel is the user-selected benchmark for configuration. This document translates official documented patterns into testable Repro Relay settings requirements. It is a design/implementation contract, not a shipped settings screen or a change in hosting provider. PaceUI remains the sole dashboard template.

This complements the [delivery protocol](../DELIVERY-PROTOCOL.md). Orca/Warp remain interaction research for investigation dashboards; Vercel is the explicit reference for configuration.

## Verified patterns

| Vercel pattern | Official evidence | Relay application |
| --- | --- | --- |
| Project settings group distinct concerns | Settings cover configuration areas such as builds, variables, integrations and members. [Project settings](https://vercel.com/docs/project-configuration/project-settings) | Group application, investigator, permissions, memory/evidence, channels, limits and preferences into understandable settings sections. |
| Defaults can be overridden through configuration | Vercel documents detected defaults and project/file configuration methods. [Project configuration](https://vercel.com/docs/project-configuration) | Display the effective setting and where it comes from; prevent dashboard and process configuration from silently competing. |
| Values have explicit environments and sensitivity | Variables are environment-scoped; current docs distinguish readable Config from write-only Secret values. [Environment variables](https://vercel.com/docs/environment-variables) | Separate nonsecret settings from credential references; bind targets and credentials to the intended investigation environment. |
| A saved change has a defined point of effect | Environment-variable changes apply to new deployments, not previous deployments. [Environment variables](https://vercel.com/docs/environment-variables) | State whether a Relay change affects the next run, invalidates pending work, or changes only presentation. Do not change a running investigator's frozen configuration silently. |
| Access depends on the actor and scope | Vercel roles restrict actions at team/project scope. [Access control](https://vercel.com/docs/rbac) | Show the user's permitted editing scope and enforce it on the server. Reporter/reviewer access is distinct from runtime, recipient or credential administration. |

These are documentation observations. Versioned saves, conflict handling, Relay-specific test actions and activation gates below are our proposed requirements, not claims about Vercel's exact UI behavior. No settings, accounts or secrets were changed for this benchmark.

## Settings composition

Keep settings inside the existing Connections area initially, with the user's current background and the selected template. Add section navigation within that page; do not add seven new global destinations.

```text
Workspace / Project / Investigation environment
Settings                            Configuration version / access role

Application           Section title and purpose
Investigator          Effective values and their source
Access                Editable fields with descriptions
Memory & evidence     Validation / permission / readiness state
Channels & owners     What this change affects
Limits                Discard changes             Save changes
Preferences & help
```

The environment is the application being investigated, not automatically Relay's own hosting environment. Use the environments actually configured for the application; do not invent production access because Vercel has production settings.

Each section has a stable heading, field labels, context-specific help, saved/unsaved state and a scoped save action. A disconnected section states its missing prerequisite. At phone widths, section selection and fields stack, with the current scope remaining visible and no hidden save action behind the software keyboard.

## Sections and concrete resources

| Section | Fields and resources to resolve | Useful result | Areas |
| --- | --- | --- | --- |
| Application | Project, approved target, environment, build source, test-account role, confirmed expected behavior source | Reports inherit known context; missing facts are clarified instead of guessed. | RP-01, RP-02 |
| Investigator | Hermes endpoint reference, selected adapter/version, capability results, last checked time/configuration | Maintainer distinguishes reachable runtime from a proven authorized action. | RP-01, RP-06 |
| Access | Who may configure/review/approve, allowed targets/actions, credential references | User sees the precise permission required; report text cannot grant it. | RP-01, RP-02, RP-10 |
| Memory & evidence | Review policy, project applicability, artifact location/access, retention/redaction policy | Reusable knowledge has a source, while private or stale evidence is excluded from future use. | RP-03, RP-05 |
| Channels & owners | Named responsible person, provider/line/thread, allowed recipients, update types | Owner updates have a verified destination and reviewable content. | RP-10, RP-12 |
| Limits | Elapsed time, permitted actions, retry/concurrency limits, supported spending limit, reported usage units | Maintainer knows which limit is enforced and what happens when it is reached. | RP-06, RP-13, RP-14 |
| Preferences & help | Theme, motion, notification preference, accessible help, redacted diagnostics | Users adapt the interface and recover from setup failures without changing investigation authority. | RP-08, RP-09, RP-14 |

Do not expose a setting as operational until its backend contract exists. For example, an unsupported dollar ceiling must explain that the runtime cannot enforce it rather than accept a misleading value.

## Configuration acceptance contract

| ID | Requirement | Acceptance scenario |
| --- | --- | --- |
| C-01 | Scope is explicit before editing and saving | Change staging settings for project A; project B and production values do not change. Single-project installations show their actual fixed scope. |
| C-02 | Effective value and source are visible | A deployment-managed runtime endpoint is read-only with its source named; a project override shows its inherited value and effect. No silent second authority. |
| C-03 | Saves are validated, versioned and recoverable | Two clients edit the same configuration version. One succeeds; the other sees a conflict and retains its draft. Invalid fields get linked correction guidance. |
| C-04 | Saved, checked and enabled are distinct | Saving an endpoint does not mark the integration connected. Show the capability/action check, timestamp and tested version; edits invalidate the relevant check. |
| C-05 | Credentials and editing permissions are enforced | An unauthorized actor cannot update settings through direct requests. Secret values do not return through read APIs, logs or diagnostic export; replacement remains possible. |
| C-06 | Changes explain and enforce their execution effect | Changing target/access while work is pending invalidates its old authorization/context. Changing theme or motion does not stop the investigation. Running external actions cannot be undone by a settings save. |
| C-07 | Integration checks have bounded, truthful outcomes | Read-only capability checks and externally visible test actions are distinguished. A test message names its destination and requires authorization; only an actual provider receipt proves delivery. |
| C-08 | Settings remain usable across devices and failure states | Keyboard/screen-reader/phone users can identify scope, edit, save, discard and recover from errors without lost input or hidden controls. A failed save is never announced as successful. |

Configuration evidence includes the effective nonsecret values, scope, version, actor, save outcome, check outcome, timestamps and affected pending work. Keep credentials and private artifact contents out of that record.

## Change application rules

| Change | Proposed effect |
| --- | --- |
| Theme, motion, display density | Apply to the user's UI preference only. Do not increment the execution-configuration version. |
| Future-run defaults | Save a new execution-configuration version; new admissions use it. Existing run snapshots retain what they used. |
| Target, credentials or tool-access change | Revalidate queued work and permissions; block/stop affected continuation according to the runtime contract. Preserve receipts for actions already performed. |
| Owner/destination change | Invalidate affected pending approvals/deliveries; require fresh authorized content/destination binding before further sends. Already delivered records remain historical. |
| Evidence access or memory revocation | Enforce immediately on future reads/retrieval/delivery; mark affected contexts stale. Do not merely update a search index. |
| Raised budget | Apply only to authorized scope with a recorded effect; never silently increase an active run's allowance. |

The settings interface must show impact before saving consequential changes, without adding a confirmation dialog to every harmless edit. Allow users to discard unsaved fields. Restoring an older configuration creates a new validated revision; it does not resurrect revoked credentials or erase the audit history.

## Starting from the current code

Today Hermes configuration comes from backend process variables, and the application has neither a general persisted settings API nor team administration. The first settings view should report those effective values safely, their managed source, actual capability results and required setup actions. Never make a browser form appear to edit process configuration it cannot control.

When mutable settings are added, choose one authoritative store and define explicit precedence. A workable initial rule is deployment-managed settings locked in the UI, plus versioned project/environment settings where the server supports them. Preserve authentication and origin protections; enabling remote administration is a separate backend change, not a CSS task.

The first configuration increment should complete C-01, C-02 and C-04 for Application and Investigator, plus C-05/C-08 on every exposed control. Add editable sections only with their write, validation, conflict and change-effect behavior. This supplies tangible setup guidance while the live evidence workflow is being built.
