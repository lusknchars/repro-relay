import { IntegrationLogo } from "@/components/integration-logo";
import { useMemo, useState } from "react";
import { AtSign, Check, CornerUpLeft, FileText, Hash, Link2, Lock, Paperclip, Pin, Plus, Search, Send, Smile, Sparkles, Star, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, Badge, Button, Input, Kbd, Segmented } from "@/components/ui";
import { CapTag, SourceBadge, StateBadge } from "@/components/work-bits";
import { evidence, workItems } from "@/lib/data";

/* ---------------- prototype data (invented) ---------------- */
type Channel = { id: string; kind: "channel" | "dm"; name: string; project?: string; preview: string; at: string; unread: number; mentions?: number; online?: boolean; starred?: boolean; private?: boolean };

const channels: Channel[] = [
  { id: "rel-142", kind: "channel", name: "rel-142-export-failure", project: "acme-billing", preview: "Hermes: Proposal ready in wt-142-a — 14 checks passed", at: "13:42", unread: 2, mentions: 1, starred: true },
  { id: "rel-139", kind: "channel", name: "rel-139-webhook-retries", project: "acme-billing", preview: "Marco: can someone share the retry fixture?", at: "13:20", unread: 0 },
  { id: "billing", kind: "channel", name: "acme-billing", project: "acme-billing", preview: "Relay: Tracked-instruction audit found 2 files disagreeing", at: "11:08", unread: 1 },
  { id: "support", kind: "channel", name: "support-intake", project: "shared", preview: "Dana: Northwind's month-end run is Wednesday", at: "Yesterday", unread: 0, private: true },
  { id: "dm-dana", kind: "dm", name: "Dana Whitfield", preview: "Thanks — I'll confirm once it's in production", at: "Yesterday", unread: 0, online: true },
  { id: "dm-marco", kind: "dm", name: "Marco Reyes", preview: "Invitation accepted, joining Wednesday", at: "Mon", unread: 0, online: false },
];

type Card =
  | { type: "work"; id: string }
  | { type: "evidence"; ids: string[] }
  | { type: "decision"; label: string; scope: string; state: "open" | "approved" | "outdated"; by?: string; at?: string }
  | { type: "summary"; text: string; sources: string[] }
  | { type: "fact"; question: string; answered?: { by: string; text: string; recorded: boolean } };

type Msg = { id: string; who: string; kind: "human" | "agent" | "system"; at: string; text?: string; card?: Card; reactions?: { e: string; n: number }[]; pinned?: boolean };

const threadByChannel: Record<string, Msg[]> = {
  "rel-142": [
    { id: "m1", who: "Relay", kind: "system", at: "13 Sep, 16:05", text: "Channel created from support message. Linked to work record REL-142.", card: { type: "work", id: "REL-142" } },
    { id: "m2", who: "Hermes", kind: "agent", at: "13 Sep, 16:31", card: { type: "summary", text: "The export never finishes for accounts with archived projects: the worker builds the statement schema from active projects only, then joins line items that still point at archived project IDs. The join returns null and the serializer waits forever.", sources: ["e1", "e3"] } },
    { id: "m3", who: "Luskzz", kind: "human", at: "13 Sep, 18:10", text: "Confirmed on staging with the Northwind fixture. @Hermes propose an isolated fix in the worker, not the serializer.", reactions: [{ e: "👍", n: 2 }], pinned: true },
    { id: "m4", who: "Hermes", kind: "agent", at: "13 Sep, 18:12", card: { type: "fact", question: "Does Northwind still need archived projects to appear in the statement, or only their line items?", answered: { by: "Dana Whitfield", text: "Both. Finance reconciles by project name, so archived projects must stay in the statement as read-only.", recorded: true } } },
    { id: "m5", who: "Dana Whitfield", kind: "human", at: "13 Sep, 19:04", text: "Also — our month-end run is Wednesday morning. If this can land before then it saves us a manual export." },
    { id: "m6", who: "Hermes", kind: "agent", at: "14 Sep, 13:42", text: "Proposal ready in wt-142-a. 3 files changed in services/export; 14 checks passed on Windows 11 / Edge 130.", card: { type: "evidence", ids: ["e4", "e1"] } },
    { id: "m7", who: "Hermes", kind: "agent", at: "14 Sep, 13:42", card: { type: "decision", label: "Approve isolated fix", scope: "Runs pnpm test:ci in wt-142-a@e0a5b3f · no merge, no messages, no memory publish", state: "open" } },
  ],
  "rel-139": [
    { id: "n1", who: "Relay", kind: "system", at: "14 Sep, 12:50", text: "Channel created for REL-139.", card: { type: "work", id: "REL-139" } },
    { id: "n2", who: "Marco Reyes", kind: "human", at: "14 Sep, 13:20", text: "Can someone share the retry fixture? I want to check idempotency keys locally." },
    { id: "n3", who: "Hermes", kind: "agent", at: "14 Sep, 13:55", text: "Comparing idempotency keys on 3 retries. No conclusion yet — last confirmed action 13:55." },
  ],
  billing: [
    { id: "b1", who: "Relay", kind: "system", at: "14 Sep, 11:08", text: "Tracked-instruction audit found AGENTS.md and CLAUDE.md disagreeing about the test command.", card: { type: "work", id: "REL-137" } },
    { id: "b2", who: "Relay", kind: "system", at: "14 Sep, 11:08", text: "Model request blocked: provider credit balance. Work is preserved; Mem0 and Hermes are not the cause." },
  ],
  support: [
    { id: "s1", who: "Dana Whitfield", kind: "human", at: "13 Sep, 16:04", text: "Export to CSV shows a spinner forever for the Northwind account. Started after the archive feature shipped." },
    { id: "s2", who: "Relay", kind: "system", at: "13 Sep, 16:05", text: "Converted into investigation REL-142 and opened #rel-142-export-failure.", card: { type: "work", id: "REL-142" } },
    { id: "s3", who: "Dana Whitfield", kind: "human", at: "13 Sep, 19:10", text: "Northwind's month-end run is Wednesday." },
  ],
  "dm-dana": [
    { id: "d1", who: "Luskzz", kind: "human", at: "Yesterday, 18:20", text: "Dana, the fix is under review. I'll ping you when it's merged so you can confirm on production." },
    { id: "d2", who: "Dana Whitfield", kind: "human", at: "Yesterday, 18:31", text: "Thanks — I'll confirm once it's in production." },
  ],
  "dm-marco": [
    { id: "k1", who: "Marco Reyes", kind: "human", at: "Mon, 09:12", text: "Invitation accepted, joining Wednesday." },
  ],
};

const membersByChannel: Record<string, { name: string; role: string; online: boolean }[]> = {
  "rel-142": [
    { name: "Luskzz", role: "Owner", online: true },
    { name: "Dana Whitfield", role: "Viewer · reporter", online: true },
    { name: "Marco Reyes", role: "Maintainer · invited", online: false },
    { name: "Hermes", role: "Agent · investigation", online: true },
  ],
};

const filesByChannel: Record<string, { name: string; size: string; at: string }[]> = {
  "rel-142": [
    { name: "spinner.png", size: "412 KB", at: "13 Sep" },
    { name: "northwind-archived.json", size: "9 KB", at: "13 Sep" },
    { name: "edge-win-run-77.json", size: "31 KB", at: "14 Sep" },
  ],
};

/* ---------------- cards ---------------- */
function WorkCard({ id }: { id: string }) {
  const w = workItems.find((x) => x.id === id);
  if (!w) return null;
  return (
    <div className="grid gap-1.5 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-2 text-xs text-muted"><Link2 className="h-3.5 w-3.5" /> Linked work record <span className="mono">{w.id}</span></div>
      <div className="text-sm font-medium">{w.title}</div>
      <div className="text-xs text-muted">{w.impact}</div>
      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <StateBadge state={w.state} live={w.live} />
        <span className="mono text-[11px] text-muted">{w.build} · {w.env}</span>
        <Button size="sm" variant="link" className="ml-auto text-xs">Open in Work</Button>
      </div>
    </div>
  );
}

function EvidenceCard({ ids }: { ids: string[] }) {
  const rows = evidence.filter((e) => ids.includes(e.id));
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-surface">
      {rows.map((e) => (
        <li key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm">
          <Paperclip className="h-3.5 w-3.5 flex-none text-muted" />
          <span className="min-w-0 flex-1 truncate">{e.label}</span>
          <SourceBadge source={e.source} />
          <a href="#" onClick={(ev) => ev.preventDefault()} className="mono text-[11px] text-accent-text hover:underline">{e.artifact.split("/").pop()}</a>
        </li>
      ))}
    </ul>
  );
}

function SummaryCard({ text, sources }: { text: string; sources: string[] }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 rounded-md border border-border bg-surface p-3">
      <IntegrationLogo provider="hermes" size={32} />
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2 text-xs"><span className="font-medium">Relay summary</span><SourceBadge source="Agent proposal" /></div>
        <p className="max-w-prose text-sm leading-6">{text}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          Sources:
          {sources.map((s) => { const e = evidence.find((x) => x.id === s); return e ? <a key={s} href="#" onClick={(ev) => ev.preventDefault()} className="mono text-accent-text hover:underline">{e.artifact.split("/").pop()}</a> : null; })}
        </div>
      </div>
    </div>
  );
}

function FactCard({ question, answered }: { question: string; answered?: { by: string; text: string; recorded: boolean } }) {
  return (
    <div className="grid gap-2 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-2 text-xs text-muted"><AtSign className="h-3.5 w-3.5" /> Missing fact requested from the owner</div>
      <p className="text-sm">{question}</p>
      {answered ? (
        <div className="grid gap-1 rounded-sm border-l-2 border-accent bg-surface-2 px-3 py-2">
          <div className="flex items-center gap-2 text-xs"><span className="font-medium">{answered.by}</span>{answered.recorded ? <Badge tone="info">Recorded as human observation</Badge> : <Badge tone="neutral">Not yet recorded</Badge>}</div>
          <p className="text-sm">{answered.text}</p>
        </div>
      ) : (
        <div className="flex gap-2"><Input placeholder="Answer here — it will be saved on the record as a human observation" /><Button size="md" variant="default">Record</Button></div>
      )}
    </div>
  );
}

function DecisionCard({ card, onDecide }: { card: Extract<Card, { type: "decision" }>; onDecide: () => void }) {
  const [pending, setPending] = useState(false);
  return (
    <div className={cn("grid gap-2 rounded-md border p-3", card.state === "open" ? "border-accent bg-accent-soft/40" : card.state === "outdated" ? "border-warn bg-warn-soft/40" : "border-border bg-surface")}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{card.label}</div>
        {card.state === "approved" ? <Badge tone="ok"><Check className="h-3 w-3" /> Approved by {card.by} · {card.at}</Badge> : card.state === "outdated" ? <Badge tone="warn">Evidence changed — review current version</Badge> : <Badge tone="accent" dot>Needs your decision</Badge>}
      </div>
      <p className="text-xs text-muted">{card.scope}</p>
      <p className="text-xs text-muted">Approving here has exactly the same effect and scope as approving in Work. Accepting the finding earlier did not authorize this edit.</p>
      {card.state === "open" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="default" pending={pending} onClick={() => { setPending(true); window.setTimeout(() => { setPending(false); onDecide(); }, 1300); }}>{pending ? "Checking whether the action started" : "Approve isolated fix"}</Button>
          <Button size="sm" variant="outline">Request another check</Button>
          <Button size="sm" variant="ghost">Review in Work</Button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- page ---------------- */
type Filter = "all" | "unread" | "mentions";

export function TeamPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState("rel-142");
  const [draft, setDraft] = useState("");
  const [decided, setDecided] = useState<Record<string, boolean>>({});
  const [listOpen, setListOpen] = useState(true);
  const [railOpen, setRailOpen] = useState(true);

  const ch = channels.find((c) => c.id === sel) ?? channels[0];
  const thread = threadByChannel[ch.id] ?? [];
  const members = membersByChannel[ch.id] ?? [{ name: "Luskzz", role: "Owner", online: true }];
  const files = filesByChannel[ch.id] ?? [];
  const decisions = thread.filter((m) => m.card?.type === "decision");
  const linked = thread.find((m) => m.card?.type === "work")?.card as Extract<Card, { type: "work" }> | undefined;
  const linkedWork = linked ? workItems.find((w) => w.id === linked.id) : undefined;

  const list = useMemo(() => channels.filter((c) => (filter === "unread" ? c.unread > 0 : filter === "mentions" ? (c.mentions ?? 0) > 0 : true)).filter((c) => c.name.toLowerCase().includes(q.toLowerCase())), [filter, q]);

  return (
    <div className="flex h-full min-h-0">
      {/* Channels */}
      <section className={cn("flex min-h-0 w-full flex-none flex-col border-r border-border bg-surface md:w-[300px]", !listOpen && "hidden md:flex")} aria-label="Channels and direct messages">
        <div className="grid gap-2 border-b border-border p-3">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold">Team</h1>
            <div className="flex items-center gap-1"><CapTag tag="Needs backend" /><Button size="icon" variant="ghost" aria-label="New channel"><Plus className="h-4 w-4" /></Button></div>
          </div>
          <div className="relative"><Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-faint" /><Input placeholder="Search channels…" className="pl-7" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search channels" /></div>
          <Segmented size="sm" ariaLabel="Filter" value={filter} onChange={setFilter} options={[{ value: "all", label: `All ${channels.length}` }, { value: "unread", label: `Unread ${channels.filter((c) => c.unread).length}` }, { value: "mentions", label: `Mentions ${channels.filter((c) => c.mentions).length}` }]} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {(["channel", "dm"] as const).map((kind) => {
            const rows = list.filter((c) => c.kind === kind);
            if (!rows.length) return null;
            return (
              <div key={kind}>
                <div className="px-3 pb-1 pt-3 text-[11px] font-medium text-faint">{kind === "channel" ? "Work channels" : "Direct messages"}</div>
                {rows.map((c) => (
                  <button key={c.id} onClick={() => { setSel(c.id); setListOpen(false); }} aria-current={c.id === sel ? "true" : undefined} className={cn("row-pad t-control grid w-full grid-cols-[auto_1fr_auto] items-start gap-x-2.5 border-l-2 px-3 text-left hover:bg-surface-2", c.id === sel ? "border-l-accent bg-accent-soft/60" : "border-l-transparent")}>
                    {kind === "dm" ? (
                      <span className="relative mt-0.5"><Avatar name={c.name} size={26} />{c.online ? <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-ok" aria-label="Online" /> : null}</span>
                    ) : (
                      <span className="mt-0.5 grid h-[26px] w-[26px] place-items-center rounded-md bg-surface-2 text-muted">{c.private ? <Lock className="h-3.5 w-3.5" /> : <Hash className="h-3.5 w-3.5" />}</span>
                    )}
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5"><span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.name}</span>{c.starred ? <Star className="h-3 w-3 flex-none fill-warn text-warn" /> : null}</span>
                      <span className={cn("block truncate text-xs", c.unread ? "text-foreground" : "text-muted")}>{c.preview}</span>
                      {c.project ? <span className="mono text-[11px] text-faint">{c.project}</span> : null}
                    </span>
                    <span className="grid justify-items-end gap-1"><span className="tnum text-[11px] text-faint">{c.at}</span>{c.unread ? <span className="tnum rounded-full bg-accent px-1.5 text-[11px] font-medium text-accent-foreground">{c.unread}</span> : null}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
        <div className="border-t border-border px-3 py-2 text-[11px] text-muted">Every channel is tied to a work record or project. Chat directs the work; the record keeps it.</div>
      </section>

      {/* Thread */}
      <section className={cn("flex min-h-0 min-w-0 flex-1 flex-col", listOpen && "hidden md:flex")} aria-label="Conversation">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-2.5">
          <button className="text-xs text-accent-text md:hidden" onClick={() => setListOpen(true)}>← Channels</button>
          {ch.kind === "channel" ? <Hash className="h-4 w-4 text-muted" /> : <Avatar name={ch.name} size={22} />}
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{ch.name}</div>
            <div className="text-xs text-muted">{ch.kind === "channel" ? `${members.length} members · linked to ${linkedWork?.id ?? "project"}` : ch.online ? "Active now" : "Away"}</div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost"><Pin className="h-3.5 w-3.5" /> 1 pinned</Button>
            <Button size="sm" variant="ghost" onClick={() => setRailOpen((v) => !v)} aria-pressed={railOpen}><Users className="h-3.5 w-3.5" /> Context</Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <ol className="grid gap-4">
            {thread.map((m) => (
              <li key={m.id} className={cn("grid grid-cols-[auto_1fr] gap-3", m.kind === "system" && "opacity-90")}>
                {m.kind === "agent" && m.who === "Hermes" ? <IntegrationLogo provider="hermes" size={28} /> : m.kind === "agent" ? <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-soft text-accent-text"><Sparkles className="h-3.5 w-3.5" /></span> : m.kind === "system" ? <span className="grid h-7 w-7 place-items-center rounded-full bg-surface-2 text-[10px] font-bold text-muted">RR</span> : <Avatar name={m.who} size={28} />}
                <div className="grid min-w-0 gap-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={cn("font-medium", m.kind === "agent" ? "text-accent-text" : m.kind === "system" ? "text-muted" : "text-foreground")}>{m.who}</span>
                    {m.kind === "agent" ? <Badge tone="accent">Agent</Badge> : null}
                    <span className="tnum text-faint">{m.at}</span>
                    {m.pinned ? <Pin className="h-3 w-3 text-warn" aria-label="Pinned" /> : null}
                  </div>
                  {m.text ? <p className={cn("max-w-prose text-sm leading-6", m.kind === "system" && "text-xs leading-5 text-muted")}>{m.text.split(/(@Hermes|#\S+)/).map((part, i) => /^(@|#)/.test(part) ? <span key={i} className="rounded-sm bg-accent-soft px-1 text-accent-text">{part}</span> : part)}</p> : null}
                  {m.card?.type === "work" && <WorkCard id={m.card.id} />}
                  {m.card?.type === "evidence" && <EvidenceCard ids={m.card.ids} />}
                  {m.card?.type === "summary" && <SummaryCard text={m.card.text} sources={m.card.sources} />}
                  {m.card?.type === "fact" && <FactCard question={m.card.question} answered={m.card.answered} />}
                  {m.card?.type === "decision" && <DecisionCard card={decided[m.id] ? { ...m.card, state: "approved", by: "Luskzz", at: "just now" } : m.card} onDecide={() => setDecided((d) => ({ ...d, [m.id]: true }))} />}
                  {m.reactions ? <div className="flex gap-1">{m.reactions.map((r) => <button key={r.e} className="t-control rounded-full border border-border bg-surface px-1.5 text-xs hover:border-border-strong">{r.e} <span className="tnum text-muted">{r.n}</span></button>)}</div> : null}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="border-t border-border bg-surface p-3">
          <div className="flex flex-wrap gap-1 pb-2">
            <Button size="sm" variant="ghost"><Link2 className="h-3.5 w-3.5" /> Attach work</Button>
            <Button size="sm" variant="ghost"><Paperclip className="h-3.5 w-3.5" /> Attach evidence</Button>
            <Button size="sm" variant="ghost"><Check className="h-3.5 w-3.5" /> Request decision</Button>
            <Button size="sm" variant="ghost"><AtSign className="h-3.5 w-3.5" /> Ask owner for a fact</Button>
          </div>
          <div className="flex items-center gap-2">
            <Avatar name="Lucas O" size={28} />
            <Input placeholder={`Message ${ch.kind === "channel" ? "#" + ch.name : ch.name} — @Hermes to direct the agent`} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Message" />
            <Button size="icon" variant="ghost" aria-label="Emoji"><Smile className="h-4 w-4" /></Button>
            <Button size="icon" variant="default" disabled={!draft.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">Messages stay on {linkedWork?.id ?? "the project"}'s record. Sending here never merges, publishes memory or messages people outside the workspace. <Kbd>⌘</Kbd>+<Kbd>↵</Kbd> to send.</p>
        </div>
      </section>

      {/* Shared context rail */}
      {railOpen && (
        <aside className="hidden min-h-0 w-[300px] flex-none flex-col overflow-y-auto border-l border-border bg-surface lg:flex" aria-label="Shared context">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Shared context</div>

          {linkedWork ? (
            <div className="grid gap-1.5 border-b border-border px-4 py-3">
              <div className="text-[11px] font-medium text-faint">Work record</div>
              <div className="text-sm font-medium">{linkedWork.id} · {linkedWork.title}</div>
              <div className="flex flex-wrap items-center gap-2"><StateBadge state={linkedWork.state} live={linkedWork.live} /><span className="text-xs text-muted">{linkedWork.owner}</span></div>
              <div className="mono text-[11px] text-muted">{linkedWork.build} · {linkedWork.env} · {linkedWork.runtime}</div>
              <div className="text-xs text-muted">Next: <span className="text-foreground">{linkedWork.nextAction}</span></div>
              <Button size="sm" variant="secondary" className="mt-1 w-fit">Open in Work</Button>
            </div>
          ) : (
            <div className="border-b border-border px-4 py-3 text-xs text-muted">No work record linked. Attach one so decisions and evidence stay on a persistent record.</div>
          )}

          <div className="grid gap-1.5 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between"><div className="text-[11px] font-medium text-faint">Decisions in this channel</div><span className="tnum text-[11px] text-muted">{decisions.length}</span></div>
            {decisions.length ? decisions.map((d) => { const c = d.card as Extract<Card, { type: "decision" }>; const st = decided[d.id] ? "approved" : c.state; return (
              <div key={d.id} className="flex items-center justify-between gap-2 text-sm"><span className="truncate">{c.label}</span>{st === "approved" ? <Badge tone="ok">Approved</Badge> : st === "outdated" ? <Badge tone="warn">Outdated</Badge> : <Badge tone="accent" dot>Open</Badge>}</div>
            ); }) : <div className="text-xs text-muted">None yet.</div>}
            <div className="flex items-center justify-between gap-2 text-sm"><span className="truncate">Accept finding</span><Badge tone="ok">Accepted · Luskzz</Badge></div>
          </div>

          <div className="grid gap-1.5 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between"><div className="text-[11px] font-medium text-faint">Evidence shared here</div><Button size="sm" variant="link" className="text-xs">See all</Button></div>
            {evidence.slice(0, 3).map((e) => (
              <div key={e.id} className="grid grid-cols-[auto_1fr] items-center gap-2 text-sm"><FileText className="h-3.5 w-3.5 text-muted" /><span className="min-w-0"><span className="block truncate">{e.label}</span><span className="flex items-center gap-1.5 text-[11px] text-muted"><SourceBadge source={e.source} /><span className="tnum">{e.time}</span></span></span></div>
            ))}
          </div>

          <div className="grid gap-1.5 border-b border-border px-4 py-3">
            <div className="flex items-center justify-between"><div className="text-[11px] font-medium text-faint">Files</div><span className="tnum text-[11px] text-muted">{files.length}</span></div>
            {files.length ? files.map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-2 text-sm"><span className="mono truncate text-xs">{f.name}</span><span className="tnum flex-none text-[11px] text-muted">{f.size} · {f.at}</span></div>
            )) : <div className="text-xs text-muted">No files shared.</div>}
          </div>

          <div className="grid gap-1.5 px-4 py-3">
            <div className="text-[11px] font-medium text-faint">Members</div>
            {members.map((m) => (
              <div key={m.name} className="flex items-center gap-2 text-sm">
                <span className="relative">{m.name === "Hermes" ? <IntegrationLogo provider="hermes" size={24} /> : <Avatar name={m.name} size={24} />}<span className={cn("absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-surface", m.online ? "bg-ok" : "bg-faint")} /></span>
                <span className="min-w-0"><span className="block truncate">{m.name}</span><span className="block text-[11px] text-muted">{m.role}</span></span>
              </div>
            ))}
            <p className="pt-1 text-[11px] text-muted">A viewer can answer facts and follow outcomes; only maintainers and owners can approve actions.</p>
            <Button size="sm" variant="ghost" className="w-fit"><CornerUpLeft className="h-3.5 w-3.5" /> Share link to this record</Button>
          </div>
        </aside>
      )}
    </div>
  );
}
