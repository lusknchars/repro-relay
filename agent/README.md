# Repro Relay for Plow

Run Repro Relay as a Hermes agent on your own Plow line. Paste meeting notes or
send a todo. Reach saves action items with source quotes, owners and deadlines,
answers daily-work questions, and records completion reports across restarts.

This is the chat agent edition. The macOS application remains available from
[the main README](../README.md). This image has its own task store; desktop
synchronization, live call transcription, automatic reminders to all teammates
and verified repository fixes are not included in this edition.

## Install

From a copy of this repository, in its top folder:

```sh
./relay agent
```

It checks Docker, signs you in to Plow, selects a free assistant line, starts this agent, waits until Plow reports it configured, prints a first Hermes reply, and shows the number to text. Repeating it continues an interrupted install. It never takes a line that already answers as an agent, and never overwrites an existing credential.

Needs Docker Desktop running, Python 3, and the phone that owns the Plow account. The pinned upstream image is Linux amd64; Docker Desktop emulates it on Apple Silicon, so the first start downloads several GB.

```sh
./relay agent --line 2            # use a free line by list position, number or uid, without being asked
./relay agent status              # agent, line, Plow setup and reported usage
./relay agent test "prompt"       # one prompt, printed with its token usage
./relay agent stop                # stop it, keeping memory and identity
```

### The same steps by hand

The command wraps the official Plow client. To run the steps yourself, clone
[plow-agents](https://github.com/plow-pbc/plow-agents), then from `repro-relay/agent`:

```sh
python3 ../../plow-agents/bin/plow-agents login
python3 ../../plow-agents/bin/plow-agents lines
python3 ../../plow-agents/bin/plow-agents mint ln_xxx
docker compose up --build -d
docker compose logs -f agent
```

Select a **free** line from the list and replace `ln_xxx`. An occupied line already has an
agent: keep it running and use a different free line. With none, run `login --new-line`,
complete its phone confirmation, then run `lines` again.

Wait for `plow-init: configured` in the logs. Text the selected line:

> Meeting notes: Ana will review the export bug by September 18, 2026. Bruno
> will document setup by September 19, 2026. Save these tasks, then show Ana's work.

Reach returns saved task IDs. Send `Mark <task-id> done` and ask for open work
again. Completion here is your report, not an independently verified code fix.

The base runtime supplies Plow model access. Any provider charges and Latch
permissions are separate from installation. Latch connects to the account's own
Mac when available. Text notes directly for the first task; calendar, Sentry,
Mem0 and a Relay application server are not prerequisites.

## Usage reporting

This image includes the official Agent Index reporter. Every five minutes it
publishes this installation's daily token counts by model to AI Worth Using.
It sends no prompts, task titles, source quotes, files, phone numbers or costs.
Its random installation ID and report key persist in the named home volume.
The reporter registers this installation under `repro-relay` using your own Plow
authorization. It does not make you the publisher of someone else's listing.

The client establishes a baseline and can recover same-day Hermes session usage
when available. An idle agent may show measurement pending until it does work.
Do not repeatedly recreate volumes to increase install counts.

Check the client without posting a report:

```sh
docker compose exec --user hermes agent /opt/hermes/.venv/bin/python3 \
  /opt/plow/agent-index-client.py status
docker compose exec --user hermes agent /opt/hermes/.venv/bin/python3 \
  /opt/plow/agent-index-client.py --agent repro-relay --dry-run
```

The image contains reporting as part of its behavior. To run a private edition
without publication, build a separate image without the `agent-index` s6 service.
That edition does not satisfy the competition's usage-reporting requirement.

## Transport watchdog

The image also runs `transport-watchdog`, an s6 service that checks once a
minute that the agent can still receive messages. It reads the gateway's own
record of its Plow chat and email connections. When a connection has stopped
reporting for six minutes, it restarts only the gateway, at most once every ten
minutes. A restart that works is silent. After three restarts that do not bring
the connection back, it sends one text to the owner chat that `plow-init`
configures, over the same REST API the agent replies through, and stops
restarting until the connection returns.

It runs as root, because restarting a service needs s6's control files, and it
reads the agent token only to send that one text. The token goes only to
`https://` Plow, never through a proxy or a redirect, and is never logged.
Without a token or an owner chat it stands down. See what it has done:

```sh
docker compose logs agent | grep transport-watchdog:
```

To build without it, delete `image/s6-overlay/s6-rc.d/transport-watchdog`, its
entry in `image/s6-overlay/s6-rc.d/user/contents.d/`, its path in the
Dockerfile's `chmod` line, and the image check in `.github/workflows/agent.yml`.

## Restart and update

`docker compose down` stops the agent and preserves its memory and installation
identity. `docker compose up -d` starts it again. After pulling an update, use
`docker compose up --build -d`. Keep the same checkout directory or Compose
project name so the named volume remains the same.

`docker compose down -v` permanently deletes this install's tasks, Hermes
history and reporting identity. Use it only when intentionally removing data.
Credentials live in `agent/plow-credentials`, outside Git and the build context.
The bind mount refuses a missing file instead of silently creating a directory.
Never share that file or bake it into an image.

## Publisher and verification

[Publishing instructions](../docs/AGENT-INDEX.md) explain registration,
usage checks and the organizer's verification step. A listing or successful
image build alone is not verification or approval for hosted deployment.

Repro Relay's code and agent content are MIT licensed. Upstream Plow components
retain Apache-2.0 and other dependency licenses, included in `vendor/` and in
the base image. See [NOTICE](NOTICE).
