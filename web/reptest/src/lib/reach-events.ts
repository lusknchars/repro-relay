import { useEffect, useState } from "react";
import { api } from "@/lib/live";

type Batch = { items: unknown[]; cursor: string; has_more: boolean };

/** Poll committed notifications without holding a connection or starting a model. */
export function useReachEvents(refresh: () => void) {
  const [state, setState] = useState("Connecting to updates…");
  useEffect(() => {
    let stopped = false;
    let cursor = "0";
    let retry = 2000;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 2000;
      try {
        const batch = await api<Batch>(`/reach/events?after=${cursor}`);
        if (stopped) return;
        cursor = batch.cursor;
        if (batch.items.length) refresh();
        setState("Listening for todo and meeting updates");
        retry = 2000;
        if (batch.has_more) delay = 0;
      } catch {
        if (stopped) return;
        setState("Updates disconnected · retrying");
        delay = retry;
        retry = Math.min(retry * 2, 30000);
      }
      if (!stopped) timer = setTimeout(poll, delay);
    }
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);
  return state;
}
