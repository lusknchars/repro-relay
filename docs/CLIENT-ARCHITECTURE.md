# Client architecture

Updated September 12, 2026.

The target architecture has one case model across web, desktop, and phone clients. The Rust backend owns state; a configured Hermes runtime owns execution. Web and Tauri currently share durable run controls and case review. Plow Latch actions and the phone adapter remain planned. The [SwiftUI plan](SWIFTUI-CLIENT-PLAN.md) adds a native iPhone-first conversation and later macOS adaptation. Clients submit commands to the backend.

```text
Support or operations report
          |
   Plow phone line
          |
       Hermes ---------- Plow Latch
          |
   Relay run coordinator
      /          \
 Desktop        Web
 developer    reviewers
```

## Desktop

The Tauri app is the developer control room. It uses the same React interface as the web client, with native packet export and external link opening. In local mode it connects to the loopback Rust API. In hosted mode it will connect to an authenticated remote runner.

The current desktop checks the local API before opening the workspace, offers setup commands and retry when unavailable, and preserves window placement. Native Workspace menu commands open a report, focus case search, or open connections. Shared shadcn controls and GSAP state transitions keep these actions consistent with the web client. Backend/database bundling and authenticated remote connections remain separate milestones.

Desktop progress:

1. Implemented: detect API and configured runtime availability.
2. Implemented: start, stop, reconcile, and read saved run state through three-second polling. Known remote IDs resume backend polling after restart.
3. Implemented: open the same local case in the browser using its case URL.
4. Planned: open the case working directory in a configured terminal or editor.
5. Planned: request an approved Latch operation and display its receipt.

The desktop must not embed credentials in the webview or grant unrestricted shell access. A packaged runner needs an explicit sidecar and a restricted Tauri capability. Until that runner is bundled and tested, the desktop is correctly described as a client for a separately running API.

## Web

The web client creates reports, records observations, reviews memory, exports handoffs, and controls configured local investigations. Clarification responses, named-action approvals, and delivery status remain planned. Hosted guest sessions cannot operate the local investigator. The web client cannot execute arbitrary terminal commands or read a developer's filesystem.

The hosted web app uses the same case and event interfaces as the desktop. Workspace identity and permissions come from the server session, never from a client-supplied workspace ID.

## Phone

The planned Plow phone line through `hermes-plugin-plow` receives reports and sends concise state updates, clarification requests, approval requests, and completion messages. It projects the canonical case. The backend now has local intake and approved delivery contracts; provider authentication and transport still need implementation and live validation.

The native SwiftUI client can begin with an isolated simulated investigator call before that transport is connected. It uses the same case and command model. Authenticated pairing and a conversation adapter gate real phone execution. Push notifications follow later. See [the native client plan and delivery gates](SWIFTUI-CLIENT-PLAN.md).

## Shared run interface

Proposed future event shape for tool receipts and revised conclusions:

```json
{
  "case_id": "RR-...",
  "run_id": "RUN-...",
  "revision": 4,
  "kind": "conclusion.revised",
  "actor": "hermes",
  "at": "2026-09-12T12:00:00Z",
  "payload": {}
}
```

Today, run snapshots include a version and ordered state events with `sequence`, `kind`, `at`, and `detail`. The [backend workflow](BACKEND-WORKFLOW.md) also provides a cursor-based evidence journal, text artifacts, scoped decisions, destination bindings, and delivery attempt contracts. There is no shared SSE stream or live provider transport yet. Admission rejects old revisions, and handoff checks reject stale source context. See [the implemented runner HTTP contract](HERMES-RUNNER.md).

## First technical slice

The first implemented slice is a controlled Hermes protocol fixture with submission, status, saved proposals, usage, and cancellation through the shared interface. The next live slice is one support report, one Hermes run, one approved Latch action, a persisted receipt, a reviewed conclusion, and one authorized owner message. Native gate N-01 can proceed independently with labeled simulation; it does not establish any live integration.
