"""Explicit local setup for the consented Discord notes/Team bridge profile."""
import json
from pathlib import Path
import sys
import urllib.request
import launch


def request(method, path, headers=None):
    req = urllib.request.Request('http://127.0.0.1:8178/api/v1' + path, method=method,
        headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:8178', **(headers or {})},
        data=b'{}' if method == 'POST' else None)
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(req, timeout=10) as response: return json.loads(response.read(1_000_000))


def validate_profile(config):
    if config.get('platform_toolsets',{}).get('api_server') != ['relay_evidence']:
        raise ValueError('Call notes require the connected read-only Hermes profile.')
    servers=config.get('mcp_servers',{})
    if set(servers) != {'relay_evidence'} or servers['relay_evidence'].get('args') != ['/app/integrations/relay-tools/server.py'] or servers['relay_evidence'].get('command')!='/usr/local/bin/python3':
        raise ValueError('Call notes require the packaged read-only evidence server, without additional MCP servers.')
    if any(config.get('memory',{}).get(key) is not False for key in ('memory_enabled','user_profile_enabled')):
        raise ValueError('The dedicated call-notes profile must have automatic memory disabled.')


def main():
    with launch.provider_setup.locked(launch.STATE):
        validate_profile(launch.provider_setup.read_json(launch.STATE/'config.yaml'))
    # A local admin is required. This does not create an external account.
    request('POST','/account/local')
    path=launch.ROOT / '.data/reach/chat-bridge.json'
    if path.exists():
        saved=launch.provider_setup.read_json(path)
        request('GET','/chat/pending',{'X-Relay-Chat-Key':saved['token']})
    else:
        if request('GET','/chat').get('configured'):
            raise ValueError('An existing chat bridge has no matching local credential. Preserve it; restore its connection file before enabling notes.')
        launch.provider_setup.private_write(path,request('POST','/chat/bridge'))
    with launch.provider_setup.locked(launch.STATE):
        config=launch.provider_setup.read_json(launch.STATE/'config.yaml')
        validate_profile(config)
        config.setdefault('gateway',{}).setdefault('api_server',{})['max_concurrent_runs']=1
        launch.provider_setup.private_write(launch.STATE/'config.yaml',config)
    print('Team bridge prepared. Starting its worker processes authorized Team requests when Hermes is available. Provider authorization remains in Settings → Models.')


if __name__ == '__main__':
    try: main()
    except Exception:
        print('Notes setup failed. Check the existing local Team bridge and dedicated read-only Hermes profile. Do not paste credentials.',file=sys.stderr)
        sys.exit(1)
