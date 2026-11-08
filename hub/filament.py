"""The filament shelf. Since 24 Oct 2026 the spools live in Bambuddy (see bambuddy.py); this module keeps the
old local tables (the unused prints table stays in the database) and serves spools in the hub's shape."""
import time

from . import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS spools (
  id INTEGER PRIMARY KEY, material TEXT NOT NULL, colour TEXT NOT NULL, hex TEXT, brand TEXT,
  grams_total INTEGER NOT NULL DEFAULT 1000, grams_left INTEGER NOT NULL DEFAULT 1000,
  price REAL, added INTEGER NOT NULL, finished INTEGER
);
"""
PRINT_COLUMNS = {"spool_id": "INTEGER", "grams": "INTEGER", "cost": "REAL", "error": "TEXT", "has_photo": "INTEGER DEFAULT 0"}


def ready():
    c = db.conn()
    c.executescript(SCHEMA)
    db.ensure_columns("prints", PRINT_COLUMNS)


def spools():
    """Bambuddy's active spools; an empty list when it doesn't answer."""
    from . import bambuddy
    return bambuddy.spools() or []


def summary(days=30):
    """The last `days` of Bambuddy's print log: attempts, grams and cost. `available` is False when it doesn't answer."""
    from . import bambuddy
    items = bambuddy.prints(bambuddy.FETCH)
    since = int(time.time()) - days * 86400
    mine = [p for p in items or [] if (p["started"] or 0) >= since]
    return {"prints_logged": len(mine), "grams": round(sum(p["grams"] or 0 for p in mine), 1),
            "cost": round(sum(p["cost"] or 0 for p in mine), 2), "days": days, "available": items is not None}
