"""Printer alerts (HMS codes) the owner has acknowledged from Needs you.

The X2D can keep listing a code after what raised it has passed; an acknowledged code is left out of the `hms` record
(things/printer.py hms()) for as long as the printer keeps listing it. Kept in the `settings` table under one key, as
{code: epoch acknowledged}. This only changes what the hub says: nothing here is sent to the printer or to Bambuddy.
"""
import sqlite3
import threading

from . import auth

KEY = "hms_acknowledged"
_lock = threading.Lock()  # the records loop prunes while a route may be adding


def _held():
    held = auth.get(KEY, {})
    return {str(code): at for code, at in held.items()} if isinstance(held, dict) else {}


def answered(b):
    """Bambuddy answered and can see the printer: only then does its list say which alerts are gone."""
    return isinstance(b, dict) and bool(b.get("connected"))


def listed(b):
    """The codes the printer lists in this Bambuddy reading."""
    return {e.get("code") for e in (b or {}).get("hms") or [] if isinstance(e, dict)}


def current(b):
    """The acknowledged codes, for this Bambuddy reading. A code the printer no longer lists is forgotten, so the same
    code raised again shows as new; a reading that failed or can't see the printer forgets nothing. A store that
    can't be read acknowledges nothing: an alert is never hidden because a read failed."""
    with _lock:
        try:
            held = _held()
        except (sqlite3.Error, ValueError):
            return frozenset()
        if not answered(b):
            return frozenset(held)
        now_listed = listed(b)
        kept = {code: at for code, at in held.items() if code in now_listed}
        if kept != held:
            try:
                auth.put(KEY, kept)
            except sqlite3.Error:
                pass  # the next good reading tries again
        return frozenset(kept)


def acknowledge(code, now):
    """Remembers `code` as acknowledged. Raises sqlite3.Error when it can't be saved."""
    with _lock:
        try:
            held = _held()
        except ValueError:  # an unreadable value is replaced, not kept
            held = {}
        held[str(code)] = int(now)
        auth.put(KEY, held)
