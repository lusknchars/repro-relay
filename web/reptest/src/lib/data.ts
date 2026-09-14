/* All data in this file is invented prototype example data. It does not describe a real run. */

export type WorkState = "decision" | "working" | "blocked" | "finished" | "history";
export type Source = "Agent proposal" | "Human observation" | "Local browser check" | "Fixture" | "Windows/Edge receipt" | "Chromium mobile viewport";
export type CapabilityTag = "Existing" | "Recompose existing" | "Needs backend" | "Future concept";

export interface WorkItem {
  id: string;
  title: string;
  project: string;
  impact: string;
  state: WorkState;
  lastChange: string;
  lastChangeAt: string;
  actor: string;
  nextAction: string;
  build: string;
  env: string;
  runtime: string;
  model: string;
  owner: string;
  live: boolean;
}

export const workItems: WorkItem[] = [
  {
    id: "REL-142",
    title: "CSV export fails for accounts with archived projects",
    project: "acme-billing",
    impact: "12 owners cannot download monthly statements",
    state: "decision",
    lastChange: "Isolated fix proposed, checks passed on Windows/Edge",
    lastChangeAt: "14 Sep 2026, 13:42",
    actor: "Hermes",
    nextAction: "Approve isolated fix",
    build: "main@8f21c0e",
    env: "staging-eu",
    runtime: "Hermes",
    model: "kimi-k3 (Moonshot)",
    owner: "Dana Whitfield",
    live: true,
  },
  {
    id: "REL-139",
    title: "Webhook retries duplicate invoice emails",
    project: "acme-billing",
    impact: "3 customers received duplicate invoices this week",
    state: "working",
    lastChange: "Reproduced with retry fixture; comparing idempotency keys",
    lastChangeAt: "14 Sep 2026, 13:55",
    actor: "Hermes",
    nextAction: "Wait for investigation",
    build: "main@8f21c0e",
    env: "staging-eu",
    runtime: "Hermes",
    model: "kimi-k3 (Moonshot)",
    owner: "Support inbox",
    live: true,
  },
  {
    id: "REL-137",
    title: "Tracked-instruction audit: AGENTS.md drift",
    project: "acme-billing",
    impact: "Two instruction files disagree about test command",
    state: "blocked",
    lastChange: "Model request blocked: provider credit balance",
    lastChangeAt: "14 Sep 2026, 11:08",
    actor: "Relay monitor",
    nextAction: "Open provider billing",
    build: "main@2b7a91d",
    env: "local",
    runtime: "Pi",
    model: "kimi-k3 (Moonshot)",
    owner: "Luskzz",
    live: false,
  },
  {
    id: "REL-131",
    title: "Duplicate helper: formatCurrency in two packages",
    project: "acme-billing",
    impact: "Rounding differs between dashboard and PDF",
    state: "finished",
    lastChange: "Merged reviewed change by Luskzz",
    lastChangeAt: "12 Sep 2026, 17:20",
    actor: "Luskzz",
    nextAction: "None",
    build: "main@2b7a91d",
    env: "staging-eu",
    runtime: "Hermes",
    model: "kimi-k3 (Moonshot)",
    owner: "Luskzz",
    live: false,
  },
  {
    id: "REL-118",
    title: "Login redirect loop on Safari private mode",
    project: "acme-web",
    impact: "Historical — resolved 4 Sep",
    state: "history",
    lastChange: "Owner confirmed fix in production",
    lastChangeAt: "4 Sep 2026, 09:12",
    actor: "Dana Whitfield",
    nextAction: "None",
    build: "main@c41e77a",
    env: "production",
    runtime: "Hermes",
    model: "kimi-k3 (Moonshot)",
    owner: "Dana Whitfield",
    live: false,
  },
];

export interface ConversationTurn {
  id: string;
  who: "owner" | "agent" | "maintainer" | "system";
  name: string;
  at: string;
  text: string;
  decision?: string;
}

export const conversation: ConversationTurn[] = [
  { id: "c1", who: "owner", name: "Dana Whitfield", at: "13 Sep, 16:04", text: "Export to CSV shows a spinner forever for the Northwind account. Started after the archive feature shipped." },
  { id: "c2", who: "system", name: "Relay", at: "13 Sep, 16:05", text: "Support message converted into investigation REL-142. Repository acme-billing at main@8f21c0e, environment staging-eu." },
  { id: "c3", who: "agent", name: "Hermes", at: "13 Sep, 16:31", text: "Reproduced. The export worker builds the statement schema from active projects only, then joins line items that still reference archived project IDs. The join returns null and the serializer never resolves." },
  { id: "c4", who: "maintainer", name: "Luskzz", at: "13 Sep, 18:10", text: "Confirmed on staging with the Northwind fixture. Please propose an isolated fix in the worker, not the serializer.", decision: "Accepted finding" },
  { id: "c5", who: "agent", name: "Hermes", at: "14 Sep, 13:42", text: "Proposed change ready in worktree wt-142-a. Schema now includes archived projects flagged as read-only. 14 checks passed on Windows/Edge; the mobile Safari check is a Chromium viewport simulation, not a device receipt." },
];

export interface Evidence {
  id: string;
  label: string;
  source: Source;
  build: string;
  time: string;
  artifact: string;
}

export const evidence: Evidence[] = [
  { id: "e1", label: "Worker log: null join on project_id 8841", source: "Agent proposal", build: "main@8f21c0e", time: "13 Sep, 16:29", artifact: "logs/export-worker-8841.txt" },
  { id: "e2", label: "Owner screenshot: infinite spinner", source: "Human observation", build: "prod@c41e77a", time: "13 Sep, 16:04", artifact: "attachments/spinner.png" },
  { id: "e3", label: "Northwind fixture reproduction", source: "Fixture", build: "main@8f21c0e", time: "13 Sep, 18:08", artifact: "fixtures/northwind-archived.json" },
  { id: "e4", label: "Export completes after patch", source: "Windows/Edge receipt", build: "wt-142-a@e0a5b3f", time: "14 Sep, 13:40", artifact: "receipts/edge-win-run-77.json" },
];

export interface TestRow {
  name: string;
  result: "Passed" | "Failed" | "Running" | "Not run" | "Blocked" | "Result stale";
  env: string;
  build: string;
  source: Source;
  time: string;
  artifact?: string;
}

export const tests: TestRow[] = [
  { name: "export.worker.archived-projects", result: "Passed", env: "Windows 11 / Edge 130", build: "wt-142-a@e0a5b3f", source: "Windows/Edge receipt", time: "14 Sep, 13:40", artifact: "receipts/edge-win-run-77.json" },
  { name: "export.serializer.schema-shape", result: "Passed", env: "Windows 11 / Edge 130", build: "wt-142-a@e0a5b3f", source: "Windows/Edge receipt", time: "14 Sep, 13:40", artifact: "receipts/edge-win-run-77.json" },
  { name: "export.ui.mobile-download", result: "Result stale", env: "Chromium 390px viewport", build: "main@8f21c0e", source: "Chromium mobile viewport", time: "13 Sep, 18:30", artifact: "receipts/chromium-mobile-12.json" },
  { name: "export.ui.safari-ios", result: "Not run", env: "Physical iPhone", build: "—", source: "Local browser check", time: "—" },
  { name: "billing.pdf.rounding", result: "Blocked", env: "staging-eu", build: "wt-142-a@e0a5b3f", source: "Fixture", time: "14 Sep, 13:41", artifact: "logs/pdf-blocked.txt" },
];

export const changedFiles = [
  { path: "services/export/worker.ts", add: 18, del: 6 },
  { path: "services/export/schema.ts", add: 9, del: 2 },
  { path: "services/export/__tests__/archived.test.ts", add: 41, del: 0 },
];

export const patchLines: { t: "ctx" | "add" | "del"; n: number; s: string }[] = [
  { t: "ctx", n: 41, s: "const projects = await repo.projects.active(accountId);" },
  { t: "del", n: 42, s: "const schema = buildSchema(projects);" },
  { t: "add", n: 42, s: "const archived = await repo.projects.archived(accountId);" },
  { t: "add", n: 43, s: "const schema = buildSchema([...projects, ...archived.map(readOnly)]);" },
  { t: "ctx", n: 44, s: "const rows = await repo.lineItems.forAccount(accountId);" },
  { t: "ctx", n: 45, s: "return serialize(schema, rows);" },
];

export interface ActivityEvent {
  at: string;
  actor: string;
  text: string;
  kind: "action" | "conclusion" | "decision" | "system";
}

export const activity: ActivityEvent[] = [
  { at: "14 Sep, 13:42", actor: "Hermes", text: "Proposal ready — 3 files changed in wt-142-a", kind: "conclusion" },
  { at: "14 Sep, 13:40", actor: "Hermes", text: "Ran 14 checks on Windows 11 / Edge 130 (receipt run-77)", kind: "action" },
  { at: "14 Sep, 13:31", actor: "Hermes", text: "Prepared worktree wt-142-a from main@8f21c0e", kind: "action" },
  { at: "13 Sep, 18:10", actor: "Luskzz", text: "Accepted finding; requested isolated fix in worker", kind: "decision" },
  { at: "13 Sep, 16:31", actor: "Hermes", text: "Concluded: null join on archived project IDs in export worker", kind: "conclusion" },
  { at: "13 Sep, 16:12", actor: "Hermes", text: "Read services/export/worker.ts, schema.ts; replayed export for account 8841", kind: "action" },
  { at: "13 Sep, 16:05", actor: "Relay", text: "Created REL-142 from support message", kind: "system" },
];

export interface ContextRow {
  label: string;
  layer: "Source evidence" | "Reviewed knowledge" | "Private note";
  reason?: string;
  freshness: string;
  tokens?: number;
  included: boolean;
}

export const contextUsed: ContextRow[] = [
  { label: "REL-142 case record and owner message", layer: "Source evidence", reason: "Case root", freshness: "Current", tokens: 1840, included: true },
  { label: "services/export/worker.ts @ 8f21c0e", layer: "Source evidence", reason: "Referenced by log", freshness: "Current", tokens: 3210, included: true },
  { label: "Export worker joins line items by project_id (reviewed 9 Sep)", layer: "Reviewed knowledge", reason: "Path match", freshness: "5 days", tokens: 220, included: true },
  { label: "Archived projects keep IDs; only status changes", layer: "Private note", reason: "Retrieved by similarity", freshness: "Unverified", tokens: 96, included: true },
  { label: "Deprecated: statements are built from active projects only", layer: "Reviewed knowledge", freshness: "Revoked 13 Sep", included: false },
  { label: "billing.pdf rounding notes", layer: "Private note", freshness: "18 days", included: false },
];

export interface KnowledgeRow {
  id: string;
  text: string;
  layer: "Reviewed" | "Private note" | "Revoked";
  reviewer?: string;
  sourceCase: string;
  revision: string;
  freshness: string;
  agent?: "Hermes" | "Pi";
  uses?: number;
}

export const knowledge: KnowledgeRow[] = [
  { id: "k1", text: "Export worker joins line items by project_id; archived projects must remain in the statement schema as read-only.", layer: "Reviewed", reviewer: "Luskzz", sourceCase: "REL-142", revision: "main@8f21c0e", freshness: "1 day" },
  { id: "k2", text: "Use `pnpm test:ci` (not `pnpm test`) for deterministic fixtures.", layer: "Reviewed", reviewer: "Luskzz", sourceCase: "REL-137", revision: "main@2b7a91d", freshness: "6 days" },
  { id: "k3", text: "formatCurrency lives in packages/money; do not reimplement in dashboard.", layer: "Reviewed", reviewer: "Luskzz", sourceCase: "REL-131", revision: "main@2b7a91d", freshness: "2 days" },
  { id: "k4", text: "Statements are built from active projects only.", layer: "Revoked", reviewer: "Luskzz", sourceCase: "REL-142", revision: "main@1d9e02c", freshness: "Revoked 13 Sep" },
  { id: "k5", text: "Archived projects keep IDs; only status changes.", layer: "Private note", sourceCase: "REL-142", revision: "—", freshness: "Unverified", agent: "Hermes", uses: 2 },
  { id: "k6", text: "Owner Dana prefers plain-language summaries in replies.", layer: "Private note", sourceCase: "REL-118", revision: "—", freshness: "Unverified", agent: "Pi", uses: 0 },
];

export type ConnStatus = "ready" | "untested" | "blocked" | "missing" | "unknown";

export interface Connection {
  id: string;
  name: string;
  role: string;
  status: ConnStatus;
  message: string;
  action: string;
  alias?: string;
  scope?: string;
  endpoint?: string;
  model?: string;
  credential?: "present" | "missing";
  lastVerified?: string;
  capabilities?: string[];
}

export const connections: Connection[] = [
  { id: "repo", name: "Repository", role: "acme-billing · main", status: "ready", message: "Watching for changes", action: "See monitored scope", alias: "local checkout", scope: "read + worktrees", endpoint: "~/code/acme-billing", credential: "present", lastVerified: "14 Sep, 13:58", capabilities: ["Tracked changes", "Worktrees", "Terminal handoff"] },
  { id: "hermes", name: "Hermes", role: "Investigation runtime", status: "ready", message: "Investigating REL-139; last confirmed action 13:55", action: "Open current work", alias: "hermes-local", scope: "inspect, test, isolated fix", endpoint: "localhost:7420", model: "kimi-k3 via Moonshot", credential: "present", lastVerified: "14 Sep, 13:55", capabilities: ["Evidence tools", "Memory tools", "Worktree runs"] },
  { id: "pi", name: "Pi", role: "Terminal review client", status: "untested", message: "Connection not yet tested", action: "Test connection", alias: "pi-terminal", scope: "review in terminal", endpoint: "pi CLI", model: "kimi-k3 via Moonshot", credential: "present", lastVerified: "—", capabilities: ["Relay evidence tools", "Mem0 tools (optional)"] },
  { id: "moonshot", name: "Moonshot", role: "Model provider", status: "blocked", message: "Model request blocked: provider credit balance", action: "Open provider billing", alias: "moonshot-team", scope: "kimi-k3", endpoint: "api.moonshot.ai", model: "kimi-k3", credential: "present", lastVerified: "14 Sep, 11:08", capabilities: ["Chat completions"] },
  { id: "mem0", name: "Mem0", role: "Private agent notes", status: "unknown", message: "Status unavailable; last checked at 12:40", action: "Reconnect", alias: "mem0-relay", scope: "private notes (Hermes, Pi)", endpoint: "api.mem0.ai", credential: "present", lastVerified: "14 Sep, 12:40", capabilities: ["Add note", "Recall note"] },
  { id: "plow", name: "Plow", role: "Outbound follow-ups", status: "missing", message: "Line activated; Latch not connected", action: "Connect Latch", alias: "plow-line-01", scope: "send after approval", endpoint: "—", credential: "missing", lastVerified: "—", capabilities: ["Queue message"] },
];

/* Usage — per-run rows; cost null = not reported (never plotted as zero) */
export interface UsageRun {
  id: string;
  work: string;
  runtime: "Hermes" | "Pi" | "Mem0";
  provider: string;
  started: string;
  durationMin: number;
  inTok: number | null;
  outTok: number | null;
  cacheTok: number | null;
  cost: number | null;
  costKind: "provider-reported" | "estimate" | "not reported";
  phase: "Investigation" | "Checks" | "Proposal" | "Memory" | "Audit";
  outcome: "Verified" | "Proposal" | "Blocked" | "None";
}

export const usageRuns: UsageRun[] = [
  { id: "run-77", work: "REL-142", runtime: "Hermes", provider: "Moonshot", started: "14 Sep, 13:31", durationMin: 11, inTok: 148_200, outTok: 9_410, cacheTok: 61_000, cost: 0.62, costKind: "provider-reported", phase: "Proposal", outcome: "Proposal" },
  { id: "run-76", work: "REL-139", runtime: "Hermes", provider: "Moonshot", started: "14 Sep, 12:50", durationMin: 39, inTok: 402_900, outTok: 18_230, cacheTok: 210_400, cost: 1.84, costKind: "provider-reported", phase: "Investigation", outcome: "None" },
  { id: "run-75", work: "REL-137", runtime: "Pi", provider: "Moonshot", started: "14 Sep, 11:02", durationMin: 6, inTok: 22_100, outTok: 1_200, cacheTok: null, cost: null, costKind: "not reported", phase: "Audit", outcome: "Blocked" },
  { id: "run-74", work: "REL-142", runtime: "Hermes", provider: "Moonshot", started: "13 Sep, 16:12", durationMin: 19, inTok: 231_400, outTok: 12_050, cacheTok: 88_100, cost: 1.02, costKind: "provider-reported", phase: "Investigation", outcome: "Proposal" },
  { id: "mem-13", work: "REL-142", runtime: "Mem0", provider: "Mem0", started: "13 Sep, 16:33", durationMin: 0, inTok: null, outTok: null, cacheTok: null, cost: null, costKind: "not reported", phase: "Memory", outcome: "None" },
  { id: "run-76b", work: "REL-142", runtime: "Hermes", provider: "Moonshot", started: "14 Sep, 13:40", durationMin: 4, inTok: 38_400, outTok: 2_100, cacheTok: 20_000, cost: 0.14, costKind: "provider-reported", phase: "Checks", outcome: "Verified" },
  { id: "run-72", work: "REL-131", runtime: "Hermes", provider: "Moonshot", started: "12 Sep, 14:10", durationMin: 17, inTok: 190_000, outTok: 9_200, cacheTok: 70_000, cost: 0.71, costKind: "provider-reported", phase: "Investigation", outcome: "Proposal" },
  { id: "run-73", work: "REL-131", runtime: "Hermes", provider: "Moonshot", started: "12 Sep, 15:40", durationMin: 24, inTok: 310_000, outTok: 14_800, cacheTok: 120_000, cost: 0.97, costKind: "estimate", phase: "Checks", outcome: "Verified" },
];

/* Daily series; null = no coverage for that day (chart must break the line) */
export const usageDaily = [
  { day: "8 Sep", input: 210, output: 12, cache: 90, cost: 0.9 },
  { day: "9 Sep", input: 340, output: 19, cache: 150, cost: 1.4 },
  { day: "10 Sep", input: 120, output: 8, cache: 40, cost: 0.5 },
  { day: "11 Sep", input: null, output: null, cache: null, cost: null },
  { day: "12 Sep", input: 310, output: 15, cache: 120, cost: null },
  { day: "13 Sep", input: 231, output: 12, cache: 88, cost: 1.02 },
  { day: "14 Sep", input: 573, output: 29, cache: 271, cost: 2.46 },
];

export const team = [
  { name: "Luskzz", email: "luskoliveira@protonmail.com", role: "Owner", status: "Active" },
  { name: "Dana Whitfield", email: "dana@northwind.example", role: "Viewer", status: "Active" },
  { name: "Marco Reyes", email: "marco@acme.example", role: "Maintainer", status: "Invited · expires in 3 days" },
  { name: "Priya Natarajan", email: "priya@acme.example", role: "Maintainer", status: "Invitation revoked" },
];

export const capabilityTag: Record<string, CapabilityTag> = {
  workList: "Recompose existing",
  conversation: "Needs backend",
  findings: "Existing",
  worktree: "Existing",
  liveRepair: "Needs backend",
  contextUsed: "Needs backend",
  usageUnified: "Needs backend",
  plow: "Needs backend",
  phone: "Future concept",
  voice: "Future concept",
  terminalEmbedded: "Future concept",
};
