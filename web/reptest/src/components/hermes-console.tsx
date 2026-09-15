import { useId, useRef, useState } from "react";
import { RotateCcw, Square } from "lucide-react";
import { api, useLoad, errorText, when } from "@/lib/live";
import { Button, Badge } from "@/components/ui";

type ToolEvent = {
  event: "tool.started" | "tool.completed";
  tool: string;
  preview?: string | null;
  duration?: number | null;
  error?: boolean | null;
};
type ConsoleRun = {
  id: string;
  session_id: string;
  prompt: string;
  status: "starting" | "running" | "stopping" | "completed" | "failed" | "stopped";
  output: string | null;
  usage: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null;
  tool_events: ToolEvent[];
  error: string | null;
  created_at: string;
};
type ConsoleFeed = {
  items: ConsoleRun[];
  available: boolean;
  active: boolean;
  limit_seconds: number;
};

const STATUS: Record<ConsoleRun["status"], string> = {
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
};
const SESSION_KEY = "relay-console-session";

function restoredSession() {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) return saved;
  } catch {
    // Storage can be unavailable; a fresh session only hides earlier runs.
  }
  return crypto.randomUUID();
}

function toolName(tool: string) {
  return tool.replace(/^mcp__/, "").replace(/__/g, " · ");
}

function usageText(run: ConsoleRun) {
  const u = run.usage;
  if (u && typeof u.total_tokens === "number")
    return `${u.input_tokens ?? "?"} in · ${u.output_tokens ?? "?"} out · ${u.total_tokens} tokens`;
  return run.status === "starting" || run.status === "running"
    ? "Tokens are reported when the run ends"
    : "Usage not reported";
}

/** Owner-only prompt runner for the local Hermes runtime. Nothing runs until Run prompt. */
export function HermesConsole() {
  const [session, setSession] = useState(restoredSession);
  const feed = useLoad(
    () =>
      api<ConsoleFeed>(
        `/hermes/console?session_id=${encodeURIComponent(session)}`,
      ),
    [session],
    2000,
  );
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{ prompt: string; id: string }>();
  const promptId = useId();
  const active = !!feed.data?.active;
  const unavailable = feed.data?.available === false;

  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
      feed.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  function startSession() {
    const next = crypto.randomUUID();
    try {
      sessionStorage.setItem(SESSION_KEY, next);
    } catch {
      // The new session still works for this page view.
    }
    pending.current = undefined;
    setSession(next);
  }

  return (
    <section
      aria-label="Hermes test console"
      data-glass-panel=""
      className="mx-4 mb-4 grid min-w-0 gap-3 rounded-[20px] border border-border p-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold">Test console</h2>
          <p className="text-xs text-muted">
            Only the administrator sees this. A run starts when you press Run
            prompt, uses read-only tools and stops after{" "}
            {feed.data?.limit_seconds ?? 120} seconds.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>
            {unavailable
              ? "Hermes not connected"
              : active
                ? "Run in progress"
                : "Ready"}
          </Badge>
          <Button disabled={busy || active} onClick={startSession}>
            <RotateCcw size={14} aria-hidden /> New session
          </Button>
        </div>
      </header>
      {(error || feed.error) && (
        <p role="alert" className="text-sm text-danger">
          {error || feed.error}
        </p>
      )}
      {!!feed.data?.items.length && (
        <ol
          aria-label="Console runs"
          className="grid max-h-[480px] min-w-0 gap-3 overflow-y-auto"
        >
          {feed.data.items.map((run) => (
            <li
              key={run.id}
              className="grid min-w-0 gap-2 rounded-xl border border-border p-3"
            >
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 text-sm font-medium whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {run.prompt}
                </p>
                <Badge>{STATUS[run.status]}</Badge>
              </div>
              {!!run.tool_events.length && (
                <ul
                  aria-label="Tool calls"
                  className="grid gap-1 text-xs text-muted"
                >
                  {run.tool_events.map((event, index) => (
                    <li key={index} className="[overflow-wrap:anywhere]">
                      {event.event === "tool.started"
                        ? "Started"
                        : event.error
                          ? "Failed"
                          : "Completed"}{" "}
                      <code>{toolName(event.tool)}</code>
                      {event.preview ? ` · ${event.preview}` : ""}
                      {typeof event.duration === "number"
                        ? ` · ${event.duration} s`
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
              {run.output && (
                <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {run.output}
                </p>
              )}
              {run.error && (
                <p className="text-xs text-danger [overflow-wrap:anywhere]">
                  {run.error}
                </p>
              )}
              <footer className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                <span>{usageText(run)}</span>
                <time dateTime={run.created_at}>{when(run.created_at)}</time>
                {(run.status === "starting" || run.status === "running") && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        await api(
                          `/hermes/console/${encodeURIComponent(run.id)}/stop`,
                          "POST",
                          {},
                        );
                      })
                    }
                  >
                    <Square size={12} aria-hidden /> Stop run
                  </Button>
                )}
              </footer>
            </li>
          ))}
        </ol>
      )}
      <form
        className="grid gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            const text = prompt.trim();
            if (!text) return;
            // A retried click reuses the same ID, so Relay replays instead of starting twice.
            if (pending.current?.prompt !== text)
              pending.current = { prompt: text, id: crypto.randomUUID() };
            await api("/hermes/console", "POST", {
              id: pending.current.id,
              session_id: session,
              prompt: text,
            });
            pending.current = undefined;
            setPrompt("");
          });
        }}
      >
        {/* Linked by id: a wrapping label would fold the typed prompt into the field's name. */}
        <label htmlFor={promptId} className="text-sm">
          Prompt for Hermes
        </label>
        <textarea
          id={promptId}
          className="block min-h-16 max-h-40 w-full resize-y rounded-xl border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          rows={2}
          value={prompt}
          maxLength={4000}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask Hermes to read a file in your Plow folder or check its tools"
        />
        <Button
          type="submit"
          variant="default"
          className="justify-self-start"
          disabled={busy || active || unavailable || !prompt.trim()}
          pending={busy}
        >
          Run prompt
        </Button>
      </form>
    </section>
  );
}
