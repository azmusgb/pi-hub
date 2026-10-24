"""The filament shelf. Since 24 Oct 2026 the spools live in Bambuddy (see bambuddy.py); this module keeps the
old local tables and the print columns the recorder fills, and serves spools in the hub's shape."""
import time

from . import auth, db

SCHEMA = """
CREATE TABLE IF NOT EXISTS spools (
  id INTEGER PRIMARY KEY, material TEXT NOT NULL, colour TEXT NOT NULL, hex TEXT, brand TEXT,
  grams_total INTEGER NOT NULL DEFAULT 1000, grams_left INTEGER NOT NULL DEFAULT 1000,
  price REAL, added INTEGER NOT NULL, finished INTEGER
);
"""
MATERIALS = ["PLA", "PLA Matte", "PLA Silk", "PLA-CF", "PETG", "PETG-CF", "ABS", "ASA", "TPU", "PC", "PA-CF", "Support", "Other"]
PRINT_COLUMNS = {"spool_id": "INTEGER", "grams": "INTEGER", "cost": "REAL", "error": "TEXT", "has_photo": "INTEGER DEFAULT 0"}


def ready():
    c = db.conn()
    c.executescript(SCHEMA)
    db.ensure_columns("prints", PRINT_COLUMNS)


def low_at():
    return int(auth.get("filament_low_at", 150))


def spools():
    """Bambuddy's active spools; an empty list when it doesn't answer."""
    from . import bambuddy
    return bambuddy.spools() or []


def summary(days=30):
    ready()
    since = int(time.time()) - days * 86400
    r = db.one("SELECT COUNT(*) AS n, COALESCE(SUM(grams), 0) AS g, COALESCE(SUM(cost), 0) AS c FROM prints "
               "WHERE started >= ? AND grams IS NOT NULL", since)
    return {"prints_logged": r["n"], "grams": r["g"], "cost": round(r["c"], 2), "days": days}
