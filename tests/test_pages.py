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


def test_movies_api_accepts_section_filter(c, monkeypatch):
    from hub import plex, sources
    monkeypatch.setattr(sources, "pi_status", lambda: {"drive_state": "Connected", "drive_free": "100 GB", "movies": 10})
    monkeypatch.setattr(sources, "plex_sessions", lambda: None)
    monkeypatch.setattr(plex, "machine_id", lambda: "mock-machine")
    monkeypatch.setattr(plex, "on_deck", lambda: [])
    monkeypatch.setattr(plex, "history", lambda: [])
    monkeypatch.setattr(plex, "watch_stats", lambda days: {})
    monkeypatch.setattr(plex, "movie_sections", lambda: [
        {"key": "1", "title": "Movies", "type": "movie"},
        {"key": "2", "title": "Movies-WindowsPC", "type": "movie"},
    ])
    monkeypatch.setattr(plex, "recently_added", lambda section=None: [{"title": f"Recent-{section}"}])
    monkeypatch.setattr(plex, "library_stats", lambda section=None: {"movies": 10, "watched": 5})

    r_all = c.get("/api/movies?section=all")
    assert r_all.status_code == 200
    data_all = r_all.json()
    assert data_all["active_section"] == "all"
    assert len(data_all["sections"]) == 2
    assert data_all["recent"][0]["title"] == "Recent-all"

    r_sec = c.get("/api/movies?section=2")
    assert r_sec.status_code == 200
    data_sec = r_sec.json()
    assert data_sec["active_section"] == "2"
    assert data_sec["recent"][0]["title"] == "Recent-2"
    assert "drive" in data_all
    assert "genres" in data_all


def test_movies_catalog_and_pick_genre(c, monkeypatch):
    from hub import plex
    mock_catalog = [
        {"key": "1", "title": "Spider-Man", "year": 2026, "genres": ["Action", "Adventure"], "rating": 9.5, "watched": True},
        {"key": "2", "title": "Superbad", "year": 2007, "genres": ["Comedy"], "rating": 8.0, "watched": False},
        {"key": "3", "title": "Toy Story", "year": 1995, "genres": ["Animation", "Family"], "rating": 8.5, "watched": False, "content_rating": "G"},
    ]
    monkeypatch.setattr(plex, "catalog", lambda section=None: mock_catalog)
    monkeypatch.setattr(plex, "genres", lambda section=None: ["Action", "Adventure", "Animation", "Comedy", "Family"])

    r = c.get("/api/movies/catalog")
    assert r.status_code == 200
    data = r.json()
    assert len(data["movies"]) == 3
    assert "Comedy" in data["genres"]

    # Test pick with genre
    monkeypatch.setattr(plex, "pick", lambda kids=False, max_minutes=None, skip=(), section=None, genre=None:
                        next((m for m in mock_catalog if genre in m["genres"]), None))
    r_pick = c.get("/api/movies/pick?genre=Comedy")
    assert r_pick.status_code == 200
    assert r_pick.json()["pick"]["title"] == "Superbad"


def test_wall_route_serves_html(c):
    r = c.get("/wall")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert b"<!doctype html>" in r.content.lower()




def test_latest_movie_is_one_title_or_none(c, monkeypatch):
    from hub import plex
    monkeypatch.setattr(plex, "recently_added", lambda section=None: [{"title": "Dune", "year": 2021, "key": "1"}])
    assert c.get("/api/movies/latest").json() == {"title": "Dune"}
    monkeypatch.setattr(plex, "recently_added", lambda section=None: None)
    assert c.get("/api/movies/latest").json() == {"title": None}
