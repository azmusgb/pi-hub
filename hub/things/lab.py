"""The mac_lab record: is anything waiting for the Mac, and has the Mac gone quiet while it waits (spec §4)."""
from .. import mac_lab, records


def _ago(seconds):
    m = max(0, int(seconds // 60))
    return "just now" if m < 1 else f"{m} min ago" if m < 120 else f"{m // 60} h ago"


def mac_lab_record(f, now):
    """idle: nothing waits. waiting: requests wait and the Mac is checking in. mac_silent: a request has waited more than
    SILENT_AFTER and the Mac hasn't checked in for that long (a problem, so it joins Needs you). A table that can't be
    read raises, and things._build makes that "unknown"."""
    contact, waiting, oldest = f["last_contact"], f["waiting"], f["oldest_waiting"]
    detail = {"waiting": waiting, "last_contact": contact, "last_synced": f["last_synced"]}
    heard = f"The Mac checked in {_ago(now - contact)}." if contact else "The hub hasn't heard from the Mac yet."
    if not waiting:  # nothing waits, so a quiet Mac is no problem, whether or not it has been heard from
        return records.make("mac_lab", "idle", "Nothing waiting for the Mac", "hub", cause=heard, detail=detail)
    n = "1 lab request waits" if waiting == 1 else f"{waiting} lab requests wait"
    quiet = contact is None or now - contact > mac_lab.SILENT_AFTER
    if quiet and oldest is not None and now - oldest > mac_lab.SILENT_AFTER:
        return records.make("mac_lab", "mac_silent", f"{n} for the Mac", "hub", detail=detail,
                            cause=f"{heard} It runs when the Mac is awake; your answers are kept.")
    return records.make("mac_lab", "waiting", f"{n} for the Mac", "hub", cause=heard, detail=detail)
