# One click deploy: what is done, and what is not

Written September 18, 2026, from the base image in a running container rather
than from documentation. Every quote below is from
`/etc/s6-overlay/scripts/plow-init.py` inside
`public.ecr.aws/e1h7x4a2/plow-cloud-agents:base-51f8315…@sha256:253d7ed3…`, the
base `cloud/Dockerfile` builds on.

The short version: the agent is now **buildable** by Plow's one click builder,
and it is not yet **deployable** by it. Two things have to be true that are not
in this repository's control, and one deploy attempt would tell us whether Plow
already provides them.

## What is done

Plow's builder builds `cloud/Dockerfile` when a repository has one, otherwise
the root `Dockerfile`, and the repository root is always the build context. This
repository's root `Dockerfile` is the web application, and the agent's used to
live in `agent/`, so the builder could not build the agent at all.

That is fixed: the agent's Dockerfile is `cloud/Dockerfile`, its COPY paths start
at the repository root, and the base is pinned by digest so it cannot drift. CI
builds the image and then runs it to confirm the Agent Index reporter and the
transport watchdog are inside. All five workflows are green on main.

## Gap 1: the credential, which the image takes only as a file

The image refuses to take its credential from the environment. This is
deliberate and, in our reading, correct:

> The file is the ONLY source. A settings model reads the process environment
> first by default, which would let `docker run -e PLOW_AGENT_TOKEN=...`
> outrank the credential the image was actually given, and since the token
> decides what is sent to Plow, that is a rotation silently not taking, or an
> agent presenting somebody else's credential. So every other source is dropped
> below.

The settings class enforces it by returning only `dotenv_settings` from
`settings_customise_sources`, so `env_settings`, `init_settings` and
`file_secret_settings` are all dropped.

What it wants instead:

- A file at `/var/lib/plow/credentials`, or at `/var/lib/plow/credentials.host`
  which the image promotes to the first.
- Owned `root:root`, mode `0600` or `0400`. Anything else parks:
  `expected root:root at 600 or 400`.
- Containing only `PLOW_API_BASE`, `PLOW_AGENT_TOKEN` and optionally `AGENT_ID`.
  `extra="forbid"`, so an extra key parks the boot rather than being ignored.
- Present within 60 seconds of boot. It is waited for, not merely required, so a
  host may write it after the container starts. After that:
  `no credential at /var/lib/plow/credentials after 60s`.

Locally, `agent/compose.yml` bind mounts `./plow-credentials` to
`credentials.host` read only. A one click deploy has no bind mount and no shell,
so unless the platform writes that file, the container builds, starts, waits a
minute and parks.

**The question for Plow:** how does a one click deployed agent receive its
credential file? A secret file mount, a provisioner that writes
`credentials.host` before or shortly after boot, or something else? The image's
own comment refers to "a provisioner that has drifted ahead of this image",
which suggests one exists.

## Gap 2: storage that outlives a deploy

`agent/compose.yml` declares a named volume for `/var/lib/hermes`, which holds
the agent's memory, its task store and its identity. Without equivalent
persistence, every redeploy starts an agent that remembers nothing.

The image also treats the pairing of home and credential as safety critical:

> An agent that cannot be told who it is must not come up as whoever it was last
> time: a home volume outlives its tenant, and the failure that hides is a new
> tenant answering in the previous one's chat.

So this is not only about losing memory. A persisted home reattached to a
different credential is a correctness problem the image is actively defending
against.

**The question for Plow:** what persistent storage does a one click deployment
get for `/var/lib/hermes`, and what is its lifetime against a redeploy, a
restart and a rebuild?

## What we can already say about the runtime

The image is built for a microVM, not for a container host that can stop and
restart a failed container. From `park`:

> Exiting is fail closed on a host that stops a container and leaves it stopped.
> exe.dev is not one: this image's CMD is PID 1 in a microVM, so a non-zero exit
> is `Attempted to kill init`, a panicked kernel spinning a full vCPU with no
> sshd, which is how the warm pool billed two cores for a day.

So when something is wrong, the image refuses loudly and stays up rather than
exiting. A failed one click deploy will therefore look like a running agent that
never answers, and the reason will be in the container log as a park line. That
is where to look first, and it names the cause exactly.

## How to settle both questions

One deploy. Trigger it, then read the log. Either the agent comes up, in which
case Plow provides both and this document is obsolete, or it parks with a line
naming which of the two is missing.

Nothing further is worth building here until that is known: both gaps are on the
platform side, and guessing at their shape would mean writing code against an
imagined mechanism, which is how the last several defects in this repository got
made.
