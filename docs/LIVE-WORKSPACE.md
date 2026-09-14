# Connected workspace and Plow setup

September 14, 2026. The supplied Reptest frontend now uses the Rust/PostgreSQL API. This is a working local integration milestone, not a claim that every proposed product feature is production-ready.

## Working behavior

- Work reads persisted cases and attempts. Existing report context starts a bounded Hermes investigation without a second prompt form. Stop, reconciliation and run reviews use the existing backend contracts, revision checks and idempotency keys.
- Findings, source receipts, journal entries, repair plans and context snapshots come from their recorded endpoints. Test results retain their source environment. Imported local validation is identified separately from Hermes execution.
- Usage reads bounded workspace run summaries and charts provider-reported cost and input/output tokens. A run's cumulative snapshot is counted once. Unknown measurements remain unknown; local validation is excluded. Pi and Mem0 billing are not imported.
- Knowledge reads the current reviewed observations and can revoke them through the existing scoped API. It does not promote private notes.
- Team supports browser login, account creation, invitation acceptance and owner-created viewer invitations. Local invitation links are not worldwide sharing links. The desktop points account management to the browser.
- Settings reads runtime availability and the saved Mem0 preference. Plow has real Connect and Check actions. Copied Pi/provider commands never mark a provider connected.

The default list loads the most recent 100 cases and 100 run summaries and labels truncation. Evidence pages expose a next cursor. There are no invented case records, chat participants, balances, successful connection tests or test receipts in the rendered application. Existing database demonstration records keep their original labels and provenance.

## Alder on this installation

The owner completed official Plow account and new-line activation. Plow named the resulting line **Alder**. Its line credential is stored privately in ignored `.data/plow-credentials`; `.data/plow/bridge.json` binds the authorized owner chat. Both files are outside Git.

The actual bridge doctor and the default frontend's Check Plow connection action verified the grant and advertised Latch endpoint. This check did not send a message or execute a Mac action. The local Hermes probe remains unavailable until its dedicated runtime and provider authentication are configured. Pi authentication does not establish Hermes authentication.

## Repeatable setup for another desktop user

Install the pinned official Plow CLI using `integrations/plow/README.md`, then run from the Relay checkout:

```sh
# Reuse an existing assistant line
python3 integrations/plow/connect.py --login

# Or explicitly provision a new line
python3 integrations/plow/connect.py --login --new-line
```

The official tool prints a current code and destination for ownership verification. After confirmation, the helper selects the account's sole line, checks its credential identity and exact owner-chat grant, and writes the bridge configuration. It never replaces another agent on an occupied line. Multiple lines require explicit `--line LINE_ID` selection. An existing configuration bound to a different chat is preserved.

An already-authorized installation can use **Settings → Plow + Latch → Connect authorized Plow account**. The backend runs only the fixed local helper; it does not accept shell commands, paths, tokens or arbitrary provider URLs from the browser. Connection operations are serialized, time-bounded and return an allowlisted receipt. Hosted and guest installations cannot operate this local setup endpoint. Set `REPRO_RELAY_ROOT` to the checkout if the API binary is relocated.

Connection and verification do not enable automatic phone import or message delivery. Existing bridge commands still register/enable a project source, import a selected owner report and deliver only an explicitly approved message. That distinction must remain visible.

## What a worldwide self-service release still needs

The next onboarding increment should package the pinned CLI with the desktop runtime, bring the official ownership challenge into an in-app flow, and offer account/line selection without terminal commands. It must reconcile interrupted provisioning rather than create another line, keep credentials in the OS credential store, distinguish account/line/chat/Mac/runtime health, and offer disconnect/revoke controls.

Hosted team support needs per-workspace credential ownership and server-side authorization, a managed inbound channel worker, durable delivery receipts, retry/reconciliation, service lifecycle and an install/update path. Do not reuse the maintainer's local credential across customers. Validate supported phone regions and the actual provider enrollment result rather than promising universal availability.

Before calling the complete product production-ready, exercise a real authorized phone report through an authenticated Hermes run, preserved evidence, reviewed repair and protected tests in an isolated worktree, then an approved owner update. Add deployment backups, migration recovery, monitoring, provider budgets and Windows/Edge validation. The current connection and browser-fixture tests do not establish that full external workflow.
