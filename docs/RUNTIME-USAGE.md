# Runtime usage in Relay

Usage shows two accounting scopes:

- **Hermes runtime usage:** cumulative counters from the dedicated local Hermes `session_model_usage` SQLite table. It includes chat, direct API reviews, investigations and auxiliary requests recorded by that runtime. Input, output, cache reads and cache writes are displayed separately; the total includes all four counters, matching the official Agent Index collector's convention.
- **Work records:** usage returned by individual Relay-managed investigation runs. These remain attached to their original cases, with the existing date filters and export.

The scopes can overlap and must not be added together. Runtime totals are all-time totals, irrespective of the work-record date selector. They are not evidence of a verified fix or exclusively attributable to a selected case.

The runtime panel refreshes every 15 seconds and with Refresh usage. `GET /api/v1/usage/runtime` invokes the read-only local ledger helper. It does not call a model, post to Agent Index, read conversations, return credentials or change reporter state. The endpoint rejects guest, hosted and other-workspace access and authenticated non-owners. Missing, incompatible or invalid ledgers produce an unavailable state; stale values are cleared after a failed refresh.

Some Hermes versions store a default zero cost with an unknown cost status. The runtime panel therefore does not infer dollar costs from those values. Work-record costs continue to use their actual run receipts. Pi and Mem0 billing are separate and remain unavailable unless explicitly reported by their integrations.

## Agent Index

The official reporting service runs independently. A successful reporting HTTP response confirms report delivery; it does not establish organizer verification or installation-success classification. Refreshing the dashboard does not increase token usage.

On September 15, 2026, the real local reader returned 57,922 cumulative tokens across 16 model requests. The existing official reporter submitted that same total and received HTTP 200 with `ok: true`. This is a point-in-time connection check, not sample data embedded in the interface.

The Stride SwiftUI source review completed through the same Hermes runtime and returned 5,584 input + 1,952 output = 7,536 attributable run tokens. Direct runtime reviews are not automatically assigned to a Relay case. No missing usage was filled with synthetic counters.

## Validation

The Python reader tests cover repeated reads without double counting, changing counters, model grouping, missing and incompatible ledgers, invalid/partial counters, numeric bounds and preservation of unknown costs. Rust tests reject guest/hosted/other-workspace access. The browser regression checks refresh, unknown costs, responsive layout and a disconnected ledger using explicitly synthetic fixtures.
