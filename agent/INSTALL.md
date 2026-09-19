# Installing the agent

One line, on macOS, Linux or Windows. It ends with an agent answering on a phone
line that belongs to you.

## Before you start

- **Docker Desktop**, installed and open. The agent runs in a container, and
  everything below fails clearly if Docker is not running.
- **Python 3**. Already present on macOS and most Linux. On Windows, install it
  from python.org or the Microsoft Store.
- **A Plow account**, and the phone that owns it. Signing in sends one
  activation text to that phone.
- **Git**, to copy the repository.

## Testing it as a new person would see it

Before installing to check what a stranger experiences, make sure the machine is
not already carrying a previous install. A macOS user account of its own gives a
clean home folder, but Docker is shared by everybody on the machine, so a
container and a memory volume from an earlier install are still there.

```sh
sh agent/check-clean.sh
```

It only looks, changes nothing, and never prints a token. It reports what a
fresh install would inherit, and a memory volume is somebody's agent memory, so
check what it belongs to before removing anything.

## The line

On macOS and Linux:

```sh
git clone https://github.com/lusknchars/repro-relay.git && cd repro-relay && ./relay agent
```

In Windows PowerShell:

```powershell
git clone https://github.com/lusknchars/repro-relay.git; cd repro-relay; python relay agent
```

`relay` is a Python file, so `./relay` does not run in cmd.exe or PowerShell.
Everywhere this repository writes `./relay`, a Windows terminal wants
`python relay`. The tool itself prints whichever is right for the computer you
are on.

Nothing here downloads a script and runs it. You have the source before anything
executes, and you can read it.

## What it does, in order

1. Checks that Docker is running.
2. Signs you in to Plow, if you are not already. You send one activation text
   from the phone that owns the account.
3. Chooses a free assistant line. It never takes a line that already answers as
   an agent.
4. Builds and starts the container, waits until it is ready, prints a first
   reply, and shows the number to text.

Run it again whenever you like. It continues from wherever it stopped, and it
will not create a second agent by accident.

## Afterwards

```sh
./relay agent status              # agent, line, Plow setup and reported usage
./relay agent test "Summarise my open work"
./relay agent model               # see or change the model it runs on
./relay agent stop                # stop it, keeping memory and identity
```

## When it stops and the reason is not obvious

```sh
sh agent/doctor.sh
```

One screen with everything needed to say why: what this machine has, the
permission on each credential without its contents, what the account holds, the
docker state every user on the machine shares, and the tail of the last failed
install. It only looks, and it never prints a token or a key.

## When something is missing

**"Docker is not running."** Open Docker Desktop and wait until it says it is
running, then run the command again.

**The build takes a long time the first time.** It is downloading the image
layers. If it stalls, stop it and run it again; it resumes.

**"This account holds no assistant line."** Your Plow account has no free line.
Either let Plow provision one with `./relay agent --new-line`, or retire an
agent you no longer use with `plow-agents revoke <line>`.

**Several free lines.** It asks which to use, and prints the exact command that
picks one without asking next time.

**It stopped with something else.** The message says what happened and what to
do. `.data/agent/install.log` holds the detail, and it is written so only you
can read it.

## What needs a Mac

The agent itself runs on all three platforms, and so does the phone line.

Plow Latch is a Mac application, and it is the only way an agent reaches files
and commands on your own computer. There is no Latch for Windows or Linux, so on
those machines the agent has no access to your machine, and it will say so
rather than pretending otherwise. Everything else works the same.

See [Repro Relay on Windows](../docs/WINDOWS.md).

## Installing it for somebody else

The line above is the whole thing, and it is the same on every platform, so it
travels well. Two things to know before you hand it over.

The agent is theirs, on their Plow account, using their credits. It is not a
copy of yours: never copy `agent/plow-credentials` from one machine to another,
because both agents would then answer for the same line. Let each install mint
its own.

If they should not have to install anything at all, that is what `./relay
hosted` is for: it gives a named person an agent on its own line, running on
your computer instead of theirs. See [hosted/README.md](../hosted/README.md).
