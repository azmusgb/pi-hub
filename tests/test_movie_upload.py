"""Add a movie from the site: resumable 8 MB chunks written straight to the PC's Movies share under a hidden name,
renamed to "Title (Year).ext" when complete, then a Plex rescan. Owner only."""
import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("MOVI-4321\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, uploads  # noqa: E402
from hub import app as hub_app  # noqa: E402

SAME = {"Origin": "http://testserver"}


@pytest.fixture
def env(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    auth._tries.clear()
    movies = tmp_path / "movies"
    movies.mkdir()
    monkeypatch.setattr(uploads, "MOVIES_DIR", movies)
    monkeypatch.setattr(uploads, "STATE_DIR", tmp_path / "uploads")
    monkeypatch.setattr(uploads, "CHUNK", 1024)  # small chunks so tests stay fast
    monkeypatch.setattr(uploads, "REQUIRE_MOUNT", False)  # a temp folder stands in for the share
    refreshed = []
    monkeypatch.setattr(uploads, "refresh_plex", lambda: refreshed.append(1) or True)
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "MOVI-4321", "owner_password": "long enough", "pin": "123456"},
                  headers=SAME).status_code == 200
    return c, movies, refreshed


def start(c, **kw):
    body = {"filename": "PAW Patrol The Dino Movie 2026 1080p WEB-DL.mkv", "size": 2500, "title": "PAW Patrol The Dino Movie", "year": 2026}
    body.update(kw)
    return c.post("/api/movies/uploads", json=body, headers=SAME)


def put(c, uid, offset, data):
    return c.put(f"/api/movies/uploads/{uid}?offset={offset}", content=data, headers={**SAME, "Content-Type": "application/octet-stream"})


def test_a_whole_upload_lands_as_title_year_and_rescans(env):
    c, movies, refreshed = env
    r = start(c)
    assert r.status_code == 200, r.text
    up = r.json()
    assert up["offset"] == 0 and up["chunk"] == 1024
    data = os.urandom(2500)
    off = 0
    while off < len(data):
        r = put(c, up["id"], off, data[off:off + 1024])
        assert r.status_code == 200, r.text
        off = r.json()["offset"]
    assert r.json()["done"] is True
    final = movies / "PAW Patrol The Dino Movie (2026).mkv"
    assert final.read_bytes() == data
    assert [p.name for p in movies.iterdir()] == [final.name]  # no hidden leftovers
    assert refreshed == [1]


def test_an_interrupted_upload_resumes_from_what_the_hub_has(env):
    c, movies, _ = env
    up = start(c).json()
    data = os.urandom(2500)
    assert put(c, up["id"], 0, data[:1024]).status_code == 200
    # the phone lost its place: it asks, then continues from there
    assert c.get(f"/api/movies/uploads/{up['id']}").json()["offset"] == 1024
    # a chunk at the wrong offset is refused with the right one, never written twice
    r = put(c, up["id"], 0, data[:1024])
    assert r.status_code == 409 and r.json()["offset"] == 1024
    put(c, up["id"], 1024, data[1024:2048])
    assert put(c, up["id"], 2048, data[2048:]).json()["done"] is True
    assert (movies / "PAW Patrol The Dino Movie (2026).mkv").read_bytes() == data


def test_partial_files_are_hidden_from_plex(env):
    c, movies, _ = env
    up = start(c).json()
    put(c, up["id"], 0, b"x" * 1024)
    names = [p.name for p in movies.iterdir()]
    assert len(names) == 1 and names[0].startswith(".uploading-")


def test_owner_only(env):
    c, _, _ = env
    c.cookies.clear()
    assert start(c).status_code == 401
    assert c.post("/api/signin", json={"pin": "123456"}, headers=SAME).status_code == 200  # household PIN
    assert start(c).status_code == 401


@pytest.mark.parametrize("kw,why", [
    ({"filename": "notes.txt"}, "video"),
    ({"filename": "x.mkv", "size": 0}, "size"),
    ({"filename": "x.mkv", "size": 21 * 1024 ** 3}, "size"),
    ({"title": "   "}, "title"),
    ({"year": 1700}, "year"),
])
def test_bad_requests_are_refused_with_a_reason(env, kw, why):
    c, _, _ = env
    r = start(c, **kw)
    assert r.status_code == 400 and why in r.json()["detail"].lower()


def test_names_are_sanitized_and_never_leave_the_folder(env):
    c, movies, _ = env
    up = start(c, title='../../etc/<bad>: "name"?', year=None, size=10).json()
    assert put(c, up["id"], 0, b"0123456789").json()["done"] is True
    names = [p.name for p in movies.iterdir()]
    assert names == ["etc bad name.mkv"]


def test_an_existing_title_is_refused_not_overwritten(env):
    c, movies, _ = env
    (movies / "PAW Patrol The Dino Movie (2026).mkv").write_bytes(b"keep me")
    r = start(c)
    assert r.status_code == 409 and "already" in r.json()["detail"].lower()
    assert (movies / "PAW Patrol The Dino Movie (2026).mkv").read_bytes() == b"keep me"


def test_a_chunk_larger_than_the_chunk_size_is_refused(env):
    c, _, _ = env
    up = start(c).json()
    assert put(c, up["id"], 0, b"x" * 2000).status_code == 413


def test_the_pc_being_off_is_said_plainly(env, monkeypatch):
    c, movies, _ = env
    monkeypatch.setattr(uploads, "MOVIES_DIR", movies / "not-mounted")
    r = start(c)
    assert r.status_code == 503 and "pc" in r.json()["detail"].lower()


def test_cancel_removes_the_partial_file(env):
    c, movies, _ = env
    up = start(c).json()
    put(c, up["id"], 0, b"x" * 1024)
    assert c.delete(f"/api/movies/uploads/{up['id']}", headers=SAME).status_code == 200
    assert list(movies.iterdir()) == []
    assert c.get(f"/api/movies/uploads/{up['id']}").status_code == 404


def test_abandoned_uploads_are_cleaned_up_after_a_day(env):
    c, movies, _ = env
    up = start(c).json()
    put(c, up["id"], 0, b"x" * 1024)
    partial = [p for p in movies.iterdir()][0]
    old = time.time() - 25 * 3600
    for p in [partial, *uploads.STATE_DIR.iterdir()]:
        os.utime(p, (old, old))
    start(c, title="Another", year=2020)  # any new upload sweeps
    assert not partial.exists()
    assert c.get(f"/api/movies/uploads/{up['id']}").status_code == 404


def test_title_and_year_are_guessed_from_the_filename():
    assert uploads.guess("PAW Patrol The Dino Movie 2026 1080p WEB-DL HEVC x265 5.1 BONE.mkv") == ("PAW Patrol The Dino Movie", 2026)
    assert uploads.guess("Bad.Boys.for.Life.2020.mkv") == ("Bad Boys for Life", 2020)
    assert uploads.guess("home video.mp4") == ("home video", None)


def test_an_unmounted_share_is_refused_so_the_sd_card_never_fills(env, monkeypatch):
    c, movies, _ = env
    monkeypatch.setattr(uploads, "REQUIRE_MOUNT", True)  # the temp folder exists but is not a mount
    r = start(c)
    assert r.status_code == 503 and "pc" in r.json()["detail"].lower()
    assert list(movies.iterdir()) == []
