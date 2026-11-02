#!/bin/bash
# The outside heartbeat (platform baseline D2, Healthchecks.io check home-platform-alive). Pings only when Pi Hub
# answers /healthz at its real name, through Caddy and with a valid certificate; /healthz reads the database. A failed
# check sends nothing, so Healthchecks.io's silence alarm is the only outage signal. The ping URL is a secret: it
# comes from /etc/pi-hub/healthchecks.env and is never printed.
set -uo pipefail
HUB=hub.rahe-home.duckdns.org
URL=${HC_PING_URL:-}

if ! [[ $URL =~ ^https://[A-Za-z0-9.-]+/[A-Za-z0-9_/-]+$ ]]; then
  echo "HC_PING_URL is missing or not an https URL; no heartbeat sent" >&2
  exit 2
fi
body=$(curl -sS --max-time 10 --fail --resolve "$HUB:443:127.0.0.1" "https://$HUB/healthz" 2>&1) || {
  echo "Pi Hub is not healthy (${body:-no answer}); no heartbeat sent" >&2
  exit 1
}
if [ "$body" != '{"ok":true}' ]; then
  echo "Pi Hub answered /healthz with an unexpected body; no heartbeat sent" >&2
  exit 1
fi
# The URL goes to curl on stdin, not argv, so it never shows in /proc/<pid>/cmdline. The pattern above already
# excludes quotes and backslashes, so it is safe inside curl's config syntax.
if ! printf 'url = "%s"\n' "$URL" | curl -sS --max-time 10 --retry 3 --fail -o /dev/null -K - 2>/dev/null; then
  echo "Pi Hub is healthy but the heartbeat did not reach Healthchecks.io" >&2
  exit 1
fi
