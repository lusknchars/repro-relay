# Team workspace

Team combines a compact work directory, the shared Hermes conversation, and a collapsible context panel. It uses the same frontend in the browser and macOS app.

- Search and select a work record to inspect its status, build, revision and recorded observations. Selection survives refresh in the URL.
- **Attach work** adds a reference to the message draft. Nothing is sent until **Send to Hermes** or Command/Ctrl+Enter. Failed sends retain the draft and reuse the same request ID when retried unchanged.
- Every teammate talks to one administrator-managed Hermes agent. Work selection does not create a channel or filter the shared conversation. The feed displays the latest 20 requests and their replies.
- **Open in Work** and **Review work** open the original record. Sending a chat message does not approve a code change or external delivery.
- **Team settings** contains account, invitation, communication and contribution controls. The settings destination survives refresh. Only administrators can read the full member directory or manage the agent connection.
- Narrow windows expose separate conversation-list and context controls. The layout respects light/dark themes and reduced motion.

Evidence comes from saved case observations and retains its human author and classification. Agent replies come from the existing chat bridge. No unread counts, direct messages, independent verification, agent presence, or delivery receipts are synthesized.

## Validation

The Team browser test creates a case and observation in an isolated database, then uses a clearly labeled chat HTTP fixture to check context attachment, retries, keyboard sending, refresh persistence and narrow layouts. Existing account/invitation, communication and sidebar tests also exercise the new navigation. These checks do not send a real agent request or external message.
