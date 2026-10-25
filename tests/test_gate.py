import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
with open(CODE_FILE, "w") as f:
    f.write("ABCD-1234\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, gate  # noqa: E402
from hub import app as hub_app  # noqa: E402

PASSWORD = "correct horse"


@pytest.fixture
def client():
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    auth._tries.clear()
    c = TestClient(hub_app.app)
    r = c.post("/api/setup", json={"code": "abcd-1234", "owner_password": PASSWORD, "pin": "123456"},
               headers={"Origin": "http://testserver"})
    assert r.status_code == 200, r.text
    c.cookies.clear()
    return c


def signin(client, host, **body):
    return client.post("/api/signin", json=body or {"password": PASSWORD},
                       headers={"Host": host, "Origin": f"https://{host}"})


def gate_cookie(r):
    """The hub_gate value from a response (httpx won't keep a .home.arpa cookie for testserver)."""
    for c in r.headers.get_list("set-cookie"):
        if c.startswith("hub_gate="):
            return c.split(";")[0].split("=", 1)[1]
    return None


def test_safe_next_only_allows_home_arpa():
    assert gate.safe_next("https://bambuddy.home.arpa/x?y=1") == "https://bambuddy.home.arpa/x?y=1"
    for bad in ("https://evil.com", "//evil.com", "http://bambuddy.home.arpa/", "https://home.arpa.evil.com", "",
                "javascript:alert(1)", "https://user@evil.com", None):
        assert gate.safe_next(bad) == "https://home.home.arpa/"


def test_gate_redirects_when_signed_out(client):
    r = client.get("/api/gate", headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "bambuddy.home.arpa",
                                         "X-Forwarded-Uri": "/inventory"}, follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"] == ("https://home.home.arpa/?signin=owner&next="
                                     "https%3A%2F%2Fbambuddy.home.arpa%2Finventory")
    assert r.headers["cache-control"] == "no-store"


def test_gate_redirect_never_points_outside_home_arpa(client):
    r = client.get("/api/gate", headers={"X-Forwarded-Proto": "https", "X-Forwarded-Host": "evil.com",
                                         "X-Forwarded-Uri": "/"}, follow_redirects=False)
    assert r.headers["location"] == "https://home.home.arpa/?signin=owner&next=https%3A%2F%2Fhome.home.arpa%2F"


def test_gate_lets_the_owner_through_with_either_cookie(client):
    r = signin(client, "home.home.arpa")
    session_token, gate_token = r.cookies.get("hub_session"), gate_cookie(r)
    assert gate_token and gate_token != session_token  # the cookie every tool sees is not the hub session
    client.cookies.clear()
    for name, token in (("hub_gate", gate_token), ("hub_session", session_token)):
        r = client.get("/api/gate", cookies={name: token})
        assert r.status_code == 200 and r.headers["x-remote-user"] == "bill"


def test_a_gate_token_is_never_a_hub_session(client):
    gate_token = gate_cookie(signin(client, "home.home.arpa"))
    client.cookies.clear()
    assert client.get("/api/me", cookies={"hub_session": gate_token}).json()["role"] == "none"
    # and an owner's hub session put in the gate cookie isn't a gate token
    session_token = signin(client, "home.home.arpa").cookies.get("hub_session")
    client.cookies.clear()
    assert client.get("/api/gate", cookies={"hub_gate": session_token}, follow_redirects=False).status_code == 302


def test_gate_refuses_household_and_unknown_tokens(client):
    household = signin(client, "home.home.arpa", pin="123456").cookies.get("hub_session")
    client.cookies.clear()
    assert client.get("/api/gate", cookies={"hub_gate": household}, follow_redirects=False).status_code == 302
    assert client.get("/api/gate", cookies={"hub_gate": "not-a-token"}, follow_redirects=False).status_code == 302


def test_signin_on_home_arpa_sets_the_gate_cookie_and_signout_clears_it(client):
    r = signin(client, "home.home.arpa")
    header = [c for c in r.headers.get_list("set-cookie") if c.startswith("hub_gate=")]
    assert header and "Domain=.home.arpa" in header[0] and "Secure" in header[0]
    assert "HttpOnly" in header[0] and "SameSite=lax" in header[0]
    client.cookies.clear()
    gate_token = gate_cookie(r)
    client.cookies.clear()
    r = signin(client, "10.0.0.30")
    assert not any(c.startswith("hub_gate=") for c in r.headers.get_list("set-cookie"))
    client.cookies.clear()
    assert not any(c.startswith("hub_gate=") for c in signin(client, "home.home.arpa", pin="123456").headers.get_list("set-cookie"))
    client.cookies.set("hub_gate", gate_token)
    r = client.post("/api/signout", headers={"Host": "home.home.arpa", "Origin": "https://home.home.arpa"})
    assert any(c.startswith("hub_gate=") and "Max-Age=0" in c and "Domain=.home.arpa" in c
               for c in r.headers.get_list("set-cookie"))
    client.cookies.clear()
    assert client.get("/api/gate", cookies={"hub_gate": gate_token}, follow_redirects=False).status_code == 302  # revoked


def test_a_signed_in_owner_can_renew_a_missing_gate_token(client):
    # Signed in at home.home.arpa but with no (or a stale) gate cookie: the sign-in hand-back renews it instead of
    # bouncing between the tool and the hub.
    signin(client, "home.home.arpa")
    headers = {"Host": "home.home.arpa", "Origin": "https://home.home.arpa"}
    r = client.post("/api/gate/renew", headers=headers)
    assert r.status_code == 200
    client.cookies.clear()
    assert client.get("/api/gate", cookies={"hub_gate": gate_cookie(r)}).status_code == 200


def test_renewing_the_gate_needs_the_owner_on_home_arpa(client):
    headers = {"Host": "home.home.arpa", "Origin": "https://home.home.arpa"}
    assert client.post("/api/gate/renew", headers=headers).status_code == 401
    signin(client, "home.home.arpa", pin="123456")
    assert client.post("/api/gate/renew", headers=headers).status_code == 401
    client.cookies.clear()
    signin(client, "10.0.0.30")
    r = client.post("/api/gate/renew", headers={"Host": "10.0.0.30", "Origin": "https://10.0.0.30"})
    assert r.status_code == 400 and gate_cookie(r) is None


def test_signing_out_revokes_every_gate_token_from_that_sign_in(client):
    headers = {"Host": "home.home.arpa", "Origin": "https://home.home.arpa"}
    r = signin(client, "home.home.arpa")
    session, first = r.cookies.get("hub_session"), gate_cookie(r)
    client.cookies.clear()
    renewed = gate_cookie(client.post("/api/gate/renew", headers=headers,
                                      cookies={"hub_session": session, "hub_gate": first}))
    client.cookies.clear()
    assert client.get("/api/gate", cookies={"hub_gate": first}, follow_redirects=False).status_code == 302  # replaced
    assert client.get("/api/gate", cookies={"hub_gate": renewed}).status_code == 200
    client.post("/api/signout", headers=headers, cookies={"hub_session": session})  # without `renewed` in hand
    client.cookies.clear()
    assert client.get("/api/gate", cookies={"hub_gate": renewed}, follow_redirects=False).status_code == 302


def test_a_gate_token_never_outlives_its_sign_in(client):
    import sqlite3
    signin(client, "home.home.arpa")
    db = sqlite3.connect(os.environ["HUB_DB"])
    (owner,) = db.execute("SELECT expires FROM sessions WHERE role = 'owner'").fetchone()
    db.execute("UPDATE sessions SET expires = ? WHERE role = 'owner'", (owner - 3600,)); db.commit()
    r = client.post("/api/gate/renew", headers={"Host": "home.home.arpa", "Origin": "https://home.home.arpa"})
    (gate_expires,) = db.execute("SELECT expires FROM sessions WHERE role = 'gate' ORDER BY rowid DESC").fetchone()
    assert gate_expires <= owner - 3600 and r.status_code == 200
