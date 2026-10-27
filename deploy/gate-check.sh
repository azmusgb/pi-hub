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
size() { curl -s --max-time 10 --cacert "$CA" --resolve "$1.home.arpa:443:127.0.0.1" -o /dev/null -w '%{size_download}' -L --max-redirs 3 "${@:2}" "https://$1.home.arpa/"; }

JAR=
cleanup() {
  [ -z "$JAR" ] || rm -f "$JAR"
  python3 - <<'PY'
import sqlite3
d = sqlite3.connect("/var/lib/pi-hub/hub.db")
for (h,) in d.execute("SELECT token_hash FROM sessions WHERE device = 'gate-check' AND role = 'owner'").fetchall():
    d.execute("DELETE FROM gate_codes WHERE owner_hash = ?", (h,))
    d.execute("DELETE FROM sessions WHERE role = 'gate' AND device = ?", ("gate:" + h,))
d.execute("DELETE FROM sessions WHERE device = 'gate-check'")
d.commit()
PY
}
trap cleanup EXIT
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
# One host-only cookie line per name (what a browser holds, since home.arpa is a public suffix), so curl never sends the
# token to a host a redirect points at.
JAR=$(mktemp); chmod 600 "$JAR"
for n in "${NAMES[@]}"; do printf '%s.home.arpa\tFALSE\t/\tTRUE\t0\thub_gate\t%s\n' "$n" "$TOKEN" >> "$JAR"; done

r=$(get home); [ "${r%% *}" = 200 ] && say "home (open)" ok || say "home (open)" "got $r"
for n in "${NAMES[@]}"; do
  r=$(get "$n")
  case "$r" in "302 https://home.home.arpa/?signin=owner&next="*) say "$n signed out → sign-in" ok ;; *) say "$n signed out → sign-in" "got $r" ;; esac
  r=$(get "$n" -b "$JAR")
  case "${r%% *}" in 302) case "$r" in *home.home.arpa/?signin*) say "$n signed in" "still sent to sign-in" ;; *) say "$n signed in" ok ;; esac ;;
                    000|401|502|503|504) say "$n signed in" "got $r" ;; *) say "$n signed in" ok ;; esac
  # An empty page means the tool didn't recognise the name it was asked for.
  b=$(size "$n" -b "$JAR"); [ "${b:-0}" -gt 0 ] && say "$n shows a page" ok || say "$n shows a page" "empty"
done
# A tool's first visit redeems a one-time code: back to the clean URL with a host-only cookie (no Domain). The owner-shaped
# session and the code bound to it for bambuddy.home.arpa are made just now (cleanup removes them), so they can't expire early.
CODE=$(python3 - <<'PY'
import hashlib, secrets, sqlite3, time
o = secrets.token_urlsafe(32); c = secrets.token_urlsafe(32); now = int(time.time())
h = lambda v: hashlib.sha256(v.encode()).hexdigest()
db = sqlite3.connect("/var/lib/pi-hub/hub.db")
db.execute("INSERT INTO sessions (token_hash, role, created, expires, device) VALUES (?, 'owner', ?, ?, 'gate-check')", (h(o), now, now + 120))
db.execute("INSERT INTO gate_codes (code_hash, owner_hash, host, expires) VALUES (?, ?, 'bambuddy.home.arpa', ?)", (h(c), h(o), now + 120))
db.commit(); print(c)
PY
)
h=$(curl -s --max-time 10 --cacert "$CA" --resolve bambuddy.home.arpa:443:127.0.0.1 -D - -o /dev/null \
  -w 'RESULT %{http_code} %{redirect_url}\n' "https://bambuddy.home.arpa/?hub_gate_code=$CODE" | tr -d '\r')
res=$(printf '%s\n' "$h" | sed -n 's/^RESULT //p')
# Judge each hub_gate= line on its own: it passes with a non-empty value and no Domain. Never print the cookie or the code.
ck=absent
while IFS= read -r line; do
  v=${line#*:}; v=${v# }; v=${v#hub_gate=}; v=${v%%;*}
  if printf '%s' "$line" | grep -qi ';[[:space:]]*domain='; then [ "$ck" = ok ] || ck="has Domain"
  elif [ -z "$v" ]; then [ "$ck" = ok ] || [ "$ck" = "has Domain" ] || ck=empty
  else ck=ok; fi
done < <(printf '%s\n' "$h" | grep -i '^set-cookie: hub_gate=')
if [ "$res" = "302 https://bambuddy.home.arpa/" ] && [ "$ck" = ok ]; then say "bambuddy code hand-off" ok
else say "bambuddy code hand-off" "got ${res//hub_gate_code=[^&]*/hub_gate_code=…}; cookie $ck"; fi
# Grafana trusts X-WEBAUTH-USER, so it must only be reachable through the gate: from the LAN it's closed or ignores it.
r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' -H 'X-WEBAUTH-USER: admin' http://10.0.0.30:3000/api/user)
case "$r" in 000|401) say "grafana not open to a forged header" ok ;; *) say "grafana not open to a forged header" "got $r" ;; esac
# A home.arpa name over plain http never reaches the hub's sign-in: it goes to https first.
for host in home.home.arpa home.arpa other.home.arpa; do
  r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: $host" http://127.0.0.1/)
  case "$r" in 30[1278]" https://"*) say "http://$host → https" ok ;; *) say "http://$host → https" "got $r" ;; esac
done
r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{content_type}' http://127.0.0.1/home-ca.crt)
case "$r" in "200 application/x-x509-ca-cert"*) say "old address → CA root" ok ;; *) say "old address → CA root" "got $r" ;; esac
r=$(curl -s --max-time 10 -o /dev/null -w '%{http_code} %{content_type}' http://127.0.0.1/api/now)
case "$r" in "200 application/json"*) say "old address → hub /api/now" ok ;; *) say "old address → hub /api/now" "got $r" ;; esac
# The printer actions are the owner's: signed out, the hub refuses before Bambuddy is asked.
r=$(curl -s --max-time 10 --cacert "$CA" --resolve home.home.arpa:443:127.0.0.1 -o /dev/null -w '%{http_code}' -X POST \
  -H 'Origin: https://home.home.arpa' https://home.home.arpa/api/printer/pause)
case "$r" in 401) say "printer pause refused signed out" ok ;; *) say "printer pause refused signed out" "got $r" ;; esac
exit $fail
