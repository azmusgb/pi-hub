"""The owner's own Tailscale devices (hub/devices.py): who counts as one, and everything that must not."""
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
with open(CODE_FILE, "w") as f:
    f.write("ABCD-1234\n")
SECRET = "s" * 64
SECRET_FILE = os.path.join(_tmp, "hub_proxy.env")
with open(SECRET_FILE, "w") as f:
    f.write(f"HUB_PROXY_SECRET={SECRET}\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, devices  # noqa: E402
from hub import app as hub_app  # noqa: E402

PASSWORD = "correct horse"
MAC, PC, IPAD, TAGGED, FRIEND = "100.109.178.34", "100.78.96.97", "100.100.62.44", "100.90.1.1", "100.90.2.2"
NODES = {
    MAC: {"Node": {"StableID": "nMAC", "ComputedName": "bills-macbook-pro", "Name": "bills-macbook-pro.ts.net."},
          "UserProfile": {"LoginName": "owner@example.com"}},
    PC: {"Node": {"StableID": "nPC", "ComputedName": "bill-hpdesktop"}, "UserProfile": {"LoginName": "owner@example.com"}},
    IPAD: {"Node": {"StableID": "nIPAD", "ComputedName": "ipad"}, "UserProfile": {"LoginName": "owner@example.com"}},
    TAGGED: {"Node": {"StableID": "nTAG", "ComputedName": "server", "Tags": ["tag:server"]},
             "UserProfile": {"LoginName": "owner@example.com"}},
    FRIEND: {"Node": {"StableID": "nFRIEND", "ComputedName": "friend"}, "UserProfile": {"LoginName": "friend@example.com"}},
}
asked = []


def fake_whois(addr):
    asked.append(addr)
    if addr not in NODES:
        raise OSError("no such peer")
    return NODES[addr]


@pytest.fixture
def client(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    os.environ["HUB_PROXY_SECRET_FILE"] = SECRET_FILE
    monkeypatch.setattr(devices, "_whois_raw", fake_whois)
    devices.forget_cache()
    asked.clear()
    auth._tries.clear()
    c = TestClient(hub_app.app)
    r = c.post("/api/setup", json={"code": "abcd-1234", "owner_password": PASSWORD},
               headers={"Origin": "http://testserver"})
    assert r.status_code == 200, r.text
    c.cookies.clear()
    return c


def via(addr, secret=SECRET, origin="http://testserver"):
    h = {"X-Hub-Peer": addr}
    if origin:
        h["Origin"] = origin
    if secret is not None:
        h["X-Hub-Proxy"] = secret
    return h


def remember(client, addr):
    """Signs in with the password from `addr` with "Remember this device", then drops the cookie."""
    r = client.post("/api/signin", json={"password": PASSWORD, "remember": True}, headers=via(addr))
    assert r.status_code == 200, r.text
    client.cookies.clear()


def role(client, headers):
    return client.get("/api/me", headers=headers).json()["role"]


def test_a_remembered_device_is_the_owner_with_no_cookie(client):
    remember(client, MAC)
    assert role(client, via(MAC)) == "owner"
    assert client.get("/api/settings", headers=via(MAC)).status_code == 200
    assert auth.get("owner_login") == "owner@example.com"


def test_an_unlisted_device_is_not(client):
    remember(client, MAC)
    assert role(client, via(PC)) == "none"
    assert client.get("/api/settings", headers=via(PC)).status_code == 401


@pytest.mark.parametrize("secret", [None, "", "wrong" * 13, SECRET[:-1]])
def test_the_address_counts_only_with_caddys_secret(client, secret):
    remember(client, MAC)
    assert role(client, via(MAC, secret)) == "none"


def test_no_secret_file_means_no_devices(client, monkeypatch):
    remember(client, MAC)
    monkeypatch.setenv("HUB_PROXY_SECRET_FILE", os.path.join(_tmp, "missing.env"))
    assert role(client, via(MAC)) == "none"


@pytest.mark.parametrize("addr", ["10.0.0.21", "127.0.0.1", "", "not-an-ip", "fd7a:115c:a1e0::1", "100.128.0.1"])
def test_only_tailnet_addresses_are_asked_about(client, addr):
    remember(client, MAC)
    asked.clear()
    assert role(client, via(addr)) == "none"
    assert asked == []


def test_a_tagged_node_is_never_the_owner(client):
    remember(client, MAC)
    devices._ready()
    hub_app.db.run("INSERT INTO owner_devices (stable_id, name, login, added) VALUES ('nTAG', 'server', 'owner@example.com', 0)")
    assert role(client, via(TAGGED)) == "none"
    r = client.post("/api/signin", json={"password": PASSWORD}, headers=via(TAGGED))
    r = client.post("/api/settings/device-add", json={}, headers=via(TAGGED))
    assert r.status_code == 400 and "tagged" in r.json()["detail"]


def test_another_tailscale_login_is_refused(client):
    remember(client, MAC)
    client.post("/api/signin", json={"password": PASSWORD}, headers=via(FRIEND))
    r = client.post("/api/settings/device-add", json={}, headers=via(FRIEND))
    assert r.status_code == 400 and "friend@example.com" in r.json()["detail"]
    client.cookies.clear()
    assert role(client, via(FRIEND)) == "none"


def test_whois_failure_is_not_the_owner(client, monkeypatch):
    remember(client, MAC)
    devices.forget_cache()

    def down(addr):
        raise OSError("tailscaled isn't answering")
    monkeypatch.setattr(devices, "_whois_raw", down)
    assert role(client, via(MAC)) == "none"


def test_whois_is_cached(client):
    remember(client, MAC)
    asked.clear()
    for _ in range(3):
        assert role(client, via(MAC)) == "owner"
    assert asked == []  # the sign-in already asked about MAC, within the minute


def test_the_gate_lets_a_device_through_and_renew_needs_no_code(client):
    remember(client, PC)
    r = client.get("/api/gate", follow_redirects=False, headers={
        "X-Forwarded-Proto": "https", "X-Forwarded-Host": "bambuddy.rahe-home.duckdns.org", "X-Forwarded-Uri": "/", "X-Forwarded-Method": "GET", **via(PC, origin=None)})
    assert r.status_code == 200 and r.headers["x-remote-user"] == "bill"
    r = client.post("/api/gate/renew", json={"next": "https://bambuddy.rahe-home.duckdns.org/x"},
                    headers={**via(PC), "Host": "hub.rahe-home.duckdns.org", "Origin": "https://hub.rahe-home.duckdns.org"})
    assert r.status_code == 200 and r.json()["next"] == "https://bambuddy.rahe-home.duckdns.org/x"


def test_the_gate_still_refuses_an_unlisted_device(client):
    remember(client, PC)
    r = client.get("/api/gate", follow_redirects=False, headers={
        "X-Forwarded-Proto": "https", "X-Forwarded-Host": "bambuddy.rahe-home.duckdns.org", "X-Forwarded-Uri": "/", **via(IPAD, origin=None)})
    assert r.status_code == 302


def test_a_device_adds_another_from_settings(client):
    remember(client, MAC)
    # The iPad asks; the owner (signed in with the password there) adds it.
    client.post("/api/signin", json={"password": PASSWORD}, headers=via(IPAD))
    r = client.post("/api/settings/device-add", json={}, headers=via(IPAD))
    assert r.status_code == 200, r.text
    client.cookies.clear()
    assert role(client, via(IPAD)) == "owner"
    names = [d["name"] for d in client.get("/api/settings", headers=via(MAC)).json()["devices"]["listed"]]
    assert names == ["bills-macbook-pro", "ipad"]


def test_removing_a_device_ends_it(client):
    remember(client, MAC)
    remember(client, PC)
    r = client.post("/api/settings/device-remove", json={"stable_id": "nPC"}, headers=via(MAC))
    assert r.status_code == 200, r.text
    assert role(client, via(PC)) == "none"


def test_a_device_cant_remove_itself_without_the_password(client):
    remember(client, MAC)
    r = client.post("/api/settings/device-remove", json={"stable_id": "nMAC"}, headers=via(MAC))
    assert r.status_code == 400 and "owner password" in r.json()["detail"]
    assert role(client, via(MAC)) == "owner"
    client.post("/api/signin", json={"password": PASSWORD}, headers=via(MAC))
    r = client.post("/api/settings/device-remove", json={"stable_id": "nMAC"}, headers=via(MAC))
    assert r.status_code == 200
    client.cookies.clear()
    assert role(client, via(MAC)) == "none"


def test_remember_off_or_off_tailscale_adds_nothing(client):
    r = client.post("/api/signin", json={"password": PASSWORD}, headers=via(MAC))
    assert r.status_code == 200
    r = client.post("/api/signin", json={"password": PASSWORD, "remember": True}, headers={"Origin": "http://testserver"})
    assert r.status_code == 200
    client.cookies.clear()
    assert role(client, via(MAC)) == "none"
    assert devices.listed() == []


def test_the_cookie_still_decides_first(client):
    remember(client, MAC)
    r = client.post("/api/signin", json={"password": PASSWORD}, headers=via(MAC))
    assert r.status_code == 200
    assert role(client, via(MAC)) == "owner"
    assert client.get("/api/me", headers=via(MAC)).json()["device"] == "A browser"  # the cookie's name, not the list's


def test_device_actions_are_logged_with_the_device_name(client):
    remember(client, MAC)
    r = client.post("/api/settings/quiet", json={"on": True, "from": "22:00", "to": "07:00"}, headers=via(MAC))
    assert r.status_code == 200, r.text
    log = auth.recent_actions(5)
    assert log[0]["device"] == "bills-macbook-pro" and log[0]["role"] == "owner"


def test_me_says_whether_this_device_is_on_tailscale(client):
    assert client.get("/api/me", headers=via(MAC)).json()["tailscale"] is True
    assert client.get("/api/me", headers={"Origin": "http://testserver"}).json()["tailscale"] is False


def test_caddy_sends_the_peer_and_secret_on_every_way_to_the_hub():
    """Each place Caddy calls the hub sets both headers itself (header_up replaces what a client sent)."""
    import re
    text = open(os.path.join(os.path.dirname(__file__), "..", "deploy", "caddy", "Caddyfile")).read()
    snippet = re.search(r"\(hub_peer\) \{(.*?)\n\}", text, re.S).group(1)
    assert "header_up X-Hub-Peer {remote_host}" in snippet and "header_up X-Hub-Proxy {$HUB_PROXY_SECRET}" in snippet
    fa = re.search(r"forward_auth 127\.0\.0\.1:8100 \{(.*?)\n\t\}", text, re.S).group(1)
    assert "header_up X-Hub-Peer {remote_host}" in fa and "header_up X-Hub-Proxy {$HUB_PROXY_SECRET}" in fa
    # Every way to the hub over https (the hub's site, and the display's and lab's paths on the old name) imports
    # hub_peer; only the plain-http machine paths don't, and they never carry the owner's devices.
    proxies = re.findall(r"reverse_proxy 127\.0\.0\.1:8100( \{\s*import hub_peer\s*\})?", text)
    assert sum(1 for p in proxies if p) == 4 and sum(1 for p in proxies if not p) == 1
    plain = text.split("\nhttp:// {", 1)[1]
    assert re.search(r"reverse_proxy 127\.0\.0\.1:8100\n", plain)
    assert "\thandle @hub {\n\t\timport site_hub\n\t}" in text


def gate_as(client, addr, **extra):
    return client.get("/api/gate", follow_redirects=False, headers={
        "X-Forwarded-Proto": "https", "X-Forwarded-Host": "bambuddy.rahe-home.duckdns.org", "X-Forwarded-Uri": "/api/x",
        **via(addr, origin=None), **extra})


@pytest.mark.parametrize("extra", [
    {"X-Forwarded-Method": "POST", "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors"},
    {"X-Forwarded-Method": "GET", "Sec-Fetch-Site": "none", "Sec-Fetch-Mode": "navigate"},
    {"X-Forwarded-Method": "GET", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"},
    {"X-Forwarded-Method": "POST", "Origin": "https://bambuddy.rahe-home.duckdns.org"},
    {"X-Forwarded-Method": "GET"},
])
def test_the_gate_lets_a_device_through_where_a_lax_cookie_would_go(client, extra):
    remember(client, PC)
    assert gate_as(client, PC, **extra).status_code == 200


@pytest.mark.parametrize("extra", [
    {"X-Forwarded-Method": "POST", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"},
    {"X-Forwarded-Method": "POST", "Sec-Fetch-Site": "same-site", "Sec-Fetch-Mode": "cors"},
    {"X-Forwarded-Method": "GET", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "no-cors"},
    {"X-Forwarded-Method": "DELETE", "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors"},
    {"X-Forwarded-Method": "POST", "Origin": "https://evil.example"},
    {"X-Forwarded-Method": "POST", "Origin": "https://hub.rahe-home.duckdns.org"},
    {"X-Forwarded-Method": "POST"},
    {"Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate"},  # no method: assume a change
])
def test_another_website_cant_use_the_device_at_the_gate(client, extra):
    remember(client, PC)
    assert gate_as(client, PC, **extra).status_code == 302
