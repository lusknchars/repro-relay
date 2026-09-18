# Transport watchdog: the agent never goes silently deaf

Design approved September 16, 2026: an s6 service inside the agent image, texting
the owner only when recovery fails. It describes what to build; nothing here is
shipped yet.

Amended September 16, 2026, before planning, after reading the upstream code the
design leans on. Changes: `updated_at` is rewritten after every failed attempt,
not only on a state change, so the rule reads it as the retry loop's last report;
a writer is judged live by process id and start time together, as upstream
judges it; a dead writer waits out the same grace instead of acting at once,
because every gateway start inherits the previous writer's entries; and the end
to end tests no longer block the network, which this container cannot do and
which would reproduce a healthy retry rather than the outage.

## Why

On September 16 the iMessage transport stopped receiving at 04:28 and stayed
silent until a manual restart at 15:09. For those ten hours every message sent to
the agent was lost, while the usage reporter kept posting as if nothing were
wrong. Nobody was told.

Nothing in the system could have noticed:

- The image defines two services of its own, `agent-index` and `user`. None of
  them looks at the transport.
- `agent/compose.yml` has no healthcheck.
- The gateway's own reports are process level. `state/gateway.lifecycle.json`
  reads `{"phase": "running"}` and `state/gateway.heartbeat` records the event
  loop and memory. The process never died, so both stayed healthy throughout.

A second drop happened at 17:06 on the same day. That one recovered on its own,
and it too went unnoticed. Drops are more frequent than was known, and most
self heal.

## What actually failed

The transport lives in the upstream `plow_chat` plugin, not in this repository.
Its loop in `_transport.py` retries forever with backoff doubling from 30 seconds
to a five minute cap. It has one terminal exit: a 401 raises `_PlowAuthError`,
which it treats as a revoked credential and stops for good, recording
`credential_refused` as a fatal error.

That exit did not fire. The logs contain no 401 and no `credential_refused`. The
last lines were `ClientResponseError` for both `grant read failed` and
`websocket error` at 04:27 and 04:28, which the generic handler catches with the
comment `reconnect, never die`. By design it should then have retried every five
minutes. Instead it produced no further output of any kind. The most likely
reading is that a retry hung on an await inside the loop. The root cause is
unproven, and this design does not depend on knowing it.

## The signal

`/var/lib/hermes/gateway_state.json` records each platform separately:

```json
"plow_chat": {
  "state": "connected",
  "error_code": null,
  "error_message": null,
  "updated_at": "2026-09-16T18:36:15.526494+00:00",
  "writer_pid": 198,
  "writer_start_time": 38119734
}
```

The gateway's base adapter writes an entry through `_mark_connected`,
`_mark_disconnected` and `_set_fatal_error`, so `state` is one of `connected`,
`retrying`, `disconnected` or `fatal`. `write_runtime_status` in
`gateway/status.py` stamps `updated_at`, `writer_pid` and `writer_start_time` on
every write to an entry, whether or not the state changed.

That makes `updated_at` more useful than a last state change. The transport's
loop calls `on_drop()`, which writes `disconnected`, after every attempt that
ends, before it sleeps. While it retries, the entry is rewritten at least once
per backoff, capped at five minutes, plus however long the failed attempt took.
An entry that is not `connected` and has not been written for six minutes means
the loop itself has stopped. Nothing rewrites a `connected` entry while the
connection holds, so an old `updated_at` on a connected entry means nothing.

`writer_pid` and `writer_start_time` name the process that wrote the entry. The
start time is field 22 of `/proc/<pid>/stat`. Upstream's status endpoint treats
an entry as live only when that process exists and its start time still
matches, which guards against a reused process id.

This is read from outside the process and needs no change to upstream code.

**Unproven assumption.** The restart overwrote the file, so what it said during
the outage cannot be recovered. Reading `_serve`, both endings of an attempt call
`on_drop()` before the backoff sleep, so a retry that hung afterwards would leave
the entry reading `disconnected` with an `updated_at` that stops moving. A socket
that stayed half open while claiming `connected` should be caught by
`ws_connect(heartbeat=30)`. Both are inferences from code. The first cannot be
reproduced without changing upstream, since it needs an await that never
returns; the test plan below proves everything around it.

## The rule

Each watched entry is judged on its own, and the earliest problem wins.

| Condition | Verdict |
| --- | --- |
| The writer is live and `state` is `connected` | Healthy |
| The writer is live, `state` is anything else, and `updated_at` is under 6 minutes old | Healthy; the retry loop is still reporting |
| The writer is live, `state` is anything else, and `updated_at` is 6 minutes or older | Unhealthy |
| The writer is not live: no such process, a zombie, or a different start time | Unhealthy once seen for 6 minutes |
| The entry is absent, or the file is missing or not a JSON object | Unhealthy once seen for 6 minutes |

Six minutes is one minute past upstream's five minute backoff cap, so the
transport always gets one full retry cycle to recover on its own before the
watchdog acts. Acting sooner would thrash on drops like the one at 17:06.

A dead writer waits out the same grace rather than acting at once. s6 restarts a
gateway that exits within a second, and the new process leaves the previous
writer's entries in the file until its own adapters report. That happens on
every container start and after every restart, including the watchdog's own, so
acting at once would restart a gateway that is still starting. A writer that
stays dead for six minutes means s6 cannot bring it back.

The watchdog checks both `plow_chat` and `plow_email`. They share the transport
and failed together at 04:27.

## Recovery

1. Restart the gateway service only, with `s6-svc -r`, not the container. Other
   services keep running.
2. Wait up to three minutes for the watched entries to report `connected` again.
3. At most one restart per ten minutes, so a transport that cannot connect at all,
   for example while Plow itself is down, does not become a restart loop.
4. After three consecutive recoveries that fail to reach `connected`, stop
   restarting and send the alert.

Every recovery is written to the watchdog's log whether it succeeds or not, and
so is a transport that comes back on its own after a failed recovery, so the
history exists for the dashboard later.

## The Mac tools

Added September 17, 2026. The agent reaches the owner's Mac through Latch, as
an MCP server the gateway connects to, named `plow` in `config.yaml`. Its tools
are `plow_read_file`, `plow_write_file`, `plow_run_command` and the browser set.
When that session drops, the model is not told the Mac is unreachable: the tools
simply vanish from its list, and a call returns `Unknown tool:
mcp__plow__plow_read_file`. The agent then answers as though it never had hands.
This repository's own logs show it parking and reviving several times a day, and
one event at 18:36 took the messaging transport and the Mac tools together.

**The signal.** Nothing records this session in `gateway_state.json`, and there
is no state file. The gateway logs each change to
`/var/lib/hermes/logs/agent.log`:

```
MCP server 'plow' keepalive failed, triggering reconnect (state: connected -> degraded)
MCP server 'plow' failed after 5 reconnection attempts, parking; will self probe every 300s until it recovers (state: degraded -> parked)
MCP server 'plow': revived, session healthy again after parking (state: parked -> connected)
```

The last such line for `plow` gives the current state and when it changed. Log
timestamps are UTC, as the container is.

**The rule.** `degraded` or `parked` for six minutes is unhealthy, the same
grace the transport gets. A parked session self probes only every five minutes,
so this is where the agent quietly loses its hands for long stretches.

**Telling the two causes apart.** The watchdog asks Latch itself, with the
agent's own credential from `PLOW_MCP_URL` and `PLOW_AGENT_TOKEN`, for one MCP
handshake:

- **Latch answers.** The gateway's session is stuck while the Mac is reachable,
  so this joins the transport's problem: the same restart, the same limit of one
  per ten minutes, the same three failures before an alert.
- **Latch does not answer.** The Mac is asleep, offline or Latch is closed.
  Restarting the gateway cannot fix that, so it does not restart. It tells the
  owner once per episode and says nothing further until the session returns.

**The alerts.** Recovery that works stays silent, as before.

- Restarts failed three times: "I lost my connection to your Mac and could not
  get it back after three tries, so I cannot read files or run commands there.
  Restarting the agent may fix it."
- Latch unreachable: "I cannot reach your Mac through Latch right now, so I
  cannot read files or run commands there. Waking the Mac or opening Latch
  should fix it. Messages still reach me."

## The alert

Sent only when recovery fails. A successful recovery is silent.

The alert cannot travel over the thing that failed, and it does not have to. The
plugin sends every message over REST, `POST /v1/chats/{chat_id}/messages`, and
only inbound delivery uses the websocket. So the agent went deaf during the
outage but never went mute.

The watchdog posts to the owner's chat with the agent's token, using the chat id
`plow-init` configures. The text follows the agent's voice rules: plain, short,
and without hyphens or dashes of any kind.

It is sent once per failure episode and never resent. A 408, a 424 or any 5xx
means Plow may already have accepted it, which is how the plugin's own
`_message_delivery_unknown` reads those statuses, so sending again risks a
double send.

The token is the agent's broad Plow credential, and the watchdog runs as root,
so the alert takes the same care as the repository's own Plow bridge: it goes
only to an `https` base and a well formed chat id, never through a proxy or a
redirect, which urllib would otherwise follow with the header attached. The
interpreter runs isolated and without site packages. Without the agent token or
the owner chat the watchdog stands down, because the chat platform itself is
only enabled when both are set, and there would be no one to tell.

**Unproven assumption.** During the outage `GET /v1/chats` with the agent token
returned 200, which shows the REST API was reachable. It does not show that a
message send succeeds while the websocket is down. The test plan proves it.

## Not in scope

- Patching the upstream plugin. It is root owned in the base image, and a change
  there would be overwritten on the next rebuild.
- A Docker healthcheck. Compose does not restart unhealthy containers, and a
  healthcheck cannot send an alert. It may be added later for visibility only.
- A host side watchdog. It would depend on the owner's Mac staying awake.
- Moving the agent to a VPS. That is a separate decision; see Deployment.

## Testing

Unit tests for the rule, against the shape of the real file: connected; not
connected inside the grace period; not connected past it; fatal; retrying; a
writer that is gone, a zombie, or has a different start time; an entry left by
a previous gateway; an absent entry; a missing file; malformed JSON. Unit tests
for recovery, rate limiting, the alert request and every outcome of sending it,
with the clock, the process table, s6 and the network all injected.

End to end, on the running agent, only with the owner's go ahead, since it
restarts the live agent, leaves it deaf for about half an hour, and sends one
real message to the owner's own chat. The container has no `iptables`, and a
network block would not reproduce the outage in any case: a loop that fails
fast keeps writing `disconnected` every few minutes, which is a healthy retry
the watchdog must leave alone. So:

1. After the rebuild, confirm the watchdog does not restart the gateway while
   the container starts, and stays silent for ten minutes.
2. As the gateway's own user, write the state a stalled loop leaves:
   `plow_chat` reading `disconnected`, last written seven minutes ago. Confirm
   exactly one restart, the entry returning to `connected` under a new writer, a
   logged recovery, and **no** alert. This proves detection and recovery, not
   what upstream writes during a hang.
3. Hold the gateway down with `s6-svc -d`. Confirm the dead writer is caught
   after the grace period, that restarts stay at most one per ten minutes, and
   that one alert arrives after the third failed recovery. With the gateway down
   this agent has no websocket at all, so the alert arriving proves the second
   unproven assumption. Bring the gateway back with `s6-svc -u` and confirm the
   watchdog logs it and sends nothing more.

No test sends a real message except step 3, and that one goes only to the
owner's own chat. Nothing should be texted to the agent while it is held down.

## Deployment

The watchdog ships as a service directory under `image/s6-overlay`, which lives
in the image rather than the persistent volume, so it arrives on the next
rebuild without any reset.

Skills behave differently. Hermes copies bundled skills into
`/var/lib/hermes/skills` but keeps an existing local copy rather than replacing
it, as the gateway logged for `google-workspace`: "bundled version shipped but
you already have a local skill by this name, yours was kept." A new skill
arrives on rebuild; an updated one does not reach a volume that already has it
without `hermes skills reset`. This is inferred from that log line and should be
confirmed before relying on it.

The agent's own `owners-mac` skill opens with "You run on a Plow cloud server",
so running it on a VPS matches the intended architecture: always reachable, and
native on `linux/amd64` instead of emulated on Apple Silicon. Browser and
terminal work through Latch still needs the owner's Mac to be awake. An
unattended server is where a silent outage would go unnoticed longest, which
makes this watchdog more important there, not less.
