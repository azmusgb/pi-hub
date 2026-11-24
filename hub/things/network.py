"""The network side's records: internet, AdGuard, backups, printer camera.

Pure, in the style of house.py: None in means the source didn't answer (None out); an answer
without the field we need gives an "unknown" record.
"""
from .. import records

SLOW_MS = 100  # wan or dns latency strictly over this counts as slow
HELPER_DOWN = "The hub's helper isn't running."
BACKUP_BEHIND = 48 * 3600  # seconds since a machine's last backup before it counts as behind
# seconds since the Windows PC last copied the Pi's backup before it counts as behind: the PC pulls one daily
# at 5:00, so this allows one missed morning. The selfcheck (deploy/pi-hub-selfcheck.py) fails at the same 50 h.
PC_COPY_BEHIND = 50 * 3600
PC_COPY_UNREADABLE = "The hub couldn't read when the PC last copied the backup."


def _rec(id, state, headline, **kw):
    return records.make(id, state, headline, records.SOURCE[id], **kw)


def _unknown(id, cause=""):
    return _rec(id, "unknown", "No reading", cause=cause)


def _get(s, key):
    return s.get(key) if isinstance(s, dict) else None


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def internet(net):
    if net is None:
        return None
    status = _get(net, "status")
    if status == "bad":
        return _rec("internet", "down", "Internet down")
    if status == "ok":
        if any(_num(net.get(k)) and net[k] > SLOW_MS for k in ("wan_ms", "dns_ms")):
            return _rec("internet", "slow", "Internet slow")
        return _rec("internet", "ok", "Internet OK")
    return _unknown("internet")


def adguard(report):
    if report is None:
        return None
    ok = _get(report, "ok")
    if ok is False and _get(report, "message") == HELPER_DOWN:
        return _unknown("adguard", HELPER_DOWN)
    if ok is False:
        return _rec("adguard", "not_answering", "AdGuard isn't answering",
                    cause="Ad blocking is off for the house until it answers.")
    queries, blocked = _get(report, "queries"), _get(report, "blocked")
    if not ok or not _num(queries) or not _num(blocked):
        return _unknown("adguard")
    if _get(report, "protection") is False:  # paused in AdGuard: lookups still answer, nothing is blocked (1 Nov)
        return _rec("adguard", "paused", "Ad blocking is off",
                    cause=f"AdGuard's protection is paused: {blocked} of {queries} lookups blocked today.")
    return _rec("adguard", "blocking", f"Blocking ads: {blocked} of {queries} today")


def _label(name):
    name = str(name)
    return "Pi" if name.lower() == "pi" else name.title()


def _the(name):
    return "The " + name


def _pc_copy(copy, now):
    """The PC copy's detail and, when it needs a look, its (state, headline, cause); copy is what
    system.pc_copy_reading() gave, None when it couldn't be asked."""
    if copy == "never":
        return {"last": None, "age": None}, ("behind", "The backup has never been copied to the PC", "")
    ts = _get(copy, "ts")
    if not _num(ts):
        return None, ("unknown", "No reading", PC_COPY_UNREADABLE)
    age = now - ts
    detail = {"last": ts, "age": age, "name": _get(copy, "name")}
    if age >= PC_COPY_BEHIND:
        return detail, ("behind", f"The backup hasn't been copied to the PC for {int(age // 86400)} days", "")
    return detail, None


def backups(report, now, copy):
    """Backrest's repos and the Windows PC's copy of the Pi's backup, as one record."""
    if report is None:
        return None
    ages = _get(report, "ages")
    if not _get(report, "ok") or not isinstance(ages, dict) or not ages:
        msg = _get(report, "message")
        return _unknown("backups", msg if isinstance(msg, str) else "")
    machines = [{"name": _label(n), "last": t, "age": (now - t) if _num(t) and t else None}
                for n, t in ages.items()]
    copied, copy_issue = _pc_copy(copy, now)
    detail = {"machines": machines, "pc_copy": copied}
    for m in machines:
        if m["age"] is None:
            return _rec("backups", "behind", f"{_the(m['name'])} has never backed up", detail=detail)
        if m["age"] > BACKUP_BEHIND:
            return _rec("backups", "behind",
                        f"{_the(m['name'])} hasn't backed up for {int(m['age'] // 86400)} days", detail=detail)
    if copy_issue:
        state, headline, cause = copy_issue
        return _rec("backups", state, headline, cause=cause, detail=detail)
    parts = ", ".join(f"{m['name']} {int(m['age'] // 3600)} h ago" for m in machines)
    return _rec("backups", "ok", f"Backed up: {parts}", detail=detail)


def camera(h):
    if h is None:
        return None
    if _get(h, "ok"):
        return _rec("camera", "live", "Live from the MacBook")
    cause = {"liveview_off": "LAN Only Liveview is off on the printer, and the Mac bridge has no picture.",
             "printer_unreachable": "The printer isn't answering on the network."
             }.get(_get(h, "reason"), "Neither camera bridge has a picture.")
    return _rec("camera", "no_picture", "No picture from the printer camera", cause=cause)
