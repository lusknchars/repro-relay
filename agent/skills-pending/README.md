# Skills not yet baked into the agent

`agent/Dockerfile` copies only `agent/skills/` into the image. Skills in this
directory are deliberately kept out of it.

## relay-pair

Held here until the server side can serve it. The final review of the paired
dashboard found that the agent container has no Relay URL, no bridge key and no
client able to call `/pair/claim`, `/conversations/messages` or
`/conversations/artifacts`, and that in team mode the hosting guard refuses all
three. Because the skill's description fires after every reply, baking it in
would have made every image rebuild switch on behaviour that cannot work, and
told anyone who texted a six character message that their code did not work.

Move it back into `agent/skills/` only once the agent has a scoped tool and
credential for those routes and a hosted mode test proves the flow end to end.
