"""Incoming photos are bounded (200 files, 500 MiB, 7 days) and uploads stop when the disk is nearly full."""
import hashlib
import json
import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("LABS-9911\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, auth, lab, lab_guard, sources  # noqa: E402

SAME = {"Origin": "http://testserver"}
KEY = "hub-lab-key-disk-0123456789abcdef0123456789abc"
MAC = {"X-Hub-Mac-Key": KEY}


@pytest.fixture
def client(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_LAB_DIR"] = str(tmp_path / "lab")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    lab._ready_dbs.clear()
    auth._tries.clear()
    kf = tmp_path / "k.sha256"
    kf.write_text(hashlib.sha256(KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(kf))
    monkeypatch.setattr(sources, "disk_free_gb", lambda path="/": 50.0)
    c = TestClient(hub_app.app)
    lab.ready()
    from hub import db
    db.run("INSERT OR REPLACE INTO lab_projects (project, meta, index_json, synced_at) VALUES (?, '{}', '{}', 'x')", "hex-tile")
    assert c.post("/api/setup", json={"code": "LABS-9911", "owner_password": "long enough"},
                  headers=SAME).status_code == 200
    c.cookies.clear()
    assert c.post("/api/signin", json={"password": "long enough"}, headers=SAME).status_code == 200
    return c


def jpeg(tag: bytes):
    body = b"\xff\xd8" + tag
    return hashlib.sha256(body).hexdigest(), body


def put(c, body, sha):
    return c.put(f"/api/lab/hex-tile/incoming/{sha}.jpg", content=body, headers=SAME)


def idir(tmp_path):
    d = tmp_path / "lab" / "hex-tile" / "incoming"
    d.mkdir(parents=True, exist_ok=True)
    return d


def test_201st_incoming_file_is_refused(client, tmp_path):
    d = idir(tmp_path)
    for i in range(200):
        (d / f"{i:064x}.jpg").write_bytes(b"\xff\xd8")
    sha, body = jpeg(b"one-more")
    r = put(client, body, sha)
    assert r.status_code == 413
    assert "200" in r.json()["detail"]
    assert not (d / f"{sha}.jpg").exists()


def test_incoming_over_500_mib_is_refused(client, tmp_path):
    d = idir(tmp_path)
    with open(d / ("1" * 64 + ".jpg"), "wb") as f:
        f.truncate(500 * 1024 * 1024 - 10)
    sha, body = jpeg(b"x" * 100)
    r = put(client, body, sha)
    assert r.status_code == 413
    assert "500 MiB" in r.json()["detail"]


def test_old_incoming_files_are_pruned_on_the_next_upload(client, tmp_path):
    d = idir(tmp_path)
    for i in range(200):
        p = d / f"{i:064x}.jpg"
        p.write_bytes(b"\xff\xd8")
        old = time.time() - 8 * 86400
        os.utime(p, (old, old))
    fresh = d / ("f" * 64 + ".jpg")
    fresh.write_bytes(b"\xff\xd8")
    sha, body = jpeg(b"after-prune")
    assert put(client, body, sha).status_code == 200
    assert len(list(d.glob("*.jpg"))) == 2 and fresh.exists() and (d / f"{sha}.jpg").exists()


def test_low_disk_refuses_uploads_with_507(client, tmp_path, monkeypatch):
    monkeypatch.setattr(sources, "disk_free_gb", lambda path="/": 0.9)
    sha, body = jpeg(b"low-disk")
    r = put(client, body, sha)
    assert r.status_code == 507 and "disk" in r.json()["detail"].lower()
    r2 = client.put(f"/api/lab/hex-tile/photos/{sha}.jpg", content=body, headers=MAC)
    assert r2.status_code == 507
    monkeypatch.setattr(sources, "disk_free_gb", lambda path="/": 5.0)
    assert put(client, body, sha).status_code == 200


def test_sync_refuses_nan_infinity_and_huge_numbers(client):
    for bad in ('NaN', 'Infinity', '1e999'):
        raw = ('{"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-01-01T00:00:00Z", '
               '"records": {}, "x": %s}' % bad)
        r = client.post("/api/lab/hex-tile/sync", content=raw, headers={**MAC, "content-type": "application/json"})
        assert r.status_code == 400, bad
    ok = {"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-01-01T00:00:00Z", "records": {}}
    r = client.post("/api/lab/hex-tile/sync", content=json.dumps(ok), headers=MAC)
    assert r.status_code == 200
    assert client.get("/api/lab/hex-tile").status_code == 200


def test_unsynced_project_names_get_404_and_caps_span_projects(client, tmp_path):
    sha, body = jpeg(b"ghost")
    r = client.put(f"/api/lab/ghost-1/incoming/{sha}.jpg", content=body, headers=SAME)
    assert r.status_code == 404 and not (tmp_path / "lab" / "ghost-1").exists()
    from hub import db
    db.run("INSERT OR REPLACE INTO lab_projects (project, meta, index_json, synced_at) VALUES (?, '{}', '{}', 'x')", "other")
    d2 = tmp_path / "lab" / "other" / "incoming"
    d2.mkdir(parents=True)
    for i in range(200):
        (d2 / f"{i:064x}.jpg").write_bytes(b"\xff\xd8")
    assert put(client, body, sha).status_code == 413


def test_prune_spans_projects_but_keeps_pending_photos_and_reupload_refreshes(client, tmp_path):
    from hub import db
    db.run("INSERT OR REPLACE INTO lab_projects (project, meta, index_json, synced_at) VALUES (?, '{}', '{}', 'x')", "other")
    old = time.time() - 9 * 86400
    d2 = tmp_path / "lab" / "other" / "incoming"
    d2.mkdir(parents=True)
    stale, held = d2 / ("a" * 64 + ".jpg"), d2 / ("b" * 64 + ".jpg")
    for f in (stale, held):
        f.write_bytes(b"\xff\xd8")
        os.utime(f, (old, old))
    db.run("INSERT INTO lab_requests (id, project, kind, experiment, run, payload, status, created_at) "
           "VALUES ('rq-0000000000000001', 'other', 'photos', 'E-001', '', ?, 'pending', 'x')",
           json.dumps({"photos": [{"sha256": "b" * 64}]}))
    mine = idir(tmp_path)
    sha, body = jpeg(b"refresh")
    (mine / f"{sha}.jpg").write_bytes(body)
    os.utime(mine / f"{sha}.jpg", (old, old))
    assert put(client, body, sha).status_code == 200
    assert not stale.exists() and held.exists()
    assert (mine / f"{sha}.jpg").stat().st_mtime > time.time() - 60


def test_backup_script_includes_the_lab_folder():
    script = open(os.path.join(os.path.dirname(__file__), "..", "deploy/pi-hub-backup.sh")).read()
    assert "var/lib/pi-hub/lab" in script and "--exclude='var/lib/pi-hub/lab/*/incoming'" in script


def test_workshop_print_lab_links_open_the_hubs_lab_page():
    root = os.path.join(os.path.dirname(__file__), "..", "hub/static/js")
    w = open(os.path.join(root, "workshop.js")).read()
    assert "printLabUrl(p.lab.exp)" in w and 'href: "/lab", "data-link": true' in w
    assert "#projects" not in w and "#printLab" not in w
    assert "localLabUrl" not in open(os.path.join(root, "sections.js")).read()
