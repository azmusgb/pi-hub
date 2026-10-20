"""The morning digest: one phone message with what happened overnight and what needs doing."""
import time

from . import auth, db, events, filament, now, outside, sources


def build(hours=16):
    since = int(time.time()) - hours * 3600
    s = sources.pi_status()
    lines = []
    w = outside.weather()
    if w:
        today = w["days"][0]
        u = w.get("units", "F")
        rain = f", {today['rain']}% chance of rain" if today.get("rain") else ""
        lines.append(f"{w['now']['sky']}, {w['now']['temp']}°{u} now, high {today['high']}°{rain}.")
        if w.get("soon"):
            lines.append(w["soon"])
        for a in (w.get("alerts") or [])[:2]:
            lines.append(f"Weather warning: {a['event']}.")
    prints = db.rows("SELECT outcome FROM prints WHERE ended >= ?", since)
    if prints:
        done = sum(1 for p in prints if p["outcome"] == "finished")
        other = len(prints) - done
        lines.append(f"Prints overnight: {done} finished" + (f", {other} stopped" if other else "") + ".")
    printer = now.printer(s)
    if printer["state"] == "printing":
        lines.append(f"The X2D is {printer['headline'].lower()}, {printer.get('left') or 'time left unknown'} to go.")
    drops = db.one("SELECT COUNT(*) AS n FROM drive_events WHERE kind = 'dropped' AND ts >= ?", since)["n"]
    if drops:
        lines.append(f"The movies drive dropped out {drops} time{'s' if drops > 1 else ''}.")
    issues = now.issues(s)
    lines += [f"Needs a look: {i['what']}. {i['say']}" for i in issues[:3]]
    if s and s.get("updates"):
        lines.append(f"{s['updates']} updates are waiting on the Pi.")
    cal = outside.calendar() or []
    today_end = time.mktime(time.localtime()[:3] + (23, 59, 59, 0, 0, -1))
    todays = [e for e in cal if e["start"] <= today_end]
    if todays:
        lines.append("Today: " + "; ".join(
            (e["title"] if e["all_day"] else f"{time.strftime('%-I:%M %p', time.localtime(e['start']))} {e['title']}") for e in todays[:3]) + ".")
    low = [f"{x['colour']} {x['material']} ({x['grams_left']} g)" for x in filament.spools() if x["low"]]
    if low:
        lines.append("Filament running low: " + ", ".join(low[:4]) + ".")
    shopping = db.one("SELECT COUNT(*) AS n FROM items WHERE list = 'shopping' AND done = 0")["n"]
    if shopping:
        lines.append(f"{shopping} thing{'s' if shopping > 1 else ''} on the shopping list.")
    if not issues and not drops:
        lines.append("Everything else is running.")
    return "Good morning", "\n".join(lines)


def send():
    title, body = build()
    return events.push(title, body, "sunrise", urgent=True)


def due(last_sent, now_ts=None):
    cfg = auth.get("digest", {"on": True, "at": "08:00"})
    if not cfg.get("on"):
        return False
    t = time.localtime(now_ts or time.time())
    hh, mm = (int(x) for x in cfg.get("at", "08:00").split(":"))
    today = time.strftime("%Y-%m-%d", t)
    return (t.tm_hour, t.tm_min) >= (hh, mm) and last_sent != today and t.tm_hour < hh + 3


def run(every=60):
    time.sleep(30)
    while True:
        try:
            if due(auth.get("digest_last")):
                send()
                auth.put("digest_last", time.strftime("%Y-%m-%d"))
        except Exception:
            pass
        time.sleep(every)
