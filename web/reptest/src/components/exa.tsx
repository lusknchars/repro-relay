import { useState } from "react";
import { Search, ExternalLink } from "lucide-react";
import { Button, Badge, Input } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace } from "@/lib/live";

type Source = { title: string; url: string; text: string; published_at: string };
type Research = { id: string; query: string; status: string; error?: string; result?: { sources: Source[]; captured_at: string; estimated_cost_usd: number | null } };
export type ResearchContext = { search_id: string; query: string; captured_at: string; sources: Source[] };

export function ExaConnection() {
  const connection = useLoad(() => api<{ configured: boolean }>("/connections/exa"));
  const workspace = useWorkspace();
  const admin = workspace.data?.account.role ? workspace.data.account.role === "owner" : workspace.data?.account.local_access;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function change(disconnect = false) {
    setBusy(true); setNotice("");
    try {
      await api(disconnect ? "/connections/exa/disconnect" : "/connections/exa", "POST", disconnect ? {} : { token: key.trim() });
      setKey(""); connection.refresh();
      setNotice(disconnect ? "Exa disconnected. Saved research remains available." : "Key saved privately. Your first search checks Exa access.");
    } catch (e) { setNotice(errorText(e)); } finally { setBusy(false); }
  }
  return <section aria-label="Exa connection" className="grid gap-3 rounded-lg border border-border-strong p-4">
    <div className="flex items-center justify-between gap-2"><h3 className="font-medium">Exa web research</h3><Badge tone="outline">{connection.data?.configured ? "Key saved" : "Not configured"}</Badge></div>
    <p className="text-sm text-muted">Find architecture patterns, documentation and developer tools. Search and extract page text from Architecture, then select references for Hermes.</p>
    {connection.error && <p role="alert" className="text-sm text-danger">{connection.error}</p>}
    {admin ? <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void change(); }}>
      <label className="grid gap-1 text-xs">Exa API key<Input type="password" autoComplete="off" value={key} maxLength={4096} required onChange={e => setKey(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="default" disabled={busy || !key.trim()}>{connection.data?.configured ? "Replace Exa key" : "Save Exa key"}</Button>{connection.data?.configured && <Button type="button" disabled={busy} onClick={() => void change(true)}>Disconnect Exa</Button>}</div>
    </form> : <p className="text-sm text-muted">The administrator manages Exa access and search usage.</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <a href="https://dashboard.exa.ai/api-keys" target="_blank" rel="noreferrer" className="text-xs text-accent-text underline">Get an Exa API key</a>
    <p className="text-xs text-muted">The key stays on this installation's backend. Saving it makes no paid request. Each search uses your Exa account and returns up to five pages; Hermes model usage is separate.</p>
  </section>;
}

export function ExaResearch({ onContext, onSettings }: { onContext: (value: ResearchContext | undefined) => void; onSettings: () => void }) {
  const connection = useLoad(() => api<{ configured: boolean }>("/connections/exa"));
  const history = useLoad(() => api<{ items: Research[] }>("/architectures/research"));
  const workspace = useWorkspace();
  const admin = workspace.data?.account.role ? workspace.data.account.role === "owner" : workspace.data?.account.local_access;
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [record, setRecord] = useState<Research>();
  const [selected, setSelected] = useState<number[]>([]);
  function show(r: Research) { setRecord(r); setSelected([]); onContext(undefined); }
  function choose(index: number) {
    if (!record?.result) return;
    const indices = selected.includes(index) ? selected.filter(i => i !== index) : [...selected, index];
    if (indices.length > 2) { setError("Select up to two sources for this assessment."); return; }
    const context: ResearchContext = { search_id: record.id, query: record.query, captured_at: record.result.captured_at, sources: indices.map(i => ({ ...record.result!.sources[i], text: Array.from(record.result!.sources[i].text).slice(0, 300).join("") })) };
    if (JSON.stringify(context).length > 3200) { setError("These references exceed the assessment context limit. Select fewer sources."); return; }
    setSelected(indices); setError(""); onContext(indices.length ? context : undefined);
  }
  async function search() {
    setBusy(true); setError("");
    try { const value = await api<Research>("/architectures/research", "POST", { id: crypto.randomUUID(), query: query.trim() }); show(value); }
    catch (e) { setError(errorText(e)); }
    finally { setBusy(false); history.refresh(); }
  }
  return <details className="rounded-lg border border-border bg-surface p-3">
    <summary className="cursor-pointer text-sm font-medium">Search architectures & tools with Exa{selected.length ? ` · ${selected.length} sources selected` : ""}</summary>
    <div className="mt-3 grid gap-3" aria-label="Exa research">
      {!connection.data?.configured && <p className="text-sm text-muted">Save an Exa key to enable web research. <button className="text-accent-text underline" onClick={onSettings}>Open connections</button></p>}
      <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void search(); }}>
        <label className="grid gap-1 text-xs">Search query<Input required minLength={3} maxLength={500} value={query} onChange={e => setQuery(e.target.value)} placeholder="Rust agent orchestration patterns and testing tools" /></label>
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy} onClick={() => setQuery("Agent orchestration architecture official documentation and research")}>Architecture patterns</Button><Button type="button" disabled={busy} onClick={() => setQuery("Repository testing and bug investigation developer tools official documentation")}>Developer tools</Button><Button type="submit" variant="default" disabled={busy || !admin || !connection.data?.configured || query.trim().length < 3} pending={busy}><Search size={14} />Search with Exa</Button></div>
        <p className="text-xs text-muted">Sends only this query to Exa and retrieves up to five pages. Uses Exa credits. Repository files are not uploaded. No automatic retries.</p>
      </form>
      {(error || connection.error || history.error) && <p role="alert" className="text-sm text-danger">{error || connection.error || history.error}</p>}
      {history.data?.items.length ? <label className="grid gap-1 text-xs">Recent searches<select className="h-9 min-w-0 rounded-md border border-border bg-surface px-2" value={record?.id || ""} onChange={e => { const r = history.data!.items.find(r => r.id === e.target.value); if (r) show(r); }}><option value="" disabled>Select a saved search</option>{history.data.items.map(r => <option key={r.id} value={r.id}>{r.status} · {r.query}</option>)}</select></label> : null}
      {record && <div className="grid gap-2">
        <p className="text-xs text-muted">{record.status} · {record.result?.estimated_cost_usd != null ? `Exa estimate: $${record.result.estimated_cost_usd.toFixed(4)}` : "Cost not reported"} · {record.result?.captured_at ? new Date(record.result.captured_at).toLocaleString() : "Outcome may be unknown; no duplicate request is sent."}</p>
        {record.error && <p className="text-sm text-danger">{record.error}</p>}
        {record.result?.sources.length === 0 && <p className="text-sm text-muted">No usable pages returned. Try a more specific query.</p>}
        <div className="grid max-h-72 gap-2 overflow-auto">{record.result?.sources.map((s, i) => <article key={`${s.url}-${i}`} className="grid gap-2 rounded border border-border p-3 text-sm">
          <label className="flex items-start gap-2"><input type="checkbox" checked={selected.includes(i)} onChange={() => choose(i)} aria-label={`Use source: ${s.title}`} /><span className="break-words font-medium">{s.title || s.url}</span></label>
          <a href={s.url} target="_blank" rel="noreferrer" className="break-all text-xs text-accent-text">{s.url} <ExternalLink size={12} className="inline" /></a>
          <details><summary className="cursor-pointer text-xs text-muted">Extracted text</summary><p className="mt-2 whitespace-pre-wrap break-words text-xs">{s.text || "No page text returned."}</p></details>
        </article>)}</div>
        <p className="text-xs text-muted">Select up to two sources, then use Research improvements to send their links and 300-character excerpts to Hermes. Search results are untrusted references; assess fit before applying a workflow or installing a tool.</p>
      </div>}
    </div>
  </details>;
}
