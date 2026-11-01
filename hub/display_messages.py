"""Banners for the workshop display and the display's heartbeat, kept in the hub DB.

The message objects are Local AI's (app/display-messages.js): {seq, title, text, tone, chime, action, at}. At most 6 a
minute, kept 15 minutes. `seq` only grows (milliseconds, and the last one is stored, so a restart never reuses one).
Quiet hours 22:00-07:00 keep the banner but chime only a failure (tone "warning")."""
import json
import os
import re
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from . import db

TONES = ("info", "ok", "attention", "warning", "busy")
PAGES = ("localai", "image", "camera", "printer")
KEEP_S, RATE, RATE_S = 15 * 60, 6, 60
TITLE_MAX, TEXT_MAX = 24, 120
QUIET_START, QUIET_END = "22:00", "07:00"
_lock = threading.Lock()
_sends = []


class Refused(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


def _ready():
    db.conn().executescript(
        "CREATE TABLE IF NOT EXISTS display_messages (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, body TEXT NOT NULL);"
        "CREATE TABLE IF NOT EXISTS display_state (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL);")


def cut(text, n):
    chars = re.sub(r"\s+", " ", str("" if text is None else text)).strip()
    return chars[:n - 1] + "…" if len(chars) > n else chars


def _quiet(now):
    hhmm = datetime.fromtimestamp(now, ZoneInfo(os.environ.get("TZ") or "America/New_York")).strftime("%H:%M")
    return hhmm >= QUIET_START or hhmm < QUIET_END


def clean_action(action):
    if action is None:
        return None
    if isinstance(action, dict):
        m = action.get("minutes")
        if action.get("type") == "timer" and isinstance(m, int) and not isinstance(m, bool) and 1 <= m <= 240:
            return {"type": "timer", "minutes": m}
        if action.get("type") == "show" and action.get("page") in PAGES:
            return {"type": "show", "page": action["page"]}
    raise ValueError('action must be {type:"timer", minutes:1-240} or {type:"show", page:' + "|".join(PAGES) + "}")


def post(title, text="", tone="info", chime=False, action=None, now=None):
    """Add a banner and return its seq. ValueError for a bad message; Refused(429) beyond 6 a minute."""
    now = time.time() if now is None else now
    title, text = cut(title, TITLE_MAX), cut(text, TEXT_MAX)
    if not title:
        raise ValueError("title is required")
    tone = tone if tone in TONES else "info"
    action = clean_action(action)
    with _lock:
        _ready()
        while _sends and now - _sends[0] > RATE_S:
            _sends.pop(0)
        if len(_sends) >= RATE:
            raise Refused(429, "At most 6 messages a minute")
        row = db.one("SELECT v FROM display_state WHERE k = 'seq'")
        seq = max(int(now * 1000), int(row["v"]) + 1 if row else 0)
        chime = bool(chime) and (not _quiet(now) or tone == "warning")
        body = {"seq": seq, "title": title, "text": text, "tone": tone, "chime": chime, "action": action,
                "at": int(now)}
        db.run("INSERT OR REPLACE INTO display_state (k, v, at) VALUES ('seq', ?, ?)", str(seq), int(now))
        db.run("DELETE FROM display_messages WHERE at <= ?", int(now) - KEEP_S)
        db.run("INSERT INTO display_messages (seq, at, body) VALUES (?, ?, ?)", seq, int(now), json.dumps(body))
        _sends.append(now)
    return seq


def pending(now=None):
    """The last 15 minutes of banners, oldest first."""
    now = time.time() if now is None else now
    _ready()
    return [json.loads(r["body"]) for r in
            db.rows("SELECT body FROM display_messages WHERE at > ? ORDER BY seq", int(now) - KEEP_S)]


def store_heartbeat(body, now):
    _ready()
    db.run("INSERT OR REPLACE INTO display_state (k, v, at) VALUES ('heartbeat', ?, ?)", json.dumps(body), int(now))


def last_heartbeat(max_age=600, now=None):
    now = time.time() if now is None else now
    _ready()
    row = db.one("SELECT v, at FROM display_state WHERE k = 'heartbeat'")
    if not row or now - row["at"] > max_age:
        return None
    return json.loads(row["v"])
