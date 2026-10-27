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
    assert seen == [bambuddy.URL + "/api/v1/print-log/?limit=10"]
    assert p["started"] == 1793133390
    assert p["ended"] == 1793133390 + 1800
    assert p["word"] == "Finished" and p["seconds"] == 1800 and p["grams"] == 12.5
    assert p["lab"] == {"exp": "E-023", "build": "BLD-023-01"}


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
