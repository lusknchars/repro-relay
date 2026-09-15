import { useState } from "react";
import { Users, UserPlus, Link as LinkIcon } from "lucide-react";
import { Avatar, Badge, Button, Card, Input, Field } from "@/components/ui";
import { api, useLoad, type Account } from "@/lib/live";
import type { Route } from "@/components/shell/Shell";

type Team = {
  members: { id: string; name: string; username: string; role: string }[];
  invites: { id: string; used: boolean; revoked: boolean; expires_at: string }[];
};

export function UsersPage({ create, onRoute }: { create: boolean; onRoute: (route: Route) => void }) {
  const account = useLoad(() => api<Account>("/account"), [], 15000);
  const owner = account.data?.role === "owner";
  const team = useLoad(() => owner ? api<Team>("/team") : Promise.resolve<Team>({ members: [], invites: [] }), [owner]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [localOnly, setLocalOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function invite() {
    if (busy || link) return;
    setBusy(true); setError("");
    try {
      const result = await api<{ url: string; local_only: boolean }>("/team/invites", "POST", { return_to: "/?view=team" });
      setLink(result.url); setLocalOnly(result.local_only); team.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Invitation could not be created."); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid gap-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold">{create ? "Create user" : "Users"}</h1><p className="text-sm text-muted">Workspace members and invitation access.</p></div>
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted">
          <button onClick={() => onRoute("users")} className="hover:text-foreground">Users</button><span aria-hidden>›</span><span aria-current="page">{create ? "Create" : "List"}</span>
        </nav>
      </header>
      {(error || account.error || team.error) && <p role="alert" className="text-danger">{error || account.error || team.error}</p>}
      {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
      {account.loading && !account.data ? <p role="status">Loading user access…</p> : !owner ? (
        <Card className="grid gap-3 p-5"><h2 className="font-semibold">Administrator access required</h2><p className="text-sm text-muted">Only workspace administrators can list members and create invitations.</p><Button className="justify-self-start" onClick={() => onRoute("team")}>Open Team</Button></Card>
      ) : create ? (
        <div className="grid items-start gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <Card className="grid justify-items-center gap-3 p-6 text-center">
            <Avatar name={name.trim() || "New user"} size={80} />
            <h2 className="text-lg font-semibold">{name.trim() || "New user"}</h2>
            <div className="flex gap-2"><Badge>Member</Badge><Badge tone="warn">Not joined</Badge></div>
            <p className="text-xs text-muted">Invitation preview. Their profile is created when they accept and enter their name.</p>
          </Card>
          <form className="grid gap-5" onSubmit={e => { e.preventDefault(); void invite(); }}>
            <Card className="grid gap-4 p-5">
              <div className="flex items-center gap-3"><UserPlus className="h-5 w-5" /><div><h2 className="font-semibold">Personal information</h2><p className="text-xs text-muted">An optional name for your invitation message.</p></div></div>
              <Field label="Display name (optional)" htmlFor="invite-display-name" hint="Used in the preview and copied message only; the recipient confirms their own name.">
                <Input id="invite-display-name" value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="Teammate’s name" autoComplete="off" />
              </Field>
            </Card>
            <Card className="grid gap-4 p-5">
              <div className="flex items-center gap-3"><Users className="h-5 w-5" /><div><h2 className="font-semibold">Role & workspace</h2><p className="text-xs text-muted">Access granted when this invitation is accepted.</p></div></div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted">Role</dt><dd>Member</dd></div><div><dt className="text-muted">Workspace</dt><dd>Current workspace</dd></div></dl>
              <p className="text-xs text-muted">One teammate per link. Invitations expire after 24 hours. Creating a link does not send a message or create an active account.</p>
              {account.data?.local_access && <p className="text-xs text-warn">This local installation must be reachable by the recipient. Remote teams need a shared HTTPS deployment.</p>}
            </Card>
            {link && <Card className="grid gap-3 p-5">
              <h2 className="flex items-center gap-2 font-semibold"><LinkIcon className="h-4 w-4" />Invitation ready</h2>
              <Field label="Invitation link" htmlFor="new-user-link"><Input id="new-user-link" readOnly value={link} onFocus={e => e.target.select()} /></Field>
              <p className="text-xs text-muted">{localOnly ? "This link opens your local server." : "Share this private link with one teammate."}</p>
              <Button type="button" className="justify-self-start" onClick={async () => {
                try { await navigator.clipboard.writeText((name.trim() ? "Hi " + name.trim() + ", " : "") + "join our Repro Relay workspace: " + link); setNotice("Invitation message copied."); }
                catch { setNotice("Clipboard unavailable. Select and copy the invitation link above."); }
              }}>Copy invitation message</Button>
            </Card>}
            <div className="flex justify-end gap-2"><Button type="button" onClick={() => onRoute("users")}>Back to list</Button><Button type="submit" variant="default" pending={busy} disabled={!!link}>{link ? "Invitation created" : "Create invitation"}</Button></div>
          </form>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap justify-between gap-3"><Input aria-label="Search users" className="max-w-sm" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} /><Button variant="default" onClick={() => onRoute("users-create")}><UserPlus className="h-4 w-4" />Create user</Button></div>
          <Card className="overflow-x-auto">
            <table className="w-full text-left text-sm"><caption className="sr-only">Workspace users</caption><thead className="border-b border-border text-muted"><tr><th className="p-4">Name</th><th className="p-4">Role</th><th className="p-4">Status</th></tr></thead>
              <tbody>{team.data?.members.filter(m => (m.name + " " + m.username).toLowerCase().includes(search.toLowerCase())).map(m => <tr key={m.id} className="border-b border-border last:border-0"><td className="p-4"><span className="flex items-center gap-3"><Avatar name={m.name} /><span className="break-words">{m.name}</span></span></td><td className="p-4"><Badge>{m.role}</Badge></td><td className="p-4">Joined</td></tr>)}</tbody>
            </table>
            {team.loading && !team.data ? <p className="p-4 text-sm text-muted">Loading members…</p> : !team.data?.members.some(m => (m.name + " " + m.username).toLowerCase().includes(search.toLowerCase())) && <p className="p-4 text-sm text-muted">No matching members.</p>}
          </Card>
          <p className="text-xs text-muted">{team.data?.invites.filter(i => !i.used && !i.revoked && Date.parse(i.expires_at) > Date.now()).length || 0} pending invitations. Manage invitation revocation in <button className="underline" onClick={() => onRoute("team")}>Team</button>.</p>
        </>
      )}
    </div>
  );
}
