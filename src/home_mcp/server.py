"""The home-mcp tools: read-only views of the Pi Hub, trimmed to what an assistant needs."""
import time
from collections.abc import Callable
from typing import Any

import httpx
from mcp.server import MCPServer
from mcp.types import ToolAnnotations

from . import hub

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=True)
INSTRUCTIONS = (
    "Read-only views of the home systems. The Pi Hub (Raspberry Pi, 10.0.0.30) runs the household dashboard, "
    "printer telemetry for the Bambu X2D, and the Pi's services. Start with hub_now for what needs attention, then "
    "printer_status, pi_health, source_freshness or recent_alerts for detail. A result with ok false names the "
    "source that failed and why; report it rather than guessing."
)

PRINTER_KEYS = ("state", "headline", "progress", "left", "minutes_left", "detail", "stale", "job_name",
                "layer_num", "total_layers", "nozzle_temp", "nozzle_target", "bed_temp", "bed_target",
                "filament_type", "filament_color", "ams_humidity", "bambuddy_connected")


def _obj(v) -> dict:
    return v if isinstance(v, dict) else {}


def _pick(d, keys) -> dict[str, Any]:
    return {k: d.get(k) for k in keys} if isinstance(d, dict) else {}


def _list(d, key) -> list:
    v = d.get(key) if isinstance(d, dict) else None
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _result(source: str, errors: list[dict], **fields) -> dict[str, Any]:
    out = {"ok": not errors, "source": source, "as_of": hub.now_iso(), **fields}
    if errors:
        out["errors"] = errors
    return out


def build_server(client_factory: Callable[[], httpx.AsyncClient] = hub.make_client) -> MCPServer:
    mcp = MCPServer("home", instructions=INSTRUCTIONS)

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def hub_now() -> dict[str, Any]:
        """What needs attention in the house right now: the hub's summary and issues, the printer's headline,
        network status, and the open needs list."""
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/now", "/api/needs")
        now, needs = _obj(data.get("/api/now")), _obj(data.get("/api/needs"))
        return _result(
            "pi-hub", errors,
            summary=now.get("summary"),
            issues=[_pick(i, ("tone", "what", "say")) for i in _list(now, "issues")],
            printer=_pick(now.get("printer"), ("state", "headline", "left", "stale")),
            network=_obj(now.get("network")).get("status"),
            needs=[_pick(n, ("source", "tone", "title", "detail", "as_of")) for n in _list(needs, "items")],
        )

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def printer_status(recent: int = 5) -> dict[str, Any]:
        """The Bambu X2D's live state (job, progress, temperatures, filament), the most recent prints
        (recent: 0-20), this week's totals, the workshop display, and spools marked low."""
        if not 0 <= recent <= 20:
            raise ValueError("recent must be between 0 and 20")
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/workshop")
        w = _obj(data.get("/api/workshop"))
        prints = [
            {**_pick(p, ("id", "name", "word", "seconds", "error")),
             "started": hub.iso(p.get("started")), "ended": hub.iso(p.get("ended"))}
            for p in _list(w, "prints")[:recent]
        ]
        return _result(
            "pi-hub /api/workshop", errors,
            printer=_pick(w.get("printer"), PRINTER_KEYS),
            recent_prints=prints,
            week=w.get("week"),
            display=w.get("display"),
            low_spools=[_pick(s, ("id", "material", "colour", "brand", "grams_left"))
                        for s in _list(w, "spools") if s.get("low")],
        )

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def pi_health() -> dict[str, Any]:
        """The Raspberry Pi's health: temperature, power, uptime, memory, each service's state, storage,
        pending updates, the latest self-check with any failing checks, open outages, and backup ages."""
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/pi", "/api/system/backups")
        pi, backups = _obj(data.get("/api/pi")), _obj(data.get("/api/system/backups"))
        live = _obj(pi.get("live"))
        check = _obj(pi.get("selfcheck"))
        return _result(
            "pi-hub", errors,
            health=pi.get("health"),
            memory=_pick(live, ("mem_free_gb", "mem_total_gb")),
            services=[_pick(s, ("unit", "name", "state")) for s in _list(pi, "services")],
            storage=[_pick(s, ("name", "mounted", "free_gb", "total_gb", "used_pct")) for s in _list(pi, "storage")],
            updates=_list(pi, "updates"),
            selfcheck={**_pick(check, ("passed", "total", "failed")), "at": hub.iso(check.get("ts")),
                       "failing": [_pick(x, ("name", "detail")) for x in _list(check, "checks") if not x.get("ok")]},
            open_outages=[{"what": o.get("what"), "since": hub.iso(o.get("start"))}
                          for o in _list(pi, "outages") if o.get("end") is None],
            backups=[{"name": b.get("name"), "last": hub.iso(b.get("last")), "hours_ago": b.get("hours")}
                     for b in _list(backups, "repos")],
        )

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def source_freshness(only_problems: bool = False) -> dict[str, Any]:
        """How fresh each hub data source is (printer, network, Plex, Homebridge and others): state, last
        reading, and whether it is older than its allowed age. only_problems keeps stale or failing sources."""
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/freshness")
        f = _obj(data.get("/api/freshness"))
        as_of = f.get("as_of")
        readings = []
        for r in _list(f, "readings"):
            age = None
            if isinstance(as_of, (int, float)) and isinstance(r.get("checked_at"), (int, float)):
                age = round(as_of - r["checked_at"])
            max_age = r.get("max_age")
            stale = age is not None and isinstance(max_age, (int, float)) and age > max_age
            readings.append({**_pick(r, ("key", "label", "state", "reading", "max_age")),
                             "age_seconds": age, "stale": stale})
        if only_problems:
            readings = [r for r in readings if r["stale"] or r["state"] not in ("current", "not_configured")]
        return _result("pi-hub /api/freshness", errors, readings=readings)

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def recent_alerts(limit: int = 20, since_hours: float | None = None, tag: str | None = None) -> dict[str, Any]:
        """The hub's alert history, newest first (limit: 1-100). since_hours keeps alerts from the last N hours;
        tag keeps one kind (for example warning)."""
        if not 1 <= limit <= 100:
            raise ValueError("limit must be between 1 and 100")
        if since_hours is not None and since_hours <= 0:
            raise ValueError("since_hours must be positive")
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/alerts")
        alerts = sorted(_list(_obj(data.get("/api/alerts")), "alerts"),
                        key=lambda a: a.get("ts") if isinstance(a.get("ts"), (int, float)) else 0, reverse=True)
        if since_hours is not None:
            cutoff = time.time() - since_hours * 3600
            alerts = [a for a in alerts if isinstance(a.get("ts"), (int, float)) and a["ts"] >= cutoff]
        if tag:
            alerts = [a for a in alerts if a.get("tag") == tag]
        return _result("pi-hub /api/alerts", errors, total=len(alerts),
                       alerts=[{"at": hub.iso(a.get("ts")), **_pick(a, ("tag", "title", "body"))}
                               for a in alerts[:limit]])

    return mcp
