<p align="center">
  <img src="docs/assets/saturn-readme.gif" alt="Repro Relay's glowing purple Saturn animation" width="480" height="270" />
</p>

<h1 align="center">Repro Relay</h1>

<p align="center">Investigate together. Keep the evidence. Decide what happens next.</p>

<p align="center">
  <img src="docs/assets/plow-hackathon.png" alt="Plow hackathon artwork featuring the Plow logo and a Mac Studio" width="120" height="120" />
  <br />
  Built for the Plow hackathon.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#connect-your-tools">Connections</a> ·
  <a href="#macos-and-development">macOS & development</a> ·
  <a href="docs/STATUS.md">Project status</a>
</p>

Repro Relay brings agent investigations, code review, and team follow-ups into one workspace. See the conversation beside findings, changes, tests, and activity. Use Reach to organize recorded meeting actions and todos. Review the evidence before approving the next action.

## Quick start

Install and open Docker Desktop, then run:

```sh
curl -fsSL https://raw.githubusercontent.com/lusknchars/repro-relay/main/install.sh | sh
```

Open **http://127.0.0.1:8178**. The installer starts the app and PostgreSQL, waits until they are ready, and opens the browser. Local access creates or resumes your administrator profile automatically.

- No signup, phone number, or provider key is needed to open Relay.
- No Node, Rust, Python, or Git installation is needed on your Mac.
- Your records and private settings survive restarts.
- Connect an investigator when you are ready. Installation does not start a model or authorize external accounts.

A published package skips compilation. If it is unavailable, Docker builds the included source; the first build can take several minutes.

Already downloaded the repository? Double-click **[Start Relay.command](Start%20Relay.command)** on macOS, or run `sh start.sh`.

```sh
cd ~/.local/share/repro-relay
./start.sh          # Start and open Relay
./start.sh status   # Check the app and database
./start.sh logs     # Inspect startup problems
./start.sh stop     # Stop services and keep your data
```

This path opens the local browser app. Native macOS builds are available from source below. For updates, existing installations, and troubleshooting, see the [setup guide](docs/EASY-START.md).

## Your workspace

| Area | What you can do |
| --- | --- |
| Work | Follow an investigation with conversation, findings, changes, test records, and activity together. Review a selected attempt and its source evidence. |
| Reach | Organize recorded call requests, meeting action items, and todos. Assign follow-ups, record decisions, and prepare message drafts. |
| Knowledge | Keep reviewed findings and source references available for future investigations. Inspect freshness before reusing context. |
| Usage | Inspect recorded tokens and costs in the app, including missing cost data and reported versus estimated values. |
| Team | Invite teammates by link and use one shared conversation with an administrator-managed Hermes agent. |

Reports, model proposals, human observations, and verification receipts remain distinct. A completed agent run does not establish that a fix passed. See [connected application behavior](docs/LIVE-WORKSPACE.md) and [current implementation status](docs/STATUS.md).

## Connect your tools

Start in **Settings**. Each connection has its own purpose and setup; signing into one does not automatically connect the others.

| Connection | Purpose | Setup |
| --- | --- | --- |
| Model providers | Configure OpenAI, Anthropic, Moonshot or OpenRouter for the dedicated Hermes runtime. | [Model setup](docs/MODEL-SETUP.md) |
| Hermes | Submit, monitor, stop, and review investigations through a configured gateway. | [Runner configuration](docs/HERMES-RUNNER.md) |
| Pi | Use Relay evidence from a local terminal agent. Model authentication belongs to that agent's provider configuration. | [Pi setup](integrations/pi-harness/README.md) |
| Discord | Collect a selected channel’s discussion and save source-linked Reach todos. | [Discord setup](docs/DISCORD.md) |
| Daily video | Host a private call in Reach, capture consented transcription and create transcript-backed todos. | [Video setup](docs/REACH-VIDEO.md) |
| Plow + Latch | Connect an authorized phone line and owner chat for report intake and approved updates. Host app control requires its own working connection. | [Plow setup](integrations/plow/README.md) |
| Mem0 | Add optional private working notes, separate from reviewed project evidence. | [Memory setup](integrations/mem0-memory/README.md) |
| MCP / WebMCP | Expose bounded evidence tools to compatible agents and browsers. | [Evidence tools](integrations/relay-tools/README.md) |

The Docker package has its own filesystem. It does not automatically inherit your Mac's repositories, Pi login, keychain, or running Latch application. Use the [connection boundaries](docs/EASY-START.md#connections-and-desktop) to choose between the package and native/source setup.

Reach also has terminal commands and MCP tools for recorded work:

```sh
./relay reach today
./relay reach listen
./relay reach discord   # Read captured Discord discussion
```

See [Reach](docs/REACH.md) for setup, event listeners, and current limits. Optional [Daily video calls](docs/REACH-VIDEO.md) add embedded meetings and host-captured transcription. Background agent attendance and automatic team message delivery are not included.

## Invite your team

Open **Team → Invite teammate by link**. A teammate joins with a display name and can follow the work and talk to the shared Hermes agent. The administrator controls execution and connections.

A localhost link works on the same computer. Teammates on other computers need a shared HTTPS service. Public guest workspaces are a separate mode, not a shared team deployment. Read [local access and chat](docs/LOCAL-ACCESS-AND-CHAT.md) or [shared account setup](docs/ACCOUNTS-AND-TEAM.md) before sharing remotely.

## macOS and development

The macOS desktop app uses Tauri and the same frontend and Rust API. It is currently a development build, not a signed or notarized installer. iPhone development is deferred while the macOS experience takes priority.

Source setup requires Python 3.9+, Node 24+, Rust stable, and Docker with Compose. macOS also needs Xcode command-line tools. From a checkout:

```sh
./relay setup --check   # Inspect prerequisites
./relay setup           # Build, start, and open the macOS app
./relay setup --web     # Use the browser app instead
```

Linux and Windows use the browser app by default. In Windows PowerShell, use `python relay setup --web`.

Source setup reads a private `.env`, with existing process variables taking precedence. Set `DATABASE_URL` to use an existing PostgreSQL server and skip Docker. Source and packaged installations use separate database volumes; see [setup and data storage](docs/EASY-START.md).

```sh
make dev               # Frontend hot reload and local API
./relay doctor         # Inspect local readiness
./relay --help         # Terminal investigation and worktree controls
```

Use [terminal tooling](integrations/relay-terminal/README.md) for isolated repair worktrees and execution records. The [backend workflow](docs/BACKEND-WORKFLOW.md) describes evidence, decisions, and verification. Runtime permissions and provider limits still apply.

## Contributing

Read [current status](docs/STATUS.md) and the repository's [agent instructions](AGENTS.md) before choosing work. Keep credentials and runtime data out of commits, and distinguish fixture results from live agent execution.

```sh
make setup             # Install test dependencies and prepare PostgreSQL
make check             # Python, Rust, frontend, and browser checks
make desktop-build     # Build the macOS development bundle
```

Container contributors can exercise a fresh installation and restart persistence separately:

```sh
docker build -t relay-package:test .
python3 scripts/test-local-container.py
```

Browser checks cover recorded workflows, access boundaries, keyboard navigation, and responsive layouts. Hermes protocol fixtures do not establish live provider execution. See [frontend provenance](docs/FRONTEND.md) before importing components or visual assets.

| Directory | Contents |
| --- | --- |
| `crates/relay-core` | Shared workflow types and policies |
| `crates/relay-api` | Rust API, PostgreSQL migrations, and backend tests |
| `web/reptest` | Current React interface |
| `web/src` | Retained frontend and regression coverage |
| `web/src-tauri` | Native macOS shell and app icons |
| `integrations` | Terminal, agent, memory, and connection adapters |

For public browser previews, see the [hosted guest deployment guide](docs/deployment/public-beta.md). For planned work, see the [roadmap](docs/ROADMAP.md).

## License

Repro Relay's original code is [MIT licensed](LICENSE). PaceUI template source retains its product license; other components and assets retain their upstream licenses. See [third-party notices](THIRD_PARTY_NOTICES.md).
