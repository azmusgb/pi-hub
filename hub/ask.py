"""Ask Local AI about the house. The question goes to Local AI on the Windows PC together with
what the hub knows right now, so answers come from the hub's own facts, not guesses."""
import json
import ssl
import time
import urllib.request

from . import db, events, now, sources

CHAT_URL = "https://10.0.0.21/api/chat"


def _when(ts):
    return time.strftime("%a %-I:%M %p", time.localtime(ts))


def context():
    s = sources.pi_status()
    found = now.issues(s)
    p = now.printer(s)
    lines = [f"Now: {time.strftime('%A %-I:%M %p')}.",
             f"Summary: {now.summary(found)}."]
    lines += [f"Needs a look: {i['what']}: {i['say']}" for i in found]
    lines.append(f"Bambu X2D printer: {p['headline']}" + (f", {p.get('left')} left" if p.get("left") else "") + ".")
    if s:
        svc = s.get("services") or {}
        lines.append(f"Plex is {'running' if svc.get('plex') else 'stopped'}; Homebridge is {'running' if svc.get('homebridge') else 'stopped'}.")
        lines.append(f"Movies drive: {s.get('drive_state')}, {s.get('movies') or 'unknown'} movies, {s.get('drive_free') or 'unknown'} free, "
                     f"{s.get('drive_resets')} USB resets since the Pi started.")
        lines.append(f"Raspberry Pi: {s.get('pi_temp')} °C, power {s.get('pi_power')}, {s.get('updates')} updates waiting.")
        lines.append(f"Workshop display: {s.get('display_state')}. Local AI: {s.get('ai_state')}.")
    for e in events.recent(15):
        lines.append(f"Event {_when(e['ts'])}: {events.TRIGGERS.get(e['kind'], e['kind'])}{' ' + e['detail'] if e['detail'] else ''}.")
    for p in db.rows("SELECT started, ended, outcome, progress FROM prints ORDER BY id DESC LIMIT 5"):
        lines.append(f"Print started {_when(p['started'])}: {p['outcome'] or 'still going'}" +
                     (f", took {round((p['ended'] - p['started']) / 60)} min" if p["ended"] else "") + ".")
    for d in db.rows("SELECT ts, kind FROM drive_events ORDER BY ts DESC LIMIT 5"):
        lines.append(f"Movies drive {'dropped out' if d['kind'] == 'dropped' else 'came back'} {_when(d['ts'])}.")
    return "\n".join(lines)


def ask(question):
    question = " ".join((question or "").split())[:400]
    if len(question) < 3:
        raise ValueError("Type a question.")
    prompt = ("You are the voice of a family's home hub on a Raspberry Pi. Answer the question in one to three short, "
              "plain sentences, using only the facts below. If the facts don't say, answer that the hub doesn't know.\n\n"
              f"Facts:\n{context()}\n\nQuestion: {question}")
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # Local AI uses its own certificate on the home network
    req = urllib.request.Request(CHAT_URL, method="POST", headers={"Content-Type": "application/json"},
                                 data=json.dumps({"messages": [{"role": "user", "content": prompt}], "brief": True}).encode())
    try:
        with urllib.request.urlopen(req, timeout=90, context=ctx) as r:
            reply = json.load(r)
    except OSError as e:
        raise RuntimeError("Local AI isn't answering. The Windows PC may be off.") from e
    text = ((reply.get("message") or {}).get("content") or "").strip()
    if not text:
        raise RuntimeError("Local AI didn't send an answer. Try again.")
    return {"answer": text[:1200], "model": reply.get("model")}
