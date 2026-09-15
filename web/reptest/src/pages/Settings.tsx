import { ModelProviderConnection } from "@/components/model-provider";
import { ExaConnection } from "@/components/exa";
import { SentryConnection } from "@/components/sentry";
import { DiscordConnection } from "@/components/discord";
import { DailyConnection } from "@/components/meetings";
import { Bug, Video, Cpu } from "lucide-react";
import { GoogleCalendarConnection } from "@/components/google-calendar";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Button, Badge } from "@/components/ui";
import { IntegrationLogo } from "@/components/integration-logo";
import {
  api,
  desktop,
  errorText,
  useLoad,
  useWorkspace,
  when,
} from "@/lib/live";
import { cn } from "@/lib/utils";
const connections = [
  { id: "reddit", name: "Reddit", role: "Competitor discussions and source references", group: "Research" },
  {
    id: "exa",
    name: "Exa",
    role: "Architecture research and developer tool discovery",
    group: "Research",
  },
  {
    id: "sentry",
    name: "Sentry",
    role: "Reported bugs, releases and investigation alerts",
    group: "Monitoring",
  },
  {
    id: "calendar",
    name: "Workspace calendar",
    role: "Team plans and recorded agent activity",
    group: "Planning",
  },
  {
    id: "hermes",
    name: "Hermes",
    role: "Investigates reports and proposes changes",
    group: "Agents",
  },
  {
    id: "plow",
    name: "Plow + Latch",
    role: "Phone reports and approved delivery",
    group: "Communication",
  },
  { id: "discord", name: "Discord", role: "Team channel discussions and Reach todos", group: "Communication" },
  { id: "daily", name: "Daily video", role: "Team calls and saved transcripts", group: "Communication" },
  {
    id: "pi",
    name: "Pi",
    role: "Reviews Relay evidence in your terminal",
    group: "Agents",
  },
  { id: "models", name: "Model providers", role: "Choose the provider and model for Hermes", group: "Models" },
  {
    id: "moonshot",
    name: "Moonshot / Kimi",
    role: "Model access for your configured Pi profile",
    group: "Models",
  },
  {
    id: "mem0",
    name: "Mem0",
    role: "Private working notes for new Pi sessions",
    group: "Context and memory",
  },
] as const;
const groups = [
  "Communication",
  "Agents",
  "Models",
  "Context and memory",
  "Monitoring",
  "Research",
  "Planning",
] as const;
type Plow = {
  line_name?: string;
  configured?: boolean;
  grant_verified: boolean;
  checked_at?: string;
  latch_advertised?: boolean;
};
export function SettingsPage({
  onAccount,
  onKnowledge,
  onGuide,
  onCalendar,
}: {
  onAccount: () => void;
  onKnowledge: () => void;
  onGuide: () => void;
  onCalendar: () => void;
}) {
  const workspace = useWorkspace();
  const [selected, setSelected] = useState<(typeof connections)[number]["id"]>(
    () => {
      const id = new URLSearchParams(location.search).get("connection");
      return connections.find((c) => c.id === id)?.id || "plow";
    },
  );
  const plow = useLoad(() => api<Plow>("/connections/plow"));
  const tools = useLoad(() =>
    api<{ version: number; mem0: boolean }>("/tool-profile"),
  );
  const [receipt, setReceipt] = useState<Plow>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const connection = connections.find((c) => c.id === selected)!;
  function status(id: (typeof connections)[number]["id"]) {
    if (id === "reddit") return "Discovery via Exa · direct API not connected";
    if (id === "models") return "OpenAI · Anthropic · Kimi · OpenRouter";
    if (id === "discord") return "Selected channel · read-only collection";
    if (id === "daily") return "Private rooms · optional transcription";
    if (id === "exa") return "Web search and page text";
    if (id === "sentry") return "Account and project monitoring";
    if (id === "calendar") return "Local plans · Google Calendar";
    if (id === "hermes")
      return workspace.error
        ? "Status unavailable"
        : workspace.loading && !workspace.data
          ? "Checking runtime…"
          : workspace.data?.runner.available
            ? "Runtime available"
            : "Runtime unavailable";
    if (id === "plow")
      return receipt?.grant_verified
        ? "Line grant verified"
        : plow.error
          ? "Status unavailable"
          : plow.loading && !plow.data
            ? "Checking configuration…"
            : plow.data?.configured
              ? "Configured · check required"
              : "Not connected";
    if (id === "mem0")
      return tools.error
        ? "Preference unavailable"
        : !tools.data
          ? "Loading preference…"
          : tools.data.mem0
            ? "Selected for new Pi sessions"
            : "Optional · disabled";
    return "Check in your terminal";
  }
  async function perform(name: string, fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
    }
  }
  const ready =
    selected === "hermes"
      ? workspace.data?.runner.available
      : selected === "plow"
        ? receipt?.grant_verified
        : false;
  return (
    <div className="grid gap-4 p-4 md:p-6">
      <header>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">
          Manage what your agents use, what they remember, and how reports reach
          you.
        </p>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="grid gap-1">
          <h2 className="text-sm font-semibold">Workspace access</h2>
          <p className="text-xs text-muted">
            {workspace.data?.account.profile?.name ||
              "Open locally or join with an invitation."}{" "}
            Local work needs no login. The administrator manages the team's
            agent connections.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onGuide}>Guide me through Relay</Button>
          <Button onClick={onAccount}>Account settings</Button>
        </div>
      </div>
      <p className="text-sm text-muted">
        These connections work together. Selecting one below opens its settings;
        it does not switch off your other tools.
      </p>
      <div className="grid overflow-hidden rounded-lg border border-border bg-surface lg:grid-cols-[340px_1fr]">
        <section
          aria-label="Connections"
          className="border-b border-border lg:border-r lg:border-b-0"
        >
          {groups.map((group) => (
            <section key={group} aria-label={group}>
              <h2 className="border-b border-border bg-surface-2 px-4 py-2 text-xs font-semibold">
                {group}
              </h2>
              {connections
                .filter((c) => c.group === group)
                .map((c) => (
                  <button
                    key={c.id}
                    disabled={!!busy}
                    onClick={() => {
                      setSelected(c.id);
                      setError("");
                      setNotice("");
                    }}
                    aria-current={selected === c.id ? "true" : undefined}
                    className={cn(
                      "t-control grid w-full gap-2 border-b border-l-2 border-border p-4 text-left hover:bg-surface-2",
                      selected === c.id
                        ? "border-l-accent bg-accent-soft/40 ring-1 ring-inset ring-accent/40"
                        : "border-l-transparent",
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {c.id === "models" ? <Cpu size={22} /> : c.id === "daily" ? <Video size={22} /> : c.id === "sentry" ? (
                        <Bug size={22} />
                      ) : c.id === "calendar" ? (
                        <CalendarDays size={22} />
                      ) : (
                        <IntegrationLogo
                          provider={c.id}
                          size={c.id === "mem0" ? 15 : 22}
                        />
                      )}
                      {c.name}
                    </span>
                    <span className="text-xs text-muted">{c.role}</span>
                    <span className="text-xs text-muted">{status(c.id)}</span>
                  </button>
                ))}
              {group === "Context and memory" && (
                <button
                  onClick={onKnowledge}
                  className="t-control grid w-full gap-1 border-b border-border px-4 py-3 text-left hover:bg-surface-2"
                >
                  <span className="text-sm font-medium">
                    Reviewed project knowledge
                  </span>
                  <span className="text-xs text-muted">
                    Inspect saved evidence and its source in Knowledge.
                  </span>
                </button>
              )}
            </section>
          ))}
        </section>
        <section
          className="grid content-start gap-4 p-5"
          aria-label="Connection details"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {selected === "models" ? <Cpu size={28} /> : selected === "daily" ? <Video size={28} /> : selected === "sentry" ? (
                <Bug size={28} />
              ) : selected === "calendar" ? (
                <CalendarDays size={28} />
              ) : (
                <IntegrationLogo
                  provider={selected}
                  size={selected === "mem0" ? 20 : 28}
                />
              )}
              {connection.name}
            </h2>
            <Badge tone={ready ? "ok" : "outline"}>{status(selected)}</Badge>
          </div>
          <p className="text-sm text-muted">{connection.role}</p>
          {selected === "models" && <ModelProviderConnection />}
          {selected === "sentry" && <SentryConnection />}
          {selected === "exa" && <ExaConnection />}
          {selected === "reddit" && <div className="grid gap-3 text-sm">
            <h3 className="font-medium">Discover what people are discussing</h3>
            <p className="text-muted">Competitors can search Exa's index for Reddit references. This is not a direct Reddit connection, a complete comment archive, or permission to scrape Reddit.</p>
            <a href="/?view=competitors" className="text-accent-text underline">Open Competitors</a>
            <Button onClick={() => setSelected("exa")}>Configure optional Exa search</Button>
            <p className="text-xs text-muted">Direct collection requires approved Reddit access. Automated Latch browser research is not connected to Competitors yet. No Reddit password is collected here.</p>
            <a href="https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy" target="_blank" rel="noreferrer" className="text-xs text-accent-text underline">Reddit access requirements</a>
          </div>}
          {selected === "daily" && <DailyConnection />}
          {selected === "discord" && <DiscordConnection />}
          {selected === "calendar" && (
            <>
              <p className="text-sm">
                Plan reviews, tests and follow-ups with your team. Recorded runs
                appear automatically. Export a calendar snapshot for Apple
                Calendar, Google Calendar or Outlook.
              </p>
              <Button onClick={onCalendar}>Open workspace calendar</Button>
              <GoogleCalendarConnection />
            </>
          )}
          {selected === "hermes" && (
            <>
              <p className="text-sm">
                {workspace.data?.runner.reason ||
                  "Check the runtime to see its current capabilities."}
              </p>
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  Terminal setup
                </summary>
                <div className="mt-3 grid gap-3">
                  <Command text="python3 integrations/hermes-assessment/runtime.py gateway" />
                  <Command text="python3 integrations/hermes-assessment/runtime.py dev" />
                </div>
              </details>
              <p className="text-xs text-muted">
                Use separate terminals for the gateway and Relay. Hermes
                requires its own provider configuration; Pi login does not
                configure Hermes.
              </p>
              <a className="text-sm text-accent-text underline" href="/?view=settings&connection=models">Configure Hermes model provider</a>
              <Button onClick={workspace.refresh}>Check runtime</Button>
            </>
          )}
          {selected === "plow" && (
            <>
              <div className="grid gap-2 rounded-md border border-border-strong p-3">
                <h3 className="text-sm font-medium">Start with your agent and model</h3>
                <p className="text-sm text-muted">Plow Latch works with Claude, Codex, Hermes and other MCP-compatible agents. The agent uses your chosen model provider; Latch supplies approved Mac tools. MCP is the tool connection, not a model login.</p>
                <a className="text-sm text-accent-text underline" href="/?view=settings&connection=models">Configure Hermes model provider</a>
                <p className="text-xs text-muted">Using Claude or Codex directly? Sign in through that client and follow Plow's MCP connection setup. A verified phone line does not mean its agent or Mac tools are connected.</p>
                <a className="text-xs text-accent-text underline" href="https://plow.co/latch" target="_blank" rel="noreferrer">Connect an MCP-compatible agent to Latch</a>
              </div>
              <p className="text-sm">
                Authorize one assistant line and its owner chat. Relay checks
                that grant before importing reports or delivering an approved
                update.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="default"
                  pending={busy === "connect"}
                  disabled={!!busy}
                  onClick={() =>
                    void perform("connect", async () => {
                      setReceipt(undefined);
                      // Connect also verifies the line grant. Opening Latch is a
                      // follow-up step of this same explicit action on desktop.
                      const value = await api<Plow>(
                        "/connections/plow/connect",
                        "POST",
                      );
                      setReceipt(value);
                      plow.refresh();
                      if (desktop) {
                        try {
                          const { invoke } =
                            await import("@tauri-apps/api/core");
                          await invoke("open_plow_latch");
                          setNotice(
                            "Plow line verified. Latch launch requested.",
                          );
                        } catch {
                          setNotice(
                            "Plow line verified. Open the installed Latch app to finish connecting this Mac.",
                          );
                        }
                      } else {
                        setNotice(
                          "Plow line verified. Open Latch on your Mac to use desktop actions.",
                        );
                      }
                    })
                  }
                >
                  {receipt?.grant_verified
                    ? "Reconnect Plow + Latch"
                    : "Connect Plow + Latch"}
                </Button>
              </div>
              <details className="rounded-md border border-border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  First-time authorization and terminal setup
                </summary>
                <div className="mt-3 grid gap-3">
                  <p className="text-xs text-muted">
                    Use the login command if your Plow account has not been
                    authorized on this computer. Then connect the line. Opening
                    Latch alone does not authorize it.
                  </p>
                  <Command text="python3 integrations/plow/connect.py --login" />
                  <Command text="python3 integrations/plow/connect.py" />
                </div>
              </details>
              {receipt && (
                <div className="rounded-md border border-border p-3 text-sm">
                  <p className="font-medium">
                    {receipt.line_name || "Plow assistant"}
                  </p>
                  <p>Grant verified {when(receipt.checked_at!)}</p>
                  <p>
                    Latch endpoint:{" "}
                    {receipt.latch_advertised ? "Advertised" : "Not advertised"}
                  </p>
                  <p className="text-xs text-muted">
                    Mac action and phone delivery have not been exercised by
                    this check.
                  </p>
                </div>
              )}
              {plow.error && <p className="text-sm text-muted">{plow.error}</p>}
            </>
          )}
          {selected === "pi" && (
            <>
              <Command text="./relay pi doctor --profile personal" />
              <Command text="./relay pi start --profile personal" />
              <p className="text-sm text-muted">
                Start from macOS Terminal. Select your authenticated provider in
                Pi. Relay evidence tools load with the session; provider access
                remains separate.
              </p>
              <p className="text-sm text-muted">In Pi, use <code>/relay-context</code> to inspect approved instructions without a model call. <code>/relay-context-review</code> sends those contents to your selected provider for review and incurs its usage. Approve the current snapshot in Harness first.</p>
            </>
          )}
          {selected === "moonshot" && (
            <>
              <Command text="./relay pi doctor --profile personal --provider moonshot" />
              <p className="text-sm text-muted">
                Configure the Moonshot credential in your local Pi profile.
                Relay never displays or stores it in this page. A detected
                credential is not a verified model request.
              </p>
              <a
                className="text-sm text-accent-text underline"
                href="https://platform.moonshot.ai/console"
                target="_blank"
                rel="noreferrer"
              >
                Open Moonshot console
              </a>
            </>
          )}
          {selected === "mem0" && (
            <>
              <p className="text-sm text-muted">
                Enable scoped private notes for new Pi sessions. Existing
                sessions and reviewed Relay knowledge are unaffected.
                Authentication and billing remain with your configured Mem0
                account.
              </p>
              <Command text="python3 integrations/mem0-memory/memory.py setup" />
              <Button
                disabled={
                  !tools.data ||
                  !!busy ||
                  workspace.data?.account.role === "viewer"
                }
                pending={busy === "memory"}
                onClick={() =>
                  void perform("memory", async () => {
                    await api("/tool-profile", "PUT", {
                      version: tools.data!.version,
                      mem0: !tools.data!.mem0,
                    });
                    tools.refresh();
                    setNotice("Preference saved for new Pi sessions.");
                  })
                }
              >
                {tools.data?.mem0
                  ? "Disable private notes"
                  : "Enable private notes"}
              </Button>
              {tools.error && (
                <p role="alert" className="text-danger">
                  {tools.error}
                </p>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <p role="status" className="text-sm text-ok">
            {notice}
          </p>
        </section>
      </div>
    </div>
  );
}
export function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="grid gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <code className="mono min-w-0 flex-1 break-all rounded-md border border-border bg-surface-2 p-2 text-xs">
          {text}
        </code>
        <Button
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setError("");
            } catch {
              setError("Select and copy the command manually.");
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
