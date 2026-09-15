# Portable Harness capabilities

Researched 2026-09-15. Proposal, not a statement of implemented behavior. Scope is standards, discovery, and installation safety. Runtime-specific Pi and Hermes integration requires separate verification.

## What can be reused

| Resource | Useful part | Limit |
| --- | --- | --- |
| Agent Skills | Import/export a directory containing `SKILL.md`, optional scripts, references, and assets | An instruction format is not an executable environment or permission boundary |
| AGENTS.md | Read existing repository instructions and propose reviewed changes | Agent support and instruction handling need per-runtime verification |
| MCP | Discover tool servers and expose approved tools through a supporting client | Server installation, credentials, transport support, and permissions remain separate work |

Agent Skills requires name and description metadata. Its optional compatibility field describes runtime dependencies; its license field can refer to proprietary terms. `allowed-tools` is experimental and support varies. The format recommends loading metadata first, full instructions when needed, and resources on demand. Relay should therefore validate packages and show dependencies before assignment, rather than promise that every skill works in every agent. [Agent Skills specification](https://agentskills.io/specification)

The Agent Skills specification repository licenses code under Apache-2.0 and documentation under CC-BY-4.0. That does not license third-party skill packages. Record each imported package's license and preserve notices; do not redistribute packages with absent or incompatible terms by default. [Official repository licensing](https://github.com/agentskills/agentskills#license)

AGENTS.md provides a conventional location for project instructions, including build commands, tests, and coding conventions. The official format supports nested files with nearer instructions taking precedence. Relay can inventory these files without replacing them, and propose an explicit diff when a user wants to change project guidance. The format documents many integrations, not a guarantee for every runtime. [AGENTS.md](https://agents.md/)

## Search is not permission to execute

The official MCP Registry hosts server metadata pointing to packages or remote services. It includes closed-source servers. It verifies publisher namespaces and delegates code scanning to package registries and aggregators. Registry membership is not a safety certification or redistribution license. The documentation recommends downstream aggregators for host apps and currently marks the service as preview. Use a small curated catalog first, with an import-by-URL option, rather than building an unrestricted installer. [MCP Registry](https://modelcontextprotocol.io/registry/about)

For one-click local server configuration, MCP's security guidance requires showing the complete command and obtaining explicit consent before executing it. It also recommends sandboxing and limiting filesystem and network access. A disabled tool checkbox inside Relay must not claim to constrain a local server process that still has broad host permissions. [MCP security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices#local-mcp-server-compromise)

## Proposed first release

These are design recommendations, not capabilities granted by the standards.

Repository inspection by the coordinating agent found an existing evidence-only Pi adapter with an explicit tool allowlist and arbitrary skills disabled, plus a context worker that snapshots tracked instructions and manifests. Its approved context is not yet consumed by the coding agent. Preserve that boundary. The first milestone should connect approved context to one supported run and record exactly which snapshot it received, rather than replace the agent layer. See [Pi adapter](../../integrations/pi-harness/README.md) and [context worker](../../integrations/context-harness/worker.py). Existing local private-note scoping must not be presented as hosted isolation.

1. **Inspect a repository.** Read manifests, existing instructions, skill directories, and configured commands without running them. Present detected language, candidate checks, and missing prerequisites. Require confirmation of inferred commands.
2. **Choose a small task pack.** Start with repository orientation, bug reproduction, patch verification, and reviewed knowledge capture. Each pack defines required inputs, output evidence, skills, and checks. Adapt paths and commands per repository; leave uncertain values unresolved.
3. **Preview and apply.** Show files to be written, dependency commands, version, source, license, and requested access. Separate downloading from executing. Preserve existing files, reject paths escaping the package root, pin revisions, and allow rollback.
4. **Check compatibility.** Display per-agent states such as detected, configured, tested, and unsupported. Keep credential setup separate. An imported skill becomes available; it is not proof the runtime activated it.
5. **Run a bounded trial.** Use a disposable workspace and explicit user approval. Record task, repository revision, runtime/model, pack revision, checks actually run, outcome, reported cost, and missing telemetry. Compare the same task before and after configuration; do not claim improvement from installation counts.

The portable object should be a versioned task profile referencing instructions, skill revisions, approved tools, memory scope, and verification commands. Runtime adapters translate that profile to supported configuration. They must report unsupported settings rather than silently dropping them. Keep memory provenance and workspace authorization in Relay's backend; a Markdown export cannot enforce private-memory isolation.

Defer automatic discovery-and-execution, arbitrary community plugins, and a new memory database until a measured task requires them. A tested four-pack catalog with visible evidence would deliver more value than a large unverified marketplace.
