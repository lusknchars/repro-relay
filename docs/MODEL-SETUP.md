# Model providers and Plow Latch

Plow Latch supplies tools to an MCP-compatible agent. The agent's model provider supplies inference. Connecting a phone line, authenticating a model provider and connecting MCP tools are separate operations.

Plow lists Claude, Codex, OpenClaw, Hermes and other MCP-compatible agents as supported clients. This does not mean every raw model API is itself an MCP client. Your agent software must implement that connection. See [Plow Latch](https://plow.co/latch) and its [implementation](https://github.com/plow-pbc/latch).

## Configure the model used by Relay's Hermes

1. Open **Settings → Model providers**, or **Configure Hermes model provider** under Plow + Latch or Hermes.
2. Choose **OpenAI API**, **Anthropic / Claude**, **Moonshot / Kimi API**, or **OpenRouter**.
3. Enter the exact model ID available in that provider account and its API key. If this provider already has a key in the dedicated profile, leaving the field blank preserves it.
4. Choose **Save Hermes model**. The page confirms a saved selection. It does not call a provider or validate credits, model entitlement or successful inference.
5. Wait for active runs to finish, stop the dedicated Hermes gateway in its terminal, then start it again:

```sh
python3 integrations/hermes-assessment/runtime.py gateway
```

The launcher applies the saved provider and model at gateway start, preserving the existing MCP servers, tool allowlists, memory preferences and gateway identity. It passes the selected private API key to that process. The running gateway is not restarted or reconfigured by Save. Runtime availability is displayed separately and does not identify which model an already-running process loaded.

The first save prepares the dedicated profile if it does not exist. It does not install Hermes, capture an assessment packet, create a background service or grant Mac/phone access. Follow [Hermes runtime setup](../integrations/hermes-assessment/README.md) for those prerequisites. Profiles without an explicit API-server tool allowlist are refused, so selecting a model cannot enable default unrestricted tools. Configurations created as custom non-JSON YAML must be edited with Hermes's own configuration tools; Relay refuses to rewrite them.

Credentials and model choice are stored together in `.data/hermes-assessment/model-provider.json`, mode `0600`, with atomic replacement and a version check against the current profile. They never enter browser storage, URLs or process arguments. Only the local administrator can use this editor. Hosted and guest workspaces cannot read or change this local profile. Reloading model settings replaces an unsaved form; a stale save is refused.

This editor stores one selected provider credential. Replacing it with another provider replaces that selected credential. Existing independent credentials in the profile's `.env` remain available. The provider cannot reuse another provider's key. The selected key and fixed provider endpoint take precedence over inherited variables for that provider when using the Relay launcher. Launching `hermes gateway` directly bypasses this saved-selection step.

Current endpoints are the standard OpenAI API, Anthropic API, Moonshot international API and OpenRouter API. Custom endpoints and other Hermes providers remain available through Hermes configuration. Kimi Code subscription tokens use a different endpoint and are rejected by the Moonshot option. Claude OAuth tokens are rejected by the Anthropic API-key field. Existing Codex account sign-in is preserved until you explicitly save an API-provider selection.

To return to native Hermes provider configuration, stop the gateway, move `model-provider.json` out of the profile to a private location, configure the provider through Hermes and restart. Never commit this file or its backup.

## Use another agent with Latch

Use Plow's connection setup with your chosen MCP client. Authenticate Claude, Codex, Pi or another agent in that client's own settings. Review the Mac access requested by Latch. A successful Relay phone-line check does not establish that the agent's MCP connection works.

Relay's model form configures the dedicated Hermes runtime only. It does not log into Claude or Codex, configure Pi, attach Latch to Hermes, expand the assessment tool allowlist or send messages. The model setup screen lists configured MCP server names without returning private URLs or tokens. Listing a server is not a live connectivity test.

## Validation

Python tests cover private storage, first setup, each provider's launch environment, preserved MCP scope, stale writes, key reuse, subscription-token rejection and unsupported profiles. The Rust guard rejects hosted/guest access. Browser tests cover the route from Plow, model selection, key clearing, stale-save recovery and narrow layouts with API fixtures. No live provider request or Latch operation is performed by these checks.
