# Local Hermes and Plow Latch

Relay can use one locally running Hermes gateway for investigations and shared Team chat. Plow's line credential supplies the Latch connection. The selected model provider supplies inference. Phone delivery remains the separate approved-delivery bridge.

## Latch

Connect the existing line using Settings or `python3 integrations/plow/connect.py`. Then run `python3 integrations/hermes-assessment/runtime.py enable-latch`. Stop the gateway after active work finishes and restart it with `python3 integrations/hermes-assessment/runtime.py gateway`.

The connector enables file reads, skill listing/reading, Mac permission status and pending-result retrieval. Each boot rechecks the configured line and owner-chat grant. Credentials and relay URLs enter only the gateway environment. Write, shell, browser and message tools are not added to the assessment profile. macOS permissions and any Latch approval still apply to a read.

## Team chat

The saved Team connection needs a running worker. If no private connection file exists, create it once with `./relay reach chat-connect`. This command replaces an existing bridge credential, so do not run it merely to restart an already-configured worker.

In the private Hermes `config.yaml`, set `gateway.api_server.max_concurrent_runs` to `1`, preserving all other settings, and restart the gateway. Then run:

```sh
python3 integrations/reach/hermes_chat.py
```

The worker uses the existing `.data/reach/chat-bridge.json` and dedicated Hermes API key. It checks for pending requests every five seconds and starts no model request while idle. Each request keeps its admission identity, real run ID, actual model response and reply identity in `.data/reach/chat-worker`, with owner-only permissions. Restarting reuses those identities. The last five delivered request/reply pairs provide shared conversation history.

Only a completed, nonempty response within the API's 8,000-character limit is posted. Provider failures and partial responses are retained as blocked records, never invented assistant replies. Uncertain admission older than one hour needs manual reconciliation. Runs exceeding three minutes receive a cooperative stop request; that is not a cost ceiling. Before retrying a blocked record, inspect its run in Hermes and confirm whether it started or stopped. Do not delete unresolved state to force a new run.

Chat requests are untrusted conversational context, not execution approval. The worker instructs Hermes to answer from supplied conversation without tools. The gateway retains its configured tool permissions; the prompt is not a separate security sandbox. Use the dedicated read-scoped profile, and do not attach unrestricted command or message tools to a gateway serving invited teammates.

The worker heartbeat reports runtime reachability. A saved key or heartbeat does not establish provider credit or a successful response. Inspect the actual response and run receipt. Stopping the worker leaves queued requests intact and its heartbeat expires after 60 seconds.

## Start on macOS login

The local installation can run the gateway and worker as user LaunchAgents, with absolute program paths, the repository as working directory and logs under `.data`. No credential belongs in a plist. The gateway must launch through `runtime.py gateway`, which rechecks the current Plow grant, rather than directly through `hermes gateway`.

Use labels `com.reprorelay.hermes` and `com.reprorelay.chat`. KeepAlive restarts a crashed process; throttle restarts by at least 30 seconds. Run only one gateway and one chat worker. The worker holds a process lock to prevent duplicate consumers. These are user-login services, not services that run while the Mac is powered off or logged out.
