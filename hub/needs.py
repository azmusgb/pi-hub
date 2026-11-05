"""Needs you (one home, D7): what wants the owner now, from the hub's own records and Local AI's house cards. Read on
every call; nothing is copied (D8). The Pi's alert history isn't used: it mixes problems with recoveries ("display
went offline", "display is back"), and the records already say what is still wrong. A finished or failed print is
the printer record's own "clear the plate"."""
import re
import time
from datetime import datetime
from urllib.parse import quote

from .now import issue_items
from .things.printer import hms_title

ORDER = {"bad": 0, "attention": 1, "warn": 2}
ABOUT_PRINTER = re.compile(r"\b(printer|x2d|bambu)\b", re.I)
NOT_X2D = re.compile(r"\b(document|brother|toner|paper|deskjet|laserjet|inkjet)\b", re.I)
ABOUT_WORKSHOP_DISPLAY = re.compile(r"\b(workshop display|touchscreen)\b", re.I)
ASSISTANT = "tool:assistant"  # the page resolves it to the address in use (sections.js resolveLink)
BLIND_FIX = "tool:bambuddy/settings?tab=failure-detection"  # Bambuddy's own Failure detection settings tab
# Each Local AI card kind opens the Assistant page it is about (LocalAI view-registry.js ids): approvals are in the
# Inbox with the alerts a watch raises, runs in Work, disk in Assistant status.
ASSISTANT_VIEW = {"needs": f"{ASSISTANT}/#inbox", "running": f"{ASSISTANT}/#work", "done": f"{ASSISTANT}/#work",
                  "disk": f"{ASSISTANT}/#status", "watch": f"{ASSISTANT}/#inbox"}
HUB = "Pi Hub"
LAB = "Print lab"
LAB_EXP = re.compile(r"^E-\d{1,6}$")
LAB_PROJECT = re.compile(r"^[a-z0-9-]{1,40}$")
# Home's printer card goes amber or red while Needs you lists an item about the X2D, so the card never stays green beside
# "the printer has a problem": the hub's records about it, one row for Bambuddy gone quiet (it stands for those records),
# and other sources' items that name the X2D or Bambu. Narrower than ABOUT_PRINTER: a bare "printer" may be the document
# printer or another one ("Brother printer toner low"), which must not turn the X2D's card amber.
PRINTER_THINGS = {"printer", "obico", "hms", "source:bambuddy"}
NAMES_X2D = re.compile(r"\b(x2d|bambu)\b", re.I)
# What an HMS severity means for the print (as things/printer.py stops()).
HMS_EFFECT = {1: "It stops the print.", 2: "It pauses the print.", 3: "The print carries on."}
LAB_TONE = {"Judge the print": "attention", "Approve or drop": "attention", "Send it to the printer": "warn",
            "Fix the plan": "warn"}
# Each item's action is named by its verb, as a kit phrase key (A7 P2, plan decision 3): never "Open" alone. The lab's
# asks are their own verbs; a hub item opens its page by name. An item with no verb here is a row that is its link.
LAB_VERB = {"Judge the print": "judge_it", "Approve or drop": "approve", "Send it to the printer": "send",
            "Fix the plan": "fix_plan"}
PAGE_VERB = {"/workshop": "open_printer", "/network": "open_network"}


def _clip(text, n):
    """`text` cut to at most `n` characters at a word boundary, with an ellipsis when cut, so a page never shows
    half a word ("...or adhe", iPad, 1 Nov)."""
    text = str(text or "").strip()
    if len(text) <= n:
        return text
    cut = text[:n - 1]
    space = cut.rfind(" ")
    return (cut[:space] if space > n // 2 else cut).rstrip(" ,;:.") + "…"


def _due(s, now):
    """True when `s` (an ISO time) is at or before `now`; None when it can't be read."""
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return t.timestamp() <= now if t.tzinfo else None
    except (ValueError, TypeError):
        return None


def _lab_items(lab, now, printer_done):
    """The print lab's own asks, from the hub's copy of each project's index. Bad entries are skipped, never raised."""
    out = []
    for entry in lab or ():
        try:
            project, as_of, needs = entry
        except (ValueError, TypeError):
            continue
        if not isinstance(project, str) or not LAB_PROJECT.match(project) or not isinstance(needs, list):
            continue
        for n in needs:
            if not isinstance(n, dict):
                continue
            eid, action, urgency = n.get("id"), n.get("action"), n.get("urgency")
            if not isinstance(eid, str) or not LAB_EXP.match(eid) or action not in LAB_TONE:
                continue
            if not isinstance(urgency, int) or isinstance(urgency, bool):
                continue
            if urgency >= 3 and action != "Fix the plan":
                continue
            judge = action == "Judge the print"
            link = f"/lab?p={project}&e={eid}&do=judge" if judge else f"/lab?p={project}&e={eid}"
            if judge and n.get("due_at") is not None and not printer_done and not _due(n["due_at"], now):
                continue  # not yet due (or an unreadable time): the verdict waits for the print
            out.append({"id": f"pi:lab:{project}:{eid}", "source": LAB, "tone": LAB_TONE[action],
                        "title": f"{eid}: {action}"[:80], "detail": _clip(n.get("why"), 200),
                        "link": link, "action": {"key": LAB_VERB[action], "link": link},
                        "as_of": str(as_of or ""), "ts": now})
    return out


def _whats_using_it(item):
    """Local AI's "Mac disk is 95% full": the Assistant, opened with the question (its #ask?context= hand-off, as the
    hub's Assistant button). Local AI has no page listing the Mac's largest folders yet, so none is linked. The kit's
    see_usage phrase names the action."""
    said = item["detail"].rstrip(".")
    item["detail"] = said
    item["link"] = f"{ASSISTANT}/#ask?context=" + quote(f"Pi Hub › {said}. What's using the space?", safe="")
    item["action"] = {"key": "see_usage", "link": item["link"]}


def _matches(about, text):
    return about(text) if callable(about) else bool(about.search(text))


def _one_row(items, about, ours):
    """One row for a thing several sources name: the hub's own record (`ours`) if it has one, else the most urgent.
    The hub's other records are never folded in (the printer camera and the document printer also say "printer")."""
    named = [i for i in items if ours(i) or (i["source"] != HUB and _matches(about, f'{i["title"]} {i["detail"]}'))]
    if len(named) <= 1:
        return items
    keep = next((i for i in named if ours(i)), named[0])
    return [i for i in items if i is keep or i not in named]


def build(events, feed, now, problems=(), lab=(), printer_done=False, healthy=frozenset()):
    """`problems`: records.problems() (worst first, then oldest). `events` is no longer read: the printer record
    knows when the plate is cleared. `healthy`: ids of the hub's records that are OK and fresh; another source's item
    about one of those things is out of date (2 Nov: Local AI said the Workshop display wasn't answering while the
    hub's own record had it online, and Home's "All else OK" listed it)."""
    items = []
    by_id = {r["id"]: r for r in problems}
    for key, i in issue_items(list(problems)):
        errors = (by_id.get(key) or {}).get("detail", {}).get("errors") if key == "hms" else None
        if errors:  # one item per fault code, so each can be told apart and dismissed on its own
            for e in errors:
                sev = e.get("severity")
                known = isinstance(sev, int) and not isinstance(sev, bool)
                effect = HMS_EFFECT.get(sev) if known else None
                items.append({"id": f"pi:source:hms:{e['code']}", "source": HUB,
                              "tone": "bad" if known and sev in (1, 2) else "warn",  # as things/printer.py stops()
                              "title": hms_title(e),
                              "detail": f"{effect} Alert {e['code']}." if effect else f"Alert {e['code']}.",
                              "link": i["href"], "ts": now, "thing": key, "record": key})
            continue
        id = "pi:" + key if key.startswith(("source:", "release:")) else "pi:" + i["what"]
        item = {"id": id, "source": HUB, "tone": i["tone"], "title": i["what"],
                "detail": i["say"], "link": i["href"], "ts": now, "thing": key, "record": key}
        rec = by_id.get(key) or {}
        if key == "obico" and rec.get("state") == "blind" and not rec.get("stale"):
            # nothing watches the print: above "Worth a look", and the fix is in Bambuddy's settings (IMG_1047, 28 Oct)
            item.update(tone="attention", title=rec["headline"], detail=rec.get("cause") or "", link=BLIND_FIX,
                        action={"key": "open_bambuddy", "link": BLIND_FIX})
        items.append(item)
    unread = []
    if feed is None:
        unread.append("Local AI")
    else:
        for c in feed.get("cards") or []:
            tone = "warn" if c.get("tone") == "warning" else c.get("tone")
            if str(c.get("id") or "").startswith(("judge-", "lab-")):  # the hub's copy is the source now
                continue
            if tone not in ORDER or c.get("kind") == "home":  # home cards are the Pi's own issues coming back
                continue
            item = {"id": f"localai:{c.get('id') or c.get('kind') or 'card'}", "source": "Local AI", "tone": tone,
                    "title": _clip(c.get("title", ""), 80), "detail": _clip(c.get("text", ""), 200),
                    "link": ASSISTANT_VIEW.get(c.get("kind"), ASSISTANT), "ts": now}
            if c.get("id") == "watch-mac-disk":
                _whats_using_it(item)
            if "workshop_display" in healthy and ABOUT_WORKSHOP_DISPLAY.search(f'{item["title"]} {item["detail"]}'):
                continue  # the hub is the display's connection (platform K2); its fresh OK record is the truth
            items.append(item)
    seen = {}
    for i in items:  # ids stay unique within a build (cards without their own id fall back to their kind)
        n = seen[i["id"]] = seen.get(i["id"], 0) + 1
        if n > 1:
            i["id"] = f'{i["id"]}#{n}'
    items.sort(key=lambda i: (ORDER[i["tone"]], -i["ts"]))
    # One row for the X2D: the printer record first, else the most urgent of the others that name the X2D or Bambu
    # (or echo "the printer"). Generic "printer" items (e.g. document printers) stay separate.
    items = _one_row(items, lambda t: bool(ABOUT_PRINTER.search(t) and not NOT_X2D.search(t)), lambda i: i.get("thing") == "printer")
    # Local AI and the hub can both report the Workshop touchscreen outage; the hub's record is the direct source.
    items = _one_row(items, ABOUT_WORKSHOP_DISPLAY, lambda i: i.get("thing") == "workshop_display")
    for i in items:
        if i.get("thing") in PRINTER_THINGS or (i["source"] != HUB and NAMES_X2D.search(f'{i["title"]} {i["detail"]}')):
            i["about"] = "printer"
    # After the folds: the lab's text says "printer"/"print", and must not be folded into the printer's row.
    items = sorted(items + _lab_items(lab, now, printer_done), key=lambda i: (ORDER[i["tone"]], -i["ts"]))
    for i in items:
        if "action" not in i and i.get("link") in PAGE_VERB:
            i["action"] = {"key": PAGE_VERB[i["link"]], "link": i["link"]}
    drop = ("ts", "thing")
    return {"count": len(items), "items": [{k: v for k, v in i.items() if k not in drop} for i in items], "unread": unread}


def current(recs=None, *, fetch=True):
    """Needs you now, as /api/needs answers it (and the display's feed reads it): the hub's records, Local AI's own
    attention and the print lab's stored asks. fetch=False never asks Local AI: only what /api/needs last read and
    is still fresh is used, else the household's items alone (with Local AI listed as unread)."""
    from . import lab, records, sources
    recs = records.all() if recs is None else recs
    printer = recs.get("printer") or {}
    feed = sources.localai_feed() if fetch else sources.localai_feed_cached()
    healthy = frozenset(k for k, r in recs.items() if isinstance(r, dict) and r.get("severity") == "ok" and not r.get("stale"))
    return build((), feed, int(time.time()), records.problems(recs), lab=lab.stored_needs(),
                 printer_done=not printer.get("stale") and printer.get("state") in ("finished", "failed"), healthy=healthy)
