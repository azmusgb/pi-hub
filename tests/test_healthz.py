import os
import sqlite3

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(__import__("tempfile").mkdtemp(), "hub.db"))

from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app  # noqa: E402
from hub import db  # noqa: E402

c = TestClient(hub_app.app)


def test_healthz_is_ok_when_the_database_answers():
    r = c.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_healthz_reads_the_database_on_every_call(monkeypatch):
    calls = []
    real = db.one
    monkeypatch.setattr(db, "one", lambda sql, *a: calls.append(sql) or real(sql, *a))
    c.get("/healthz")
    c.get("/healthz")
    assert len(calls) == 2 and all("sqlite_master" in sql for sql in calls)


def test_healthz_fails_when_the_database_cannot_open(monkeypatch, tmp_path):
    monkeypatch.setenv("HUB_DB", str(tmp_path))  # a directory, not a database file
    r = c.get("/healthz")
    assert r.status_code == 503
    assert r.json() == {"ok": False, "error": "database"}
    assert r.headers["cache-control"] == "no-store"


def test_healthz_fails_when_the_database_is_corrupt(monkeypatch, tmp_path):
    bad = tmp_path / "hub.db"
    bad.write_bytes(b"this is not a database" * 100)
    monkeypatch.setenv("HUB_DB", str(bad))
    assert c.get("/healthz").status_code == 503


def test_healthz_fails_when_a_query_errors(monkeypatch):
    def broken(sql, *a):
        raise sqlite3.OperationalError("disk I/O error")
    monkeypatch.setattr(db, "one", broken)
    r = c.get("/healthz")
    assert r.status_code == 503
    assert "disk" not in r.text
