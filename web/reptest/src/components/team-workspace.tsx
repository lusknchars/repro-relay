import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Hash,
  MessageSquare,
  PanelRight,
  Search,
  Settings,
  Users,
} from "lucide-react";
import { HermesChat } from "./hermes-chat";
import {
  api,
  useLoad,
  useWorkspace,
  when,
  type Account,
  type Case,
} from "@/lib/live";
import { Badge, Button } from "@/components/ui";
import { IntegrationLogo } from "./integration-logo";
import "./team-workspace.css";

type Member = { id: string; name: string; role: string };
export function TeamWorkspace({
  account,
  renderManagement,
}: {
  account: Account;
  renderManagement: () => ReactNode;
}) {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(
    () => new URLSearchParams(location.search).get("team_work") || "",
  );
  const [management, updateManagement] = useState(
    () => new URLSearchParams(location.search).get("team_panel") === "settings",
  );
  function setManagement(open: boolean) {
    updateManagement(open);
    const url = new URL(location.href);
    if (open) url.searchParams.set("team_panel", "settings");
    else url.searchParams.delete("team_panel");
    history.replaceState(null, "", url);
  }
  const [context, setContext] = useState(() => window.innerWidth >= 1280);
  const [list, setList] = useState(false);
  const records = workspace.data?.cases || [];
  const work = useLoad(
    () =>
      selected
        ? api<Case>(`/cases/${encodeURIComponent(selected)}`)
        : Promise.resolve(null),
    [selected],
    15000,
  );
  const members = useLoad(
    () =>
      account.role === "owner"
        ? api<{ members: Member[] }>("/team")
        : Promise.resolve(null),
    [account.role],
    15000,
  );
  useEffect(() => {
    const sync = () => {
      const params = new URLSearchParams(location.search);
      setSelected(params.get("team_work") || "");
      updateManagement(params.get("team_panel") === "settings");
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function choose(id: string) {
    setSelected(id);
    setManagement(false);
    setList(false);
    const url = new URL(location.href);
    if (id) url.searchParams.set("team_work", id);
    else url.searchParams.delete("team_work");
    history.replaceState(null, "", url);
  }
  const item = work.data;
  const visible = records.filter((c) =>
    `${c.title} ${c.project} ${c.id}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const workLink = item
    ? `/?case=${encodeURIComponent(item.id)}`
    : "/?view=work";
  return (
    <section
      className="team-desk"
      aria-label="Team workspace"
      data-list-open={list}
      data-context-open={context}
    >
      <aside className="team-directory" aria-label="Team conversations">
        <header className="team-panel-heading">
          <h1>Team</h1>
          <button
            className="team-list-close"
            aria-label="Close team conversations"
            onClick={() => setList(false)}
          >
            ×
          </button>
          <Users size={15} aria-hidden />
        </header>
        <label className="team-search">
          <Search size={14} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search team work"
            placeholder="Search work context…"
          />
        </label>
        <button
          className="team-room"
          aria-current={!selected && !management ? "page" : undefined}
          onClick={() => choose("")}
        >
          <MessageSquare size={15} />
          <span>
            <strong>Team conversation</strong>
            <small>Everyone · one Hermes agent</small>
          </span>
        </button>
        <div className="team-directory-label">
          Work context{" "}
          <span>
            {records.length}
            {workspace.data?.moreCases ? "+" : ""}
          </span>
        </div>
        <div className="team-work-list">
          {workspace.loading && !records.length && (
            <p role="status">Loading work…</p>
          )}
          {workspace.error && <p role="alert">{workspace.error}</p>}
          {visible.map((c) => (
            <button
              key={c.id}
              className="team-room"
              aria-current={
                selected === c.id && !management ? "page" : undefined
              }
              onClick={() => choose(c.id)}
            >
              <Hash size={15} />
              <span>
                <strong>{c.title}</strong>
                <small>{c.project}</small>
                <small>
                  {c.status.replace(/_/g, " ")} · {when(c.updated_at)}
                </small>
              </span>
            </button>
          ))}
          {!workspace.loading && !workspace.error && !visible.length && (
            <p>
              {query
                ? "No work matches this search."
                : "No work records yet. Your shared conversation is ready."}
            </p>
          )}
        </div>
        <div className="team-directory-actions">
          <button
            onClick={() => {
              setManagement(true);
              setList(false);
            }}
            aria-current={management ? "page" : undefined}
          >
            <Settings size={14} /> Team settings
          </button>
          <a href="/?view=reach">
            Open Reach <ArrowUpRight size={13} />
          </a>
        </div>
        <footer>
          One shared conversation. Selecting work changes the context you can
          attach.
        </footer>
      </aside>
      <div className="team-discussion">
        <header className="team-discussion-heading">
          <button
            className="team-list-toggle"
            aria-label="Show team conversations"
            onClick={() => {
              setList(true);
              setContext(false);
            }}
          >
            <MessageSquare size={16} />
          </button>
          <Hash size={17} aria-hidden />
          <div>
            <strong>
              {management
                ? "Team settings"
                : item?.title || "Team conversation"}
            </strong>
            <small>
              {management
                ? "Access, invitations, contributions and call setup"
                : "Shared with everyone in this workspace"}
            </small>
          </div>
          <button
            aria-label={context ? "Hide shared context" : "Show shared context"}
            aria-expanded={context}
            aria-controls="team-shared-context"
            onClick={() => {
              setContext(!context);
              setList(false);
            }}
          >
            <PanelRight size={15} />
            <span>Context</span>
          </button>
        </header>
        {management ? (
          <div className="team-management">
            <Button onClick={() => setManagement(false)}>
              <ArrowLeft size={14} /> Back to conversation
            </Button>
            {renderManagement()}
          </div>
        ) : (
          <>
            {work.error && (
              <div className="team-context-error" role="alert">
                Work context unavailable: {work.error}{" "}
                <button onClick={work.refresh}>Retry</button>
              </div>
            )}
            {selected && work.loading && !item && (
              <p className="team-context-error" role="status">
                Loading selected work…
              </p>
            )}
            <HermesChat account={account} desk work={item || undefined} />
          </>
        )}
      </div>
      <aside
        id="team-shared-context"
        className="team-context"
        aria-label="Shared context"
      >
        <header className="team-panel-heading">
          <h2>Shared context</h2>
          <button
            className="team-context-close"
            onClick={() => setContext(false)}
            aria-label="Close shared context"
          >
            ×
          </button>
        </header>
        <section>
          <h3>Work record</h3>
          {item ? (
            <>
              <strong>{item.title}</strong>
              <p>
                <Badge>{item.status.replace(/_/g, " ")}</Badge>
              </p>
              <p className="font-mono">
                {item.build || "Build not recorded"} · revision {item.revision}
              </p>
              <a className="team-inline-link" href={workLink}>
                Open in Work <ArrowUpRight size={12} />
              </a>
            </>
          ) : (
            <p>
              {work.error
                ? "Selected context could not be loaded."
                : "Select a work record to inspect its evidence and attach a reference to your message."}
            </p>
          )}
        </section>
        {item && (
          <>
            <section>
              <h3>Next review</h3>
              <p>
                Inspect the recorded result and choose the next action in Work.
              </p>
              <a className="team-inline-link" href={workLink}>
                Review work <ArrowUpRight size={12} />
              </a>
            </section>
            <section>
              <h3>
                Recorded observations <span>{item.observations.length}</span>
              </h3>
              {item.observations.length ? (
                item.observations.slice(-5).map((o) => (
                  <article key={o.id}>
                    <strong>{o.observed}</strong>
                    <p>
                      <Badge>Human observation</Badge> {o.author}
                    </p>
                    <p>
                      {when(o.at)} · {o.build}
                    </p>
                    {/^https?:\/\//.test(o.evidence_url) && (
                      <a href={o.evidence_url} target="_blank" rel="noreferrer">
                        Open evidence <ArrowUpRight size={12} />
                      </a>
                    )}
                  </article>
                ))
              ) : (
                <p>No observations recorded for this work.</p>
              )}
            </section>
          </>
        )}
        <section>
          <h3>
            {account.role === "owner" ? "Workspace members" : "Your access"}
          </h3>
          {members.error && (
            <p role="alert">
              Member list unavailable.{" "}
              <button onClick={members.refresh}>Retry</button>
            </p>
          )}
          {account.role === "owner" && members.loading && !members.data && (
            <p role="status">Loading members…</p>
          )}
          {(account.role === "owner"
            ? members.data?.members || []
            : [
                {
                  id: account.profile?.id || "self",
                  name: account.profile?.name || "You",
                  role: account.role || "member",
                },
              ]
          ).map((m) => (
            <div className="team-person" key={m.id}>
              <span className="team-person-avatar">
                {m.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <strong>{m.name}</strong>
                <small>{m.role}</small>
              </div>
            </div>
          ))}
          <div className="team-person">
            <IntegrationLogo provider="hermes" />
            <div>
              <strong>Hermes</strong>
              <small>Administrator-managed agent</small>
            </div>
          </div>
          <p>
            Teammates can ask and follow work. The administrator controls
            execution.
          </p>
        </section>
        <section>
          <p>
            {account.local_access && account.role === "owner"
              ? "Local workspace · no login required"
              : account.role === "owner"
                ? "Workspace administrator"
                : "Joined by invitation"}
          </p>
          <button
            className="team-inline-link"
            onClick={() => {
              setManagement(true);
              setContext(false);
            }}
          >
            {account.role === "owner"
              ? "Manage members and invitations"
              : "Workspace settings"}
            <ArrowUpRight size={12} />
          </button>
        </section>
      </aside>
    </section>
  );
}
