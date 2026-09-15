# Connected local setup

From a checkout, with Docker running:

```sh
sh connect.sh
```

This builds Repro and the pinned Hermes runtime, starts PostgreSQL and opens the local browser workspace. Hermes waits for a provider API key in Settings → Models. Saving the first key starts the gateway without running a model. A later provider change requires restarting Hermes with `docker compose --env-file /dev/null -f compose.local.yaml -f compose.connected.yaml restart hermes`.

The app and Hermes share a container network namespace. Hermes listens only on its loopback port 8642. Repro generates the shared transport credential once in the persistent settings volume; users do not copy it between services. The profile exposes the read-only Relay evidence MCP toolset. Setup does not grant terminal execution or attach host repositories.

`./start.sh status`, `./start.sh logs` and `./start.sh stop` reuse the connected profile after its first successful start. Stopping preserves the database and private settings. Existing incompatible Hermes transport settings cause an error rather than replacement. Existing desktop services must be stopped deliberately before claiming the same port 8178. This installer does not stop them for you.

Docker is still a prerequisite. The first build requires internet access and can take several minutes. A missing provider key is different from a failed app startup. Runtime availability does not verify model access or a successful investigation. Choose and authorize a real request in Repro to test that separately.

This is local Docker setup, not cloud one-click provisioning. Plow owner activation, Agent Index installation/reporting, public HTTPS hosting, native app packaging and optional account permissions remain separate. A container does not inherit a Mac's Pi login, keychain or repository folders. User-uploaded skill previews do not become installed packages.

For an app/database-only installation, use `sh start.sh` in a fresh checkout. Once `.relay-connected` exists, the startup commands retain the connected choice. Never delete volumes to change setup mode.

The optional Discord bot uses `sh connect.sh discord`; see [call linking](DISCORD-VOICE.md).
