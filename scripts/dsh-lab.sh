#!/usr/bin/env bash
# Reproduce the isolated DSH lab: a private DSH_HOME, a web profile, the
# plugin bundle and a toy leader workspace. The current DSH profile is not used.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lab="${1:-/tmp/aleph-dsh-lab}"
port="${2:-39871}"

export DSH_HOME="$lab"
export HOME="$lab/home"
mkdir -p "$HOME" "$lab/leader"

dsh --profile aleph-lab --from-default-profile web --help >/dev/null
(cd "$repo/dsh-plugin" && npm install --no-save --silent)
dsh plugin --profile aleph-lab add "$repo/dsh-plugin" >/dev/null

echo "isolated DSH_HOME: $DSH_HOME"
echo "leader workspace:  $lab/leader"
echo "start:             DSH_HOME=$DSH_HOME HOME=$HOME dsh --profile aleph-lab --no-open --host 127.0.0.1 --port $port"
