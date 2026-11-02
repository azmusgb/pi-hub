#!/bin/bash
# release:netmon (platform step 3): this deploy's report for Pi Hub, dropped in its release inbox on the Pi. Run by
# deploy.sh on the Pi, as root. Pi Hub reads the inbox and never writes it; the newest 10 netmon reports are kept.
#   release-report.sh deployed|failed <commit> <dirty: 0|1> [message]
# NETMON_REPORT_DRY_RUN=1 prints the report instead of writing it.
set -euo pipefail
INBOX=/var/lib/pi-hub-releases/inbox
[ $# -ge 3 ] || { echo "usage: $0 deployed|failed <commit> <0|1> [message]" >&2; exit 2; }

body=$(python3 - "$1" "$2" "$3" "${4:-}" <<'PY'
import json, re, sys
from datetime import datetime, timezone
result, commit, dirty, message = sys.argv[1:]
if result not in ("deployed", "failed"):
    sys.exit(f"not a result: {result}")
if not re.fullmatch(r"[0-9a-f]{7,40}", commit):
    sys.exit("no commit: deploy from a git checkout")
dirty = dirty == "1"
if dirty and result == "deployed" and not message:
    message = "deployed from uncommitted changes"
body = {"target": "netmon", "commit": commit, "result": result, "at": datetime.now(timezone.utc).isoformat(),
        "mechanism": "netmon-deploy", "message": message[:200]}
if result == "deployed":
    body["dirty"] = dirty
print(json.dumps(body))
PY
)

if [ "${NETMON_REPORT_DRY_RUN:-}" = 1 ]; then
  echo "$body"
  exit 0
fi
install -d -m 755 "$INBOX"
name="$INBOX/netmon-$(date +%s)-$$"
printf '%s\n' "$body" > "$name.json.tmp"
chmod 644 "$name.json.tmp"
mv -f "$name.json.tmp" "$name.json"
find "$INBOX" -maxdepth 1 -name 'netmon-*.json' -printf '%T@ %p\n' | sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -f
