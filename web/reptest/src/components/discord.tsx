import { useRef, useState } from "react";
import { MessageSquare, RefreshCw, ExternalLink } from "lucide-react";
import { Button, Badge, Input } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace } from "@/lib/live";

type Watch = { guild_id: string; guild_name: string; channel_id: string; channel_name: string; enabled: boolean; last_checked: string | null; last_error: string | null; last_imported: number; catch_up: boolean };
type Connection = { configured: boolean; bot?: { name: string }; install_url?: string; watch?: Watch };
type Choice = { id: string; name: string };
type Message = { id: string; channel_id: string; author_id: string; author: string; text: string; url: string; timestamp: string; edited_at?: string; captured_at: string; source_hash: string };
const field = "grid gap-1 text-xs";
const select = "h-9 min-w-0 rounded-md border border-border bg-surface px-2";
function useAdmin() { const { data } = useWorkspace(); return data?.account.role ? data.account.role === "owner" : !!data?.account.local_access; }
function WatchStatus({ connection }: { connection?: Connection }) {
  const w = connection?.watch;
  return <div className="grid gap-1 text-xs text-muted">
    <p>{!connection ? "Checking Discord…" : !connection.configured ? "Not connected" : !w ? `${connection.bot?.name || "Bot"} connected · Choose a channel` : `${w.guild_name} / #${w.channel_name} · ${w.enabled ? w.last_error ? "Collection needs attention" : w.catch_up ? "Catching up" : "Collection enabled" : "Paused"}`}</p>
    {w?.last_checked && <p>Last successful fetch {new Date(w.last_checked).toLocaleString()} · {w.last_imported} new or updated messages</p>}
    {w?.last_error && <p role="alert" className="text-danger">{w.last_error}</p>}
  </div>;
}
export function DiscordConnection() {
  const connection = useLoad(() => api<Connection>("/connections/discord"), [], 5000);
  const admin = useAdmin();
  const [token, setToken] = useState("");
  const [guilds, setGuilds] = useState<Choice[]>();
  const [channels, setChannels] = useState<Choice[]>([]);
  const [guild, setGuild] = useState("");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  async function perform(fn: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try { await fn(); connection.refresh(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function servers() { setGuilds((await api<{ items: Choice[] }>("/connections/discord/guilds")).items); }
  async function chooseServer(id: string) {
    setGuild(id); setChannel(""); setChannels([]);
    if (id) await perform(async () => { setChannels((await api<{ items: Choice[] }>(`/connections/discord/guilds/${id}/channels`)).items); });
  }
  return <section aria-label="Discord connection" className="grid gap-4 rounded-lg border border-border-strong p-4">
    <div className="flex items-center justify-between"><h3 className="font-medium">Discord discussion → Reach</h3><Badge tone="outline">{connection.data?.configured ? "Bot connected" : "Setup required"}</Badge></div>
    <p className="text-sm text-muted">Collect text from one team channel. Relay saves authors, timestamps and message links. Select useful messages in Reach to make todos.</p>
    <WatchStatus connection={connection.data} />
    {admin && <>
      <details open={!connection.data?.configured} className="rounded border border-border p-3">
        <summary className="cursor-pointer text-sm font-medium">1. Connect your Discord bot</summary>
        <div className="mt-3 grid gap-3">
          <p className="text-xs text-muted">Create an application in the Discord Developer Portal. On its Bot page, enable Message Content Intent and copy the bot token. This is a one-time setup for the administrator; teammates use their existing Discord accounts.</p>
          <a className="text-xs text-accent-text underline" href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Open Discord Developer Portal</a>
          <form className="grid gap-2" onSubmit={e => { e.preventDefault(); void perform(async () => {
            const result = await api<{ message_content: boolean }>("/connections/discord", "POST", { token: token.trim() }); setToken(""); setGuild(""); setChannel(""); setChannels([]); setGuilds(undefined);
            setNotice(result.message_content ? "Bot identity checked and token saved privately. Add the bot to your server, then choose a channel." : "Bot connected. Enable Message Content Intent in Discord before starting collection.");
          }); }}>
            <label className={field}>Discord bot token<Input required type="password" autoComplete="off" value={token} minLength={10} maxLength={4096} onChange={e => setToken(e.target.value)} /></label>
            <Button type="submit" variant="default" disabled={busy || !token.trim()} pending={busy}>Connect Discord bot</Button>
          </form>
          <p className="text-xs text-muted">The token stays in a private backend file. Personal account tokens are not accepted.</p>
        </div>
      </details>
      {connection.data?.configured && <>
        <div className="grid gap-2"><h4 className="text-sm font-medium">2. Add the bot and choose a channel</h4>
          {connection.data.install_url && <a className="text-sm text-accent-text underline" href={connection.data.install_url} target="_blank" rel="noreferrer">Add bot to your Discord server <ExternalLink size={12} className="inline" /></a>}
          <p className="text-xs text-muted">Requests View Channels and Read Message History. Grant access only to channels you want Relay to read; send-message permission is not requested.</p>
          <Button disabled={busy} onClick={() => void perform(servers)}><RefreshCw size={14} />Load Discord servers</Button>
          {guilds && !guilds.length && <p className="text-sm text-muted">No servers returned. Add the bot to your server, then load again.</p>}
          {guilds && guilds.length > 0 && <label className={field}>Discord server<select aria-label="Discord server" className={select} value={guild} disabled={busy} onChange={e => void chooseServer(e.target.value)}><option value="">Choose a server</option>{guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
          {guild && <label className={field}>Discord text channel<select aria-label="Discord text channel" className={select} value={channel} disabled={busy} onChange={e => setChannel(e.target.value)}><option value="">Choose a text channel</option>{channels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}</select></label>}
          <p className="text-xs text-muted">Start collecting copies the latest 50 messages, then checks for new messages every 30 seconds while this backend runs. DMs, threads, attachments and voice are excluded. Let your team know this channel is shared with Relay.</p>
          <Button variant="default" disabled={busy || !guild || !channel} onClick={() => void perform(async () => { await api("/connections/discord/watch", "POST", { guild_id: guild, channel_id: channel }); setNotice("Collection enabled for this channel. The first fetch runs within 30 seconds."); })}>Start collecting channel</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {connection.data.watch?.enabled ? <Button disabled={busy} onClick={() => void perform(async () => { await api("/connections/discord/pause", "POST"); setNotice("Collection paused. Saved messages remain available."); })}>Pause Discord collection</Button> : connection.data.watch && <Button disabled={busy} onClick={() => void perform(async () => { await api("/connections/discord/watch", "POST", { guild_id: connection.data!.watch!.guild_id, channel_id: connection.data!.watch!.channel_id }); setNotice("Collection resumed."); })}>Resume Discord collection</Button>}
          <Button disabled={busy || !connection.data.watch?.enabled} onClick={() => void perform(async () => { const result = await api<{ imported: number; empty: boolean }>("/connections/discord/sync", "POST"); setNotice(result.empty && result.imported === 0 ? "No new text returned. If you expected messages, check View Channel and Read Message History permissions." : `${result.imported} new or updated messages saved. Open Reach to review.`); })}>Sync Discord now</Button>
          <Button disabled={busy} onClick={() => void perform(async () => { await api("/connections/discord/disconnect", "POST"); setNotice("Disconnected. Collection stopped; captured messages and todos remain."); })}>Disconnect Discord</Button>
        </div>
      </>}
      <details className="rounded border border-border p-3"><summary className="cursor-pointer text-xs text-muted">Stored discussion</summary><div className="mt-3 grid gap-2"><p className="text-xs text-muted">Clear removes captured Discord messages and pauses collection. Todos already created retain their source text and links.</p><label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmClear} onChange={e => setConfirmClear(e.target.checked)} />Remove the captured Discord messages from this installation</label><Button disabled={!confirmClear || busy} onClick={() => void perform(async () => { await api("/connections/discord/clear", "POST"); setConfirmClear(false); setNotice("Captured messages removed. Collection is paused. Existing todos are preserved."); })}>Clear captured messages</Button></div></details>
    </>}
    {(error || connection.error) && <p role="alert" className="text-sm text-danger">{error || connection.error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}

export function DiscordDiscussion() {
  const connection = useLoad(() => api<Connection>("/connections/discord"), [], 15000);
  const [before, setBefore] = useState("");
  const history = useLoad(() => api<{ items: Message[]; next_before?: string }>(`/discord/messages${before ? `?before=${before}` : ""}`), [before], 15000);
  const admin = useAdmin();
  const [source, setSource] = useState<Message>();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const request = useRef<{ id: string; channel_id: string; message_id: string; source_hash: string; title: string; due_on: string }>();
  async function save() {
    if (!source || busy) return;
    const value = { channel_id: source.channel_id, message_id: source.id, source_hash: source.source_hash, title: title.trim(), due_on: due };
    if (!request.current || JSON.stringify({ ...request.current, id: undefined }) !== JSON.stringify(value)) request.current = { ...value, id: crypto.randomUUID() };
    setBusy(true); setError(""); setNotice("");
    try { await api("/discord/actions", "POST", request.current); setSource(undefined); request.current = undefined; setNotice("Todo saved in Reach and Calendar with its Discord source. No message was sent."); }
    catch (e) { setError(errorText(e)); history.refresh(); } finally { setBusy(false); }
  }
  return <section aria-label="Discord discussion" className="grid gap-3 rounded-lg border border-border bg-surface p-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold"><MessageSquare size={18} />Discord discussion</h2><a className="text-xs text-accent-text underline" href="/?view=settings&connection=discord">{connection.data?.configured ? "Manage Discord" : "Connect Discord"}</a></header>
    <WatchStatus connection={connection.data} />
    <p className="text-xs text-muted">Captured channel text. Recent edits are checked; deletions and older edits are not mirrored. Creating a todo checks its source again. Discord names are not verified phone identities.</p>
    {(error || history.error || connection.error) && <p role="alert" className="text-sm text-danger">{error || history.error || connection.error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {history.data && !history.data.items.length && <p className="text-sm text-muted">No discussion captured on this page. Connect a bot and select a channel in Settings.</p>}
    <div className="grid max-h-80 gap-2 overflow-auto">{history.data?.items.map(m => <article key={`${m.channel_id}-${m.id}`} className="grid gap-2 rounded border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted">{m.author} · {new Date(m.timestamp).toLocaleString()}{m.edited_at ? " · Edited" : ""}</p><a href={m.url} target="_blank" rel="noreferrer" className="text-xs text-accent-text underline">Open in Discord</a></div>
      <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>
      <div className="flex items-center justify-between gap-2"><span className="text-xs text-muted">Captured {new Date(m.captured_at).toLocaleTimeString()}</span><Button size="sm" disabled={!admin || busy} onClick={() => { setSource(m); setTitle(Array.from(m.text).slice(0, 160).join("")); setError(""); }}>Make Reach todo</Button></div>
    </article>)}</div>
    <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { setBefore(""); history.refresh(); connection.refresh(); }}>Latest captured messages</Button>{history.data?.next_before && <Button size="sm" onClick={() => setBefore(history.data!.next_before!)}>Older captured messages</Button>}</div>
    {source && <form aria-label="Discord todo" className="grid gap-2 rounded border border-border p-3" onSubmit={e => { e.preventDefault(); void save(); }}><p className="text-xs text-muted">From {source.author}'s message. Assign a teammate after saving in Reach.</p><label className={field}>Discord todo title<Input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} /></label><label className={field}>Discord todo due date<Input type="date" required value={due} onChange={e => setDue(e.target.value)} /></label><div className="flex gap-2"><Button type="submit" variant="default" disabled={busy || !title.trim()}>Save Discord todo</Button><Button type="button" disabled={busy} onClick={() => setSource(undefined)}>Cancel</Button></div></form>}
  </section>;
}
