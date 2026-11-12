#!/bin/bash
# One home, step 6 (lock), checked from the Mac the way a device on the Wi-Fi sees the house: system DNS, system
# certificate trust, never --insecure or --resolve.
#   ready:  the names resolve and the gate is trusted, so the old addresses can close.
#   locked: also, every old IP:port refuses, browsers on http://10.0.0.80 go to the gate, machine paths still work.
# Usage: bash deploy/lock-check.sh ready|locked
set -uo pipefail
MODE=${1:-}
case "$MODE" in ready|locked) ;; *) echo "usage: $0 ready|locked" >&2; exit 2 ;; esac
PI=10.0.0.80
fail=0
say() { printf '%-44s %s\n' "$1" "$2"; [ "$2" = ok ] || fail=1; }
code() { curl -s --max-time 5 -o /dev/null -w '%{http_code}' "$@"; }

HUB=hub.rahe-home.duckdns.org
ip=$(dig +short +time=2 +tries=1 $HUB | tail -1)
case "$ip" in "$PI"|100.92.174.18) say "$HUB resolves to the Pi" ok ;; *) say "$HUB resolves to the Pi" "got '${ip:-nothing}'" ;; esac
r=$(code https://$HUB/healthz)
[ "$r" = 200 ] && say "https://$HUB trusted and up" ok || say "https://$HUB trusted and up" "got $r"
r=$(code "http://$PI/api/now")
case "$r" in 200|401|403) say "http://$PI/api/now still served" ok ;; *) say "http://$PI/api/now still served" "got $r" ;; esac
r=$(code "http://$PI/home-ca.crt")
[ "$r" = 200 ] && say "http://$PI/home-ca.crt" ok || say "http://$PI/home-ca.crt" "got $r"

if [ "$MODE" = locked ]; then
  for p in 3000 3001 3002 7745 8099 8581 9090 9100 9115 9120 9898; do
    r=$(code "http://$PI:$p/")
    [ "$r" = 000 ] && say "$PI:$p closed" ok || say "$PI:$p closed" "answered $r"
  done
  r=$(code http://10.0.0.81:8010/)
  [ "$r" = 000 ] && say "Paperless 10.0.0.81:8010 closed" ok || say "Paperless 10.0.0.81:8010 closed" "answered $r"
  r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{redirect_url}' "http://$PI/workshop")
  [ "$r" = "308 https://$HUB/workshop" ] && say "old address → same page on the gate" ok || say "old address → same page on the gate" "got $r"
  for path in /api/shortcut/x /api/webhook/bambuddy /api/now/poster/0.jpg; do
    r=$(code "http://$PI$path")
    case "$r" in 000|301|302|307|308) say "http://$PI$path still served" "got $r" ;; *) say "http://$PI$path still served" ok ;; esac
  done
  # Bambuddy keeps :8000 for an allow-list (the PC, the Mac, the Pi): say which side this Mac is on.
  me=$(ipconfig getifaddr en0 2>/dev/null || true)
  r=$(code "http://$PI:8000/")
  printf '%-44s %s\n' "Bambuddy :8000 from this Mac (${me:-?})" "$([ "$r" = 000 ] && echo closed || echo "open ($r)")"
fi
exit $fail
