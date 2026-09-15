"""Private model selection for Relay's dedicated Hermes profile. No provider requests."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shlex
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
STATE = ROOT / '.data/hermes-assessment'
PROVIDERS = {
    'openai-api': {'name': 'OpenAI API', 'base_url': 'https://api.openai.com/v1', 'keys': ['OPENAI_API_KEY'], 'base_env': 'OPENAI_BASE_URL'},
    'anthropic': {'name': 'Anthropic / Claude', 'base_url': 'https://api.anthropic.com', 'keys': ['ANTHROPIC_API_KEY', 'ANTHROPIC_TOKEN'], 'base_env': 'ANTHROPIC_BASE_URL'},
    'kimi-coding': {'name': 'Moonshot / Kimi API', 'base_url': 'https://api.moonshot.ai/v1', 'keys': ['KIMI_API_KEY', 'KIMI_CODING_API_KEY'], 'base_env': 'KIMI_BASE_URL'},
    'openrouter': {'name': 'OpenRouter', 'base_url': 'https://openrouter.ai/api/v1', 'keys': ['OPENROUTER_API_KEY'], 'base_env': 'OPENROUTER_BASE_URL'},
}


def read_json(path):
    if not path.exists():
        return {}
    if path.is_symlink() or path.stat().st_size > 524288:
        raise ValueError('Profile file is unsupported; inspect it locally.')
    try:
        value = json.loads(path.read_text())
    except (ValueError, UnicodeError):
        raise ValueError('This editor requires the JSON-format profile created by Relay. Use Hermes configuration for a custom YAML profile.') from None
    if not isinstance(value, dict):
        raise ValueError('Invalid Hermes profile object.')
    return value


def private_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as stream:
            name = stream.name
            os.chmod(name, 0o600)
            json.dump(value, stream, indent=2)
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        if name and os.path.exists(name): os.unlink(name)


@contextlib.contextmanager
def locked(state):
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(state, 0o700)
    with (state / 'provider.lock').open('a+b') as lock:
        os.chmod(state / 'provider.lock', 0o600)
        if os.name == 'nt':
            import msvcrt
            if lock.tell() == 0: lock.write(b'0'); lock.flush()
            lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
        try: yield
        finally:
            if os.name == 'nt':
                lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
            else: fcntl.flock(lock, fcntl.LOCK_UN)


def profile_env(state):
    path = state / '.env'
    if not path.exists(): return {}
    if path.stat().st_size > 65536: raise ValueError('Profile environment exceeds 64 KiB.')
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'): continue
        key, sep, value = line.removeprefix('export ').partition('=')
        if not sep: continue
        try: parts = shlex.split(value, comments=True)
        except ValueError: raise ValueError('Invalid private profile environment quoting.') from None
        if len(parts) == 1: values[key.strip()] = parts[0]
    return values


def snapshot(state):
    config = read_json(state / 'config.yaml')
    saved = read_json(state / 'model-provider.json')
    revision = hashlib.sha256(json.dumps([config, saved], sort_keys=True).encode()).hexdigest()
    return config, saved, revision


def credential(state, provider, saved):
    if saved.get('provider') == provider and saved.get('api_key'): return saved['api_key']
    values = profile_env(state)
    return next((values[k] for k in PROVIDERS.get(provider, {}).get('keys', []) if values.get(k)), '')


def status(state=STATE):
    config, saved, revision = snapshot(state)
    model = config.get('model', {})
    if not isinstance(model, dict): raise ValueError('Unsupported Hermes model configuration.')
    selected = saved or {'provider': model.get('provider', ''), 'model': model.get('default', '')}
    available = [{'id': key, 'name': p['name'], 'credential_saved': bool(credential(state, key, saved))} for key, p in PROVIDERS.items()]
    return {'revision': revision, 'profile_exists': bool(config), 'managed': bool(saved),
            'provider': selected.get('provider', ''), 'model': selected.get('model', ''),
            'credential_saved': bool(credential(state, selected.get('provider'), saved)),
            'providers': available, 'model_access_verified': False,
            'mcp_servers': sorted(str(k) for k in config.get('mcp_servers', {})),
            'activation': 'Restart the dedicated Hermes gateway to load this selection. A running gateway may still use its previous model.'}


def validate_profile(config):
    if not isinstance(config.get('model'), dict):
        raise ValueError('Use the dedicated Relay Hermes profile with a model object.')
    scopes = config.get('platform_toolsets')
    if not isinstance(scopes, dict) or not isinstance(scopes.get('api_server'), list) or not all(isinstance(t, str) for t in scopes['api_server']):
        raise ValueError('This profile has no explicit API tool scope. Configure its tool allowlist in Hermes before saving a model.')


def save(value, state=STATE):
    if not isinstance(value, dict) or set(value) != {'revision', 'provider', 'model', 'api_key'}:
        raise ValueError('Provide a revision, provider, model and optional API key.')
    provider = value['provider']; model = value['model']; key = value['api_key']
    if not isinstance(provider, str) or provider not in PROVIDERS: raise ValueError('Choose a supported API provider.')
    if not isinstance(model, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,159}', model): raise ValueError('Enter the model ID from your provider account.')
    if key is not None and (not isinstance(key, str) or not re.fullmatch(r'[!-~]{8,4096}', key)):
        raise ValueError('Enter a valid API key without spaces or line breaks.')
    with locked(state):
        config, saved, revision = snapshot(state)
        if value['revision'] != revision: raise ValueError('Model settings changed. Reload settings and review before saving.')
        key = key or credential(state, provider, saved)
        if not key: raise ValueError('Add an API key for this provider. Credentials from another provider cannot be reused.')
        if provider == 'anthropic' and key.startswith('sk-ant-oat'):
            raise ValueError('Use an Anthropic API key here. Configure Claude account sign-in in its own client.')
        if provider == 'kimi-coding' and key.startswith('sk-kimi-'):
            raise ValueError('This option uses the Moonshot API. Kimi Code subscription credentials need the Kimi Code endpoint in Hermes configuration.')
        if not config and (state / 'config.yaml').exists():
            raise ValueError('The existing Hermes profile is empty. Configure its tool allowlist before saving a model.')
        if not config:
            import runtime
            previous = runtime.STATE
            try:
                runtime.STATE = state
                with contextlib.redirect_stdout(io.StringIO()): runtime.setup()
            finally: runtime.STATE = previous
            config = read_json(state / 'config.yaml')
        validate_profile(config)
        private_write(state / 'model-provider.json', {'provider': provider, 'model': model, 'api_key': key})
        return status(state)


def apply_runtime(state, env):
    """Called only on gateway launch. Preserve MCP scope; never start or restart a process."""
    with locked(state):
        config, saved, _ = snapshot(state)
        if not saved: return
        validate_profile(config)
        provider = saved.get('provider'); model = saved.get('model')
        if provider not in PROVIDERS or not isinstance(model, str): raise ValueError('Invalid saved model selection.')
        key = credential(state, provider, saved)
        if not key: raise ValueError('Saved provider credential is missing.')
        p = PROVIDERS[provider]
        # Clear prior provider transport overrides; retain non-provider model preferences.
        existing = config.setdefault('model', {})
        for field in ('api_key', 'api_mode', 'auth_mode', 'key_env', 'api_key_env'): existing.pop(field, None)
        existing.update({'provider': provider, 'default': model, 'base_url': p['base_url']})
        private_write(state / 'config.yaml', config)
        for name in p['keys']: env.pop(name, None)
        if provider == 'anthropic': env.pop('CLAUDE_CODE_OAUTH_TOKEN', None)
        env[p['keys'][0]] = key
        env[p['base_env']] = p['base_url']


if __name__ == '__main__':
    try:
        action = sys.argv[1] if len(sys.argv) == 2 else ''
        if action == 'status': result = status()
        elif action == 'save':
            raw = sys.stdin.read(16385)
            if len(raw) > 16384: raise ValueError('Model settings exceed the request limit.')
            result = save(json.loads(raw))
        else: raise ValueError('Choose status or save.')
        print(json.dumps({'ok': True, 'data': result}))
    except ValueError as e:
        print(json.dumps({'ok': False, 'error': str(e) if not isinstance(e, json.JSONDecodeError) else 'Invalid model settings JSON.'}))
    except (OSError, TypeError, KeyError):
        print(json.dumps({'ok': False, 'error': 'Model setup could not read or save the private profile. Check local file access.'}))
