import { PhoneSignIn } from "@/components/phone-sign-in";
import { Contributions } from "@/components/contributions";
import { TeamCommunication } from "@/components/team-communication";
import type { ArchitectureRecord } from "./Architecture";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge, Button, Input } from "@/components/ui";
import {
  api,
  useLoad,
  useWorkspace,
  errorText,
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
export function TeamPage({
  accountOnly = false,
  onRegistered,
  onArchitecture,
}: {
  accountOnly?: boolean;
  onRegistered?: () => void;
  onArchitecture?: () => void;
}) {
  const architecture = useLoad(
    () =>
      accountOnly
        ? Promise.resolve<ArchitectureRecord | null>(null)
        : api<ArchitectureRecord>("/architectures"),
    [accountOnly],
  );
  const workspace = useWorkspace();
  // Sign-in must remain usable when workspace data requires authentication.
  const accountState = useLoad(() => api<Account>("/account"), [], 15000);
  const account = accountState.data;
  const [mode, setMode] = useState("choose");
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
    <div
      className={
        accountOnly ? "grid gap-4 p-6 sm:p-10" : "grid gap-5 p-4 md:p-6"
      }
    >
      {!accountOnly && (
        <header>
          <h1 className="text-xl font-semibold">Team</h1>
          <p className="text-sm text-muted">
            Account, team access, and invitations to this workspace.
          </p>
        </header>
      )}
      {(error || team.error || accountState.error) && (
        <p role="alert" className="text-danger">
          {error || team.error || accountState.error}
        </p>
      )}
      <p role="status" className="text-sm text-ok">
        {notice}
      </p>
      {!accountOnly && <Contributions />}
      {!accountOnly && <TeamCommunication />}
      {!accountOnly && architecture.data && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-semibold">
              Team investigation workflow
            </h2>
            <p className="mt-1 text-sm text-muted">
              {
                architecture.data.templates.find(
                  (t) => t.focus === architecture.data!.settings.focus,
                )?.name
              }{" "}
              · version {architecture.data.version}
            </p>
            <p className="mt-1 text-xs text-muted">
              Used by new investigations. Current runs retain their frozen
              brief.
            </p>
          </div>
          <Button onClick={onArchitecture}>Open architecture</Button>
        </section>
      )}
      {accountState.loading && !account ? (
        <p role="status">Loading account…</p>
      ) : accountState.error ? (
        <section className="mx-auto grid max-w-[320px] gap-4 py-8">
          <h2 className="text-base font-semibold">
            Connect your local workspace
          </h2>
          <p className="text-sm text-muted">
            Run this command from your Repro Relay checkout, then retry.
          </p>
          <code className="rounded-md border border-border bg-surface p-3 text-sm">
            ./relay setup
          </code>
          <Button onClick={accountState.refresh}>Retry connection</Button>
        </section>
      ) : !account?.enabled ? (
        <p className="text-sm text-muted">
          Accounts are unavailable in this workspace mode.
        </p>
      ) : !account.authenticated && mode === "choose" ? (
        <PhoneSignIn
          account={account}
          invite={invite}
          onPassword={() => setMode("login")}
          onComplete={(created) => {
            setInvite("");
            const url = new URL(location.href);
            url.hash = "";
            history.replaceState(null, "", url);
            accountState.refresh();
            workspace.refresh();
            team.refresh();
            setNotice("Account connected.");
            if (created) onRegistered?.();
          }}
        />
      ) : !account.authenticated ? (
        <form
          className="mx-auto grid w-full max-w-[320px] gap-4 py-5"
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
                const url = new URL(location.href);
                url.hash = "";
                history.replaceState(null, "", url);
                onRegistered?.();
              }
              setNotice("Account connected.");
            });
          }}
        >
          <Button
            type="button"
            variant="ghost"
            className="justify-self-start"
            disabled={!!busy}
            onClick={() => {
              setMode("choose");
              setError("");
              setPassword("");
            }}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </Button>
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
              minLength={mode === "login" ? 1 : 15}
              maxLength={128}
              type="password"
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {mode !== "login" && (
            <p className="text-xs text-muted">
              Use at least 15 characters. A few words work well.
            </p>
          )}
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
                  Invitation link or token
                  <Input
                    required
                    value={invite}
                    onChange={(e) => {
                      const value = e.target.value.trim();
                      try {
                        setInvite(
                          new URLSearchParams(new URL(value).hash.slice(1)).get(
                            "invite",
                          ) || value,
                        );
                      } catch {
                        setInvite(value);
                      }
                    }}
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
            disabled={!!busy}
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
              {account.profile?.phone || `@${account.profile?.username}`}
            </span>
          </div>
          {account.session_persistent === false && (
            <p role="status" className="text-xs text-muted">
              Signed in for this app session. Secure session storage is
              unavailable; you will need to sign in again after closing the app.
            </p>
          )}
          <Button
            className="justify-self-start"
            disabled={!!busy}
            onClick={() =>
              void perform("logout", async () => {
                await api("/account/logout", "POST");
                setMode("choose");
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
          {!accountOnly && account.role === "owner" && (
            <>
              <h3 className="text-sm font-semibold">Members</h3>
              <ul className="divide-y divide-border">
                {team.data?.members.map((m) => (
                  <li
                    key={m.id}
                    className="flex flex-wrap justify-between gap-2 py-3 text-sm"
                  >
                    <span>
                      {m.name}
                      {!m.username.startsWith("phone_") && ` · @${m.username}`}
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
      {!accountOnly && account?.authenticated && (
        <p className="text-xs text-muted">
          Team chat is not connected. Investigation reports and run reviews
          remain attached to their case in Work.
        </p>
      )}
    </div>
  );
}
