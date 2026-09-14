import { useState } from "react";
import { Eye, EyeOff, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Input, Tabs } from "@/components/ui";
import { CapTag } from "@/components/work-bits";
import { capabilityTag, knowledge } from "@/lib/data";

type Layer = "reviewed" | "private" | "changes";

export function KnowledgePage() {
  const [layer, setLayer] = useState<Layer>("reviewed");
  const [q, setQ] = useState("");
  const rows = knowledge.filter((k) => (layer === "reviewed" ? k.layer !== "Private note" : k.layer === "Private note")).filter((k) => k.text.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="grid gap-4 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Knowledge</h1>
          <p className="max-w-prose text-sm text-muted">Three layers with different trust. Source evidence lives on each case. Reviewed knowledge is approved for reuse. Private notes are short agent working notes and stay unverified until reviewed.</p>
        </div>
        <Input placeholder="Search knowledge…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full md:w-64" aria-label="Search knowledge" />
      </div>

      <Tabs
        value={layer}
        onChange={setLayer}
        tabs={[
          { value: "reviewed", label: "Reviewed project knowledge", count: knowledge.filter((k) => k.layer !== "Private note").length },
          { value: "private", label: "Private agent notes", count: knowledge.filter((k) => k.layer === "Private note").length },
          { value: "changes", label: "Context changes" },
        ]}
      />

      {layer !== "changes" && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {rows.map((k) => (
            <li key={k.id} className={cn("row-pad grid gap-1.5 px-4 md:grid-cols-[1fr_auto] md:items-center", k.layer === "Revoked" && "opacity-70")}>
              <div className="min-w-0">
                <p className={cn("max-w-prose text-sm leading-6", k.layer === "Revoked" && "line-through decoration-danger/60")}>{k.text}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  {k.layer === "Reviewed" && <Badge tone="ok">Reviewed</Badge>}
                  {k.layer === "Revoked" && <Badge tone="danger">Revoked</Badge>}
                  {k.layer === "Private note" && <Badge tone="warn">Unverified · {k.agent}</Badge>}
                  {k.reviewer ? <span>Reviewer {k.reviewer}</span> : null}
                  <span>Source {k.sourceCase}</span>
                  <span className="mono">{k.revision}</span>
                  <span>{k.freshness}</span>
                  {typeof k.uses === "number" ? <span className="tnum">Used in {k.uses} runs</span> : null}
                </div>
              </div>
              <div className="flex flex-none gap-1.5">
                {k.layer === "Reviewed" && <Button size="sm" variant="ghost"><Undo2 className="h-3.5 w-3.5" /> Revoke</Button>}
                {k.layer === "Revoked" && <Button size="sm" variant="ghost">Restore</Button>}
                {k.layer === "Private note" && (
                  <>
                    <Button size="sm" variant="ghost" title="Hide locally — the cloud copy stays"><EyeOff className="h-3.5 w-3.5" /> Hide locally</Button>
                    <Button size="sm" variant="ghost" title="Delete from the Mem0 cloud"><Trash2 className="h-3.5 w-3.5" /> Delete in cloud</Button>
                    <Button size="sm" variant="outline">Promote for review</Button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {layer === "private" && (
        <p className="text-xs text-muted">Private notes are never promoted automatically. "Hide locally" and "Delete in cloud" are different actions with different effects.</p>
      )}

      {layer === "changes" && (
        <div className="grid gap-3">
          <div className="flex items-center gap-2"><h2 className="text-sm font-semibold">What changed since the last packet</h2><Badge tone="neutral">Proposed until backed by delivery receipts</Badge><CapTag tag={capabilityTag.contextUsed} /></div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="text-xs font-medium text-muted">Changed</div>
              <ul className="mt-2 grid gap-1.5 text-sm">
                <li className="mono text-xs">services/export/worker.ts</li>
                <li className="mono text-xs">services/export/schema.ts</li>
                <li>Contract: statement schema now includes archived projects (read-only)</li>
              </ul>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <div className="text-xs font-medium text-muted">Evidence</div>
              <ul className="mt-2 grid gap-1.5 text-sm">
                <li>Worktree diff wt-142-a@e0a5b3f</li>
                <li>Receipt run-77 (Windows/Edge)</li>
                <li>Maintainer decision 13 Sep, 18:10</li>
              </ul>
            </div>
            <div className="rounded-lg border border-accent bg-accent-soft/40 p-4">
              <div className="text-xs font-medium text-muted">Next run will receive</div>
              <ul className="mt-2 grid gap-1.5 text-sm">
                <li className="flex items-center gap-1.5"><Eye className="h-3.5 w-3.5 text-accent-text" /> Reviewed note k1 (export schema contract)</li>
                <li className="flex items-center gap-1.5"><EyeOff className="h-3.5 w-3.5 text-danger" /> Revoked k4 will not be offered</li>
                <li className="text-xs text-muted">In-flight run-77 keeps its frozen packet.</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
