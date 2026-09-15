# Plow one-click deployment benchmark

Checked September 15, 2026 against public first-party sources. This is a packaging comparison, not evidence of a deployed Repro integration.

## What makes hosting one-click

The Agent Index explicitly directs builders to coordinate with the Plow team through `danedelattre` on its Discord to enable one-click deployment. Registering a community entry does not enable hosting. The client supports an HTTPS `--install-url` for community installation instructions. [Agent Index](https://aiworthusing.com/agent-index), [client registration](https://github.com/plow-pbc/agent-index-client#use)

Plow's private `plow-pbc/plow` repository owns `api/cloud-agents/agents.json` and the image publishing workflow. That registry selects the revision tenants boot; publishing an image alone does not select it. The shared OCI image runs `/init` under s6 in either a Docker container or an exe.dev VM. The provisioner supplies the tenant credential file. These public descriptions establish the hosting architecture, but do not expose the current registry schema, admission process, or exact deploy-button request. [Base runtime and publishing](https://github.com/plow-pbc/plow-hermes-agent#publishing)

The deprecated `agent-mgr` documents cloud creation through Plow's API with a provider and line UID. Creation normally returns `provisioning`, followed by polling until `running`, `failed`, or `teardown`. It explicitly says it does not contact exe.dev or handle cloud tenant credentials. Its local fleet commands are separate. Treat it as evidence of the lifecycle, not the preferred new installer. [Cloud assistants](https://github.com/plow-pbc/agent-mgr#cloud-assistants)

## What the public Life Assistant package contains

| Piece | Observed behavior |
| --- | --- |
| Dockerfile | Inherits the Plow base by immutable commit tag and SHA-256 digest; adds its persona, skills, supervised jobs, and pinned reporter client. |
| Compose | Builds the checkout, mounts `./plow-credentials` read-only at `/var/lib/plow/credentials.host`, persists `/var/lib/hermes` in a named volume, and allows 35 seconds to stop. |
| Skill installation | Copies skill sources under `/opt/hermes/skills`; the base reconciles these into the persisted home. |
| Persona | Adds `/opt/hermes/plow-seed/persona.md`; boot composes the home's `SOUL.md` from base plus variant persona. |

Sources: [Life Dockerfile](https://github.com/plow-pbc/life-assistant-hermes-agent/blob/main/Dockerfile), [Life Compose](https://github.com/plow-pbc/life-assistant-hermes-agent/blob/main/compose.yml).

The current Life Compose has no `AGENT_ID` environment setting. Copying it unchanged therefore misses a required reporter input. The official quickstart says to set the registered ID under the agent service's `environment`. [Compose](https://github.com/plow-pbc/life-assistant-hermes-agent/blob/main/compose.yml), [leaderboard quickstart](https://github.com/plow-pbc/plow-agents#leaderboard)

## Activation and tenant boundary

Local bring-up uses `plow-agents login`, the account owner's texted activation phrase, `lines`, then `mint <free-line-uid>` before Compose starts. Login establishes the account; mint writes the agent credential. The CLI requires Python 3, Git and Docker Compose. A credential file must stay out of Git and the image build context. [Official quickstart](https://github.com/plow-pbc/plow-agents#quickstart)

The phone sending the activation code determines account ownership. The Life README describes activation as an unauthenticated request with `name` and `provision_chat`; a different person texting the code binds a different account. First chat onboarding follows runtime startup. One owner gets one agent home; sharing that home across gateways shares credentials and sessions. Host root can access the credential and therefore the owner's mailbox authority. [Life account boundary and operator access](https://github.com/plow-pbc/life-assistant-hermes-agent#the-account-boundary--how-one-repo-serves-two-people)

The runtime accepts a root-owned credential file at mode `0600` or `0400`, with `PLOW_API_BASE`, `PLOW_AGENT_TOKEN`, and optional `AGENT_ID`. Local mounts are promoted into that protected file. Boot asks `/v1/agents/cloud/me` for identity and selects exactly one owner DM on the agent's line; invalid credentials or ambiguous identity prevent gateway startup. The hosted provisioner supplies `AGENT_ID` for reporting variants. [Credential contract](https://github.com/plow-pbc/plow-hermes-agent#the-credential-drop-in)

## Reporter and seeding details

The Life service reports every 300 seconds and stands down without `AGENT_ID`. It asks the client's `status` command whether registration exists; unreadable state is not treated as a new install. Registration uses the Plow token, while subsequent reporting uses the client's saved report key. [Reporter implementation](https://github.com/plow-pbc/life-assistant-hermes-agent/blob/main/image/s6-overlay/s6-rc.d/agent-index/run)

The client exchanges the agent token for a short-lived Plow assertion, then an Index `aik_` report key. Usage reports contain day-by-model token counts. Page registration and stories publish separately supplied content. Preserve the install ID and report key at `<HERMES_HOME>/.agent-index.json`, and point `HERMES_HOME` at the actual store; a configured missing `state.db` fails reporting. The client README still has an old `/opt/data` packaging example. The current Life runtime uses `/var/lib/hermes`. [Client](https://github.com/plow-pbc/agent-index-client), [current reporter](https://github.com/plow-pbc/life-assistant-hermes-agent/blob/main/image/s6-overlay/s6-rc.d/agent-index/run)

Bundled skills update when the agent has not customized them; recorded deletions remain deleted. Persona changes apply on boot. Do not prescribe deleting a home volume merely to ship updated content. [Runtime seeding](https://github.com/plow-pbc/plow-hermes-agent#what-is-in-the-image), [Life rebuild instructions](https://github.com/plow-pbc/life-assistant-hermes-agent#run-locally)

## Recommended Connect Repro flow

The following is a proposed Repro flow based on the benchmark and the parent agent's local code inspection, not existing functionality.

1. `Connect Repro` selects or creates the team's Repro workspace and starts the official Plow account activation when needed. The owner texts the issued phrase.
2. Choose a free line or preserve the existing Repro binding. Provision the whole package: the Repro application and database, the Repro Hermes variant, and the adapter that lets Repro submit and track runs.
3. The host supplies credentials and workspace configuration outside image layers, assigns a separate persisted Hermes home, and starts the services.
4. Verify the owner chat, Repro workspace binding, runner capabilities, and a complete run before showing `Connected`. A successful Hermes chat gateway boot alone proves neither `/v1/capabilities` nor `/v1/runs` works.
5. Start first-chat onboarding for shared team context. Keep Index publication and reporter identity tied to the reviewed agent package.

Local comparison supplied by the parent agent: `compose.local.yaml` starts only app and database; `integrations/plow/connect.py` wraps login, mint and owner-chat binding, preserving occupied lines and existing credentials. It does not provision Hermes. The existing `docs/AGENT-INDEX-RELEASE.md` already proposes a separate variant and hosting coordination, but its previous product naming needs review against the current shared-team-context intent.

## Remaining blockers

- A public Dockerfile, skill upload, or Index entry cannot by itself deliver hosted Repro. The package needs an executable integration contract for Repro, its database, Hermes and the run adapter, including where each service lives.
- Plow must confirm how it admits the Repro variant and associates it with the deploy action. Public sources do not establish whether its hosting accepts Repro's app and database alongside the agent, or requires Repro to host them separately.
- A fresh tenant activation and end-to-end run still need verification. No sign-in, registration, cloud creation, deployment, or external message was performed for this research.
