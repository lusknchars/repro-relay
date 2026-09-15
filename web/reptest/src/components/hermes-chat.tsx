import { useRef, useState } from "react";
import { ArrowUp, Paperclip, ArrowUpRight } from "lucide-react";
import {
  api,
  useLoad,
  errorText,
  when,
  type Case,
  type Account,
} from "@/lib/live";
import { Button, Badge } from "@/components/ui";
import { IntegrationLogo } from "@/components/integration-logo";

type Conversation = {
  items: {
    id: string;
    author: string;
    body: string;
    created_at: string;
    reply: string | null;
    replied_at: string | null;
  }[];
  configured: boolean;
  connection: { connected: boolean | null; last_seen: string | null } | null;
};
export function HermesChat({
  account,
  desk = false,
  work,
}: {
  account: Account;
  desk?: boolean;
  work?: Case;
}) {
  const feed = useLoad(
    async () => {
      const result = await api<Conversation>("/chat");
      if (
        !Array.isArray(result.items) ||
        typeof result.configured !== "boolean"
      )
        throw new Error(
          "The agent conversation is unavailable. Retry when the workspace service is ready.",
        );
      return result;
    },
    [account.profile?.id],
    3000,
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<{ body: string; id: string }>();
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      feed.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="Hermes team conversation"
      data-glass-panel=""
      className={
        desk
          ? "team-chat team-chat--desk"
          : "team-chat grid gap-4 overflow-hidden rounded-[28px] border border-border"
      }
    >
      <header className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
        <div className="flex items-center gap-2">
          <IntegrationLogo provider="hermes" />
          <div>
            <h2 className="font-semibold">Talk to Hermes</h2>
            <p className="text-xs text-muted">Shared team conversation</p>
          </div>
        </div>
        <Badge>
          {feed.data?.connection?.connected
            ? "Agent connected"
            : feed.data?.configured
              ? "Waiting for agent"
              : "Agent not connected"}
        </Badge>
      </header>
      <p className="px-5 text-xs text-muted">
        One administrator-managed Hermes agent. This conversation is visible to
        everyone in the workspace. Requests do not approve code changes or
        external messages.
      </p>
      {(error || feed.error) && (
        <p role="alert" className="px-5 text-sm text-danger">
          {error || feed.error}
        </p>
      )}
      {notice && (
        <p role="status" className="px-5 text-sm text-muted">
          {notice}
        </p>
      )}
      {work && (
        <div className="team-linked-work">
          <div>
            <Paperclip size={12} /> Linked work record <code>{work.id}</code>
          </div>
          <strong>{work.title}</strong>
          <p>{work.description}</p>
          <footer>
            <Badge>{work.status.replace(/_/g, " ")}</Badge>
            <span>
              {work.build || "Build not recorded"} · revision {work.revision}
            </span>
            <a href={`/?case=${encodeURIComponent(work.id)}`}>
              Open in Work <ArrowUpRight size={12} />
            </a>
          </footer>
        </div>
      )}
      {feed.loading && !feed.data && (
        <p role="status" className="px-5 text-xs text-muted">
          Loading conversation…
        </p>
      )}
      {feed.error && (
        <Button className="self-start mx-4" onClick={feed.refresh}>
          Retry conversation
        </Button>
      )}
      <div
        className="team-message-history min-h-[240px] max-h-[480px] space-y-5 overflow-y-auto px-4 pb-2 sm:px-5"
        aria-label="Conversation history"
      >
        {!!feed.data?.items.length && (
          <p className="text-xs text-muted">
            Latest 20 requests and their replies
          </p>
        )}
        {!feed.loading && !feed.data?.items.length && (
          <p className="text-sm text-muted">
            Ask about your work or leave a request for Hermes.
          </p>
        )}
        {feed.data?.items.map((item) => (
          <article
            key={item.id}
            className="team-message-pair flex min-w-0 flex-col gap-4"
          >
            <div className="team-human-message ml-auto grid max-w-[90%] justify-items-end gap-1 sm:max-w-[80%]">
              <strong className="text-xs text-muted">
                <span className="team-message-avatar" aria-hidden>
                  {item.author.slice(0, 2).toUpperCase()}
                </span>
                {item.author}
              </strong>
              <p className="rounded-[20px] rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
                {item.body}
              </p>
              <time
                dateTime={item.created_at}
                className="text-[11px] text-muted"
              >
                {when(item.created_at)}
              </time>
            </div>
            {item.reply ? (
              <div className="team-agent-message mr-auto grid max-w-[90%] justify-items-start gap-1 sm:max-w-[80%]">
                <strong className="text-xs text-muted">
                  <span className="team-message-avatar" aria-hidden>
                    <IntegrationLogo provider="hermes" />
                  </span>
                  Hermes <Badge>Agent</Badge>
                </strong>
                <p className="rounded-[20px] rounded-bl-md bg-surface-2 px-4 py-2.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {item.reply}
                </p>
                {item.replied_at && (
                  <time
                    dateTime={item.replied_at}
                    className="text-[11px] text-muted"
                  >
                    {when(item.replied_at)}
                  </time>
                )}
              </div>
            ) : (
              <p className="text-right text-xs text-muted">
                Saved · waiting for Hermes
              </p>
            )}
          </article>
        ))}
      </div>
      {desk && (
        <div className="team-composer-tools">
          <button
            disabled={!work || busy}
            onClick={() => {
              if (!work) return;
              const draft = `${message}${message ? "\n\n" : ""}Work: ${work.title} (${work.id})\n/?case=${encodeURIComponent(work.id)}`;
              if (draft.length > 4000) {
                setError(
                  "Shorten your message before attaching this work reference (4,000 characters maximum).",
                );
                return;
              }
              setError("");
              setMessage(draft);
            }}
          >
            <Paperclip size={12} /> Attach work
          </button>
          <span>
            {work
              ? "Adds a work reference to your draft"
              : "Select work to attach its reference"}
          </span>
        </div>
      )}
      <form
        className="team-chat-composer flex items-end gap-3 border-t border-border px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void perform(async () => {
            const body = message.trim();
            if (!body) return;
            if (pending.current?.body !== body)
              pending.current = { body, id: crypto.randomUUID() };
            await api("/chat", "POST", pending.current);
            pending.current = undefined;
            setMessage("");
            setNotice("Message saved for Hermes.");
          });
        }}
      >
        <label className="min-w-0 flex-1 text-sm">
          <span className="sr-only">Message Hermes</span>
          <textarea
            id="team-message"
            className="block min-h-10 max-h-40 w-full resize-y rounded-xl border border-transparent bg-transparent px-2 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            rows={1}
            value={message}
            maxLength={4000}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (
                (e.metaKey || e.ctrlKey) &&
                e.key === "Enter" &&
                !e.nativeEvent.isComposing &&
                message.trim() &&
                !busy
              ) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="What would you like Hermes to help with?"
          />
        </label>
        <Button
          type="submit"
          variant="default"
          size="icon"
          aria-label="Send to Hermes"
          title="Send to Hermes"
          disabled={busy || !message.trim()}
          pending={busy}
          className="mb-1 flex-none"
        >
          {!busy && <ArrowUp className="h-4 w-4" aria-hidden />}
        </Button>
      </form>
      {desk && (
        <p className="team-composer-note">
          Messages go to the shared Hermes conversation. Sending does not
          approve a change or contact anyone outside this workspace. Ctrl/⌘ +
          Enter to send.
        </p>
      )}
      {account.role === "owner" && (
        <details className="mx-4 mb-4 rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Connect the workspace Hermes agent
          </summary>
          <div className="mt-3 grid gap-3 text-sm text-muted">
            <p>
              Run these from your local checkout, then add the second command as
              an MCP server in your administrator’s Hermes configuration.
            </p>
            <code className="break-all">./relay reach chat-connect</code>
            <code className="break-all">./relay reach chat-mcp</code>
            <p>
              The agent reads hermes_team_inbox and answers with
              hermes_team_reply. Connecting does not start a model. Model costs
              belong to the administrator’s configured provider.
            </p>
            {account.shared && (
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const connection = await api("/chat/bridge", "POST", {});
                    const url = URL.createObjectURL(
                      new Blob([JSON.stringify(connection)], {
                        type: "application/json",
                      }),
                    );
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "repro-relay-hermes-chat.json";
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                    setNotice(
                      "Private connection downloaded. This replaces the previous agent connection. Use chat-mcp --key-file with this file.",
                    );
                  })
                }
              >
                Download a new private agent connection
              </Button>
            )}
            {feed.data?.configured && (
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await api("/chat/bridge", "DELETE");
                    setNotice("Agent connection revoked.");
                  })
                }
              >
                Disconnect Hermes chat
              </Button>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
