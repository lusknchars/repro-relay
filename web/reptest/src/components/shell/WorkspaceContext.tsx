import { ArrowUpRight, X } from "lucide-react";
import { useWorkspace } from "@/lib/live";
import { IntegrationLogo } from "@/components/integration-logo";
import type { Route } from "./Shell";
import { PageSidebarMount } from "./PageSidebar";

const CONTEXT: Record<
  Route,
  { title: string; description: string; links: [Route, string][] }
> = {
  competitors: {
    title: "Competitor research",
    description: "Saved sources are reference material, not verified market coverage.",
    links: [["settings", "Manage research sources"], ["team", "Read Hermes replies"]],
  },
  agents: {
    title: "Workspace agents",
    description: "Inspect supported capabilities and recorded execution. Briefs do not grant permissions.",
    links: [["architecture", "Configure team workflow"], ["settings", "Connect runtimes and Plow"], ["knowledge", "Review shared knowledge"]],
  },
  users: {
    title: "Workspace users",
    description: "Review joined teammates and create an invitation for someone new.",
    links: [["users-create", "Create user invitation"], ["team", "Open team conversation"]],
  },
  "users-create": {
    title: "Invite a teammate",
    description: "Preview a new member invitation. The recipient confirms their own profile when joining.",
    links: [["users", "View user list"], ["team", "Manage team invitations"]],
  },
  work: {
    title: "Investigation workspace",
    description: "Follow the evidence, then review the proposed change.",
    links: [
      ["reach", "Open team follow-ups"],
      ["architecture", "Inspect repository structure"],
      ["monitoring", "Inspect recorded requests"],
    ],
  },
  reach: {
    title: "Daily coordination",
    description: "Turn meeting actions and todos into reviewed next steps.",
    links: [
      ["calendar", "Open planned activities"],
      ["team", "Open team conversation"],
      ["work", "Review investigations"],
    ],
  },
  team: {
    title: "Your team",
    description:
      "Invite teammates and share one administrator-managed Hermes agent.",
    links: [
      ["reach", "Open shared todos"],
      ["calendar", "Open team calendar"],
      ["settings", "Manage agent connections"],
    ],
  },
  architecture: {
    title: "Repository context",
    description: "Compare the observed repository with proposed workflows.",
    links: [
      ["knowledge", "Read reviewed knowledge"],
      ["work", "Review investigations"],
      ["settings", "Manage repository connection"],
    ],
  },
  calendar: {
    title: "Team planning",
    description: "Keep planned reviews and recorded activities together.",
    links: [
      ["reach", "Open meeting actions"],
      ["team", "Open team conversation"],
      ["settings", "Manage calendar connection"],
    ],
  },
  knowledge: {
    title: "Shared context",
    description:
      "Reviewed evidence and private working notes retain their source.",
    links: [
      ["work", "Inspect source reports"],
      ["architecture", "Inspect repository structure"],
      ["settings", "Manage memory connection"],
    ],
  },
  usage: {
    title: "Agent resources",
    description: "Inspect reported usage alongside the work that produced it.",
    links: [
      ["work", "Review investigation runs"],
      ["monitoring", "Inspect service health"],
      ["settings", "Manage model connections"],
    ],
  },
  monitoring: {
    title: "Service inspection",
    description: "Recorded requests and health checks help explain failures.",
    links: [
      ["work", "Review affected work"],
      ["usage", "Inspect token usage"],
      ["settings", "Manage connections"],
    ],
  },
  settings: {
    title: "Workspace setup",
    description:
      "Connect tools once and keep permissions under administrator control.",
    links: [
      ["team", "Open team and invitations"],
      ["knowledge", "Inspect shared knowledge"],
      ["setup", "Open setup guide"],
    ],
  },
  setup: {
    title: "Getting started",
    description: "Start locally, connect your agent, then bring in your team.",
    links: [
      ["settings", "Open connections"],
      ["team", "Open team and invitations"],
      ["work", "Open investigation workspace"],
    ],
  },
};

export function WorkspaceContext({
  route,
  onRoute,
  onClose,
}: {
  route: Route;
  onRoute: (route: Route) => void;
  onClose: () => void;
}) {
  const workspace = useWorkspace();
  const context = CONTEXT[route];
  const data = workspace.data;
  const active = data?.runs.filter((run) => run.active).length;
  const recent = [...(data?.cases || [])]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 4);
  if (route === "architecture" || route === "agents" || route === "knowledge") {
    return (
      <aside id="workspace-context" aria-label="Workspace context" className="page-context">
        <header className="page-context-header">
          <h2>{route === "architecture" ? "Architecture explorer" : route === "agents" ? "Agent workspace" : "Harness workspace"}</h2>
          <button type="button" aria-label="Close workspace sidebar" onClick={onClose} className="t-control grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2">
            <X size={16} />
          </button>
        </header>
        <PageSidebarMount />
      </aside>
    );
  }
  return (
    <aside
      id="workspace-context"
      aria-label="Workspace context"
      className="flex shrink-0 flex-col gap-5 border-b border-border bg-surface p-4 xl:w-56 xl:overflow-y-auto xl:border-b-0 xl:border-r"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="mb-2 text-[10px] font-medium uppercase tracking-widest text-muted">
            Context
          </p>
          <h2 className="text-sm font-semibold">{context.title}</h2>
        </div>
        <button
          type="button"
          aria-label="Close workspace sidebar"
          onClick={onClose}
          className="t-control grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted hover:bg-surface-2"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-xs leading-relaxed text-muted">
        {context.description}
      </p>
      <nav aria-label="Related workspace sections" className="grid gap-1">
        {context.links.map(([target, label]) => (
          <button
            key={target}
            onClick={() => onRoute(target)}
            className="t-control flex items-center justify-between gap-2 rounded-md p-2 text-left text-xs hover:bg-surface-2"
          >
            <span>{label}</span>
            <ArrowUpRight className="h-3 w-3 shrink-0 text-muted" />
          </button>
        ))}
      </nav>
      <section
        className="rounded-lg border border-border p-3"
        aria-label="Investigation runtime status"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <IntegrationLogo provider="hermes" />
          Hermes
        </div>
        <p className="mt-2 text-xs text-muted">
          {workspace.error
            ? "Workspace connection unavailable"
            : !data
              ? "Checking runtime…"
              : data.runner.available
                ? "Investigation runtime available"
                : "Investigation runtime unavailable"}
        </p>
        {data && (
          <p className="mt-2 text-xs">
            {active
              ? `${active} active investigation${active === 1 ? "" : "s"}`
              : "No active investigations"}
          </p>
        )}
        <button
          className="t-control mt-3 text-xs text-accent-text hover:underline"
          onClick={() => onRoute("team")}
        >
          Talk with the shared agent
        </button>
      </section>
      {route !== "work" && (
        <section className="grid gap-2">
          <h3 className="text-xs font-medium text-muted">Recent reports</h3>
          {recent.map((item) => (
            <a
              key={item.id}
              href={`/?case=${encodeURIComponent(item.id)}`}
              className="t-control rounded-md p-2 hover:bg-surface-2"
            >
              <span className="line-clamp-2 break-words text-xs">
                {item.title}
              </span>
              <span className="mt-1 block text-[11px] text-muted">
                {item.status.replace(/_/g, " ")}
              </span>
            </a>
          ))}
          {!recent.length && (
            <p className="text-xs text-muted">
              {data ? "No reports recorded yet." : "Reports unavailable."}
            </p>
          )}
        </section>
      )}
      <p className="mt-auto border-t border-border pt-3 text-[11px] leading-relaxed text-muted">
        {data?.account.role === "owner"
          ? "Administrator · connections and execution approvals"
          : data?.account.authenticated
            ? "Teammate · shared work and agent conversation"
            : "Workspace access follows your invitation."}
      </p>
    </aside>
  );
}
