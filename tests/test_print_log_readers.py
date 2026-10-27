import os
import re
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app  # noqa: E402
from hub import ask, bambuddy, digest, filament, outside, recorder, sources  # noqa: E402


@pytest.fixture(autouse=True)
def prints_dir(monkeypatch):
    monkeypatch.setenv("HUB_PRINTS_DIR", tempfile.mkdtemp())


def item(i, status="completed", started=None, ended=None, grams=None, cost=None, name="Cube"):
    return {"id": i, "archive": i, "name": name, "status": status, "word": bambuddy.status_word(status),
            "started": started, "ended": ended, "seconds": (ended - started) if started and ended else None,
            "grams": grams, "cost": cost, "error": None, "lab": None}


def stub(monkeypatch, items):
    monkeypatch.setattr(bambuddy, "prints", lambda limit=50: None if items is None else items[:limit])


def test_workshop_returns_print_log_items_and_week_counts(monkeypatch):
    now = int(time.time())
    items = [item(3, "completed", now - 7200, now - 3600, 10, 0.5),
             item(2, "failed", now - 90000, now - 86400),
             item(1, "completed", now - 20 * 86400, now - 20 * 86400 + 3600)]
    stub(monkeypatch, items)
    d = TestClient(hub_app.app).get("/api/workshop").json()
    assert [p["id"] for p in d["prints"]] == [3, 2, 1]
    assert d["week"] == {"finished": 1, "hours": 2.0}
    assert d["prints_available"] is True


def test_workshop_says_when_bambuddy_is_silent(monkeypatch):
    stub(monkeypatch, None)
    d = TestClient(hub_app.app).get("/api/workshop").json()
    assert d["prints"] == [] and d["prints_available"] is False and d["week"] == {"finished": 0, "hours": 0}


def test_a_row_has_a_photo_when_its_file_exists(monkeypatch):
    now = int(time.time())
    stub(monkeypatch, [item(41, started=now - 100, ended=now), item(42, started=None)])
    open(os.path.join(os.environ["HUB_PRINTS_DIR"], "41.jpg"), "wb").write(b"\xff\xd8x")
    d = TestClient(hub_app.app).get("/api/workshop").json()
    assert {p["id"]: p["has_photo"] for p in d["prints"]} == {41: True, 42: False}


def test_filament_summary_sums_the_print_log(monkeypatch):
    now = int(time.time())
    stub(monkeypatch, [item(3, started=now - 100, grams=10.5, cost=0.5), item(2, started=now - 200, grams=4, cost=0.25),
                       item(1, started=now - 40 * 86400, grams=99, cost=9), item(0, started=None, grams=None)])
    assert filament.summary(30) == {"prints_logged": 2, "grams": 14.5, "cost": 0.75, "days": 30, "available": True}
    stub(monkeypatch, None)
    assert filament.summary(30)["available"] is False


def test_digest_counts_overnight_prints(monkeypatch):
    now = int(time.time())
    monkeypatch.setattr(sources, "pi_status", lambda: {})
    monkeypatch.setattr(outside, "weather", lambda: None)
    monkeypatch.setattr(outside, "calendar", lambda: [])
    stub(monkeypatch, [item(4, "completed", now - 900, now - 600), item(3, "completed", now - 2000, now - 1000),
                       item(2, "failed", now - 3000, now - 2000), item(1, "cancelled", now - 4000, now - 3500),
                       item(0, "completed", now - 90000, now - 86400)])
    _, body = digest.build()
    assert "Prints overnight: 2 finished, 1 failed, 1 cancelled." in body


def test_assistant_context_lists_the_last_three_prints(monkeypatch):
    now = int(time.time())
    monkeypatch.setattr(sources, "pi_status", lambda: {})
    stub(monkeypatch, [item(3, "completed", now - 4000, now - 1000, name="Vase"), item(2, "failed", now - 9000, now - 8000, name="Cube"),
                       item(1, "printing", now - 100, None, name="Benchy"), item(0, name="Old")])
    text = ask.context()
    assert re.search(r"3D print Vase started .*: Finished, took 50 min\.", text)
    assert re.search(r"3D print Cube started .*: Failed, took 17 min\.", text)
    assert re.search(r"3D print Benchy started .*: Printing\.", text)
    assert "Old" not in text


def test_recorder_photographs_once_per_print(monkeypatch):
    calls = []
    monkeypatch.setattr(recorder, "capture_print_photo", lambda: calls.append(1))
    monkeypatch.setattr(recorder, "_printing", False)
    recorder.record_print("Idle", 0, 1)
    recorder.record_print("Printing", 10, 2)
    recorder.record_print("Paused", 20, 3)
    assert calls == []
    recorder.record_print("Idle", 0, 4)
    recorder.record_print("Idle", 0, 5)
    assert calls == [1]
    recorder.record_print("Printing", 5, 6)
    recorder.record_print("Error", 5, 7, "0300")
    assert calls == [1, 1]


def test_photo_capture_takes_the_newest_print_and_never_overwrites(monkeypatch):
    d = tempfile.mkdtemp()
    monkeypatch.setenv("HUB_PRINTS_DIR", d)
    stub(monkeypatch, [item(77)])
    waits = []
    monkeypatch.setattr(recorder.time, "sleep", lambda s: waits.append(s))

    class R:
        status = 200
        def read(self, n): return b"\xff\xd8new"
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(recorder.urllib.request, "urlopen", lambda *a, **k: R())
    recorder._capture_now()
    assert waits == [20] and open(os.path.join(d, "77.jpg"), "rb").read() == b"\xff\xd8new"
    open(os.path.join(d, "77.jpg"), "wb").write(b"\xff\xd8old")
    recorder._capture_now()
    assert open(os.path.join(d, "77.jpg"), "rb").read() == b"\xff\xd8old"


def test_photo_route_404_then_200(monkeypatch):
    c = TestClient(hub_app.app)
    assert c.get("/api/prints/555/photo.jpg").status_code == 404
    open(os.path.join(os.environ["HUB_PRINTS_DIR"], "555.jpg"), "wb").write(b"\xff\xd8z")
    assert c.get("/api/prints/555/photo.jpg").status_code == 200


def test_no_hub_module_touches_the_prints_table():
    root = os.path.join(os.path.dirname(__file__), "..", "hub")
    for name in os.listdir(root):
        if name.endswith(".py"):
            text = open(os.path.join(root, name)).read()
            for bad in ("FROM prints", "INTO prints", "UPDATE prints", "DELETE FROM prints"):
                assert bad not in text, f"{name} uses {bad}"
