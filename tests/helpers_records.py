"""Shared helper for the records tests."""
from hub import records

T = 1000


def merged(rec, at=T):
    return records.merge(None, rec, at)


def bud(state="IDLE", progress=0, job="HEX_TILE_v72.gcode.3mf", awaiting=False, connected=True):
    """What sources.bambuddy_printer() returns."""
    return {"connected": connected, "state": state, "bambuddy_state": state, "job_name": job,
            "progress": progress, "layer_num": 5, "total_layers": 100, "nozzle_temp": 250,
            "nozzle_target": 255, "bed_temp": 60, "bed_target": 60, "ams_humidity": 3,
            "filament_type": "PLA", "filament_color": "FFFFFF", "awaiting_plate_clear": awaiting}


# what sources.pi_status() returns on a quiet day
PI = {"drive_state": "Connected", "ai_state": "Ready", "display_state": "Online", "pi_temp": 50,
      "pi_power": "Good", "services": {"plex": True, "homebridge": True}}

# every source answering, nothing wrong: what things.gather() returns
GOOD = {"bambuddy": bud(), "pi_status": PI, "netmon": {"win_ok": True, "status": "ok", "wan_ms": 20, "dns_ms": 10},
        "lab": None, "sessions": [], "paper": {"state": "Ready"},
        "weather": {"now": {"temp": 50, "sky": "Clear"}, "days": [{"high": 60}], "alerts": []},
        "adguard": {"ok": True, "queries": 100, "blocked": 10}, "backups": {"ok": True, "ages": {"pi": T}},
        "camera": {"ok": True}, "obico": {"enabled": True, "per_printer": {"1": {"class": "safe", "error": None}}}}


def inputs(pi=None, **kw):
    """GOOD with some sources replaced; pi= overrides fields of the pi-status reading."""
    out = dict(GOOD, **kw)
    if pi:
        out["pi_status"] = dict(PI, **pi)
    return out


def records_from(pi_status, bambuddy=None, net=None, now=T, **other):
    """The records the hub would hold after one refresh with these answers (other sources: None unless given)."""
    from hub import things
    answers = {"bambuddy": bambuddy, "pi_status": pi_status, "netmon": net, "lab": None, "sessions": None,
               "paper": None, "weather": None, "adguard": None, "backups": None, "camera": None, **other}
    built = things.build_all(answers, {}, now)
    return {id: records.merge(None, rec, now) for id, rec in built.items() if rec is not None}
