import { useState } from "react";
import { Button } from "@/components/ui";
import { api, errorText, useLoad } from "@/lib/live";

export function GoogleCalendarConnection() {
  const state = useLoad(
    () =>
      api<{
        configured: boolean;
        authorized: boolean;
        connecting: boolean;
        error?: string;
      }>("/connections/google-calendar"),
    [],
    3000,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function action(path: string) {
    setBusy(true);
    setError("");
    try {
      await api(`/connections/google-calendar/${path}`, "POST", {});
      state.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="grid gap-3 rounded-lg border border-border-strong p-4"
      aria-label="Google Calendar connection"
    >
      <h3 className="font-medium">Google Calendar</h3>
      <p className="text-sm text-muted">
        Bring your primary calendar’s titles and times into this local
        workspace. Everyone using this installation can see the events you load.
        Google events stay read-only.
      </p>
      <p role="status" className="text-sm">
        {state.loading && !state.data
          ? "Checking setup…"
          : state.data?.connecting
            ? "Finish authorization in your browser, then return here."
            : state.data?.authorized
              ? "Authorization saved · Load events in Calendar to check access."
              : "Not connected"}
      </p>
      {(error || state.error || state.data?.error) && (
        <p role="alert" className="text-sm text-danger">
          {error || state.error || state.data?.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !state.data?.configured || state.data.connecting}
          onClick={() => action("connect")}
        >
          {state.data?.authorized
            ? "Reconnect Google Calendar"
            : "Connect Google Calendar"}
        </Button>
        {state.data?.authorized && (
          <Button
            disabled={busy || state.data.connecting}
            onClick={() => action("disconnect")}
          >
            Disconnect Calendar
          </Button>
        )}
      </div>
      {!state.data?.configured && (
        <details className="text-sm">
          <summary className="cursor-pointer">
            Set up Google access once
          </summary>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-muted">
            <li>
              In Google Cloud, enable the Calendar API and create an OAuth
              client of type Desktop app.
            </li>
            <li>
              Add your Google account as a test user if the consent screen is in
              testing.
            </li>
            <li>
              Save the downloaded client JSON as{" "}
              <code className="break-all">
                .data/google-calendar/client.json
              </code>{" "}
              in the Relay repository.
            </li>
            <li>
              Return here and connect. Google opens its own secure consent
              screen.
            </li>
          </ol>
        </details>
      )}
      <p className="text-xs text-muted">
        Disconnect removes Relay’s local credential. You can also revoke access
        in your Google account. No event invitations or Google edits are sent.
      </p>
    </section>
  );
}
