import { useRef, useState } from "react";
import { BookOpen, FileText, History, Wrench } from "lucide-react";
import { KnowledgePage } from "./Knowledge";
import { HarnessTrial } from "./HarnessTrial";
import { PageSidebar } from "@/components/shell/PageSidebar";
import { Badge, Button } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace, when } from "@/lib/live";

type Audit = {
  id: string;
  repository: string;
  revision: string;
  created_at: string;
  file_count: number;
  bytes: number;
  duplicate_bytes: number;
  files: { path: string; sha256: string; bytes: number; duplicate: boolean }[];
  proposal: {
    id: string;
    version: number;
    state: string;
    result: {
      input_bytes: number;
      candidate_bytes: number;
      saved_bytes: number;
      quality_check: string;
      scope: string;
    } | null;
  } | null;
};
type Feed = {
  control: {
    version: number;
    paused: boolean;
    connected: boolean;
    repository: string | null;
    latest_scan: string | null;
    last_seen: string | null;
  };
  items: Audit[];
  history_limit: number;
};
type Context = {
  context: null | {
    schema_version: number;
    scan_id: string;
    proposal_id: string;
    revision: string;
    bundle: {
      bodies: Record<string, string>;
      sources: { path: string; body: string }[];
    };
  };
};
const sections = [
  { id: "memory", label: "Memory", icon: BookOpen },
  { id: "repository", label: "Repository context", icon: FileText },
  { id: "tools", label: "Skills & tools", icon: Wrench },
  { id: "trial", label: "Run a trial", icon: Wrench },
  { id: "activity", label: "Activity", icon: History },
] as const;
type Section = (typeof sections)[number]["id"];
const labels: Record<string, string> = {
  pending: "Needs review",
  accepted: "Approved",
  declined: "Declined",
  queued: "Evaluation queued",
  evaluating: "Evaluating",
  stale: "Snapshot changed",
  failed: "Evaluation interrupted",
};

export function HarnessPage() {
  const [section, setSection] = useState<Section>(() => {
    const value = new URLSearchParams(location.search).get("harness-section");
    return sections.find((item) => item.id === value)?.id || "memory";
  });
  function select(value: Section) {
    setSection(value);
    const url = new URL(location.href);
    url.searchParams.set("harness-section", value);
    history.replaceState(null, "", url);
  }
  return (
    <div className="grid min-w-0 gap-5 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold">Harness</h1>
        <p className="text-sm text-muted">
          Review what your agents can read, where it came from, and which tools
          they can use.
        </p>
      </header>
      <nav aria-label="Harness sections" className="flex flex-wrap gap-2">
        {sections.map(({ id, label, icon: Icon }) => (
          <Button
            key={id}
            aria-current={section === id ? "page" : undefined}
            variant={section === id ? "default" : "secondary"}
            onClick={() => select(id)}
          >
            <Icon size={15} />
            {label}
          </Button>
        ))}
      </nav>
      {section === "memory" ? (
        <KnowledgePage embedded />
      ) : (
        <>
          <PageSidebar>
            <section className="page-sidebar-group">
              <h3 className="page-sidebar-label">Context access</h3>
              <p className="page-sidebar-note">
                Repository instructions are source data. Approval makes a
                current snapshot available for explicit Pi review; it grants no
                execution permissions.
              </p>
              <a className="page-sidebar-link" href="/?view=architecture">
                Repository architecture
              </a>
              <a className="page-sidebar-link" href="/?view=agents">
                Agent skills
              </a>
              <a
                className="page-sidebar-link"
                href="/?view=settings&connection=pi"
              >
                Pi connection
              </a>
            </section>
          </PageSidebar>
          {section === "trial" ? (
            <HarnessTrial />
          ) : section === "tools" ? (
            <HarnessTools />
          ) : (
            <RepositoryContext activity={section === "activity"} />
          )}
        </>
      )}
    </div>
  );
}

function HarnessTools() {
  return (
    <section className="grid gap-4" aria-label="Harness tools">
      <h2 className="text-lg font-semibold">Skills & tools</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {[
          [
            "Team workflow skills",
            "Choose a supported investigation brief in the skills library. Applying a brief does not start a run or grant tools.",
            "/?view=agents",
            "Open skills library",
          ],
          [
            "Pi context review",
            "Read an approved instruction snapshot and ask your configured Pi model to assess it. No shell, file writes, approvals or external messaging tools are enabled by this integration.",
            "/?view=settings&connection=pi",
            "Set up Pi",
          ],
          [
            "Reviewed memory",
            "Shared observations retain their source revision and reviewer. Revoked and stale records are excluded from retrieval.",
            "/?view=harness&harness-section=memory",
            "Open memory",
          ],
          [
            "Private Mem0 notes",
            "Optional agent working notes stay separate from reviewed memory. Authentication and provider costs are separate; a saved preference is not a connection test.",
            "/?view=settings&connection=mem0",
            "Configure private notes",
          ],
        ].map(([title, description, href, action]) => (
          <article
            key={title}
            className="rounded-lg border border-border bg-surface p-4"
          >
            <h3 className="font-medium">{title}</h3>
            <p className="my-3 text-sm text-muted">{description}</p>
            <a
              className="t-control text-sm text-accent-text underline"
              href={href}
            >
              {action}
            </a>
          </article>
        ))}
      </div>
      <p className="text-xs text-muted">
        These are supported integration paths, not an installation inventory.
        Importing third-party skills, MCP servers or Pi packages is not enabled
        here.
      </p>
    </section>
  );
}

function RepositoryContext({ activity }: { activity: boolean }) {
  const { data: workspace } = useWorkspace();
  const feed = useLoad(() => api<Feed>("/autonomy"), [], 5000);
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get("audit") || "",
  );
  const [preview, setPreview] = useState<Context>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const control = feed.data?.control;
  const current =
    feed.data?.items.find((item) => item.id === selected) ||
    feed.data?.items.find((item) => item.id === control?.latest_scan) ||
    feed.data?.items[0];
  const editable =
    !!workspace?.account.enabled &&
    workspace.account.role !== "viewer" &&
    !feed.error &&
    !feed.loading;
  const fresh =
    !!control?.connected &&
    !control.paused &&
    current?.id === control.latest_scan;
  const canDecide = editable && fresh && current?.proposal?.state === "pending";
  const visibleContext =
    !feed.error &&
    fresh &&
    current?.proposal?.state === "accepted" &&
    preview?.context?.scan_id === current?.id
      ? preview.context
      : null;
  async function change(path: string, body: unknown, message: string) {
    if (lock.current || !editable) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(undefined);
    try {
      await api(path, "POST", body);
      setNotice(message);
    } catch (e) {
      setError(errorText(e));
    } finally {
      feed.refresh();
      setBusy(false);
      lock.current = false;
    }
  }
  function choose(id: string) {
    setSelected(id);
    setPreview(undefined);
    setNotice("");
    const url = new URL(location.href);
    url.searchParams.set("audit", id);
    history.replaceState(null, "", url);
  }
  return (
    <section className="grid min-w-0 gap-4" aria-label="Repository harness">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {activity ? "Context activity" : "Repository context"}
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => {
              setPreview(undefined);
              feed.refresh();
            }}
          >
            Refresh context
          </Button>
          {control && (
            <Button
              disabled={busy || !editable}
              pending={busy}
              onClick={() =>
                void change(
                  "/autonomy/control",
                  { version: control.version, paused: !control.paused },
                  control.paused
                    ? "Monitoring resumed."
                    : "Monitoring paused. Context retrieval is unavailable while paused.",
                )
              }
            >
              {control.paused ? "Resume monitoring" : "Pause monitoring"}
            </Button>
          )}
        </div>
      </div>
      {(error || feed.error) && (
        <p role="alert" className="text-danger">
          {error || feed.error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!feed.data && !feed.error && (
        <p role="status">Checking repository monitor…</p>
      )}
      {feed.error && (
        <p className="text-sm text-muted">
          Repository context requires a reachable local workspace. Memory
          remains available in its own section.
        </p>
      )}
      {control && (
        <article className="grid gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="break-all font-medium">
              {control.repository || "No repository recorded"}
            </h3>
            <Badge
              tone={
                !feed.error && control.connected && !control.paused
                  ? "ok"
                  : "neutral"
              }
            >
              {feed.error
                ? "Status unavailable"
                : control.paused
                  ? "Paused"
                  : control.connected
                    ? "Monitor connected"
                    : "Monitor offline"}
            </Badge>
          </div>
          <p className="text-xs text-muted">
            Last observed:{" "}
            {control.last_seen ? when(control.last_seen) : "Not recorded"}.
            Tracked AGENTS.md, CLAUDE.md and SKILL.md only. Untracked files and
            arbitrary repository code are not included.
          </p>
          <p className="text-xs text-muted">
            Read-only collection and lossless storage evaluation. No automatic
            model calls, source edits or package installation.
          </p>
          {!control.connected && (
            <details className="text-sm">
              <summary className="cursor-pointer">
                Repository monitor setup
              </summary>
              <p className="mt-2 text-muted">
                Relay development startup includes the read-only monitor for its
                checkout. For another repository, start the bundled monitor
                locally with its folder path. This page cannot start local
                processes.
              </p>
              <pre className="mt-2 overflow-auto text-xs">
                python3 integrations/context-harness/worker.py --repo
                /path/to/repository --api http://127.0.0.1:8178/api/v1
              </pre>
            </details>
          )}
        </article>
      )}
      {feed.data && !feed.data.items.length && (
        <p className="text-sm text-muted">
          No instruction snapshots recorded. Connect the repository monitor to
          collect tracked instructions.
        </p>
      )}
      {feed.data && feed.data.items.length > 0 && (
        <>
          {activity && (
            <ul
              aria-label="Context evaluation history"
              className="divide-y divide-border rounded-lg border border-border bg-surface"
            >
              {feed.data.items.map((item) => (
                <li key={item.id}>
                  <button
                    className="t-control grid w-full gap-1 p-3 text-left hover:bg-surface-2"
                    aria-current={current?.id === item.id ? "true" : undefined}
                    onClick={() => choose(item.id)}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="break-all font-mono">{item.id}</span>
                      <Badge>
                        {item.proposal
                          ? labels[item.proposal.state] || item.proposal.state
                          : "Audit recorded"}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted">
                      {when(item.created_at)} · {item.file_count} instruction
                      files · {item.bytes.toLocaleString()} source bytes
                    </span>
                    <span className="break-all font-mono text-xs text-muted">
                      {item.revision}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="grid gap-2 text-sm">
            Recorded snapshot
            <select
              className="min-w-0 max-w-full rounded-md border border-border bg-surface p-2"
              value={current?.id || ""}
              onChange={(event) => choose(event.target.value)}
            >
              {feed.data.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id} · {when(item.created_at)}
                  {item.id === control?.latest_scan
                    ? " · latest"
                    : " · historical"}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted">
            Up to {feed.data.history_limit} recent snapshots. Pi reviews and
            provider costs stay in Pi sessions, not this storage-evaluation
            history.
          </p>
        </>
      )}
      {current && (
        <article className="grid min-w-0 gap-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">Instruction snapshot</h3>
            <Badge>
              {current.proposal
                ? labels[current.proposal.state] || current.proposal.state
                : current.file_count
                  ? "Awaiting monitor evaluation"
                  : "No instruction files"}
            </Badge>
            {!fresh && <Badge>Not available for retrieval</Badge>}
          </div>
          <p className="break-all font-mono text-xs">
            {current.id} · {current.revision}
          </p>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Instruction files</dt>
              <dd>{current.file_count}</dd>
            </div>
            <div>
              <dt className="text-muted">Source bytes</dt>
              <dd>{current.bytes.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted">Repeated bytes</dt>
              <dd>{current.duplicate_bytes.toLocaleString()}</dd>
            </div>
          </dl>
          <ul
            aria-label="Tracked instructions"
            className="divide-y divide-border"
          >
            {current.files.map((file) => (
              <li key={file.path} className="grid gap-1 py-2 text-xs">
                <span className="break-all font-mono">{file.path}</span>
                <span className="text-muted">
                  {file.bytes.toLocaleString()} bytes
                  {file.duplicate ? " · duplicate content" : ""}
                </span>
                <span className="break-all font-mono text-muted">
                  SHA-256 {file.sha256}
                </span>
              </li>
            ))}
          </ul>
          {current.proposal?.result && (
            <div className="rounded-md bg-surface-2 p-3 text-sm">
              <h4 className="font-medium">Lossless storage evaluation</h4>
              <p>
                {current.proposal.result.input_bytes.toLocaleString()} input
                bytes →{" "}
                {current.proposal.result.candidate_bytes.toLocaleString()}{" "}
                packed bytes.
              </p>
              <p className="text-xs text-muted">
                {current.proposal.result.quality_check} This is not a measured
                token saving or model-quality result.
              </p>
            </div>
          )}
          {current.proposal?.state === "pending" && (
            <div className="grid gap-3">
              <p className="text-sm text-muted">
                Approve this exact evaluated snapshot for explicit context
                retrieval. Pi can read its instruction contents; approval does
                not start a model or authorize code execution.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !canDecide}
                  onClick={() =>
                    void change(
                      `/autonomy/proposals/${current.proposal!.id}/decision`,
                      {
                        version: current.proposal!.version,
                        decision: "approve",
                      },
                      "Snapshot approved for context retrieval. No model was started.",
                    )
                  }
                >
                  Approve context
                </Button>
                <Button
                  disabled={busy || !canDecide}
                  onClick={() =>
                    void change(
                      `/autonomy/proposals/${current.proposal!.id}/decision`,
                      {
                        version: current.proposal!.version,
                        decision: "decline",
                      },
                      "Candidate declined. Its history remains recorded.",
                    )
                  }
                >
                  Decline context
                </Button>
              </div>
            </div>
          )}
          {current.proposal?.state === "accepted" && (
            <div className="grid gap-3">
              <Button
                disabled={busy || !fresh || !!feed.error}
                onClick={async () => {
                  if (lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  setError("");
                  setPreview(undefined);
                  try {
                    const value = await api<Context>("/autonomy/context");
                    setPreview(value);
                    if (!value.context)
                      setNotice(
                        "No approved current snapshot is available. Refresh context.",
                      );
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                    lock.current = false;
                  }
                }}
              >
                Preview approved context
              </Button>
              <p className="text-xs text-muted">
                Pi exposes this snapshot through an explicit context-review
                command. Existing sessions retain what they already read;
                pausing prevents new retrieval, not retroactive deletion.
              </p>
            </div>
          )}
          {visibleContext && (
            <section
              aria-label="Approved context preview"
              className="grid min-w-0 gap-3"
            >
              <h4 className="font-medium">Exact approved contents</h4>
              {visibleContext.bundle.sources.map((source) => (
                <details
                  key={source.path}
                  className="min-w-0 rounded-md border border-border p-3"
                >
                  <summary className="cursor-pointer break-all text-sm">
                    {source.path}
                  </summary>
                  <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
                    {visibleContext.bundle.bodies[source.body]}
                  </pre>
                </details>
              ))}
            </section>
          )}
        </article>
      )}
    </section>
  );
}
