import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
export type { Case, InvestigationRun, Memory } from "../../../src/types";
import type { Case, InvestigationRun } from "../../../src/types";
import { invoke } from "@tauri-apps/api/core";

export const desktop = "__TAURI_INTERNALS__" in window;
const base = desktop ? "http://127.0.0.1:8178/api/v1" : "/api/v1";
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
): Promise<T> {
  if (desktop && /^\/(account|team)(\/|$)/.test(path)) {
    const response = await invoke<{
      status: number;
      body: T & { detail?: string };
      session_persistent: boolean;
    }>("account_request", { path, method, body: body ?? null }).catch((error) => {
      throw new Error(typeof error === "string" ? error : "Account connection unavailable.");
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(response.body?.detail || `Account request failed (${response.status}).`);
    }
    return { ...response.body, session_persistent: response.session_persistent };
  }
  const response = await fetch(base + path, {
    method,
    credentials: "include",
    signal: AbortSignal.timeout(25000),
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(
      data.detail ||
        `Request failed (${response.status}). Refresh before retrying.`,
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export type RunSummary = Pick<
  InvestigationRun,
  "id" | "case_id" | "created_at" | "status" | "execution_kind" | "usage"
> & { active: boolean };
export type Account = {
  enabled: boolean;
  authenticated: boolean;
  session_persistent?: boolean;
  bootstrap_available?: boolean;
  shared?: boolean;
  role?: string;
  profile?: { id: string; username: string; name: string; bio: string };
};
export type Runner = { available: boolean; reason?: string };
export function useLoad<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  interval = 0,
) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);
  const scope = JSON.stringify(deps);
  const previousScope = useRef(scope);
  const refresh = useCallback(() => setGeneration((n) => n + 1), []);
  useEffect(() => {
    let alive = true,
      running = false;
    if (previousScope.current !== scope) {
      setData(undefined);
      previousScope.current = scope;
    }
    setError("");
    setLoading(true);
    const load = async () => {
      if (running) return;
      running = true;
      try {
        const value = await fetcher();
        if (alive) {
          setData(value);
          setError("");
        }
      } catch (e) {
        if (alive) {
          setData(undefined);
          setError(e instanceof Error ? e.message : "Connection unavailable.");
        }
      } finally {
        running = false;
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = interval
      ? window.setInterval(() => {
          if (!document.hidden) void load();
        }, interval)
      : undefined;
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
    };
    // Each caller supplies the stable identifiers used by its request.
  }, [...deps, generation]);
  return { data, error, loading, refresh };
}
type WorkspaceData = {
  cases: Case[];
  runs: RunSummary[];
  moreCases: boolean;
  moreRuns: boolean;
  runner: Runner;
  account: Account;
};
const Workspace = createContext<ReturnType<
  typeof useLoad<WorkspaceData>
> | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const state = useLoad(
    async () => {
      const [cases, runs, runner, account] = await Promise.all([
        api<Case[]>("/cases?limit=100&offset=0"),
        api<{ items: RunSummary[]; next_offset: number | null }>(
          "/workspace/runs",
        ),
        api<Runner>("/runner"),
        api<Account>("/account"),
      ]);
      return {
        cases,
        runs: runs.items,
        moreCases: cases.length === 100,
        moreRuns: runs.next_offset !== null,
        runner,
        account,
      };
    },
    [],
    15000,
  );
  return <Workspace.Provider value={state}>{children}</Workspace.Provider>;
}
export function useWorkspace() {
  const value = useContext(Workspace);
  if (!value) throw new Error("Workspace provider missing");
  return value;
}
export const when = (value: string) => new Date(value).toLocaleString();
export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : "Request failed. Refresh before retrying.";
