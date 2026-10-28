"""Needs you (one home, D7): what wants the owner now, from the hub's own records and Local AI's house cards. Read on
every call; nothing is copied (D8). The Pi's alert history isn't used: it mixes problems with recoveries ("display
went offline", "display is back"), and the records already say what is still wrong. A finished or failed print is
the printer record's own "clear the plate"."""
import re

from .now import issue_items

ORDER = {"bad": 0, "attention": 1, "warn": 2}
ABOUT_PRINTER = re.compile(r"\b(printer|x2d|bambu)\b", re.I)
ABOUT_WORKSHOP_DISPLAY = re.compile(r"\b(workshop display|touchscreen)\b", re.I)
ASSISTANT = "tool:assistant"  # the page resolves it to the address in use (sections.js resolveLink)
HUB = "Pi Hub"


def _one_row(items, about, ours):
    """One row for a thing several sources name: the hub's own record (`ours`) if it has one, else the most urgent.
    The hub's other records are never folded in (the printer camera and the document printer also say "printer")."""
    named = [i for i in items if ours(i) or (i["source"] != HUB and about.search(f'{i["title"]} {i["detail"]}'))]
    if len(named) <= 1:
        return items
    keep = next((i for i in named if ours(i)), named[0])
    return [i for i in items if i is keep or i not in named]


def build(events, feed, now, problems=()):
    """`problems`: records.problems() (worst first, then oldest). `events` is no longer read: the printer record
    knows when the plate is cleared."""
    items = []
    by_id = {r["id"]: r for r in problems}
    for key, i in issue_items(list(problems)):
        errors = (by_id.get(key) or {}).get("detail", {}).get("errors") if key == "hms" else None
        if errors:  # one item per fault code, so each can be told apart and dismissed on its own
            for e in errors:
                sev = e.get("severity")
                known = isinstance(sev, int) and not isinstance(sev, bool)
                items.append({"id": f"pi:source:hms:{e['code']}", "source": HUB,
                              "tone": "bad" if known and sev in (1, 2) else "warn",  # as things/printer.py stops()
                              "title": f"Printer needs attention ({e['code']})",
                              "detail": f"{e['code']}, severity {sev if known else 'unknown'}",
                              "link": i["href"], "ts": now, "thing": key})
            continue
        id = "pi:" + key if key.startswith("source:") else "pi:" + i["what"]
        items.append({"id": id, "source": HUB, "tone": i["tone"], "title": i["what"],
                      "detail": i["say"], "link": i["href"], "ts": now, "thing": key})
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
    seen = {}
    for i in items:  # ids stay unique within a build (cards without their own id fall back to their kind)
        n = seen[i["id"]] = seen.get(i["id"], 0) + 1
        if n > 1:
            i["id"] = f'{i["id"]}#{n}'
    items.sort(key=lambda i: (ORDER[i["tone"]], -i["ts"]))
    # One row for the printer: the printer record first, else the most urgent of the others that name it
    # (Local AI's "Heads up" says the same thing).
    items = _one_row(items, ABOUT_PRINTER, lambda i: i.get("thing") == "printer")
    # Local AI and the hub can both report the Workshop touchscreen outage; the hub's record is the direct source.
    items = _one_row(items, ABOUT_WORKSHOP_DISPLAY, lambda i: i.get("thing") == "workshop_display")
    drop = ("ts", "thing")
    return {"count": len(items), "items": [{k: v for k, v in i.items() if k not in drop} for i in items], "unread": unread}
