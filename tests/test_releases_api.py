import hashlib
import os
import tempfile
import time
from datetime import datetime, timezone

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hubapp, auth, records, releases  # noqa: E402

client = TestClient(hubapp.app)
A = "a" * 40
KEYS = {"localai": "k-localai-" + "1" * 40, "mac": "k-mac-" + "2" * 40}


def body(**kw):
    return {"commit": A, "result": "deployed", "at": datetime.now(timezone.utc).isoformat(), "mechanism": "safe-deploy", **kw}


def post(target, key=None, json=None, **headers):
    if key is not None:
        headers["X-Hub-Deploy-Key"] = key
    return client.post(f"/api/releases/{target}", json=body() if json is None else json, headers=headers)


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    records._reset_memory()
    keys = tmp_path / "deploy_keys"
    keys.mkdir()
    for name, key in KEYS.items():
        (keys / f"{name}.sha256").write_text(hashlib.sha256(key.encode()).hexdigest() + "\n")
    monkeypatch.setattr(releases, "KEY_DIR", str(keys))
    yield


def test_a_report_with_its_key_is_kept():
    r = post("localai", KEYS["localai"])
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "id": "release:localai", "state": "live", "commit": A}
    rec = records.get("release:localai")
    assert (rec["state"], rec["source"]) == ("live", "safe-deploy")


def test_key_writes_only_its_own_target():
    assert post("mac-watch", KEYS["localai"], json=body(mechanism="mac-install")).status_code == 401
    assert post("pi-hub", KEYS["localai"], json=body(mechanism="pi-hub-release")).status_code == 401
    assert post("x2d-bridge-mac", KEYS["mac"], json=body(mechanism="mac-install")).status_code == 200
    assert records.get("release:mac-watch") is None


def test_mac_key_reports_print_lab_by_lab_pull():
    assert post("print-lab", KEYS["localai"], json=body(mechanism="lab-pull")).status_code == 401
    r = post("print-lab", KEYS["mac"], json=body(mechanism="lab-pull", dirty=True))
    assert r.status_code == 200, r.text
    rec = records.get("release:print-lab")
    assert (rec["state"], rec["source"], rec["detail"]["dirty"]) == ("live", "lab-pull", True)


def test_wrong_key_is_401():
    r = post("localai", "not-the-key")
    assert r.status_code == 401 and r.json()["detail"] == "That deploy key is missing or wrong."


def test_http_is_refused():
    assert post("localai", KEYS["localai"], **{"X-Forwarded-Proto": "http"}).status_code == 401


def test_https_through_caddy_is_accepted():
    assert post("localai", KEYS["localai"], **{"X-Forwarded-Proto": "https"}).status_code == 200


def test_no_hash_on_file_refuses_every_key(tmp_path, monkeypatch):
    monkeypatch.setattr(releases, "KEY_DIR", str(tmp_path / "none"))
    assert post("localai", KEYS["localai"]).status_code == 401


def test_owner_session_cannot_post(monkeypatch):
    monkeypatch.setattr(auth, "role", lambda request: "owner", raising=False)
    # Same origin, no deploy key: past the guard, then refused by the route.
    r = client.post("/api/releases/localai", json=body(), headers={"Origin": "http://testserver"})
    assert r.status_code == 401
    # Another site, no key: the guard's same-origin check refuses it first.
    assert client.post("/api/releases/localai", json=body(), headers={"Origin": "https://evil.example"}).status_code == 403


def test_duplicate_is_noop():
    b = body()
    assert post("localai", KEYS["localai"], json=b).status_code == 200
    first = records.get("release:localai")["as_of"]
    time.sleep(0.01)
    assert post("localai", KEYS["localai"], json=b).status_code == 200
    assert records.get("release:localai")["as_of"] == first


@pytest.mark.parametrize("bad", [{"commit": "nope"}, {"result": "done"}, {"mechanism": "ssh"}, {"at": "2026-11-02T10:00:00"}])
def test_invalid_body_is_400(bad):
    r = post("localai", KEYS["localai"], json=body(**bad))
    assert r.status_code == 400 and r.json()["detail"] == releases.INVALID


def test_body_limits():
    r = post("localai", KEYS["localai"], json=body(message="x" * 5000))
    assert r.status_code == 413
    r = client.post("/api/releases/localai", content=b"not json", headers={"X-Hub-Deploy-Key": KEYS["localai"]})
    assert r.status_code == 400


def test_unknown_target_is_401_not_a_crash():
    assert post("toaster", KEYS["localai"]).status_code == 401
