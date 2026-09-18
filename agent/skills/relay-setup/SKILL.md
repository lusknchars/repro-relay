---
name: relay-setup
description: Find out what this person wants connected and what their Mac actually gives, record it, and pick up from that record in a later conversation. Use on first contact, when someone asks what you can do or to set you up, and when they say set up again.
---

# Setup

Use `python3 /opt/hermes/skills/relay-setup/scripts/setup.py --help` for commands.
The record lives in this installation's Hermes home. Its output is the receipt
for a save; only a zero exit means the answer was kept.

## Read the record before asking

Run `show` first. It is empty on a first contact. If it already holds items, do
not ask those questions again: use the name and language it carries, say what is
already set, and ask only what is missing. "Set up again" means `forget`, then
start over from an empty record.

## Offer it once

Answer the work in the person's message first. Then offer setup in one line,
once in a new conversation. If they say no, or say nothing about it, carry on.
Setup never blocks their work and is never a gate in front of an answer.

## One question at a time

Ask in their language, wait, and `record` that answer before the next question.
A conversation that stops halfway keeps every answer it already got.

1. Who they are and what they work on. Save it with `owner --name N --language L`.
2. Whether they want their Mac used at all. Record topic `mac`. A no here ends
   the questions about the Mac.
3. Which of the skills their Mac publishes they want. Call `plow_list_skills`
   and name what is actually there. Never guess one and never offer a skill that
   is not published. One topic per skill, named as the Mac names it.
4. GitHub. Check it by running plain `gh auth status` through `plow_run_command`
   and record what it printed as the evidence. Signed in is `available`. Logged
   out, or no `gh` on that Mac, is `needs_owner`.
5. Which repositories on that Mac you may read. One topic per repository. You
   read nothing outside what they name here.
6. Memory and the harnesses, as below.
7. Anything else they name.

## Say what is true

From a message you can keep your own memory of this conversation, manage your
own task list with relay-reach, read a talk in the owner's browser with
video-digest, and work on their Mac through Latch when they approve it.

Relay's reviewed memory, Mem0 and the investigation harnesses live in the Relay
app on that Mac, not in you. You cannot change them from a message. Record each
as `unavailable` with that reason as its evidence, rather than implying you
might reach them later.

## Never a secret

Never ask for a token, a password or a key. If one is offered, refuse it and say
what actually grants access: the person runs `gh auth login` in their own
terminal, or approves the tool in Latch. Nothing secret is ever pasted into a
message, and the record refuses to store anything shaped like a credential. The
rule is `docs/GITHUB-ACCESS.md`.

## Finish

Close with three short lines: what is available now, what needs them to act, and
what is not possible yet. Then name the next thing you can actually do for them.
