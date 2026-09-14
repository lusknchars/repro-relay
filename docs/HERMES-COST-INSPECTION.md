# Hermes cost inspection

Open Agent controls and select a case and investigation. **Hermes usage and cost** is in the main investigation column. Switch between Tokens and Cost · USD to see the selected run's reporting history and a comparison of saved investigations in that case. Charts refresh through the existing three-second run poll. Expand Chart data for exact readings without downloading anything.

Missing values leave gaps; they are not zero. A run with only a saved total shows one point with no invented observation time. Downward revisions remain visible. Imported local validation is excluded from Hermes comparisons. The token graph uses the reported total, not a sum of potentially overlapping counters.

Token breakdown and model, reporting history, case spending coverage, and source identity remain available as expandable details. Export audit file contains the optional JSON download with readings, frozen context, coordinator events and accounting limits.

## What a number means

All displayed usage comes from the configured runtime's matching run-status response. It is runtime-reported accounting, not a reconciled provider bill. Relay does not apply a pricing table or infer cost from token count. Missing fields display Not reported. An explicit zero remains zero. Model names may identify a Hermes profile rather than the underlying billing model.

Each run stores the latest valid value of each reported field. A partial response preserves previous values and their own last-observed timestamps. A repeated value refreshes that field's timestamp without adding another changed-report receipt. A lower cumulative reading replaces the previous reading, and its receipt identifies the fields revised downward. This records a runtime correction without inventing spend.

The journal retains the latest 100 changed reports and an omitted-report count. Reports are cumulative snapshots, never charges to add together. Case totals add one last-known dollar value per saved runtime run, including failed and cancelled runs. The panel reports coverage and active/unresolved runs. Imported local validation is excluded. Case history is limited to 100 runs; this is not an organization-wide invoice.

Cache and reasoning counters may overlap input/output totals, so Relay never adds them to the reported total. Tool-call counts are not action receipts or per-tool cost attribution. Existing evidence journal and artifact views hold whatever actual tool evidence has been ingested. The cost panel does not manufacture traces, a replay, or private model reasoning.

## Runtime contract

The official [Hermes runs API](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server#runs-api-streaming-friendly-alternative) documents run identity, top-level model, and input/output/total token usage in status responses. Check the configured runtime's capabilities before integration. Cost, provider, cache counters, and call counts below are optional Relay adapter fields, not a promise that every Hermes version emits them.

```json
{
  "run_id": "the-existing-remote-run-id",
  "status": "running",
  "model": "reported-model-or-profile",
  "provider": "reported-provider",
  "usage": {
    "input_tokens": 2500,
    "output_tokens": 300,
    "total_tokens": 2800,
    "cached_input_tokens": 1200,
    "cache_write_input_tokens": 0,
    "reasoning_output_tokens": 100,
    "model_calls": 2,
    "tool_calls": 3,
    "cost_usd": 0.0123
  }
}
```

This is a contract example, not measured usage. Counters must be nonnegative integers up to JavaScript's safe integer limit. Dollar values must be finite, nonnegative, and at most one billion. Model/provider labels must be at most 160 bytes without control characters. Unknown keys and invalid values are discarded. Credential scrubbing happens before accounting accepts the response. A mismatched remote run ID is rejected by the coordinator before any usage update.

`usage_audit` is stored with the existing run JSONB payload. Older records deserialize with empty history; their unknown timestamps are not backfilled. The fields are exposed by the existing workspace-scoped `GET /cases/{id}/runs` route. No new public accounting endpoint or migration is needed.

## Connect live reporting

1. Follow [the dedicated-runtime setup](HERMES-RUNNER.md#setup), including the backend-only `REPRO_HERMES_URL` and `REPRO_HERMES_KEY`. Keep credentials out of browser settings and Git.
2. Open Agent controls and confirm runtime availability. Select the intended case and inspect the exact context before admitting a live run.
3. Confirm the runtime's status endpoint supplies cumulative usage for all work included in that run. For dollar inspection it must supply `usage.cost_usd`; token counts alone are insufficient.
4. Compare one completed run's exported Relay report with the runtime's own record. Check follow-ups, failures, cache semantics, and any delegated work before treating the figures as complete.

At implementation time the local runner probe reported unconfigured, and no Hermes CLI was found on PATH. No credentials, provider, live execution, or paid request was created by this change. Accounting persistence, sanitization, and export were exercised using controlled runtime fixtures. Live usage and provider-bill reconciliation remain unverified.

Relay still enforces one active investigation and requests a cooperative stop after the configured time limit. It does not enforce a hard token or dollar cap. Stopping a run does not guarantee immediate cessation of provider charges. Final status and accounting depend on what the runtime reports.
