import pytest

from hub import bambuddy, sources


@pytest.fixture(autouse=True)
def fresh_cache():
    sources._cache.clear()
    yield
    sources._cache.clear()


def _entry(**kw):
    base = {"id": 1, "archive_id": 7, "print_name": "hex-tile_E-023_BLD-023-01", "status": "completed",
            "started_at": "2026-10-27T20:36:30.716390", "completed_at": "2026-10-27T21:06:30.000000",
            "duration_seconds": 1800, "filament_used_grams": 12.5, "cost": 0.4, "failure_reason": None}
    base.update(kw)
    return base


def _serve(monkeypatch, items, seen=None):
    def fake(url, headers=None, timeout=None):
        if seen is not None:
            seen.append(url)
        return {"items": items, "total": len(items)}
    monkeypatch.setattr(sources, "_get_json", fake)


def test_status_words():
    assert [bambuddy.status_word(s) for s in ("completed", "failed", "cancelled", "printing", "paused", None)] == [
        "Finished", "Failed", "Cancelled", "Printing", "Paused", "Unknown"]


def test_item_shape_and_utc_epoch(monkeypatch):
    seen = []
    _serve(monkeypatch, [_entry()], seen)
    [p] = bambuddy.prints(limit=10)
    assert seen == [bambuddy.URL + "/api/v1/print-log/?limit=100"]
    assert p["started"] == 1793133390
    assert p["ended"] == 1793133390 + 1800
    assert p["word"] == "Finished" and p["seconds"] == 1800 and p["grams"] == 12.5
    assert p["lab"] == {"project": "hex-tile", "exp": "E-023", "build": "BLD-023-01"}


def test_non_lab_name_and_error(monkeypatch):
    _serve(monkeypatch, [_entry(print_name="HEX_TILE_v72", status="failed", failure_reason="spaghetti",
                                completed_at=None, duration_seconds=None)])
    [p] = bambuddy.prints()
    assert p["lab"] is None and p["error"] == "spaghetti" and p["ended"] is None and p["seconds"] is None


def test_sorted_by_id_descending(monkeypatch):
    _serve(monkeypatch, [_entry(id=2), _entry(id=9), _entry(id=5)])
    assert [p["id"] for p in bambuddy.prints()] == [9, 5, 2]


def test_none_when_bambuddy_down(monkeypatch):
    def boom(*a, **k):
        raise OSError("down")
    monkeypatch.setattr(sources, "_get_json", boom)
    assert bambuddy.prints() is None


def test_limits_share_one_fetch(monkeypatch):
    seen = []
    _serve(monkeypatch, [_entry(id=i) for i in range(1, 31)], seen)
    assert len(bambuddy.prints(1)) == 1
    assert len(bambuddy.prints(20)) == 20
    assert len(seen) == 1


def test_a_lab_print_keeps_its_project(monkeypatch):
    # The print name is <project>_<experiment>_<build>; the project is what opens the right one of several projects.
    _serve(monkeypatch, [_entry(print_name="mount-v2_E-007_BLD-007-03")])
    [p] = bambuddy.prints(limit=10)
    assert p["lab"] == {"project": "mount-v2", "exp": "E-007", "build": "BLD-007-03"}


def _queued(**kw):
    base = {"id": 6, "status": "pending", "archive_name": None, "library_file_name": "hex-tile_E-026_BLD-026-02.gcode.3mf",
            "waiting_reason": None, "manual_start": False, "created_at": "2026-11-06T21:14:08Z", "print_time_seconds": 2878}
    return base | kw


def test_the_queue_keeps_only_what_is_pending_or_printing_oldest_first(monkeypatch):
    seen = []
    monkeypatch.setattr(sources, "_get_json", lambda url, headers=None, timeout=None: seen.append(url) or [
        _queued(id=3, status="completed"), _queued(id=9, created_at="2026-11-07T10:00:00Z"),
        _queued(id=4, status="cancelled"), _queued(id=5, status="printing", archive_name="one-tap-test-square"),
        _queued(id=2, status="failed"), "junk", None])
    got = bambuddy.queue()
    assert seen == [bambuddy.URL + "/api/v1/queue/"]
    assert [q["id"] for q in got] == [5, 9]
    assert got[0]["name"] == "one-tap-test-square" and got[0]["status"] == "printing"
    assert got[1]["name"] == "hex-tile_E-026_BLD-026-02" and got[1]["minutes"] == 48 and got[1]["manual"] is False


def test_a_waiting_item_carries_bambuddys_reason_trimmed(monkeypatch):
    monkeypatch.setattr(sources, "_get_json", lambda *a, **k: [_queued(waiting_reason="refused " + "x" * 400, manual_start=True)])
    [q] = bambuddy.queue()
    assert q["waiting"].startswith("refused ") and len(q["waiting"]) == 300 and q["manual"] is True
    assert q["since"] == 1793999648


def test_an_empty_queue_is_a_list_and_a_silent_bambuddy_is_none(monkeypatch):
    monkeypatch.setattr(sources, "_get_json", lambda *a, **k: [_queued(status="completed")])
    assert bambuddy.queue() == []
    sources._cache.clear()
    monkeypatch.setattr(sources, "_get_json", lambda *a, **k: (_ for _ in ()).throw(OSError("down")))
    assert bambuddy.queue() is None
