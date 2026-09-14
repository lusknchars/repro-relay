import { Badge } from "@/components/ui";
import type { CapabilityTag, Source, WorkState } from "@/lib/data";

export function StateBadge({ state, live }: { state: WorkState; live?: boolean }) {
  switch (state) {
    case "decision":
      return <Badge tone="accent" dot>Needs your decision</Badge>;
    case "working":
      return <Badge tone="ok" dot>{live ? "Investigating" : "Working"}</Badge>;
    case "blocked":
      return <Badge tone="danger" dot>Blocked</Badge>;
    case "finished":
      return <Badge tone="neutral">Finished</Badge>;
    default:
      return <Badge tone="outline">Historical</Badge>;
  }
}

export function SourceBadge({ source }: { source: Source }) {
  const tone =
    source === "Human observation" ? "info" :
    source === "Windows/Edge receipt" ? "ok" :
    source === "Agent proposal" ? "accent" :
    source === "Fixture" || source === "Chromium mobile viewport" ? "warn" : "neutral";
  return <Badge tone={tone}>{source}</Badge>;
}

export function CapTag({ tag }: { tag: CapabilityTag }) {
  const tone = tag === "Existing" ? "ok" : tag === "Recompose existing" ? "info" : tag === "Needs backend" ? "warn" : "neutral";
  return <Badge tone={tone} title="Implementation status of this frame (handoff annotation)">{tag}</Badge>;
}

export function LastConfirmed({ text, at }: { text: string; at: string }) {
  return (
    <p className="text-xs text-muted">
      <span className="text-foreground">Last confirmed:</span> {text} <span className="tnum">· {at}</span>
    </p>
  );
}
