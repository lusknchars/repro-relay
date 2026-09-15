import { useEffect, useRef } from "react";
import { Button } from "@/components/ui";
import type { Route } from "@/components/shell/Shell";

export const guideSteps: { route: Route; title: string; body: string }[] = [
  {
    route: "team",
    title: "Your account and team",
    body: "Local work opens without a login. Invite teammates by link; they enter a name and join the saved work and shared Hermes conversation. The administrator manages the agent and approves execution.",
  },
  {
    route: "settings",
    title: "Connect the parts your agent needs",
    body: "Agents do the work, models supply their responses, memory provides context, and Plow carries reports. A connection check tells you what is ready; it does not start an investigation.",
  },
  {
    route: "knowledge",
    title: "Inspect memory and agent context",
    body: "Harness opens with reviewed Memory linked to its source and reviewer. Repository context shows tracked instruction snapshots and approvals. Private Mem0 notes stay separate. Reading context does not authorize execution.",
  },
  {
    route: "work",
    title: "Follow the evidence and review changes",
    body: "Open a report to inspect its attempts and results. Agent output remains a proposal. Review the evidence before approving a repair; changed source context needs a new decision.",
  },
  {
    route: "usage",
    title: "Understand usage and limits",
    body: "Usage shows reported tokens and costs for saved investigations. Missing costs remain unknown. A time limit requests a stop; it is not a provider credit balance or an enforced dollar cap.",
  },
];

export function WorkspaceGuide({
  step,
  onStep,
  onClose,
}: {
  step: number;
  onStep: (step: number) => void;
  onClose: () => void;
}) {
  const item = guideSteps[step];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  return (
    <aside
      aria-label="Workspace guide"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      className="fixed bottom-20 right-4 z-30 grid max-h-[65dvh] w-[calc(100%-2rem)] max-w-md gap-3 overflow-y-auto rounded-lg border border-accent bg-surface p-5 shadow-xl md:bottom-5"
    >
      <p className="text-xs text-muted">
        Workspace guide · {step + 1} of {guideSteps.length}
      </p>
      <h2
        ref={heading}
        tabIndex={-1}
        className="text-base font-semibold"
        aria-live="polite"
      >
        {item.title}
      </h2>
      <p className="text-sm leading-relaxed text-muted">{item.body}</p>
      <div className="flex flex-wrap justify-between gap-2">
        <Button variant="ghost" onClick={onClose}>
          Skip guide
        </Button>
        <div className="flex gap-2">
          <Button disabled={step === 0} onClick={() => onStep(step - 1)}>
            Back
          </Button>
          {step === guideSteps.length - 1 ? (
            <Button variant="default" onClick={onClose}>
              Finish guide
            </Button>
          ) : (
            <Button variant="default" onClick={() => onStep(step + 1)}>
              Next
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
