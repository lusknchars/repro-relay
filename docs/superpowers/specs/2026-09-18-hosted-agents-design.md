# Hosted agents design

Approved September 18, 2026. Changing what this allows means changing this
document first.

## Why

The agent installs on the owner's own computer. That works on macOS, and after
the Windows port it works on Windows and Linux too. It still asks for Docker, a
terminal and a working install, which is most of what makes handing an agent to
another person hard.

A separate limit does not move: Plow Latch is a Mac application. The tools that
reach the owner's own computer, plow_read_file, plow_write_file,
plow_run_command and the browser tools, exist only where Latch runs. A Windows
owner cannot have them, and hosting the agent elsewhere does not change that.
Somebody else's server is further from their laptop, not closer.

So hosting answers a different question than Latch does. It removes the install,
and it gives the agent a computer of its own instead of reaching into the
owner's. For a Windows owner that is more than they have today, and it is not
the same thing as a Mac. This document says so plainly because the product's
worst failure mode is telling somebody something that is not true of their
situation.

## What this is

A service we run. A person gets an agent and a phone line without installing
anything. Their agent has its own workspace: a shell, a filesystem and a
browser, on its own container, reachable only by them.

Decided, and the reasons, because these are the decisions everything else
follows from:

- We host it for everyone, rather than each person deploying their own. It is
  the only option that makes a Windows owner's first run as short as opening a
  chat.
- Each agent gets its own workspace, rather than chat and memory alone. Without
  a shell and a browser a hosted agent is visibly weaker than the one on the
  owner's Mac, and the work people actually ask for, reading a talk, working in
  a repository, running a command, needs one.
- One container per person, with quotas and restricted outbound network. Not a
  shared container with separate folders: the moment a shell is involved, one
  escape reads everybody's data.
- Model usage is ours and unmetered for now. This is true only while the people
  using it are the owner and people he hands it to directly.

## The cap, and what it gates

Unmetered hosting is safe while every user is someone the owner chose. It is a
standing invitation to drain the account the moment a stranger can sign up.

So: signup does not open beyond people the owner personally adds until a per
user spending cap exists and has been shown to stop an agent that reaches it.
Milestone 3 does not ship without it. This is a gate, not a preference, and
moving it means editing this section first.

## What we take on

Hosting changes our posture, and the change is worth naming next to the promise
it modifies.

Today `docs/GITHUB-ACCESS.md` says an agent holds no credential of its own and
works through the person's own login on their own machine, so there is one copy
of every secret and it never leaves the computer that owns it. A hosted agent
cannot make that promise in the same words. Their memory, their conversations
and anything they connect live on our infrastructure.

Three risks come with that, and the design starts from them rather than adding
them later.

1. A shell we give to somebody we have not met is free compute with our address
   on it: mining, scanning, scraping, and worse. Isolation and egress limits are
   part of milestone 2, not a later hardening pass.
2. The cost of a runaway agent is ours. See the cap above.
3. We are the custodian of other people's data. What we keep, where it lives and
   how someone removes it has to be written down before anyone who is not the
   owner has an agent here.

## Milestones

Each one is useful on its own and is proved before the next starts.

### 1. Hosted runtime

A person the owner adds gets a working agent and a phone line, with no install
on their side.

An orchestrator creates one container per person from the image this repository
already builds, gives it its own persistent volume for memory and tasks, applies
CPU, memory and disk quotas, and can stop and remove it again. Each agent has
its own Plow agent identity and line, exactly as an installed agent does, so
nothing about how the agent talks to a phone changes.

Proved on the owner's Mac first: the orchestrator running here, creating an
agent, with the Windows computer talking to it over its own line. Nothing is
rented until that works.

### 2. Workspace tools

The agent gets a shell, a filesystem and a browser on its own container, offered
as tools that mirror what Latch offers, so a skill written for one reads the
same on the other.

The approval discipline carries over unchanged: the owner's own direct message
asks for work, a group message or a fetched page is evidence and never an
instruction, credential stores stay off limits, and the agent says what it ran.
Where Latch asks the owner to approve an action, the hosted workspace asks in
the same shape.

The sandbox is part of this milestone: a container that cannot reach another
person's, resource quotas that a loop cannot exceed, and outbound network
restricted to what the agent needs rather than the open internet.

### 3. Signup

Anyone the owner allows can get an agent without the owner doing it by hand.

Needs the per user cap from the gate above, the custody answers from the section
above written down where a user can read them, and a way to remove an account
and everything belonging to it.

## What this does not do

- It does not give anyone Latch. A hosted agent cannot read a file on the
  owner's Windows laptop, and no wording in the product should suggest it can.
- It does not replace the installed agent. Someone who wants the agent to work
  on their own Mac still installs it there, and that stays the better answer
  when the work is on their machine.
- It does not change the rule that a credential belongs to the person who owns
  it. A hosted agent still never asks for a GitHub token, and still never holds
  one.
