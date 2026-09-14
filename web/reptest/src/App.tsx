import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { Customizer } from "@/theme/Customizer";
import { Shell, type Route } from "@/components/shell/Shell";
import { WorkPage } from "@/pages/Work";
import { KnowledgePage } from "@/pages/Knowledge";
import { TeamPage } from "@/pages/Team";
import { UsagePage } from "@/pages/Usage";
import { SettingsPage } from "@/pages/Settings";
import { SetupPage } from "@/pages/Setup";
import { WorkspaceProvider } from "@/lib/live";
import { WorkspaceGuide, guideSteps } from "@/components/workspace-guide";

function Root() {
  const [route, setRoute] = useState<Route>(() => {
    const view = new URLSearchParams(location.search).get("view");
    return location.hash.startsWith("#invite=")
      ? "team"
      : ["team", "knowledge", "usage", "settings", "setup"].includes(view || "")
        ? (view as Route)
        : "work";
  });
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("view", route);
    history.replaceState(null, "", url);
  }, [route]);
  const [customizer, setCustomizer] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [guide, setGuide] = useState<number | null>(null);
  function guideTo(step: number) {
    setGuide(step);
    setRoute(guideSteps[step].route);
  }
  function navigate(next: Route) {
    setGuide(null);
    setRoute(next);
  }
  function startGuide() {
    setAccountOpen(false);
    guideTo(0);
  }
  const accountDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (accountOpen) accountDialog.current?.showModal();
    else accountDialog.current?.close();
  }, [accountOpen]);

  return (
    <>
      <Shell
        route={route}
        onRoute={navigate}
        onOpenCustomizer={() => setCustomizer(true)}
        onOpenAccount={() => setAccountOpen(true)}
      >
        {route === "work" && <WorkPage />}
        {route === "team" && <TeamPage onRegistered={startGuide} />}
        {route === "knowledge" && <KnowledgePage />}
        {route === "usage" && <UsagePage />}
        {route === "settings" && (
          <SettingsPage
            onAccount={() => setAccountOpen(true)}
            onKnowledge={() => navigate("knowledge")}
            onGuide={startGuide}
          />
        )}
        {route === "setup" && (
          <SetupPage
            onFinish={() => navigate("work")}
            onAccount={() => setAccountOpen(true)}
            onKnowledge={() => navigate("knowledge")}
            onGuide={startGuide}
          />
        )}
      </Shell>
      {guide !== null && !accountOpen && !customizer && (
        <WorkspaceGuide
          step={guide}
          onStep={guideTo}
          onClose={() => setGuide(null)}
        />
      )}
      <Customizer open={customizer} onClose={() => setCustomizer(false)} />
      <dialog
        ref={accountDialog}
        aria-label="Relay account"
        onClose={() => setAccountOpen(false)}
        className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-[480px] overflow-y-auto rounded-xl border border-border bg-background p-0 text-foreground shadow-2xl backdrop:bg-black/60"
      >
        <button
          autoFocus
          aria-label="Close account"
          onClick={() => setAccountOpen(false)}
          className="t-control absolute right-3 top-3 rounded-md p-2 text-muted hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        {accountOpen && <TeamPage accountOnly onRegistered={startGuide} />}
      </dialog>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <WorkspaceProvider>
        <Root />
      </WorkspaceProvider>
    </ThemeProvider>
  );
}
