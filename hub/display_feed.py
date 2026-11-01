"""The workshop display's feed v2, from Pi Hub (display on Pi Hub, step 1). Pure: the route gathers the inputs.

The same shape Local AI's buildFeed (app/display-feed.js) gives, so the display only changes its connection:
{v: 2, at, cards, needs, needsCount, images?, messages} plus ai: {available, checkedAt}. The household cards come from
Pi Hub's own records and never wait on the PC; the AI cards are Local AI's (display_ai.cards), shown only while it
answers. Text is cut as Local AI cuts it: a title of 24 characters and a line of 90, at most 12 cards."""
import hashlib
import re
from datetime import datetime, timezone

from .now import issue_items, printer_from
from .records import problems

AI_KINDS = {"watch", "running", "done", "image", "disk"}  # what Local AI's aiCards sends; anything else is dropped
MAX_CARDS = 12  # Local AI's most: needs, lab, two watch, home, running, playing, done, weather, image, disk, materials
NEED_TONES = {"bad", "attention", "warn"}
PRINTER_THINGS = {"printer", "obico", "hms", "camera"}  # the printer card speaks for these; home is the rest of the house
AI_OFF = {"kind": "ai", "id": "ai-off", "title": "AI unavailable — PC asleep", "tone": "info"}
LOCAL_AI = "Local AI"  # needs items from Local AI's attention: its approvals come in ai.approvals, its watch as AI cards


def cut(s, n):
    chars = re.sub(r"\s+", " ", str("" if s is None else s)).strip()
    return chars[:n - 1] + "…" if len(chars) > n else chars


def _card(kind, id, title, text, tone, **extra):
    return {"kind": kind, "title": cut(title, 24), "text": cut(text, 90), "tone": tone, **extra, "id": str(id)[:48]}


def _first_sentence(s):
    return re.split(r"(?<=[.!?])\s+", str(s or ""))[0]


def _needs_card(needs_list, approvals):
    household = [i for i in needs_list.get("items") or [] if i.get("source") != LOCAL_AI]
    count = len(household) + approvals["count"]
    if not count:
        return _card("needs", "needs-0", "All clear", "Nothing needs you right now.", "ok", count=0, ask="needs")
    text = household[0]["title"] if household else re.sub(r"^Needs you:\s*", "", _first_sentence(approvals["speech"]))
    return _card("needs", f"needs-{count}", "Needs you", text, "attention", count=count, ask="needs")


def _printer_card(rec):
    if not rec:
        return None
    p = printer_from(rec)
    if rec.get("stale"):
        return _card("printer", f"printer-{rec['state']}-stale", "Printer", f"Last reading: {rec['headline']}",
                     "warning", stale=True)
    busy = rec["state"] in ("printing", "paused")
    tone = ("busy" if rec["state"] == "printing" else "attention" if rec["severity"] == "problem"
            else "warning" if rec["severity"] == "attention" else "ok")
    text = " · ".join(x for x in (rec["headline"], p["detail"]) if x)
    extra = {"percent": p["progress"]} if busy else {}
    return _card("printer", f"printer-{rec['state']}", "Printer", text, tone, stale=False, **extra)


def _lab_card(lab):
    for item in lab or ():
        eid = str(item.get("id") or "").rsplit(":", 1)[-1]
        title = str(item.get("title") or "")
        action = title.split(": ", 1)[1] if ": " in title else title
        detail = str(item.get("detail") or "")
        if action == "Judge the print":
            return _card("lab", f"judge-{eid}", f"Judge {eid}", detail or "Look at the print.", "attention",
                         ask="lab-judge", run=eid[:24])
        tone = "attention" if item.get("tone") == "attention" else "busy"
        return _card("lab", f"lab-{eid}", f"Lab · {eid}", " · ".join(x for x in (action, detail) if x), tone)
    return None


def _home_card(recs):
    for key, i in issue_items(problems(recs)):
        if key not in PRINTER_THINGS:
            return _card("home", f"home-{i['what']}", i["what"], i["say"], "attention" if i["tone"] == "bad" else "warning")
    return None


def _playing_card(sessions):
    if not sessions:
        return None
    play = sessions[0]
    state = "paused" if play.get("state") == "paused" else (
        f"{play['minutes_left']} min left" if play.get("minutes_left") is not None
        else f"{play['progress']}%" if play.get("progress") is not None else "")
    more = f" · {len(sessions) - 1} more" if len(sessions) > 1 else ""
    text = " · ".join(str(x) for x in (play.get("title"), state, play.get("device")) if x) + more
    extra = {"percent": play["progress"]} if play.get("progress") is not None else {}
    return _card("playing", f"playing-{play.get('title')}", "Now playing", text, "busy", **extra)


def _materials_card(spools):
    if not spools:
        return None
    low = sum(1 for s in spools if s.get("low"))
    unknown = sum(1 for s in spools if not s.get("measured"))
    tone = "warning" if low else "info" if unknown else "ok"
    text = f"{low} spool{'s' if low > 1 else ''} low" if low else f"{len(spools)} spools in stock"
    return _card("materials", f"materials-{'low' if low else 'ok'}", "Materials", text, tone, ask="health")


def _weather_card(rec):
    """The house's weather record, worded as the display's header reads it ("<n> degrees and <sky>")."""
    if not rec or rec.get("stale") or rec["state"] not in ("ok", "warning"):
        return None
    if rec["state"] == "warning":
        return _card("weather", "weather", "Weather", rec["headline"], "warning", ask="weather")
    d = rec.get("detail") or {}
    sky = f" and {str(d['sky']).lower()}" if d.get("sky") else ""
    high = f", high {d['high']}°" if d.get("high") is not None else ""
    return _card("weather", "weather", "Weather", f"Right now: {d.get('temp')} degrees{sky}{high}.", "info", ask="weather")


def _poster(sessions, now):
    """While Plex plays something with a poster, it leads the pictures (Pi Hub serves it at images/poster)."""
    play = sessions[0] if sessions else None
    if not play or not play.get("poster"):
        return []
    return [{"title": cut(f"Now playing · {play.get('title')}", 90), "imageUrl": "/api/display/images/poster",
             "at": int(now)}]


def _ai_cards(ai, urls):
    out = []
    for c in ai["cards"]:
        if not isinstance(c, dict) or c.get("kind") not in AI_KINDS:
            continue
        c = {**c, "title": cut(c.get("title"), 24), "text": cut(c.get("text"), 90), "id": str(c.get("id") or c["kind"])[:48]}
        if c["kind"] == "image":
            n = urls.index(c.get("imageUrl")) if c.get("imageUrl") in urls else 0 if urls else None
            if n is None:
                continue
            c["imageUrl"] = f"/api/display/images/{n}"  # Local AI's address never reaches the display
        out.append(c)
    return out


def _needs_list(needs_list):
    items = [i for i in needs_list.get("items") or [] if isinstance(i, dict) and i.get("id") and i.get("title")][:6]
    return [{"id": cut(i["id"], 64), "tone": i.get("tone") if i.get("tone") in NEED_TONES else "warn",
             "title": cut(i["title"], 24), "detail": cut(i.get("detail") or "", 90),
             "source": cut(i.get("source") or "", 24)} for i in items]


def _iso(now):
    t = datetime.fromtimestamp(now, timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def build(now, ai, recs, needs_list, lab, messages, *, sessions=None, spools=None):
    """`recs`: records.all(); `needs_list`: what /api/needs answers; `lab`: its Print lab items; `messages`: the
    display's banners; `sessions`: sources.plex_sessions(); `spools`: bambuddy.spools() (None when not answering)."""
    images = [i for i in ai["images"] if isinstance(i, dict) and i.get("imageUrl")][:6]
    household = [_needs_card(needs_list, ai["approvals"]), _printer_card(recs.get("printer")), _lab_card(lab),
                 _home_card(recs), _playing_card(sessions), _materials_card(spools), _weather_card(recs.get("weather"))]
    cards = [c for c in household if c]
    cards += _ai_cards(ai, [i["imageUrl"] for i in images]) if ai["available"] else [dict(AI_OFF)]
    feed = {"v": 2, "at": _iso(now), "cards": cards[:MAX_CARDS], "needs": _needs_list(needs_list),
            "needsCount": needs_list.get("count", 0)}
    pictures = _poster(sessions, now) + ([
        {"title": cut(i.get("title") or "An image", 90), "imageUrl": f"/api/display/images/{n}",
         **({"at": i["at"]} if isinstance(i.get("at"), (int, float)) and not isinstance(i.get("at"), bool) else {})}
        for n, i in enumerate(images)] if ai["available"] else [])
    if pictures:
        feed["images"] = pictures[:6]
    feed["messages"] = list(messages or [])
    feed["ai"] = {"available": bool(ai["available"]), "checkedAt": ai["checkedAt"]}
    return feed


def _js(v):
    """A value as JavaScript's template string writes it, so the signature matches Local AI's."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def signature(feed):
    """What the long poll compares: the cards and pictures without their times and "… ago" words (Local AI's)."""
    parts = ["|".join(_js(x) for x in (c.get("kind"), c.get("id"), c.get("tone"), c.get("count"),
                                       "" if c.get("kind") == "done" else c.get("text")))
             for c in feed.get("cards") or []]
    parts += [_js(i.get("imageUrl")) for i in feed.get("images") or []]
    parts += [f"m{_js(m.get('seq'))}" for m in feed.get("messages") or []]
    parts += [f"n{_js(n.get('id'))}|{_js(n.get('tone'))}|{_js(n.get('title'))}|{_js(n.get('detail'))}"
              for n in feed.get("needs") or []]
    if "needsCount" in feed:
        parts.append(f"nc{_js(feed['needsCount'])}")
    return hashlib.sha256("\n".join(parts).encode()).hexdigest()[:16]
