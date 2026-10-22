"""The hub's own small database: history for charts, prints, drive dropouts, and household lists."""
import os
import sqlite3
import threading
from contextlib import contextmanager

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (ts INTEGER PRIMARY KEY, cpu REAL, mem REAL, temp REAL, drive INTEGER);
CREATE TABLE IF NOT EXISTS drive_events (ts INTEGER NOT NULL, kind TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS prints (
  id INTEGER PRIMARY KEY, started INTEGER NOT NULL, ended INTEGER, outcome TEXT, progress INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY, list TEXT NOT NULL, text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, done_at INTEGER
);
CREATE INDEX IF NOT EXISTS items_list ON items(list, done, created);
"""


def conn():
    path = os.environ.get("HUB_DB", "/var/lib/pi-hub/hub.db")
    c = getattr(_local, "conn", None)
    if c is None or getattr(_local, "path", None) != path:
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
        c = sqlite3.connect(path, timeout=5, isolation_level=None)
        _local.path = path
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        _local.conn = c
    return c


def rows(sql, *args):
    return [dict(r) for r in conn().execute(sql, args).fetchall()]


def one(sql, *args):
    r = conn().execute(sql, args).fetchone()
    return dict(r) if r else None


def run(sql, *args):
    return conn().execute(sql, args)


@contextmanager
def transaction():
    """Serialize related writes on the calling thread's connection."""
    connection = conn()
    connection.execute('BEGIN IMMEDIATE')
    try:
        yield connection
        connection.commit()
    except BaseException:
        connection.rollback()
        raise


def ensure_columns(table, columns):
    """Add known internal columns safely when several first requests arrive together."""
    have = {r['name'] for r in rows(f'PRAGMA table_info({table})')}
    if all(name in have for name in columns):
        return
    with transaction() as connection:
        have = {r['name'] for r in rows(f'PRAGMA table_info({table})')}
        for name, kind in columns.items():
            if name not in have:
                connection.execute(f'ALTER TABLE {table} ADD COLUMN {name} {kind}')
