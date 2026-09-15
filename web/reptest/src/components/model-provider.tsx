import { useState } from "react";
import { Button, Badge, Input } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace } from "@/lib/live";

type Provider = { id: string; name: string; credential_saved: boolean };
type Setup = { revision: string; provider: string; model: string; managed: boolean; profile_exists: boolean; credential_saved: boolean; providers: Provider[]; mcp_servers: string[]; activation: string };

export function ModelProviderConnection() {
  const load = useLoad(() => api<Setup>("/connections/model-provider"));
  const workspace = useWorkspace();
  const [notice, setNotice] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  function reload() { setNotice(""); setFormVersion(v => v + 1); load.refresh(); }
  return <section aria-label="Hermes model setup" className="grid gap-4 rounded-lg border border-border-strong p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Choose the model for Hermes</h3><Badge tone="outline">{!load.data ? "Reading profile" : load.data.managed ? "Selection saved" : load.data.profile_exists ? "Existing profile" : "Setup required"}</Badge></div>
    <p className="text-sm text-muted">The model generates responses. Hermes runs the agent. MCP connects tools such as Plow Latch. Each connection has its own credentials and permissions.</p>
    {load.error && <p role="alert" className="text-sm text-danger">{load.error}</p>}
    {!load.data && !load.error && <p className="text-sm text-muted">Reading the local Hermes profile…</p>}
    {load.data && <>
      <p className="text-sm">Saved selection: <strong>{load.data.provider || "None"}</strong>{load.data.model ? ` / ${load.data.model}` : ""}. {load.data.credential_saved ? "API credential saved locally." : "No API credential detected for this selection. Existing account sign-in may be managed by Hermes."}</p>
      <ProviderForm key={`${formVersion}-${load.data.revision}`} initial={load.data} onSaved={() => { setNotice("Saved for the next Hermes gateway start. No model request was made. Restart the gateway after active runs finish."); load.refresh(); }} />
      <div className="grid gap-2 rounded border border-border p-3 text-xs text-muted">
        <p>{load.data.activation}</p>
        <p>Wait for active runs to finish, stop the gateway in its terminal, then start it with:</p>
        <code className="break-all">python3 integrations/hermes-assessment/runtime.py gateway</code>
        <p>{workspace.data?.runner.available ? "Relay can currently reach a Hermes runtime." : "Relay has not confirmed an available Hermes runtime."} Saving a key does not verify model access, credits or a successful response.</p>
      </div>
      <details className="rounded border border-border p-3"><summary className="cursor-pointer text-sm font-medium">MCP tools and other agent clients</summary><div className="mt-3 grid gap-2 text-xs text-muted">
        <p>Server names in this Hermes profile: {load.data.mcp_servers.length ? load.data.mcp_servers.join(", ") : "None"}. These are configuration records, not live connection checks.</p>
        <p>Model setup preserves the profile's tool permissions. Connect Latch through the setup supplied by Plow and your MCP client. Claude, Codex and Pi keep their own model authentication; this form configures Relay's dedicated Hermes profile.</p>
        <a href="https://plow.co/latch" target="_blank" rel="noreferrer" className="text-accent-text underline">Plow Latch connection guide</a>
      </div></details>
    </>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <Button size="sm" onClick={reload}>Reload model settings</Button>
  </section>;
}

function ProviderForm({ initial, onSaved }: { initial: Setup; onSaved: () => void }) {
  const [provider, setProvider] = useState(initial.providers.some(p => p.id === initial.provider) ? initial.provider : "");
  const [model, setModel] = useState(initial.model || "");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(initial.revision);
  const [credentialSaved, setCredentialSaved] = useState(initial.providers.find(p => p.id === provider)?.credential_saved || false);
  async function submit() {
    if (busy) return; setBusy(true); setError("");
    try {
      const result = await api<Setup>("/connections/model-provider", "POST", { revision, provider, model: model.trim(), api_key: key.trim() || null });
      setRevision(result.revision); setKey(""); setCredentialSaved(true); onSaved();
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void submit(); }}>
    <label className="grid gap-1 text-xs">Model provider<select aria-label="Model provider" className="h-9 min-w-0 rounded-md border border-border bg-surface px-2" value={provider} disabled={busy} required onChange={e => { setProvider(e.target.value); setModel(""); setKey(""); setCredentialSaved(initial.providers.find(p => p.id === e.target.value)?.credential_saved || false); }}><option value="">Choose a provider</option>{initial.providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <label className="grid gap-1 text-xs">Model ID<Input aria-label="Model ID" value={model} disabled={busy} required maxLength={160} placeholder="Exact model ID from your provider account" onChange={e => { setModel(e.target.value); }} /></label>
    <label className="grid gap-1 text-xs">Provider API key<Input aria-label="Provider API key" type="password" autoComplete="off" disabled={busy} required={!credentialSaved} minLength={8} maxLength={4096} placeholder={credentialSaved ? "Leave blank to keep this provider's saved key" : "Paste your provider API key"} value={key} onChange={e => { setKey(e.target.value); }} /></label>
    <p className="text-xs text-muted">API credentials stay in the backend's private profile. Use an API model available to your account. Claude or Codex account sign-in is configured in those clients; other Hermes providers remain available through Hermes configuration.</p>
    {provider === "kimi-coding" && <p className="text-xs text-muted">Uses the Moonshot API endpoint. Kimi Code subscription credentials require their separate endpoint in Hermes configuration.</p>}
    <div className="flex flex-wrap gap-2"><Button variant="default" type="submit" disabled={busy || !provider || !model.trim()} pending={busy}>Save Hermes model</Button></div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
  </form>;
}
