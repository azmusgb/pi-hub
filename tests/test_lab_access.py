"""Who may use the print lab: the owner for people, the hub's own lab key for the Mac, and nothing anonymous."""
import hashlib
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("LABS-4321\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, lab, lab_guard  # noqa: E402
from hub import app as hub_app  # noqa: E402

SAME = {"Origin": "http://testserver"}
KEY = "hub-lab-key-0123456789abcdef0123456789abcdef"
LOCALAI_KEY = "localai-mac-key-fedcba9876543210fedcba9876543210"
SHA = "0" * 64
VERDICT = {"id": "rq-0123456789abcdef", "kind": "verdict", "experiment": "E-005", "run": "PR-005-01",
           "payload": {"lighting": "diagnostic"}}

PHONE_ROUTES = [
    ("GET", "/api/lab/projects"), ("GET", "/api/lab/hex-tile"), ("GET", "/api/lab/hex-tile/photos"),
    ("GET", f"/api/lab/hex-tile/photo/{SHA}.jpg"), ("GET", "/api/lab/hex-tile/record/E-001"),
    ("POST", "/api/lab/hex-tile/requests"), ("PUT", f"/api/lab/hex-tile/incoming/{SHA}.jpg"),
    ("GET", "/api/lab/hex-tile/requests"),
]
MAC_ROUTES = [
    ("POST", "/api/lab/hex-tile/sync"), ("PUT", f"/api/lab/hex-tile/photos/{SHA}.jpg"),
    ("GET", "/api/lab/hex-tile/requests?status=pending"),
    ("POST", "/api/lab/hex-tile/requests/rq-0123456789abcdef/result"),
    ("GET", f"/api/lab/hex-tile/incoming/{SHA}.jpg"),
]


@pytest.fixture
def client(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_LAB_DIR"] = str(tmp_path / "lab")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    lab._ready_dbs.clear()
    auth._tries.clear()
    key_file = tmp_path / "lab_mac_key.sha256"
    key_file.write_text(hashlib.sha256(KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(key_file))
    # Local AI's key sits where the old code fell back to it; it must not open the lab.
    monkeypatch.setenv("HUB_MAC_KEY_SHA256", hashlib.sha256(LOCALAI_KEY.encode()).hexdigest())
    c = TestClient(hub_app.app)
    r = c.post("/api/setup", json={"code": "LABS-4321", "owner_password": "long enough"},
               headers=SAME)
    assert r.status_code == 200, r.text
    c.cookies.clear()
    return c


def signed_in(c):
    assert c.post("/api/signin", json={"password": "long enough"}, headers=SAME).json()["role"] == "owner"
    return c


def call(c, method, path, **kw):
    return c.request(method, path, **kw)


def test_anonymous_cannot_read_or_write_the_lab(client):
    for method, path in PHONE_ROUTES:
        r = call(client, method, path, headers=SAME, json=VERDICT if method == "POST" else None)
        assert r.status_code == 401, (method, path, r.status_code)


def test_the_owner_can_read_and_post(client):
    signed_in(client)
    assert client.get("/api/lab/projects").json() == {"projects": []}
    assert client.get("/api/lab/hex-tile/photos").json() == {"have": []}
    ix = {"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-10-28T09:00:00Z",
          "fingerprint": "fp-acc", "experiments": [], "records": {}}
    assert client.post("/api/lab/hex-tile/sync", json=ix, headers={"X-Hub-Mac-Key": KEY}).status_code == 200
    r = client.post("/api/lab/hex-tile/requests", json=VERDICT, headers=SAME)
    assert r.status_code == 200 and r.json()["status"] == "pending"
    assert client.get("/api/lab/hex-tile/requests").json()["items"][0]["id"] == VERDICT["id"]


def test_the_owner_cannot_use_mac_routes(client):
    signed_in(client)
    for method, path in MAC_ROUTES:
        assert call(client, method, path, headers=SAME).status_code == 401, (method, path)


def test_cross_origin_text_plain_verdict_is_refused(client):
    import json
    signed_in(client)
    r = client.post("/api/lab/hex-tile/requests", content=json.dumps(VERDICT),
                    headers={"Origin": "https://evil.example", "Content-Type": "text/plain"})
    assert r.status_code == 403
    assert client.get("/api/lab/hex-tile/requests").json()["items"] == []


def test_mac_routes_need_the_hub_key(client):
    # Same-origin so the guard steps aside and the route's own key check is what answers.
    bad = [{}, {"X-Hub-Mac-Key": "wrong"}, {"X-Hub-Mac-Key": LOCALAI_KEY}, {"X-LocalAI-Mac-Key": KEY}]
    for method, path in MAC_ROUTES:
        for h in bad:
            r = call(client, method, path, headers={**SAME, **h})
            assert r.status_code == 401, (method, path, h, r.status_code)
            assert r.json()["detail"] == "The Mac's lab key is missing or wrong."
    mac = {"X-Hub-Mac-Key": KEY}
    assert client.get("/api/lab/hex-tile/requests?status=pending", headers=mac).json() == {"items": []}
    assert client.get("/api/lab/hex-tile/requests", headers=mac).status_code == 200
    r = client.post("/api/lab/hex-tile/sync", headers=mac, json={
        "schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-10-28T10:00:00+00:00",
        "fingerprint": "fp", "experiments": [], "records": {}})
    assert r.status_code == 200, r.text


def test_no_key_file_refuses_every_mac_route(client, monkeypatch, tmp_path):
    for missing in (str(tmp_path / "nope"), str(tmp_path / "empty")):
        (tmp_path / "empty").write_text("")
        monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", missing)
        for method, path in MAC_ROUTES:
            r = call(client, method, path, headers={**SAME, "X-Hub-Mac-Key": KEY})
            assert r.status_code == 401, (missing, method, path)
        # And with no key on file, an empty presented key can't match an empty hash.
        assert call(client, "GET", "/api/lab/hex-tile/requests?status=pending",
                    headers={"X-Hub-Mac-Key": ""}).status_code == 401


def test_the_key_exempts_the_guard_only_when_it_verifies(client):
    sync = {"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-10-28T10:00:00+00:00",
            "fingerprint": "fp", "experiments": [], "records": {}}
    # The Mac sends no Origin: no key (or a borrowed header) leaves the same-origin check in place.
    for h in ({}, {"X-LocalAI-Mac-Key": KEY}):
        assert client.post("/api/lab/hex-tile/sync", json=sync, headers=h).status_code == 403
    # A key that is present but wrong is refused as a bad key.
    r = client.post("/api/lab/hex-tile/sync", json=sync, headers={"X-Hub-Mac-Key": "wrong"})
    assert r.status_code == 401
    assert r.json()["detail"] == "The Mac's lab key is missing or wrong."
    assert client.post("/api/lab/hex-tile/sync", json=sync, headers={"X-Hub-Mac-Key": KEY}).status_code == 200
    # Nothing else under /api/lab is exempt just for its path.
    signed_in(client)
    assert client.post("/api/lab/hex-tile/requests", json=VERDICT).status_code == 403
    # The key opens only the lab, not the rest of the hub.
    r = client.post("/api/lists/shopping", json={"text": "milk"}, headers={"X-Hub-Mac-Key": KEY})
    assert r.status_code == 403


def test_wrong_key_on_a_mac_post_with_no_origin_is_401(client):
    for h in ({"X-Hub-Mac-Key": "wrong"}, {"X-Hub-Mac-Key": LOCALAI_KEY}):
        r = client.post("/api/lab/hex-tile/sync", json={}, headers=h)
        assert r.status_code == 401, r.text
        assert r.json()["detail"] == "The Mac's lab key is missing or wrong."


def test_invalid_utf8_hash_file_refuses_the_mac_and_never_500s(client, monkeypatch, tmp_path):
    bad = tmp_path / "garbled"
    bad.write_bytes(b"\xff\xfe\x80not hex at all\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(bad))
    for method, path in MAC_ROUTES:
        r = call(client, method, path, headers={**SAME, "X-Hub-Mac-Key": KEY})
        assert r.status_code in (401, 403), (method, path, r.status_code)
    r = client.post("/api/lab/hex-tile/sync", json={}, headers={"X-Hub-Mac-Key": KEY})
    assert r.status_code in (401, 403)
    # Owner reads still work.
    signed_in(client)
    assert client.get("/api/lab/projects").status_code == 200
    assert client.get("/api/lab/hex-tile/photos").status_code == 200


def test_a_hub_gate_cookie_gives_no_lab_access(client):
    client.cookies.set("hub_gate", "anything-at-all")
    for method, path in PHONE_ROUTES[:3] + MAC_ROUTES[:3]:
        r = call(client, method, path, headers=SAME)
        assert r.status_code == 401, (method, path, r.status_code)


def test_the_mac_can_list_photos_with_its_key(client):
    # print-lab asks which photos the hub has before every push; that is the Mac's read too.
    assert client.get("/api/lab/hex-tile/photos", headers={"X-Hub-Mac-Key": KEY}).json() == {"have": []}
    for h in ({}, {"X-Hub-Mac-Key": "wrong"}, {"X-Hub-Mac-Key": LOCALAI_KEY}, {"X-LocalAI-Mac-Key": KEY}):
        assert client.get("/api/lab/hex-tile/photos", headers={**SAME, **h}).status_code == 401, h


def test_the_mac_key_is_refused_over_plain_http(client):
    plain = {**SAME, "X-Hub-Mac-Key": KEY, "X-Forwarded-Proto": "http"}
    for method, path in MAC_ROUTES:
        r = call(client, method, path, headers=plain)
        assert r.status_code == 401, (method, path, r.status_code)
    assert client.get("/api/lab/hex-tile/photos", headers=plain).status_code == 401


@pytest.mark.parametrize("kind", ["start", "approve", "abandon"])
def test_a_lower_role_cannot_queue_an_action_that_spends_budget_or_moves_the_printer(client, monkeypatch, kind):
    ix = {"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-10-28T09:00:00Z",
          "fingerprint": "fp-act", "experiments": [], "records": {}}
    assert client.post("/api/lab/hex-tile/sync", json=ix, headers={"X-Hub-Mac-Key": KEY}).status_code == 200
    body = {"id": "rq-0123456789abcdef", "kind": kind, "experiment": "E-005", "payload": {"reason": "x"}}
    with monkeypatch.context() as m:
        m.setattr(auth, "who", lambda request: ("household", "phone"))
        r = client.post("/api/lab/hex-tile/requests", json=body, headers=SAME)
        assert r.status_code == 401
        assert "Sign in as the owner" in r.json()["detail"]
    signed_in(client)
    assert client.get("/api/lab/hex-tile/requests").json()["items"] == []
