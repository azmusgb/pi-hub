"""Every minute: keep a sample for the charts, and note print and drive changes."""
import time

from . import db, sources

KEEP_DAYS = 7


def record_print(state, progress, now):
    open_print = db.one("SELECT * FROM prints WHERE ended IS NULL ORDER BY id DESC LIMIT 1")
    if state in ("Printing", "Paused"):
        if open_print:
            db.run("UPDATE prints SET progress = MAX(progress, ?) WHERE id = ?", progress or 0, open_print["id"])
        else:
            db.run("INSERT INTO prints (started, progress) VALUES (?, ?)", now, progress or 0)
        return
    if not open_print:
        return
    if state == "No status" and now - open_print["started"] < 60:
        return
    if state == "Error":
        outcome = "failed"
    elif state == "Stopped":
        outcome = "stopped" if open_print["progress"] < 97 else "finished"
    else:
        outcome = "finished" if open_print["progress"] >= 97 else "stopped"
    db.run("UPDATE prints SET ended = ?, outcome = ? WHERE id = ?", now, outcome, open_print["id"])


def record_drive(present, now):
    last = db.one("SELECT kind FROM drive_events ORDER BY ts DESC LIMIT 1")
    kind = "back" if present else "dropped"
    if (last is None and not present) or (last is not None and last["kind"] != kind):
        db.run("INSERT INTO drive_events (ts, kind) VALUES (?, ?)", now, kind)


def tick(sampler):
    now = int(time.time())
    s = sources.pi_status()
    snap = sampler.snapshot()
    drive = None
    if s:
        drive = 1 if s.get("drive_state") == "Connected" else 0
        record_drive(bool(drive), now)
        record_print(s.get("x2d_state"), s.get("x2d_progress"), now)
    last = lambda xs: xs[-1] if xs else None  # noqa: E731
    db.run("INSERT OR REPLACE INTO samples (ts, cpu, mem, temp, drive) VALUES (?, ?, ?, ?, ?)",
           now, last(snap["cpu_series"]), last(snap["mem_series"]), last(snap["temp_series"]), drive)
    db.run("DELETE FROM samples WHERE ts < ?", now - KEEP_DAYS * 86400)


def run(sampler, every=60):
    time.sleep(15)
    while True:
        try:
            tick(sampler)
        except Exception:
            pass
        time.sleep(every)
