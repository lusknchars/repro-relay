#!/bin/sh
# Is this machine clean enough for a fresh install to mean something?
#
# Run it before testing the install as a new person would experience it. A macOS
# user account of its own gives a clean HOME, which covers the first three
# checks. Docker is shared by every user on the machine, so the fourth is the
# one that catches a previous install you forgot about.
#
#     sh agent/check-clean.sh
#
# It only looks. It changes nothing, and it never prints a token.

clean=yes
note() { printf '%-34s %s\n' "$1" "$2"; }

sign_in="${XDG_CONFIG_HOME:-$HOME/.config}/plow/token"
if [ -e "$sign_in" ]; then
    note "Plow account sign in" "FOUND at $sign_in"
    clean=no
else
    note "Plow account sign in" "clean"
fi

if [ -e agent/plow-credentials ]; then
    note "agent credential in this checkout" "FOUND at agent/plow-credentials"
    clean=no
else
    note "agent credential in this checkout" "clean"
fi

if [ -d .data/agent ] && [ -n "$(ls -A .data/agent 2>/dev/null)" ]; then
    note "install state" "FOUND in .data/agent"
    clean=no
else
    note "install state" "clean"
fi

if command -v docker >/dev/null 2>&1; then
    containers=$(docker ps -a --format '{{.Names}}' 2>/dev/null | grep -E -- '-agent-1$' | tr '\n' ' ')
    volumes=$(docker volume ls --format '{{.Name}}' 2>/dev/null | grep -E -- '_agent-home$' | tr '\n' ' ')
    if [ -n "$containers" ] || [ -n "$volumes" ]; then
        # Shared by every user on this machine, so a new macOS user inherits these.
        [ -n "$containers" ] && note "docker containers (whole machine)" "FOUND: $containers"
        [ -n "$volumes" ] && note "docker memory volumes" "FOUND: $volumes"
        clean=no
    else
        note "docker agent state" "clean"
    fi
    docker info >/dev/null 2>&1 || note "docker daemon" "NOT RUNNING, the install needs it open"
else
    note "docker" "NOT INSTALLED, the install needs Docker Desktop"
    clean=no
fi

echo
if [ "$clean" = yes ]; then
    echo "Clean. A fresh install here reproduces what a new person sees."
else
    echo "Not clean. The FOUND lines above are what a fresh install would inherit."
    echo "A Plow sign in or a credential makes the installer resume instead of starting over."
    echo "A docker volume holds an agent's memory: check what it belongs to before removing it."
fi
