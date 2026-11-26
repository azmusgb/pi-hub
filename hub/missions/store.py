"""The ledger's tables (A35 §6.2; M1b plan decision 3): `mission_events`, the append-only log, and the projections
`project.apply` writes. Everything here takes the caller's connection, so the log and its projections are written in
one transaction (`db.transaction`, BEGIN IMMEDIATE). Rebuild replays the log through the same `apply` into fresh rows
and compares or replaces the live ones."""
import json

from .. import db
from . import project

SCHEMA = """
CREATE TABLE IF NOT EXISTS mission_events (
  seq INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, at TEXT NOT NULL, received_at TEXT NOT NULL,
  source TEXT NOT NULL, initiative TEXT NOT NULL, entity TEXT NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL,
  late INTEGER NOT NULL DEFAULT 0, behind INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mission_events_initiative ON mission_events(initiative, seq);
CREATE TABLE IF NOT EXISTS mission_initiatives (
  id TEXT PRIMARY KEY, title TEXT, intent TEXT, status TEXT, manifest TEXT, spec TEXT, created_at TEXT, seq INTEGER
);
CREATE TABLE IF NOT EXISTS mission_revisions (
  initiative TEXT NOT NULL, n INTEGER NOT NULL, at TEXT, proposer TEXT, status TEXT, manifest TEXT, summary TEXT,
  requires_approval INTEGER, declared INTEGER, seen INTEGER, seq INTEGER, PRIMARY KEY (initiative, n)
);
CREATE TABLE IF NOT EXISTS mission_changes (
  initiative TEXT NOT NULL, revision INTEGER NOT NULL, entity TEXT NOT NULL, kind TEXT, op TEXT, before TEXT,
  after TEXT, PRIMARY KEY (initiative, revision, entity)
);
CREATE TABLE IF NOT EXISTS mission_entities (
  initiative TEXT NOT NULL, revision INTEGER NOT NULL, id TEXT NOT NULL, kind TEXT, data TEXT, state TEXT,
  PRIMARY KEY (initiative, revision, id)
);
CREATE TABLE IF NOT EXISTS mission_evidence (
  initiative TEXT NOT NULL, id TEXT NOT NULL, kind TEXT, trust TEXT, source TEXT, summary TEXT, data TEXT,
  observed_at TEXT, revision INTEGER, seq INTEGER, PRIMARY KEY (initiative, id)
);
CREATE TABLE IF NOT EXISTS mission_executions (
  initiative TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL, level TEXT, title TEXT, state TEXT,
  started_at TEXT, ended_at TEXT, logged_at TEXT, data TEXT, seq INTEGER,
  tool_state TEXT, tool TEXT, tool_label TEXT, tool_at TEXT, PRIMARY KEY (initiative, id)
);
CREATE INDEX IF NOT EXISTS mission_executions_id ON mission_executions(id, source);
CREATE TABLE IF NOT EXISTS mission_task_states (
  initiative TEXT NOT NULL, task TEXT NOT NULL, state TEXT, at TEXT, source TEXT, execution TEXT, summary TEXT,
  seq INTEGER, PRIMARY KEY (initiative, task)
);
"""
EVENT_COLUMNS = ("seq", "event_id", "at", "received_at", "source", "initiative", "entity", "type", "body", "late",
                 "behind")

_ready = set()


def ready():
    path = db.conn().execute("PRAGMA database_list").fetchone()[2]
    if path not in _ready:
        db.conn().executescript(SCHEMA)
        _ready.add(path)


def event_from_row(row):
    """A logged event as `project.apply` takes it, from its row: the same shape live and in rebuild."""
    return {**{k: row[k] for k in EVENT_COLUMNS}, "body": json.loads(row["body"]), "late": bool(row["late"]),
            "behind": bool(row["behind"])}


def _where(table):
    return "id = ?" if table == "mission_initiatives" else "initiative = ?"


def load_rows(c, initiative):
    """{table: {key: row}} for one initiative's projections, as stored."""
    out = {}
    for table in project.KEYS:
        rows = c.execute(f"SELECT * FROM {table} WHERE {_where(table)}", (initiative,)).fetchall()
        out[table] = {project.key_of(table, dict(r)): dict(r) for r in rows}
    return out


def load_state(c, initiative):
    """The live state `apply` folds into: the projections, plus the imported events since the last revision (the
    pending import, which lives only in the log until its plan.imported)."""
    state = project.empty(initiative)
    state["rows"] = load_rows(c, initiative)
    last = c.execute("SELECT COALESCE(MAX(seq), 0) FROM mission_revisions WHERE initiative = ?",
                     (initiative,)).fetchone()[0]
    rows = c.execute("SELECT * FROM mission_events WHERE initiative = ? AND seq > ? AND type LIKE '%.imported' "
                     "AND type != 'plan.imported' ORDER BY seq", (initiative, last)).fetchall()
    state["pending"] = [event_from_row(dict(r)) for r in rows]
    return state


def append(c, event):
    """Appends one event (without seq) and returns it as logged, with its seq."""
    cur = c.execute(f"INSERT INTO mission_events ({', '.join(EVENT_COLUMNS[1:])}) VALUES "
                    f"({', '.join('?' * (len(EVENT_COLUMNS) - 1))})",
                    tuple(int(event[k]) if k in ("late", "behind") else event[k] for k in EVENT_COLUMNS[1:]))
    row = c.execute("SELECT * FROM mission_events WHERE seq = ?", (cur.lastrowid,)).fetchone()
    return event_from_row(dict(row))


def put(c, table, row):
    cols = list(row)
    c.execute(f"INSERT OR REPLACE INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
              tuple(row[k] for k in cols))


def write(c, changes):
    for change in changes:
        if change[0] == "put":
            put(c, change[1], change[2])


def known(c, event_ids):
    """The event ids among `event_ids` already in the log."""
    if not event_ids:
        return set()
    marks = ", ".join("?" * len(event_ids))
    return {r[0] for r in c.execute(f"SELECT event_id FROM mission_events WHERE event_id IN ({marks})",
                                    tuple(event_ids))}


def owner_of(c, exec_id, source):
    """Another source that created execution `exec_id`, or None."""
    row = c.execute("SELECT source FROM mission_executions WHERE id = ? AND source != ? LIMIT 1",
                    (exec_id, source)).fetchone()
    return row[0] if row else None


def seq_max(c):
    return c.execute("SELECT COALESCE(MAX(seq), 0) FROM mission_events").fetchone()[0]


def replay(c, initiative):
    """The projections the log alone gives for `initiative`, with each execution's in-place columns taken from its
    live row (plan decision 4). None when the log has no event for it."""
    rows = c.execute("SELECT * FROM mission_events WHERE initiative = ? ORDER BY seq", (initiative,)).fetchall()
    if not rows:
        return None
    state = project.empty(initiative)
    for r in rows:
        project.fold(state, project.apply(state, event_from_row(dict(r))))
    live = load_rows(c, initiative)["mission_executions"]
    for key, row in state["rows"]["mission_executions"].items():
        if key in live:
            row.update({k: live[key][k] for k in project.IN_PLACE})
    return state["rows"]


def differences(replayed, live):
    """Lines naming each row that differs between two {table: {key: row}} sets, in-place columns aside."""
    out = []
    for table in project.KEYS:
        a, b = replayed.get(table, {}), live.get(table, {})
        for key in sorted(a.keys() | b.keys(), key=repr):
            name = f"{table} {'/'.join(map(str, key))}"
            if key not in b:
                out.append(f"{name}: missing from the live table")
            elif key not in a:
                out.append(f"{name}: in the live table but not in the log")
            else:
                cols = sorted(c for c in a[key].keys() | b[key].keys() if c not in project.IN_PLACE
                              and a[key].get(c) != b[key].get(c))
                if cols:
                    out.append(f"{name}: differs in {', '.join(cols)}")
    return out


def replace(c, initiative, rows):
    """The initiative's projections replaced by `rows`, inside the caller's transaction."""
    for table in project.KEYS:
        c.execute(f"DELETE FROM {table} WHERE {_where(table)}", (initiative,))
        for row in rows[table].values():
            put(c, table, row)
