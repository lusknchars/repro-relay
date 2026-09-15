import { useState } from "react";
import { Bell, Bug, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace } from "@/lib/live";

type Connection = {
  configured: boolean;
  syncing: boolean;
  settings?: {
    organization: string;
    project: string;
    relay_project: string;
    region: string;
    enabled: boolean;
  };
  progress: { last_success?: string; error?: string; checked_at?: string };
};
type Alert = {
  id: string;
  case_id: string;
  read: boolean;
  created_at: string;
  work_status: string;
  alert: {
    kind: string;
    message: string;
    issue: {
      title: string;
      release: string;
      environment: string;
      status: string;
      url: string;
      last_seen: string;
    };
  };
};
type Feed = { items: Alert[]; unread: number };

export function SentryConnection() {
  const state = useLoad(() => api<Connection>("/connections/sentry"), [], 3000);
  const workspace = useWorkspace();
  const admin =
    !workspace.data?.account?.role || workspace.data.account.role === "owner";
  const [editing, setEditing] = useState(false);
  const [organization, setOrganization] = useState("");
  const [region, setRegion] = useState("us");
  const [token, setToken] = useState("");
  const [projects, setProjects] = useState<{ slug: string; name: string }[]>(
    [],
  );
  const [project, setProject] = useState("");
  const [relayProject, setRelayProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const credentials = {
    organization: organization.trim(),
    region,
    token: token.trim(),
  };
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      state.refresh();
      workspace.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setProjects([]);
    setProject("");
    setToken("");
    setEditing(false);
  }
  const settings = state.data?.settings;
  return (
    <section
      className="grid min-w-0 gap-3 rounded-lg border border-border-strong p-4"
      aria-label="Sentry connection"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-medium">
          <Bug size={18} />
          Sentry
        </h3>
        <Badge
          tone={
            state.data?.progress.error
              ? "danger"
              : settings?.enabled
                ? "ok"
                : "outline"
          }
          dot
        >
          {state.data?.progress.error
            ? "Check failed"
            : settings?.enabled
              ? "Monitoring enabled"
              : state.data?.configured
                ? "Paused"
                : "Not connected"}
        </Badge>
      </div>
      <p className="text-sm text-muted">
        Connect your Sentry Cloud account, select a project, and bring reported
        bugs into Work. Uses read access to projects and events. New issues and
        release changes appear in Relay notifications.
      </p>
      {settings && (
        <p className="break-words text-sm">
          {settings.organization} / {settings.project} →{" "}
          {settings.relay_project}
        </p>
      )}
      <p className="text-xs text-muted" role="status">
        {state.data?.syncing
          ? "Checking Sentry…"
          : state.data?.progress.last_success
            ? `Last successful check: ${new Date(state.data.progress.last_success).toLocaleString()}`
            : state.data?.configured
              ? "Credentials checked. Waiting for an issue sync."
              : "Your API token stays in this installation's private backend storage."}
      </p>
      {(error || state.error || state.data?.progress.error) && (
        <p role="alert" className="text-sm text-danger">
          {error || state.error || state.data?.progress.error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-ok">
          {notice}
        </p>
      )}
      {admin && (!state.data?.configured || editing) && (
        <form
          className="grid min-w-0 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void perform(async () => {
              if (!projects.length) {
                const result = await api<{ items: typeof projects }>(
                  "/connections/sentry/projects",
                  "POST",
                  credentials,
                );
                setProjects(result.items);
                setProject(result.items[0]?.slug || "");
                setRelayProject(result.items[0]?.name || "");
                if (!result.items.length)
                  setNotice(
                    "No accessible projects found. Check your token's organization and project access.",
                  );
              } else {
                await api("/connections/sentry/connect", "POST", {
                  ...credentials,
                  project,
                  relay_project: relayProject.trim(),
                  enabled: true,
                });
                reset();
                setNotice("Sentry connected. Issue monitoring is enabled.");
              }
            });
          }}
        >
          {!projects.length ? (
            <>
              <label className="grid gap-1 text-xs">
                Organization slug
                <Input
                  required
                  maxLength={100}
                  autoComplete="off"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="your-organization"
                />
              </label>
              <label className="grid gap-1 text-xs">
                Data region
                <select
                  className="h-9 w-full rounded-md border border-border bg-surface px-3"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                >
                  <option value="us">United States</option>
                  <option value="de">European Union</option>
                  <option value="global">Global / sentry.io</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs">
                Sentry API token
                <Input
                  required
                  type="password"
                  autoComplete="off"
                  maxLength={4096}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </label>
              <a
                className="text-xs text-accent-text underline"
                href="https://sentry.io/settings/account/api/auth-tokens/"
                target="_blank"
                rel="noreferrer"
              >
                Create a token with org:read and event:read
              </a>
            </>
          ) : (
            <>
              <p className="text-sm">
                Account checked. Select the project this workspace should watch.
              </p>
              <label className="grid gap-1 text-xs">
                Sentry project
                <select
                  className="h-9 w-full rounded-md border border-border bg-surface px-3"
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value);
                    setRelayProject(
                      projects.find((p) => p.slug === e.target.value)?.name ||
                        e.target.value,
                    );
                  }}
                >
                  {projects.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.name} ({p.slug})
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-xs">
                Relay project name
                <Input
                  required
                  maxLength={80}
                  value={relayProject}
                  onChange={(e) => setRelayProject(e.target.value)}
                />
              </label>
              <p className="text-xs text-muted">
                Enabling imports recent issues automatically. Investigation
                starts from Work; connecting does not authorize fixes or
                external messages. First 100 accessible projects are listed.
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="default"
              disabled={busy || state.data?.syncing}
            >
              {busy
                ? "Checking…"
                : projects.length
                  ? "Enable Sentry monitoring"
                  : "Connect Sentry"}
            </Button>
            {(editing || projects.length > 0) && (
              <Button type="button" disabled={busy} onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      )}
      {admin && settings && !editing && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || state.data?.syncing || !settings.enabled}
            onClick={() =>
              perform(async () => {
                await api("/connections/sentry/sync", "POST", {});
              })
            }
          >
            <RefreshCw size={14} />
            Check now
          </Button>
          <Button
            disabled={busy || state.data?.syncing}
            onClick={() =>
              perform(async () => {
                await api("/connections/sentry/enabled", "POST", {
                  enabled: !settings.enabled,
                });
              })
            }
          >
            {settings.enabled ? "Pause monitoring" : "Resume monitoring"}
          </Button>
          <details className="text-sm">
            <summary className="cursor-pointer rounded border border-border px-3 py-2">
              Manage connection
            </summary>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                disabled={busy || state.data?.syncing}
                onClick={() => setEditing(true)}
              >
                Change account
              </Button>
              <Button
                disabled={busy || state.data?.syncing}
                onClick={() =>
                  perform(async () => {
                    await api("/connections/sentry/disconnect", "POST", {});
                    reset();
                  })
                }
              >
                Disconnect Sentry
              </Button>
            </div>
          </details>
        </div>
      )}
      {!admin && (
        <p className="text-xs text-muted">
          The workspace administrator manages this connection.
        </p>
      )}
      <p className="text-xs text-muted">
        Checks run while the Relay backend is running, about once a minute. The
        feed covers 20 recently seen issues within 14 days, up to 5 changed
        events per check. Release labels require Sentry release data; they do
        not establish a successful build.
      </p>
    </section>
  );
}

export function SentryAlerts({ onWork }: { onWork: (id: string) => void }) {
  const feed = useLoad(() => api<Feed>("/sentry/alerts"), [], 5000);
  const [notice, setNotice] = useState("");
  async function markRead(id: string) {
    try {
      await api(`/sentry/alerts/${id}/read`, "POST", {});
      feed.refresh();
    } catch (e) {
      setNotice(errorText(e));
    }
  }
  return (
    <Card className="min-w-0 overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Bell size={16} />
          Sentry bug notifications
        </h2>
        <Badge tone="outline">{feed.data?.unread ?? 0} unread</Badge>
      </header>
      {feed.error && (
        <p className="p-4 text-sm text-danger" role="alert">
          {feed.error}
        </p>
      )}
      {notice && (
        <p className="p-4 text-sm" role="status">
          {notice}
        </p>
      )}
      {!feed.data?.items.length && (
        <p className="p-4 text-sm text-muted">
          {feed.loading
            ? "Loading notifications…"
            : "No imported Sentry alerts. Connect a project to bring its reported bugs here."}
        </p>
      )}
      <div className="max-h-[540px] overflow-auto">
        {feed.data?.items.map((item) => (
          <article
            className="grid min-w-0 gap-2 border-b border-border p-4 last:border-0"
            key={item.id}
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                dot
                tone={
                  item.alert.issue.status === "resolved" ? "outline" : "danger"
                }
              >
                {item.alert.issue.status || "Reported"}
              </Badge>
              <span className="text-xs text-muted">
                {new Date(item.created_at).toLocaleString()}
              </span>
              {!item.read && <Badge tone="info">New</Badge>}
            </div>
            <h3 className="break-words text-sm font-medium">
              {item.alert.issue.title}
            </h3>
            <p className="break-words text-xs text-muted">
              Release: {item.alert.issue.release || "Not reported"} ·
              Environment: {item.alert.issue.environment || "Not reported"} ·
              Relay work: {item.work_status}
            </p>
            <details>
              <summary className="cursor-pointer text-xs text-muted">
                Message preview
              </summary>
              <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-accent pl-3 text-sm">
                {item.alert.message}
              </p>
            </details>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => onWork(item.case_id)}>
                Open investigation
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      item.alert.message + `\n${item.alert.issue.url}`,
                    );
                    setNotice("Message copied. Nothing was sent.");
                  } catch {
                    setNotice(
                      "Copy unavailable. Select the text in Message preview.",
                    );
                  }
                }}
              >
                <Copy size={12} />
                Copy message
              </Button>
              {!item.read && (
                <Button size="sm" onClick={() => markRead(item.id)}>
                  Mark read
                </Button>
              )}
              <a
                className="inline-flex items-center gap-1 text-xs text-accent-text"
                href={item.alert.issue.url}
                target="_blank"
                rel="noreferrer"
              >
                View Sentry
                <ExternalLink size={12} />
              </a>
            </div>
          </article>
        ))}
      </div>
      <p className="p-3 text-xs text-muted">
        Latest 100 alerts. Read state is shared with this workspace. Provider
        reports are evidence to investigate; external delivery is not automatic.
      </p>
    </Card>
  );
}

export function SentryBell({ onOpen }: { onOpen: () => void }) {
  const workspace = useWorkspace();
  const local = workspace.data?.account.local_access === true;
  const feed = useLoad(
    () =>
      local
        ? api<Feed>("/sentry/alerts")
        : Promise.resolve<Feed>({ items: [], unread: 0 }),
    [local],
    15000,
  );
  const count = feed.data?.unread || 0;
  return (
    <button
      className="t-control relative grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-foreground"
      aria-label={`Bug notifications${count ? `: ${count} unread` : ""}`}
      onClick={onOpen}
    >
      <Bell className="h-4 w-4" />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 rounded-full bg-danger px-1 text-[10px] text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
