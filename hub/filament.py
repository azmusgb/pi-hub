"""The filament shelf: spools, grams left, low-stock warnings, and what each print cost."""
import re
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
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
PRINT_COLUMNS = {"spool_id": "INTEGER", "grams": "INTEGER", "cost": "REAL", "error": "TEXT", "has_photo": "INTEGER DEFAULT 0"}


def ready():
    c = db.conn()
    c.executescript(SCHEMA)
    db.ensure_columns("prints", PRINT_COLUMNS)


def low_at():
    return int(auth.get("filament_low_at", 150))


def spools(include_finished=False):
    ready()
    rows = db.rows("SELECT * FROM spools " + ("" if include_finished else "WHERE finished IS NULL ") +
                   "ORDER BY material, colour")
    lo = low_at()
    for r in rows:
        r["low"] = r["finished"] is None and r["grams_left"] <= lo
        r["cost_per_kg"] = round(r["price"] * 1000 / r["grams_total"], 2) if r["price"] and r["grams_total"] else None
    return rows


def _clean(b, partial=False):
    out = {}
    if "material" in b or not partial:
        m = str(b.get("material", "")).strip()
        if m not in MATERIALS:
            raise ValueError("Choose a material.")
        out["material"] = m
    if "colour" in b or not partial:
        colour = " ".join(str(b.get("colour", "")).split())[:40]
        if not colour:
            raise ValueError("Give the colour a name, like “Jade white”.")
        out["colour"] = colour
    if "hex" in b:
        h = str(b.get("hex") or "")
        out["hex"] = h if HEX.match(h) else None
    if "brand" in b:
        out["brand"] = " ".join(str(b.get("brand") or "").split())[:40] or None
    for key in ("grams_total", "grams_left"):
        if key in b and b[key] not in (None, ""):
            v = int(float(b[key]))
            if not 0 <= v <= 10000:
                raise ValueError("Grams should be between 0 and 10,000.")
            out[key] = v
    if "price" in b:
        p = b.get("price")
        out["price"] = round(float(p), 2) if p not in (None, "") else None
        if out["price"] is not None and not 0 <= out["price"] <= 1000:
            raise ValueError("That price doesn't look right.")
    return out


def add(b):
    ready()
    v = _clean(b)
    total = v.get("grams_total", 1000)
    return db.run("INSERT INTO spools (material, colour, hex, brand, grams_total, grams_left, price, added) "
                  "VALUES (?, ?, ?, ?, ?, ?, ?, ?)", v["material"], v["colour"], v.get("hex"), v.get("brand"),
                  total, v.get("grams_left", total), v.get("price"), int(time.time())).lastrowid


def _check_low(spool_id, before):
    from . import events
    s = db.one("SELECT * FROM spools WHERE id = ?", spool_id)
    if s and before > low_at() >= s["grams_left"]:
        events.fire("filament_low", f"{s['colour']} {s['material']}, {s['grams_left']} g left")


def update(spool_id, b):
    ready()
    before = db.one("SELECT grams_left FROM spools WHERE id = ?", spool_id)
    if not before:
        raise LookupError("No such spool.")
    if b.get("finished"):
        db.run("UPDATE spools SET finished = ?, grams_left = 0 WHERE id = ?", int(time.time()), spool_id)
        return
    v = _clean(b, partial=True)
    if v:
        db.run(f"UPDATE spools SET {', '.join(f'{k} = ?' for k in v)} WHERE id = ?", *v.values(), spool_id)
    _check_low(spool_id, before["grams_left"])


def remove(spool_id):
    ready()
    db.run("UPDATE prints SET spool_id = NULL WHERE spool_id = ?", spool_id)
    db.run("DELETE FROM spools WHERE id = ?", spool_id)


def log_print(print_id, spool_id, grams):
    """Records the filament a print used, takes it off the spool, and works out what it cost."""
    ready()
    p = db.one("SELECT * FROM prints WHERE id = ?", print_id)
    s = db.one("SELECT * FROM spools WHERE id = ?", spool_id)
    if not p or not s:
        raise LookupError("No such print or spool.")
    grams = int(float(grams))
    if not 1 <= grams <= 5000:
        raise ValueError("Enter the grams the print used, from Bambu Studio or Handy.")
    if p["spool_id"] and p["grams"]:  # changing an earlier entry: put the old grams back first
        db.run("UPDATE spools SET grams_left = MIN(grams_total, grams_left + ?) WHERE id = ?", p["grams"], p["spool_id"])
    s = db.one("SELECT * FROM spools WHERE id = ?", spool_id)
    cost = round(s["price"] * grams / s["grams_total"], 2) if s["price"] and s["grams_total"] else None
    db.run("UPDATE spools SET grams_left = MAX(0, grams_left - ?) WHERE id = ?", grams, spool_id)
    db.run("UPDATE prints SET spool_id = ?, grams = ?, cost = ? WHERE id = ?", spool_id, grams, cost, print_id)
    _check_low(spool_id, s["grams_left"])
    return {"cost": cost}


def summary(days=30):
    ready()
    since = int(time.time()) - days * 86400
    r = db.one("SELECT COUNT(*) AS n, COALESCE(SUM(grams), 0) AS g, COALESCE(SUM(cost), 0) AS c FROM prints "
               "WHERE started >= ? AND grams IS NOT NULL", since)
    return {"prints_logged": r["n"], "grams": r["g"], "cost": round(r["c"], 2), "days": days}
