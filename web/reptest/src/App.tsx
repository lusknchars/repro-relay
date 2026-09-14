import { useState } from "react";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { Customizer } from "@/theme/Customizer";
import { Shell, type Route } from "@/components/shell/Shell";
import { WorkPage } from "@/pages/Work";
import { KnowledgePage } from "@/pages/Knowledge";
import { TeamPage } from "@/pages/Team";
import { UsagePage } from "@/pages/Usage";
import { SettingsPage } from "@/pages/Settings";
import { SetupPage } from "@/pages/Setup";

function Root() {
  const [route, setRoute] = useState<Route>("work");
  const [customizer, setCustomizer] = useState(false);

  return (
    <>
      <Shell route={route} onRoute={setRoute} onOpenCustomizer={() => setCustomizer(true)}>
        {route === "work" && <WorkPage />}
        {route === "team" && <TeamPage />}
        {route === "knowledge" && <KnowledgePage />}
        {route === "usage" && <UsagePage />}
        {route === "settings" && <SettingsPage />}
        {route === "setup" && <SetupPage onFinish={() => setRoute("work")} />}
      </Shell>
      <Customizer open={customizer} onClose={() => setCustomizer(false)} />
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}
