import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { api, errorText, useLoad, type Case } from "@/lib/live";
type Conditions = {
  account_role: string;
  browser_os: string;
  feature_flags: string;
  prerequisites: string;
  acceptance: string;
};
type Snapshot = {
  version: number;
  applicable: boolean;
  record: { build: string; conditions: Conditions } | null;
};
export function CaseEnvironment({
  item,
  canWrite,
}: {
  item: Case;
  canWrite: boolean;
}) {
  const state = useLoad(
    () => api<Snapshot>(`/cases/${item.id}/environment`),
    [item.id, item.revision],
  );
  const [draft, setDraft] = useState<{ version: number; value: Conditions }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <details className="rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Reproduction conditions
      </summary>
      <div className="mt-3 grid gap-3 text-sm">
        <p className="text-muted">
          Record the conditions needed to reproduce this problem. New
          investigations receive a frozen copy. These notes do not provision
          accounts or prove a test passed.
        </p>
        <p>
          Build:{" "}
          {item.build || "Not recorded · add a build to this report first"}
        </p>
        {(error || state.error) && (
          <p role="alert" className="text-danger">
            {error || state.error}
          </p>
        )}
        {state.data?.record && !state.data.applicable && (
          <p role="alert" className="text-warn">
            The case changed. Recheck these conditions before using them.
          </p>
        )}
        {!draft && state.data?.record && (
          <dl className="grid gap-2">
            {Object.entries(state.data.record.conditions).map(
              ([key, value]) => (
                <div key={key}>
                  <dt className="text-xs text-muted">
                    {key.split("_").join(" ")}
                  </dt>
                  <dd className="whitespace-pre-wrap">
                    {value || "None recorded"}
                  </dd>
                </div>
              ),
            )}
          </dl>
        )}
        {!draft && (
          <Button
            disabled={!canWrite || !item.build || !state.data}
            onClick={() =>
              setDraft({
                version: state.data!.version,
                value: state.data?.record?.conditions || {
                  account_role: "",
                  browser_os: "",
                  feature_flags: "",
                  prerequisites: "",
                  acceptance: item.expected,
                },
              })
            }
          >
            Record conditions
          </Button>
        )}
        {draft && (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                await api(`/cases/${item.id}/environment`, "PUT", {
                  version: draft.version,
                  case_revision: item.revision,
                  conditions: draft.value,
                });
                setDraft(undefined);
                state.refresh();
              } catch (e) {
                setError(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {(
              [
                ["account_role", "Test account role", 120],
                ["browser_os", "Browser and operating system", 200],
                ["feature_flags", "Feature flags (optional)", 1000],
                ["prerequisites", "Test data and prerequisites", 2000],
                ["acceptance", "What must pass", 2000],
              ] as const
            ).map(([key, label, max]) => (
              <label key={key} className="grid gap-1">
                {label}
                <Input
                  required={key !== "feature_flags"}
                  maxLength={max}
                  value={draft.value[key]}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      value: { ...draft.value, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
            <p className="text-xs text-muted">
              Describe account roles and test data. Keep passwords, tokens and
              personal customer records out of these notes.
            </p>
            <div className="flex gap-2">
              <Button disabled={busy} type="submit">
                Save conditions
              </Button>
              <Button
                disabled={busy}
                type="button"
                onClick={() => {
                  setDraft(undefined);
                  state.refresh();
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </details>
  );
}
