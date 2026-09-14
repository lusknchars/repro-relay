"""Dedicated Hermes assessment runtime. Credentials remain in .data, never in web env."""
import argparse
import json
import os
from pathlib import Path
import secrets
import sys

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / ".data/hermes-assessment"
INSTALL = Path.home() / ".local/share/repro-relay/hermes-agent"


def private_write(path, value):
    with path.open("x", encoding="utf-8") as stream:
        os.chmod(path, 0o600)
        stream.write(value)


def setup():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(STATE, 0o700)
    if not (STATE / ".env").exists():
        private_write(STATE / ".env", "API_SERVER_KEY=" + secrets.token_hex(32)
                      + "\nAPI_SERVER_HOST=127.0.0.1\nAPI_SERVER_PORT=8642\n")
    if not (STATE / "config.yaml").exists():
        config = {
            "model": {"provider": "openai-codex", "default": "gpt-5.4"},
            "agent": {"max_turns": 20},
            "tools": {"tool_search": {"enabled": "off"}},
            "platform_toolsets": {"api_server": ["relay_assessment"], "cli": ["relay_assessment"]},
            "memory": {"memory_enabled": False, "user_profile_enabled": False},
            "mcp_servers": {"relay_assessment": {
                "command": sys.executable,
                "args": [str(ROOT / "integrations/hermes-assessment/server.py"),
                         "--packet", str(STATE / "packet.json")],
                "sampling": {"enabled": False},
            }},
        }
        # JSON is valid YAML, and avoids another dependency in this launcher.
        private_write(STATE / "config.yaml", json.dumps(config, indent=2) + "\n")
    print("Assessment profile prepared. Existing settings and credentials were preserved.")


def environment():
    env = os.environ.copy()
    env["HERMES_HOME"] = str(STATE)
    return env


def enable_memory():
    """Add the scoped memory MCP tools without replacing existing runtime settings."""
    path = STATE / 'config.yaml'
    config = json.loads(path.read_text())
    expected = {'command': sys.executable,
                'args': [str(ROOT / 'integrations/mem0-memory/memory.py'), 'serve', '--agent', 'hermes'],
                'sampling': {'enabled': False}}
    servers = config.setdefault('mcp_servers', {})
    if 'relay_memory' in servers and servers['relay_memory'] != expected:
        raise ValueError('A different relay_memory server already exists; it was preserved.')
    servers['relay_memory'] = expected
    for platform in ('api_server', 'cli'):
        tools = config.setdefault('platform_toolsets', {}).setdefault(platform, [])
        if 'relay_memory' not in tools:
            tools.append('relay_memory')
    temporary = path.with_suffix('.memory.tmp')
    private_write(temporary, json.dumps(config, indent=2) + '\n')
    temporary.replace(path)
    print('Hermes memory tools configured. Restart the gateway to load them. Provider sign-in remains separate.')


def has_auth():
    # This check establishes presence only. The provider still validates the login.
    path = STATE / "auth.json"
    if not path.exists():
        return False
    store = json.loads(path.read_text())
    return bool(store.get("providers", {}).get("openai-codex")
                or store.get("credential_pool", {}).get("openai-codex"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["setup", "login", "gateway", "dev", "enable-memory"])
    args = parser.parse_args()
    if args.action == "setup":
        setup()
        return
    if args.action == 'enable-memory':
        enable_memory()
        return
    executable = INSTALL / ".venv/bin/hermes"
    if not executable.is_file() or not (STATE / "config.yaml").is_file():
        raise SystemExit("Install the pinned Hermes release and run runtime.py setup. See README.md.")
    env = environment()
    if args.action == "login":
        os.execve(executable, [str(executable), "auth", "add", "openai-codex", "--type", "oauth", "--no-browser"], env)
    if not has_auth():
        raise SystemExit("Hermes needs its own sign-in. Run: python3 integrations/hermes-assessment/runtime.py login")
    if not (STATE / "packet.json").is_file():
        raise SystemExit("Capture the assessment evidence first. See README.md.")
    if args.action == "gateway":
        os.chdir(STATE)
        os.execve(executable, [str(executable), "gateway"], env)
    # Backend setting only: this is not a VITE_ variable or browser configuration.
    values = dict(line.split("=", 1) for line in (STATE / ".env").read_text().splitlines() if "=" in line)
    env["REPRO_HERMES_URL"] = "http://127.0.0.1:8642"
    env["REPRO_HERMES_KEY"] = values["API_SERVER_KEY"]
    os.chdir(ROOT)
    os.execvpe("make", ["make", "dev"], env)


if __name__ == "__main__":
    main()
