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
  { id: "hermes", name: "Hermes", role: "Investigation runtime" },
  {
    id: "plow",
    name: "Plow + Latch",
    role: "Phone reports and approved delivery",
  },
  { id: "pi", name: "Pi", role: "Local terminal harness" },
  { id: "moonshot", name: "Moonshot / Kimi", role: "Model provider" },
  { id: "mem0", name: "Mem0", role: "Optional private working notes" },
] as const;
type Plow = {
  line_name?: string;
  configured?: boolean;
  grant_verified: boolean;
  checked_at?: string;
  latch_advertised?: boolean;
};
export function SettingsPage() {
  const workspace = useWorkspace();
  const [selected, setSelected] =
    useState<(typeof connections)[number]["id"]>("plow");
  const plow = useLoad(() => api<Plow>("/connections/plow"));
  const tools = useLoad(() =>
    api<{ version: number; mem0: boolean }>("/tool-profile"),
  );
  const [receipt, setReceipt] = useState<Plow>();
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const connection = connections.find((c) => c.id === selected)!;
  async function perform(name: string, fn: () => Promise<unknown>) {
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
          Connect the runtime, tools, and owner channel for this installation.
        </p>
      </header>
      <div className="grid overflow-hidden rounded-lg border border-border bg-surface lg:grid-cols-[340px_1fr]">
        <section
          aria-label="Connections"
          className="border-b border-border lg:border-r lg:border-b-0"
        >
          {connections.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setSelected(c.id);
                setError("");
                setNotice("");
              }}
              aria-current={selected === c.id ? "true" : undefined}
              className={cn(
                "t-control grid w-full gap-2 border-b border-l-2 border-border p-4 text-left hover:bg-surface-2",
                selected === c.id
                  ? "border-l-accent bg-accent-soft/40"
                  : "border-l-transparent",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <IntegrationLogo
                  provider={c.id}
                  size={c.id === "mem0" ? 15 : 22}
                />
                {c.name}
              </span>
              <span className="text-xs text-muted">{c.role}</span>
              <span className="text-xs text-muted">
                {c.id === "hermes"
                  ? workspace.data?.runner.available
                    ? "Runtime available"
                    : "Runtime unavailable"
                  : c.id === "plow"
                    ? receipt?.grant_verified
                      ? "Line grant verified"
                      : plow.data?.configured
                        ? "Configured · check required"
                        : "Not connected"
                    : c.id === "mem0"
                      ? tools.data?.mem0
                        ? "Selected for new Pi sessions"
                        : "Optional · disabled"
                      : "Managed in the local terminal"}
              </span>
            </button>
          ))}
        </section>
        <section
          className="grid content-start gap-4 p-5"
          aria-label="Connection details"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <IntegrationLogo
                provider={selected}
                size={selected === "mem0" ? 20 : 28}
              />
              {connection.name}
            </h2>
            <Badge tone={ready ? "ok" : "outline"}>
              {ready ? "Verified connection" : "Setup / inspection"}
            </Badge>
          </div>
          <p className="text-sm text-muted">{connection.role}</p>
          {selected === "hermes" && (
            <>
              <p className="text-sm">
                {workspace.data?.runner.reason ||
                  "Check the runtime to see its current capabilities."}
              </p>
              <Command text="python3 integrations/hermes-assessment/runtime.py gateway" />
              <Command text="python3 integrations/hermes-assessment/runtime.py dev" />
              <p className="text-xs text-muted">
                Use separate terminals for the gateway and Relay. Hermes
                requires its own provider configuration; Pi login does not
                configure Hermes.
              </p>
              <Button onClick={workspace.refresh}>Check runtime</Button>
            </>
          )}
          {selected === "plow" && (
            <>
              <p className="text-sm">
                Authorize one assistant line and its owner chat. Relay checks
                that grant before importing reports or delivering an approved
                update.
              </p>
              <Command text="python3 integrations/plow/connect.py --login" />
              <Command text="python3 integrations/plow/connect.py" />
              <p className="text-xs text-muted">
                Configuration stays in .data/plow/bridge.json; credentials stay
                in a private local file. Opening Latch alone does not connect
                the line.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  pending={busy === "connect"}
                  disabled={!!busy}
                  onClick={() =>
                    void perform("connect", async () => {
                      setReceipt(undefined);
                      const value = await api<Plow>(
                        "/connections/plow/connect",
                        "POST",
                      );
                      setReceipt(value);
                      plow.refresh();
                      setNotice("Assistant line connected.");
                    })
                  }
                >
                  Connect authorized Plow account
                </Button>
                <Button
                  pending={busy === "check"}
                  disabled={!!busy}
                  onClick={() =>
                    void perform("check", async () => {
                      setReceipt(undefined);
                      const value = await api<Plow>(
                        "/connections/plow/check",
                        "POST",
                      );
                      setReceipt(value);
                      setNotice("Line and owner chat verified.");
                    })
                  }
                >
                  Check Plow connection
                </Button>
                {desktop ? (
                  <Button
                    disabled={!!busy}
                    onClick={() =>
                      void perform("open", async () => {
                        const { invoke } = await import("@tauri-apps/api/core");
                        await invoke("open_plow_latch");
                        setNotice("Plow Latch launch requested.");
                      })
                    }
                  >
                    Open Plow Latch
                  </Button>
                ) : (
                  <Command text="open -b co.plow.domo-desktop" />
                )}
              </div>
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
