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
  context: { x: 70, y: 100 },
  investigate: { x: 480, y: 100 },
  evidence: { x: 480, y: 350 },
  human: { x: 70, y: 350 },
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
  const [mode, setMode] = useState<"repository" | "workflow">("repository");
  const saved = useLoad(() => api<ArchitectureRecord>("/architectures"));
  const [draft, setDraft] = useState<Settings>();
  const [selected, setSelected] = useState("investigate");
  const [zoom, setZoom] = useState(0.85);
  const [square, setSquare] = useState(false);
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
      b = position(to),
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = Math.min(
      125 / (Math.abs(dx) || 1),
      65 / (Math.abs(dy) || 1),
      0.4,
    );
    return `M ${a.x + 115 + dx * t} ${a.y + 56 + dy * t} L ${b.x + 115 - dx * t} ${b.y + 56 - dy * t}`;
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
          <Button
            aria-pressed={mode === "repository"}
            onClick={() => setMode("repository")}
          >
            Current repository
          </Button>
          <Button
            aria-pressed={mode === "workflow"}
            onClick={() => setMode("workflow")}
          >
            Team workflow
          </Button>
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
      <div className="grid min-h-0 lg:grid-cols-[230px_minmax(0,1fr)_260px]">
        <aside
          aria-label="Workflow templates"
          className="grid content-start gap-3 border-b border-border bg-surface p-4 lg:overflow-y-auto lg:border-r lg:border-b-0"
        >
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
                    "t-control grid gap-2 rounded-lg border p-3 text-left",
                    draft?.focus === t.focus
                      ? "border-accent bg-accent-soft"
                      : "border-border hover:bg-surface-2",
                  )}
                >
                  <span className="text-sm font-semibold">{t.name}</span>
                  <span className="text-xs leading-relaxed text-muted">
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
                    {repository.data.snapshot.nodes.length} observed manifests.
                    Lines show declared local dependencies. This is a manifest
                    inventory, not a full runtime call graph.
                  </p>
                </>
              )}
              <p className="text-xs leading-relaxed text-muted">
                The connected context harness updates this map. Source files and
                secrets are not uploaded; only manifest metadata and hashes are
                recorded.
              </p>
              {!repository.data?.current && (
                <code className="break-all rounded border border-border p-2 text-xs">
                  python3 integrations/context-harness/worker.py --repo .
                </code>
              )}
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
        </aside>
        <section
          aria-label="Architecture canvas"
          className="relative min-h-[480px] min-w-0 bg-background"
        >
          <div className="absolute left-3 right-3 top-3 z-10 flex flex-wrap justify-between gap-2 rounded-md border border-border bg-surface/95 p-2">
            <span className="self-center text-xs text-muted">
              {mode === "repository"
                ? "Observed manifests · select to inspect"
                : "Drag steps · arrow keys to move"}
            </span>
            <div className="flex gap-1">
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
            className="h-full min-h-[480px] overflow-auto pt-16"
            style={{
              backgroundImage: square
                ? "linear-gradient(var(--color-border) 1px, transparent 1px),linear-gradient(90deg,var(--color-border) 1px,transparent 1px)"
                : "radial-gradient(var(--color-border) 1.3px,transparent 1.3px)",
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
                      strokeWidth="2"
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
                        "absolute grid w-[230px] gap-3 rounded-xl border bg-surface p-4 text-left shadow-sm focus-visible:outline-2 focus-visible:outline-accent",
                        activeId === s.id
                          ? "border-accent ring-2 ring-accent/20"
                          : "border-border",
                      )}
                      style={{ left: p.x, top: p.y, touchAction: "none" }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        setSelected(s.id);
                        if (mode === "repository") return;
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
                        if (mode === "repository") return;
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
                      <span className="flex items-center justify-between text-xs uppercase tracking-wider text-muted">
                        {s.kind}
                        <Grip size={13} />
                      </span>
                      <span className="flex items-center gap-2 break-all text-sm font-semibold">
                        {s.kind === "agent" ? (
                          <IntegrationLogo provider="hermes" size={18} />
                        ) : s.kind === "human" ? (
                          <ShieldCheck size={18} />
                        ) : (
                          <ArrowRight size={18} />
                        )}{" "}
                        {s.label}
                      </span>
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
              Selected step
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
    </div>
  );
}
