import { Button, Badge } from "@/components/ui";
import { useWorkspace } from "@/lib/live";
import { SettingsPage } from "./Settings";
export function SetupPage({
  onFinish,
  onAccount,
  onKnowledge,
  onGuide,
}: {
  onFinish: () => void;
  onAccount: () => void;
  onKnowledge: () => void;
  onGuide: () => void;
}) {
  const { data } = useWorkspace();
  return (
    <div className="grid gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <h1 className="text-lg font-semibold">Connect your workspace</h1>
          <p className="text-sm text-muted">
            Connect once, then investigate reports using their existing context.
          </p>
        </div>
        <Badge tone={data ? "ok" : "warn"}>
          {data ? "Database connected" : "Checking workspace"}
        </Badge>
        <Button onClick={onFinish}>Open work</Button>
      </header>
      <SettingsPage
        onAccount={onAccount}
        onKnowledge={onKnowledge}
        onGuide={onGuide}
      />
    </div>
  );
}
