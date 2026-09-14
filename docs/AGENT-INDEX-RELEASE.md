# Publishing Reach by Repro Relay

Checked September 14, 2026. This is a release plan, not a registration receipt. No listing, verification request or usage report was submitted while preparing it.

The proposed first chore is: receive meeting requests, organize concrete todos with owners and dates, and prepare one approved follow-up. Repro Relay provides the review workspace; Reach is the installable Hermes specialization. Start with a supplied transcript rather than promising that the agent joins video calls.

## Current blockers

| Requirement | What we have | What remains |
| --- | --- | --- |
| Working chore | Local call-request records, Reach proposals/todos and drafts | Run Hermes on a real request and demonstrate an approved useful output with a real user |
| Installable Hermes variant | Local Relay API and terminal tooling | Package the agent and validate the route to its workspace; the current root Dockerfile serves the guest web app |
| Public MIT agent source | Project MIT notice and original Reach code | Produce a clean release package excluding restricted UI source and credentials |
| Usage reporting | Relay's internal usage views | Install the official Agent Index reporter against the actual Hermes store and preserve its installation identity |
| Community listing | Public repository | Register the final package and installation guide |
| Verified listing | No verification receipt | Request review after a fresh installation and live run succeed |

The repository's own `THIRD_PARTY_NOTICES.md` identifies React Bits Pro source and PaceUI license restrictions. Those files are tracked. The root MIT notice does not resolve their redistribution terms. Release an independently usable agent package containing code/assets we can distribute, and resolve the existing repository's restricted files separately. Do not describe the entire existing source tree as exclusively MIT.

## Package the agent

Use a separate, clean `reach-hermes-agent` package/repository for the release. Keep the Relay desktop optional if possible. Any required Relay service must have an explicit installation and connection path; `127.0.0.1` inside a hosted container is not the owner's Mac.

The official base expects a variant's persona at `/opt/hermes/plow-seed/persona.md`, with skills in the supported seed locations. Pin the base to an immutable image reference. Let its initialization own the gateway and tenant credentials; keep credentials out of image layers. [Base image contract](https://github.com/plow-pbc/plow-hermes-agent#building-a-variant-image).

Keep only Reach-specific task behavior in the variant. Its core acceptance check should be one complete, repeatable user outcome. Do not include a large catalogue of unconnected tools in the submission.

## Report real usage

Use the official client, pinned and checksum-verified. Set `HERMES_HOME` to the running agent's actual persistent home. Persist the reporter identity with that home, and check `status` before registration. Run `--self-check` and `--dry-run` before enabling reports. Reports contain token totals by day/model, not transcripts. The Plow token identifies the installer's agent; never distribute the builder's credential. [Reporter instructions](https://github.com/plow-pbc/agent-index-client).

The current Life Assistant Dockerfile demonstrates a pinned reporter and supervised service. Its Compose file mounts `/var/lib/hermes` as a named volume. Check the chosen base revision rather than mixing runtime paths from different examples. [Reporter packaging example](https://github.com/plow-pbc/life-assistant-hermes-agent/blob/main/Dockerfile), [persistent home example](https://github.com/plow-pbc/life-assistant-hermes-agent/blob/main/compose.yml).

After the clean package, installer and live test exist, the registration command has this form. These are placeholders, not an existing Reach publication:

```sh
python3 agent_index_client.py --register \
  --agent reach-repro-relay \
  --name 'Reach by Repro Relay' \
  --blurb 'Turns meeting requests into owned todos and reviewable follow-up drafts.' \
  --runtime hermes \
  --repo 'https://github.com/YOUR-OWNER/YOUR-CLEAN-AGENT-REPO' \
  --install-url 'https://github.com/YOUR-OWNER/YOUR-CLEAN-AGENT-REPO/blob/main/README.md'
```

The final agent ID must be available or already owned by this publisher. Authenticate using the agent's runtime credential without placing it in shell history, chat or the repository. Registration publishes the supplied metadata. [Registration fields](https://github.com/plow-pbc/agent-index-client#use).

## Request verification and distribution

The Index's Community listing and Verified listing are separate. After registration and successful real installation, open the agent page and choose **Get my agent verified**. The hosts install and run verified agents. The Index directs builders to `danedelattre` on its Discord for one-click hosting. That step is coordinated with the Plow team; pushing GitHub code does not provision a cloud entry. [Official publishing flow](https://aiworthusing.com/agent-index).

Before that review, record the exact commit/image, a fresh installation, one consented meeting request, the resulting saved todos and draft, restart persistence, and actual Hermes usage in a reporter dry-run. If claiming message delivery, include the provider receipt from an explicitly approved recipient/body. A successful local unit test is not a live delivery receipt.
