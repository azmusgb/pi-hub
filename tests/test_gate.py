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
