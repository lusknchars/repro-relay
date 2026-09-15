import { useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, Radio, Users } from "lucide-react";
import { api, useLoad } from "@/lib/live";
import { Badge, Button, Input } from "@/components/ui";
import { initials, type Teammate } from "./team-directory";
import type { ReachItem } from "./reach";
import "./reach-map.css";

const open = (item: ReachItem) => item.stale || !["done", "dismissed"].includes(item.action?.status || "");
const label = (item: ReachItem) => item.stale ? "Source changed" : item.action?.message_draft ? "Draft · not sent" : "Assigned action";
const positions = [{ x: 20, y: 22 }, { x: 80, y: 22 }, { x: 18, y: 73 }, { x: 82, y: 73 }, { x: 50, y: 12 }, { x: 50, y: 86 }];

export function ReachMap({ items, loading, error, truncated, onReview, onNew }: {
  items: ReachItem[]; loading: boolean; error: string; truncated?: boolean;
  onReview: (item: ReachItem) => void; onNew: () => void;
}) {
  const directory = useLoad(() => api<{ members: Teammate[]; has_more: boolean }>("/team/directory"), [], 15000);
  const plow = useLoad(() => api<{ configured?: boolean; grant_verified?: boolean; line_name?: string }>("/connections/plow"), [], 15000);
  const [selected, setSelected] = useState<string | null>(null);
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const active = items.filter(open);
  const scoped = active.filter(i => !project || i.project === project);
  const members = (directory.error ? [] : directory.data?.members || []).filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) && (!project || scoped.some(i => i.action?.member_id === m.id))
  ).sort((a, b) => Number(scoped.some(i => i.action?.member_id === b.id)) - Number(scoped.some(i => i.action?.member_id === a.id)) || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(members.length / 6));
  const currentPage = Math.min(page, pages - 1);
  const shown = members.slice(currentPage * 6, currentPage * 6 + 6);
  const person = members.find(m => m.id === selected);
  const requests = person ? scoped.filter(i => i.action?.member_id === person.id) : [];
  const status = plow.error ? "Connection unavailable" : !plow.data ? "Checking connection…" : plow.data.configured ? "Owner chat configured" : "Plow not connected";
  const selectPerson = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => document.getElementById("reach-communication-details")?.focus({ preventScroll: window.innerWidth > 1200 }));
  };
  const filter = (fn: () => void) => { fn(); setPage(0); setSelected(null); };

  return <section aria-label="Team communication map" className="reach-map-section">
    <header className="flex flex-wrap items-start justify-between gap-3 p-4">
      <div><div className="flex items-center gap-2"><Radio size={16} className="text-accent-text" /><h2 className="text-base font-semibold">Your team, in context</h2></div>
        <p className="mt-1 text-xs text-muted">Explore assigned follow-ups and the context prepared for each teammate.</p></div>
      <Button size="sm" onClick={onNew}>New follow-up</Button>
    </header>
    <div className="flex flex-wrap items-center gap-3 border-y border-border px-4 py-3">
      <Input aria-label="Find teammate in Reach" placeholder="Find a teammate…" value={search} onChange={e => filter(() => setSearch(e.target.value))} className="max-w-52" />
      <select aria-label="Map project" value={project} onChange={e => filter(() => setProject(e.target.value))} className="max-w-full rounded-md border border-border bg-surface p-2 text-xs">
        <option value="">All projects</option>{[...new Set(active.flatMap(i => i.project ? [i.project] : []))].sort().map(p => <option key={p}>{p}</option>)}
      </select>
      <span className="text-xs text-muted">{scoped.length} open follow-ups · {scoped.filter(i => !i.action?.member_id).length} unassigned</span>
    </div>
    {loading && <p role="status" className="px-4 pt-3 text-xs text-muted">Loading Reach context…</p>}
    {error && <p role="alert" className="px-4 pt-3 text-xs text-warn">Map context unavailable: {error}. Last loaded assignments may be outdated.</p>}
    {directory.error && <div role="alert" className="flex flex-wrap items-center gap-2 px-4 pt-3 text-xs text-warn">Team directory unavailable. <Button size="sm" onClick={directory.refresh}>Retry team directory</Button></div>}
    <div className="reach-map-layout">
      <div className="min-w-0">
        <div className="reach-orbit">
          <svg className="reach-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Assigned context connections">
            {shown.map((m, index) => {
              if (!scoped.some(i => i.action?.member_id === m.id)) return null;
              const {x, y} = positions[index];
              return <path key={m.id} d={`M 50 48 Q ${x} 48 ${x} ${y}`} className={selected === m.id ? "is-selected" : ""} role="button" tabIndex={0} aria-label={`Context connection for ${m.name}`} onClick={() => selectPerson(m.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectPerson(m.id); } }} />;
            })}
          </svg>
          <button type="button" className="reach-plow" aria-label="Inspect Plow connection" aria-pressed={!person} onClick={() => setSelected(null)}>
            <span className="reach-plow-circle"><img src="/brand/plow-logo.png" alt="" className="h-12 w-12 rounded-full object-contain" /></span><strong>Plow</strong><span className="text-xs text-muted">Context & follow-ups</span>
          </button>
          {shown.map((m, index) => {
            const assigned = scoped.filter(i => i.action?.member_id === m.id);
            const {x,y} = positions[index];
            return <div key={m.id} className="reach-person" style={{left:`${x}%`,top:`${y}%`}}>
              <button type="button" className="reach-person-button" aria-label={`Inspect ${m.name}`} aria-pressed={person?.id === m.id} onClick={() => selectPerson(m.id)}>
                <span className="reach-person-circle">{initials(m.name)}</span><strong className="truncate w-full">{m.name}</strong>
              </button>
              {assigned.length ? <button type="button" className="reach-connection-label" onClick={() => selectPerson(m.id)} aria-label={`Inspect ${assigned.length} assigned follow-ups for ${m.name}`}>{assigned.length} follow-up{assigned.length === 1 ? "" : "s"} · not sent</button> : <span className="text-xs text-muted">No assigned follow-ups</span>}
            </div>;
          })}
          {!shown.length && <p className="reach-map-empty text-sm text-muted">{directory.loading && !directory.data ? "Loading teammates…" : directory.error ? "Reconnect to view teammates." : search || project ? "No teammates match this filter." : "Invite teammates in Team to start coordinating follow-ups."}</p>}
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3 text-xs text-muted">
          <span><span aria-hidden="true">┄┄ </span>Dashed connections = assigned context, not delivery</span>
          {pages > 1 && <div className="flex items-center gap-2"><Button size="sm" aria-label="Previous teammates" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></Button>{currentPage + 1} / {pages}<Button size="sm" aria-label="Next teammates" disabled={currentPage + 1 === pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></Button></div>}
        </footer>
        {(truncated || directory.data?.has_more) && <p className="px-4 pb-3 text-xs text-warn">Loaded records are limited. This map is not the complete team history.</p>}
      </div>
      <aside id="reach-communication-details" tabIndex={-1} className="reach-map-inspector" aria-label="Communication details">
        {person ? <>
          <div className="flex items-center gap-3"><span className="reach-person-circle">{initials(person.name)}</span><div className="min-w-0"><h3 className="break-words font-semibold">{person.name}</h3><p className="text-xs text-muted">{person.role}</p></div></div>
          <Badge>Teammate delivery not connected</Badge>
          <p className="text-xs text-muted">These are saved assignments. Context has not been delivered through Plow.</p>
          <h4 className="text-sm font-medium">Assigned follow-ups</h4>
          {!requests.length && <p className="text-sm text-muted">No open follow-ups for this teammate in the current scope. Assign an owner from the queue below.</p>}
          {requests.map(i => <article key={i.id} className="rounded-md border border-border p-3 space-y-2">
            <p className="text-[11px] text-muted">{label(i)}</p><h4 className="text-sm font-medium break-words">{i.action?.title || i.title}</h4>
            <p className="text-xs text-muted">{i.project || "Local team"} · {i.action?.due_on || i.due_on || "No due date"}</p>
            <details className="text-xs"><summary className="cursor-pointer">Prepared message & source context</summary><p className="mt-2 whitespace-pre-wrap break-words">{i.action?.message_draft || "No message draft recorded."}</p><p className="mt-2 whitespace-pre-wrap break-words text-muted">Source: {i.text || i.title}</p></details>
            <Button size="sm" onClick={() => onReview(i)}>Review follow-up <ArrowUpRight size={12} /></Button>
            {i.case_id && <a className="block text-xs text-accent-text underline" href={`/?view=work&case=${encodeURIComponent(i.case_id)}`}>Open linked work</a>}
          </article>)}
        </> : <>
          <div className="flex items-center gap-2"><Radio size={20} className="text-accent-text" /><h3 className="font-semibold">Plow connection</h3></div>
          <Badge>{status}</Badge>
          <p className="text-sm text-muted">Reach prepares team follow-ups. Plow currently supports the connected owner chat, not delivery to every teammate.</p>
          <div className="rounded-md border border-border bg-surface-2 p-3"><p className="text-xs font-medium">Teammate delivery not connected</p><p className="mt-1 text-xs text-muted">A saved owner or communication profile does not grant messaging access. No delivery or reply is inferred from these connections.</p></div>
          <p className="text-xs text-muted">Select a teammate or a connection label to inspect their assigned requests and prepared context.</p>
          <a className="text-sm text-accent-text underline" href="/?view=settings">Open connection settings</a>
          <a className="inline-flex items-center gap-2 text-sm text-accent-text underline" href="/?view=team"><Users size={14} />Manage team</a>
        </>}
      </aside>
    </div>
  </section>;
}
