import { useRef, useState } from "react";
import { Button, Badge } from "@/components/ui";
import {
  api,
  errorText,
  useLoad,
  useWorkspace,
  type InvestigationRun,
} from "@/lib/live";

type Preview = {
  case_revision: number;
  build: string;
  context_hash: string;
  context: Record<string, unknown>;
};
type Request = {
  caseId: string;
  key: string;
  body: {
    revision: number;
    max_seconds: number;
    context_hash: string;
    harness_scan_id: string;
  };
};

export function HarnessTrial() {
  const workspace = useWorkspace();
  const [caseId, setCaseId] = useState("");
  const [seconds, setSeconds] = useState(60);
  const [prepared, setPrepared] = useState<{
    preview: Preview;
    scan: string;
  }>();
  const [request, setRequest] = useState<Request>();
  const [run, setRun] = useState<InvestigationRun>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const lock = useRef(false);
  const record = workspace.data?.cases.find((item) => item.id === caseId);
  const canRun =
    !!workspace.data?.account.enabled &&
    workspace.data.account.role !== "viewer" &&
    !!workspace.data.runner.available &&
    !workspace.error;
  const history = useLoad(
    () =>
      caseId
        ? api<InvestigationRun[]>(`/cases/${encodeURIComponent(caseId)}/runs`)
        : Promise.resolve([]),
    [caseId],
    5000,
  );
  const trials =
    history.data?.filter(
      (item) => (item.context as Record<string, unknown>)?.harness_trial,
    ) || [];
  const result = history.data?.find((item) => item.id === run?.id) || run;
  async function prepare() {
    if (lock.current || !caseId) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setPrepared(undefined);
    setConsent(false);
    try {
      const value = await api<{ context: null | { scan_id: string } }>(
        "/autonomy/context",
      );
      if (!value.context)
        throw new Error(
          "Approve the current instruction snapshot in Repository context first.",
        );
      const scan = value.context.scan_id;
      const preview = await api<Preview>(
        `/cases/${encodeURIComponent(caseId)}/investigation-preview?harness_scan_id=${encodeURIComponent(scan)}`,
      );
      setPrepared({ preview, scan });
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function start() {
    if (lock.current || !prepared || !canRun || !consent) return;
    const next = request || {
      caseId,
      key: crypto.randomUUID(),
      body: {
        revision: prepared.preview.case_revision,
        max_seconds: seconds,
        context_hash: prepared.preview.context_hash,
        harness_scan_id: prepared.scan,
      },
    };
    setRequest(next);
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const admitted = await api<InvestigationRun>(
        `/cases/${encodeURIComponent(next.caseId)}/runs`,
        "POST",
        next.body,
        next.key,
      );
      setRun(admitted);
      history.refresh();
    } catch (e) {
      setError(
        `${errorText(e)} Retry uses the same request. If the preview is stale, check Work for an admitted run before reloading this page to prepare another trial.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="grid min-w-0 gap-4"
      aria-label="Bug investigation trial"
    >
      <h2 className="text-lg font-semibold">Investigate a reported bug</h2>
      <p className="text-sm text-muted">
        Choose saved work, review the exact context, then start one Hermes
        attempt. This sends the displayed case evidence and approved repository
        instructions to your configured runtime and model provider.
      </p>
      <div className="grid gap-4 rounded-lg border border-border bg-surface p-4">
        <label className="grid gap-2 text-sm">
          Work record
          <select
            className="min-w-0 max-w-full rounded-md border border-border bg-surface p-2"
            value={caseId}
            disabled={busy || !!request}
            onChange={(event) => {
              setCaseId(event.target.value);
              setPrepared(undefined);
              setConsent(false);
              setError("");
            }}
          >
            <option value="">Choose a reported issue</option>
            {workspace.data?.cases.map((item) => (
              <option value={item.id} key={item.id}>
                {item.title} · {item.project}
              </option>
            ))}
          </select>
        </label>
        {workspace.data?.moreCases && (
          <p className="text-xs text-muted">
            Only the most recent 100 work records are listed.
          </p>
        )}
        {record && (
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted">Reported</dt>
              <dd className="whitespace-pre-wrap break-words">
                {record.description}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Expected</dt>
              <dd className="whitespace-pre-wrap break-words">
                {record.expected}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Build</dt>
              <dd>{record.build || "Missing; add a build in Work first"}</dd>
            </div>
          </dl>
        )}
        <label className="grid gap-2 text-sm">
          Attempt time limit
          <select
            className="rounded-md border border-border bg-surface p-2"
            disabled={busy || !!request}
            value={seconds}
            onChange={(event) => setSeconds(Number(event.target.value))}
          >
            <option value={30}>30 seconds</option>
            <option value={60}>60 seconds</option>
            <option value={120}>120 seconds</option>
          </select>
        </label>
        <p className="text-xs text-muted">
          One attempt. No automatic retries. Time limits request a cooperative
          stop; they are not a hard provider spending cap. Existing runtime tool
          permissions still apply. The trial requests no source edits, external
          messages or memory publication.
        </p>
        <Button
          disabled={!caseId || busy || !!request || !record?.build}
          onClick={() => void prepare()}
        >
          Preview trial context
        </Button>
      </div>
      {(error || workspace.error) && (
        <p role="alert" className="text-danger">
          {error || workspace.error}
        </p>
      )}
      {prepared && (
        <article className="grid min-w-0 gap-3 rounded-lg border border-border bg-surface p-4">
          <h3 className="font-medium">Review before starting</h3>
          <p className="break-all font-mono text-xs">
            {prepared.scan} · case revision {prepared.preview.case_revision}
          </p>
          <p className="break-all font-mono text-xs">
            Context SHA-256: {prepared.preview.context_hash}
          </p>
          <details>
            <summary className="cursor-pointer text-sm">
              Exact context sent to the runtime
            </summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(prepared.preview.context, null, 2)}
            </pre>
          </details>
          <label className="flex items-start gap-2 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={consent}
              disabled={!!request}
              onChange={(event) => setConsent(event.target.checked)}
            />
            I reviewed this context and authorize one model-backed attempt in
            the configured test environment. Provider usage applies.
          </label>
          {!canRun && (
            <p className="text-sm text-muted">
              {workspace.data?.account.role === "viewer"
                ? "A maintainer or administrator must start the trial."
                : "A reachable configured Hermes runtime is required. Check Settings before starting."}
            </p>
          )}
          <Button
            disabled={busy || !consent || !canRun || !!run}
            pending={busy}
            onClick={() => void start()}
          >
            {run
              ? "Trial admitted"
              : request
                ? "Retry same trial request"
                : "Start one trial"}
          </Button>
        </article>
      )}
      {result && (
        <article
          className="grid gap-2 rounded-lg border border-border bg-surface p-4"
          aria-label="Trial result"
        >
          <div className="flex flex-wrap gap-2">
            <h3 className="font-medium">{result.id}</h3>
            <Badge>{result.status}</Badge>
          </div>
          <p className="text-sm">{result.detail}</p>
          <p className="text-xs text-muted">
            Completion is not proof of reproduction. Review actual steps and
            evidence in Work. Missing token or cost data remains unknown.
          </p>
          <p className="text-xs">
            Tokens: {result.usage?.total_tokens ?? "Not reported"} · Cost USD:{" "}
            {result.usage?.cost_usd ?? "Not reported"}
          </p>
        </article>
      )}
      {caseId && (
        <a
          className="text-sm text-accent-text underline"
          href={`/?view=work&case=${encodeURIComponent(caseId)}`}
        >
          Open work, evidence and stop controls
        </a>
      )}
      {history.error && (
        <p role="alert" className="text-danger">
          Trial history unavailable: {history.error}
        </p>
      )}
      {!!trials.length && (
        <section className="grid gap-2" aria-label="Recorded trials">
          <h3 className="font-medium">Recorded trials for this work</h3>
          {trials.map((item) => (
            <div
              key={item.id}
              className="flex flex-wrap justify-between gap-2 rounded-md border border-border p-3 text-xs"
            >
              <span className="break-all">{item.id}</span>
              <Badge>{item.status}</Badge>
              <span>
                {item.max_seconds}s limit ·{" "}
                {item.usage?.total_tokens ?? "Unknown"} tokens
              </span>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
