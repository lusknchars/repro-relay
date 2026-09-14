import { useState } from "react";
import { Button, Badge, Input } from "@/components/ui";
import {
  api,
  useLoad,
  useWorkspace,
  when,
  errorText,
  type Memory,
} from "@/lib/live";
export function KnowledgePage() {
  const { data: workspace } = useWorkspace();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const memories = useLoad(() => api<Memory[]>("/memories"), [], 15000);
  return (
    <div className="grid gap-4 p-4 md:p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Knowledge</h1>
          <p className="text-sm text-muted">
            Current reviewed observations, linked to their source revision.
          </p>
        </div>
        <Button onClick={memories.refresh}>Refresh</Button>
      </header>
      <Input
        aria-label="Search knowledge"
        placeholder="Search reviewed observations…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {(error || memories.error) && (
        <p role="alert" className="text-danger">
          {error || memories.error}
        </p>
      )}
      {memories.loading && <p role="status">Loading knowledge…</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {memories.data
          ?.filter((m) =>
            (m.title + " " + m.observation.observed)
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .map((m) => (
            <li key={m.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto]">
              <div>
                <h2 className="text-sm font-medium">{m.title}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm">
                  {m.observation.observed}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted">
                  <Badge tone="ok">Reviewed observation</Badge>
                  <span>
                    {m.case_id} · revision {m.revision}
                  </span>
                  <span>Reviewer: {m.reviewer}</span>
                  <span>{when(m.created_at)}</span>
                </div>
              </div>
              <Button
                size="sm"
                disabled={
                  !!busy ||
                  !workspace?.account.enabled ||
                  workspace.account.role === "viewer"
                }
                pending={busy === m.id}
                onClick={async () => {
                  setBusy(m.id);
                  setError("");
                  try {
                    await api(`/memories/${m.id}`, "DELETE");
                    memories.refresh();
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy("");
                  }
                }}
              >
                Revoke
              </Button>
            </li>
          ))}
      </ul>
      {memories.data?.length === 0 && (
        <p className="text-sm text-muted">
          No current reviewed observations. Publish reviewed evidence from a
          case before reusing it.
        </p>
      )}
      <p className="text-xs text-muted">
        Stale and revoked records are excluded by the backend. Private Mem0
        working notes are separate and are not automatically promoted to shared
        knowledge.
      </p>
    </div>
  );
}
