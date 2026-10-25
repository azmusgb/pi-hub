#!/bin/bash
# Checks the front gate on the Pi (run as root): every name refuses a signed-out visit and lets the owner in, a forged
# identity header sent to Grafana from the LAN gets nothing, and the old address still reaches the hub.
# Usage: sudo bash gate-check.sh
set -uo pipefail
CA=/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
NAMES=(assistant bambuddy paperless homebox backups network status adguard devices pi scan)
fail=0
say() { printf '%-34s %s\n' "$1" "$2"; [ "$2" = ok ] || fail=1; }
get() { curl -s --max-time 10 --cacert "$CA" --resolve "$1.home.arpa:443:127.0.0.1" -o /dev/null -w '%{http_code} %{redirect_url}' "${@:2}" "https://$1.home.arpa/"; }

# A short-lived gate token (what a signed-in owner's browser holds) for the signed-in checks, removed at the end.
TOKEN=$(python3 - <<'PY'
import hashlib, secrets, sqlite3, time
t = secrets.token_urlsafe(32); now = int(time.time())
db = sqlite3.connect("/var/lib/pi-hub/hub.db")
db.execute("INSERT INTO sessions (token_hash, role, created, expires, device) VALUES (?, 'gate', ?, ?, 'gate-check')",
           (hashlib.sha256(t.encode()).hexdigest(), now, now + 120))
db.commit(); print(t)
PY
)
trap 'python3 -c "import sqlite3; d=sqlite3.connect(\"/var/lib/pi-hub/hub.db\"); d.execute(\"DELETE FROM sessions WHERE device = ?\", (\"gate-check\",)); d.commit()"' EXIT

r=$(get home); [ "${r%% *}" = 200 ] && say "home (open)" ok || say "home (open)" "got $r"
for n in "${NAMES[@]}"; do
  r=$(get "$n")
  case "$r" in "302 https://home.home.arpa/?signin=owner&next="*) say "$n signed out → sign-in" ok ;; *) say "$n signed out → sign-in" "got $r" ;; esac
  r=$(get "$n" -b "hub_gate=$TOKEN")
  case "${r%% *}" in 302) case "$r" in *home.home.arpa/?signin*) say "$n signed in" "still sent to sign-in" ;; *) say "$n signed in" ok ;; esac ;;
                    000|401|502|503|504) say "$n signed in" "got $r" ;; *) say "$n signed in" ok ;; esac
done
# Grafana trusts X-WEBAUTH-USER, so it must only be reachable through the gate: from the LAN it's closed or ignores it.
r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' -H 'X-WEBAUTH-USER: admin' http://10.0.0.30:3000/api/user)
case "$r" in 000|401) say "grafana not open to a forged header" ok ;; *) say "grafana not open to a forged header" "got $r" ;; esac
# A home.arpa name over plain http never reaches the hub's sign-in: it goes to https first.
for host in home.home.arpa home.arpa other.home.arpa; do
  r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: $host" http://127.0.0.1/)
  case "$r" in 30[178]" https://"*) say "http://$host → https" ok ;; *) say "http://$host → https" "got $r" ;; esac
done
r=$(curl -s --max-time 10 -o /dev/null -w '%{http_code} %{content_type}' http://127.0.0.1/api/now)
case "$r" in "200 application/json"*) say "old address → hub /api/now" ok ;; *) say "old address → hub /api/now" "got $r" ;; esac
exit $fail
