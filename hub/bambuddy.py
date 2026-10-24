"""Bambuddy (Docker on the Pi, port 8000) is the record for spools and projects; the hub only reads them.
Bambuddy takes each print's filament off its spool by itself, so nothing here writes."""
import os

from . import sources

URL = os.environ.get("HUB_BAMBUDDY_URL", "http://127.0.0.1:8000")
# Once Bambuddy's sign-in is on, the hub reads with a read-only API key (Bambuddy: Settings > API keys, "Read status"
# only), kept root:pi-hub 640 like the Plex token. Without the file the hub reads as before.
KEY_FILE = os.environ.get("HUB_BAMBUDDY_KEY_FILE", "/etc/pi-hub/secrets/bambuddy_api_key")
LOW_PCT = 15  # Bambuddy's own default when a spool has no threshold of its own


def headers():
    try:
        with open(KEY_FILE) as f:
            key = f.read().strip()
    except OSError:
        return {}
    return {"X-API-Key": key} if key else {}


def _spool(s):
    total = int(s.get("label_weight") or 1000)
    left = max(0, int(round(total - float(s.get("weight_used") or 0))))
    pct = s.get("low_stock_threshold_pct") or LOW_PCT
    rgba = s.get("rgba") or ""
    return {
        "id": s["id"], "material": " ".join(x for x in (s.get("material"), s.get("subtype")) if x) or "Filament",
        "colour": s.get("color_name") or "Unnamed", "hex": f"#{rgba[:6]}" if len(rgba) >= 6 else None,
        "brand": s.get("brand"), "grams_total": total, "grams_left": left,
        "low": left <= total * pct / 100, "cost_per_kg": s.get("cost_per_kg"),
        "measured": bool(s.get("weight_used") or s.get("last_scale_weight") or s.get("tray_uuid")),
    }


def _spools():
    return [_spool(s) for s in sources._get_json(URL + "/api/v1/inventory/spools", headers(), timeout=3) if not s.get("archived_at")]


def spools():
    """Active spools in the hub's shape, or None when Bambuddy doesn't answer."""
    return sources.cached("bambuddy_spools", 60, _spools)


def _projects():
    out = []
    for p in sources._get_json(URL + "/api/v1/projects/", headers(), timeout=3):
        if p.get("status") == "archived":
            continue
        out.append({"id": p["id"], "name": p.get("name") or "Untitled", "description": p.get("description") or "",
                    "status": p.get("status") or "active", "progress": p.get("progress_percent"),
                    "prints": p.get("archive_count") or 0, "queued": p.get("queue_count") or 0,
                    "due": p.get("due_date")})
    return out


def projects():
    return sources.cached("bambuddy_projects", 60, _projects)
