"""Phone notices from the other systems (platform step 5, D2): Pi Hub's ntfy is the one phone channel, so LocalAI,
mac-watch and print-lab post here instead of sending their own. Quiet hours, de-duplication and a cap live here alone
(plan: docs/superpowers/plans/2026-11-02-step-5-pushes-onto-pi-hub.md, decisions 1-4).

Each source has a fixed list of kinds, and only its own host's key may post for it: LocalAI's and the Mac's deploy keys
(X-Hub-Deploy-Key, releases.py), and print-lab's lab key (X-Hub-Mac-Key). Every post is kept in inbound_pushes, which
dedupes, caps, and shows in the Alerts history, so "did the sender post?" has an answer on Pi Hub.
"""
import json
import re
import threading
import time
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request

from . import db, events, lab_guard, releases

router = APIRouter(prefix="/api/notify")

# source -> (label, key check, {kind: urgent}). Urgent kinds go through quiet hours and are sent as high priority.
SOURCES = {
    "localai": ("Local AI", lambda r: releases.host_key_ok(r, "localai"),
                {"needs-you": False, "failed": True, "service": True, "finished": False, "answer": True}),
    "mac-watch": ("Mac watchdog", lambda r: releases.host_key_ok(r, "mac"), {"outage": True, "back": False}),
    "print-lab": ("Print lab", lab_guard.mac_key_ok, {"verdict": False}),
}
# ntfy tag per kind: the phone's emoji, and the Alerts page's tone (alerts.js TONE: a check mark is a recovery)
TAGS = {"finished": "white_check_mark", "back": "white_check_mark", "failed": "warning", "service": "warning",
        "outage": "rotating_light"}
SAFE_URL = re.compile(r"[A-Za-z0-9\-._~:/?#\[\]!$&'()*+,;=%]+")  # RFC 3986 characters, without "@"
# Local AI's registry address is the current tap-link host (A6). localai.home.arpa and 10.0.0.21 stay accepted so notices
# already sent, and senders not yet updated, still validate.
CLICK_HOSTS = {"hub.rahe-home.duckdns.org", "assistant.rahe-home.duckdns.org", "localai.home.arpa", "10.0.0.21"}
MAX_BODY = 2048
DEDUPE_WINDOW = 600  # seconds a repeat of the same (source, dedupe) is a duplicate
CAP, CAP_WINDOW = 10, 600  # at most CAP notices per source per CAP_WINDOW seconds, then one summary
KEEP_DAYS = 30
INVALID = "That notice isn't valid."
WRONG_KEY = "That key is missing or wrong for this source."

SCHEMA = ("CREATE TABLE IF NOT EXISTS inbound_pushes (id INTEGER PRIMARY KEY, ts INTEGER, source TEXT, kind TEXT, "
          "dedupe TEXT, title TEXT, body TEXT, outcome TEXT)")
# outcome: sending, sent, held (quiet hours), failed (ntfy didn't take it), duplicate, capped
COUNTED = ("sending", "sent", "held", "failed")  # what the cap counts: everything that reached push()
SAID = {"held": "held for quiet hours", "failed": "not sent: ntfy didn't take it", "capped": "not sent: over the cap"}

_lock = threading.Lock()  # dedupe, cap and insert happen as one step
_ready = set()


def ready():
    path = db.conn().execute("PRAGMA database_list").fetchone()[2]
    if path not in _ready:
        db.run(SCHEMA)
        db.run("CREATE INDEX IF NOT EXISTS inbound_pushes_source_ts ON inbound_pushes (source, ts)")
        _ready.add(path)


def key_ok(request, source):
    entry = SOURCES.get(source)
    return bool(entry) and entry[1](request)


def _line(v, limit):
    """One line of text: whitespace collapsed (no header injection), cut to `limit`; None when not a non-empty string."""
    v = " ".join(v.split()) if isinstance(v, str) else ""
    return v[:limit] or None


def _click(v):
    """The tap link rebuilt from its parsed parts, or None. Plain printable ASCII only (no backslash, space, `@` or
    control characters), so no parser reads a different host than the one checked; https on a known host, no port."""
    if not isinstance(v, str) or not 0 < len(v) <= 300 or not SAFE_URL.fullmatch(v):
        return None
    try:
        u = urlparse(v)
        port = u.port
    except ValueError:
        return None
    if u.scheme != "https" or u.hostname not in CLICK_HOSTS or port is not None or u.username or u.password:
        return None
    return f"https://{u.hostname}{u.path or '/'}" + (f"?{u.query}" if u.query else "") + (
        f"#{u.fragment}" if u.fragment else "")


def valid(source, body):
    """The notice, cleaned, or None. kind from the source's list, title 1-120 chars, body up to 500, click an https URL
    on a known host, dedupe up to 80 chars (defaults to kind and title)."""
    if source not in SOURCES or not isinstance(body, dict):
        return None
    kind, title = body.get("kind"), _line(body.get("title"), 120)
    if kind not in SOURCES[source][2] or not title:
        return None
    text = body.get("body")
    if text is not None and not isinstance(text, str):
        return None
    click = body.get("click")
    if click is not None:
        click = _click(click)
        if click is None:
            return None
    dedupe = body.get("dedupe")
    if dedupe is not None and (not isinstance(dedupe, str) or not 1 <= len(dedupe) <= 80):
        return None
    return {"kind": kind, "title": title, "body": (text or "").replace("\r", "").strip()[:500], "click": click,
            "dedupe": dedupe or f"{kind}:{title}"}


def take(source, notice, now=None):
    """Sends `notice` through events.push() unless it is a duplicate or over the cap. Returns the outcome."""
    ready()
    now = int(now or time.time())
    label, _, kinds = SOURCES[source]
    urgent = kinds[notice["kind"]]
    with _lock:
        db.run("DELETE FROM inbound_pushes WHERE ts < ?", now - KEEP_DAYS * 86400)
        seen = db.one("SELECT 1 FROM inbound_pushes WHERE source = ? AND dedupe = ? AND ts >= ? AND outcome IN "
                      "('sending', 'sent', 'held')", source, notice["dedupe"], now - DEDUPE_WINDOW)
        recent = db.one(f"SELECT COUNT(*) AS n FROM inbound_pushes WHERE source = ? AND ts >= ? AND outcome IN "
                        f"({','.join('?' * len(COUNTED))})", source, now - CAP_WINDOW, *COUNTED)["n"]
        outcome = "duplicate" if seen else "capped" if recent >= CAP else "sending"
        summary = outcome == "capped" and not db.one(
            "SELECT 1 FROM inbound_pushes WHERE source = ? AND ts >= ? AND outcome = 'capped'", source,
            now - CAP_WINDOW)
        row = db.run("INSERT INTO inbound_pushes (ts, source, kind, dedupe, title, body, outcome) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?)", now, source, notice["kind"], notice["dedupe"], notice["title"],
                     notice["body"], outcome).lastrowid
    if summary:  # the first notice over the cap says so once; the rest wait in the Alerts history
        events.push(f"More from {label}", f"{label} sent more than {CAP} notices in {CAP_WINDOW // 60} minutes. "
                    "The rest are in Pi Hub's Alerts history.", tags="mailbox_with_mail")
    if outcome != "sending":
        return outcome
    tag = TAGS.get(notice["kind"], "incoming_envelope")
    said = events.push(f"{label}: {notice['title']}", notice["body"], tags=tag,
                       priority="high" if urgent else "default", urgent=urgent, click=notice["click"])
    outcome = "sent" if said == "Sent." else "held" if said.startswith("Held back") else "failed"
    db.run("UPDATE inbound_pushes SET outcome = ? WHERE id = ?", outcome, row)
    return outcome


def history(limit=200):
    """Inbound notices for the Alerts history, newest first, in system.alerts()'s shape. Duplicates are left out."""
    ready()
    out = []
    for r in db.rows("SELECT ts, source, kind, title, body, outcome FROM inbound_pushes WHERE outcome != 'duplicate' "
                     "ORDER BY ts DESC, id DESC LIMIT ?", limit):
        label = SOURCES.get(r["source"], (r["source"],))[0]
        note = SAID.get(r["outcome"])
        out.append({"ts": int(r["ts"]), "title": f"{label}: {r['title']}"[:120],
                    "body": (r["body"] + (f" ({note})" if note else "")).strip()[:240],
                    "tag": TAGS.get(r["kind"], "incoming_envelope")})
    return out


@router.post("/{source}")
async def notify(source: str, request: Request):
    """A notice for the phone from another system. Only its own host's key may post for a source."""
    if not key_ok(request, source):
        raise HTTPException(401, WRONG_KEY)
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "That notice is too big.")
    try:
        body = json.loads(raw)
    except ValueError:
        body = None
    notice = valid(source, body)
    if notice is None:
        raise HTTPException(400, INVALID)
    outcome = take(source, notice)
    if outcome == "capped":
        raise HTTPException(429, f"More than {CAP} notices in {CAP_WINDOW // 60} minutes; kept in the Alerts history.")
    if outcome == "failed":
        raise HTTPException(502, "The phone message didn't go out.")
    return {"ok": True, "outcome": outcome}
