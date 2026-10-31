"""Ask Local AI about the house. The question goes to Local AI on the Windows PC together with
what the hub knows right now, so answers come from the hub's own facts, not guesses."""
import json
import ssl
import time
import urllib.request

from . import bambuddy, events, now, records, sources

CHAT_URL = "https://10.0.0.21/api/chat"


def _when(ts):
    return time.strftime("%a %-I:%M %p", time.localtime(ts))


# Only these record details are useful facts for an answer. Do not serialize raw source payloads.
DETAILS = {
    "printer": ("job", "progress", "minutes_left", "nozzle", "bed", "layer", "total_layers"),
    "pi": ("temp", "power", "updates", "uptime_h"),
    "movies_drive": ("movies", "free"),
    "movie_copy": ("last_ok",),
    "weather": ("temp", "high"),
}


def context():
    """The same snapshot Home uses. An old reading is evidence of the past, never of the current state."""
    recs = records.all()
    stamp = time.time()
    # A sampler that stalls must not leave a healthy-looking summary above expired readings.
    summary_records = {}
    for key, rec in recs.items():
        expired = rec.get("stale") or stamp - rec["as_of"] > records.STALE_AFTER.get(rec["source"], 90)
        summary_records[key] = {**rec, "stale": True, "severity": "attention",
                                "headline": "Current state unknown; the last reading is stale", "cause": ""} if expired else rec
    found = now.issues_from(summary_records)
    summary = now.summary(found) if found else "No current problems reported; check reading freshness below"
    lines = [f"Now: {time.strftime('%A %-I:%M %p')}.",
             "Unknown means not known; stale readings describe the past only. Command acceptance does not prove physical completion.",
             f"Summary: {summary}."]
    lines += [f"Needs a look: {i['what']}: {i['say']}" for i in found]
    for key in records.KINDS:
        label = records.LABELS.get(key, key)
        rec = recs.get(key)
        if not rec:
            lines.append(f"{label}: Unknown (no reading yet).")
            continue
        source = records.SOURCE_NAMES.get(rec["source"], rec["source"])
        age = max(0, int(stamp - rec["as_of"]))
        stale = rec.get("stale") or age > records.STALE_AFTER.get(rec["source"], 90)
        if stale:
            lines.append(f"{label}: Current state unknown. Last reading {age} seconds ago from {source}: {rec['headline']} (STALE).")
            continue
        lines.append(f"{label}: {rec['headline']} (source: {source}; confirmed {age} seconds ago).")
        if rec.get("cause"):
            lines.append(f"{label} detail: {rec['cause']}")
        detail = rec.get("detail") or {}
        facts = [f"{k}={detail[k]}" for k in DETAILS.get(key, ()) if detail.get(k) is not None]
        if facts:
            lines.append(f"{label} readings: {', '.join(facts)}.")

    # A successful empty response means nothing playing; a failed read does not.
    playing = sources.plex_sessions()
    if playing is None:
        lines.append("Plex playback: Unknown (no response).")
    elif playing:
        lines.append("Plex playing right now: " + ", ".join(
            f"{sess.get('title', 'Unknown title')} ({sess.get('who') or 'someone'})" for sess in playing) + ".")
    else:
        lines.append("Plex playback: Nothing playing right now.")

    for e in events.recent(8):
        lines.append(f"Historical event {_when(e['ts'])}: {events.TRIGGERS.get(e['kind'], e['kind'])}{' ' + e['detail'] if e['detail'] else ''}.")
    prints = bambuddy.prints(3)
    if prints is None:
        lines.append("Recent 3D print history: Unknown (Bambuddy did not answer).")
    for pr in prints or []:
        when = f" started {_when(pr['started'])}" if pr["started"] else ""
        took = f", took {round((pr['ended'] - pr['started']) / 60)} min" if pr["ended"] and pr["started"] else ""
        lines.append(f"Historical 3D print {pr['name']}{when}: {pr['word']}{took}.")
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
                                 data=json.dumps({"messages": [{"role": "user", "content": prompt}], "brief": True,
                                                 "title": "House question"}).encode())  # its name in Local AI's Recent
    try:
        with urllib.request.urlopen(req, timeout=90, context=ctx) as r:
            reply = json.load(r)
    except OSError as e:
        raise RuntimeError("Local AI isn't answering. The Windows PC may be off.") from e
    text = ((reply.get("message") or {}).get("content") or "").strip()
    if not text:
        raise RuntimeError("Local AI didn't send an answer. Try again.")
    return {"answer": text[:1200], "model": reply.get("model")}
