// Adapted from PaceUI app-education-1. See THIRD_PARTY_NOTICES.md.
import { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  ArrowUpRight,
} from "lucide-react";
import { Button, Badge } from "@/components/ui";
import type { Case, InvestigationRun } from "@/lib/live";
import "./work-record-checklist.css";
export function WorkRecordChecklist({
  item,
  run,
  reviews,
  pending,
  unavailable,
  onInspect,
}: {
  item: Case;
  run?: InvestigationRun;
  reviews: number;
  pending: boolean;
  unavailable: boolean;
  onInspect: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const sections = [
    {
      id: "report",
      title: "Reported behavior",
      recorded: true,
      count: "1 report",
      content: (
        <>
          <p>{item.description}</p>
          <p>Expected: {item.expected}</p>
        </>
      ),
    },
    {
      id: "context",
      title: "Target and build",
      recorded: !!item.url && !!item.build,
      count: item.build ? "Build recorded" : "Build missing",
      content: (
        <>
          <p>Target: {item.url || "Not recorded"}</p>
          <p>Build: {item.build || "Not recorded"}</p>
          <p>
            Case revision {item.revision}. Reproduction conditions are available
            below.
          </p>
        </>
      ),
    },
    {
      id: "attempt",
      title: "Selected investigation attempt",
      recorded: !!run,
      count: run
        ? run.status
        : pending
          ? "Loading"
          : unavailable
            ? "Unavailable"
            : "No attempt",
      content: (
        <p>
          {run
            ? `${run.execution_kind === "local_validation" ? "Imported local validation" : "Hermes attempt"} · ${run.status}. ${run.detail || ""}`
            : "No attempt is available to inspect."}
        </p>
      ),
    },
    {
      id: "observations",
      title: "Human observations",
      recorded: item.observations.length > 0,
      count: `${item.observations.length} recorded`,
      content: (
        <p>
          {item.observations.length
            ? "Author-attributed observations appear below. They do not independently verify a fix."
            : "No human observations have been recorded for this case."}
        </p>
      ),
    },
    {
      id: "review",
      title: "Attempt review",
      recorded: reviews > 0,
      count: pending
        ? "Loading"
        : unavailable
          ? "Unavailable"
          : `${reviews} recorded`,
      content: (
        <p>
          {reviews
            ? "Review decisions for the selected attempt appear in this conversation."
            : "No review decision is available for the selected attempt. Inspect its evidence before deciding."}
        </p>
      ),
    },
  ];
  const recorded = sections.filter((section) => section.recorded).length;
  return (
    <section
      className="work-record-checklist"
      aria-label="Investigation record checklist"
    >
      <header>
        <div>
          <Badge tone="outline">
            {recorded}/{sections.length}
          </Badge>
          <h4>Investigation record</h4>
          <button
            aria-label={
              collapsed
                ? "Expand investigation record"
                : "Collapse investigation record"
            }
            aria-expanded={!collapsed}
            aria-controls="work-record-sections"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
        <p>Report, context and review in one place.</p>
        <div className="work-record-progress">
          <div>
            <span>
              {pending
                ? "Checking recorded sections…"
                : unavailable
                  ? "Some record sources are unavailable"
                  : `${recorded} of ${sections.length} sections have records`}
            </span>
            {!pending && !unavailable && (
              <progress
                aria-label="Record coverage"
                value={recorded}
                max={sections.length}
              />
            )}
          </div>
          <Button onClick={onInspect}>
            Inspect evidence <ArrowUpRight size={13} />
          </Button>
        </div>
        <small>Record coverage, not test results or fix completion.</small>
      </header>
      {!collapsed && (
        <div id="work-record-sections">
          {sections.map((section, index) => (
            <article key={section.id} data-expanded={expanded === section.id}>
              <button
                aria-expanded={expanded === section.id}
                aria-controls={`work-record-${section.id}`}
                onClick={() =>
                  setExpanded(expanded === section.id ? null : section.id)
                }
              >
                <span className="work-record-number">{index + 1}</span>
                <strong>{section.title}</strong>
                {section.recorded ? (
                  <CheckCircle2 size={17} aria-label="Recorded" />
                ) : (
                  <Circle size={17} />
                )}
                <small>{section.count}</small>
                <ChevronDown size={14} />
              </button>
              {expanded === section.id && (
                <div id={`work-record-${section.id}`}>{section.content}</div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
