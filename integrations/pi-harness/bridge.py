"""One bounded, read-only call through Relay's shared evidence contract."""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'integrations/relay-tools'))
from server import API, execute  # noqa: E402
from context import approved_context  # noqa: E402


def main():
    if len(sys.argv) != 4 or len(sys.argv[3]) > 4096:
        raise ValueError('Expected a local API, tool name and bounded JSON arguments.')
    name = sys.argv[2]
    call = approved_context if name == 'relay_approved_context' else None
    api, args = API(sys.argv[1]), json.loads(sys.argv[3])
    result = call(api, args) if call else execute(api, name, args)
    if name == 'relay_inspect_work':
        result['review_url'] = '/?view=harness&harness-section=repository&audit=' + args['audit_id']
    encoded = json.dumps(result, ensure_ascii=True, separators=(',', ':'))
    limit = 2 * 1024 * 1024 if call else 256 * 1024
    if len(encoded) > limit:
        raise ValueError('Evidence exceeds the output limit.')
    print(encoded)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError):
        print('Could not read Relay evidence. Check the local API and tool arguments.', file=sys.stderr)
        sys.exit(1)
