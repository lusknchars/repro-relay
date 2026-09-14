import { IntegrationLogo } from "@/components/integration-logo";
import { useState } from "react";
import { Copy, ExternalLink, Eye, EyeOff, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Field, Input, Segmented, Switch, Tabs } from "@/components/ui";
import { CapTag } from "@/components/work-bits";
import { capabilityTag, connections, team, type ConnStatus, type Connection } from "@/lib/data";

type Tab = "connections" | "repository" | "permissions" | "automation" | "channels" | "team";

const statusTone: Record<ConnStatus, "ok" | "warn" | "danger" | "neutral" | "info"> = { ready: "ok", untested: "warn", blocked: "danger", missing: "neutral", unknown: "warn" };
const statusLabel: Record<ConnStatus, string> = { ready: "Ready", untested: "Not yet tested", blocked: "Blocked", missing: "Not connected", unknown: "Status unavailable" };

function ConnectionRow({ c, selected, onSelect }: { c: Connection; selected: boolean; onSelect: () => void }) {
  return (
    <button onClick={onSelect} aria-current={selected ? "true" : undefined} className={cn("row-pad t-control grid w-full grid-cols-[1fr_auto] items-center gap-2 border-l-2 px-3 text-left hover:bg-surface-2", selected ? "border-l-accent bg-accent-soft/60" : "border-l-transparent")}>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          {(c.id === "hermes" || c.id === "plow" || c.id === "pi" || c.id === "moonshot") && <IntegrationLogo provider={c.id} size={22} />}
          {c.id === "mem0" ? <IntegrationLogo provider="mem0" size={20} label={c.name} /> : c.name}
          <span className="text-xs font-normal text-muted">{c.role}</span>
        </div>
        <div className="truncate text-xs text-muted">{c.message}</div>
      </div>
      <div className="grid justify-items-end gap-1">
        <Badge tone={statusTone[c.status]} dot>{statusLabel[c.status]}</Badge>
        <span className="text-xs text-accent-text">{c.action}</span>
      </div>
    </button>
  );
}

function ConnectionDetail({ c }: { c: Connection }) {
  const [testing, setTesting] = useState<"idle" | "pending" | "done">("idle");
  const [reveal, setReveal] = useState(false);
  const shell = "pi --provider moonshot --model kimi-k3";
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">{(c.id === "hermes" || c.id === "plow" || c.id === "pi" || c.id === "moonshot") && <IntegrationLogo provider={c.id} size={28} />}{c.id === "mem0" ? <IntegrationLogo provider="mem0" size={28} label={c.name} /> : c.name}</h2>
          <p className="text-sm text-muted">{c.role}</p>
        </div>
        <Badge tone={statusTone[c.status]} dot>{statusLabel[c.status]}</Badge>
      </div>

      <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">Alias</dt><dd>{c.alias ?? "—"}</dd>
        <dt className="text-muted">Scope</dt><dd>{c.scope ?? "—"}</dd>
        <dt className="text-muted">Endpoint</dt><dd className="mono">{c.endpoint ?? "—"}</dd>
        {c.model ? <><dt className="text-muted">Model</dt><dd className="mono">{c.model}</dd></> : null}
        <dt className="text-muted">Credential</dt>
        <dd className="flex items-center gap-2">
          {c.credential === "present" ? <span className="mono">{reveal ? "sk-…(masked in prototype)" : "••••••••••••"}</span> : <span className="text-muted">Missing</span>}
          {c.credential === "present" ? <button className="text-muted hover:text-foreground" onClick={() => setReveal((v) => !v)} aria-label={reveal ? "Hide credential hint" : "Show credential hint"}>{reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}</button> : null}
          <span className="text-xs text-muted">provenance: entered 9 Sep by Luskzz</span>
        </dd>
        <dt className="text-muted">Last verified request</dt><dd className="tnum">{c.lastVerified ?? "—"}<span className="ml-2 text-xs text-muted">(a detected key is not a successful request)</span></dd>
        <dt className="text-muted">Capabilities</dt><dd className="flex flex-wrap gap-1">{(c.capabilities ?? []).map((x) => <Badge key={x} tone="outline">{x}</Badge>)}</dd>
      </dl>

      {c.status === "blocked" && (
        <div className="rounded-md border border-danger/40 bg-danger-soft/40 p-3 text-sm">
          <div className="font-medium">Model request blocked: provider credit balance</div>
          <div className="text-xs text-muted">The credential is valid. The provider's prepaid balance is exhausted. This is separate from any subscription allowance and not caused by Mem0.</div>
        </div>
      )}
      {c.status === "unknown" && (
        <div className="rounded-md border border-warn/50 bg-warn-soft/40 p-3 text-sm">
          <div className="font-medium">Status unavailable; last checked at 12:40</div>
          <div className="text-xs text-muted">The generic backend flag does not describe adapter connectivity. Reviewed knowledge still works; private notes may be unavailable.</div>
        </div>
      )}

      {c.id === "pi" && (
        <div className="grid gap-2 rounded-md border border-border p-3">
          <div className="text-sm font-medium">Setup commands</div>
          <div className="grid gap-1.5">
            <div className="flex items-center gap-2 text-xs text-muted"><Terminal className="h-3.5 w-3.5" /> Run in macOS Terminal</div>
            <div className="flex items-center gap-2">
              <code className="mono flex-1 rounded-sm border border-border bg-surface-2 px-2 py-1.5">{shell}</code>
              <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(shell)}><Copy className="h-3.5 w-3.5" /> Copy</Button>
            </div>
            <div className="text-xs text-muted">Expected: Pi prompt shows <span className="mono">moonshot/kimi-k3</span>. Copying does not mark this connection successful.</div>
          </div>
          <div className="grid gap-1.5">
            <div className="flex items-center gap-2 text-xs text-muted"><Terminal className="h-3.5 w-3.5" /> Type inside Pi</div>
            <code className="mono rounded-sm border border-border bg-surface-2 px-2 py-1.5">/relay connect</code>
            <div className="text-xs text-muted">To return to the shell, type <span className="mono">/exit</span>. Do not launch Pi from inside Pi.</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {c.status === "blocked" ? (
          <>
            <Button variant="default" size="sm"><ExternalLink className="h-3.5 w-3.5" /> Open Moonshot billing</Button>
            <Button variant="outline" size="sm">Change provider</Button>
          </>
        ) : c.status === "missing" ? (
          <Button variant="default" size="sm">Connect Latch</Button>
        ) : c.status === "unknown" ? (
          <>
            <Button variant="default" size="sm">Reconnect</Button>
            <Button variant="outline" size="sm">Continue with known limits</Button>
          </>
        ) : (
          <>
            <Button
              variant="default"
              size="sm"
              pending={testing === "pending"}
              outcome={testing === "done" ? "success" : null}
              onClick={() => { setTesting("pending"); window.setTimeout(() => setTesting("done"), 1200); }}
            >
              {testing === "done" ? "Request verified" : "Test connection"}
            </Button>
            <span className="self-center text-xs text-muted">Makes one paid model request (≈ 40 tokens).</span>
            <Button variant="ghost" size="sm">View activity</Button>
          </>
        )}
      </div>
    </div>
  );
}

function Scoped({ label, value, source, children }: { label: string; value: string; source: string; children?: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border py-3 last:border-b-0 md:grid-cols-[14rem_1fr_auto] md:items-center">
      <div className="text-sm">{label}</div>
      <div className="text-sm">{children ?? <span className="mono">{value}</span>}</div>
      <div className="text-xs text-muted">Effective from {source}</div>
    </div>
  );
}

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>("connections");
  const [sel, setSel] = useState(connections[3].id);
  const c = connections.find((x) => x.id === sel) ?? connections[0];
  const [perm, setPerm] = useState({ inspect: true, tests: true, worktree: true, merge: false, messages: false, memory: false });

  return (
    <div className="relative">
      <div className="perspective-grid pointer-events-none absolute inset-x-0 top-0 h-40" aria-hidden />
      <div className="relative grid gap-4 p-4 md:p-6">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="text-sm text-muted">Connections, repository, permissions, automation, channels and team. Values show where they come from.</p>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "connections", label: "Connections", count: connections.filter((x) => x.status !== "ready").length },
            { value: "repository", label: "Repository" },
            { value: "permissions", label: "Permissions" },
            { value: "automation", label: "Automation" },
            { value: "channels", label: "Channels" },
            { value: "team", label: "Team" },
          ]}
        />

        {tab === "connections" && (
          <div className="grid gap-0 overflow-hidden rounded-lg border border-border bg-surface lg:grid-cols-[minmax(280px,2fr)_3fr]">
            <div className="divide-y divide-border border-b border-border lg:border-b-0 lg:border-r">
              {connections.map((x) => <ConnectionRow key={x.id} c={x} selected={x.id === sel} onSelect={() => setSel(x.id)} />)}
            </div>
            <div className="p-4 md:p-5"><ConnectionDetail c={c} /></div>
          </div>
        )}

        {tab === "repository" && (
          <div className="rounded-lg border border-border bg-surface px-4">
            <Scoped label="Repository" value="~/code/acme-billing" source="workspace" />
            <Scoped label="Default branch" value="main" source="repository" />
            <Scoped label="Validation environment" value="staging-eu" source="project override" />
            <Scoped label="Test command" value="pnpm test:ci" source="reviewed knowledge k2" />
            <Scoped label="Worktree directory" value=".relay/worktrees" source="default" />
            <Scoped label="Terminal handoff" value="macOS Terminal (external)" source="desktop">
              <span className="flex items-center gap-2 text-sm">macOS Terminal (external) <CapTag tag={capabilityTag.terminalEmbedded} /></span>
            </Scoped>
          </div>
        )}

        {tab === "permissions" && (
          <div className="grid gap-3">
            <p className="max-w-prose text-sm text-muted">Standing permissions. Default is inspection. Anything that edits, merges, publishes memory or sends a message is listed separately and off by default.</p>
            <div className="rounded-lg border border-border bg-surface px-4">
              {([
                ["inspect", "Read repository, logs and artifacts", "Inspection"],
                ["tests", "Run pnpm test:ci in an isolated worktree", "Checks"],
                ["worktree", "Prepare isolated worktrees from the authorized base", "Checks"],
                ["merge", "Merge reviewed changes into main", "Edits main"],
                ["messages", "Send approved messages through Plow", "External message"],
                ["memory", "Promote private notes to reviewed knowledge", "Publishes memory"],
              ] as [keyof typeof perm, string, string][]).map(([k, l, g]) => (
                <div key={k} className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-b-0">
                  <div className="text-sm">{l}<div className="text-xs text-muted">{g}</div></div>
                  <Switch checked={perm[k]} onCheckedChange={(v) => setPerm((p) => ({ ...p, [k]: v }))} label={l} />
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "automation" && (
          <div className="rounded-lg border border-border bg-surface px-4">
            <Scoped label="Tracked-instruction audits" value="on every push to main" source="project" />
            <Scoped label="Duplication candidates" value="daily 06:00 BRT" source="project" />
            <Scoped label="Support intake" value="off" source="default">
              <span className="flex items-center gap-2 text-sm">Off <CapTag tag="Future concept" /></span>
            </Scoped>
            <Scoped label="Spending cap" value="$25 / day (cooperative timer, not an enforced ceiling)" source="workspace" />
          </div>
        )}

        {tab === "channels" && (
          <div className="grid gap-3">
            <div className="flex items-center gap-2 text-sm font-semibold"><IntegrationLogo provider="plow" size={24} />Plow follow-ups <CapTag tag={capabilityTag.plow} /></div>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {[
                ["Line activation", "Activated", "ok"],
                ["Latch availability", "Not connected", "danger"],
                ["Authorized destination", "dana@northwind.example", "ok"],
                ["Queued send", "0 messages", "neutral"],
                ["Sent / delivered receipt", "No receipts yet", "neutral"],
                ["Recipient response", "—", "neutral"],
              ].map(([l, v, t]) => (
                <li key={l} className="flex items-center justify-between px-4 py-2.5 text-sm"><span>{l}</span><Badge tone={t as never}>{v}</Badge></li>
              ))}
            </ul>
            <p className="text-xs text-muted">Each is a separate status. A changed recipient or edited message needs a new decision. An uncertain send is preserved, never retried blindly.</p>
          </div>
        )}

        {tab === "team" && (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Invite by email" htmlFor="inv"><Input id="inv" placeholder="name@company.com" className="w-72" /></Field>
              <Field label="Role"><Segmented ariaLabel="Role" value="maintainer" onChange={() => {}} options={[{ value: "viewer", label: "Viewer" }, { value: "maintainer", label: "Maintainer" }, { value: "owner", label: "Owner" }]} /></Field>
              <Button variant="default">Send invitation</Button>
            </div>
            <p className="text-xs text-muted">A join link is not permission to approve every action. Viewers can read cases; maintainers can decide; owners manage connections and billing.</p>
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {team.map((m) => (
                <li key={m.email} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2.5 text-sm">
                  <div><div className="font-medium">{m.name}</div><div className="text-xs text-muted">{m.email}</div></div>
                  <Badge tone="outline">{m.role}</Badge>
                  <span className={cn("text-xs", m.status.includes("revoked") ? "text-danger" : m.status.includes("Invited") ? "text-warn" : "text-muted")}>{m.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
