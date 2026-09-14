import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Field, Input, Segmented, Switch } from "@/components/ui";

const STEPS = ["Repository", "Runtime", "Model provider", "Permissions", "Memory", "Connection check", "First result"];

export function SetupPage({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0);
  const [runtime, setRuntime] = useState<"hermes" | "pi">("hermes");
  const [provider, setProvider] = useState<"moonshot" | "anthropic">("moonshot");
  const [key, setKey] = useState("");
  const [mem, setMem] = useState<"existing" | "create" | "skip">("existing");
  const [check, setCheck] = useState<"idle" | "pending" | "ok" | "credit">("idle");
  const [perm, setPerm] = useState({ inspect: true, tests: true, edits: false, messages: false });

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  return (
    <div className="relative min-h-full">
      <div className="perspective-grid pointer-events-none absolute inset-x-0 top-0 h-56" aria-hidden />
      <div className="relative mx-auto grid max-w-3xl gap-6 p-4 md:p-8">
        <div>
          <h1 className="text-lg font-semibold">Connect once</h1>
          <p className="max-w-prose text-sm text-muted">Seven short steps. Each has Back, a visible completion rule and a recoverable error. There is no session title or first-prompt form.</p>
        </div>

        <ol className="flex flex-wrap gap-1.5" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li key={s} className={cn("flex items-center gap-1.5 rounded-sm border px-2 py-1 text-xs", i === step ? "border-accent bg-accent-soft text-accent-text" : i < step ? "border-border text-muted" : "border-border text-faint")}>
              {i < step ? <Check className="h-3 w-3 text-ok" /> : <span className="tnum">{i + 1}</span>} {s}
            </li>
          ))}
        </ol>

        <div className="rounded-lg border border-border bg-surface p-5">
          {step === 0 && (
            <div className="grid gap-4">
              <h2 className="text-base font-semibold">Choose the repository and environment</h2>
              <Field label="Repository folder" htmlFor="repo"><Input id="repo" defaultValue="~/code/acme-billing" /></Field>
              <div className="grid gap-1 rounded-md border border-border p-3 text-sm">
                <div className="text-xs text-muted">Discovered — confirm</div>
                <div>Default branch <span className="mono">main</span> · package manager <span className="mono">pnpm</span> · test script <span className="mono">test:ci</span> · 2 instruction files (AGENTS.md, CLAUDE.md)</div>
              </div>
              <Field label="Application / environment" htmlFor="env"><Input id="env" defaultValue="staging-eu" /></Field>
              <p className="text-xs text-muted">Done when: folder is a Git repository and a branch is selected.</p>
            </div>
          )}
          {step === 1 && (
            <div className="grid gap-4">
              <h2 className="text-base font-semibold">Connect the runtime for this workflow</h2>
              <div className="grid gap-2 md:grid-cols-2" role="radiogroup" aria-label="Runtime">
                {([
                  ["hermes", "Hermes", "Investigates, runs checks and proposes isolated fixes inside Relay."],
                  ["pi", "Pi", "Terminal client for reviewing evidence with Kimi as the model provider — not a second investigator."],
                ] as const).map(([v, n, d]) => (
                  <button key={v} role="radio" aria-checked={runtime === v} onClick={() => setRuntime(v)} className={cn("t-control grid gap-1 rounded-md border p-3 text-left", runtime === v ? "border-accent bg-accent-soft/50" : "border-border hover:border-border-strong")}>
                    <div className="text-sm font-medium">{n}</div>
                    <div className="text-xs text-muted">{d}</div>
                  </button>
                ))}
              </div>
              <div className="grid gap-1.5 rounded-md border border-border p-3 text-sm">
                <div className="flex items-center gap-2 text-xs text-muted"><Terminal className="h-3.5 w-3.5" /> Run in macOS Terminal</div>
                <div className="flex items-center gap-2">
                  <code className="mono flex-1 rounded-sm border border-border bg-surface-2 px-2 py-1.5">{runtime === "hermes" ? "hermes serve --relay" : "pi --provider moonshot --model kimi-k3"}</code>
                  <Button size="sm"><Copy className="h-3.5 w-3.5" /> Copy</Button>
                </div>
                <div className="text-xs text-muted">Expected: <span className="mono">{runtime === "hermes" ? "listening on :7420" : "moonshot/kimi-k3 ›"}</span>. Copying does not mark this step done; Relay must reach the process.</div>
              </div>
              <div className="flex items-center gap-2 text-xs"><Badge tone="ok" dot>Runtime reachable</Badge><span className="text-muted">hermes-local answered at 13:58</span></div>
            </div>
          )}
          {step === 2 && (
            <div className="grid gap-4">
              <h2 className="text-base font-semibold">Choose the model provider</h2>
              <Segmented ariaLabel="Provider" value={provider} onChange={setProvider} options={[{ value: "moonshot", label: "Moonshot (kimi-k3)" }, { value: "anthropic", label: "Anthropic" }]} />
              <Field label="API key" htmlFor="key" hint="Entered through a private field, stored masked, never shown in shared files."><Input id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste key" autoComplete="off" /></Field>
              <div className="rounded-md border border-border p-3 text-xs text-muted">Provider credits and plan or subscription limits are different balances. A key can be valid while the prepaid balance is empty.</div>
              <p className="text-xs text-muted">Done when: a key is present. This does not verify a request — step 6 does.</p>
            </div>
          )}
          {step === 3 && (
            <div className="grid gap-3">
              <h2 className="text-base font-semibold">Standing permissions</h2>
              <p className="text-xs text-muted">Default is inspection. Edits and external messages are described explicitly and stay off unless you turn them on.</p>
              {([
                ["inspect", "Read repository, logs and artifacts"],
                ["tests", "Run the test command in an isolated worktree"],
                ["edits", "Propose edits in an isolated worktree (never main)"],
                ["messages", "Send approved messages to owners through Plow"],
              ] as [keyof typeof perm, string][]).map(([k, l]) => (
                <div key={k} className="flex items-center justify-between border-b border-border py-2.5 last:border-b-0 text-sm"><span>{l}</span><Switch checked={perm[k]} onCheckedChange={(v) => setPerm((p) => ({ ...p, [k]: v }))} label={l} /></div>
              ))}
            </div>
          )}
          {step === 4 && (
            <div className="grid gap-3">
              <h2 className="text-base font-semibold">Memory is optional</h2>
              <div className="grid gap-2" role="radiogroup" aria-label="Memory">
                {([
                  ["existing", "Connect an existing Mem0 account", "Shown first. Uses your own key; nothing is duplicated."],
                  ["create", "Create an agent account", "Explicit alternative. Not done automatically when a provider already exists."],
                  ["skip", "Skip for now", "Reviewed knowledge still works without private notes."],
                ] as const).map(([v, n, d]) => (
                  <button key={v} role="radio" aria-checked={mem === v} onClick={() => setMem(v)} className={cn("t-control grid gap-0.5 rounded-md border p-3 text-left", mem === v ? "border-accent bg-accent-soft/50" : "border-border hover:border-border-strong")}>
                    <div className="text-sm font-medium">{n}</div><div className="text-xs text-muted">{d}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {step === 5 && (
            <div className="grid gap-4">
              <h2 className="text-base font-semibold">Bounded connection check</h2>
              <p className="max-w-prose text-sm text-muted">Sends one small request (≈ 40 tokens, paid by the provider balance) and reads the response. A detected key is not a successful request.</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="default" pending={check === "pending"} outcome={check === "ok" ? "success" : check === "credit" ? "failure" : null} onClick={() => { setCheck("pending"); window.setTimeout(() => setCheck(key.length > 8 ? "ok" : "credit"), 1300); }}>
                  {check === "ok" ? "Request verified" : check === "credit" ? "Request blocked" : "Run check (1 paid request)"}
                </Button>
                <Button variant="ghost" onClick={() => setCheck("idle")}>Reset (prototype)</Button>
              </div>
              {check === "ok" && <div className="rounded-md border border-ok/40 bg-ok-soft/40 p-3 text-sm">Model answered in 640 ms · kimi-k3 · cost $0.0004 provider-reported. Connection verified at 14:02.</div>}
              {check === "credit" && (
                <div className="grid gap-2 rounded-md border border-danger/40 bg-danger-soft/40 p-3 text-sm">
                  <div className="font-medium">Model request blocked: provider credit balance</div>
                  <div className="text-xs text-muted">Credential accepted; prepaid balance exhausted. Not a memory problem. Your setup progress is kept.</div>
                  <div className="flex gap-2"><Button size="sm" variant="default">Open Moonshot billing</Button><Button size="sm" variant="outline" onClick={() => setStep(2)}>Change provider</Button></div>
                </div>
              )}
              <p className="text-xs text-muted">Done when: a successful request is recorded. Prototype rule: a key longer than 8 characters simulates success.</p>
            </div>
          )}
          {step === 6 && (
            <div className="grid gap-4">
              <h2 className="text-base font-semibold">First scan result</h2>
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                <li className="flex items-center justify-between px-3 py-2"><span>Tracked-instruction audit</span><Badge tone="warn">2 files disagree about the test command</Badge></li>
                <li className="flex items-center justify-between px-3 py-2"><span>Duplication candidates</span><Badge tone="info">1 candidate: formatCurrency</Badge></li>
                <li className="flex items-center justify-between px-3 py-2"><span>Open support messages</span><Badge tone="neutral">Intake off</Badge></li>
              </ul>
              <p className="text-xs text-muted">This is the first actual scan on main@8f21c0e at 14:03. An optional tour appears in context on Work and can be skipped or replayed.</p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={back} disabled={step === 0}>Back</Button>
          <div className="flex items-center gap-2">
            <span className="tnum text-xs text-muted">Step {step + 1} of {STEPS.length}</span>
            {step < STEPS.length - 1 ? <Button variant="default" onClick={next}>Continue</Button> : <Button variant="default" onClick={onFinish}>Open Work</Button>}
          </div>
        </div>
      </div>
    </div>
  );
}
