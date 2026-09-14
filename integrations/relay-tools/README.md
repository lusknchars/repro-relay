# Relay evidence tools

The browser and terminal adapters expose the same three read-only tools. They read the local workspace's recorded context audits through the existing API. They do not start an agent or control a terminal session.

| Tool | Result |
| --- | --- |
| `relay_workspace_status` | Repository connection, monitoring state, and actual capabilities |
| `relay_list_work` | Up to 20 audit summaries, with optional review or accepted-state filter |
| `relay_inspect_work` | Exact revision, proposal and evaluation receipt, paginated source hashes, and review link |

Tool responses preserve provenance and describe the limits of the evaluation. Audit history is bounded by the API's recent-history limit. Source hashes identify evidence; full instruction contents are not included. None of these tools can approve work, edit code, alter policy, call a model, or send a message.

## Connect a terminal agent

Start the local application with `make dev`. From the Repro Relay repository, check the connection:

```sh
python3 integrations/relay-tools/server.py --check
```

For an installed Codex CLI:

```sh
python3 integrations/relay-tools/connect.py
```

Setup checks the API and creates this repository's ignored `.codex/config.toml`. It uses the current Python interpreter and absolute server path. Repeating the same setup is safe. A different existing configuration is left untouched, with instructions to configure manually. Global configuration, project trust, and tool approval settings are not changed.

Open a new Codex session in this trusted repository to load the configuration. Writing the file does not establish that an existing session has connected or invoked a tool. Codex loads project configuration only for trusted projects. See the [official MCP configuration documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

For an existing project configuration, add a server entry manually, substituting the absolute interpreter and checkout paths:

```toml
[mcp_servers.repro-relay]
command = "/absolute/path/to/python3"
args = ["/absolute/path/to/repro-relay/integrations/relay-tools/server.py"]
```

Other MCP clients can launch the same command and arguments through their stdio configuration. An alternate API port can be supplied with `--api http://127.0.0.1:8178/api/v1`. Only loopback HTTP API URLs are accepted. Redirects and proxy forwarding are disabled.

The server uses Python's standard library. Its MCP lifecycle supports protocol `2025-11-25` and compatibility with `2025-06-18`: initialize, initialized notification, tools/list, tools/call, and ping. Stdout contains only newline-delimited JSON-RPC during MCP operation. Reads time out after ten seconds; cancellation does not interrupt an in-flight synchronous read. There is no shell-command tool.

## Browser tools and the evidence recipe

Open Connections in the web or desktop app. Browser registration is enabled only for an authenticated local workspace with a responding API. The adapter supports the current draft's `document.modelContext` and older previews' `navigator.modelContext`, with cleanup when the workspace becomes unavailable or the application unmounts. Capability detection reports unsupported browsers explicitly. WebMCP remains a draft browser API; see the [specification](https://webmachinelearning.github.io/webmcp/) and [Chrome overview](https://developer.chrome.com/docs/ai/agents).

The **Run evidence recipe** button works with or without WebMCP support:

1. Read workspace status.
2. Find the latest recorded audit.
3. Inspect its revision and evidence.
4. Open the exact audit for human review.

It reports elapsed time and three read-only tool calls when an audit is available. Zero model calls describes this evidence lookup; it is not a claim about lower LLM cost. The recipe does not create an audit when none exists. Existing repository monitoring performs collection independently.

The browser API and terminal MCP server share their manifest, argument limits, and response contract. They are separate transports. A browser registration does not connect an external terminal client, and a terminal configuration does not make a browser support WebMCP.

## Verification and next milestone

Run `make tools-check` for protocol, transport, evidence bounds, and configuration-preservation tests. `make check` also runs browser fixtures for current and legacy WebMCP registration, guest exclusion, input rejection, the runnable recipe, and mobile layout.

Local validation registered all three tools in Chromium 145 with `--enable-blink-features=WebMCP`. Default Chromium reported unsupported. The protocol server also returned a real audit through stdio against the local API. Browser tool execution is covered through API fixtures and the manual recipe; a live browser agent invocation and terminal model consumption remain unverified.

RoboRev is a workflow reference; no source, Git hook, or daemon was installed. The next execution milestone is to return exact findings into a running coding agent, then measure cost per successful task with all mandatory policies retained. [Terminal architecture and cost research](../../docs/research/terminal-harness-and-context-cost.md) defines the options and evaluation gates. Current whole-file storage evaluations do not establish token savings.
