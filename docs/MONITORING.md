# Operational monitoring

Monitoring uses the supplied PaceUI screenshots as a layout reference inside the existing Reptest theme. It includes a PostgreSQL row, searchable request console, recent requests, traffic heatmap and service capacity bars. The page links to work records for build and investigation evidence.

## What the API measures

`GET /api/v1/monitoring` is available to the local team workspace. Hosted guest workspaces cannot access it and do not contribute to its buffer. Capture runs after the existing host/session guard. It records the method, router template, response status, UTC time and elapsed handler time. A templated `/cases/{id}` never contains the actual case ID. Unknown routes, static files, account/team/session routes, health checks and monitoring polls are excluded. Headers, request and response bodies, query strings, credentials and raw paths are not captured.

The API keeps the latest 4096 summaries in a bounded process-local buffer and returns up to 200 per refresh. Three-hour aggregate buckets retain up to seven days of captured traffic independently of summary eviction. Counts start at API startup; uncovered heatmap cells remain dashed. Restart clears this operational telemetry. Saved investigation evidence and the durable run activity ledger are separate.

Capture performs no SQL writes or model calls. The monitoring endpoint probes PostgreSQL with a two-second timeout, returning database size, probe round-trip time and the application's open, idle and maximum pool connections. Probe time includes acquiring a connection. Failure reports unavailable measurements. These values do not represent database QPS, cluster replicas, billing credit, egress or provider storage quotas.

The client refreshes every three seconds while visible. Pause freezes the console view only. Clear hides summaries through the latest visible ID; it does not delete server records or investigation evidence. Search and status filters apply to both request lists. A request detail dialog shows the sanitized summary and distinguishes HTTP success from a verified repair.

## Relationship to investigation tools

Service telemetry answers what happened inside Relay. It does not claim to capture console errors, network traces or screenshots from the application under investigation. Work records remain the source for reported conditions, builds, findings, assignments and test artifacts. No association is inferred from timestamps alone.

The supplied tool-capability reference prioritizes browser diagnostics, environment and test-account setup, issue routing and fix verification. Existing investigation and repair contracts supply part of this workflow; this monitoring change does not add Slack, Sentry, browser recording or independent fix verification. Those integrations need their own source identity, authorization and tested receipt contracts.

## Console latency signals

Each live console row shows its measured handler duration and a labelled signal: green for Fast (<100 ms), amber for Moderate (100 to <500 ms), and red for Slow (≥500 ms). One, two or three filled bars make the bands distinguishable without color. The legend stays above the console. These are display thresholds for Relay's API handler time, not an end-to-end latency measurement or a service-level guarantee. HTTP status is independent: a fast request can still fail. Pause, clear, filtering and request details retain their existing behavior.
