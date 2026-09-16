# Agent Index listing copy

Text to paste into the agent's page on the Agent Index, and the message asking
the Plow team for verification and one click deployment. Written September 16,
2026. Update it when the install changes.

## Install Instructions

Requirements: Docker Desktop installed and open, Python 3, and the phone that
owns your Plow account.

1. Copy this repository with GitHub's **Code** button, or clone it.
2. In its folder, run one command:

       ./relay agent

3. It checks Docker, then prints an activation phrase. Text that phrase from the
   phone that owns your Plow account.
4. It selects a free assistant line, starts the agent, waits until Plow reports
   it configured, prints a first reply from Hermes, and shows the number to text.
   It never takes a line that already answers as an agent.
5. Text that number. Two things it does today:

       Meeting notes: Ana reviews the export bug by Friday. Bruno documents setup.

       https://www.youtube.com/watch?v=...

   The first saves tracked work with owner, deadline and the quote behind each
   item. The second reads the talk in your own browser and reports what it
   teaches, with a timestamp and a quote behind every technique, plus a post
   draft.

Other commands:

       ./relay agent status      the agent, its line, and reported usage
       ./relay agent test "..."  one prompt, with its token usage
       ./relay agent stop        stop it, keeping memory and identity

Repeating `./relay agent` continues an interrupted install. The first start
downloads several GB because the upstream image is Linux amd64 and Docker
Desktop emulates it on Apple Silicon. Model access comes from Plow, so no
provider key is needed.

## Message to the Plow team

For Discord, to danedelattre, about verification and one click deployment.

> Hi Dane. Repro Relay is ready for verification. Agent Index id `repro-relay`,
> MIT licensed, repo `lusknchars/repro-relay`, agent package in `/agent`.
>
> Installing is now one command. Clone the repo and run `./relay agent`. It
> checks Docker, walks the Plow activation text, picks a free line, starts the
> agent and prints a first Hermes reply plus the number to text. It never takes
> an occupied line and never overwrites a credential.
>
> It is a variant of `plow-hermes-agent` base `8088c7f` with a Reach persona, a
> video digest skill and the official Agent Index reporter, and it is reporting
> usage already.
>
> Two asks. Could you verify it, and could you set it up for one click
> deployment on Plow infrastructure? Tell me what you need from me for that, for
> example a pinned commit, a published image or compose changes.
