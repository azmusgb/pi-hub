import importlib.util
import os
import subprocess
import time
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("mirror", Path(__file__).parent.parent / "deploy" / "pi-hub-movies-mirror.py")
mirror = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mirror)

# The Pi has GNU rsync 3; macOS ships openrsync, which lacks some of the options and itemizes differently.
GNU_RSYNC = "rsync  version 3" in subprocess.run(["rsync", "--version"], capture_output=True, text=True).stdout
needs_rsync = pytest.mark.skipif(not GNU_RSYNC, reason="needs GNU rsync 3, as on the Pi")


@pytest.fixture
def box(tmp_path):
    src, dest, removed = tmp_path / "pc", tmp_path / "usb1" / "Movies", tmp_path / "usb1" / ".movies-removed"
    src.mkdir()
    for i in range(10):
        (src / f"Film {i} (2020).mp4").write_bytes(b"x" * (100 + i))
    (src / "Film 0 (2020).en.srt").write_text("1\n00:00:01,000 --> 00:00:02,000\nHi\n")
    (src / "Big One (2019).MKV").write_bytes(b"y" * 50)
    (src / "netmon-backups").mkdir()
    (src / "netmon-backups" / "dump.tar").write_bytes(b"z")
    (src / ".hidden.mp4").write_bytes(b"h")
    rescans = []

    def run(**kw):
        kw.setdefault("is_mount", lambda p: True)
        return mirror.sync(str(src), str(dest), str(removed), str(tmp_path / "state.json"), rescan=lambda: rescans.append(1), **kw)
    run.src, run.dest, run.removed, run.rescans, run.state = src, dest, removed, rescans, tmp_path / "state.json"
    return run


@needs_rsync
def test_copies_only_films_and_subtitles(box):
    s = box()
    assert s["status"] == "ok", s["message"]
    names = sorted(p.name for p in box.dest.rglob("*") if p.is_file())
    assert "Big One (2019).MKV" in names and "Film 0 (2020).en.srt" in names
    assert "dump.tar" not in names and ".hidden.mp4" not in names
    assert s["source_count"] == s["mirror_count"] == 11 and s["copied"] == 12 and box.rescans == [1]
    assert s["last_ok"] and "11 movies on the Pi" in s["message"]
    assert mirror.load_state(str(box.state))["status"] == "ok"


@needs_rsync
def test_second_run_copies_nothing_and_skips_the_rescan(box):
    box()
    s = box()
    assert s["status"] == "ok" and s["copied"] == 0 and box.rescans == [1]
    assert s["message"].startswith("Nothing new to copy")


@needs_rsync
def test_film_removed_on_the_pc_is_set_aside_not_deleted(box):
    box()
    (box.src / "Film 3 (2020).mp4").unlink()
    s = box()
    assert s["status"] == "ok" and s["removed"] == 1 and s["mirror_count"] == 10
    kept = list(box.removed.rglob("Film 3 (2020).mp4"))
    assert len(kept) == 1 and s["set_aside_bytes"] == 103
    # ...and it's gone for good after 30 days.
    old = time.time() - 31 * 86400
    os.utime(kept[0].parent, (old, old))
    assert mirror.purge_removed(str(box.removed), time.time()) == 0
    assert not list(box.removed.rglob("*.mp4"))


@needs_rsync
def test_unmounted_share_copies_and_removes_nothing(box):
    box()
    s = box(is_mount=lambda p: False)
    assert s["status"] == "skipped" and "isn't mounted" in s["message"]
    assert len(list(box.dest.glob("*.mp4"))) == 10
    assert mirror.load_state(str(box.state))["last_ok"]  # the last good copy is still recorded


@needs_rsync
def test_share_suddenly_missing_films_is_not_mirrored(box):
    box()
    for p in list(box.src.glob("Film [0-4]*.mp4")):
        p.unlink()
    s = box()
    assert s["status"] == "skipped" and "down from 11" in s["message"]
    assert len(list(box.dest.glob("*.mp4"))) == 10 and not box.removed.exists()
    s = box(accept_drop=True)
    assert s["status"] == "ok" and s["mirror_count"] == 6 and s["removed"] == 5


@needs_rsync
def test_empty_share_is_skipped(box):
    box()
    for p in box.src.glob("*.*"):
        p.unlink()
    assert box(accept_drop=True)["status"] == "skipped"
    assert len(list(box.dest.glob("*.mp4"))) == 10


@needs_rsync
def test_refuses_to_overfill_the_drive(box, monkeypatch):
    class St:
        f_blocks, f_bfree, f_frsize = 1000, 1000, 1  # a 1000-byte drive
    monkeypatch.setattr(mirror.os, "statvfs", lambda p: St)
    s = box()
    assert s["status"] == "failed" and "past 90%" in s["message"]
    assert not list(box.dest.glob("*.mp4"))


@needs_rsync
def test_changed_film_is_replaced_and_old_copy_kept(box):
    box()
    (box.src / "Film 1 (2020).mp4").write_bytes(b"new" * 500)
    s = box()
    assert s["status"] == "ok" and s["copied"] == 1
    assert (box.dest / "Film 1 (2020).mp4").read_bytes() == b"new" * 500
    assert list(box.removed.rglob("Film 1 (2020).mp4"))


def test_rsync_patterns_ignore_case():
    assert mirror._pattern(".mkv") == "*.[mM][kK][vV]" and mirror._pattern(".mp4") == "*.[mM][pP]4"
