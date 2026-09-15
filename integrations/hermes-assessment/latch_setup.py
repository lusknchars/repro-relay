"""Connect the dedicated Hermes profile to its existing Plow line's Latch tools."""
import sys
from pathlib import Path
from urllib.parse import urlsplit

import provider_setup

ROOT = Path(__file__).resolve().parents[2]
SERVER = 'plow_latch'
READ_TOOLS = ['plow_read_file', 'plow_list_skills', 'plow_read_skill',
              'plow_device_status', 'plow_get_result']


def connection():
    # Reuse the bridge's credential ownership and exact owner-chat checks.
    sys.path.insert(0, str(ROOT / 'integrations/plow'))
    from bridge import from_config, BridgeError
    try:
        bridge = from_config(ROOT / '.data/plow/bridge.json')
        bridge.granted_chat()
        _, identity = bridge.plow.call('GET', '/v1/agents/cloud/me')
        if identity.get('line', {}).get('uid') != bridge.line:
            raise ValueError('Plow credential does not match the configured line.')
        url = identity.get('mcp_url')
        parsed = urlsplit(url) if isinstance(url, str) else None
        if (not parsed or parsed.scheme != 'https' or parsed.hostname != 'api.plow.co'
                or parsed.username or parsed.password or parsed.port not in (None, 443)
                or parsed.fragment):
            raise ValueError('Plow did not advertise a supported Latch endpoint. Connect this Mac in Plow Latch first.')
        return {'url': url, 'token': bridge.plow.token}
    except BridgeError as error:
        raise ValueError(str(error)) from None


def server_config():
    return {'url': '${RELAY_PLOW_MCP_URL}',
            'headers': {'Authorization': 'Bearer ${RELAY_PLOW_AGENT_TOKEN}'},
            'strict_redirect_headers': True,
            'tools': {'include': list(READ_TOOLS)},
            'sampling': {'enabled': False}}


def enable(state=provider_setup.STATE):
    connection()  # Check current authorization before editing the profile.
    with provider_setup.locked(state):
        config = provider_setup.read_json(state / 'config.yaml')
        provider_setup.validate_profile(config)
        servers = config.setdefault('mcp_servers', {})
        if not isinstance(servers, dict):
            raise ValueError('Invalid MCP server configuration; existing profile preserved.')
        expected = server_config()
        if SERVER in servers and servers[SERVER] != expected:
            raise ValueError('A different plow_latch configuration exists; it was preserved.')
        for platform in ('api_server', 'cli'):
            tools = config['platform_toolsets'].get(platform)
            if not isinstance(tools, list) or not all(isinstance(t, str) for t in tools):
                raise ValueError('Explicit API and CLI tool scopes are required before connecting Latch.')
            if SERVER not in tools:
                tools.append(SERVER)
        servers[SERVER] = expected
        provider_setup.private_write(state / 'config.yaml', config)
    return {'configured': True, 'scope': 'read_and_diagnostics',
            'tools': list(READ_TOOLS), 'restart_required': True}


def apply_runtime(state, env):
    """Resolve current identity on every boot; never persist the URL or token."""
    config = provider_setup.read_json(state / 'config.yaml')
    server = config.get('mcp_servers', {}).get(SERVER)
    if server is None:
        return
    if server != server_config():
        raise ValueError('Managed Latch configuration changed. Review it before starting Hermes.')
    live = connection()
    env['RELAY_PLOW_MCP_URL'] = live['url']
    env['RELAY_PLOW_AGENT_TOKEN'] = live['token']
