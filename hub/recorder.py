"""Every minute: keep a sample for the charts, note print and drive changes (the print photo from the printer's record),
and check the workshop display (hub/display_watch.py)."""
import os
import threading
import time
import urllib.request

from . import bambuddy, db, display_watch, records, sources

KEEP_DAYS = 7


def prints_dir():
    default_dir = os.path.join(os.path.dirname(os.environ.get("HUB_DB", "/var/lib/pi-hub/hub.db")), "prints")
    return os.environ.get("HUB_PRINTS_DIR", default_dir)


def photos_dir():
    """Print-log photos live in their own folder: the old prints table's <id>.jpg files in prints_dir() mean other prints."""
    return os.path.join(prints_dir(), "print-log")


def _capture_now():
    """Wait for the printer to show the finished plate, then keep one photo named for Bambuddy's newest print."""
    try:
        time.sleep(20)
        with sources._lock:
            sources._cache.pop("bambuddy_prints", None)  # the minute-old fetch still names the previous print
        newest = bambuddy.prints(1)
        if not newest:
            return
        os.makedirs(photos_dir(), exist_ok=True)
        target = os.path.join(photos_dir(), f"{newest[0]['id']}.jpg")
        if os.path.exists(target):
            return
        camera_url = os.environ.get("HUB_CAMERA_URL", "http://127.0.0.1:8091")
        with urllib.request.urlopen(f"{camera_url}/x2d/frame.jpg", timeout=3) as r:
            if r.status == 200:
                data = r.read(400 * 1024)
                if data.startswith(b"\xff\xd8"):
                    with open(target, "xb") as f:
                        f.write(data)
    except Exception:
        pass


def capture_print_photo():
    threading.Thread(target=_capture_now, daemon=True).start()  # the 20 s wait must not hold up the minute sampler


_printing = False  # was the printer printing at the last look; Bambuddy's print log holds everything else


def record_print(state, progress, now, error=None):  # progress and error are kept for the callers' signature
    """Notice a print ending (printing or paused, then not) and take its photo."""
    global _printing
    if state in ("Printing", "Paused"):
        _printing = True
    elif _printing:
        _printing = False
        capture_print_photo()


def printer_state(rec):
    """The printer's record in the words record_print knows (state, progress), or None when the record
    can't say: no record yet, a silent Bambuddy, or a printer that is offline or unknown."""
    if not rec or rec.get("stale"):
        return None
    d = rec.get("detail") or {}
    if rec["state"] in ("printing", "paused"):
        return ("Printing" if rec["state"] == "printing" else "Paused"), d.get("progress")
    if rec["state"] == "failed":  # an inferred failure is a stop; Bambuddy's own FAILED is an error
        return ("Stopped" if d.get("inferred") else "Error"), d.get("last_progress")
    if rec["state"] in ("idle", "finished"):
        return "Idle", d.get("progress")
    return None


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
    said = printer_state(records.get("printer"))  # the same record the card shows
    if said:
        record_print(said[0], said[1], now, (s or {}).get("x2d_error"))
    last = lambda xs: xs[-1] if xs else None  # noqa: E731
    db.run("INSERT OR REPLACE INTO samples (ts, cpu, mem, temp, drive) VALUES (?, ?, ?, ?, ?)",
           now, last(snap["cpu_series"]), last(snap["mem_series"]), last(snap["temp_series"]), drive)
    db.run("DELETE FROM samples WHERE ts < ?", now - KEEP_DAYS * 86400)
    display_watch.probe(now)  # last: its 3 s limit never delays the sample


def run(sampler, every=60):
    time.sleep(15)
    while True:
        try:
            tick(sampler)
        except Exception:
            pass
        time.sleep(every)
