#!/bin/sh
# Download a clean source snapshot and start it with Docker. No sudo or git.
set -eu
main() {
  command -v curl >/dev/null 2>&1 || { printf '%s\n' 'curl is required.' >&2; return 1; }
  command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || {
    printf '%s\n' 'Install and open Docker Desktop, then rerun this command.' 'https://www.docker.com/products/docker-desktop/' >&2
    return 1
  }
  docker info >/dev/null 2>&1 || { printf '%s\n' 'Open Docker Desktop, then retry.' >&2; return 1; }
  install_dir=${RELAY_INSTALL_DIR:-"$HOME/.local/share/repro-relay"}
  case "$install_dir" in /*) ;; *) printf '%s\n' 'RELAY_INSTALL_DIR must be an absolute path.' >&2; return 1 ;; esac
  if [ -e "$install_dir" ]; then
    if [ ! -f "$install_dir/.relay-install" ] || [ ! -f "$install_dir/start.sh" ]; then
      printf '%s\n' "Refusing to overwrite existing directory: $install_dir" >&2
      return 1
    fi
    printf '%s\n' "Reusing your installation: $install_dir"
    sh "$install_dir/start.sh"
    return
  fi
  umask 077
  parent=$(dirname -- "$install_dir")
  mkdir -p "$parent"
  # Lock makes two simultaneous installer invocations fail without replacing
  # the other installation. No automatic lock removal after a forced kill.
  lock="$install_dir.installing"
  mkdir "$lock" 2>/dev/null || { printf '%s\n' "Another install holds $lock. Check it before retrying." >&2; return 1; }
  stage=$(mktemp -d "$parent/.relay-download.XXXXXX")
  trap 'rm -rf -- "$stage"; rmdir -- "$lock"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  printf '%s\n' 'Downloading Repro Relay...'
  curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error --retry 2 --connect-timeout 15 --max-time 180 \
    https://codeload.github.com/lusknchars/repro-relay/tar.gz/refs/heads/main -o "$stage/source.tar.gz"
  mkdir "$stage/app"
  tar -xzf "$stage/source.tar.gz" --strip-components=1 -C "$stage/app"
  test -f "$stage/app/start.sh"
  printf '%s\n' 'Repro Relay Docker installation' > "$stage/app/.relay-install"
  # Recheck the destination immediately before the atomic directory rename.
  test ! -e "$install_dir"
  mv "$stage/app" "$install_dir"
  printf '%s\n' "Installed in $install_dir"
  sh "$install_dir/start.sh"
}
main "$@"
