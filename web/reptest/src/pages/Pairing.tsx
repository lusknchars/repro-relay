import { api, useLoad } from "@/lib/live";

type State = { status: string; code?: string; name?: string };
type History = {
  name: string;
  messages: { direction: string; body: string; created_at: string }[];
  artifacts: { kind: string; title: string; body: string; created_at: string }[];
};

export function PairingPage() {
  const state = useLoad(() => api<State>("/pair/state"), [], 3000);
  const signedIn = state.data?.status === "signed_in";
  const history = useLoad(
    () => (signedIn ? api<History>("/conversations/me") : Promise.resolve(undefined)),
    [signedIn],
  );
  async function start() {
    await api("/pair/start", "POST", {});
    state.refresh();
  }
  return (
    <section className="grid gap-4 p-4" aria-label="Pairing">
      {state.data?.status === "pending" && (
        <p className="text-lg font-semibold">{state.data.code}</p>
      )}
      {state.data?.status === "unpaired" && (
        <button onClick={start}>Get a code</button>
      )}
      {signedIn && (
        <ul className="grid gap-2">
          {history.data?.messages?.map((m) => (
            <li key={m.created_at + m.body}>{m.body}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
