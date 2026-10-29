# Normalize X2D telemetry into one stable UI/API contract.
from __future__ import annotations

import datetime as _dt
import math
from typing import Any


_STATE_MAP = {
    "printing": "printing",
    "running": "printing",
    "paused": "paused",
    "pause": "paused",
    "error": "error",
    "failed": "error",
    "stopped": "stopped",
    "cancelled": "stopped",
    "canceled": "stopped",
    "idle": "idle",
    "finish": "idle",
    "finished": "idle",
    "completed": "idle",
    "not set up": "none",
    "offline": "offline",
    "disconnected": "offline",
}


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _int(value: Any) -> int | None:
    number = _number(value)
    return int(round(number)) if number is not None else None


def _bounded_percent(value: Any) -> int:
    number = _number(value)
    if number is None:
        return 0
    return max(0, min(100, int(round(number))))


def _first(*values: Any) -> Any:
    for value in values:
        if value not in (None, ""):
            return value
    return None


def _state(pi: dict[str, Any], bambuddy: dict[str, Any]) -> tuple[str, str | None]:
    raw = _first(
        pi.get("x2d_state"),
        bambuddy.get("bambuddy_state"),
        bambuddy.get("state"),
    )
    if raw is None:
        if bambuddy and bambuddy.get("connected") is False:
            return "offline", None
        return "none", None
    text = str(raw).strip()
    return _STATE_MAP.get(text.lower(), "none"), text


def _source_status(pi: dict[str, Any], bambuddy: dict[str, Any]) -> tuple[str, str]:
    if bambuddy and bambuddy.get("connected") is True:
        return "live", "Bambuddy + Pi status" if pi else "Bambuddy"
    if pi:
        return "degraded", "Pi status"
    if bambuddy:
        return "offline", "Bambuddy"
    return "offline", "No source"


def normalize_printer(
    pi_status: dict[str, Any] | None,
    bambuddy_status: dict[str, Any] | None,
    *,
    observed_at: _dt.datetime | None = None,
) -> dict[str, Any]:
    pi = pi_status if isinstance(pi_status, dict) else {}
    bambuddy = bambuddy_status if isinstance(bambuddy_status, dict) else {}

    state, raw_state = _state(pi, bambuddy)
    source_status, source_label = _source_status(pi, bambuddy)

    progress = _bounded_percent(
        _first(bambuddy.get("progress"), pi.get("x2d_progress"))
    )
    minutes_left = _int(
        _first(bambuddy.get("minutes_left"), pi.get("x2d_minutes_left"))
    )
    left = _first(bambuddy.get("left"), pi.get("x2d_left"))
    error_code = _first(
        pi.get("x2d_error"),
        bambuddy.get("error_code"),
        bambuddy.get("error"),
    )

    nozzle_temp = _number(bambuddy.get("nozzle_temp"))
    nozzle_target = _number(bambuddy.get("nozzle_target"))
    bed_temp = _number(bambuddy.get("bed_temp"))
    bed_target = _number(bambuddy.get("bed_target"))
    layer_num = _int(bambuddy.get("layer_num"))
    total_layers = _int(bambuddy.get("total_layers"))

    if observed_at is None:
        observed_at = _dt.datetime.now(_dt.timezone.utc)
    elif observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=_dt.timezone.utc)

    observed_iso = (
        observed_at.astimezone(_dt.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z")
    )

    if state == "printing":
        headline = f"Printing, {progress}%"
        detail = ""
    elif state == "paused":
        headline = f"Paused at {progress}%"
        detail = "Resume it from the printer or Bambu Handy."
    elif state == "error":
        headline = "Needs attention"
        detail = (
            f"The printer reports {error_code}. Check its screen."
            if error_code
            else "Check the printer's screen."
        )
    elif state == "stopped":
        headline = "Last print stopped"
        detail = "Ready for the next one."
    elif state == "idle":
        headline = "Idle"
        detail = "Ready for the next print."
    elif state == "offline":
        headline = "Printer offline"
        detail = "The hub cannot confirm a live connection to the printer."
    elif str(pi.get("x2d_state") or "").strip().lower() == "not set up":
        headline = "Not connected"
        detail = "Printer status is not configured."
    else:
        headline = "No status right now"
        detail = "The hub has no current printer state."

    layer_percent = None
    if layer_num is not None and total_layers and total_layers > 0:
        layer_percent = max(
            0.0,
            min(100.0, round(layer_num * 100 / total_layers, 1)),
        )

    return {
        "state": state,
        "progress": progress,
        "headline": headline,
        "detail": detail,
        "left": left or "",
        "minutes_left": minutes_left,
        "nozzle_temp": nozzle_temp,
        "nozzle_target": nozzle_target,
        "bed_temp": bed_temp,
        "bed_target": bed_target,
        "ams_humidity": _int(bambuddy.get("ams_humidity")),
        "ams_temp": _number(bambuddy.get("ams_temp")),
        "layer_num": layer_num,
        "total_layers": total_layers,
        "job_name": _first(bambuddy.get("job_name")),
        "filament_type": _first(bambuddy.get("filament_type")),
        "filament_color": _first(bambuddy.get("filament_color")),
        "bambuddy_connected": bambuddy.get("connected") is True,
        "raw_state": raw_state,
        "error_code": str(error_code) if error_code not in (None, "") else None,
        "temperatures": {
            "nozzle": nozzle_temp,
            "nozzle_target": nozzle_target,
            "bed": bed_temp,
            "bed_target": bed_target,
        },
        "layer": {
            "current": layer_num,
            "total": total_layers,
            "percent": layer_percent,
        },
        "telemetry": {
            "status": source_status,
            "source": source_label,
            "observed_at": observed_iso,
        },
    }
