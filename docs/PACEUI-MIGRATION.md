# PaceUI dashboard migration

The selected `@paceui/ultimate-dashboard-template` is now the sole dashboard template for Repro Relay. The authenticated registry download succeeded on September 12, 2026. Its actual source replaces the previous custom composition.

## Installation and provenance

The requested command ran in `web/`:

```sh
npx shadcn@latest add @paceui/ultimate-dashboard-template
```

`web/components.json` configures the official PaceUI registry using a `PACEUI_REGISTRY_TOKEN` environment reference. The credential is stored in ignored `web/.env.local` with owner-only permissions. It is a registry credential, not a Vite client variable. The CLI process must load that environment file before registry access.

Sources: [installation](https://paceui.com/docs/installation), [selected template](https://paceui.com/templates/ultimate-dashboard-template), and [product terms](https://paceui.com/terms-of-service).

The retained template files are `layouts/index.tsx`, `sidebar.tsx`, `topbar.tsx`, `footer.tsx`, `page-title.tsx`, and `dashboards/ai.tsx`. Their blocks are `stat/stat-13.tsx`, `chart/chart-18.tsx`, `chart/chart-19.tsx`, and `table/table-7.tsx`. Shadcn sidebar, sheet, card, input, separator, skeleton, and table dependencies support them. Existing shared controls were preserved rather than overwritten.

The download included no separate license file. PaceUI product terms remain applicable to the template and adapted blocks; the application MIT license does not relicense them. Public redistribution requires the applicable product license to permit it. No public publication is part of this migration.

## Adapted content

| Area | Implemented content |
| --- | --- |
| Overview | Persisted report, reproduction, memory, and handoff counts; fourteen-day report/observation chart. |
| Case inbox | Search, status filters, pagination, case detail, source build, observations, evidence, and stored activity. |
| Agent controls | Case selection, Hermes connection checks, start, time limit, cooperative stop, reconciliation, saved proposals, reported usage. |
| Project memory | Reviewed observations with source cases, applicability, and revocation. |
| Handoffs | Stored snapshots that open their case context for freshness checks and Markdown export. |
| Connections | Workspace connection, investigator setup, and explicit unconnected phone/owner channels. |

Synthetic commercial data and unrelated template pages were removed. No fake agent fleet, usage history, or delivery success is displayed. Agent answers remain proposals until a human records and reviews evidence.

Web and Tauri share this adapted application. Native export, startup recovery, keyboard commands, workspace isolation, revision checks, durable runs, and reviewed-memory rules remain in place. Validation results are recorded in [STATUS.md](STATUS.md).
