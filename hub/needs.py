"""Needs you (one home, D7): what wants the owner now, from the hub's own live issues, Local AI's house cards and the
printer. Read from each app on every call; nothing is copied (D8). The Pi's alert history isn't used: it mixes
problems with recoveries ("display went offline", "display is back"), and the live issues already say what is still
wrong."""
import re

PRINT_HOURS = 24  # a finished or failed print asks for a day, until step 3 knows when the plate is cleared
ORDER = {"bad": 0, "attention": 1, "warn": 2}
ABOUT_PRINTER = re.compile(r"\b(printer|x2d|bambu)\b", re.I)
ABOUT_WORKSHOP_DISPLAY = re.compile(r"\b(workshop display|touchscreen)\b", re.I)
ASSISTANT = "tool:assistant"  # the page resolves it to the address in use (sections.js resolveLink)


def print_detail(raw, verb):
    """Bambuddy's message ("<printer>: <file>.gcode\nTime: 1h 4m\nFilament: …") as "Finished <job> · 1 h 4 min"."""
    lines = str(raw or "").splitlines()
    job = re.sub(r"\.(gcode|3mf)$", "", lines[0].split(": ", 1)[-1].strip(), flags=re.I) if lines else ""
    took = next((m for m in (re.match(r"Time:\s*(?:(\d+)h)?\s*(?:(\d+)m)?", l.strip()) for l in lines[1:]) if m and m.group(0) != "Time:"), None)
    took = " ".join(x for x in ((f"{took.group(1)} h" if took and took.group(1) else ""),
                                (f"{took.group(2)} min" if took and took.group(2) else "")) if x)
    if not job or job.lower().startswith("bambu"):  # no job name, only the printer's: say it plainly
        return "The print is done." if verb == "Finished" else "Check the plate."
    return " · ".join(x for x in (f"{verb} {job}", took) if x)


def _printer(events, now):
    """The newest print event decides: finished → clear the plate; failed (in the last day) → say so."""
    for e in events:  # newest first
        if e["kind"] == "print_started":
            return None
        if e["kind"] == "print_finished":
            if now - e["ts"] > PRINT_HOURS * 3600:
                return None
            return {"id": "printer:plate", "source": "Printer", "tone": "attention", "title": "Clear the plate",
                    "detail": print_detail(e.get("detail"), "Finished"), "link": "/workshop", "ts": e["ts"]}
        if e["kind"] == "print_failed":
            if now - e["ts"] > PRINT_HOURS * 3600:
                return None
            return {"id": "printer:failed", "source": "Printer", "tone": "bad", "title": "The print failed",
                    "detail": print_detail(e.get("detail"), "Failed"), "link": "/workshop", "ts": e["ts"]}
    return None


def build(events, feed, now, issues=()):
    items = [{"id": "pi:" + i["what"], "source": "Pi Hub", "tone": i["tone"] if i.get("tone") in ORDER else "warn", "title": i["what"],
              "detail": i.get("say", ""), "link": "/pi", "ts": now} for i in issues]
    unread = []
    if feed is None:
        unread.append("Local AI")
    else:
        for c in feed.get("cards") or []:
            tone = "warn" if c.get("tone") == "warning" else c.get("tone")
            if tone not in ORDER or c.get("kind") == "home":  # home cards are the Pi's own issues coming back
                continue
            items.append({"id": f"localai:{c.get('id') or c.get('kind') or 'card'}", "source": "Local AI", "tone": tone,
                          "title": str(c.get("title", ""))[:80], "detail": str(c.get("text", ""))[:200],
                          "link": ASSISTANT, "ts": now})
    p = _printer(events or [], now)
    if p:
        items.append(p)
    seen = {}
    for i in items:  # ids stay unique within a build (cards without their own id fall back to their kind)
        n = seen[i["id"]] = seen.get(i["id"], 0) + 1
        if n > 1:
            i["id"] = f'{i["id"]}#{n}'
    items.sort(key=lambda i: (ORDER[i["tone"]], -i["ts"]))
    # One row for the printer: the hub's own print event first, else the most urgent of the others that name it
    # (Local AI's "Heads up", the Pi's alert for the X2D say the same thing).
    printer = [i for i in items if i["source"] == "Printer" or ABOUT_PRINTER.search(f'{i["title"]} {i["detail"]}')]
    if len(printer) > 1:
        keep = next((i for i in printer if i["source"] == "Printer"), printer[0])
        items = [i for i in items if i is keep or i not in printer]

    # Local AI and Pi Hub can both report the Workshop touchscreen outage.
    # Keep the Pi Hub item because it is the direct device-status source.
    workshop_display = [
        i for i in items
        if ABOUT_WORKSHOP_DISPLAY.search(f'{i["title"]} {i["detail"]}')
    ]
    if len(workshop_display) > 1:
        keep = next(
            (i for i in workshop_display if i["source"] == "Pi Hub"),
            workshop_display[0]
        )
        items = [i for i in items if i is keep or i not in workshop_display]

    return {"count": len(items), "items": [{k: v for k, v in i.items() if k != "ts"} for i in items], "unread": unread}
