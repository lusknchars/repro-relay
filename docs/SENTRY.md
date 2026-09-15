# Sentry connection and bug notifications

Sentry is a bring-your-own-account connection. The administrator configures it once in the local Relay installation; other people using that workspace can read the imported reports. Nothing is tied to the maintainer's Sentry organization or credentials.

In **Settings → Connections → Sentry**:

1. Enter your organization slug, select its data region, and enter a Sentry API token with `org:read` and `event:read`.
2. Click **Connect Sentry**. Relay checks organization access and lists up to 100 projects accessible to the token.
3. Select a project and its Relay project name, then click **Enable Sentry monitoring**. Relay checks event access before saving the connection.

The token stays in `.data/sentry/connection.json` on the backend host, with directory mode `0700` and file mode `0600` on Unix. It is never returned by the status API or saved in browser storage. Disconnect deletes that credential file while preserving imported work and alerts. Changing an account checks the replacement before replacing the existing connection. One Sentry project is monitored per installation in this version.

The default macOS/local flow uses API polling. It needs no public webhook receiver or Sentry OAuth application registration. A future OAuth distribution flow would require publisher-owned integration registration and per-user consent. This version supports Sentry Cloud's US, EU and global endpoints; it does not accept custom/self-hosted URLs.

## What appears in Relay

The backend checks every minute while running, including when the UI is closed. Each check reads the 20 most recently seen issues within 14 days and imports up to five changed events. This is a bounded recent-issue window, not a complete export or guaranteed delivery of every Sentry event. Failed checks back off for five minutes. Rate-limited checks also wait for the provider retry window, capped at 24 hours. Pause stops future checks; an in-flight check must finish before pause, disconnect or replacement is accepted. Settings shows the last successful check separately from saved credentials.

A first imported issue creates a Work record containing the provider report, release, environment, event identifier, source link, and bounded stack locations. User records, request bodies, headers, variable values and source-code context are excluded from the imported projection. Titles and file names can still contain application-specific information. The source link opens Sentry, not an application preview; reproduction prerequisites must be established before operating the target app.

Repeated imports reuse the same work record. Changes to the Sentry status, release or environment create a notification with a message preview. Event counts alone do not create more alerts. Notifications appear in **Monitoring**, and the top-bar bell shows their unread count. **Open investigation** opens the existing Work record; **Copy message** copies a draft without sending it. Read state belongs to the workspace and is retained in PostgreSQL. The UI displays the latest 100 notifications.

The original Work report/build/revision stays frozen when later Sentry data changes. The notification records the newer provider snapshot. Opening an older work record does not silently switch its approved context to the latest release. Sentry's resolved state never marks Relay work verified. Release metadata identifies the reported release, not a successful CI build or proof that the release caused a regression. Missing release/environment data is displayed as not reported.

Connecting does not automatically start Hermes, broaden its tools, edit code, or send Plow/Slack/SMS messages. Start investigation from Work using the existing runner and evidence requirements. External delivery continues to require the existing reviewed destination and exact message approval. The connector does not add stack-search MCP tools to Hermes; the initial report supplies bounded diagnostic context.

## Validation

The connection, invalid-token handling, import projection, issue deduplication, release/status alerts, pause/disconnect and original-work preservation are exercised with local HTTP fixtures and PostgreSQL tests. Browser tests exercise credential entry, project selection, persisted connection state, notification links and narrow layouts. These tests do not establish a live Sentry account connection or external message delivery.

## Provider references

- [List organization projects](https://docs.sentry.io/api/organizations/list-an-organizations-projects/): `org:read`, project enumeration.
- [List organization issues](https://docs.sentry.io/api/events/list-an-organizations-issues/): `event:read`, project filtering and recent issues.
- [Retrieve an issue event](https://docs.sentry.io/api/events/retrieve-an-issue-event/): `event:read`, supports the `latest` selector.
- [Sentry API domains](https://docs.sentry.io/api/): regional endpoints.
