import { PageSidebar } from "@/components/shell/PageSidebar";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  Grid2X2,
  Grip,
  Search,
  ShieldCheck,
  ZoomIn,
  ZoomOut,
  Maximize,
  X,
  Layers,
  Database,
} from "lucide-react";
import { IntegrationLogo } from "@/components/integration-logo";
import { Button, Badge } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace, type Case } from "@/lib/live";
import { cn } from "@/lib/utils";
export type Focus = "investigation" | "test_triage" | "context_efficiency";
type RepoNode = {
  id: string;
  name: string;
  kind: string;
  technologies: string[];
  dependencies: string[];
  sha256: string;
};
type RepoRecord = {
  snapshot: null | {
    repository: string;
    revision: string;
    dirty: boolean;
    nodes: RepoNode[];
  };
  checked_at?: string;
  current: boolean;
};
type Point = { x: number; y: number };
type Settings = {
  focus: Focus;
  guidance: string;
  positions: Record<string, Point>;
};
type Stage = { id: string; label: string; kind: string; detail: string };
export type ArchitectureRecord = {
  version: number;
  settings: Settings;
  templates: {
    focus: Focus;
    name: string;
    summary: string;
    objective: string;
    stages: Stage[];
  }[];
};
const initialPositions: Record<string, Point> = {
  context: { x: 380, y: 60 },
  investigate: { x: 70, y: 280 },
  evidence: { x: 650, y: 280 },
  human: { x: 70, y: 500 },
};
export function ArchitecturePage({
  onWork,
  onSettings,
}: {
  onWork: (id: string) => void;
  onSettings: () => void;
}) {
  const workspace = useWorkspace();
  const repository = useLoad(
    () => api<RepoRecord>("/architectures/repository"),
    [],
    15000,
  );
  const [mode, updateMode] = useState<"repository" | "workflow">(() =>
    new URLSearchParams(location.search).get("architecture-section") ===
    "workflow"
      ? "workflow"
      : "repository",
  );
  function setMode(value: "repository" | "workflow") {
    updateMode(value);
    const url = new URL(location.href);
    url.searchParams.set("architecture-section", value);
    history.replaceState(null, "", url);
  }
  const saved = useLoad(() => api<ArchitectureRecord>("/architectures"));
  const [draft, setDraft] = useState<Settings>();
  const [selected, setSelected] = useState("investigate");
  const [zoom, setZoom] = useState(0.85);
  const [square, setSquare] = useState(false);
  const [stepSearch, setStepSearch] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const picker = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  function focusStep(id: string) {
    setSelected(id);
    const p = position(id);
    viewport.current?.scrollTo({
      left: Math.max(0, (p.x + 115) * zoom - viewport.current.clientWidth / 2),
      top: Math.max(0, p.y * zoom - 120),
      behavior: "instant",
    });
    picker.current?.close();
  }
  function stepColor(kind: string) {
    return kind === "agent"
      ? "bg-violet-500"
      : kind === "human"
        ? "bg-emerald-600"
        : kind === "evidence"
          ? "bg-amber-500"
          : "bg-blue-500";
  }
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [discovery, setDiscovery] = useState<{
    recommended: Focus;
    reason: string;
    reports: number;
    failed_runs: number;
    runs_missing_cost: number;
    source: string;
  }>();
  const [assessment, setAssessment] = useState("");
  const request = useRef<{ identity: string; key: string }>();
  const drag = useRef<{ id: string; start: Point; origin: Point }>();
  useEffect(() => {
    if (saved.data) setDraft(saved.data.settings);
  }, [saved.data]);
  const template = saved.data?.templates.find((t) => t.focus === draft?.focus);
  const graphStages: Stage[] =
    mode === "repository"
      ? (repository.data?.snapshot?.nodes || []).map((n) => ({
          id: n.id,
          label: n.name,
          kind: n.kind,
          detail: `${n.id}. ${n.technologies.length ? "Observed dependencies: " + n.technologies.join(", ") : "No recognized framework dependency in this manifest."}`,
        }))
      : template?.stages || [];
  const activeId = graphStages.some((n) => n.id === selected)
    ? selected
    : graphStages[0]?.id;
  const node = graphStages.find((s) => s.id === activeId);
  const component = repository.data?.snapshot?.nodes.find(
    (n) => n.id === activeId,
  );
  const graphHeight =
    mode === "repository"
      ? Math.max(710, Math.ceil(graphStages.length / 3) * 190 + 140)
      : 710;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved.data?.settings);
  const canEdit =
    !!workspace.data?.account.enabled &&
    workspace.data.account.role !== "viewer";
  const position = (id: string) =>
    mode === "repository"
      ? {
          x:
            40 +
            (Math.max(
              0,
              graphStages.findIndex((n) => n.id === id),
            ) %
              3) *
              310,
          y:
            70 +
            Math.floor(
              Math.max(
                0,
                graphStages.findIndex((n) => n.id === id),
              ) / 3,
            ) *
              190,
        }
      : draft?.positions[id] || initialPositions[id];
  const edges =
    mode === "repository"
      ? (repository.data?.snapshot?.nodes || []).flatMap((n) =>
          n.dependencies.map((target) => ({ from: n.id, to: target })),
        )
      : graphStages
          .slice(0, -1)
          .map((n, i) => ({ from: n.id, to: graphStages[i + 1].id }));
  function edgePath(from: string, to: string) {
    const a = position(from),
      b = position(to);
    if (Math.abs(b.y - a.y) < 90) {
      const right = b.x > a.x;
      const x1 = a.x + (right ? 230 : 0),
        x2 = b.x + (right ? 0 : 230);
      const mid = (x1 + x2) / 2;
      return `M ${x1} ${a.y + 34} H ${mid} V ${b.y + 34} H ${x2}`;
    }
    const down = b.y > a.y;
    const y1 = a.y + (down ? 68 : 0),
      y2 = b.y + (down ? 0 : 68);
    const mid = (y1 + y2) / 2;
    return `M ${a.x + 115} ${y1} V ${mid} H ${b.x + 115} V ${y2}`;
  }
  function move(id: string, x: number, y: number) {
    setDraft((d) =>
      d
        ? {
            ...d,
            positions: {
              ...d.positions,
              [id]: {
                x: Math.max(0, Math.min(760, Math.round(x / 20) * 20)),
                y: Math.max(0, Math.min(580, Math.round(y / 20) * 20)),
              },
            },
          }
        : d,
    );
  }
  async function perform(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  async function assess() {
    if (
      !draft ||
      !saved.data ||
      !template ||
      !repository.data?.snapshot ||
      !repository.data.current
    )
      return;
    const current = workspace.data?.cases[0];
    const topology = repository.data.snapshot;
    const evidence: {
      repository: string;
      revision: string;
      dirty: boolean;
      total_components: number;
      nodes: RepoNode[];
    } = {
      repository: topology.repository,
      revision: topology.revision,
      dirty: topology.dirty,
      total_components: topology.nodes.length,
      nodes: [],
    };
    for (const component of topology.nodes) {
      const candidate = { ...evidence, nodes: [...evidence.nodes, component] };
      if (JSON.stringify(candidate).length > 4300) break;
      evidence.nodes.push(component);
    }
    const body = {
      title: Array.from(
        `Architecture research: ${repository.data.snapshot.repository}`,
      )
        .slice(0, 160)
        .join(""),
      project: current?.project || "Repro Relay",
      url: current?.url || "http://127.0.0.1:8178/?view=architecture",
      build: repository.data.snapshot.revision,
      description: `Research improvements for the connected repository architecture. Observed manifest snapshot: ${JSON.stringify(evidence)}. Team workflow: ${JSON.stringify({ version: saved.data.version, ...draft })}. Distinguish the observed structure from inferred behavior. Search official documentation and primary sources for alternative architectures if your configured tools permit web search. Cite exact reference URLs, explain fit and tradeoffs, and report unavailable search tools honestly.`,
      expected:
        "Return a proposed architecture improvement with current evidence, alternative designs, primary-source references, expected benefit and a test plan. Include context quality, token cost and safety tradeoffs. Do not apply changes or claim unmeasured gains.",
    };
    const identity = JSON.stringify(body);
    if (request.current?.identity !== identity)
      request.current = { identity, key: crypto.randomUUID() };
    const key = request.current.key;
    const item = await api<Case>("/cases", "POST", body, key);
    setAssessment(item.id);
    await api(
      `/cases/${item.id}/runs`,
      "POST",
      { revision: item.revision, max_seconds: 120 },
      `${key}-run`,
    );
    workspace.refresh();
    onWork(item.id);
  }
  return (
    <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
      <PageSidebar>
        <nav className="page-sidebar-nav" aria-label="Architecture sections">
          <button
            className="page-sidebar-link"
            aria-pressed={mode === "repository"}
            onClick={() => setMode("repository")}
          >
            <Database size={16} />
            Current repository
          </button>
          <button
            className="page-sidebar-link"
            aria-pressed={mode === "workflow"}
            onClick={() => setMode("workflow")}
          >
            <Layers size={16} />
            Team workflow
          </button>
        </nav>
        <section
          aria-label="Workflow templates"
          className="grid content-start gap-4"
        >
          <div className="grid gap-3 border-b border-border pb-3">
            <h2 className="text-sm font-semibold">Node library</h2>
            <label className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1.5">
              <Search size={13} className="shrink-0 text-muted" />
              <input
                aria-label="Search workflow steps"
                className="min-w-0 w-full bg-transparent text-xs outline-none"
                placeholder="Search nodes…"
                value={stepSearch}
                onChange={(e) => setStepSearch(e.target.value)}
              />
            </label>
            <p className="text-[10px] uppercase tracking-wider text-muted">
              {mode === "workflow" ? "Core steps" : "Repository components"}
            </p>
            {graphStages
              .filter((s) =>
                (s.label + s.kind)
                  .toLowerCase()
                  .includes(stepSearch.toLowerCase()),
              )
              .map((s) => (
                <button
                  key={s.id}
                  aria-label={`Inspect ${s.label}`}
                  aria-current={activeId === s.id ? "true" : undefined}
                  onClick={() => focusStep(s.id)}
                  className={cn(
                    "page-sidebar-link",
                    activeId === s.id && "bg-accent-soft",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white",
                      stepColor(s.kind),
                    )}
                  >
                    {s.kind === "human" ? (
                      <ShieldCheck size={13} />
                    ) : s.kind === "agent" ? (
                      <IntegrationLogo provider="hermes" size={16} />
                    ) : (
                      <Layers size={13} />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">
                      {s.label}
                    </span>
                    <span className="block text-[10px] text-muted">
                      {s.kind}
                    </span>
                  </span>
                </button>
              ))}
            {!graphStages.some((s) =>
              (s.label + s.kind)
                .toLowerCase()
                .includes(stepSearch.toLowerCase()),
            ) && (
              <p className="text-xs text-muted">
                {graphStages.length
                  ? "No matching steps."
                  : mode === "repository"
                    ? repository.loading
                      ? "Loading repository components…"
                      : repository.error
                        ? "Repository components unavailable."
                        : "No repository components recorded yet."
                    : saved.loading
                      ? "Loading workflow steps…"
                      : "Workflow steps unavailable."}
              </p>
            )}
          </div>
          {mode === "workflow" ? (
            <>
              {/* Saved team workflow templates */}{" "}
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Investigation workflows
              </p>
              {saved.data?.templates.map((t) => (
                <button
                  key={t.focus}
                  disabled={!!busy}
                  aria-pressed={draft?.focus === t.focus}
                  onClick={() =>
                    setDraft((d) => (d ? { ...d, focus: t.focus } : d))
                  }
                  className={cn(
                    "t-control grid gap-1 rounded-md border p-2 text-left",
                    draft?.focus === t.focus
                      ? "border-accent bg-accent-soft"
                      : "border-border hover:bg-surface-2",
                  )}
                >
                  <span className="text-xs font-semibold">{t.name}</span>
                  <span className="line-clamp-2 text-xs leading-relaxed text-muted">
                    {t.summary}
                  </span>
                </button>
              ))}
            </>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                Connected repository
              </p>
              <h2 className="break-words text-sm font-semibold">
                {repository.data?.snapshot?.repository ||
                  "Awaiting repository inspection"}
              </h2>
              <Badge tone={repository.data?.current ? "ok" : "outline"}>
                {repository.data?.current
                  ? "Current snapshot"
                  : "Snapshot unavailable or stale"}
              </Badge>
              <details className="grid gap-2 text-xs">
                <summary className="cursor-pointer text-muted">
                  Source details and setup
                </summary>
                <div className="mt-3 grid gap-3">
                  {repository.data?.snapshot && (
                    <>
                      <p className="mono break-all text-xs text-muted">
                        {repository.data.snapshot.revision}
                      </p>
                      <p className="text-xs text-muted">
                        {repository.data.snapshot.dirty
                          ? "Working tree has uncommitted changes."
                          : "Clean tracked working tree."}
                      </p>
                      <p className="text-xs text-muted">
                        {repository.data.snapshot.nodes.length} observed
                        manifests. Lines show declared local dependencies. This
                        is a manifest inventory, not a full runtime call graph.
                      </p>
                    </>
                  )}
                  <p className="text-xs leading-relaxed text-muted">
                    The connected context harness updates this map. Source files
                    and secrets are not uploaded; only manifest metadata and
                    hashes are recorded.
                  </p>
                  {!repository.data?.current && (
                    <code className="break-all rounded border border-border p-2 text-xs">
                      python3 integrations/context-harness/worker.py --repo .
                    </code>
                  )}
                </div>
              </details>
              {repository.error && (
                <p role="alert" className="text-xs text-danger">
                  {repository.error}
                </p>
              )}
            </>
          )}
          {mode === "repository" && (
            <section className="grid gap-2 border-t border-border pt-3">
              <h2 className="text-xs font-semibold">Suggested improvements</h2>
              {workspace.data?.cases
                .filter((c) => c.title.startsWith("Architecture research:"))
                .slice(0, 8)
                .map((c) => (
                  <button
                    key={c.id}
                    onClick={() => onWork(c.id)}
                    className="rounded border border-border p-2 text-left text-xs hover:bg-surface-2"
                  >
                    {c.title}
                    <span className="mt-1 block text-muted">
                      Open research and review
                    </span>
                  </button>
                ))}
              {!workspace.data?.cases.some((c) =>
                c.title.startsWith("Architecture research:"),
              ) && (
                <p className="text-xs text-muted">
                  No research recorded yet. Research improvements creates a
                  Hermes assessment with references and a test plan.
                </p>
              )}
            </section>
          )}
          {discovery && (
            <div className="grid gap-2 rounded-lg border border-border p-3 text-xs">
              <h2 className="font-semibold">Workspace inspection</h2>
              <p>{discovery.reason}</p>
              <p className="text-muted">
                {discovery.reports} reports · {discovery.failed_runs} failed
                runs · {discovery.runs_missing_cost} missing cost receipts
              </p>
              <p className="text-muted">{discovery.source}</p>
            </div>
          )}
        </section>
      </PageSidebar>
      <header className="grid gap-3 border-b border-border bg-surface p-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Architecture</h1>
            <p className="mt-1 text-sm text-muted">
              Inspect the connected repository, research improvements and choose
              how Hermes investigates.
            </p>
          </div>
          <Badge tone="outline">
            {saved.data
              ? `Team version ${saved.data.version}`
              : "Loading team plan"}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={repository.refresh}>Refresh repository</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={!!busy || !saved.data}
            pending={busy === "discover"}
            onClick={() =>
              void perform("discover", async () => {
                const result = await api<NonNullable<typeof discovery>>(
                  "/architectures/discover",
                );
                setDiscovery(result);
                setMode("workflow");
                setDraft((d) => (d ? { ...d, focus: result.recommended } : d));
                setNotice(
                  "Recommendation ready. Review the workflow before applying it.",
                );
              })
            }
          >
            <Search size={14} />
            Suggest team workflow
          </Button>
          <Button
            variant="default"
            disabled={!!busy || !draft || !canEdit || mode !== "workflow"}
            pending={busy === "save"}
            onClick={() =>
              void perform("save", async () => {
                await api("/architectures", "PUT", {
                  version: saved.data!.version,
                  settings: draft,
                });
                saved.refresh();
                setNotice(
                  "Applied to the team. New investigations will use this brief; current runs keep their saved context.",
                );
              })
            }
          >
            <Check size={14} />
            Apply to team
          </Button>
          <Button
            disabled={
              !!busy ||
              dirty ||
              !workspace.data?.runner.available ||
              !canEdit ||
              !repository.data?.current ||
              !repository.data?.snapshot ||
              workspace.data?.runs.some((r) => r.active)
            }
            variant={mode === "repository" ? "default" : "outline"}
            pending={busy === "assess"}
            onClick={() => void perform("assess", assess)}
          >
            <IntegrationLogo provider="hermes" size={16} />
            Research improvements · 2 min
          </Button>
          <Button variant="ghost" disabled={!!busy} onClick={saved.refresh}>
            Reload saved
          </Button>
        </div>
        {!workspace.data?.runner.available && (
          <p className="text-xs text-muted">
            Connect Hermes to request an assessment.{" "}
            <button className="text-accent-text underline" onClick={onSettings}>
              Open connections
            </button>
          </p>
        )}
        {dirty && draft && (
          <p className="text-xs text-warn">
            Unapplied plan. Apply it before asking Hermes to assess it.
          </p>
        )}
        {(saved.error || error) && (
          <p role="alert" className="text-sm text-danger">
            {saved.error || error}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm text-ok">
            {notice}
          </p>
        )}
        {assessment && error && (
          <Button onClick={() => onWork(assessment)}>
            Open saved assessment
          </Button>
        )}
      </header>
      <div className="grid min-h-0 lg:grid-cols-[minmax(0,1fr)_240px]">
        <section
          aria-label="Architecture canvas"
          className="relative min-h-[480px] min-w-0 bg-background"
        >
          <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap justify-between gap-2 border-b border-border bg-surface/95 px-3 py-2">
            <span className="self-center text-xs text-muted">
              {mode === "repository"
                ? "Observed manifests · select to inspect"
                : "Drag steps · arrow keys to move"}
            </span>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                aria-label="Find workflow step"
                onClick={() => {
                  setPickerSearch("");
                  picker.current?.showModal();
                }}
              >
                <Search size={14} />
              </Button>
              <Button
                size="sm"
                aria-label="Fit workflow to view"
                onClick={() => {
                  setZoom(
                    Math.max(
                      0.5,
                      Math.min(
                        1.2,
                        ((viewport.current?.clientWidth || 850) - 20) / 1000,
                      ),
                    ),
                  );
                  viewport.current?.scrollTo(0, 0);
                }}
              >
                <Maximize size={14} />
              </Button>
              <Button
                size="sm"
                aria-label="Zoom out"
                disabled={zoom <= 0.5}
                onClick={() => setZoom((v) => Math.max(0.5, v - 0.1))}
              >
                <ZoomOut size={14} />
              </Button>
              <span className="self-center text-xs">
                {Math.round(zoom * 100)}%
              </span>
              <Button
                size="sm"
                aria-label="Zoom in"
                disabled={zoom >= 1.2}
                onClick={() => setZoom((v) => Math.min(1.2, v + 0.1))}
              >
                <ZoomIn size={14} />
              </Button>
              <Button
                size="sm"
                aria-label={square ? "Use dot grid" : "Use square grid"}
                onClick={() => setSquare((v) => !v)}
              >
                <Grid2X2 size={14} />
              </Button>
              <Button
                size="sm"
                disabled={!!busy || mode === "repository"}
                onClick={() =>
                  setDraft((d) => (d ? { ...d, positions: {} } : d))
                }
              >
                Reset layout
              </Button>
            </div>
          </div>
          <div
            ref={viewport}
            className="h-full min-h-[480px] overflow-auto pt-14"
            style={{
              backgroundImage: square
                ? "linear-gradient(var(--border) 1px, transparent 1px),linear-gradient(90deg,var(--border) 1px,transparent 1px)"
                : "radial-gradient(var(--border-strong) 0.7px,transparent 0.7px)",
              backgroundSize: "20px 20px",
            }}
          >
            <div style={{ width: 1000 * zoom, height: graphHeight * zoom }}>
              <div
                className="relative"
                style={{
                  width: 1000,
                  height: graphHeight,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                }}
              >
                <svg
                  className="pointer-events-none absolute inset-0"
                  width="1000"
                  height={graphHeight}
                  aria-hidden
                >
                  <defs>
                    <marker
                      id="flow-arrow"
                      markerWidth="8"
                      markerHeight="8"
                      refX="7"
                      refY="4"
                      orient="auto"
                    >
                      <path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" />
                    </marker>
                  </defs>
                  {edges.map((edge, i) => (
                    <path
                      key={i}
                      d={edgePath(edge.from, edge.to)}
                      stroke="currentColor"
                      className="text-muted"
                      strokeWidth="1.2"
                      fill="none"
                      strokeLinejoin="round"
                      markerEnd="url(#flow-arrow)"
                    />
                  ))}
                </svg>
                {graphStages.map((s) => {
                  const p = position(s.id);
                  return (
                    <button
                      key={s.id}
                      aria-label={`${s.label} workflow step`}
                      aria-pressed={activeId === s.id}
                      disabled={!!busy}
                      className={cn(
                        "absolute flex h-[68px] w-[230px] items-center gap-3 rounded-lg border bg-surface px-3 text-left shadow-sm transition-[border-color,box-shadow] duration-150 hover:shadow-md focus-visible:outline-2 focus-visible:outline-accent",
                        activeId === s.id
                          ? "border-accent ring-2 ring-accent/20"
                          : "border-border",
                      )}
                      style={{ left: p.x, top: p.y, touchAction: "none" }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        setSelected(s.id);
                        if (mode === "repository" || !canEdit) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        drag.current = {
                          id: s.id,
                          start: { x: e.clientX, y: e.clientY },
                          origin: p,
                        };
                        setSelected(s.id);
                      }}
                      onPointerMove={(e) => {
                        const d = drag.current;
                        if (d?.id === s.id)
                          move(
                            s.id,
                            d.origin.x + (e.clientX - d.start.x) / zoom,
                            d.origin.y + (e.clientY - d.start.y) / zoom,
                          );
                      }}
                      onPointerUp={() => {
                        drag.current = undefined;
                      }}
                      onPointerCancel={() => {
                        drag.current = undefined;
                      }}
                      onFocus={() => setSelected(s.id)}
                      onKeyDown={(e) => {
                        if (mode === "repository" || !canEdit) return;
                        const delta: Record<string, Point> = {
                          ArrowLeft: { x: -20, y: 0 },
                          ArrowRight: { x: 20, y: 0 },
                          ArrowUp: { x: 0, y: -20 },
                          ArrowDown: { x: 0, y: 20 },
                        };
                        const d = delta[e.key];
                        if (d) {
                          e.preventDefault();
                          move(s.id, p.x + d.x, p.y + d.y);
                        }
                      }}
                    >
                      <span
                        aria-hidden
                        className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border-strong bg-surface"
                      />
                      <span
                        aria-hidden
                        className="absolute bottom-0 left-1/2 h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full border border-border-strong bg-surface"
                      />
                      <span
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white",
                          stepColor(s.kind),
                        )}
                      >
                        {s.kind === "agent" ? (
                          <IntegrationLogo provider="hermes" size={20} />
                        ) : s.kind === "human" ? (
                          <ShieldCheck size={16} />
                        ) : (
                          <Database size={16} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {s.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted">
                          {s.kind === "agent"
                            ? "Investigate and propose"
                            : s.kind === "human"
                              ? "Review before action"
                              : s.kind}
                        </span>
                      </span>
                      {mode === "workflow" && (
                        <Grip size={12} className="shrink-0 text-muted" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
        <aside
          aria-label="Workflow inspector"
          className="grid content-start gap-4 border-t border-border bg-surface p-4 lg:overflow-y-auto lg:border-t-0 lg:border-l"
        >
          <div>
            <p className="mb-2 text-xs uppercase tracking-wider text-muted">
              Step setup
            </p>
            <h2 className="text-base font-semibold">
              {node?.label || "Choose a step"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {node?.detail}
            </p>
          </div>
          {mode === "workflow" ? (
            <>
              {" "}
              <label className="grid gap-2 text-sm font-medium">
                Team guidance
                <textarea
                  aria-label="Team guidance"
                  className="min-h-32 resize-y rounded-md border border-border bg-background p-3 text-sm font-normal"
                  maxLength={2000}
                  value={draft?.guidance || ""}
                  disabled={!draft || !!busy || !canEdit}
                  onChange={(e) =>
                    setDraft((d) =>
                      d ? { ...d, guidance: e.target.value } : d,
                    )
                  }
                  placeholder="Optional conventions or evidence to prioritize"
                />
              </label>
              <div className="rounded-lg border border-border p-3 text-xs leading-relaxed text-muted">
                <ShieldCheck size={18} className="mb-2 text-accent-text" />
                One Hermes investigation follows this brief. Human review stays
                in the workflow. This plan does not grant tools or schedule
                automatic changes.
              </div>
              <div className="text-xs text-muted">
                <ArrowDown size={14} className="mb-2" />
                Stages keep their defined order when moved. Layout changes
                organize the canvas.
              </div>
            </>
          ) : component ? (
            <div className="grid gap-3 text-xs">
              <h3 className="font-semibold">Observed evidence</h3>
              <code className="break-all rounded border border-border p-2">
                {component.id}
              </code>
              <p className="text-muted">SHA-256</p>
              <code className="break-all text-muted">{component.sha256}</code>
              <p className="text-muted">Local dependencies</p>
              {component.dependencies.length ? (
                component.dependencies.map((d) => (
                  <button
                    key={d}
                    className="break-all text-left text-accent-text underline"
                    onClick={() => setSelected(d)}
                  >
                    {d}
                  </button>
                ))
              ) : (
                <p>No local dependency declaration observed.</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted">
              Connect the repository harness to inspect its current components.
            </p>
          )}
        </aside>
      </div>
      <dialog
        ref={picker}
        aria-label="Find workflow step"
        className="w-[min(380px,calc(100vw-32px))] rounded-xl border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/20 backdrop:backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) picker.current?.close();
        }}
      >
        <div className="flex items-center gap-2 border-b border-border p-3">
          <Search size={16} />
          <input
            autoFocus
            aria-label="Search nodes in picker"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            placeholder="Search nodes…"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
          />
          <button
            aria-label="Close step picker"
            className="t-control rounded p-1"
            onClick={() => picker.current?.close()}
          >
            <X size={16} />
          </button>
        </div>
        <div className="max-h-80 overflow-auto p-2">
          {graphStages
            .filter((s) =>
              (s.label + s.kind)
                .toLowerCase()
                .includes(pickerSearch.toLowerCase()),
            )
            .map((s) => (
              <button
                key={s.id}
                onClick={() => focusStep(s.id)}
                className="t-control flex w-full items-center gap-3 rounded-md p-3 text-left hover:bg-surface-2"
              >
                <span
                  className={cn("h-7 w-7 rounded-full", stepColor(s.kind))}
                />
                <span>
                  <span className="block text-sm font-medium">{s.label}</span>
                  <span className="text-xs text-muted">{s.kind}</span>
                </span>
              </button>
            ))}
        </div>
        <p className="border-t border-border p-3 text-xs text-muted">
          Jump to an existing step. The team workflow keeps its validated
          execution order.
        </p>
      </dialog>
    </div>
  );
}
