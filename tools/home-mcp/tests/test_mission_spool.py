"""The spool: atomic appends under concurrent writers, the 5 MB cap and its gap event, atomic rewrites."""
import json
import multiprocessing
from pathlib import Path

from home_mcp.mission import spool
from mission_fixtures import sized_event


def _worker(path: str, wid: int, n: int) -> None:
    for i in range(n):
        ev = sized_event(i, pad=400)
        ev["body"].update(w=wid, i=i)
        spool.append(ev, "claude", path=Path(path))


def test_spool_append_is_atomic_under_concurrent_writers(tmp_path):
    path = tmp_path / "spool.jsonl"
    ctx = multiprocessing.get_context("spawn")
    procs = [ctx.Process(target=_worker, args=(str(path), w, 200)) for w in range(8)]
    for p in procs:
        p.start()
    for p in procs:
        p.join(120)
        assert p.exitcode == 0
    lines = path.read_bytes().split(b"\n")
    assert lines.pop() == b""  # every line ends in a newline: nothing torn at the end
    entries = [json.loads(x) for x in lines]  # a torn or interleaved line would not parse
    assert len(entries) == 1600
    assert len({e["event"]["event_id"] for e in entries}) == 1600
    assert {(e["event"]["body"]["w"], e["event"]["body"]["i"]) for e in entries} == \
        {(w, i) for w in range(8) for i in range(200)}
    assert spool.status(path)["corrupt"] == 0


def test_append_sets_event_id_once_and_keeps_a_given_one(tmp_path):
    path = tmp_path / "s.jsonl"
    ev = sized_event(1)
    new = spool.append(ev, "claude", path=path)
    assert "event_id" not in ev and len(new) == 36  # the caller's dict is untouched
    given = spool.append({**ev, "event_id": "22222222-2222-4222-8222-222222222222"}, "importer", path=path)
    assert given == "22222222-2222-4222-8222-222222222222"
    assert [e["source"] for e in spool.read_all(path)] == ["claude", "importer"]


def test_spool_cap_drops_oldest_and_writes_one_gap_event(tmp_path):
    path = tmp_path / "s.jsonl"
    spool.append(sized_event(0), "claude", path=path)
    line = path.stat().st_size  # one line's size; the cap lets five fit, so the sixth append trims once
    path.unlink()
    cap = int(line * 5.5)
    ids = [spool.append(sized_event(i), "claude", path=path, cap=cap) for i in range(6)]
    entries = spool.read_all(path)
    gaps = [e for e in entries if e["event"]["type"] == "gap"]
    kept = [e for e in entries if e["event"]["type"] != "gap"]
    assert len(gaps) == 1 and gaps[0]["source"] == "claude"
    body = gaps[0]["event"]["body"]
    assert body["dropped"] == 2 == 6 - len(kept)
    assert [e["event"]["event_id"] for e in kept] == ids[body["dropped"]:]  # the oldest went, in order
    assert body["oldest_at"] == sized_event(0)["at"]
    assert body["newest_at"] == sized_event(body["dropped"] - 1)["at"]
    assert gaps[0]["event"]["initiative"] == "a34"
    assert path.stat().st_size <= cap


def test_spool_gaps_account_for_every_dropped_event(tmp_path):
    path = tmp_path / "s.jsonl"
    for i in range(60):
        spool.append(sized_event(i), "claude", path=path, cap=3000)
    entries = spool.read_all(path)
    kept = sum(e["event"]["type"] != "gap" for e in entries)
    dropped = sum(e["event"]["body"]["dropped"] for e in entries if e["event"]["type"] == "gap")
    assert kept + dropped == 60


def test_remove_rewrites_without_the_ids_and_status_counts(tmp_path):
    path = tmp_path / "s.jsonl"
    a, b, c = (spool.append(sized_event(i), "claude" if i < 2 else "importer", path=path) for i in range(3))
    assert spool.remove([a, c, "unknown"], path=path) == 2
    assert [e["event"]["event_id"] for e in spool.read_all(path)] == [b]
    with open(path, "ab") as f:
        f.write(b"{torn\n")
    s = spool.status(path)
    assert (s["count"], s["by_source"], s["corrupt"]) == (1, {"claude": 1}, 1)
    assert s["oldest_at"] == sized_event(1)["at"]


def test_a_missing_spool_reads_as_empty(tmp_path):
    path = tmp_path / "none" / "s.jsonl"
    assert spool.read_all(path) == [] and spool.remove(["x"], path=path) == 0
    assert spool.status(path)["count"] == 0
