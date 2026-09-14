import { useState } from "react";
import { Badge, Button, Input } from "@/components/ui";
import {
  api,
  useLoad,
  useWorkspace,
  errorText,
  desktop,
  type Account,
} from "@/lib/live";
type Team = {
  members: { id: string; name: string; username: string; role: string }[];
  invites: {
    id: string;
    used: boolean;
    revoked: boolean;
    expires_at: string;
  }[];
};
export function TeamPage() {
  const workspace = useWorkspace();
  // Sign-in must remain usable when workspace data requires authentication.
  const accountState = useLoad(() => api<Account>("/account"), [], 15000);
  const account = accountState.data;
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("invite") || "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState("");
  const team = useLoad(
    () =>
      account?.role === "owner"
        ? api<Team>("/team")
        : Promise.resolve({ members: [], invites: [] }),
    [account?.role, account?.profile?.id],
  );
  async function perform(label: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
      team.refresh();
      accountState.refresh();
      workspace.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="grid gap-5 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold">Team</h1>
        <p className="text-sm text-muted">
          Account, team access, and invitations to this workspace.
        </p>
      </header>
      {(error || team.error || accountState.error) && (
        <p role="alert" className="text-danger">
          {error || team.error || accountState.error}
        </p>
      )}
      <p role="status" className="text-sm text-ok">
        {notice}
      </p>
      {desktop ? (
        <section className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm">
            Manage account cookies and invitations in the browser on this Mac.
          </p>
          <a
            href="http://127.0.0.1:5178/?view=team"
            className="mt-3 inline-block text-sm text-accent-text underline"
            target="_blank"
            rel="noreferrer"
          >
            Open account settings in browser
          </a>
        </section>
      ) : accountState.loading && !account ? (
        <p role="status">Loading account…</p>
      ) : !account?.enabled ? (
        <p className="text-sm text-muted">
          Accounts are unavailable in this workspace mode.
        </p>
      ) : !account.authenticated ? (
        <form
          className="grid max-w-lg gap-3 rounded-lg border border-border bg-surface p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void perform("auth", async () => {
              await api(
                `/account/${mode === "login" ? "login" : "register"}`,
                "POST",
                { username, password, name, invite_token: invite },
              );
              setPassword("");
              if (mode === "register") {
                setInvite("");
                history.replaceState(null, "", "/?view=team");
              }
              setNotice("Account connected.");
            });
          }}
        >
          <h2 className="text-base font-semibold">
            {mode === "login" ? "Sign in" : "Create account"}
          </h2>
          <label className="grid gap-1 text-sm">
            Username
            <Input
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Password
            <Input
              required
              minLength={15}
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mode !== "login" && (
            <>
              <label className="grid gap-1 text-sm">
                Display name
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {!account.bootstrap_available && (
                <label className="grid gap-1 text-sm">
                  Invitation token
                  <Input
                    required
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <Button type="submit" variant="default" pending={busy === "auth"}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Create an account" : "Use existing account"}
          </Button>
        </form>
      ) : (
        <section className="grid gap-4 rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">{account.profile?.name}</h2>
            <Badge>{account.role}</Badge>
            <span className="text-sm text-muted">
              @{account.profile?.username}
            </span>
          </div>
          <Button
            className="justify-self-start"
            disabled={!!busy}
            onClick={() =>
              void perform("logout", async () => {
                await api("/account/logout", "POST");
              })
            }
          >
            Sign out
          </Button>
          {invite && (
            <Button
              disabled={!!busy}
              onClick={() =>
                void perform("join", async () => {
                  await api("/team/join", "POST", { token: invite });
                  setInvite("");
                  history.replaceState(null, "", "/?view=team");
                  setNotice("Invitation accepted.");
                })
              }
            >
              Accept workspace invitation
            </Button>
          )}
          {account.role === "owner" && (
            <>
              <h3 className="text-sm font-semibold">Members</h3>
              <ul className="divide-y divide-border">
                {team.data?.members.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                  >
                    <span>
                      {m.name} · @{m.username}
                    </span>
                    <Badge>{m.role}</Badge>
                  </li>
                ))}
              </ul>
              <Button
                className="justify-self-start"
                disabled={!!busy}
                onClick={() =>
                  void perform("invite", async () => {
                    const v = await api<{ url: string; local_only: boolean }>(
                      "/team/invites",
                      "POST",
                      { return_to: "/?view=team" },
                    );
                    setLink(v.url);
                    setNotice(
                      v.local_only
                        ? "Invitation created for this local server. Remote teammates need a hosted team deployment."
                        : "Invitation created. It expires in 24 hours.",
                    );
                  })
                }
              >
                Create viewer invitation
              </Button>
              {link && (
                <label className="grid gap-1 text-sm">
                  Invitation link
                  <Input
                    readOnly
                    value={link}
                    onFocus={(e) => e.target.select()}
                  />
                </label>
              )}
              {team.data?.invites.map((i) => (
                <div
                  key={i.id}
                  className="flex flex-wrap justify-between gap-2 border-t border-border pt-3 text-xs"
                >
                  <span>
                    {i.id} ·{" "}
                    {i.used ? "Used" : i.revoked ? "Revoked" : "Pending"}
                  </span>
                  {!i.used && !i.revoked && (
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() =>
                        void perform("revoke", () =>
                          api(`/team/invites/${i.id}/revoke`, "POST"),
                        )
                      }
                    >
                      Revoke invitation
                    </Button>
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      )}
      <p className="text-xs text-muted">
        Team chat is not connected. Investigation reports and run reviews remain
        attached to their case in Work.
      </p>
    </div>
  );
}
