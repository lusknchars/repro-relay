# Terminal integration and measured context cost

Reviewed September 14, 2026. The user confirmed WebMCP and RoboRev as the references. This document recommends a next execution slice; it does not establish a connected agent, a new background coding service, or token savings. No external package or hook was installed for this research.

## What should distinguish Relay

Connect a repository once. Relay should detect relevant changes, prepare bounded work, run an experiment, and present one decision with its evidence and measured cost. A terminal lets an experienced user inspect execution. It does not provide that workflow on its own.

RoboRev documents two complementary integrations: a post-commit hook schedules background reviews, and agent hooks return open findings to supported active coding sessions. Its local queue, findings, and fix/review loop preserve work across those interactions. The useful pattern for Relay is a durable result tied to a revision and returned to ongoing work, without asking the owner to restate the task. These are documented RoboRev capabilities, not an integration tested here. [RoboRev README](https://github.com/kenn-io/roborev)

## Four integration options

| Option | What it solves | What Relay still owns | Recommended use |
| --- | --- | --- | --- |
| One native coding-agent adapter | Starts an installed agent as a managed subprocess and translates structured events into Relay progress, usage, and results. Claude Code documents noninteractive JSON and streamed JSON, plus session metadata. | Authentication readiness, supported versions, effective permissions, process lifetime, recovery, task admission, isolation, and verification. CLI availability alone is not readiness. | Smallest execution experiment: one provider behind the existing runner contract. See [Claude headless interface](https://code.claude.com/docs/en/headless). |
| Agent Client Protocol | Standardizes communication between a client and a compatible coding agent. Local agents use JSON-RPC over stdio; session updates carry tool progress and diffs. | An ACP client, compatibility checks, durable task scheduling, authorization enforcement, and Relay's evidence model. A protocol does not independently isolate commands. | Add when a second provider would otherwise duplicate substantial adapter work. See [ACP introduction](https://agentclientprotocol.com/get-started/introduction) and [tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls). |
| Model Context Protocol | Exposes Relay capabilities and context to an agent host through tools, resources, and prompts. | The host's model loop and context selection. MCP explicitly does not define how the application manages them. | Let an existing terminal agent retrieve current scoped findings and approved context. Start with read-only operations. See [MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture). |
| WebMCP | Lets a website expose structured actions to a compatible browser agent, using JavaScript or annotated forms. | Backend authorization, current scope, validation, user decisions, supported-browser detection, and all background execution outside the page. | Let browser agents inspect Relay status and evidence through the existing application. It complements the terminal connection. See [Chrome's WebMCP guide](https://developer.chrome.com/docs/ai/agents). |

ACP terminal methods cover creation, bounded output retrieval, waiting, termination, and release. The agent must first check the client's terminal capability. Relay can render these events beside its evidence without treating arbitrary terminal output as independent verification. Implementing these methods also creates an execution responsibility in the local client. [ACP terminals](https://agentclientprotocol.com/protocol/v1/terminals)

## First connection slice selected

Expose the same read-only Relay evidence through a local MCP stdio server for terminal agents and WebMCP tools in the existing browser application. Keep decisions, source edits, and execution out of this first tool catalog. This lets users connect their existing agent without adding another prompt page or pretending Relay now runs that agent. MCP connects tools to the terminal's agent; ACP would connect a Relay client to an agent's execution session. These are different integration directions.

For a conventional `initialize` / `notifications/initialized` / `tools/list` / `tools/call` implementation, target MCP `2025-11-25` explicitly and verify the installed client's negotiation. Do not mix this lifecycle with the newer `2026-07-28` stateless discovery architecture linked above. The server returns the requested version when supported, otherwise a version it implements; an incompatible client should disconnect. Advertise only the capabilities actually implemented. [Versioned lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)

Stdio messages are UTF-8 JSON-RPC, one serialized message per line. Escape newlines inside JSON strings; reserve stdout for protocol messages and stderr for diagnostics. No HTTP listener is needed for this transport. [Versioned transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

Tool definitions need input schemas and handlers that enforce them. Return structured JSON plus a serialized text block for compatible clients. Unknown tools and malformed requests produce protocol errors. API failures and invalid tool values produce tool results with `isError: true`. Read-only annotations describe behavior; the implementation and backend restrictions must enforce it. [Versioned tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)

The smoke test should negotiate the actual stdio process, list its tools, call a bounded status/evidence tool against Relay, reject an unknown tool and malformed arguments, and prove no writes occur. Configuring a client entry is separate from proving that a live agent consumes the tools. Report those milestones separately.

For Claude specifically, the current headless documentation says ordinary `-p` execution loads project configuration, hooks, and MCP servers without the interactive workspace trust flow. Its bare mode excludes ambient settings and instructions. Neither default behavior proves that Relay's policy is preserved. The adapter must construct and record the effective instructions, permitted tools, and configuration before starting work. Never drop repository instructions just to make an experiment cheaper. The reported CLI dollar amount is an estimate, not a reconciled bill. [Claude headless interface](https://code.claude.com/docs/en/headless)

## Cost mechanisms worth testing

Keep stable instructions and tool definitions in a stable prompt prefix, with changing evidence after it. Provider prompt caching requires identical prefix content and has minimum-size and lifetime constraints. Cache writes and reads have different prices; cache reads still represent input processed by the model. Capture uncached input, cache-write input, cache-read input, and output separately. Caching does not reduce output generation or remove the need to send current policy. Its value depends on actual reuse. [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)

Use a small current evidence index, then retrieve bounded source excerpts by path, revision, and finding ID. Keep required instructions available in full and unchanged. Anthropic describes this combination of initial context and retrieval as a practical coding-agent strategy, while warning that extra exploration can add latency and wasted calls. Relay must measure the complete run, including retrieval and retries, before claiming a benefit. [Context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

Deduplicate work before calling a model. A trigger key should include repository snapshot, task kind, policy version, and evaluator version. An unchanged key should reuse the recorded outcome or remain idle. This is a proposed Relay behavior, not a provider guarantee. Do not schedule a second reviewer by default; add one only when a measured quality gain pays for its additional calls.

The existing [context worker](../../integrations/context-harness/README.md) compares whole instruction-file contents and verifies a lossless storage representation. It does not yet measure model input or consumption. Bytes saved in that representation must remain separate from tokens and dollars saved during a real agent run.

## Subsequent end-to-end execution experiment

Build one read-only agent adapter before attempting automatic source edits. Reuse Relay's persisted claims, version checks, and result journal. Have a relevant commit trigger an automatically prepared context-inspection task. The user chooses connection and allowance once, then sees results or a blocked reason. No per-task prompt form is required.

1. Freeze 20 representative repository tasks with exact commits, required evidence, and known outcomes. Include instruction conflicts, revoked memory, and repository changes during execution. This is an initial engineering set, not a statistical claim about general performance. Anthropic recommends starting with real failures and unambiguous reference outcomes. [Agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
2. Compare the current context assembly with a candidate that keeps the same required instructions and retrieves relevant evidence on demand. Hold model, settings, tool permissions, task data, and evaluator fixed. Run three paired trials per task, randomizing order. Record cold and warm cache conditions separately.
3. Save the exact context manifest, content hashes, tool calls, stop reason, all reported token categories, total estimated cost, wall time, retry count, and grader outcome. Include failed and cancelled runs in spend. Reserve allowance before dispatch and stop admission when the remaining allowance cannot cover the next bounded request.
4. Show one result in Relay: what changed, which tasks passed, cost per successful task, total experimental spend, and whether the result qualifies for approval. Keep the original traces available beneath it.

Proposed acceptance gates: every policy fixture passes; no revoked or stale evidence is admitted; interruption and retry do not start duplicate work; both arms preserve the same required instructions; and the candidate loses no deterministic task passes. A 15% lower total cost per successful task is a proposed adoption threshold, not a forecast. Report uncertainty and expand the task set if results are close. A smaller prompt accompanied by more failures or retries does not pass.

After that measurement, add one isolated patch experiment with a protected evaluator and a revision-bound approve/decline decision. The terminal, MCP, and WebMCP should all refer to the same task and evidence identifiers. None should create a second approval mechanism or bypass the backend's current decision rules.
