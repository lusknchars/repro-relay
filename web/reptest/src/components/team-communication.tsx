import { useState } from "react";
import { Button, Input, Badge } from "@/components/ui";
import { api, errorText, useLoad, useWorkspace } from "@/lib/live";
type Member = {
  name: string;
  role: string;
  project: string;
  phone: string;
  needs: string;
  updates_enabled: boolean;
};
type Record = { id: string; version: number; member: Member };
type Call = {
  id: string;
  case_id: string;
  participant: string;
  active: boolean;
  requests: { id: string; transcript: string; kind: string }[];
};
const blank: Member = {
  name: "",
  role: "developer",
  project: "",
  phone: "",
  needs: "",
  updates_enabled: false,
};
export function TeamCommunication() {
  const workspace = useWorkspace();
  const people = useLoad(() =>
    api<{ items: Record[] }>("/communication/members"),
  );
  const calls = useLoad(
    () => api<{ items: Call[] }>("/communication/calls"),
    [],
    10000,
  );
  const [editing, setEditing] = useState<Record>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [caseId, setCaseId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [drafts, setDrafts] =
    useState<
      { name: string; role: string; draft: string; blocked_reason: string }[]
    >();
  const canEdit =
    !!workspace.data?.account.enabled &&
    workspace.data.account.role !== "viewer";
  async function save() {
    if (!editing || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/communication/members/${editing.id}`, "PUT", {
        version: editing.version,
        member: editing.member,
      });
      setEditing(undefined);
      people.refresh();
      calls.refresh();
      setNotice(
        "Preferences saved. Phone ownership and Plow destination still require authorization.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function field(key: keyof Member, value: string | boolean) {
    if (editing)
      setEditing({ ...editing, member: { ...editing.member, [key]: value } });
  }
  const selectedCase = workspace.data?.cases.find((c) => c.id === caseId);
  const matches =
    people.data?.items?.filter(
      (p) => p.member.project === selectedCase?.project,
    ) || [];
  return (
    <section
      className="grid gap-4 rounded-lg border border-border bg-surface p-4"
      aria-label="Team communication"
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="font-semibold">Team communication</h2>
          <p className="text-sm text-muted">
            Match repository work to each person’s role, then review the message
            and destination.
          </p>
        </div>
        <Button
          disabled={!canEdit || busy}
          onClick={() =>
            setEditing({
              id: crypto.randomUUID(),
              version: 0,
              member: { ...blank },
            })
          }
        >
          Add communication profile
        </Button>
      </div>
      {(error || people.error || calls.error) && (
        <p role="alert" className="text-sm text-danger">
          {error || people.error || calls.error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {people.data?.items?.length === 0 && (
        <p className="text-sm text-muted">
          Add a teammate’s project, work role and preferred phone number. These
          preferences are separate from account access.
        </p>
      )}
      <div className="divide-y divide-border">
        {people.data?.items?.map((p) => (
          <div
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <div>
              <strong className="text-sm">{p.member.name}</strong>
              <p className="text-xs text-muted">
                {p.member.project} · {p.member.role} · {p.member.phone}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="outline">Phone unverified</Badge>
              <Button disabled={!canEdit || busy} onClick={() => setEditing(p)}>
                Edit preferences
              </Button>
            </div>
          </div>
        ))}
      </div>
      {editing && (
        <form
          className="grid gap-3 rounded-lg border border-border-strong p-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1 text-sm">
            Name
            <Input
              required
              maxLength={120}
              value={editing.member.name}
              onChange={(e) => field("name", e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm">
            Project name
            <Input
              required
              maxLength={160}
              value={editing.member.project}
              onChange={(e) => field("project", e.target.value)}
              placeholder="Must match the case’s project"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Work role
            <select
              className="t-control rounded border border-border bg-surface p-2"
              value={editing.member.role}
              onChange={(e) => field("role", e.target.value)}
            >
              {["developer", "reviewer", "qa", "maintainer", "product"].map(
                (r) => (
                  <option key={r}>{r}</option>
                ),
              )}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Phone with country code
            <Input
              required
              type="tel"
              maxLength={16}
              placeholder="+5511999999999"
              value={editing.member.phone}
              onChange={(e) => field("phone", e.target.value)}
            />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            What should updates focus on?
            <Input
              maxLength={2000}
              value={editing.member.needs}
              onChange={(e) => field("needs", e.target.value)}
              placeholder="For example: failed Windows tests and release blockers"
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={editing.member.updates_enabled}
              onChange={(e) => field("updates_enabled", e.target.checked)}
            />
            Include this person in update suggestions
          </label>
          <p className="text-xs text-muted sm:col-span-2">
            A preference does not verify this phone or permit delivery. Changes
            close this person’s active call-context sessions.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy} type="submit">
              Save preferences
            </Button>
            <Button
              disabled={busy}
              type="button"
              onClick={() => setEditing(undefined)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Preview role-based updates
        </summary>
        <div className="mt-3 grid gap-3">
          <label className="grid gap-1 text-sm">
            Case
            <select
              aria-label="Case"
              className="t-control w-full min-w-0 rounded border border-border bg-surface p-2"
              value={caseId}
              onChange={(e) => {
                setCaseId(e.target.value);
                setMemberId("");
                setDrafts(undefined);
              }}
            >
              <option value="">Select work</option>
              {workspace.data?.cases.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </label>
          <Button
            disabled={!caseId || busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const v = await api<{ items: NonNullable<typeof drafts> }>(
                  `/communication/cases/${encodeURIComponent(caseId)}/routing`,
                );
                setDrafts(v.items);
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Prepare update suggestions
          </Button>
          {drafts?.length === 0 && (
            <p className="text-sm text-muted">
              No enabled profiles match this case’s project.
            </p>
          )}
          {drafts?.map((d, i) => (
            <article
              key={i}
              className="grid gap-2 rounded border border-border p-3"
            >
              <h3 className="text-sm font-medium">
                {d.name} · {d.role}
              </h3>
              <p className="whitespace-pre-wrap text-sm">{d.draft}</p>
              <p className="text-xs text-muted">{d.blocked_reason}</p>
            </article>
          ))}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Enable MCP context during a call
        </summary>
        <div className="mt-3 grid gap-3 text-sm">
          <p className="text-muted">
            A call client with transcription can use Relay’s MCP tools to read
            one case and record requests. Microphone capture, transcription and
            Plow phone calls need a separate voice client. Spoken requests never
            approve edits or messages.
          </p>
          <p>Select a case above and a participant from the same project.</p>
          <select
            aria-label="Call participant"
            className="t-control rounded border border-border bg-surface p-2"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
          >
            <option value="">Select participant</option>
            {matches.map((p) => (
              <option key={p.id} value={p.id}>
                {p.member.name}
              </option>
            ))}
          </select>
          {caseId && matches.some((p) => p.id === memberId) && (
            <code className="break-all rounded border border-border p-3">
              python3 integrations/call-context/server.py --case {caseId}{" "}
              --member {memberId} --consent
            </code>
          )}
          <p className="text-xs text-muted">
            Configure this command as a stdio MCP server in your voice client
            after the participant agrees. Access lasts one hour; keys remain in
            the server process.
          </p>
        </div>
      </details>
      {!!calls.data?.items?.length && (
        <div className="grid gap-3">
          <h3 className="text-sm font-medium">Recent call context</h3>
          {calls.data?.items?.map((c) => (
            <article
              key={c.id}
              className="grid gap-2 rounded border border-border p-3"
            >
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-sm">
                  {c.participant} ·{" "}
                  {c.active ? "Context enabled" : "Closed or expired"}
                </span>
                {c.active && (
                  <Button
                    disabled={!canEdit}
                    onClick={async () => {
                      try {
                        await api(
                          `/communication/calls/${c.id}/close`,
                          "POST",
                          {},
                        );
                        calls.refresh();
                      } catch (e) {
                        setError(errorText(e));
                      }
                    }}
                  >
                    Close context
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted">
                No verified live audio connection · requests need review
              </p>
              {c.requests.map((r) => (
                <p key={r.id} className="whitespace-pre-wrap text-sm">
                  {r.kind}: {r.transcript}
                </p>
              ))}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
