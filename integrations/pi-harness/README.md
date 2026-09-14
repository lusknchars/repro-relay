# Pi in Repro Relay

Pi is an additional terminal harness for reviewing Relay's recorded context audits. It uses the same three bounded evidence tools as the Codex MCP connector and WebMCP. Hermes continues to own the existing investigation and approved-repair APIs.

## Start

Install Pi using the [official installer](https://pi.dev). This integration was exercised with `@earendil-works/pi-coding-agent` **0.85.1**, installed with dependency lifecycle scripts disabled. Python 3 and a running local Relay API are also required.

From the Repro Relay repository:

```sh
./relay pi doctor
./relay pi start
```

The doctor reports the executable version, evidence API reachability and repository monitor state separately. It makes no model call and does not check provider credentials. If the API is unavailable, start `make dev` first.

In Pi, use `/login` for your provider and `/model` to select a model. Relay uses its own ignored `.data/pi-agent` profile, so personal Pi settings and credentials are preserved. No credentials are copied from Hermes or Codex. Provider API-key environment variables remain available to Pi. Sign-in is performed by Pi, outside the web application.

If you already signed in using plain `pi`, explicitly reuse that personal Pi profile:

```sh
./relay pi doctor --profile personal --provider anthropic
./relay pi start --profile personal --provider anthropic
```

This reads Pi authentication/settings from `~/.pi/agent` without copying credentials. Relay still limits model tools and keeps its session history in `.data/pi-agent/sessions`. Pi may refresh credentials normally during use. The doctor only checks local credential readiness with `--no-refresh`; a ready result is not proof of a successful model request or account entitlement. Hermes keeps its own separate provider configuration.

Run `start` in an interactive Terminal window. A one-shot shell command cannot host Pi's interactive `/login` flow, and Relay now explains that before launching. Plain `pi start` supplies the word `start` as a prompt to Pi; it does not invoke Relay. `/login` is a command inside Pi, not a shell executable. From another directory, use the absolute path to your checkout's `relay` executable.

Use `/relay` to inspect the latest context audit. It records the evidence and a link back to Relay in the Pi conversation without starting a model. Use `/relay-review` to have your selected model assess that audit. The command supplies the review task and its evidence; no case or direction form is required. Empty history and unavailable evidence do not trigger a model call.

```sh
# Continue the latest Relay Pi session
./relay pi start --resume

# Select a provider/model explicitly
./relay pi start --provider openai-codex --model gpt-5.4

# Use another local Relay port
./relay --api http://127.0.0.1:8178/api/v1 pi doctor
```

The selected model must be available to your provider account. Start has no initial model prompt. `/relay-review` and ordinary conversation can incur provider usage. Pi's footer and session statistics show its token usage and cost. Those figures are not sent to Hermes charts, and storage bytes are never labeled token savings.

Connections → Terminal agent offers Pi and Codex setup instructions in the shared web/desktop interface. Selecting an option changes the instructions only; it does not switch the backend investigator or claim a native connection.

## Tools and scope

| Tool | Result |
| --- | --- |
| `relay_workspace_status` | Local evidence connection, monitor freshness and recorded capabilities |
| `relay_list_work` | At most 20 context audit summaries; default 5 |
| `relay_inspect_work` | Exact revision, decision, evaluation and paginated source hashes |

The launcher disables builtin model tools, discovered extensions, skills, prompts, themes and automatically discovered context files. It loads only the Relay extension and its explicit tool allowlist. Context is fetched on demand; slash-command inspection starts with one audit and five file entries. The extension calls a fixed Python bridge with argument arrays, deadlines and output limits. The bridge reuses the shared tool validation and loopback-only API client, rejects redirects and exposes no writes.

This configuration limits model tools. It is not an OS sandbox. A person running Pi still controls their terminal and can change their local configuration. Pi itself may retain builtin commands such as provider setup.

Approvals, source modifications, tests, memory publication, worktree execution and external messages are not exposed by this integration. Pi review text remains in its local session; it is not an independently verified finding or a Hermes run. The API connection currently supports trusted local mode only. Team-cookie authentication and hosted guest workspaces are not connected to these terminal tools.

## Validation

`make pi-check` covers bridge validation, preserved source revisions, separate connection states and launch isolation. When Pi is installed, a real RPC smoke test loads the extension, checks the active tool allowlist, executes `/relay` against a fixture API and verifies zero model tokens. Without Pi, that smoke test is explicitly skipped. The fixture does not test provider authentication or a paid review.

`make check` includes this suite and a browser test for setup selection, clipboard commands, usage explanations and narrow-screen layout. No Pi package is added to the web bundle. The extension follows Pi's [extension API](https://pi.dev/docs/latest/extensions), [CLI flags](https://pi.dev/docs/latest/usage) and [RPC protocol](https://pi.dev/docs/latest/rpc).
