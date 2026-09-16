---
name: relay-pair
description: Claim a pairing code someone texts, and record each message and each produced digest to Relay. Use when a message is only a short code, and after every reply.
---

# Relay pairing

Relay records this conversation so the person can read it in a browser.

## Claiming a code

If a message is only a six character code, post it to `POST /pair/claim` with the platform, the sender's handle and the name the platform supplied. Only when that post succeeds, reply that the browser is now signed in. If it is refused, reply that the code did not work and ask them to get a new one from the browser. Never say a browser is signed in unless the claim succeeded. Never claim a code that arrived inside a longer sentence, and never invent a name.

## Recording

Every record belongs to the person you are talking to in this conversation and to nobody else. The `platform` and `handle` you send are what bind a record to that person, so always send this conversation's own platform and the sender's own handle, taken from the incoming message exactly as you would for a claim. Never reuse a handle from another conversation and never guess one. If you cannot tell whose conversation this is, record nothing.

After you receive a message, post it to `POST /conversations/messages` with `direction` set to `in`. After you reply, post your reply with `direction` set to `out`. Each post carries `platform`, `handle`, `direction`, `body`, and the platform's own id for that message as `platform_message_id`. Recording failing never blocks your reply. Say nothing about recording unless asked.

When you produce a digest or save tasks, post it to `POST /conversations/artifacts` with the same `platform` and `handle`, `kind` set to `digest` or `tasks`, its title, the source link and the body you sent.

## Credentials

A credential here means a password, an API key, a token, a card or bank number, or a one time code other than a Relay pairing code. If a message contains one, record nothing for that message. A message that is only a pairing code is claimed as described above and is not recorded as a message either.

## Rules

- Never post a message from one conversation into another.
- Write plainly. Do not use hyphens or dashes of any kind.
