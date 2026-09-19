#!/bin/sh
# Everything needed to say why an install stopped, in one screen, with no secrets.
#
#     sh agent/doctor.sh
#
# It only looks. It changes nothing, and it never prints a token or a key: files
# are reported by name, permission and size, never by content.

line() { printf '%-32s %s\n' "$1" "$2"; }
mode() { ls -l "$1" 2>/dev/null | awk '{print $1, $3}'; }

echo "=== this machine ==="
line "system" "$(uname -s) $(uname -r)"
line "python3" "$(python3 --version 2>&1 || echo missing)"
line "git" "$(git --version 2>&1 | head -1 || echo missing)"
if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then
        line "docker" "running"
    else
        line "docker" "INSTALLED BUT NOT RUNNING, open Docker Desktop"
    fi
else
    line "docker" "MISSING, install Docker Desktop"
fi

echo
echo "=== credentials, by permission only ==="
sign_in="${XDG_CONFIG_HOME:-$HOME/.config}/plow/token"
if [ -e "$sign_in" ]; then
    line "plow sign in" "$(mode "$sign_in")"
    case "$(ls -l "$sign_in" | cut -c1-10)" in
        -rw-------) : ;;
        *) line "" "WRONG MODE, run: chmod 600 $sign_in" ;;
    esac
else
    line "plow sign in" "none"
fi
if [ -e agent/plow-credentials ]; then
    line "agent credential" "$(mode agent/plow-credentials)"
    case "$(ls -l agent/plow-credentials | cut -c1-10)" in
        -rw-------) : ;;
        *) line "" "WRONG MODE, run: chmod 600 agent/plow-credentials" ;;
    esac
else
    line "agent credential" "none"
fi
[ -e agent/.env ] && line "agent/.env" "$(mode agent/.env), holds: $(sed -E 's/=.*//' agent/.env | tr '\n' ' ')"

echo
echo "=== what this account holds ==="
if [ -x .data/tools/plow-agents ] || [ -f .data/tools/plow-agents ]; then
    python3 .data/tools/plow-agents lines 2>&1 | head -6
else
    line "plow client" "not downloaded yet, the installer fetches it"
fi

echo
echo "=== docker, shared by every user on this machine ==="
docker ps -a --format '{{.Names}}  {{.State}}  {{.Label "com.docker.compose.project"}}' 2>/dev/null | head -6
docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E -- '_agent-home$' | head -4

echo
echo "=== how the last install ended ==="
if [ -f .data/agent/install.log ]; then
    line "install.log" "$(mode .data/agent/install.log)"
    tail -12 .data/agent/install.log
else
    line "install.log" "none, no install has failed here yet"
fi
