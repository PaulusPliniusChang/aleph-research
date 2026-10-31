#!/usr/bin/env bash
# Reproduce the isolated DSH lab: a private DSH_HOME, a web profile, the
# plugin bundle and a toy leader workspace. The current DSH profile is not used.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lab="${1:-/tmp/aleph-dsh-lab}"
port="${2:-39871}"

export DSH_HOME="$lab"
export HOME="$lab/home"
export ALEPH_HOME="$HOME/.aleph"
mkdir -p "$HOME"

dsh --profile aleph-lab --from-default-profile web --help >/dev/null
dsh plugin --profile aleph-lab add "$repo/dsh-plugin" >/dev/null
"$repo/aleph" init "$lab/leader" --title "Lab campaign" --json >/dev/null
"$repo/aleph" run --workspace "$lab/leader" --max 3 --json >/dev/null

echo "isolated DSH_HOME: $DSH_HOME"
echo "leader workspace:  $lab/leader"
echo "start:             DSH_HOME=$DSH_HOME HOME=$HOME dsh --profile aleph-lab --no-open --host 127.0.0.1 --port $port"
