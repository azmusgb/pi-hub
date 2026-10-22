"""Process-local source response history. Old readings are display-only."""
import threading
import time

_lock = threading.Lock()
_readings = {}
LABELS = {"pi": "House status", "plex": "Plex playback", "world": "Local AI",
          "home": "Smart-home controls", "printer": "Document printer",
          "weather": "Weather", "calendar": "Calendar"}


def _summary(key, value):
    if key == "pi":
        temp = value.get("pi_temp")
        return " · ".join(x for x in [f"Pi {temp} °C" if temp is not None else None,
                                       f"Movies drive: {value.get('drive_state', 'unknown')}",
                                       f"3D printer: {value.get('x2d_state', 'unknown')}"] if x)
    if key == "plex":
        return f"{len(value)} active streams" if value else "No active streams"
    if key == "home":
        return f"{len(value)} controllable devices"
    if key == "printer":
        return str(value.get("state", "Unknown"))[:80]
    if key == "weather":
        return f"{value.get('now', {}).get('temp', '—')} °{value.get('units', '')} · {value.get('now', {}).get('sky', 'Forecast received')}"[:100]
    if key == "calendar":
        return f"{len(value)} upcoming items"
    return "Local AI responded"


def record(key, ttl, value):
    if key not in LABELS:
        return
    stamp = time.time()
    # Explicit allowlisted summaries; never retain credentials or raw payloads.
    try:
        summary = _summary(key, value) if value is not None else None
    except (AttributeError, TypeError):
        summary = None
    with _lock:
        previous = _readings.get(key, {})
        _readings[key] = {**previous, "checked_at": stamp, "ttl": ttl,
                          "answered": summary is not None}
        if summary is not None:
            _readings[key].update(confirmed_at=stamp, reading=summary)


def observe(key, ttl, fn):
    try:
        value = fn()
    except Exception:
        record(key, ttl, None)
        raise
    record(key, ttl, value)
    return value


def snapshot(configured=None):
    stamp = time.time()
    with _lock:
        values = {k: dict(v) for k, v in _readings.items()}
    out = []
    for key, label in LABELS.items():
        value = values.get(key, {})
        state = "not_checked"
        if configured and configured.get(key) is False:
            value, state = {}, "not_configured"
        elif value:
            state = "unavailable" if not value["answered"] else \
                "stale" if stamp - value["checked_at"] > value["ttl"] else "current"
        out.append({"key": key, "label": label, "state": state,
                    "checked_at": value.get("checked_at"), "confirmed_at": value.get("confirmed_at"),
                    "reading": value.get("reading"), "max_age": value.get("ttl")})
    return {"as_of": stamp, "readings": out}
