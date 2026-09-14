# Phone sign-in

Phone sign-in is optional. The current app opens local work without login and accepts teammates through name-only invitation links. Twilio is not needed for those paths. See [local access and Hermes chat](LOCAL-ACCESS-AND-CHAT.md).

Open Account in the top-right corner. The first field is Phone number. After a valid text-message code, existing phone accounts sign in immediately; a new account asks for a display name. New teammates also need the workspace invitation. The first owner must be created on the local installation, as before.

## Connect SMS once

The installation owner configures [Twilio Verify](https://www.twilio.com/docs/verify/api/verification). Users do not create Twilio accounts or configure keys.

1. Create a Verify service in the Twilio Console and enable SMS. Set the service's friendly name to Repro Relay. Configure the countries your users need and the provider's fraud controls. Trial accounts restrict which numbers can receive messages.
2. Copy the Account SID, Auth Token and Verify Service SID into the server's private `.env` file:

   ```dotenv
   RELAY_TWILIO_ACCOUNT_SID=AC...
   RELAY_TWILIO_AUTH_TOKEN=...
   RELAY_TWILIO_VERIFY_SERVICE_SID=VA...
   ```

3. Restart the Relay API with these environment variables. `./relay setup` reads the private `.env` file when starting a service; an already running service needs to be stopped and restarted. Direct Cargo/API invocations read process environment only.
4. Open Account again. Enter an international number, request a code, and verify it. SMS charges and country availability belong to the configured Twilio account. A real delivery test is needed to confirm provider readiness.

Without server credentials the number field remains visible, and Relay explains the missing SMS connection. It does not show a sent code or create a fake session. Plow's assistant line and its owner activation are separate from Relay account authentication.

## Existing accounts and team access

Existing username/password accounts remain available through “Use an existing username account”. They are not automatically merged with phone accounts based on a display name or a communication-profile number. Linking a verified phone to an existing password account is not implemented in this version; keep that account's current sign-in method. Phone-only accounts use SMS, not a generated password.

A verified number proves control of that number. It does not grant owner access to an existing team or subscribe anyone to Reach messages. Invitations grant viewer membership, using the existing single-use invitation mechanism. Local mode remains a trusted single-machine workspace; account creation alone does not convert it into a remote authenticated deployment. Remote team access still needs the configured HTTPS team deployment.

## Implementation and validation boundaries

The Rust API calls the fixed Twilio Verify HTTPS endpoint with a bounded timeout and no redirects. It accepts only international-format numbers, waits at least 60 seconds between sends, allows at most three send reservations per number in ten minutes, applies installation-wide per-minute limits, and permits five code attempts per challenge. The verification provider manages code generation and checking.

Challenge bearer tokens are random, stored only as hashes in PostgreSQL, and expire after ten minutes. Verified proofs create an account/session atomically and become consumed. A repeated check can recover its already-verified state without another provider request. A consumed completion cannot create another session. Challenge state stays in UI memory, not localStorage. The macOS client routes account operations through the native bridge and stores the resulting session in its existing secure session store.

Phone numbers remain in the private account/challenge tables and the authenticated user's own profile response; member lists do not disclose them. Expired challenges are purged when a new verification starts. Provider errors are summarized without forwarding their bodies. Account endpoints remain excluded from the operational request console.

Tests use a local HTTP Verify fixture and isolated PostgreSQL databases. They prove code rejection, attempt/expiry limits, one-time completion, existing-phone login and invitation restrictions. They do not prove live SMS delivery, phone-number recovery, or provider fraud protection configuration. Recycled-number recovery and a second account recovery method remain future work.

## Interface reference

The actual PaceUI registry entries `marketing-login-4` and `marketing-two-factor-authentication-4` were retrieved using the configured registry credential and inspected on September 14, 2026. Their centered form, short heading, outlined inputs, single primary action and divided secondary footer informed the account composition. Relay retains its supplied theme and implements its own phone state/validation and native transport. No raw commercial registry source was added to the public repository.

Sources: [PaceUI sign-in blocks](https://paceui.com/blocks/marketing/login), [PaceUI code verification blocks](https://paceui.com/blocks/marketing/two-factor-authentication), [Twilio verification checks](https://www.twilio.com/docs/verify/api/verification-check).
