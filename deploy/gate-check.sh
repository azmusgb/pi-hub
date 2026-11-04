#!/bin/bash
# Checks the front gate on the Pi (run as root): every name refuses a signed-out visit and lets the owner in, a forged
# identity header sent to Grafana from the LAN gets nothing, and the old address keeps only the machine paths (step 6).
# A tool's first visit trades a one-time code for its own host-only cookie.
# Usage: sudo bash gate-check.sh
set -uo pipefail
CA=/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt  # the old name's CA (home.home.arpa, the display)
R=rahe-home.duckdns.org
NAMES=(assistant bambuddy paperless homebox backups network status adguard devices pi scan plex)
fail=0
say() { printf '%-34s %s\n' "$1" "$2"; [ "$2" = ok ] || fail=1; }
get() { curl -s --max-time 10 --resolve "$1.$R:443:127.0.0.1" -o /dev/null -w '%{http_code} %{redirect_url}' "${@:2}" "https://$1.$R/"; }
size() { curl -s --max-time 10 --resolve "$1.$R:443:127.0.0.1" -o /dev/null -w '%{size_download}' -L --max-redirs 3 "${@:2}" "https://$1.$R/"; }

JAR=
cleanup() {
  [ -z "$JAR" ] || rm -f "$JAR"
  python3 - <<'PY'
import sqlite3
d = sqlite3.connect("/var/lib/pi-hub/hub.db")
for (h,) in d.execute("SELECT token_hash FROM sessions WHERE device = 'gate-check' AND role = 'owner'").fetchall():
    try: d.execute("DELETE FROM gate_codes WHERE owner_hash = ?", (h,))
    except sqlite3.OperationalError: pass  # no gate_codes table yet; the sessions cleanup below still runs
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
# One host-only cookie line per name (what a browser holds: each tool's cookie is host-only), so curl never sends the
# token to a host a redirect points at.
JAR=$(mktemp); chmod 600 "$JAR"
for n in "${NAMES[@]}"; do printf '%s.'"$R"'\tFALSE\t/\tTRUE\t0\thub_gate\t%s\n' "$n" "$TOKEN" >> "$JAR"; done

r=$(get hub); [ "${r%% *}" = 200 ] && say "hub (open)" ok || say "hub (open)" "got $r"
for n in "${NAMES[@]}"; do
  r=$(get "$n")
  case "$r" in "302 https://hub.$R/?signin=owner&next="*) say "$n signed out → sign-in" ok ;; *) say "$n signed out → sign-in" "got $r" ;; esac
  r=$(get "$n" -b "$JAR")
  case "${r%% *}" in 302) case "$r" in *"hub.$R/?signin"*) say "$n signed in" "still sent to sign-in" ;; *) say "$n signed in" ok ;; esac ;;
                    000|401|502|503|504) say "$n signed in" "got $r" ;; *) say "$n signed in" ok ;; esac
  # An empty page means the tool didn't recognise the name it was asked for.
  b=$(size "$n" -b "$JAR"); [ "${b:-0}" -gt 0 ] && say "$n shows a page" ok || say "$n shows a page" "empty"
done
# A tool's first visit redeems a one-time code: back to the clean URL with a host-only cookie (no Domain). The owner-shaped
# session and the code bound to it for bambuddy.<real name> are made just now (cleanup removes them), so they can't expire early.
CODE=$(python3 - <<'PY'
import hashlib, secrets, sqlite3, time
o = secrets.token_urlsafe(32); c = secrets.token_urlsafe(32); now = int(time.time())
h = lambda v: hashlib.sha256(v.encode()).hexdigest()
db = sqlite3.connect("/var/lib/pi-hub/hub.db")
db.execute("INSERT INTO sessions (token_hash, role, created, expires, device) VALUES (?, 'owner', ?, ?, 'gate-check')", (h(o), now, now + 120))
db.execute("INSERT INTO gate_codes (code_hash, owner_hash, host, expires) VALUES (?, ?, 'bambuddy.rahe-home.duckdns.org', ?)", (h(c), h(o), now + 120))
db.commit(); print(c)
PY
)
h=$(curl -s --max-time 10 --resolve "bambuddy.$R:443:127.0.0.1" -D - -o /dev/null \
  -w 'RESULT %{http_code} %{redirect_url}\n' "https://bambuddy.$R/?hub_gate_code=$CODE" | tr -d '\r')
res=$(printf '%s\n' "$h" | sed -n 's/^RESULT //p')
# Judge each hub_gate= line on its own: it passes with a non-empty value and no Domain. Never print the cookie or the code.
ck=absent
while IFS= read -r line; do
  v=${line#*:}; v=${v# }; v=${v#hub_gate=}; v=${v%%;*}
  if printf '%s' "$line" | grep -qi ';[[:space:]]*domain='; then [ "$ck" = ok ] || ck="has Domain"
  elif [ -z "$v" ]; then [ "$ck" = ok ] || [ "$ck" = "has Domain" ] || ck=empty
  else ck=ok; fi
done < <(printf '%s\n' "$h" | grep -i '^set-cookie: hub_gate=')
if [ "$res" = "302 https://bambuddy.$R/" ] && [ "$ck" = ok ]; then say "bambuddy code hand-off" ok
else say "bambuddy code hand-off" "got ${res//hub_gate_code=[^&]*/hub_gate_code=…}; cookie $ck"; fi
# Grafana trusts X-WEBAUTH-USER, so it must only be reachable through the gate: from the LAN it's closed or ignores it.
r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' -H 'X-WEBAUTH-USER: admin' http://10.0.0.30:3000/api/user)
case "$r" in 000|401) say "grafana not open to a forged header" ok ;; *) say "grafana not open to a forged header" "got $r" ;; esac
# A house name over plain http never reaches the hub's sign-in: it goes to https first.
for host in "hub.$R" home.home.arpa home.arpa other.home.arpa; do
  r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: $host" http://127.0.0.1/)
  case "$r" in 30[1278]" https://"*) say "http://$host → https" ok ;; *) say "http://$host → https" "got $r" ;; esac
done
r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{content_type}' http://127.0.0.1/home-ca.crt)
case "$r" in "200 application/x-x509-ca-cert"*) say "old address → CA root" ok ;; *) say "old address → CA root" "got $r" ;; esac
r=$(curl -s --max-time 10 -o /dev/null -w '%{http_code} %{content_type}' http://127.0.0.1/api/now)
case "$r" in "200 application/json"*) say "old address → hub /api/now" ok ;; *) say "old address → hub /api/now" "got $r" ;; esac
r=$(curl -s --max-time 5 -o /dev/null -w '%{http_code} %{redirect_url}' http://127.0.0.1/workshop)
case "$r" in "308 https://hub.$R/workshop") say "old address page → the gate" ok ;; *) say "old address page → the gate" "got $r" ;; esac
# The printer actions are the owner's: signed out, the hub refuses before Bambuddy is asked.
r=$(curl -s --max-time 10 --resolve "hub.$R:443:127.0.0.1" -o /dev/null -w '%{http_code}' -X POST \
  -H "Origin: https://hub.$R" "https://hub.$R/api/printer/pause")
case "$r" in 401) say "printer pause refused signed out" ok ;; *) say "printer pause refused signed out" "got $r" ;; esac
# The old names: each goes to the same page on its real name; home.home.arpa keeps only the display's and the lab's paths.
r=$(curl -s --max-time 10 --cacert "$CA" --resolve bambuddy.home.arpa:443:127.0.0.1 -o /dev/null -w '%{http_code} %{redirect_url}' https://bambuddy.home.arpa/x)
case "$r" in "308 https://bambuddy.$R/x") say "old tool name → real name" ok ;; *) say "old tool name → real name" "got $r" ;; esac
r=$(curl -s --max-time 10 --cacert "$CA" --resolve home.home.arpa:443:127.0.0.1 -o /dev/null -w '%{http_code} %{redirect_url}' https://home.home.arpa/workshop)
case "$r" in "308 https://hub.$R/workshop") say "old hub name → hub" ok ;; *) say "old hub name → hub" "got $r" ;; esac
r=$(curl -s --max-time 10 --cacert "$CA" --resolve home.home.arpa:443:127.0.0.1 -o /dev/null -w '%{http_code}' https://home.home.arpa/api/display/feed)
case "$r" in 30*) say "old hub name keeps the display's paths" "got $r" ;; *) say "old hub name keeps the display's paths" ok ;; esac
exit $fail
