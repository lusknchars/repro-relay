#!/bin/sh
# One command for the connected local Docker stack. Provider consent stays in Settings.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
export RELAY_CONNECTED=1
exec sh "$ROOT/start.sh" "$@"
