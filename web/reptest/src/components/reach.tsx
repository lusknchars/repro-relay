import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Copy, Plus, RefreshCw } from "lucide-react";
import { Button, Input, Badge } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace } from "@/lib/live";
import { useReachEvents } from "@/lib/reach-events";
type Person = { id: string; name: string; role: string };
type Action = {
  title: string;
  member_id: string | null;
  due_on: string | null;
  status: string;
  message_draft: string;
};
type Item = {
  id: string;
  kind: string;
  title: string;
  text: string;
  case_id: string | null;
  project: string | null;
  due_on: string | null;
  members: Person[];
  version: number;
  source_hash: string;
  stale: boolean;
  action: Action | null;
};
type Brief = { items: Item[]; truncated: boolean };
const today = () => new Date().toISOString().slice(0, 10);
export function Reach() {
  const workspace = useWorkspace();
  const [on, setOn] = useState(
    () => new URLSearchParams(location.search).get("day") || today(),
  );
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get("reach") || "",
  );
  const [title, setTitle] = useState("");
  const [member, setMember] = useState("");
  const [due, setDue] = useState("");
  const pendingTodo = useRef<{ key: string; id: string }>();
  const [todo, setTodo] = useState("");
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const feed = useLoad(
    () => api<Brief>(`/reach?on=${encodeURIComponent(on)}`),
    [on],
    15000,
  );
  const [item, setItem] = useState<Item>();
  const listener = useReachEvents(feed.refresh);
  useEffect(() => {
    if (!item && selected) {
      const found = feed.data?.items.find((i) => i.id === selected);
      if (found) select(found);
    }
  }, [feed.data, selected]);
  const canEdit =
    !!workspace.data?.account.enabled &&
    workspace.data.account.role !== "viewer";
  const rows = [...(feed.data?.items || [])]
    .filter(
      (i) =>
        all ||
        i.stale ||
        !["done", "dismissed"].includes(i.action?.status || ""),
    )
    .sort(
      (a, b) =>
        Number(b.kind === "call_transcript") -
        Number(a.kind === "call_transcript"),
    );
  function select(i: Item) {
    setItem(i);
    setSelected(i.id);
    setTitle(i.action?.title || i.title);
    setMember(i.action?.member_id || "");
    setDue(i.action?.due_on || i.due_on || "");
    setError("");
    setNotice("");
  }
  async function perform(fn: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      feed.refresh();
      setNotice(message);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function decide(status: string) {
    if (!item) return;
    const saved = await perform(
      () =>
        api(`/reach/${item.id}/decision`, "PUT", {
          on,
          version: item.version,
          source_hash: item.source_hash,
          title: title || item.action?.title || item.title,
          member_id: member || null,
          due_on: due || null,
          status,
        }),
      status === "planned"
        ? "Action planned. The message is a draft; nothing was sent."
        : "Decision saved. This does not change a test result.",
    );
    if (saved) {
      setSelected("");
      setItem(undefined);
    }
  }
  async function copy(text: string) {
    await perform(() => navigator.clipboard.writeText(text), "Copied.");
  }
  async function addTodo() {
    if (!todo.trim()) return;
    const key = JSON.stringify([on, todo.trim()]);
    if (pendingTodo.current?.key !== key)
      pendingTodo.current = { key, id: crypto.randomUUID() };
    const saved = await perform(
      () =>
        api(`/calendar/${pendingTodo.current!.id}`, "PUT", {
          version: 0,
          pin: {
            title: todo.trim(),
            starts_on: on,
            ends_on: on,
            category: "follow_up",
            status: "planned",
            notes: "Added as a Reach todo",
            case_id: null,
          },
        }),
      "Todo added to Reach and Calendar.",
    );
    if (saved) {
      setTodo("");
      pendingTodo.current = undefined;
    }
  }
  return (
    <section
      aria-label="Reach"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface-2/40 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">Daily follow-ups</h2>
            <Badge>Calls & todos</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">
            Turn call notes into owned actions. Keep your todos and message
            drafts together.
          </p>
          <p
            aria-live="polite"
            className="mt-2 text-xs text-muted"
            data-testid="reach-listener"
          >
            {listener}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Reach day (UTC)"
            type="date"
            value={on}
            onChange={(e) => {
              if (e.target.value) {
                setOn(e.target.value);
                setSelected("");
                setItem(undefined);
              }
            }}
          />
          <Button size="sm" aria-label="Refresh Reach" onClick={feed.refresh}>
            <RefreshCw size={14} />
          </Button>
        </div>
      </header>
      <div className="p-4 space-y-4">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void addTodo();
          }}
        >
          <Input
            aria-label="New Reach todo"
            placeholder="Add a todo…"
            maxLength={160}
            value={todo}
            onChange={(e) => setTodo(e.target.value)}
          />
          <Button disabled={busy || !canEdit || !todo.trim()} type="submit">
            <Plus size={14} />
            Add todo
          </Button>
        </form>
        {!canEdit && (
          <p className="text-xs text-muted">
            Sign in as the local owner to organize actions.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-muted">
            {notice}
          </p>
        )}
        {feed.error && <p role="alert">Reach unavailable: {feed.error}</p>}
        {!feed.data && !feed.error && (
          <p role="status" className="text-sm text-muted">
            Loading follow-ups…
          </p>
        )}
        <label className="flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
          />
          Include done and dismissed
        </label>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="min-w-0">
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    className={`w-full p-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent ${selected === i.id ? "bg-accent-soft" : ""}`}
                    onClick={() => select(i)}
                  >
                    <span className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                      <span>
                        {i.kind === "call_transcript"
                          ? "Call transcript"
                          : "Todo / calendar"}
                      </span>
                      <span>
                        {i.stale
                          ? "Source changed · review again"
                          : i.action?.status || "Needs review"}
                      </span>
                    </span>
                    <span className="mt-1 block break-words text-sm font-medium">
                      {i.action?.title || i.title}
                    </span>
                    <span className="mt-1 block text-xs text-muted">
                      {i.project || "Local team"} ·{" "}
                      {i.members.find((m) => m.id === i.action?.member_id)
                        ?.name || "Unassigned"}
                      {i.action?.due_on || i.due_on
                        ? ` · ${i.action?.due_on || i.due_on}`
                        : " · No due date"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {feed.data && !rows.length && (
              <p className="py-6 text-sm text-muted">
                No open follow-ups for this day. Add a todo or record a request
                with the call tool in Team & call setup.
              </p>
            )}
            {feed.data?.truncated && (
              <p className="text-xs text-muted">
                Showing up to 200 calendar items and 200 call requests. This is
                not the complete history.
              </p>
            )}
          </div>
          <div className="min-w-0 rounded-lg border border-border p-4">
            {item ? (
              <div className="space-y-3" key={item.id}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Review action
                </p>
                <p className="whitespace-pre-wrap break-words rounded-md bg-surface-2 p-3 text-sm">
                  {item.text || item.title}
                </p>
                {item.stale && (
                  <p role="status" className="text-sm text-amber-600">
                    The source or team changed. Review these details before
                    saving again.
                  </p>
                )}
                <label className="block text-xs">
                  Action
                  <Input
                    aria-label="Reach action"
                    maxLength={500}
                    value={title || item.action?.title || item.title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className="block text-xs">
                  Owner
                  <select
                    aria-label="Reach owner"
                    className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm"
                    value={member}
                    onChange={(e) => setMember(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {item.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.role}
                      </option>
                    ))}
                  </select>
                </label>
                {!item.members.length && (
                  <p className="text-xs text-muted">
                    Enable a communication profile in Team to assign an owner.
                    Case-linked items use teammates from that project.
                  </p>
                )}
                <label className="block text-xs">
                  Due date (UTC)
                  <Input
                    aria-label="Reach due date"
                    type="date"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="default"
                    disabled={busy || !canEdit}
                    onClick={() => void decide("planned")}
                  >
                    <Check size={14} />
                    Save action
                  </Button>
                  <Button
                    disabled={busy || !canEdit}
                    onClick={() => void decide("done")}
                  >
                    Mark done
                  </Button>
                  <Button
                    disabled={busy || !canEdit}
                    onClick={() => void decide("dismissed")}
                  >
                    Dismiss
                  </Button>
                </div>
                {item.action && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-semibold">
                      Message draft · not sent
                    </p>
                    <p className="my-2 whitespace-pre-wrap break-words text-sm">
                      {item.action.message_draft}
                    </p>
                    <Button
                      size="sm"
                      disabled={busy || item.stale}
                      onClick={() => void copy(item.action!.message_draft)}
                    >
                      <Copy size={12} />
                      Copy draft
                    </Button>
                    <p className="mt-2 text-xs text-muted">
                      Plow currently permits the connected owner chat only. A
                      teammate profile does not authorize delivery.
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const url = new URL(location.href);
                      url.search = "";
                      url.hash = "";
                      url.searchParams.set("view", "reach");
                      url.searchParams.set("reach", item.id);
                      url.searchParams.set("day", on);
                      void copy(url.toString());
                    }}
                  >
                    Copy local link
                  </Button>
                  {item.case_id && (
                    <a
                      className="inline-flex items-center gap-1 text-xs underline"
                      href={`/?view=work&case=${encodeURIComponent(item.case_id)}`}
                    >
                      Open case
                      <ArrowUpRight size={12} />
                    </a>
                  )}
                </div>
                <p className="text-xs text-muted">
                  Local links open this installation. They do not grant access
                  to another device.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted">
                Select a transcript or todo to review its action, owner and due
                date.
              </p>
            )}
          </div>
        </div>
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Use Reach in your terminal or agent
          </summary>
          <div className="mt-3 space-y-3 text-xs text-muted">
            <p>
              No new account or model call is needed to read your daily queue.
            </p>
            {[
              "./relay reach today",
              "./relay reach listen --cursor-file .data/reach/listener.cursor",
              "./relay reach mcp --allow-workspace-context",
              "./relay reach plow-check",
            ].map((command) => (
              <div className="flex items-start gap-2" key={command}>
                <code className="min-w-0 flex-1 break-all rounded bg-surface-2 p-2">
                  {command}
                </code>
                <Button size="sm" onClick={() => void copy(command)}>
                  Copy
                </Button>
              </div>
            ))}
            <p>
              The listener prints new todo and meeting events as JSON lines. The
              workspace MCP exposes reach_events, the daily brief and action
              proposals. Hermes can read new events and suggest actions;
              decisions stay here. Connecting the listener does not start a
              model.
            </p>
            <p>
              For a call, select its case and participant in Team → Call
              context. Use{" "}
              <code>
                ./relay reach call --case CASE_ID --member MEMBER_UUID --consent
              </code>{" "}
              in a compatible host. The host supplies transcripts; Reach does
              not join a meeting, record a microphone or verify the speaker.
            </p>
            <p>
              Source text is untrusted context. Planning a todo does not start
              code changes, approve messages or mark tests passed. Dates are
              UTC; call requests cover the last 30 days.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
