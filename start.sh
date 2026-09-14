#!/bin/sh
# Runs from a source archive or checkout. Never installs host development tools.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
action=${1:-start}
case "$action" in
  start|stop|status|logs) ;;
  *) printf '%s\n' 'Usage: ./start.sh [start|stop|status|logs]' >&2; exit 2 ;;
esac
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  printf '%s\n' 'Install Docker Desktop, open it, then run this command again.' 'https://www.docker.com/products/docker-desktop/' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf '%s\n' 'Docker is not running. Open Docker Desktop and retry.' >&2
  exit 1
fi
compose() { docker compose --env-file /dev/null -f "$ROOT/compose.local.yaml" "$@"; }
case "$action" in
  stop) compose stop; exit ;;
  status) compose ps; exit ;;
  logs) compose logs --tail 100 app; exit ;;
esac
# A host daemon can otherwise conflict with an existing installation, or expose
# the passwordless workspace on a remote Docker host. Refuse that configuration.
if [ -n "${DOCKER_CONTEXT:-}" ]; then
  endpoint=$(docker context inspect "$DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}' 2>/dev/null)
else
  endpoint=${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null)}
fi
case "$endpoint" in
  unix://*|npipe://*) ;;
  *) printf '%s\n' 'Use a local Docker Desktop/Engine context to start this personal workspace.' >&2; exit 1 ;;
esac
printf '%s\n' 'Starting Repro Relay. Your records and settings persist between starts.'
if [ -z "${RELAY_IMAGE:-}" ] && [ "${RELAY_BUILD:-0}" != 1 ]; then
  if [ -f "$ROOT/.relay-image" ]; then
    saved_image=$(cat "$ROOT/.relay-image")
    # This is data, never source/eval a local configuration file.
    if [ "$saved_image" = source ]; then
      : # Keep using this source snapshot until the user requests an update.
    elif printf '%s\n' "$saved_image" | LC_ALL=C grep -Eq '^ghcr.io/lusknchars/repro-relay@sha256:[0-9a-f]{64}$'; then
      RELAY_IMAGE=$saved_image
      export RELAY_IMAGE
    else
      printf '%s\n' 'Invalid saved image reference. Inspect .relay-image before retrying.' >&2
      exit 1
    fi
  elif docker pull ghcr.io/lusknchars/repro-relay:main; then
    RELAY_IMAGE=$(docker image inspect ghcr.io/lusknchars/repro-relay:main --format '{{index .RepoDigests 0}}')
    export RELAY_IMAGE
    printf '%s\n' "$RELAY_IMAGE" > "$ROOT/.relay-image"
  else
    printf '%s\n' 'Packaged image unavailable. Building the included source instead; no registry login is needed.'
  fi
fi
if [ -n "${RELAY_IMAGE:-}" ]; then
  ready_args=--no-build
else
  printf '%s\n' 'First start builds the app inside Docker. This can take several minutes.'
  ready_args=--build
fi
if ! compose up -d "$ready_args" --wait --wait-timeout 180; then
  printf '%s\n' 'Relay did not become ready. Your existing data was kept.' 'If port 8178 is occupied, stop the other Relay installation before retrying.' 'Inspect startup details with: ./start.sh logs' >&2
  exit 1
fi
if [ -z "${RELAY_IMAGE:-}" ]; then
  printf '%s\n' source > "$ROOT/.relay-image"
fi
printf '%s\n' 'Ready: http://127.0.0.1:8178' 'No login required. Connect an investigator in Settings when you are ready.' 'Stop: ./start.sh stop   Status: ./start.sh status'
if [ "${RELAY_NO_OPEN:-0}" != 1 ]; then
  if command -v open >/dev/null 2>&1; then
    open http://127.0.0.1:8178 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://127.0.0.1:8178 >/dev/null 2>&1 || true
  fi
fi
