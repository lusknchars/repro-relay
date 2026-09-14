import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, X } from "lucide-react";
import { Button, Input, Badge } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace } from "@/lib/live";
import { cn } from "@/lib/utils";
type Pin = {
  title: string;
  starts_on: string;
  ends_on: string;
  category: string;
  status: string;
  notes: string;
  case_id: string | null;
};
type Entry = {
  id: string;
  version: number;
  pin: Pin;
  source: "team" | "run" | "google";
  run_status?: string;
  execution_kind?: string;
};
type Page = { items: Entry[]; truncated: boolean; timezone: string };
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const parse = (key: string) => new Date(`${key}T12:00:00Z`);
const add = (key: string, days: number) => {
  const date = parse(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
};
const categories = [
  {
    id: "google",
    label: "Google Calendar",
    color: "border-cyan-300/40 bg-cyan-400/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    id: "review",
    label: "Reviews",
    color: "border-pink-300/40 bg-pink-400/10 text-pink-600 dark:text-pink-300",
  },
  {
    id: "test",
    label: "Tests",
    color:
      "border-amber-300/40 bg-amber-400/10 text-amber-700 dark:text-amber-300",
  },
  {
    id: "follow_up",
    label: "Follow-ups",
    color:
      "border-emerald-300/40 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    id: "agent",
    label: "Agent activity",
    color: "border-blue-300/40 bg-blue-400/10 text-blue-700 dark:text-blue-300",
  },
];
const style = (id: string) =>
  categories.find((c) => c.id === id)?.color || "border-border";
const stamp = (text: string) => text.split("-").join("");
const escapeICS = (text: string) =>
  text
    .split("\\")
    .join("\\\\")
    .split("\r")
    .join("")
    .split("\n")
    .join("\\n")
    .split(";")
    .join("\\;")
    .split(",")
    .join("\\,");
export function CalendarPage({
  onWork,
  onSettings,
}: {
  onWork: (id: string) => void;
  onSettings: () => void;
}) {
  const today = dateKey(new Date());
  const [month, setMonth] = useState(() => today.slice(0, 7) + "-01");
  const [selectedDay, setSelectedDay] = useState(today);
  const [filter, setFilter] = useState(categories.map((c) => c.id));
  const [search, setSearch] = useState("");
  const [agenda, setAgenda] = useState(false);
  const [edit, setEdit] = useState<Entry>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [google, setGoogle] = useState<Page>();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState("");
  const googleRange = useRef("");
  const dialog = useRef<HTMLDialogElement>(null);
  const workspace = useWorkspace();
  const canEdit =
    !!workspace.data?.account.enabled &&
    workspace.data.account.role !== "viewer";
  const first = parse(month),
    offset = (first.getUTCDay() + 6) % 7;
  const from = add(month, -offset),
    to = add(from, 41);
  const data = useLoad(
    () => api<Page>(`/calendar?from=${from}&to=${to}`),
    [from, to],
    15000,
  );
  useEffect(() => {
    if (edit) dialog.current?.showModal();
    else dialog.current?.close();
  }, [!!edit]);
  useEffect(() => {
    googleRange.current = from + to;
    setGoogle(undefined);
    setGoogleError("");
  }, [from, to]);
  const entries = [
    ...(data.data?.items || []),
    ...(google?.items || []),
  ].filter(
    (e) =>
      filter.includes(e.pin.category) &&
      (!search || e.pin.title.toLowerCase().includes(search.toLowerCase())),
  );
  const days = Array.from({ length: 42 }, (_, i) => add(from, i));
  function changeMonth(delta: number) {
    const d = parse(month);
    d.setUTCMonth(d.getUTCMonth() + delta);
    setMonth(dateKey(d));
  }
  function create(day = selectedDay) {
    setError("");
    setEdit({
      id: crypto.randomUUID(),
      version: 0,
      source: "team",
      pin: {
        title: "",
        starts_on: day,
        ends_on: day,
        category: "review",
        status: "planned",
        notes: "",
        case_id: null,
      },
    });
  }
  async function save(cancel = false) {
    if (!edit || edit.source !== "team" || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/calendar/${edit.id}`, "PUT", {
        version: edit.version,
        pin: { ...edit.pin, status: cancel ? "cancelled" : edit.pin.status },
      });
      setEdit(undefined);
      data.refresh();
      setNotice(
        cancel
          ? "Activity removed from the calendar."
          : "Activity saved for the team.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function exportCalendar() {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Repro Relay//Workspace Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];
    for (const e of entries.filter((e) => e.source !== "google"))
      lines.push(
        "BEGIN:VEVENT",
        `UID:${e.id}@repro-relay.local`,
        `DTSTAMP:${new Date()
          .toISOString()
          .replace(/[-:]/g, "")
          .replace(/\.\d{3}/, "")}`,
        `DTSTART;VALUE=DATE:${stamp(e.pin.starts_on)}`,
        `DTEND;VALUE=DATE:${stamp(add(e.pin.ends_on, 1))}`,
        `SUMMARY:${escapeICS(e.pin.title)}`,
        `DESCRIPTION:${escapeICS(`${e.source === "google" ? "Google Calendar" : e.source === "run" ? "Recorded run" : "Team activity"}: ${e.pin.status}. ${e.pin.notes || ""}`)}`,
        "END:VEVENT",
      );
    lines.push("END:VCALENDAR");
    // Fold on UTF-8 boundaries at 75 octets, including the continuation space.
    const encoder = new TextEncoder();
    const folded =
      lines
        .map((line) => {
          let output = "",
            width = 0;
          for (const ch of line) {
            const n = encoder.encode(ch).length;
            if (width + n > 75) {
              output += "\r\n ";
              width = 1;
            }
            output += ch;
            width += n;
          }
          return output;
        })
        .join("\r\n") + "\r\n";
    const url = URL.createObjectURL(
      new Blob([folded], { type: "text/calendar;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `relay-${month.slice(0, 7)}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(
      "Exported the visible calendar range. This is a snapshot, not live calendar synchronization.",
    );
  }
  const title = first.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface p-4 md:px-6">
        <div>
          <h1 className="text-xl font-semibold">Calendar</h1>
          <p className="mt-1 text-xs text-muted">
            Team plans and recorded agent activity · UTC
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!data.data || data.data.truncated}
            onClick={exportCalendar}
          >
            <Download size={14} />
            Export calendar
          </Button>
          <Button
            variant="default"
            disabled={!canEdit}
            onClick={() => create()}
          >
            <Plus size={14} />
            Pin activity
          </Button>
        </div>
      </header>
      <div className="grid min-h-0 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside
          aria-label="Calendar filters"
          className="grid content-start gap-5 border-b border-border bg-surface p-4 lg:overflow-y-auto lg:border-r lg:border-b-0"
        >
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{title}</h2>
              <div className="flex">
                <button
                  aria-label="Previous month"
                  className="t-control rounded p-1"
                  onClick={() => changeMonth(-1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  aria-label="Next month"
                  className="t-control rounded p-1"
                  onClick={() => changeMonth(1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted">
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <span key={i}>{d}</span>
              ))}
              {days.map((day) => (
                <button
                  key={day}
                  aria-label={`Select ${day}`}
                  aria-pressed={day === selectedDay}
                  onClick={() => setSelectedDay(day)}
                  className={cn(
                    "t-control h-6 rounded-full",
                    day === selectedDay
                      ? "bg-accent text-accent-foreground"
                      : day.slice(0, 7) !== month.slice(0, 7)
                        ? "text-faint"
                        : "hover:bg-surface-2",
                  )}
                >
                  {Number(day.slice(-2))}
                </button>
              ))}
            </div>
          </div>
          <label className="grid gap-2 text-xs text-muted">
            Find activity
            <Input
              aria-label="Find calendar activity"
              placeholder="Search activities…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="grid gap-2">
            <h2 className="text-xs font-semibold text-muted">
              Workspace calendars
            </h2>
            {categories.map((c) => (
              <label
                key={c.id}
                className={cn(
                  "flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
                  c.color,
                )}
              >
                <input
                  type="checkbox"
                  checked={filter.includes(c.id)}
                  onChange={() =>
                    setFilter((v) =>
                      v.includes(c.id)
                        ? v.filter((id) => id !== c.id)
                        : [...v, c.id],
                    )
                  }
                />
                {c.label}
              </label>
            ))}
          </div>
          <button
            onClick={onSettings}
            className="t-control text-left text-xs text-accent-text hover:underline"
          >
            Calendar connections <span aria-hidden>↗</span>
          </button>
          <p className="text-xs leading-relaxed text-muted">
            New Hermes runs appear automatically. Pins organize reviews, tests
            and follow-ups; they do not trigger execution.
          </p>
        </aside>
        <section
          aria-label="Team calendar"
          className="flex min-h-0 min-w-0 flex-col"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-semibold">{title}</h2>
              <Button
                size="sm"
                onClick={() => {
                  setMonth(today.slice(0, 7) + "-01");
                  setSelectedDay(today);
                }}
              >
                Today
              </Button>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                aria-pressed={!agenda}
                onClick={() => setAgenda(false)}
              >
                Month
              </Button>
              <Button
                size="sm"
                aria-pressed={agenda}
                onClick={() => setAgenda(true)}
              >
                Agenda
              </Button>
            </div>
          </div>
          {(data.error || (!edit && error)) && (
            <p role="alert" className="p-3 text-sm text-danger">
              {data.error || error}
              <Button onClick={data.refresh}>Retry calendar</Button>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 border-b border-border p-3">
            <Button
              disabled={googleBusy}
              onClick={async () => {
                const range = from + to;
                setGoogleBusy(true);
                setGoogleError("");
                setGoogle(undefined);
                try {
                  const result = await api<Page>(
                    `/connections/google-calendar/events?from=${from}&to=${to}`,
                  );
                  if (googleRange.current === range) setGoogle(result);
                } catch (e) {
                  if (googleRange.current === range)
                    setGoogleError(errorText(e));
                } finally {
                  setGoogleBusy(false);
                }
              }}
            >
              {googleBusy ? "Loading Google events…" : "Load Google Calendar"}
            </Button>
            <span className="text-xs text-muted">
              {google
                ? `${google.items.length} Google events loaded · read-only · timed events placed in UTC`
                : "Connect in Settings, then load this month’s events."}
            </span>
            {googleError && (
              <p role="alert" className="text-sm text-danger">
                {googleError}
              </p>
            )}
            {google?.truncated && (
              <p role="alert" className="text-sm text-warn">
                Google results are incomplete; narrow the date range in Google
                Calendar.
              </p>
            )}
          </div>
          {notice && (
            <p role="status" className="p-3 text-xs text-ok">
              {notice}
            </p>
          )}
          {data.loading && !data.data && (
            <p role="status" className="p-3 text-sm text-muted">
              Loading team activities…
            </p>
          )}
          {data.data?.truncated && (
            <p role="alert" className="p-3 text-sm text-warn">
              This range contains more records than can be displayed. Export is
              unavailable for an incomplete calendar.
            </p>
          )}
          <div
            className={cn(
              "min-h-0 flex-1 overflow-auto",
              agenda ? "hidden" : "hidden md:block",
            )}
          >
            <div className="grid min-h-full min-w-[650px] grid-cols-7 grid-rows-[28px_repeat(6,minmax(160px,1fr))]">
              {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
                <div
                  key={d}
                  className="border-b border-border bg-surface-2 p-2 text-center text-[10px] text-muted"
                >
                  {d}
                </div>
              ))}
              {days.map((day) => (
                <div
                  key={day}
                  className={cn(
                    "min-w-0 border-r border-b border-border p-1.5",
                    day.slice(0, 7) !== month.slice(0, 7) && "bg-surface-2/40",
                    day === selectedDay && "ring-1 ring-inset ring-accent/40",
                  )}
                >
                  <button
                    aria-label={`Pin activity on ${day}`}
                    disabled={!canEdit}
                    onClick={() => {
                      setSelectedDay(day);
                      create(day);
                    }}
                    className={cn(
                      "t-control mb-1 grid h-6 w-6 place-items-center rounded-full text-[11px]",
                      day === today
                        ? "bg-foreground text-background"
                        : "text-muted hover:bg-surface-2",
                    )}
                  >
                    {Number(day.slice(-2))}
                  </button>
                  <div
                    className="grid max-h-28 gap-1 overflow-y-auto"
                    tabIndex={0}
                    aria-label={`Activities on ${day}`}
                  >
                    {entries
                      .filter(
                        (e) => e.pin.starts_on <= day && e.pin.ends_on >= day,
                      )
                      .map((e) => (
                        <button
                          key={e.id}
                          onClick={() => {
                            setError("");
                            setEdit(e);
                          }}
                          className={cn(
                            "t-control min-w-0 rounded border px-2 py-1.5 text-left text-[11px]",
                            style(e.pin.category),
                          )}
                          title={`${e.pin.title} · ${e.pin.status}`}
                        >
                          <span className="block truncate">
                            {e.pin.status === "done" ? "✓ " : ""}
                            {e.pin.title}
                          </span>
                          {e.source === "run" && (
                            <span className="block truncate text-[9px]">
                              {e.execution_kind === "local_validation"
                                ? "Local validation"
                                : "Hermes"}{" "}
                              · {e.run_status}
                            </span>
                          )}
                        </button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-auto p-3",
              !agenda && "md:hidden",
            )}
          >
            {!entries.length && data.data && (
              <p className="rounded-md border border-dashed border-border p-6 text-sm text-muted">
                No activities in this range. Pin a review or start an
                investigation from Work.
              </p>
            )}
            {[...entries]
              .sort((a, b) => a.pin.starts_on.localeCompare(b.pin.starts_on))
              .map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setError("");
                    setEdit(e);
                  }}
                  className={cn(
                    "t-control mb-2 grid w-full gap-2 rounded-lg border p-3 text-left",
                    style(e.pin.category),
                  )}
                >
                  <span className="text-xs">
                    {e.pin.starts_on}
                    {e.pin.ends_on !== e.pin.starts_on
                      ? ` → ${e.pin.ends_on}`
                      : ""}
                  </span>
                  <span className="text-sm font-medium">{e.pin.title}</span>
                  <span className="text-xs">
                    {e.source === "google"
                      ? "Google Calendar"
                      : e.source === "run"
                        ? "Recorded run"
                        : "Team activity"}{" "}
                    · {e.pin.status}
                  </span>
                </button>
              ))}
          </div>
        </section>
      </div>
      <dialog
        ref={dialog}
        aria-label="Calendar activity"
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
        onClose={() => setEdit(undefined)}
        className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto rounded-xl border border-border bg-surface p-5 text-foreground shadow-xl backdrop:bg-black/50"
      >
        {edit && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {edit.source === "google"
                  ? "Google Calendar event"
                  : edit.source === "run"
                    ? "Recorded agent activity"
                    : edit.version
                      ? "Edit activity"
                      : "Pin activity"}
              </h2>
              <button
                type="button"
                aria-label="Close activity"
                disabled={busy}
                className="t-control rounded p-2"
                onClick={() => setEdit(undefined)}
              >
                <X size={18} />
              </button>
            </div>
            {edit.source === "google" ? (
              <>
                <h3 className="font-medium">{edit.pin.title}</h3>
                <Badge tone="outline">Google Calendar · Read-only</Badge>
                <p className="text-sm text-muted">{edit.pin.notes}</p>
                <p className="text-xs text-muted">
                  Edit this event in Google Calendar, then load it again.
                </p>
              </>
            ) : edit.source === "run" ? (
              <>
                <h3 className="font-medium">{edit.pin.title}</h3>
                <Badge tone="outline">
                  {edit.execution_kind === "local_validation"
                    ? "Local validation"
                    : "Hermes"}{" "}
                  · {edit.run_status}
                </Badge>
                <p className="text-sm text-muted">{edit.pin.notes}</p>
              </>
            ) : (
              <>
                <label className="grid gap-1 text-sm">
                  Activity title
                  <Input
                    required
                    maxLength={160}
                    value={edit.pin.title}
                    disabled={busy || !canEdit}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        pin: { ...edit.pin, title: e.target.value },
                      })
                    }
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-sm">
                    Start date
                    <Input
                      type="date"
                      required
                      value={edit.pin.starts_on}
                      disabled={busy || !canEdit}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          pin: {
                            ...edit.pin,
                            starts_on: e.target.value,
                            ends_on:
                              edit.pin.ends_on < e.target.value
                                ? e.target.value
                                : edit.pin.ends_on,
                          },
                        })
                      }
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    End date
                    <Input
                      type="date"
                      required
                      min={edit.pin.starts_on}
                      value={edit.pin.ends_on}
                      disabled={busy || !canEdit}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          pin: { ...edit.pin, ends_on: e.target.value },
                        })
                      }
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-sm">
                    Calendar
                    <select
                      className="rounded border border-border bg-background p-2"
                      disabled={busy || !canEdit}
                      aria-label="Category"
                      value={edit.pin.category}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          pin: { ...edit.pin, category: e.target.value },
                        })
                      }
                    >
                      {categories
                        .filter((c) => c.id !== "agent")
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Status
                    <select
                      className="rounded border border-border bg-background p-2"
                      disabled={busy || !canEdit}
                      aria-label="Status"
                      value={edit.pin.status}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          pin: { ...edit.pin, status: e.target.value },
                        })
                      }
                    >
                      <option value="planned">Planned</option>
                      <option value="done">Done</option>
                    </select>
                  </label>
                </div>
                <label className="grid gap-1 text-sm">
                  Related work
                  <select
                    className="min-w-0 rounded border border-border bg-background p-2"
                    disabled={busy || !canEdit}
                    aria-label="Related work"
                    value={edit.pin.case_id || ""}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        pin: { ...edit.pin, case_id: e.target.value || null },
                      })
                    }
                  >
                    <option value="">Independent activity</option>
                    {workspace.data?.cases.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  Notes
                  <textarea
                    aria-label="Notes"
                    maxLength={4000}
                    rows={3}
                    disabled={busy || !canEdit}
                    className="rounded border border-border bg-background p-2"
                    value={edit.pin.notes}
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        pin: { ...edit.pin, notes: e.target.value },
                      })
                    }
                  />
                </label>
                <p className="text-xs text-muted">
                  Saved for this team. This pin does not schedule an agent or
                  send a message.
                </p>
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {edit.source === "team" && canEdit && (
                <>
                  <Button variant="default" pending={busy} type="submit">
                    Save activity
                  </Button>
                  {edit.version > 0 && (
                    <Button
                      disabled={busy}
                      type="button"
                      onClick={() => void save(true)}
                    >
                      Remove activity
                    </Button>
                  )}
                </>
              )}
              {edit.pin.case_id && (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    onWork(edit.pin.case_id!);
                    setEdit(undefined);
                  }}
                >
                  Open related work
                </Button>
              )}
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
