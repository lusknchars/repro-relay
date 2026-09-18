# Hosted agents

You run this. Somebody else gets an agent and a phone number, and installs nothing.

Each person gets their own container on this machine, their own Plow agent credential, their
own Plow line and their own memory volume. They text the number. That is the whole thing they
have to do. It is the shortest first run available to somebody on Windows, who cannot have the
tools that reach their own computer whatever we do, because those run through Plow Latch and
Latch is a Mac application. See [the design](../docs/superpowers/specs/2026-09-18-hosted-agents-design.md)
for why that limit does not move, and [Windows](../docs/WINDOWS.md) for what it means for them.

## This spends your money

`./relay hosted create` mints a real Plow agent and claims a real Plow line on your own
Plow account, using your own sign in. Every agent you create costs what that line and its
model usage costs, and it keeps costing it until you retire the line yourself. Removing an
agent here does not release its line. The removal tells you the line and the command that
retires it.

There is no signup. You add people by hand, one at a time, because you are paying. The design
makes that a gate: signup does not open until a per user spending cap exists and has been shown
to stop an agent that reaches it.

## What the operator runs

```
./relay hosted create dana --name "Dana Whitfield"
./relay hosted list
./relay hosted status dana
./relay hosted stop dana
./relay hosted start dana
./relay hosted remove dana --confirm dana
```

`dana` is the identifier. It names the person's folder, their Docker Compose project and their
memory volume, so it has to be lowercase letters, digits and dashes, at most 32 characters. Give
it anything else and the command refuses and tells you the identifier to use instead. It does not
rename the person quietly, because then you would hand over one name and this machine would hold
another.

`create` picks the free line when there is one. When there are several it stops and lists them,
and you name one with `--line`. `--new-line` asks Plow to provision one. Creating the same person
twice mints nothing: it says what already exists and stops.

`create` signs you in to Plow when it has to, and takes that sign in off this machine again when
it finishes, exactly as the installer does, so an account token does not sit here between runs. It
only ever removes a sign in it created itself. If you are creating several agents in a row, run
`plow-agents login` yourself first. Every create then reuses that sign in and none of them removes
it.

`stop` keeps everything: the line, the credential and the memory volume. `start` brings that same
agent back on the line it already has. Stopping is meant to be undone, which is why `start` exists
at all: without it the only way back would be to remove the person and create them again, and that
would mint and bill a second line.

`remove` deletes that person's container, their memory volume and their folder, including their
credential. None of it comes back. It refuses until you repeat the identifier with `--confirm`,
and before that it names the volume and the folder it would delete.

A decision you have to make exits 2. A failure exits 1.

## What it reports, and what it does not claim

The registry at `.data/hosted/registry.json` records what this tool did: who, which line, which
project, which folder, which volume, and when. It holds no token, and it holds no state that
could go stale, so it can never say an agent is running.

Every statement about a container comes from asking Docker at that moment. `list` and `status`
say what Docker reports and name every place the record and Docker disagree: a record with no
container, a container running from another folder, a missing memory volume, a hosted container
Docker has that this machine has no record of. Reconciling them silently is the failure this
product exists to avoid. `list` asks Docker even when the registry is empty, because an empty
registry is when it is most likely to be wrong.

A record is not authority either. The folder, the project and the volume in it are derived again
from the identifier before anything is stopped or deleted, and a record that does not match is
refused rather than obeyed. Nothing hands a path out of a file to `rmtree` or a volume name out of
a file to `docker volume rm`.

Before running Compose in a person's folder, every command checks that Compose resolves the project
it expects there. `COMPOSE_PROJECT_NAME` in your shell beats the one written in that folder, so
without that check a `stop` or a `remove` would reach whatever your shell names.

## Limits

Every hosted container is limited from the first one, so one person's loop cannot take the
machine down for everybody else's. The limits live in one place, `LIMITS` in `orchestrator.py`,
and are written into each person's `compose.yml`:

| Limit | Value | Why |
| --- | --- | --- |
| CPU | 1 | Enough for a gateway that spends its time waiting on a model. |
| Memory | 2 GiB | Above what the image needs, below what a leak needs to hurt the host. |
| Swap | pinned to the memory limit | So a container cannot escape its memory limit into swap. |
| Processes | 512 | Far above a normal process tree, far below a fork loop. |
| Privileged | never | Written out rather than left to the default, so the file says so. |
| Log | 10 MB, 3 files | A chatty loop filling the disk is the same failure by another route. |

There is no disk quota on the memory volume. Docker named volumes have no per volume size limit
on Docker Desktop, so this does not pretend to set one.

After starting a container, `create` asks Docker what that container actually got and prints it.
`status` prints the same. If Docker reports no limit where the file asks for one, or reports the
container as privileged, it says so rather than repeating what the file asked for. Do not read the
table above as evidence: read what `status` prints.

## What this does not do yet

- **No shell, no browser, no filesystem tools.** A hosted agent chats and keeps its own memory
  and tasks. It cannot run a command, read a file or open a page. That is milestone 2, and it is
  deliberately absent rather than half present: a shell reachable by people we have not met is the
  riskiest part of the whole design and it needs its own sandbox, its own egress limits and its own
  work. There is no setting here that turns one on.
- **No Latch.** A hosted agent cannot read a file on anybody's own computer, on Windows or on a
  Mac. Hosting moves the agent further from their laptop, not closer.
- **No signup.** See above. You add people by hand.
- **No spending cap.** Nothing here stops one agent from spending. Watch what you create.
- **No proof that the limits hold.** They are written into the compose file and read back out of
  Docker, and the reading is what you should trust.

## Where things live

| Path | What |
| --- | --- |
| `.data/hosted/registry.json` | The record of who has an agent here. Owner only. |
| `.data/hosted/agents/<person>/` | That person's folder: their compose file, their project name, their credential. Owner only. |
| `.data/hosted/signin-created.sha256` | A note of a sign in a create made, so that the same create can remove it. |
| `.data/hosted/hosted.log` | Unexpected failures, with every token on this host removed. |

`.data` is outside version control.

## How it is built

`integrations/relay-terminal/plow_agent.py` is the one place that knows how an agent comes into
being. This calls into it rather than repeating it: the same duplicate guards, the same line
choice, the same minting, the same refusal to write over a credential that belongs to another
line, the same readiness check. What is added here is that every agent gets a folder, a project,
a credential and a volume of its own.

Because those parts were written for the agent you install on your own machine, some of their
messages name the installer's command or the installer's folder: `./relay agent`, `agent/.env`, or
`in agent/`. When one of those reaches you here, the tool passes it on as it is and then says
underneath which command and which folder apply to this person. Following the message as written
would install or repoint the agent in `agent/` on this machine, which is not the agent you asked
about.

The two tools keep their sign in notes apart. `create` notes a sign in it made in
`.data/hosted/`, never in the installed agent's `.data/agent/`, so a hosted create can never settle
a sign in that `./relay agent` created and is relying on.

Run the tests with `python3 -m unittest discover -s hosted -p 'test_*.py'`. They never run Docker
and never reach Plow.
