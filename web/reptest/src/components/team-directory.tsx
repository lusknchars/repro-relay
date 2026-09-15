import { useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  MessageSquare,
  Search,
  Settings,
  Users,
} from "lucide-react";
import type { Account } from "@/lib/live";
export type Teammate = { id: string; name: string; role: string };
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
export function TeamDirectory({
  account,
  members,
  loading,
  error,
  refresh,
  selectedMember,
  onMember,
  onConversation,
  onSettings,
  onClose,
  workSelected,
  children,
  hasMore,
}: {
  account: Account;
  members: Teammate[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  selectedMember: string;
  onMember: (member: Teammate) => void;
  onConversation: () => void;
  onSettings: () => void;
  onClose: () => void;
  workSelected: boolean;
  children: ReactNode;
  hasMore: boolean;
}) {
  const [tab, setTab] = useState(workSelected ? "work" : "people");
  const [query, setQuery] = useState("");
  const visible = members.filter((member) =>
    `${member.name} ${member.role}`.toLowerCase().includes(query.toLowerCase()),
  );
  const name = account.profile?.name || "Your profile";
  return (
    <aside
      className="team-directory team-directory--people"
      aria-label="Team conversations"
    >
      <header className="team-profile-header">
        <div className="team-profile-title">
          <h1>Team</h1>
          <button
            className="team-list-close"
            onClick={onClose}
            aria-label="Close team conversations"
          >
            ×
          </button>
        </div>
        <button
          className="team-self-profile"
          onClick={onSettings}
          aria-label="Open your team profile"
        >
          <span className="team-profile-avatar">{initials(name)}</span>
          <strong>{name}</strong>
          <small>
            {account.role === "owner" ? "Administrator" : "Teammate"}
          </small>
        </button>
        <div className="team-profile-actions">
          <button
            onClick={onConversation}
            aria-label="Open shared Hermes conversation"
            title="Shared Hermes conversation"
          >
            <MessageSquare size={16} />
          </button>
          <button
            onClick={onSettings}
            aria-label="Open team settings"
            title="Team settings"
          >
            <Settings size={16} />
          </button>
        </div>
      </header>
      <section className="team-roster-summary" aria-label="Workspace teammates">
        <div>
          Teammates{" "}
          <span>
            {loading
              ? "…"
              : error
                ? "Unavailable"
                : `${members.length}${hasMore ? "+" : ""}`}
          </span>
        </div>
        <div className="team-roster-avatars">
          {members.slice(0, 6).map((member) => (
            <button
              key={member.id}
              className="team-person-avatar"
              title={member.name}
              aria-label={`View ${member.name}'s profile`}
              onClick={() => onMember(member)}
            >
              {initials(member.name)}
            </button>
          ))}
        </div>
      </section>
      <div className="team-directory-tabs" aria-label="Team directory views">
        <button
          aria-pressed={tab === "people"}
          onClick={() => setTab("people")}
        >
          <Users size={13} />
          People
        </button>
        <button aria-pressed={tab === "work"} onClick={() => setTab("work")}>
          Work context
        </button>
      </div>
      {tab === "people" ? (
        <>
          <label className="team-search">
            <Search size={14} />
            <input
              aria-label="Search teammates"
              placeholder="Search teammates…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div className="team-people-list">
            {loading && !members.length && (
              <p role="status">Loading teammates…</p>
            )}
            {error && (
              <p role="alert">
                Teammates unavailable. <button onClick={refresh}>Retry</button>
              </p>
            )}
            {visible.map((member) => (
              <button
                key={member.id}
                className="team-teammate"
                aria-label={`Inspect teammate ${member.name}`}
                aria-pressed={selectedMember === member.id}
                onClick={() => onMember(member)}
              >
                <span className="team-person-avatar">
                  {initials(member.name)}
                </span>
                <span>
                  <strong>{member.name}</strong>
                  <small>
                    {member.role === "owner" ? "Administrator" : "Teammate"}
                    {member.id === account.profile?.id ? " · You" : ""}
                  </small>
                </span>
                <ArrowUpRight size={13} />
              </button>
            ))}
            {!loading && !error && !visible.length && (
              <p>
                {query
                  ? "No teammates match this search."
                  : "No teammates have joined yet."}
              </p>
            )}
            {!loading && !error && hasMore && (
              <p>Showing the first 100 teammates.</p>
            )}
          </div>
        </>
      ) : (
        <div className="team-work-directory">{children}</div>
      )}
      <div className="team-directory-actions">
        <button onClick={onConversation}>
          <MessageSquare size={14} />
          Team conversation <small>Everyone</small>
        </button>
        <button onClick={onSettings}>
          <Settings size={14} />
          Team settings
        </button>
        <a href="/?view=reach">
          Open Reach <ArrowUpRight size={13} />
        </a>
      </div>
      <footer>
        Everyone shares one Hermes conversation. Select a teammate to view their
        profile.
      </footer>
    </aside>
  );
}
