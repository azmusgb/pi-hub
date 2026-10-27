# Front Gate: Per-Tool Sign-In Cookie Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop every gated `*.home.arpa` link from bouncing back to Home, by giving each tool its own host-only
`hub_gate` cookie through a one-time hand-off code instead of one cookie shared across `.home.arpa`.

**Architecture:** `home.arpa` is on the Public Suffix List (line 216 of publicsuffix.org's list, checked 27 Oct 2026),
so browsers refuse `Set-Cookie: hub_gate=…; Domain=.home.arpa`. Today: tool → gate 302 → Home `?signin=owner&next=…`
→ `/api/gate/renew` sets the refused cookie → back to the tool → bounce, until the two-try guard shows a toast. New
flow: renew mints a single-use code bound to the tool's host and returns `next` with `?hub_gate_code=<code>`; the
browser goes there; Caddy asks `/api/gate`, which spends the code and answers 302 to the same URL without the code,
setting a host-only `hub_gate` on that tool's name. Caddy's `forward_auth` passes a non-2xx auth answer (status,
`Location`, `Set-Cookie`) to the browser unchanged, so no Caddyfile change is needed.

**Tech Stack:** Python 3 / FastAPI / SQLite (`hub/auth.py`, `hub/gate.py`, `hub/app.py`), browser ES modules
(`hub/static/js/main.js`), bash (`deploy/gate-check.sh`).

**Spec:** `docs/superpowers/specs/2026-10-24-one-home-design.md` (the front gate) plus the Architecture paragraph
above, which replaces only its "one shared `.home.arpa` cookie" mechanism. Everything else about the gate stands.

## Global Constraints

- Code parameter name: `hub_gate_code`. Code lifetime: 30 seconds. Single use.
- A code is bound to one host (the `next` URL's hostname) and to the owner sign-in that minted it; signing out
  removes that sign-in's unspent codes and its gate tokens.
- Codes are stored hashed (sha256), like session tokens. Tokens and codes come from `secrets.token_urlsafe(32)`.
- Tool cookie: `hub_gate=<gate token>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=<auth.LIFETIME["owner"]>`,
  **no `Domain`** attribute. The gate token itself still expires with its owner sign-in (`auth.gate_session` rule).
- The hub never sets or deletes a `Domain=.home.arpa` cookie any more.
- Only `https` `*.home.arpa` addresses other than `home.home.arpa` may receive a code (`gate.safe_next` rules plus
  that exclusion).
- `/api/gate` must never put a code into the `next` of its sign-in redirect.
- Pi deploys are the user's: stop before `git push pi main`.

## Review Focus

1. A code used twice (refresh, back button) → second use is refused and falls through to the normal check (a valid
   cookie passes; otherwise sign-in redirect whose `next` has no code). Test in Task 2.
2. A code minted for `bambuddy.home.arpa` presented at `assistant.home.arpa` → refused, and it is not spent for
   Bambuddy either. Test in Task 1.
3. A code older than 30 s → refused. Test in Task 1.
4. The owner signs out between minting and redemption → refused. Test in Task 1.
5. A `next` with its own query and path (`https://bambuddy.home.arpa/x?y=1`) → the clean redirect keeps
   `/x?y=1` exactly. Fragments (`assistant…/#projects`) never reach the server and the browser keeps them across the
   302; covered by the live check in Task 3. Test in Task 2.

---

### Task 1: Gate codes in `hub/auth.py`

**Files:**
- Modify: `hub/auth.py` (SCHEMA, `sign_out`, new functions after `gate_session`)
- Test: `tests/test_gate.py`

**Interfaces:**
- Produces:
  - `GATE_CODE_SECONDS = 30`
  - table `gate_codes (code_hash TEXT PRIMARY KEY, owner_hash TEXT NOT NULL, host TEXT NOT NULL, expires INTEGER NOT NULL)`
  - `gate_code(owner_token: str, host: str) -> str | None`: None unless `owner_token` is a live owner session.
  - `redeem_gate_code(code: str, host: str) -> str | None`: deletes the code row whatever the outcome *only when the
    host matches*; returns a new gate token (same row shape as `gate_session` makes: role `gate`, device
    `"gate:" + owner_hash`, expires = owner's expires) when the code is unexpired, the host matches and the owner
    session is still live; else None.
  - `sign_out(token)` also runs `DELETE FROM gate_codes WHERE owner_hash = ?` with that token's hash.

- [ ] **Step 1: Write the failing tests** in `tests/test_gate.py` (use the existing `client` fixture and `signin`;
  get the owner token from `signin(...).cookies.get("hub_session")`):

```python
def test_a_gate_code_is_spent_once_on_its_own_host(client):
    owner = signin(client, "home.home.arpa").cookies.get("hub_session")
    code = auth.gate_code(owner, "bambuddy.home.arpa")
    assert auth.redeem_gate_code(code, "assistant.home.arpa") is None      # wrong host: refused, not spent
    token = auth.redeem_gate_code(code, "bambuddy.home.arpa")
    assert token and auth.session(token, gate=True)
    assert auth.redeem_gate_code(code, "bambuddy.home.arpa") is None       # spent


def test_a_gate_code_expires_and_dies_with_its_sign_in(client, monkeypatch):
    owner = signin(client, "home.home.arpa").cookies.get("hub_session")
    old = auth.gate_code(owner, "bambuddy.home.arpa")
    real = auth.time.time
    monkeypatch.setattr(auth.time, "time", lambda: real() + auth.GATE_CODE_SECONDS + 1)
    assert auth.redeem_gate_code(old, "bambuddy.home.arpa") is None
    monkeypatch.undo()
    code = auth.gate_code(owner, "bambuddy.home.arpa")
    auth.sign_out(owner)
    assert auth.redeem_gate_code(code, "bambuddy.home.arpa") is None


def test_only_a_live_owner_gets_a_gate_code(client):
    household = signin(client, "home.home.arpa", pin="123456").cookies.get("hub_session")
    assert auth.gate_code(household, "bambuddy.home.arpa") is None
    assert auth.gate_code("not-a-token", "bambuddy.home.arpa") is None
```

  If `hub/auth.py` imports `time` as `from time import time`, adjust the monkeypatch target to match; do not change
  the module's import style for the test.

- [ ] **Step 2: Run them to verify they fail**

Run: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_gate.py -k gate_code`
Expected: FAIL with `AttributeError: module 'hub.auth' has no attribute 'gate_code'`

- [ ] **Step 3: Implement** the Interfaces above in `hub/auth.py`. Add the table to `SCHEMA`; delete expired rows in
  `gate_code` the way session creation already prunes expired sessions.

- [ ] **Step 4: Run the whole gate file**

Run: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_gate.py`
Expected: all pass (existing tests untouched so far).

- [ ] **Step 5: Commit**

```bash
git add hub/auth.py tests/test_gate.py
git commit -m "gate: single-use, host-bound hand-off codes"
```

### Task 2: Hand-off through `/api/gate` and renew; drop the shared cookie

**Files:**
- Modify: `hub/gate.py`, `hub/app.py` (`_signed_in`, `api_gate_renew`, `api_gate`, `api_signout`),
  `hub/static/js/main.js` (`gateSignIn`)
- Test: `tests/test_gate.py` (new tests; rewrite the ones asserting `Domain=.home.arpa`)

**Interfaces:**
- Consumes: Task 1's `auth.gate_code`, `auth.redeem_gate_code`.
- Produces (in `hub/gate.py`):
  - `CODE_PARAM = "hub_gate_code"`
  - `on_home_arpa(host: str) -> bool` — the current `_ours` test on the host without its port (replaces callers of
    `cookie_kwargs(host, …)` as the "signed in through a home.arpa name" check).
  - `with_code(url: str, code: str) -> str` — appends `hub_gate_code=<code>` to the query, keeping existing params.
  - `split_code(url: str) -> tuple[str, str | None]` — the URL with every `hub_gate_code` param removed (other params
    in their original order; no trailing `?` when none are left) and the first code value, or None.
  - `cookie_kwargs(max_age: int) -> dict` — `secure=True, httponly=True, samesite="lax", path="/", max_age=max_age`;
    no `domain`.
  - `signin_url(headers)` builds `next` from the URL with the code removed.
- Produces (HTTP):
  - `POST /api/gate/renew` with JSON `{"next": "<url>"}` → 200 `{"next": "<url with code>"}`. 401 unless owner;
    400 when the request host isn't on home.arpa, or `next` fails `safe_next`, or `next`'s host is `home.home.arpa`.
    Sets no cookie.
  - `GET /api/gate` with a code in `X-Forwarded-Uri`: if `redeem_gate_code(code, X-Forwarded-Host)` returns a token →
    302 to the clean original URL, `Cache-Control: no-store`, `Set-Cookie: hub_gate=<token>` per `cookie_kwargs`.
    Otherwise continue with the existing cookie/session check using the clean URL.
  - `POST /api/signin` no longer sets `hub_gate`; `POST /api/signout` revokes as now but sends no `hub_gate`
    deletion (the browser never held a domain cookie; per-tool cookies die server-side with the token).

- [ ] **Step 1: Write the failing tests** (`F = {"X-Forwarded-Proto": "https"}` plus host and uri per call):

```python
def gate_get(client, host, uri, **kw):
    return client.get("/api/gate", follow_redirects=False,
                      headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": host, "X-Forwarded-Uri": uri}, **kw)


def renew(client, next_url):
    return client.post("/api/gate/renew", json={"next": next_url},
                       headers={"Host": "home.home.arpa", "Origin": "https://home.home.arpa"})


def test_renew_hands_back_next_with_a_code_and_the_gate_spends_it(client):
    signin(client, "home.home.arpa")
    r = renew(client, "https://bambuddy.home.arpa/x?y=1")
    assert r.status_code == 200 and gate_cookie(r) is None
    nxt = urlsplit(r.json()["next"])
    assert (nxt.hostname, nxt.path) == ("bambuddy.home.arpa", "/x") and "y=1" in nxt.query
    client.cookies.clear()
    g = gate_get(client, "bambuddy.home.arpa", f"{nxt.path}?{nxt.query}")
    assert g.status_code == 302 and g.headers["location"] == "https://bambuddy.home.arpa/x?y=1"
    cookie = [c for c in g.headers.get_list("set-cookie") if c.startswith("hub_gate=")][0]
    assert "Domain" not in cookie and "Secure" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert gate_get(client, "bambuddy.home.arpa", "/x?y=1", cookies={"hub_gate": gate_cookie(g)}).status_code == 200
    again = gate_get(client, "bambuddy.home.arpa", f"{nxt.path}?{nxt.query}")   # replayed code
    assert again.status_code == 302 and "hub_gate_code" not in unquote(again.headers["location"])
    assert again.headers["location"].startswith("https://home.home.arpa/?signin=owner&next=")


def test_renew_refuses_unsafe_or_hub_destinations(client):
    signin(client, "home.home.arpa")
    for bad in ("http://bambuddy.home.arpa/", "https://evil.com/", "https://home.home.arpa/", "not a url"):
        assert renew(client, bad).status_code == 400


def test_signin_and_signout_never_send_a_domain_cookie(client):
    r = signin(client, "home.home.arpa")
    assert not any(c.startswith("hub_gate=") for c in r.headers.get_list("set-cookie"))
    r = client.post("/api/signout", headers={"Host": "home.home.arpa", "Origin": "https://home.home.arpa"})
    assert not any("Domain=.home.arpa" in c for c in r.headers.get_list("set-cookie"))
```

  Import `urlsplit, unquote` from `urllib.parse` at the top of the test file. Rewrite the existing tests that relied
  on the sign-in or renew response carrying `hub_gate` (`test_gate_lets_the_owner_through_with_either_cookie`,
  `test_a_gate_token_is_never_a_hub_session`, `test_signin_on_home_arpa_sets_the_gate_cookie_and_signout_clears_it`,
  `test_a_signed_in_owner_can_renew_a_missing_gate_token`, `test_signing_out_revokes_every_gate_token_from_that_sign_in`,
  `test_a_gate_token_never_outlives_its_sign_in`) to obtain the gate token through `renew` + `gate_get` instead,
  keeping each test's original assertion about what the token may and may not do. Add one helper,
  `tool_token(client, host="bambuddy.home.arpa") -> str`, that does renew → gate_get → `gate_cookie`, and use it.
  Keep `test_renewing_the_gate_needs_the_owner_on_home_arpa` with the JSON body added.

- [ ] **Step 2: Run to verify the new ones fail**

Run: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_gate.py`
Expected: FAIL — renew returns no `next`; sign-in still sends `hub_gate`.

- [ ] **Step 3: Implement** the `hub/gate.py` and `hub/app.py` Interfaces above. `api_gate_renew` reads the JSON body
  (follow how other JSON POST routes in `app.py` declare bodies), mints with
  `auth.gate_code(request.cookies.get(auth.COOKIE), urlsplit(next).hostname)`. Remove the `hub_gate` lines from
  `_signed_in` and `api_signout` (keep `auth.sign_out(request.cookies.get(gate.COOKIE))` in signout). Update the
  docstrings that describe a shared `.home.arpa` cookie.

- [ ] **Step 4: Update `gateSignIn` in `hub/static/js/main.js`**: POST `/api/gate/renew` with
  `headers: {"Content-Type": "application/json"}, body: JSON.stringify({ next })`; on `r.ok`,
  `location.replace((await r.json()).next)`. Keep the two-tries-a-minute guard and both toasts unchanged.

- [ ] **Step 5: Run everything**

Run: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests && node --test tests/*.mjs`
Expected: all pass, and the suite's real-lab/file guards report nothing.

- [ ] **Step 6: Commit**

```bash
git add hub/gate.py hub/app.py hub/static/js/main.js tests/test_gate.py
git commit -m "gate: per-tool host-only cookie via one-time hand-off (home.arpa is a public suffix)"
```

### Task 3: Gate check script, operations doc, live verification

**Files:**
- Modify: `deploy/gate-check.sh`, `docs/operations.md:194`

**Interfaces:**
- Consumes: the `gate_codes` table and `hub_gate_code` param from Tasks 1–2.

- [ ] **Step 1: `deploy/gate-check.sh`**: write the cookie jar with one host-only line per name
  (`<name>.home.arpa	FALSE	/	TRUE	0	hub_gate	<token>`) instead of the `.home.arpa` line, so curl builds
  with libpsl behave like browsers. Add one check: insert a `gate_codes` row (sha256 of a fresh code,
  `owner_hash` = the hash of the script's own short-lived owner-shaped session — or insert a matching `owner` session
  row with device `gate-check`, cleaned up by the existing trap), then
  `curl https://bambuddy.home.arpa/?hub_gate_code=<code>` must answer `302 https://bambuddy.home.arpa/` with a
  `Set-Cookie: hub_gate=` that has no `Domain`. Report it as `bambuddy code hand-off`. Extend the trap to delete
  `gate_codes` rows it made.

- [ ] **Step 2: `docs/operations.md`**: replace the "Sign-in" bullet's shared-cookie sentence with: signing in at
  `https://home.home.arpa` lets each tool get its own `hub_gate` cookie on first visit through a one-time code (30 s,
  single use, that tool only), because `home.arpa` is a public suffix and browsers refuse a cookie shared across it.
  Keep the rest of the bullet.

- [ ] **Step 3: Verify locally**

Run: `bash -n deploy/gate-check.sh && HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests`
Expected: no syntax error; all pass.

- [ ] **Step 4: Commit**

```bash
git add deploy/gate-check.sh docs/operations.md
git commit -m "gate: check the per-tool hand-off; document why the cookie is per tool"
```

- [ ] **Step 5: Hand off the deploy.** Stop. Ask the user to run `! cd ~/dev/pi-hub && git push pi main`.

- [ ] **Step 6: Live check after the user deploys**

Run: `ssh pi 'sudo bash /opt/pi-hub/current/deploy/gate-check.sh'`
Expected: every line `ok`, including `bambuddy code hand-off`.
Then ask the user to click, on the Workshop page in Safari, **Open Bambuddy ↗** (printer card), **Print lab ↗**
(lands on Local AI with `#projects` kept), **Open Local AI ↗** and **Scan a document ↗**: each opens the tool (or the
tool's own login) without returning to Home and without the "isn't keeping the sign-in" toast.
