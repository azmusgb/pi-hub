"""When the Mac last reached the print lab, and what waits for it: the facts behind the mac_lab record (platform step 6,
PR 6.2; spec §4 `mac_lab`). The Mac's lab pull asks for pending requests every 60 s with its key, so every request that
carries a valid Mac key counts as contact. Kept in the DB so a restart doesn't make an awake Mac look silent."""
import time

from . import db

WRITE_EVERY = 60    # seconds between contact writes: the record only needs the minute
SILENT_AFTER = 180  # three of lab pull's 60 s runs (print-lab lab/pull.py StartInterval): step 6 plan, Decision 3
_last_write = 0


def _ready():
    db.conn().executescript("CREATE TABLE IF NOT EXISTS lab_state (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL);")


def note_contact(now=None):
    """The Mac just reached the hub with its key. Never raises: bookkeeping must not refuse the Mac."""
    global _last_write
    now = int(time.time() if now is None else now)
    if now - _last_write < WRITE_EVERY:
        return
    try:
        _ready()
        db.run("INSERT OR REPLACE INTO lab_state (k, v, at) VALUES ('mac_contact', '', ?)", now)
        _last_write = now
    except Exception:  # noqa: BLE001
        pass


def facts():
    """{last_contact, last_synced, waiting, oldest_waiting}: epoch seconds or None, the newest project sync as stored, and
    the pending requests. Raises when the tables can't be read, so the record says unknown rather than guessing."""
    from . import lab
    lab.ready()
    _ready()
    contact = db.one("SELECT at FROM lab_state WHERE k = 'mac_contact'")
    pending = db.one("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM lab_requests WHERE status = 'pending'")
    synced = db.one("SELECT MAX(synced_at) AS s FROM lab_projects")
    return {"last_contact": contact["at"] if contact else None,
            "last_synced": synced["s"] if synced else None,
            "waiting": int(pending["n"] or 0),
            "oldest_waiting": lab.parse_iso(pending["oldest"]) if pending["oldest"] else None}
