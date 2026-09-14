"""One bounded, read-only call through Relay's shared evidence contract."""
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'integrations/relay-tools'))
from server import API, execute  # noqa: E402


def main():
    if len(sys.argv) != 4 or len(sys.argv[3]) > 4096:
        raise ValueError('Expected a local API, tool name and bounded JSON arguments.')
    result = execute(API(sys.argv[1]), sys.argv[2], json.loads(sys.argv[3]))
    encoded = json.dumps(result, ensure_ascii=True, separators=(',', ':'))
    if len(encoded) > 256 * 1024:
        raise ValueError('Evidence exceeds 256 KiB. Request fewer records or files.')
    print(encoded)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError):
        print('Could not read Relay evidence. Check the local API and tool arguments.', file=sys.stderr)
        sys.exit(1)
