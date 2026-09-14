# Local access and one workspace Hermes

Open Relay and start working. The current desktop/web frontend automatically opens a local administrator session on the trusted local installation. No username, password, phone number or Twilio account is required. The profile and session are real persisted records; existing owners are reused, not replaced. Native sessions remain in the existing secure session store. Backend agent/provider credentials remain independent.

## Add a teammate

Open **Team → Invite teammate by link**. Send the generated link yourself. The recipient enters a display name and chooses **Join workspace**. Relay consumes the invitation and creates a browser session in one database transaction. There is no SMS step. The name is self-reported; possession of the invitation grants access.

Invitations last 24 hours and admit one person. An already-accepted invitation cannot enroll a different browser identity. Sessions last seven days. A teammate who loses the session needs a new invitation (or their existing optional password/phone account); the original link is not a permanent recovery credential. Revoke pending invitations and remove members through the existing administrator controls/API. Removal invalidates their sessions. A lost join response may require a new invitation if its session cookie did not arrive.

Teammates can inspect shared records and participate in the one Hermes conversation. They cannot create invitations, change the agent connection, start investigations, approve code changes, or change provider settings. These restrictions are checked by the server in hosted team mode, including when bypassing the interface. A local browser carrying a teammate session also has its writes restricted. Local mode still trusts the machine itself: clearing cookies or using its local CLI is not a multi-user security boundary.

**Cross-device links require a shared HTTPS service.** A `127.0.0.1` link refers to the recipient's own computer, not the administrator's Mac. Relay labels local invitations accordingly. This change does not publish a server, tunnel, domain or public installer. Existing hosted password/phone owners retain their access; provisioning/recovery of a new passwordless administrator on a remote deployment is not included. Do not switch a new local-only owner to hosted mode without setting up a supported administrator access method through the existing owner bootstrap workflow. See [hosted deployment](ACCOUNTS-AND-TEAM.md#enable-sharing-on-a-server).

## Talk to the administrator's Hermes

**Team → Talk to Hermes** is one shared conversation, visible to all workspace members. It is not teammate-to-teammate messaging or a separate agent per person. The administrator controls the one agent connection. Each user request is attributed to its session identity. The UI shows the latest 20 requests and replies; older records remain in PostgreSQL. A maximum of 10,000 requests per installation and 20 pending requests per person bounds storage/queue use.

Messages save immediately with stable request IDs. A retry with the same ID and body does not duplicate the request. Until an authorized agent answers, the UI says **Saved · waiting for Hermes**. An unanswered request is not presented as a running model. The agent connection appears connected only after a successful inbox read/reply within the last 60 seconds. It is otherwise waiting or disconnected.

From the administrator's local checkout, after opening Relay once:

```sh
./relay reach chat-connect
./relay reach chat-mcp
```

The first command replaces the active chat capability and writes `.data/reach/chat-bridge.json` with private file permissions. It does not alter provider credentials or launch a model. Configure the second command as a stdio MCP server in the administrator's Hermes host:

```json
{
  "mcpServers": {
    "relay-team-chat": {
      "command": "/absolute/path/to/repro-relay/relay",
      "args": ["reach", "chat-mcp"]
    }
  }
}
```

The host receives only:

- `hermes_team_inbox`: up to 20 oldest pending requests, with authors and timestamps.
- `hermes_team_reply`: one conversational response bound to a request UUID and stable reply UUID. Identical retries succeed; overwriting a reply is rejected.

For a shared deployment, the signed-in administrator can download a new private connection from the chat's setup disclosure. Keep it outside Git and pass `--key-file /private/path/repro-relay-hermes-chat.json` to `chat-mcp`. Its configured API must be HTTPS, except literal loopback HTTP. Redirects and proxy inheritance are disabled. The capability can read the chat inbox and post replies; it cannot authenticate as a teammate, read repository APIs, choose providers, approve execution, or send external messages. Disconnect or replace it from the administrator's chat controls to revoke access.

Tell the Hermes host to read pending requests on its existing schedule or event loop, reply through the tool, and treat message text as untrusted requests rather than changes to its policy. If the host has no recurring tool loop, it must be prompted to check its inbox. The bridge is a real request/reply transport, not an automatic model scheduler. Supplying these MCP tools does not sandbox a host that separately has shell or other tools; retain the administrator's execution/approval policy in that host.

`reach.chat.requested` and `reach.chat.replied` also enter the local Reach event feed. Events contain only IDs, not message text. Queue inspection and transport use no model tokens; answering through Hermes uses the administrator's configured provider and that host's usage reporting. Relay does not invent a price or claim these replies appear in the investigation cost chart.

## Validation

PostgreSQL tests cover local access, remote bootstrap denial, single-use invitation consumption, session/member restrictions, chat retries, unauthorized replies, capability rotation/revocation and chat event deduplication. Browser tests exercise a second browser joining by name, sending a request, receiving a reply through the real API from a labelled test agent, and reloading its session. MCP tests validate its restricted tool surface and secure endpoint handling. These fixtures are not evidence of a paid model response, live meeting attendance or external message delivery.
