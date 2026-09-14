# Accounts and returning to shared work

Relay supports one shared team per installation. Accounts attach to the existing local workspace, preserving cases, investigation results and saved audits. The temporary hosted guest beta continues to isolate each guest workspace.

## Create the owner account

1. Start the trusted local installation with `make dev`.
2. Open `http://127.0.0.1:5178`, then the profile icon at the top right and **Create account**.
3. Choose your display name, username and password. The first account becomes the owner. Additional accounts require invitations.

Use 3–40 ASCII letters, numbers, underscores or hyphens for the username and 15–128 characters for the password. Usernames are case insensitive. Use **My profile** in the menu to edit your display name and short description. **Password & security** opens password settings. There is no email field or email verification.

The top-right account button opens a centered sign-in chooser inside the app. Choose Sign in to Relay, or Create account for the first owner. Later users choose Join your team and supply an invitation link. The Team page retains membership and invitation controls. Opening or closing the account dialog preserves the selected work view.

Desktop account requests go through a native, loopback-only HTTP client. Its strict route allowlist covers account and team operations. Session cookies stay in Rust and never enter renderer storage; on macOS the session is saved in Keychain. If secure storage is unavailable, sign-in lasts for that app process and the interface says so. Other desktop platforms currently use this session-only fallback. Passwords are not persisted by the desktop client. Sign-out revokes the server session and clears the saved session. The web client continues using HttpOnly cookies on its own origin.

Run `./relay setup` from a source checkout to build and open the local app. `--check` checks prerequisites; `--web` serves the web interface and API on the same local address. No provider keys are needed to create a Relay account. Relay sign-in is separate from Plow phone ownership, Pi provider authentication, and Mem0 access. Google, GitHub and organization SSO are not implemented and are not presented as working choices.

The native desktop still connects to its local API. Remote team sign-in requires a hosted web deployment. Local mode remains a trusted-machine workspace; creating a profile does not turn loopback development APIs into a public multi-user service.

Local mode trusts access from this computer. Signing out of a profile does not lock the local workspace. Use authenticated team mode before exposing the service to another computer.

## Invite a teammate

Open the case or saved audit you want to share, then the profile icon at the top right and **Team & invitations → Create invitation link → Copy invitation**. Share the link yourself. Relay does not send email or a Plow message from this control.

An invitation lasts 24 hours and admits one account. A teammate can create an account or sign in, accept the invitation, and reopen the selected case or audit. Once joined, they can bookmark that view and return after signing in again. The invitation secret is carried in a URL fragment and removed by navigation after acceptance. The server retains only its hash; the owner cannot recover the original link from invitation history.

Invited teammates are viewers. They can inspect all saved work in this installation, including case evidence, investigation context and session history. The selected destination does not restrict membership to one case. They cannot start Hermes, change a case, approve a repair, change monitoring, or invite others. The server rejects these writes even if a caller bypasses the interface. The owner retains execution and team-management controls.

The owner can revoke a pending invitation or remove a viewer. Removal ends existing sign-ins and revokes invitations that account already accepted. A new invitation is required to rejoin. Changing your password ends all your sign-ins, including the current one.

## Enable sharing on a server

First create the owner account through trusted local access to the database you will serve. Then run the built frontend and API behind an HTTPS reverse proxy, using that same database:

```sh
REPRO_MODE=team \
PUBLIC_ORIGIN=https://relay.example.com \
DATABASE_URL="$RELAY_TEAM_DATABASE_URL" \
./target/release/relay-api
```

Replace the example origin and supply the database secret privately. Build the binary with `cargo build --release -p relay-api` and the frontend with `npm run build --prefix web`. The API serves `web/dist`; start it from the repository root. Configure the proxy to preserve the public Host header and serve the frontend and `/api/v1` under the same origin. Team mode binds the hosted listener and refuses startup if the database has no owner. HTTPS is required except for loopback integration tests.

Configure the existing backend-only `REPRO_HERMES_URL` and `REPRO_HERMES_KEY` if that server should execute Hermes work. Owner membership does not supply a provider login or implement a missing repair capability. The dedicated local setup is documented in [Hermes assessment](../integrations/hermes-assessment/README.md).

Generate invitations after switching to team mode so their URLs use `PUBLIC_ORIGIN`. A link created in local mode points to that local browser origin and works only on the same computer. This milestone does not deploy a shared server, configure a domain, or establish access from another device.

## Authentication behavior and limits

Passwords use Argon2id with a random salt. Sessions and invitation secrets are random opaque values; the database stores their SHA-256 hashes. Sign-in cookies are HttpOnly and SameSite=Lax, with Secure and the `__Host-` prefix on HTTPS. Sessions expire after seven days. Account mutations require the application's Origin header. Registration, login, invitation creation and password changes have database-backed rate limits.

Account creation, sign-in, password changes, invitation creation/acceptance/revocation and member removal append database audit events in the same transaction as the corresponding change. Events record actor, action, subject and timestamp without passwords or invitation secrets. They are available to the database operator; an audit-log interface is not included.

This is an initial account system for a single team. Password recovery, MFA, SSO, owner transfer and multiple independent teams are not implemented. Keep the owner password in a password manager and back up the database. Existing human observation author labels are unchanged; profiles do not authenticate historical evidence. Server access logs and runtime credentials still need the operator's normal controls. No production security certification is claimed.

The implementation uses the [RustCrypto Argon2 API](https://docs.rs/argon2/latest/argon2/) and follows the relevant guidance in the OWASP [password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) and [session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html) references.

## Validation scope

PostgreSQL integration tests cover first-owner restrictions, password hashing, session expiry, invitation claim races, single-account acceptance, revocation, profile persistence, password changes, workspace isolation and viewer write denial. Browser fixtures cover owner setup, profile editing, invitation destination, invited sign-up, returning to a saved case, viewer controls, dialog focus and phone-width layout. Fixtures are separate from real account creation. No personal account is created by the test suite.

Cross-device HTTPS sharing, native account-link interaction, Windows/Edge and screen-reader operation require separate execution. Hermes provider authorization remains separate from Relay account creation.
