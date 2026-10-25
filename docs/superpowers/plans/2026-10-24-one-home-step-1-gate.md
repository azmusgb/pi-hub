# One home, step 1: the gate. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every house tool is reachable as `https://<name>.home.arpa`, behind one sign-in (Pi Hub's owner password),
while every old address and every machine caller keeps working.

**Architecture:** Caddy (Debian package) on the Pi takes ports 80 and 443. For each `*.home.arpa` site it asks Pi Hub
`GET /api/gate` (`forward_auth`) before proxying to the tool. Pi Hub moves to `127.0.0.1:8100`. Plain
`http://10.0.0.30` / `http://pi` still pass straight to the hub for machine callers. AdGuard answers
`*.home.arpa → 10.0.0.30`. Grafana trusts the gate's `X-WEBAUTH-USER`, but only from 127.0.0.1.

**Tech Stack:** Python 3 / FastAPI (Pi Hub), Caddy 2.6 (Debian trixie package), AdGuard Home API, Grafana 11
`auth.proxy`, bash.

**Spec:** `docs/superpowers/specs/2026-10-24-one-home-design.md` (rollout step 1)

## Global Constraints

- **Names:**
  - `home.home.arpa` → hub
  - `assistant.` → https://10.0.0.21
  - `bambuddy.` → :8000
  - `paperless.` → http://10.0.0.21:8010
  - `homebox.` → :7745
  - `backups.` → :9898
  - `network.` → :3000
  - `status.` → :3001
  - `adguard.` → :3002
  - `devices.` → :8581
  - `pi.` → https://127.0.0.1:9090
  - `scan.` → 127.0.0.1:8095
- **Hub listens on** `127.0.0.1:8100` (was `0.0.0.0:80`).
- **Gate cookie:**
  - name `hub_gate`, the same token value as `hub_session`;
  - `Domain=.home.arpa; Path=/; Secure; HttpOnly; SameSite=Lax`, with max-age equal to `auth.LIFETIME[role]`;
  - set only when the request's host ends with `.home.arpa`.
- **`/api/gate` answers** 200 with `X-Remote-User: bill` when the owner is signed in (role `owner` via `hub_gate` or
  `hub_session`). Otherwise it answers 302 to `https://home.home.arpa/?signin=owner&next=<url-encoded original URL>`.
- **`next` must be** `https://` with a host equal to `home.arpa` or ending in `.home.arpa`. Anything else falls back
  to `https://home.home.arpa/`.
- **Caddy strips** any client-sent `X-Remote-User` and `X-WEBAUTH-USER` before proxying. Only `forward_auth`'s copied
  header is passed on.
- **Old addresses still work:** `http://10.0.0.30`, `http://pi`, `http://pi.local`, the Tailscale name and
  `100.92.174.18` all go to the hub unchanged (no redirect, no gate). Tool ports stay as they are; locking them is
  step 6.
- **Paperless keeps its own login in step 1** (deviation from spec D6). Paperless can't limit its trusted header to
  the Pi's address, and port 8010 is open on the LAN until step 6. Trusted-header login for it moves to step 6, with
  the PC firewall rule.

## Review Focus

1. **Spoofed identity header sent straight to a tool port.** A request to `http://10.0.0.30:3000` with
   `X-WEBAUTH-USER: admin` must not sign anyone in. Grafana's `whitelist = 127.0.0.1` covers it; the Task 4 test pins
   it.
2. **An open redirect through `next`.** `next=https://evil.com` or `//evil.com` must land on `https://home.home.arpa/`
   (Task 1 test).
3. **Kids' or household PIN sessions passing the gate.** Only `owner` passes; household gets a 302 (Task 1 test).
4. **The release health check or self-check breaking after the port move.** Both must use `127.0.0.1:8100` (Task 2
   verification).
5. **Machine callers** (Local AI `/api/now`, the Bambuddy webhook, Siri shortcuts on `http://10.0.0.30`) must get the
   same answers as before (Task 3 gate-check script).

---

### Task 1: Hub gate endpoint, gate cookie and sign-in hand-back

**Files:**
- Modify: `hub/app.py` (`_signed_in` near line 523, `api_signout` near line 562; add `api_gate`)
- Create: `hub/gate.py`
- Modify: `hub/static/js/main.js` (on load, handle `?signin=owner&next=`)
- Test: `tests/test_gate.py`

**Interfaces:**
- Produces:
  - `gate.safe_next(url: str) -> str`
  - `gate.cookie_kwargs(host: str, max_age: int) -> dict | None` (None when the host isn't under `.home.arpa`)
  - route `GET /api/gate`
  - cookie `hub_gate`
  - the browser behaviour of `/?signin=owner&next=…`

- [ ] **Step 1: Write the failing tests** in `tests/test_gate.py` (use the `fresh_db` / `TestClient` pattern from
  `tests/test_stage1.py`):

```python
def test_safe_next_only_allows_home_arpa():
    assert gate.safe_next("https://bambuddy.home.arpa/x?y=1") == "https://bambuddy.home.arpa/x?y=1"
    for bad in ("https://evil.com", "//evil.com", "http://bambuddy.home.arpa/", "https://home.arpa.evil.com", "", "javascript:alert(1)"):
        assert gate.safe_next(bad) == "https://home.home.arpa/"

def test_gate_redirects_when_signed_out():
    r = client.get("/api/gate", headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "bambuddy.home.arpa", "X-Forwarded-Uri": "/inventory"}, follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == "https://home.home.arpa/?signin=owner&next=https%3A%2F%2Fbambuddy.home.arpa%2Finventory"

def test_gate_lets_the_owner_through_with_either_cookie(owner_token):
    for name in ("hub_gate", "hub_session"):
        r = client.get("/api/gate", cookies={name: owner_token})
        assert r.status_code == 200 and r.headers["x-remote-user"] == "bill"

def test_gate_refuses_household_and_expired(household_token):
    assert client.get("/api/gate", cookies={"hub_gate": household_token}, follow_redirects=False).status_code == 302
    assert client.get("/api/gate", cookies={"hub_gate": "not-a-token"}, follow_redirects=False).status_code == 302

def test_signin_on_home_arpa_sets_the_gate_cookie_and_signout_clears_it():
    r = signin_owner(host="home.home.arpa")  # POST /api/signin {"password": ...} with Host header
    assert "Domain=.home.arpa" in r.headers["set-cookie"] and "Secure" in r.headers["set-cookie"]
    r = signin_owner(host="10.0.0.30")
    assert "hub_gate" not in r.headers.get("set-cookie", "")
    r = client.post("/api/signout", headers={"Host": "home.home.arpa", "Origin": "https://home.home.arpa"})
    assert any("hub_gate=" in c and "Max-Age=0" in c for c in r.headers.get_list("set-cookie"))
```

- [ ] **Step 2: Run them; they fail** with "No module named hub.gate" or 404.
  Run: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_gate.py`

- [ ] **Step 3: Implement.**
  - **`hub/gate.py`:** `safe_next`, `cookie_kwargs` (returns `dict(domain=".home.arpa", secure=True, httponly=True,
    samesite="lax", path="/", max_age=max_age)`), and `original_url(headers) -> str`, built from Caddy's
    `X-Forwarded-Proto`, `X-Forwarded-Host` and `X-Forwarded-Uri`.
  - **`/api/gate`:** reads `hub_gate`, then `hub_session`, through `auth.session()`.
    - Owner → `Response(status_code=200, headers={"X-Remote-User": "bill"})`.
    - Otherwise → 302 to the signin URL in Global Constraints, with `next` built by `original_url`, passed through
      `safe_next` and url-encoded with `urllib.parse.quote(..., safe="")`.
    - Don't apply `fresh()` caching rules beyond `Cache-Control: no-store`.
  - **`_signed_in(token, role, host)`:** also sets `hub_gate` when `cookie_kwargs(host, …)` isn't None. Pass
    `request.headers.get("host", "")` from `api_signin`.
  - **`api_signout`:** also deletes `hub_gate` with `domain=".home.arpa", path="/"`.
  - **`main.js`:** on startup, if `URLSearchParams` has `signin=owner`, call `ensure("owner")` (the existing dialog).
    On success, `location.replace(next)` when `next` passes the same rule as `safe_next` (mirror it in JS: `https:`
    and the hostname is `home.arpa` or ends with `.home.arpa`). Otherwise drop the query with `history.replaceState`.

- [ ] **Step 4: Run all hub tests; they pass.**
  Run: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests && node --test tests/*.mjs`
  Expected: all pass, including 5 new.

- [ ] **Step 5: Commit** `hub: /api/gate and the .home.arpa sign-in cookie for the front gate`.

### Task 2: Move the hub behind Caddy (127.0.0.1:8100)

**Files:**
- Modify: `deploy/pi-hub.service` (ExecStart host and port; drop `AmbientCapabilities` / `CapabilityBoundingSet`
  `CAP_NET_BIND_SERVICE`)
- Modify: `deploy/pi-hub-release:43` (health URL)
- Modify: `deploy/pi-hub-selfcheck.py:10` (`HUB`)
- Test: `tests/test_release.py` (only if it asserts the old URL)

**Interfaces:**
- Produces: the hub at `http://127.0.0.1:8100`. Task 3's Caddyfile proxies to it.

- [ ] **Step 1: Write the failing test** in `tests/test_release.py`:

```python
def test_hub_listens_only_on_localhost_8100():
    unit = (DEPLOY / "pi-hub.service").read_text()
    assert "--host 127.0.0.1 --port 8100" in unit and "CAP_NET_BIND_SERVICE" not in unit
    assert "http://127.0.0.1:8100/healthz" in (DEPLOY / "pi-hub-release").read_text()
    assert 'HUB = "http://127.0.0.1:8100"' in (DEPLOY / "pi-hub-selfcheck.py").read_text()
```

- [ ] **Step 2: Run it; it fails.** Run: `… pytest -q tests/test_release.py -k localhost_8100`

- [ ] **Step 3: Make the three edits.** Keep `--proxy-headers`. Uvicorn's default `--forwarded-allow-ips` is
  127.0.0.1, so sign-in rate limiting sees the real client address from Caddy's `X-Forwarded-For`.

- [ ] **Step 4: Run all tests; they pass.**

- [ ] **Step 5: Commit** `hub: listen on 127.0.0.1:8100; Caddy takes port 80`. **Don't release yet.** Task 3 has to
  install Caddy in the same release, or the hub disappears from port 80.

### Task 3: Caddy, the gate and the gate check

**Files:**
- Create: `deploy/caddy/Caddyfile`
- Create: `deploy/gate-check.sh`
- Modify: `deploy/install.sh` (install the `caddy` package when it's missing; enable it)
- Modify: `deploy/pi-hub-release` (copy the Caddyfile to `/etc/caddy/Caddyfile`; `caddy validate`, then
  `systemctl reload caddy`; include it in `SUPPORT` so a failed release restores it)
- Modify: `deploy/pi-hub-selfcheck.py` (add check "The front gate answers": `https://home.home.arpa/healthz` through
  `--resolve`-style connect to 127.0.0.1, with the CA root at `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt`)

**Interfaces:**
- Consumes: the hub on `127.0.0.1:8100` (Task 2), `GET /api/gate` (Task 1).
- Produces: `https://*.home.arpa` and the CA root at `https://home.home.arpa/home-ca.crt`.

- [ ] **Step 1: Write the gate check** `deploy/gate-check.sh <name>…`. It's run on the Pi; it exits 1 on the first
  failure and prints one line per check. For every name in Global Constraints:
  - signed out: `curl --cacert root.crt --resolve "$n.home.arpa:443:127.0.0.1" -s -o /dev/null -w '%{http_code} %{redirect_url}'`
    gives 302 to `https://home.home.arpa/?signin=owner&next=…` (`home.` itself gives 200);
  - signed in (with `-b hub_gate=$TOKEN`, a token minted by `python3 -c` through `hub.auth` as owner) gives anything
    except 302 or 401 from the gate;
  - `curl -H 'X-WEBAUTH-USER: admin' http://127.0.0.1:3000/api/user` gives 401 (spoofed header ignored);
  - `http://127.0.0.1/api/now` gives 200 JSON (machine path unchanged).

- [ ] **Step 2: Run it before Caddy exists; it fails** at the first name.

- [ ] **Step 3: Write `deploy/caddy/Caddyfile`:**
  - a global block with `local_certs`;
  - a snippet `(gate)` doing `request_header -X-Remote-User`, `request_header -X-Webauth-User`, then
    `forward_auth 127.0.0.1:8100 { uri /api/gate; copy_headers X-Remote-User }`;
  - one site per name in Global Constraints, each `import gate` and
    `reverse_proxy <target> { header_up X-WEBAUTH-USER {http.request.header.X-Remote-User} }` (only `network.`
    needs `header_up`);
  - `assistant.` and `pi.` proxy to https targets with `transport http { tls_insecure_skip_verify }`;
  - `home.home.arpa` without `import gate`, with `handle /home-ca.crt { root * /var/lib/caddy/.local/share/caddy/pki/authorities/local; rewrite * /root.crt; file_server }` and otherwise `reverse_proxy 127.0.0.1:8100`;
  - a final `http:// { reverse_proxy 127.0.0.1:8100 }` catch-all for the old addresses.

  Then the `install.sh` and `pi-hub-release` edits above, and the self-check line.

- [ ] **Step 4: Release and verify on the Pi.**
  Run: `./deploy/install.sh`, then `ssh pi 'sudo bash /opt/pi-hub/current/deploy/gate-check.sh'`.
  Expected:
  - every check prints `ok`;
  - `curl -s http://10.0.0.30/api/now` from the Mac returns JSON;
  - Local AI's Materials and Now-playing cards still appear in `https://10.0.0.21/api/display/feed`.

- [ ] **Step 5: Commit** `gate: Caddy fronts every tool at *.home.arpa behind the hub's sign-in`.

### Task 4: Names (AdGuard) and Grafana's trusted login

**Files:**
- Modify: `~/dev/netmon/docker-compose.yml` (grafana environment)
- Modify: `docs/operations.md` (new section "The front gate")

- [ ] **Step 1: Write the failing checks** (shell, run from the Mac):
  - `dig +short @10.0.0.30 bambuddy.home.arpa` gives `10.0.0.30`;
  - `curl -s -o /dev/null -w '%{http_code}' -H 'X-WEBAUTH-USER: admin' http://10.0.0.30:3000/api/user` gives 401.

  Run both; the first fails (no answer). The second passes today, and must still pass after the change.

- [ ] **Step 2: Add the AdGuard rewrite** through its API on the Pi:
  `POST /control/rewrite/add {"domain":"*.home.arpa","answer":"10.0.0.30"}`, with basic auth from
  `/etc/pi-hub/secrets/adguard_admin`. Also add `home.arpa` itself.

- [ ] **Step 3: Grafana:** add
  - `GF_AUTH_PROXY_ENABLED=true`
  - `GF_AUTH_PROXY_HEADER_NAME=X-WEBAUTH-USER`
  - `GF_AUTH_PROXY_HEADER_PROPERTY=username`
  - `GF_AUTH_PROXY_AUTO_SIGN_UP=false`
  - `GF_AUTH_PROXY_WHITELIST=127.0.0.1`

  Create the Grafana user `bill` as Admin through the API (admin password in `/etc/pi-hub/secrets/grafana_admin`).
  Copy the compose file to `/opt/netmon` and run `docker compose up -d grafana`.

- [ ] **Step 4: Run the checks; both pass.** Then, signed in at `https://home.home.arpa`, opening
  `https://network.home.arpa` shows Grafana signed in as `bill` with no Grafana login.

- [ ] **Step 5: Write `docs/operations.md` › "The front gate".** Cover:
  - the names table;
  - how sign-in works;
  - where the CA root lives (never delete `/var/lib/caddy`);
  - the gate check;
  - that old addresses still work until step 6;
  - Paperless's trusted login deferred to step 6.

  Commit in both repos: `gate: home.arpa names and Grafana trusted login`.

### Task 5: Owner steps and acceptance

**Files:**
- Modify: `docs/status.md` (one-home step 1 result)

- [ ] **Step 1:** the owner does three things:
  - downloads `https://home.home.arpa/home-ca.crt` on the iPhone (Settings › Profile Downloaded › Install, then
    Settings › General › About › Certificate Trust Settings › on) and on the Mac (Keychain Access, System keychain,
    Always Trust);
  - in the Tailscale admin console › DNS › Nameservers › Add › Custom, enters the Pi's Tailscale address
    `100.92.174.18`, with "Restrict to domain" `home.arpa`;
  - sets the Orbi's DNS to `10.0.0.30` (primary) and `9.9.9.9` (secondary).
- [ ] **Step 2: Verify from the iPhone on Wi-Fi and on cellular with Tailscale.** Open
  `https://bambuddy.home.arpa`: the hub's sign-in appears, and after the owner password Bambuddy opens with no
  certificate warning. Sign out on the hub, and Bambuddy asks for the hub sign-in again.
- [ ] **Step 3: Record in `docs/status.md`** the five critique tasks' current step and login counts as the baseline.
  Commit `docs: one home step 1 done`.
