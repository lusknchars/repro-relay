import { useState } from "react";
import {
  ArrowUpRight,
  Activity,
  Check,
  FlaskConical,
  Grid2X2,
  List,
  LoaderCircle,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui";
import { IntegrationLogo } from "@/components/integration-logo";
import type { Route } from "@/components/shell/Shell";
import { api, errorText, useLoad, useWorkspace, when } from "@/lib/live";
import type { ArchitectureRecord, Focus } from "./Architecture";
import "./agents.css";
import { PageSidebar } from "@/components/shell/PageSidebar";
const tabs = ["Skills", "Runtime", "Activity", "Access"] as const;
export function AgentsPage({
  onRoute,
  onWork,
}: {
  onRoute: (route: Route) => void;
  onWork: (id: string) => void;
}) {
  const workspace = useWorkspace();
  const briefs = useLoad(
    () => api<ArchitectureRecord>("/architectures"),
    [],
    15000,
  );
  const [tab, setTab] = useState<(typeof tabs)[number]>(
    () =>
      tabs.find(
        (t) =>
          t.toLowerCase() ===
          new URLSearchParams(location.search).get("agent-section"),
      ) || "Skills",
  );
  const [confirmed, setConfirmed] = useState<ArchitectureRecord | null>(null);
  const catalog =
    confirmed && confirmed.version >= (briefs.data?.version || 0)
      ? confirmed
      : briefs.data;
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState("cards");
  const [busy, setBusy] = useState<Focus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reconcile, setReconcile] = useState(false);
  const runtime = workspace.data?.runner;
  const status = !runtime
    ? "Status unavailable"
    : runtime.available
      ? "Runtime available"
      : "Runtime unavailable";
  const templates = catalog?.templates || [];
  const shown = templates.filter((skill) =>
    `${skill.name} ${skill.summary} ${skill.objective}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const owner = workspace.data?.account.role === "owner";
  const activeSkill = templates.find(
    (skill) => skill.focus === catalog?.settings.focus,
  );
  const recordedRuns = workspace.data?.runs.filter(
    (run) => run.execution_kind !== "local_validation",
  );
  function selectTab(value: (typeof tabs)[number]) {
    setTab(value);
    const url = new URL(location.href);
    url.searchParams.set("agent-section", value.toLowerCase());
    url.searchParams.delete("agent");
    history.replaceState(null, "", url);
  }
  async function apply(focus: Focus) {
    if (!catalog || busy || reconcile || !owner) return;
    setBusy(focus);
    setError("");
    setNotice("");
    try {
      await api("/architectures", "PUT", {
        version: catalog.version,
        settings: { ...catalog.settings, focus },
      });
      // Reconcile the authoritative selection before allowing another mutation.
      setReconcile(true);
      setConfirmed(await api<ArchitectureRecord>("/architectures"));
      setReconcile(false);
      briefs.refresh();
      setNotice(
        "Skill applied to new investigations. Current runs keep their saved workflow.",
      );
    } catch (e) {
      setError(errorText(e));
      setReconcile(true);
    } finally {
      setBusy(null);
    }
  }
  async function checkSelection() {
    setError("");
    try {
      setConfirmed(await api<ArchitectureRecord>("/architectures"));
      briefs.refresh();
      setReconcile(false);
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <div className="agents-library">
      <PageSidebar>
        <div className="page-sidebar-identity">
          <IntegrationLogo provider="hermes" size={32} />
          <div>
            <strong className="text-sm">Hermes</strong>
            <p className="page-sidebar-note">{status}</p>
          </div>
        </div>
        <nav className="page-sidebar-nav" aria-label="Agent sections">
          {tabs.map((value) => {
            const Icon =
              value === "Skills"
                ? Sparkles
                : value === "Runtime"
                  ? Workflow
                  : value === "Activity"
                    ? Activity
                    : ShieldCheck;
            const count =
              value === "Skills"
                ? catalog
                  ? templates.length
                  : undefined
                : value === "Activity"
                  ? recordedRuns?.length
                  : undefined;
            return (
              <button
                key={value}
                className="page-sidebar-link"
                aria-label={value}
                aria-current={tab === value ? "page" : undefined}
                onClick={() => selectTab(value)}
              >
                <Icon size={16} />
                <span>{value}</span>
                {count !== undefined && (
                  <span className="page-sidebar-count" aria-hidden="true">
                    {count}
                    {value === "Activity" && workspace.data?.moreRuns
                      ? "+"
                      : ""}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <section
          className="page-sidebar-group page-sidebar-divider"
          aria-label="Selected workflow"
        >
          <h3 className="page-sidebar-label">Active skill</h3>
          <p className="text-xs font-medium">
            {activeSkill?.name ||
              (briefs.error ? "Selection unavailable" : "Loading selection…")}
          </p>
          <p className="page-sidebar-note">
            Used for new investigations. Running work keeps its saved workflow.
          </p>
          <button
            className="page-sidebar-link"
            onClick={() => onRoute("architecture")}
          >
            <Workflow size={15} />
            Edit team workflow
            <ArrowUpRight size={13} />
          </button>
        </section>
        <section className="page-sidebar-group page-sidebar-divider">
          <h3 className="page-sidebar-label">Workspace access</h3>
          <p className="page-sidebar-note">
            {owner
              ? "Administrator · skills and connections"
              : workspace.data?.account.authenticated
                ? "Teammate · inspect skills and activity"
                : "Checking workspace access…"}
          </p>
          <button
            className="page-sidebar-link"
            onClick={() => onRoute("settings")}
          >
            <ShieldCheck size={15} />
            Manage connections
          </button>
        </section>
      </PageSidebar>
      <header className="agents-heading">
        <div>
          <h1>Agents</h1>
          <p>Choose how Hermes helps your team.</p>
        </div>
        <Button onClick={() => onRoute("settings")}>
          Connections <ArrowUpRight size={14} />
        </Button>
      </header>
      {tab === "Skills" && (
        <>
          <div className="agents-section-heading">
            <div>
              <h2>Skills library</h2>
              <p>
                Apply a workflow to new Hermes investigations. One skill is
                active at a time.
              </p>
            </div>
            <span>{templates.length} available</span>
          </div>
          <div className="agents-toolbar">
            <label>
              <Search size={16} />
              <input
                aria-label="Filter skills"
                placeholder="Search skills…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div aria-label="Skill layout">
              <button
                aria-label="Cards"
                aria-pressed={layout === "cards"}
                onClick={() => setLayout("cards")}
              >
                <Grid2X2 size={16} />
              </button>
              <button
                aria-label="List"
                aria-pressed={layout === "list"}
                onClick={() => setLayout("list")}
              >
                <List size={16} />
              </button>
            </div>
          </div>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {reconcile && (
            <Button onClick={() => void checkSelection()}>
              Refresh skill selection
            </Button>
          )}
          {briefs.loading && !briefs.data && (
            <p role="status">Loading skills…</p>
          )}
          {briefs.error && (
            <div role="alert">
              <p>Skills could not be loaded. {briefs.error}</p>
              <Button onClick={briefs.refresh}>Retry skills</Button>
            </div>
          )}
          <div className={`agents-skill-grid agents-skill-grid--${layout}`}>
            {shown.map((skill) => {
              const active = catalog?.settings.focus === skill.focus;
              const Icon =
                skill.focus === "test_triage"
                  ? FlaskConical
                  : skill.focus === "context_efficiency"
                    ? Sparkles
                    : Search;
              return (
                <article
                  className="agents-skill"
                  key={skill.focus}
                  data-active={active}
                >
                  <div className="agents-skill-top">
                    <span className="agents-skill-icon">
                      <Icon size={26} />
                    </span>
                    <span className="agents-skill-state">
                      {active ? (
                        <>
                          <Check size={13} />
                          Active
                        </>
                      ) : (
                        "Available"
                      )}
                    </span>
                  </div>
                  <h3>{skill.name}</h3>
                  <p>{skill.summary}</p>
                  <div className="agents-skill-provider">
                    <IntegrationLogo provider="hermes" size={18} />
                    Hermes · Built-in workflow
                  </div>
                  <details>
                    <summary>What this skill does</summary>
                    <p>{skill.objective}</p>
                    <ol>
                      {skill.stages.map((stage) => (
                        <li key={stage.id}>
                          <strong>{stage.label}</strong>
                          <p>{stage.detail}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                  <Button
                    disabled={
                      active || !owner || !!busy || reconcile || briefs.loading
                    }
                    onClick={() => void apply(skill.focus)}
                  >
                    {busy === skill.focus ? (
                      <>
                        <LoaderCircle size={14} className="animate-spin" />
                        Applying…
                      </>
                    ) : active ? (
                      <>
                        <Check size={14} />
                        Active skill
                      </>
                    ) : (
                      <>
                        Use skill <ArrowUpRight size={14} />
                      </>
                    )}
                  </Button>
                </article>
              );
            })}
          </div>
          {!briefs.loading && !briefs.error && !shown.length && (
            <p role="status">
              {query
                ? "No skills match your search."
                : "No workflow skills are available."}
            </p>
          )}
          {!owner && workspace.data && (
            <p className="agents-help">
              An administrator can change the team's active skill.
            </p>
          )}
          <div className="agents-runtime-row">
            <IntegrationLogo provider="hermes" />
            <div>
              <strong>Hermes</strong>
              <p>{status}</p>
            </div>
            <Button onClick={() => selectTab("Runtime")}>
              Runtime details
            </Button>
            <Button onClick={() => onRoute("architecture")}>
              <Workflow size={14} />
              Edit workflow
            </Button>
          </div>
        </>
      )}
      {tab === "Runtime" && (
        <section className="agents-detail">
          <div className="agents-runtime-row">
            <IntegrationLogo provider="hermes" size={40} />
            <div>
              <h2>Hermes runtime</h2>
              <p>{status}</p>
            </div>
          </div>
          {workspace.error && <p role="alert">{workspace.error}</p>}
          <p>
            {runtime?.reason ||
              "Runtime connection is configured separately from the active workflow skill."}
          </p>
          <Button onClick={() => onRoute("settings")}>
            Manage connections
          </Button>
          <Button onClick={workspace.refresh}>Refresh runtime</Button>
        </section>
      )}
      {tab === "Activity" && (
        <section className="agents-detail">
          <h2>Recorded Hermes runs</h2>
          {workspace.error ? (
            <p role="alert">{workspace.error}</p>
          ) : workspace.loading && !workspace.data ? (
            <p role="status">Loading activity…</p>
          ) : (
            <>
              {!workspace.data?.runs.some(
                (run) => run.execution_kind !== "local_validation",
              ) && <p>No Hermes runs recorded.</p>}
              {workspace.data?.runs
                .filter((run) => run.execution_kind !== "local_validation")
                .map((run) => (
                  <button
                    className="agents-run"
                    key={run.id}
                    onClick={() => onWork(run.case_id)}
                  >
                    <strong>
                      {workspace.data?.cases.find(
                        (item) => item.id === run.case_id,
                      )?.title || run.case_id}
                    </strong>
                    <span>
                      {run.status} · {when(run.created_at)}
                    </span>
                    <code>{run.id}</code>
                  </button>
                ))}
            </>
          )}
        </section>
      )}
      {tab === "Access" && (
        <section className="agents-detail">
          <ShieldCheck size={24} />
          <h2>Access boundaries</h2>
          <p>
            Skills change investigation instructions. Workspace permissions and
            human review still govern code changes and external actions.
          </p>
          <p>
            Reviewed knowledge stays in the workspace. Provider credentials and
            runtime memory are managed in Connections.
          </p>
          <Button onClick={() => onRoute("settings")}>
            Inspect connections
          </Button>
          <Button onClick={() => onRoute("knowledge")}>Open knowledge</Button>
        </section>
      )}
    </div>
  );
}
