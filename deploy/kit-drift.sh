#!/bin/bash
# Prints where Pi Hub's copy of the appliance-ui kit stands (appliance-ui's scripts/drift.mjs, from a fresh shallow clone).
# Warn-only: always exits 0, even for a modified or behind copy, until KIT_DRIFT_ENFORCE=1 makes the kit's exit 1 fail it.
# Never fails for the network: no clone, no node or gh, no drift.mjs on the kit's main yet, or a drift that prints nothing prints "unavailable" and exits 0.
# Usage: bash deploy/kit-drift.sh   (deploy/install.sh runs it first)
set -uo pipefail
KIT_URL=${KIT_DRIFT_URL:-https://github.com/azmusgb/appliance-ui}
unavailable() { echo "kit drift check unavailable: $1"; exit 0; }
for c in git node gh; do command -v "$c" >/dev/null 2>&1 || unavailable "$c not found"; done
tmp=$(mktemp -d) || unavailable "no temp dir"
trap 'rm -rf "$tmp"' EXIT
# No `timeout` on macOS: git itself gives up after 30 s below 1 kB/s. GIT_TERMINAL_PROMPT=0 so a private kit never prompts.
GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=30 clone --depth 1 -q "$KIT_URL" "$tmp/kit" 2>/dev/null || unavailable "could not clone $KIT_URL"
[ -f "$tmp/kit/scripts/drift.mjs" ] || unavailable "scripts/drift.mjs is not on the kit's main yet"
line=$(node "$tmp/kit/scripts/drift.mjs" --only pi-hub 2>&1); code=$?
[ -n "$line" ] || unavailable "drift printed nothing"
case "$code" in
  0) echo "$line" ;;
  1) echo "$line"; [ "${KIT_DRIFT_ENFORCE:-}" = 1 ] && exit 1 ;;
  *) unavailable "drift.mjs exited $code: ${line%%$'\n'*}" ;;
esac
exit 0
