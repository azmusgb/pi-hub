import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app  # noqa: E402
from hub import db, printing, recorder  # noqa: E402

SAME = {"Origin": "http://testserver"}


@pytest.fixture
def c():
    return TestClient(hub_app.app)


def test_changes_from_another_site_are_refused(c):
    r = c.post("/api/lists/shopping", json={"text": "milk"}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    r = c.post("/api/lists/shopping", json={"text": "milk"})
    assert r.status_code == 403


def test_lists_add_tick_clear_and_delete(c):
    r = c.post("/api/lists/shopping", json={"text": "  Oat   milk "}, headers=SAME)
    assert r.status_code == 200
    item = r.json()["id"]
    items = c.get("/api/lists").json()["shopping"]["items"]
    assert items[0]["text"] == "Oat milk" and items[0]["done"] == 0
    c.post(f"/api/lists/shopping/{item}/toggle", headers=SAME)
    assert c.get("/api/lists").json()["shopping"]["items"][0]["done"] == 1
    c.post("/api/lists/shopping/clear-done", headers=SAME)
    assert c.get("/api/lists").json()["shopping"]["items"] == []
    note = c.post("/api/lists/notes", json={"text": "Bins out Thursday"}, headers=SAME).json()["id"]
    c.post(f"/api/lists/notes/{note}/delete", headers=SAME)
    assert c.get("/api/lists").json()["notes"]["items"] == []


def test_lists_reject_empty_and_unknown(c):
    assert c.post("/api/lists/shopping", json={"text": "   "}, headers=SAME).status_code == 400
    assert c.post("/api/lists/secret", json={"text": "x"}, headers=SAME).status_code == 404


def test_print_refuses_bad_files_before_reaching_cups():
    with pytest.raises(ValueError, match="can't be printed"):
        printing.submit(b"MZ...", "tool.exe")
    with pytest.raises(ValueError, match="empty"):
        printing.submit(b"", "a.pdf")
    with pytest.raises(ValueError, match="over 25 MB"):
        printing.submit(b"x" * (printing.MAX_BYTES + 1), "big.pdf")


def test_cancel_only_takes_this_printers_jobs():
    with pytest.raises(ValueError):
        printing.cancel("EPSON_ET_2760_Series-4; rm -rf /")
    with pytest.raises(ValueError):
        printing.cancel("other-12")


def test_plex_thumb_proxy_only_serves_library_pictures(c):
    assert c.get("/api/plex/thumb", params={"path": "/:/prefs"}).status_code == 404
    assert c.get("/api/plex/thumb", params={"path": "http://evil/x"}).status_code == 404


def test_print_history_records_a_finished_print():
    db.run("DELETE FROM prints")
    recorder.record_print("Printing", 10, 1000)
    recorder.record_print("Printing", 98, 4000)
    recorder.record_print("Idle", 0, 4100)
    p = db.one("SELECT * FROM prints")
    assert p["started"] == 1000 and p["ended"] == 4100 and p["outcome"] == "finished" and p["progress"] == 98


def test_print_history_marks_an_early_stop():
    db.run("DELETE FROM prints")
    recorder.record_print("Printing", 30, 1000)
    recorder.record_print("Stopped", 30, 2000)
    assert db.one("SELECT outcome FROM prints")["outcome"] == "stopped"


def test_drive_events_only_on_change():
    db.run("DELETE FROM drive_events")
    for present, ts in ((True, 1), (True, 2), (False, 3), (False, 4), (True, 5)):
        recorder.record_drive(present, ts)
    assert [r["kind"] for r in db.rows("SELECT kind FROM drive_events ORDER BY ts")] == ["dropped", "back"]


def test_every_page_address_serves_the_shell(c):
    for path in ("/", "/movies", "/workshop", "/print", "/lists", "/pi", "/alerts"):
        r = c.get(path)
        assert r.status_code == 200 and "js/main.js" in r.text
    assert c.get("/api/nope").status_code == 404
