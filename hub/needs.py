"""Needs you (one home, D7): what wants the owner now, from the hub's own live issues, Local AI's house cards, the
Pi's recent alerts and the printer. Read from each app on every call; nothing is copied (D8)."""

ALERT_HOURS = 12
FAILED_HOURS = 24
ORDER = {"bad": 0, "attention": 1, "warn": 2}
ASSISTANT = "https://assistant.home.arpa/"


def _printer(events, now):
    """The newest print event decides: finished → clear the plate; failed (in the last day) → say so."""
    for e in events:  # newest first
        if e["kind"] == "print_started":
            return None
        if e["kind"] == "print_finished":
            return {"source": "Printer", "tone": "attention", "title": "Clear the plate",
                    "detail": e.get("detail") or "The print is done.", "link": "/workshop", "ts": e["ts"]}
        if e["kind"] == "print_failed":
            if now - e["ts"] > FAILED_HOURS * 3600:
                return None
            return {"source": "Printer", "tone": "bad", "title": "The print failed",
                    "detail": e.get("detail") or "Check the plate.", "link": "/workshop", "ts": e["ts"]}
    return None


def build(alerts, events, feed, now, issues=()):
    items = [{"source": "Pi Hub", "tone": i["tone"] if i.get("tone") in ORDER else "warn", "title": i["what"],
              "detail": i.get("say", ""), "link": "/pi", "ts": now} for i in issues]
    unread = []
    if feed is None:
        unread.append("Local AI")
    else:
        for c in feed.get("cards") or []:
            if c.get("tone") in ORDER:
                items.append({"source": "Local AI", "tone": c["tone"], "title": str(c.get("title", ""))[:80],
                              "detail": str(c.get("text", ""))[:200], "link": ASSISTANT, "ts": now})
    for a in alerts or []:
        if now - a["ts"] <= ALERT_HOURS * 3600:
            items.append({"source": "Pi", "tone": "warn", "title": a["title"], "detail": a.get("body", ""),
                          "link": "/alerts", "ts": a["ts"]})
    p = _printer(events or [], now)
    if p:
        items.append(p)
    items.sort(key=lambda i: (ORDER[i["tone"]], -i["ts"]))
    return {"count": len(items), "items": [{k: v for k, v in i.items() if k != "ts"} for i in items], "unread": unread}
