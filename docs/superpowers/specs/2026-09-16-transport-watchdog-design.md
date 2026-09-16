# Transport watchdog: the agent never goes silently deaf

Design approved September 16, 2026: an s6 service inside the agent image, texting
the owner only when recovery fails. It describes what to build; nothing here is
shipped yet.

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
  "updated_at": "2026-09-16T17:06:57Z",
  "writer_pid": 198,
  "writer_start_time": 38119734
}
```

The gateway's base adapter writes it on every transition through
`_mark_connected`, `_mark_disconnected` and `_set_fatal_error`, so `state` is one
of `connected`, `retrying`, `disconnected` or `fatal`. `updated_at` marks the last
state change, not a heartbeat.

This is read from outside the process and needs no change to upstream code.

**Unproven assumption.** The restart overwrote the file, so what it said during
the outage cannot be recovered. Reading `_serve`, the generic handler calls
`on_drop()`, which writes `disconnected`, before any retry. A retry that hung
afterwards would leave the file reading `disconnected`. A socket that stayed half
open while claiming `connected` should be caught by `ws_connect(heartbeat=30)`.
Both are inferences from code. The test plan below exists to prove them.

## The rule

| Condition | Verdict |
| --- | --- |
| `state` is `connected` | Healthy |
| `state` is anything else and `updated_at` is under 6 minutes old | Healthy; upstream's own retry is still inside its backoff cycle |
| `state` is anything else and `updated_at` is 6 minutes or older | Unhealthy |
| `writer_pid` is not a live process | Unhealthy immediately; the file is stale |
| The file is missing or not valid JSON | Unhealthy after the same 6 minute grace |

Six minutes is one minute past upstream's five minute backoff cap, so the
transport always gets one full retry cycle to recover on its own before the
watchdog acts. Acting sooner would thrash on drops like the one at 17:06.

The watchdog checks both `plow_chat` and `plow_email`. They share the transport
and failed together at 04:27.

## Recovery

1. Restart the gateway service only, with `s6-svc -r`, not the container. Other
   services keep running.
2. Wait up to three minutes for `plow_chat` to report `connected` again.
3. At most one restart per ten minutes, so a transport that cannot connect at all,
   for example while Plow itself is down, does not become a restart loop.
4. After three consecutive recoveries that fail to reach `connected`, stop
   restarting and send the alert.

Every recovery is written to the watchdog's log whether it succeeds or not, so
the history exists for the dashboard later.

## The alert

Sent only when recovery fails. A successful recovery is silent.

The alert cannot travel over the thing that failed, and it does not have to. The
plugin sends every message over REST, `POST /v1/chats/{chat_id}/messages`, and
only inbound delivery uses the websocket. So the agent went deaf during the
outage but never went mute.

The watchdog posts to the owner's chat with the agent's token, using the chat id
`plow-init` configures. The text follows the agent's voice rules: plain, short,
and without hyphens or dashes of any kind.

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

Unit tests for the rule, against fixture files: connected; disconnected inside
the grace period; disconnected past it; fatal; `writer_pid` not alive; missing
file; malformed JSON.

End to end, on a running container, reproducing the outage on purpose rather
than trusting the reading of the code above:

1. Block outbound websocket traffic from inside the container. Confirm
   `plow_chat` leaves `connected` in `gateway_state.json`. This proves the first
   unproven assumption.
2. Keep it blocked past six minutes. Confirm exactly one gateway restart.
3. Unblock. Confirm `plow_chat` returns to `connected` and **no** alert is sent.
4. Block again and keep it blocked. Confirm restarts stay at most one per ten
   minutes and that one alert arrives after the third failed recovery. This
   proves the second unproven assumption, that a REST send works with the
   websocket down.
5. Kill the gateway process. Confirm the stale `writer_pid` is caught without
   waiting for the grace period.

No test sends a real message except step 4, and that one goes only to the
owner's own chat.

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
