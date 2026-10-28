import hashlib
import json
import os
import tempfile
import time
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

os.environ["HUB_NO_SAMPLER"] = "1"
TEST_KEY = "test-mac-key-1234567890abcdef1234567890abcdef"
TEST_KEY_SHA256 = hashlib.sha256(TEST_KEY.encode()).hexdigest()
os.environ["HUB_MAC_KEY_SHA256"] = TEST_KEY_SHA256

from hub import app as hub_app, auth, lab  # noqa: E402

ORIGIN = {"Origin": "http://testserver"}
MAC_HEADER = {"X-LocalAI-Mac-Key": TEST_KEY}


@pytest.fixture
def client(tmp_path):
    db_path = str(tmp_path / "hub.db")
    lab_dir = tmp_path / "lab"
    os.environ["HUB_DB"] = db_path
    os.environ["HUB_LAB_DIR"] = str(lab_dir)
    lab._ready_dbs.clear()
    auth._tries.clear()

    c = TestClient(hub_app.app)
    return c


def test_list_projects_empty(client):
    r = client.get("/api/lab/projects")
    assert r.status_code == 200
    assert r.json() == {"projects": []}


def test_sync_unauthorized(client):
    r = client.post("/api/lab/hex-tile/sync", json={"schema": "print-lab-index/1"})
    assert r.status_code == 401
    assert "Only the Mac" in r.json()["detail"]


def test_sync_invalid_schema_or_project(client):
    # Invalid schema
    r = client.post("/api/lab/hex-tile/sync", json={"schema": "wrong/1", "project": "hex-tile"}, headers=MAC_HEADER)
    assert r.status_code == 422
    assert "Expected schema" in r.json()["detail"]

    # Project mismatch
    r = client.post("/api/lab/hex-tile/sync", json={"schema": "print-lab-index/1", "project": "other"}, headers=MAC_HEADER)
    assert r.status_code == 422
    assert "The push is for other" in r.json()["detail"]


def test_sync_success_and_get(client):
    gen_time = datetime.now(timezone.utc).isoformat()
    payload = {
        "schema": "print-lab-index/1",
        "project": "hex-tile",
        "generated_at": gen_time,
        "fingerprint": "fp-123456",
        "experiments": [{"id": "E-001", "name": "Speed test", "photos": []}],
        "records": {
            "E-001": {"type": "experiment", "file": "E-001.json", "sha256": "sha-e001", "payload": {"foo": "bar"}}
        }
    }
    r = client.post("/api/lab/hex-tile/sync", json=payload, headers=MAC_HEADER)
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["upserted"] == 1
    assert data["removed"] == 0
    assert data["unchanged"] == 0

    # Verify project list
    proj_r = client.get("/api/lab/projects")
    assert proj_r.status_code == 200
    assert len(proj_r.json()["projects"]) == 1
    assert proj_r.json()["projects"][0]["name"] == "hex-tile"

    # Verify get project
    get_r = client.get("/api/lab/hex-tile")
    assert get_r.status_code == 200
    res = get_r.json()
    assert res["meta"]["fingerprint"] == "fp-123456"
    assert res["index"]["project"] == "hex-tile"
    assert len(res["index"]["experiments"]) == 1

    # Verify get record
    rec_r = client.get("/api/lab/hex-tile/record/E-001")
    assert rec_r.status_code == 200
    assert rec_r.json()["payload"] == {"foo": "bar"}

    # Idempotent re-sync with same fingerprint
    r2 = client.post("/api/lab/hex-tile/sync", json=payload, headers=MAC_HEADER)
    assert r2.status_code == 200
    assert r2.json()["upserted"] == 0
    assert r2.json()["unchanged"] == 1


def test_sync_older_push_rejected(client):
    t1 = "2026-10-28T10:00:00+00:00"
    t2 = "2026-10-28T09:00:00+00:00"

    p1 = {
        "schema": "print-lab-index/1",
        "project": "hex-tile",
        "generated_at": t1,
        "fingerprint": "fp-new",
        "experiments": [],
        "records": {}
    }
    assert client.post("/api/lab/hex-tile/sync", json=p1, headers=MAC_HEADER).status_code == 200

    p2 = {
        "schema": "print-lab-index/1",
        "project": "hex-tile",
        "generated_at": t2,
        "fingerprint": "fp-old",
        "experiments": [],
        "records": {}
    }
    r = client.post("/api/lab/hex-tile/sync", json=p2, headers=MAC_HEADER)
    assert r.status_code == 409
    assert "older push" in r.json()["detail"]


def test_photo_upload_and_download(client):
    # Minimal JPEG bytes: FF D8 FF E0 00 10 4A 46 49 46 00 01
    jpg_data = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
    sha = hashlib.sha256(jpg_data).hexdigest()

    # List photos before upload
    assert client.get("/api/lab/hex-tile/photos").json() == {"have": []}

    # Upload photo
    r = client.put(f"/api/lab/hex-tile/photos/{sha}.jpg", content=jpg_data, headers=MAC_HEADER)
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    # List photos after upload
    assert client.get("/api/lab/hex-tile/photos").json() == {"have": [sha]}

    # Download photo
    dl = client.get(f"/api/lab/hex-tile/photo/{sha}.jpg")
    assert dl.status_code == 200
    assert dl.content == jpg_data
    assert dl.headers["content-type"] == "image/jpeg"
    assert "immutable" in dl.headers["cache-control"]

    # Wrong hash fails
    fake_sha = "0" * 64
    r_bad_hash = client.put(f"/api/lab/hex-tile/photos/{fake_sha}.jpg", content=jpg_data, headers=MAC_HEADER)
    assert r_bad_hash.status_code == 422

    # Non-JPEG fails
    text_data = b"hello not a jpeg"
    text_sha = hashlib.sha256(text_data).hexdigest()
    r_bad_type = client.put(f"/api/lab/hex-tile/photos/{text_sha}.jpg", content=text_data, headers=MAC_HEADER)
    assert r_bad_type.status_code == 415


def test_requests_lifecycle(client):
    req_body = {
        "id": "rq-0123456789abcdef",
        "kind": "verdict",
        "experiment": "E-005",
        "run": "PR-005-01",
        "payload": {"lighting": "diagnostic", "grades": {"tabs": {"outer_wall": "A"}}}
    }

    # Phone creates request
    r = client.post("/api/lab/hex-tile/requests", json=req_body, headers=ORIGIN)
    assert r.status_code == 200
    assert r.json() == {"ok": True, "id": "rq-0123456789abcdef", "status": "pending"}

    # Duplicate id is idempotent
    r_dup = client.post("/api/lab/hex-tile/requests", json=req_body, headers=ORIGIN)
    assert r_dup.status_code == 200
    assert r_dup.json() == {"ok": True, "id": "rq-0123456789abcdef", "status": "pending"}

    # Mac polls pending requests
    pending_r = client.get("/api/lab/hex-tile/requests?status=pending", headers=MAC_HEADER)
    assert pending_r.status_code == 200
    items = pending_r.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == "rq-0123456789abcdef"
    assert items[0]["payload"]["lighting"] == "diagnostic"

    # Mac posts result
    res_r = client.post(
        "/api/lab/hex-tile/requests/rq-0123456789abcdef/result",
        json={"status": "applied", "message": "Verdict recorded in E-005.json"},
        headers=MAC_HEADER
    )
    assert res_r.status_code == 200
    assert res_r.json() == {"ok": True}

    # Check pending is now empty
    pending_empty = client.get("/api/lab/hex-tile/requests?status=pending", headers=MAC_HEADER)
    assert pending_empty.json()["items"] == []

    # History shows applied
    hist = client.get("/api/lab/hex-tile/requests")
    assert hist.status_code == 200
    assert hist.json()["items"][0]["status"] == "applied"
    assert hist.json()["items"][0]["message"] == "Verdict recorded in E-005.json"
