import { useState } from "react";
import {
  CalendarClock,
  Plus,
  Play,
  Pause,
  RefreshCw,
  ArrowUpRight,
  FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace, when } from "@/lib/live";
import "./agent-programs.css";

type Settings = {
  name: string;
  case_id: string;
  routine: string;
  first_at: string;
  repeat: string;
  automatic: boolean;
  max_seconds: number;
};
type Program = {
  id: string;
  version: number;
  settings: Settings;
  enabled: boolean;
  next_at: string | null;
};
type Occurrence = {
  id: string;
  program_id: string;
  program_name: string;
  scheduled_at: string;
  state: string;
  detail: string;
  run_id: string | null;
  case_id: string;
};
type Feed = {
  items: Program[];
  occurrences: Occurrence[];
  history_limit: number;
};
const presets = [
  {
    id: "smoke",
    name: "Smoke check",
    description: "Check the essential path of a saved reproduction.",
  },
  {
    id: "regression",
    name: "Regression review",
    description: "Check available tests around the reported problem.",
  },
  {
    id: "triage",
    name: "Test triage",
    description: "Sort failed, blocked and missing test evidence.",
  },
];
const localTime = (iso: string) => {
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
const initial = (): Settings => ({
  name: "Daily test triage",
  case_id: "",
  routine: "triage",
  first_at: new Date(Date.now() + 3600000).toISOString(),
  repeat: "daily",
  automatic: true,
  max_seconds: 120,
});
export function AgentPrograms({ onWork }: { onWork: (id: string) => void }) {
  const workspace = useWorkspace();
  const feed = useLoad(() => api<Feed>("/programs"), [], 5000);
  const owner = workspace.data?.account.role === "owner";
  const [draft, setDraft] = useState<Settings>(initial);
  const [editing, setEditing] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const preview = useLoad(
    () =>
      draft.case_id
        ? api<{ context_hash: string; build: string; case_revision: number }>(
            `/cases/${draft.case_id}/investigation-preview`,
          )
        : Promise.resolve(null),
    [draft.case_id, editing?.id],
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const programs = feed.data?.items || [];
  function create() {
    setDraft(initial());
    setEditing({ id: crypto.randomUUID(), version: 0 });
    setError("");
    setNotice("");
    setUncertain(false);
  }
  async function mutate(action: () => Promise<unknown>) {
    if (busy || !owner) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      feed.refresh();
    } catch (e) {
      setError(errorText(e));
      throw e;
    } finally {
      setBusy(false);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !preview.data || !owner || busy) return;
    try {
      await mutate(() =>
        api(`/programs/${editing.id}`, "PUT", {
          version: editing.version,
          context_hash: preview.data!.context_hash,
          settings: draft,
        }),
      );
      setEditing(null);
      setNotice("Program saved. Its schedule uses the reviewed work context.");
    } catch {
      setUncertain(true);
    }
  }
  async function reconcile() {
    try {
      const current = await api<Feed>("/programs");
      const saved = current.items.find((p) => p.id === editing?.id);
      if (
        saved &&
        editing &&
        saved.version > editing.version &&
        Object.entries(draft).every(([key, value]) =>
          key === "first_at"
            ? new Date(saved.settings.first_at).getTime() ===
              new Date(draft.first_at).getTime()
            : saved.settings[key as keyof Settings] === value,
        )
      ) {
        setEditing(null);
        setNotice("Saved program found. Review its schedule below.");
      } else if (saved) {
        setEditing({ id: saved.id, version: saved.version });
        setNotice(
          "Current saved version loaded. Review your draft and save again.",
        );
      }
      setUncertain(false);
      preview.refresh();
      feed.refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <section className="agent-programs" aria-labelledby="programs-title">
      <header className="programs-heading">
        <div>
          <h2 id="programs-title">Test programs</h2>
          <p>Give Hermes a routine and a schedule tied to repository work.</p>
        </div>
        <div className="program-actions">
          <Button onClick={feed.refresh} disabled={busy}>
            <RefreshCw size={14} />
            Refresh programs
          </Button>
          {owner && (
            <Button
              variant="default"
              onClick={create}
              disabled={busy || !!editing}
            >
              <Plus size={14} />
              New program
            </Button>
          )}
        </div>
      </header>
      {!owner && (
        <p className="program-note">
          Teammates can follow programs. The administrator creates schedules and
          approves runs.
        </p>
      )}
      {!workspace.data?.runner.available && (
        <p className="program-warning">
          Hermes runtime unavailable. You can prepare schedules; execution will
          be blocked until a runtime is connected.
        </p>
      )}
      <p className="program-note">
        Relay must be running at the scheduled time. Daily and weekly schedules
        use fixed 24-hour / 7-day intervals; times below use{" "}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}. Missed times produce
        at most one pending run.
      </p>
      {error && (
        <p role="alert" className="program-warning">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {owner && editing && (
        <form
          className="program-editor"
          onSubmit={save}
          aria-label="Program setup"
        >
          <h3>
            {editing.version
              ? "Review and reschedule program"
              : "Create a test program"}
          </h3>
          <div
            className="program-presets"
            role="group"
            aria-label="Test routine"
          >
            {presets.map((p) => (
              <button
                type="button"
                key={p.id}
                aria-pressed={draft.routine === p.id}
                onClick={() =>
                  setDraft({ ...draft, routine: p.id, name: p.name })
                }
              >
                <FlaskConical size={17} />
                <strong>{p.name}</strong>
                <span>{p.description}</span>
              </button>
            ))}
          </div>
          <div className="program-fields">
            <label htmlFor="program-name">
              Program name
              <input
                id="program-name"
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label htmlFor="program-case">
              Repository work
              <select
                id="program-case"
                required
                value={draft.case_id}
                onChange={(e) =>
                  setDraft({ ...draft, case_id: e.target.value })
                }
              >
                <option value="">Choose a saved work record</option>
                {workspace.data?.cases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.project} · {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor="program-first">
              First run
              <input
                id="program-first"
                type="datetime-local"
                required
                value={localTime(draft.first_at)}
                onChange={(e) => {
                  if (e.target.value)
                    setDraft({
                      ...draft,
                      first_at: new Date(e.target.value).toISOString(),
                    });
                }}
              />
            </label>
            <label htmlFor="program-repeat">
              Repeat
              <select
                id="program-repeat"
                value={draft.repeat}
                onChange={(e) => setDraft({ ...draft, repeat: e.target.value })}
              >
                <option value="once">Once</option>
                <option value="daily">Every day</option>
                <option value="weekly">Every week</option>
              </select>
            </label>
            <label htmlFor="program-limit">
              Run time limit
              <select
                id="program-limit"
                value={draft.max_seconds}
                onChange={(e) =>
                  setDraft({ ...draft, max_seconds: Number(e.target.value) })
                }
              >
                <option value={60}>1 minute</option>
                <option value={120}>2 minutes</option>
                <option value={300}>5 minutes</option>
                <option value={600}>10 minutes</option>
              </select>
            </label>
            <label htmlFor="program-auto">
              At the scheduled time
              <select
                id="program-auto"
                value={String(draft.automatic)}
                onChange={(e) =>
                  setDraft({ ...draft, automatic: e.target.value === "true" })
                }
              >
                <option value="false">Ask administrator to start</option>
                <option value="true">Run automatically</option>
              </select>
            </label>
          </div>
          {draft.case_id && (
            <div className="program-warning" role="status">
              {preview.error
                ? `Could not load work context: ${preview.error}`
                : preview.data
                  ? `Work preview · Build ${preview.data.build || "missing"} · Revision ${preview.data.case_revision}`
                  : "Loading work preview…"}
              <Button type="button" onClick={preview.refresh} disabled={busy}>
                Refresh work preview
              </Button>
            </div>
          )}
          <p className="program-note">
            Uses the selected work's build, reproduction conditions and
            evidence. Saving reviews that context for this routine. Changed
            context blocks later runs. Hermes uses its existing test
            permissions; results require actual evidence. The time limit is
            cooperative and is not a spending cap.
          </p>
          {!workspace.data?.cases.length && (
            <p>
              No work records yet. Add repository work before creating a
              program.
            </p>
          )}
          <div className="program-actions">
            <Button
              type="submit"
              variant="default"
              disabled={
                busy ||
                uncertain ||
                !draft.case_id ||
                !preview.data ||
                !preview.data.build
              }
            >
              {busy ? "Saving…" : "Save program"}
            </Button>
            <Button
              type="button"
              onClick={() => setEditing(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            {uncertain && (
              <Button type="button" onClick={reconcile}>
                Check saved program
              </Button>
            )}
          </div>
        </form>
      )}
      {feed.error ? (
        <p role="alert">Programs could not load: {feed.error}</p>
      ) : !feed.data ? (
        <p>Loading programs…</p>
      ) : !programs.length ? (
        <div className="program-empty">
          <CalendarClock size={28} />
          <h3>No test programs yet</h3>
          <p>
            Choose a routine, connect it to a work record, and set its first
            run.
          </p>
          {owner && (
            <Button onClick={create} disabled={!!editing}>
              Create first program
            </Button>
          )}
        </div>
      ) : (
        <div className="program-list">
          {programs.map((p) => (
            <article key={p.id} className="program-row">
              <div>
                <h3>{p.settings.name}</h3>
                <p>
                  {presets.find((x) => x.id === p.settings.routine)?.name} ·{" "}
                  {p.settings.repeat} ·{" "}
                  {p.settings.automatic ? "Automatic" : "Approval each run"}
                </p>
                <p>
                  Next:{" "}
                  {p.enabled
                    ? p.next_at
                      ? when(p.next_at)
                      : "No further scheduled runs"
                    : "Paused"}
                </p>
              </div>
              <div className="program-actions">
                <span className="program-state">
                  {p.enabled ? "Enabled" : "Paused"}
                </span>
                {owner && (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void mutate(() =>
                          api(`/programs/${p.id}/enabled`, "POST", {
                            version: p.version,
                            enabled: !p.enabled,
                          }),
                        ).catch(() => {})
                      }
                    >
                      {p.enabled ? <Pause size={14} /> : <Play size={14} />}{" "}
                      {p.enabled ? "Pause" : "Resume"}
                    </Button>
                    <Button
                      disabled={busy || !!editing}
                      onClick={() => {
                        setEditing({ id: p.id, version: p.version });
                        setDraft({
                          ...p.settings,
                          first_at: new Date(
                            Date.now() + 3600000,
                          ).toISOString(),
                        });
                        setUncertain(false);
                        setError("");
                      }}
                    >
                      Review / reschedule
                    </Button>
                  </>
                )}
                <Button
                  onClick={() => onWork(p.settings.case_id)}
                  aria-label={`Open work for ${p.settings.name}`}
                >
                  <ArrowUpRight size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="programs-heading">
        <div>
          <h3>Scheduled activity</h3>
          <p>
            Latest 100 occurrences. Open the linked work for results, test
            receipts and stop controls.
          </p>
        </div>
      </div>
      <div className="program-history">
        {feed.data?.occurrences.map((o) => {
          const p = programs.find((p) => p.id === o.program_id);
          return (
            <article key={o.id} className="program-row">
              <div>
                <strong>{o.program_name || "Program"}</strong>
                <p>
                  {when(o.scheduled_at)} ·{" "}
                  <span className="program-state" data-state={o.state}>
                    {o.state.split("_").join(" ")}
                  </span>
                </p>
                <p>{o.detail}</p>
              </div>
              <div className="program-actions">
                {owner &&
                  p?.enabled &&
                  ["awaiting_approval", "blocked"].includes(o.state) && (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void mutate(() =>
                          api(
                            `/program-occurrences/${o.id}/approve`,
                            "POST",
                            {},
                          ),
                        ).catch(() => {})
                      }
                    >
                      {o.state === "blocked" ? "Retry run" : "Start this run"}
                    </Button>
                  )}
                {o.run_id && (
                  <Button onClick={() => onWork(o.case_id)}>
                    View result <ArrowUpRight size={14} />
                  </Button>
                )}
              </div>
            </article>
          );
        })}
        {feed.data && !feed.data.occurrences.length && (
          <p className="program-note">
            No occurrences yet. Scheduled activity will appear when a program is
            due.
          </p>
        )}
      </div>
      <p className="program-note">
        Pausing prevents new admissions. It does not stop a run already
        underway; open its work record to request a stop. A completed
        investigation is not a verified fix.
      </p>
    </section>
  );
}
