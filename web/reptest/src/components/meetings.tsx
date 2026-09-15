import { useEffect, useRef, useState } from "react";
import type { DailyCall } from "@daily-co/daily-js";
import { Video, Link as LinkIcon } from "lucide-react";
import { Button, Badge, Input } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace } from "@/lib/live";

type Room = { id: string; title: string; case_id: string | null; url: string | null; status: string; error?: string; expires_at: number; minutes: number };
type Segment = { id: string; participant_id: string; speaker: string; timestamp: string; text: string };
const field = "grid gap-1 text-xs";
const select = "h-9 min-w-0 rounded-md border border-border bg-surface px-2";
function useAdmin() {
  const { data } = useWorkspace();
  return data?.account.role ? data.account.role === "owner" : !!data?.account.local_access;
}
export function DailyConnection() {
  const connection = useLoad(() => api<{ configured: boolean }>("/connections/daily"));
  const admin = useAdmin();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function save(disconnect = false) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api(disconnect ? "/connections/daily/disconnect" : "/connections/daily", "POST", disconnect ? {} : { token: key.trim() });
      setKey(""); connection.refresh(); setNotice(disconnect ? "Daily disconnected. Saved transcripts remain in Relay." : "Daily access checked. Create your first call in Reach.");
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <section aria-label="Daily connection" className="grid gap-3 rounded-lg border border-border-strong p-4">
    <div className="flex items-center justify-between"><h3 className="font-medium">Video calls in Reach</h3><Badge tone="outline">{connection.data?.configured ? "Key saved" : "Not configured"}</Badge></div>
    <p className="text-sm text-muted">Connect one Daily account for this installation. Teammates join the shared meeting link in their browser; they do not need API keys or a Relay account.</p>
    {admin && <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label className={field}>Daily API key<Input type="password" autoComplete="off" required maxLength={4096} value={key} onChange={e => setKey(e.target.value)} /></label>
      <div className="flex flex-wrap gap-2"><Button type="submit" variant="default" disabled={busy || !key.trim()} pending={busy}>Connect Daily</Button>{connection.data?.configured && <Button type="button" disabled={busy} onClick={() => void save(true)}>Disconnect Daily</Button>}</div>
    </form>}
    {(error || connection.error) && <p role="alert" className="text-sm text-danger">{error || connection.error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <a className="text-sm text-accent-text underline" href="https://dashboard.daily.co/" target="_blank" rel="noreferrer">Open Daily dashboard</a>
    <p className="text-xs text-muted">The key stays in a private backend file. Connecting checks access without creating a call. Daily bills participant minutes and optional transcription separately from model usage.</p>
  </section>;
}

export function ReachMeetings() {
  const admin = useAdmin();
  const rooms = useLoad(() => api<{ items: Room[] }>("/meetings"), [], 15000);
  const connection = useLoad(() => api<{ configured: boolean }>("/connections/daily"));
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [selected, setSelected] = useState<Room>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<{ id: string; title: string; minutes: number; case_id: string | null }>();
  async function create(retry?: Room) {
    setBusy(true); setError("");
    const input = retry ? { id: retry.id, title: retry.title, minutes: retry.minutes, case_id: retry.case_id } : { title: title.trim(), minutes, case_id: null };
    if (retry) request.current = { ...input, id: retry.id };
    else if (!request.current || request.current.title !== input.title || request.current.minutes !== minutes) request.current = { ...input, id: crypto.randomUUID() };
    try { const room = await api<Room>("/meetings", "POST", request.current); setSelected(room); request.current = undefined; setTitle(""); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); rooms.refresh(); }
  }
  // Public guests use Daily's waiting room, never this installation's API.
  if (!admin) return <section className="rounded-lg border border-border p-4 text-sm text-muted">The administrator creates calls in Reach and shares a meeting link with teammates.</section>;
  return <section aria-label="Reach video calls" className="grid gap-4 rounded-lg border border-border bg-surface p-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="flex items-center gap-2 font-semibold"><Video size={18} />Team calls</h2><p className="mt-1 text-xs text-muted">Meet here. Turn a transcript passage into a Reach todo.</p></div><a className="text-xs text-accent-text underline" href="/?view=settings&connection=daily">Video connection</a></header>
    {!connection.data?.configured && <p className="text-sm text-muted">Connect Daily in Settings to create a private meeting link.</p>}
    {!selected && <>
      <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); void create(); }}>
        <label className={`${field} min-w-48 flex-1`}>Meeting title<Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Repository planning" maxLength={120} required /></label>
        <label className={field}>Room expires after<select className={select} value={minutes} onChange={e => setMinutes(Number(e.target.value))}><option value={30}>30 minutes</option><option value={60}>1 hour</option><option value={120}>2 hours</option></select></label>
        <Button type="submit" variant="default" disabled={busy || !connection.data?.configured || !title.trim()} pending={busy}>Create call</Button>
      </form>
      <div className="grid max-h-56 overflow-auto divide-y divide-border">{rooms.data?.items.map(r => <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><div><p className="text-sm font-medium">{r.title}</p><p className="text-xs text-muted">{r.status} · {new Date(r.expires_at * 1000).toLocaleString()}</p>{r.error && <p className="text-xs text-danger">{r.error}</p>}</div><div className="flex gap-2">{["unknown", "creating"].includes(r.status) && <Button size="sm" disabled={busy} onClick={() => void create(r)}>Check room</Button>}<Button size="sm" onClick={() => setSelected(r)}>Open meeting</Button></div></div>)}</div>
    </>}
    {(error || connection.error || rooms.error) && <p role="alert" className="text-sm text-danger">{error || connection.error || rooms.error}</p>}
    {selected && <MeetingRoom key={selected.id} initial={selected} onBack={() => { setSelected(undefined); rooms.refresh(); }} />}
  </section>;
}

function MeetingRoom({ initial, onBack }: { initial: Room; onBack: () => void }) {
  const [room, setRoom] = useState(initial);
  const path = `/meetings/${room.id}`;
  const transcript = useLoad(() => api<{ items: Segment[] }>(`${path}/transcript`), [room.id], 5000);
  const container = useRef<HTMLDivElement>(null);
  const client = useRef<DailyCall>();
  const mounted = useRef(true);
  const capturing = useRef(false);
  const queue = useRef<Segment[]>([]);
  const saving = useRef(false);
  const ids = useRef(new Map<string, string>());
  const [pending, setPending] = useState(0);
  const [state, setState] = useState("Not joined");
  const [capture, setCapture] = useState("Off");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState<Segment>();
  const [task, setTask] = useState("");
  const [due, setDue] = useState(new Date().toISOString().slice(0, 10));
  const todoRequest = useRef<{ id: string; segment_id: string; title: string; due_on: string }>();
  const ready = room.status === "ready" && room.expires_at * 1000 > Date.now();
  async function flush() {
    if (saving.current) return false;
    saving.current = true;
    try {
      while (queue.current.length) {
        const batch = queue.current.slice(0, 20);
        await api(`${path}/transcript`, "POST", { segments: batch });
        queue.current.splice(0, batch.length);
        if (mounted.current) { setPending(queue.current.length); setSaveError(""); transcript.refresh(); }
      }
      return true;
    } catch (e) { if (mounted.current) setSaveError(`Transcript not saved: ${errorText(e)} Retry before leaving this page.`); return false; }
    finally { saving.current = false; }
  }
  useEffect(() => {
    mounted.current = true;
    function warn(e: BeforeUnloadEvent) { if (client.current || queue.current.length) { e.preventDefault(); e.returnValue = ""; } }
    function guardNavigation(e: Event) { if (client.current || queue.current.length) { e.preventDefault(); setError("Leave the call and save pending transcript passages before switching sections."); } }
    window.addEventListener("relay:before-navigate", guardNavigation);
    window.addEventListener("beforeunload", warn);
    return () => {
      mounted.current = false; window.removeEventListener("beforeunload", warn);
      window.removeEventListener("relay:before-navigate", guardNavigation);
      const call = client.current; client.current = undefined;
      if (call) { if (capturing.current) call.stopTranscription(); void call.destroy().catch(() => {}); }
      void flush();
    };
  }, []);
  async function join() {
    setBusy(true); setError(""); setState("Connecting");
    try {
      const { createDailyClient } = await import("@/lib/daily-client");
      const access = await api<{ url: string; token: string }>(`${path}/join`, "POST");
      if (!mounted.current || !container.current) return;
      const call = createDailyClient(container.current); client.current = call;
      call.on("joined-meeting", () => { if (mounted.current) setState("Joined"); });
      call.on("left-meeting", () => { if (mounted.current) { setState("Left call"); setCapture("Off"); } capturing.current = false; });
      call.on("error", () => { if (mounted.current) { setError("Daily reported a call error. Check camera, microphone and network access, then leave and retry."); setState("Call error"); } });
      call.on("transcription-started", () => { if (mounted.current && capturing.current) setCapture("Live"); });
      call.on("transcription-stopped", () => { capturing.current = false; if (mounted.current) setCapture("Off"); });
      call.on("transcription-error", () => { if (mounted.current) { setCapture("Error"); setError("Daily could not confirm transcription. Check transcription access and billing in Daily, then stop or retry."); } });
      call.on("transcription-message", e => {
        if (!e || !capturing.current) return;
        const text = e.text.trim(); if (!text) return;
        const timestamp = new Date(e.timestamp).toISOString();
        const key = JSON.stringify([e.participantId, timestamp, text]);
        if (ids.current.has(key)) return;
        const id = crypto.randomUUID(); ids.current.set(key, id);
        const speaker = Object.values(call.participants()).find(p => p.session_id === e.participantId)?.user_name || "Unidentified speaker";
        // Preserve long passages as separate bounded segments, never truncate speech silently.
        const chars = Array.from(text);
        for (let i = 0; i < chars.length; i += 2000) queue.current.push({ id: i ? crypto.randomUUID() : id, participant_id: e.participantId, timestamp, speaker: Array.from(speaker).slice(0, 100).join(""), text: chars.slice(i, i + 2000).join("") });
        if (mounted.current) setPending(queue.current.length);
        void flush();
      });
      await call.join({ url: access.url, token: access.token });
    } catch { setError("Unable to join. Check Daily connection, room expiry, browser support and camera permissions."); setState("Join failed"); if (client.current) { await client.current.destroy().catch(() => {}); client.current = undefined; } }
    finally { if (mounted.current) setBusy(false); }
  }
  async function transcriptionControl(start: boolean) {
    if (busy || !client.current) return;
    setBusy(true); setError("");
    try {
      if (start) {
        await api(`${path}/capture`, "POST", { enabled: true, consent_acknowledged: consent });
        capturing.current = true; setCapture("Starting…"); client.current?.startTranscription();
      } else { setCapture("Stopping…"); client.current?.stopTranscription(); }
    } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function leave() {
    if (capturing.current) { client.current?.stopTranscription(); setCapture("Stopping…"); setError("Wait for transcription to stop, then leave the call."); return; }
    setBusy(true); setError("");
    try {
      await client.current?.leave(); await client.current?.destroy(); client.current = undefined;
      setState("Left call"); setCapture("Off"); await flush();
    } catch { setError("Could not confirm leaving the call. Close the room to end access for everyone."); }
    finally { setBusy(false); }
  }
  async function close() {
    if (!await flush()) { setError("Save pending transcript passages before closing the room."); return; }
    setBusy(true); setError("");
    try { const r = await api<Room>(`${path}/close`, "POST"); setRoom(r); await client.current?.destroy(); client.current = undefined; capturing.current = false; setState("Room closed"); setCapture("Off"); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  async function createTodo() {
    if (!source) return;
    const value = { segment_id: source.id, title: task.trim(), due_on: due };
    if (!todoRequest.current || todoRequest.current.segment_id !== value.segment_id || todoRequest.current.title !== value.title || todoRequest.current.due_on !== due) todoRequest.current = { ...value, id: crypto.randomUUID() };
    setBusy(true); setError("");
    try { await api(`${path}/actions`, "POST", todoRequest.current); setSource(undefined); setNotice("Todo saved in Reach and Calendar. Assign its teammate and review any message from Reach."); todoRequest.current = undefined; }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <div className="grid gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium">{room.title}</h3><p className="text-xs text-muted">{room.status} · Expires {new Date(room.expires_at * 1000).toLocaleTimeString()}</p></div><Button disabled={!!client.current || pending > 0 || busy} onClick={onBack}>All calls</Button></div>
    {room.url && ready && <div className="flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 break-all rounded border border-border p-2 text-xs">{room.url}</code><Button onClick={() => { void navigator.clipboard.writeText(room.url!).then(() => setNotice("Guest link copied. Join as host to admit teammates."), () => setError("Copy failed. Select and copy the meeting link.")); }}><LinkIcon size={14} />Copy meeting link</Button></div>}
    <p className="text-xs text-muted">Guests join through Daily’s waiting room. Admit them from the call. Rooms allow up to 12 people and expire from creation time.</p>
    <div className="flex flex-wrap items-center gap-2"><Badge tone={state === "Joined" ? "ok" : "outline"}>{state}</Badge>{!client.current ? <Button variant="default" disabled={!ready || busy} onClick={() => void join()}>Join in Relay</Button> : <Button disabled={busy} onClick={() => void leave()}>Leave call</Button>}{ready && <Button disabled={busy || pending > 0 || capturing.current} onClick={() => void close()}>End room for everyone</Button>}</div>
    <div ref={container} className={client.current || state === "Connecting" ? "h-[480px] min-h-80 overflow-hidden rounded-lg bg-surface-2" : "hidden"} aria-label="Embedded video call" />
    {state === "Joined" && <div className="grid gap-2 rounded border border-border p-3">
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} disabled={capturing.current} onChange={e => setConsent(e.target.checked)} />Everyone has agreed to transcription and saving the transcript in Relay.</label>
      <div className="flex flex-wrap items-center gap-2"><Badge tone={capture === "Live" ? "ok" : "outline"}>Transcription: {capture}</Badge><Button disabled={busy || !consent || capturing.current} onClick={() => void transcriptionControl(true)}>Start transcription</Button><Button disabled={busy || !capturing.current} onClick={() => void transcriptionControl(false)}>Stop transcription</Button></div>
      <p className="text-xs text-muted">Keep this page open to capture speech. Daily processes the audio; Relay saves text only. Transcription uses your Daily account. Leaving this page stops host capture.</p>
    </div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}{notice && <p role="status" className="text-sm">{notice}</p>}
    {pending > 0 && <div className="grid gap-2 rounded border border-border p-3 text-sm"><p>{pending} transcript passages awaiting save. Keep this page open.</p>{saveError && <p role="alert" className="text-danger">{saveError}</p>}<div className="flex gap-2"><Button onClick={() => void flush()}>Retry transcript save</Button><Button onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(queue.current, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `relay-transcript-${room.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download unsaved passages</Button></div></div>}
    <section aria-label="Saved meeting transcript" className="grid gap-2 border-t border-border pt-3"><h4 className="text-sm font-semibold">Saved transcript</h4><p className="text-xs text-muted">Latest 500 passages. Speaker labels are unverified; select a passage to make a todo. Creating a todo does not send a Plow message.</p>
      {transcript.error && <p role="alert" className="text-sm text-danger">{transcript.error}</p>}
      {!transcript.data?.items.length && <p className="text-sm text-muted">No transcript passages saved yet.</p>}
      <div className="grid max-h-72 gap-2 overflow-auto">{transcript.data?.items.map(s => <article key={s.id} className="rounded border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs text-muted">{s.speaker} · {new Date(s.timestamp).toLocaleTimeString()}</span><Button size="sm" disabled={busy} onClick={() => { setSource(s); setTask(Array.from(s.text).slice(0, 160).join("")); }}>Make todo</Button></div><p className="mt-2 whitespace-pre-wrap text-sm">{s.text}</p></article>)}</div>
      {source && <form aria-label="Create transcript todo" className="grid gap-2 rounded border border-border p-3" onSubmit={e => { e.preventDefault(); void createTodo(); }}><label className={field}>Todo title<Input required maxLength={160} value={task} onChange={e => setTask(e.target.value)} /></label><label className={field}>Due date<Input type="date" required value={due} onChange={e => setDue(e.target.value)} /></label><div className="flex gap-2"><Button type="submit" variant="default" disabled={busy || !task.trim()}>Save Reach todo</Button><Button type="button" disabled={busy} onClick={() => setSource(undefined)}>Cancel</Button></div></form>}
    </section>
  </div>;
}
