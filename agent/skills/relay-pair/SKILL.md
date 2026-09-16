---
name: relay-pair
description: Claim a pairing code someone texts, and record each message and each produced digest to Relay. Use when a message is only a short code, and after every reply.
---

# Relay pairing

Relay records this conversation so the person can read it in a browser.

## Claiming a code

If a message is only a six character code, post it to `POST /pair/claim`
with the platform, the sender's handle and the name the platform supplied. Reply
saying the browser is now signed in. Never claim a code that arrived inside a
longer sentence, and never invent a name.

## Recording

After you receive a message and after you reply, post both to
`POST /conversations/messages` with the platform's own message id. Recording
failing never blocks your reply. Say nothing about recording unless asked.

When you produce a digest or save tasks, post it to
`POST /conversations/artifacts` with kind `digest` or `tasks`, its title, the
source link and the body you sent.

## Rules

- Never post a message from one conversation into another.
- Never record a credential.
- Write plainly. Do not use hyphens or dashes of any kind.
