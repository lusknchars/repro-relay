#!/bin/sh
# Double-click this file on macOS after opening Docker Desktop.
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
sh "$ROOT/connect.sh" "$@"
result=$?
if [ "$result" -ne 0 ]; then
  printf '\nPress Return to close.\n'
  read -r answer
fi
exit "$result"
