import hashlib
import os
import tempfile
import time
from urllib.parse import unquote, urlsplit

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
with open(CODE_FILE, "w") as f:
    f.write("ABCD-1234\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, db, gate  # noqa: E402
from hub import app as hub_app  # noqa: E402

PASSWORD = "correct horse"


@pytest.fixture
def client():
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    auth._tries.clear()
    c = TestClient(hub_app.app)
    r = c.post("/api/setup", json={"code": "abcd-1234", "owner_password": PASSWORD},
               headers={"Origin": "http://testserver"})
    assert r.status_code == 200, r.text
    c.cookies.clear()
    return c


def signin(client, host, **body):
    return client.post("/api/signin", json=body or {"password": PASSWORD},
                       headers={"Host": host, "Origin": f"https://{host}"})


def gate_cookie(r):
    """The hub_gate value from a response (httpx won't keep a house-name cookie for testserver)."""
    for c in r.headers.get_list("set-cookie"):
        if c.startswith("hub_gate="):
            return c.split(";")[0].split("=", 1)[1]
    return None


def gate_get(client, host, uri, **kw):
    # As Caddy's forward_auth sends them: it always names the method.
    return client.get("/api/gate", follow_redirects=False,
                      headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": host, "X-Forwarded-Uri": uri,
                               "X-Forwarded-Method": "GET"}, **kw)


def renew(client, next_url):
    return client.post("/api/gate/renew", json={"next": next_url},
                       headers={"Host": "hub.rahe-home.duckdns.org", "Origin": "https://hub.rahe-home.duckdns.org"})


def tool_token(client, host="bambuddy.rahe-home.duckdns.org"):
    """A tool's host-only gate token for the signed-in owner: renew, then spend the code at the gate."""
    nxt = urlsplit(renew(client, f"https://{host}/").json()["next"])
    token = gate_cookie(gate_get(client, host, f"{nxt.path}?{nxt.query}"))
    assert token
    return token


def test_safe_next_only_allows_home_arpa():
    assert gate.safe_next("https://bambuddy.rahe-home.duckdns.org/x?y=1") == "https://bambuddy.rahe-home.duckdns.org/x?y=1"
    for bad in ("https://evil.com", "//evil.com", "http://bambuddy.rahe-home.duckdns.org/", "https://home.arpa.evil.com", "",
                "javascript:alert(1)", "https://user@evil.com", None):
        assert gate.safe_next(bad) == "https://hub.rahe-home.duckdns.org/"


def test_gate_redirects_when_signed_out(client):
    r = client.get("/api/gate", headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "bambuddy.rahe-home.duckdns.org",
                                         "X-Forwarded-Uri": "/inventory"}, follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == ("https://hub.rahe-home.duckdns.org/?signin=owner&next="
                                     "https%3A%2F%2Fbambuddy.rahe-home.duckdns.org%2Finventory")
    assert r.headers["cache-control"] == "no-store"


def test_gate_redirect_never_points_outside_home_arpa(client):
    r = client.get("/api/gate", headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "evil.com",
                                         "X-Forwarded-Uri": "/"}, follow_redirects=False)
    assert r.headers["location"] == "https://hub.rahe-home.duckdns.org/?signin=owner&next=https%3A%2F%2Fhub.rahe-home.duckdns.org%2F"


def test_gate_lets_the_owner_through_with_either_cookie(client):
    r = signin(client, "hub.rahe-home.duckdns.org")
    session_token = r.cookies.get("hub_session")
    gate_token = tool_token(client)
    assert gate_token != session_token  # the cookie a tool sees is not the hub session
    client.cookies.clear()
    for name, token in (("hub_gate", gate_token), ("hub_session", session_token)):
        r = client.get("/api/gate", cookies={name: token}, headers={"X-Forwarded-Method": "GET"})
        assert r.status_code == 200 and r.headers["x-remote-user"] == "bill"


def test_a_gate_token_is_never_a_hub_session(client):
    signin(client, "hub.rahe-home.duckdns.org")
    gate_token = tool_token(client)
    client.cookies.clear()
    assert client.get("/api/me", cookies={"hub_session": gate_token}).json()["role"] == "none"
    # and an owner's hub session put in the gate cookie isn't a gate token
    session_token = signin(client, "hub.rahe-home.duckdns.org").cookies.get("hub_session")
    client.cookies.clear()
    assert client.get("/api/gate", cookies={"hub_gate": session_token}, follow_redirects=False).status_code == 302


def test_gate_refuses_a_pin_day_household_session_and_unknown_tokens(client):
    household = "old-household-token"
    auth._ready()
    db.run("INSERT INTO sessions (token_hash, role, created, expires) VALUES (?, 'household', 0, ?)",
           hashlib.sha256(household.encode()).hexdigest(), int(time.time()) + 3600)
    assert client.get("/api/gate", cookies={"hub_gate": household}, follow_redirects=False).status_code == 302
    assert client.get("/api/gate", cookies={"hub_session": household}, follow_redirects=False).status_code == 302
    assert client.get("/api/gate", cookies={"hub_gate": "not-a-token"}, follow_redirects=False).status_code == 302


def test_renew_hands_back_next_with_a_code_and_the_gate_spends_it(client):
    signin(client, "hub.rahe-home.duckdns.org")
    r = renew(client, "https://bambuddy.rahe-home.duckdns.org/x?y=1")
    assert r.status_code == 200 and gate_cookie(r) is None
    nxt = urlsplit(r.json()["next"])
    assert (nxt.hostname, nxt.path) == ("bambuddy.rahe-home.duckdns.org", "/x") and "y=1" in nxt.query
    client.cookies.clear()
    g = gate_get(client, "bambuddy.rahe-home.duckdns.org", f"{nxt.path}?{nxt.query}")
    assert g.status_code == 302 and g.headers["location"] == "https://bambuddy.rahe-home.duckdns.org/x?y=1"
    assert g.headers["cache-control"] == "no-store"
    cookie = [c for c in g.headers.get_list("set-cookie") if c.startswith("hub_gate=")][0]
    assert "Domain" not in cookie and "Secure" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert gate_get(client, "bambuddy.rahe-home.duckdns.org", "/x?y=1", cookies={"hub_gate": gate_cookie(g)}).status_code == 200
    again = gate_get(client, "bambuddy.rahe-home.duckdns.org", f"{nxt.path}?{nxt.query}")   # replayed code
    assert again.status_code == 302 and "hub_gate_code" not in unquote(again.headers["location"])
    assert again.headers["location"].startswith("https://hub.rahe-home.duckdns.org/?signin=owner&next=")


def test_renew_refuses_unsafe_or_hub_destinations(client):
    signin(client, "hub.rahe-home.duckdns.org")
    for bad in ("http://bambuddy.rahe-home.duckdns.org/", "https://evil.com/", "https://hub.rahe-home.duckdns.org/", "not a url"):
        assert renew(client, bad).status_code == 400


def test_signin_and_signout_never_send_a_domain_cookie(client):
    r = signin(client, "hub.rahe-home.duckdns.org")
    assert not any(c.startswith("hub_gate=") for c in r.headers.get_list("set-cookie"))
    r = client.post("/api/signout", headers={"Host": "hub.rahe-home.duckdns.org", "Origin": "https://hub.rahe-home.duckdns.org"})
    assert not any("Domain=" in c and "hub_gate" in c for c in r.headers.get_list("set-cookie"))


def test_a_code_is_only_good_for_its_own_host(client):
    signin(client, "hub.rahe-home.duckdns.org")
    nxt = urlsplit(renew(client, "https://bambuddy.rahe-home.duckdns.org/").json()["next"])
    client.cookies.clear()
    other = gate_get(client, "assistant.rahe-home.duckdns.org", f"/?{nxt.query}")
    assert other.status_code == 302 and gate_cookie(other) is None
    ok = gate_get(client, "Bambuddy.rahe-home.duckdns.org:443", f"/?{nxt.query}")  # still unspent; case and port normalized
    assert gate_cookie(ok) and not ok.headers["location"].startswith("https://hub.rahe-home.duckdns.org/")


def test_a_forwarded_host_cannot_redirect_a_spent_code_elsewhere(client):
    signin(client, "hub.rahe-home.duckdns.org")
    nxt = urlsplit(renew(client, "https://bambuddy.rahe-home.duckdns.org/").json()["next"])
    client.cookies.clear()
    r = gate_get(client, "bambuddy.rahe-home.duckdns.org:@evil.com", f"/?{nxt.query}")
    assert gate_cookie(r) is None and "evil.com" not in urlsplit(r.headers["location"]).hostname
    assert gate_cookie(gate_get(client, "bambuddy.rahe-home.duckdns.org", f"/?{nxt.query}"))  # the code was not spent


def test_spending_a_code_revokes_the_tools_previous_token(client):
    signin(client, "hub.rahe-home.duckdns.org")
    old = tool_token(client)
    nxt = urlsplit(renew(client, "https://bambuddy.rahe-home.duckdns.org/").json()["next"])
    client.cookies.clear()
    new = gate_cookie(gate_get(client, "bambuddy.rahe-home.duckdns.org", f"/?{nxt.query}", cookies={"hub_gate": old}))
    client.cookies.clear()
    assert client.get("/api/gate", cookies={"hub_gate": new}).status_code == 200
    assert client.get("/api/gate", cookies={"hub_gate": old}, follow_redirects=False).status_code == 302


def test_a_replayed_code_with_a_live_cookie_is_dropped_from_the_address(client):
    signin(client, "hub.rahe-home.duckdns.org")
    nxt = urlsplit(renew(client, "https://bambuddy.rahe-home.duckdns.org/x").json()["next"])
    client.cookies.clear()
    cookie = gate_cookie(gate_get(client, "bambuddy.rahe-home.duckdns.org", f"{nxt.path}?{nxt.query}"))
    r = gate_get(client, "bambuddy.rahe-home.duckdns.org", f"{nxt.path}?{nxt.query}", cookies={"hub_gate": cookie})
    assert r.status_code == 302 and r.headers["location"] == "https://bambuddy.rahe-home.duckdns.org/x"
    assert not r.headers.get_list("set-cookie")


def test_gate_helpers_add_and_strip_the_code():
    assert gate.with_code("https://a.rahe-home.duckdns.org/x?y=1", "c1") == "https://a.rahe-home.duckdns.org/x?y=1&hub_gate_code=c1"
    assert gate.with_code("https://a.rahe-home.duckdns.org/", "c1") == "https://a.rahe-home.duckdns.org/?hub_gate_code=c1"
    assert gate.split_code("https://a.rahe-home.duckdns.org/x?y=1&hub_gate_code=c1&z=2") == ("https://a.rahe-home.duckdns.org/x?y=1&z=2", "c1")
    assert gate.split_code("https://a.rahe-home.duckdns.org/?hub_gate_code=c1") == ("https://a.rahe-home.duckdns.org/", "c1")
    assert gate.split_code("https://a.rahe-home.duckdns.org/?flag&hub_gate_code=x")[0] == "https://a.rahe-home.duckdns.org/?flag"
    assert gate.split_code("https://a.rahe-home.duckdns.org/?/route&hub_gate_code=x")[0] == "https://a.rahe-home.duckdns.org/?/route"
    for u in ("https://a.rahe-home.duckdns.org/?flag", "https://a.rahe-home.duckdns.org/?/route", "https://a.rahe-home.duckdns.org/?q=a%20b", "https://a.rahe-home.duckdns.org/x"):
        assert gate.split_code(gate.with_code(u, "c-1_x")) == (u, "c-1_x")
    assert gate.split_code("https://a.rahe-home.duckdns.org/?y=1") == ("https://a.rahe-home.duckdns.org/?y=1", None)


def test_renewing_the_gate_needs_the_owner_on_home_arpa(client):
    headers = {"Host": "hub.rahe-home.duckdns.org", "Origin": "https://hub.rahe-home.duckdns.org"}
    body = {"next": "https://bambuddy.rahe-home.duckdns.org/"}
    assert client.post("/api/gate/renew", json=body, headers=headers).status_code == 401
    signin(client, "10.0.0.80")
    r = client.post("/api/gate/renew", json=body, headers={"Host": "10.0.0.80", "Origin": "https://10.0.0.80"})
    assert r.status_code == 400 and gate_cookie(r) is None


def test_signing_out_revokes_every_gate_token_from_that_sign_in(client):
    headers = {"Host": "hub.rahe-home.duckdns.org", "Origin": "https://hub.rahe-home.duckdns.org"}
    session = signin(client, "hub.rahe-home.duckdns.org").cookies.get("hub_session")
    first, second = tool_token(client), tool_token(client, "assistant.rahe-home.duckdns.org")
    client.cookies.clear()
    assert client.get("/api/gate", cookies={"hub_gate": first}).status_code == 200
    client.post("/api/signout", headers=headers, cookies={"hub_session": session})  # without the tokens in hand
    client.cookies.clear()
    for t in (first, second):
        assert client.get("/api/gate", cookies={"hub_gate": t}, follow_redirects=False).status_code == 302


def test_a_gate_token_never_outlives_its_sign_in(client):
    import sqlite3
    signin(client, "hub.rahe-home.duckdns.org")
    db = sqlite3.connect(os.environ["HUB_DB"])
    (owner,) = db.execute("SELECT expires FROM sessions WHERE role = 'owner'").fetchone()
    db.execute("UPDATE sessions SET expires = ? WHERE role = 'owner'", (owner - 3600,)); db.commit()
    tool_token(client)
    (gate_expires,) = db.execute("SELECT expires FROM sessions WHERE role = 'gate' ORDER BY rowid DESC").fetchone()
    assert gate_expires <= owner - 3600


def test_a_gate_code_is_spent_once_on_its_own_host(client):
    owner = signin(client, "hub.rahe-home.duckdns.org").cookies.get("hub_session")
    code = auth.gate_code(owner, "bambuddy.rahe-home.duckdns.org")
    assert auth.redeem_gate_code(code, "assistant.rahe-home.duckdns.org") is None      # wrong host: refused, not spent
    token = auth.redeem_gate_code(code, "bambuddy.rahe-home.duckdns.org")
    assert token and auth.session(token, gate=True)
    assert auth.redeem_gate_code(code, "bambuddy.rahe-home.duckdns.org") is None       # spent


def test_a_gate_code_expires_and_dies_with_its_sign_in(client, monkeypatch):
    owner = signin(client, "hub.rahe-home.duckdns.org").cookies.get("hub_session")
    old = auth.gate_code(owner, "bambuddy.rahe-home.duckdns.org")
    real = auth.time.time
    monkeypatch.setattr(auth.time, "time", lambda: real() + auth.GATE_CODE_SECONDS + 1)
    assert auth.redeem_gate_code(old, "bambuddy.rahe-home.duckdns.org") is None
    monkeypatch.undo()
    code = auth.gate_code(owner, "bambuddy.rahe-home.duckdns.org")
    auth.sign_out(owner)
    assert auth.redeem_gate_code(code, "bambuddy.rahe-home.duckdns.org") is None


def test_only_a_live_owner_gets_a_gate_code(client):
    household = "old-household-token"
    auth._ready()
    db.run("INSERT INTO sessions (token_hash, role, created, expires) VALUES (?, 'household', 0, ?)",
           hashlib.sha256(household.encode()).hexdigest(), int(time.time()) + 3600)
    assert auth.gate_code(household, "bambuddy.rahe-home.duckdns.org") is None
    assert auth.gate_code("not-a-token", "bambuddy.rahe-home.duckdns.org") is None


def test_sign_out_works_before_anything_else_has_touched_the_database(tmp_path, monkeypatch):
    monkeypatch.setenv("HUB_DB", str(tmp_path / "fresh.db"))
    auth.sign_out("anything")


def test_a_gate_code_whose_owner_has_expired_is_refused(client):
    import hashlib
    import sqlite3
    owner = signin(client, "hub.rahe-home.duckdns.org").cookies.get("hub_session")
    code = auth.gate_code(owner, "bambuddy.rahe-home.duckdns.org")
    db = sqlite3.connect(os.environ["HUB_DB"])
    db.execute("UPDATE sessions SET expires = ? WHERE token_hash = ?",
               (int(auth.time.time()) - 60, hashlib.sha256(owner.encode()).hexdigest())); db.commit()
    assert auth.redeem_gate_code(code, "bambuddy.rahe-home.duckdns.org") is None


def test_a_redeemed_gate_token_ends_when_its_owner_does(client):
    import hashlib
    import sqlite3
    owner = signin(client, "hub.rahe-home.duckdns.org").cookies.get("hub_session")
    token = auth.redeem_gate_code(auth.gate_code(owner, "bambuddy.rahe-home.duckdns.org"), "bambuddy.rahe-home.duckdns.org")
    db = sqlite3.connect(os.environ["HUB_DB"])
    (owner_expires,) = db.execute("SELECT expires FROM sessions WHERE token_hash = ?",
                                  (hashlib.sha256(owner.encode()).hexdigest(),)).fetchone()
    assert auth.session(token, gate=True)["expires"] == owner_expires


# Real names (docs/superpowers/specs/2026-11-01-real-names-design.md): each tool also answers under the real name, and a
# visit there signs in, and is sent back, on that name's hub.
REAL_HUB = "hub.rahe-home.duckdns.org"


def test_safe_next_allows_the_real_name_only():
    assert gate.safe_next("https://bambuddy.rahe-home.duckdns.org/x") == "https://bambuddy.rahe-home.duckdns.org/x"
    for bad in ("https://evilrahe-home.duckdns.org/", "https://rahe-home.duckdns.org.evil.com/",
                "https://other.duckdns.org/", "http://bambuddy.rahe-home.duckdns.org/"):
        assert gate.safe_next(bad) == "https://hub.rahe-home.duckdns.org/"


def test_signed_out_on_the_real_name_signs_in_on_its_hub(client):
    g = gate_get(client, "bambuddy.rahe-home.duckdns.org", "/inventory")
    assert g.status_code == 302
    assert g.headers["location"] == (f"https://{REAL_HUB}/?signin=owner&next="
                                     "https%3A%2F%2Fbambuddy.rahe-home.duckdns.org%2Finventory")


def test_the_hand_off_works_on_the_real_name(client):
    signin(client, REAL_HUB)
    r = client.post("/api/gate/renew", json={"next": "https://bambuddy.rahe-home.duckdns.org/x"},
                    headers={"Host": REAL_HUB, "Origin": f"https://{REAL_HUB}"})
    assert r.status_code == 200, r.text
    nxt = urlsplit(r.json()["next"])
    assert nxt.hostname == "bambuddy.rahe-home.duckdns.org"
    client.cookies.clear()
    g = gate_get(client, "bambuddy.rahe-home.duckdns.org", f"{nxt.path}?{nxt.query}")
    assert g.status_code == 302 and g.headers["location"] == "https://bambuddy.rahe-home.duckdns.org/x"
    assert gate_get(client, "bambuddy.rahe-home.duckdns.org", "/x", cookies={"hub_gate": gate_cookie(g)}).status_code == 200


def test_renew_on_the_real_name_refuses_either_hub(client):
    signin(client, REAL_HUB)
    for bad in (f"https://{REAL_HUB}/", "https://hub.rahe-home.duckdns.org/", "https://evil.com/"):
        r = client.post("/api/gate/renew", json={"next": bad}, headers={"Host": REAL_HUB, "Origin": f"https://{REAL_HUB}"})
        assert r.status_code == 400, bad


def test_a_gate_cookie_does_not_carry_a_change_from_another_tool(client):
    # Under the real name every tool is one site, so SameSite=Lax would let status.<name> post to adguard.<name>.
    signin(client, REAL_HUB)
    r = client.post("/api/gate/renew", json={"next": "https://adguard.rahe-home.duckdns.org/"},
                    headers={"Host": REAL_HUB, "Origin": f"https://{REAL_HUB}"})
    nxt = urlsplit(r.json()["next"])
    client.cookies.clear()
    token = gate_cookie(gate_get(client, "adguard.rahe-home.duckdns.org", f"{nxt.path}?{nxt.query}"))
    assert token

    def ask(method, **h):
        return client.get("/api/gate", follow_redirects=False, cookies={"hub_gate": token}, headers={
            "X-Forwarded-Proto": "https", "X-Forwarded-Host": "adguard.rahe-home.duckdns.org",
            "X-Forwarded-Uri": "/control/rewrite/add", "X-Forwarded-Method": method, **h})
    assert ask("POST", **{"Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "cors"}).status_code == 302
    assert ask("POST", Origin="https://status.rahe-home.duckdns.org").status_code == 302
    assert ask("POST", **{"Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors"}).status_code == 200
    assert ask("POST", Origin="https://adguard.rahe-home.duckdns.org").status_code == 200
    assert ask("GET", **{"Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "navigate"}).status_code == 200
