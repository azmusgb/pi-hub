"""The home-mcp tools: read-only views of the home systems, trimmed to what an assistant needs."""
import time
from collections.abc import Callable
from typing import Any

import httpx
from mcp.server import MCPServer
from mcp.types import ToolAnnotations

from . import deploy, hub, logs, shell

READ_ONLY = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=True)
INSTRUCTIONS = (
    "Read-only views of the home systems. The Pi Hub (Raspberry Pi, 10.0.0.80) runs the household dashboard, "
    "printer telemetry for the Bambu X2D, and the Pi's services. Start with hub_now for what needs attention, then "
    "printer_status, pi_health, source_freshness or recent_alerts for detail. Before any Pi Hub or Local AI deploy, "
    "call deploy_state and stop if it lists blockers. logs reads bounded, redacted logs from a fixed list of "
    "services. A result with ok false names the source that failed and why; report it rather than guessing."
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


def _shaped(data: dict, errors: list[dict], path: str, lists: tuple[str, ...] = ()) -> dict:
    """The answer at path when it is an object (with each of lists a list, when present); otherwise {} and a
    bad_shape error naming the source, so a malformed answer never reads as "nothing to report". An answer that
    failed to arrive already has its own error."""
    if path not in data:
        return {}
    v, problem = data[path], None
    if not isinstance(v, dict):
        problem = f"expected an object, got {type(v).__name__}"
    else:
        wrong = [k for k in lists if k in v and not isinstance(v[k], list)]
        missing = [k for k in lists if k not in v]
        if wrong or missing:
            problem = "; ".join([f"{k} is not a list" for k in wrong] + [f"no {k}" for k in missing])
    if problem:
        errors.append({"source": f"pi-hub {path}", "error": "bad_shape", "detail": problem})
        return {}
    return v


def _release(r: dict) -> dict[str, Any]:
    """One release:<target> record (platform step 3), trimmed: what the target's own deploy reported and what Pi Hub
    derived from it, with the latest verification when a probe has checked it."""
    d = _obj(r.get("detail"))
    last, verified = _obj(d.get("last")), _obj(d.get("verified"))
    return {
        "target": d.get("target") or str(r.get("id", ""))[len("release:"):],
        **_pick(r, ("state", "severity", "headline")),
        "commit": d.get("commit"), "dirty": bool(d.get("dirty")), "mechanism": d.get("mechanism"),
        "deployed_at": hub.iso(d.get("deployed_at")),
        "last": {**_pick(last, ("result", "commit", "message")), "at": hub.iso(last.get("at"))} if last else None,
        "verified": {**_pick(verified, ("commit", "by")), "at": hub.iso(verified.get("at"))} if verified else None,
    }


def _result(source: str, errors: list[dict], **fields) -> dict[str, Any]:
    out = {"ok": not errors, "source": source, "as_of": hub.now_iso(), **fields}
    if errors:
        out["errors"] = errors
    return out


def build_server(client_factory: Callable[[], httpx.AsyncClient] = hub.make_client,
                 runner: deploy.Runner = shell.run) -> MCPServer:
    mcp = MCPServer("home", instructions=INSTRUCTIONS)

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def hub_now() -> dict[str, Any]:
        """What needs attention in the house right now: the hub's summary and issues, the printer's headline,
        network status, the open needs list, every record with its source, time and staleness, and any lasting
        disagreement between sources with what each source reports and since when."""
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/now", "/api/needs", "/api/records")
        now = _shaped(data, errors, "/api/now", ("issues",))
        needs = _shaped(data, errors, "/api/needs", ("items",))
        recs = _list(_shaped(data, errors, "/api/records", ("records",)), "records")
        since = _obj(_obj(next((r for r in recs if r.get("id") == "hub"), {}).get("detail")).get("disagree_since"))
        return _result(
            "pi-hub", errors,
            summary=now.get("summary"),
            issues=[_pick(i, ("tone", "what", "say")) for i in _list(now, "issues")],
            printer=_pick(now.get("printer"), ("state", "headline", "left", "stale")),
            network=_obj(now.get("network")).get("status"),
            needs=[_pick(n, ("source", "tone", "title", "detail", "as_of")) for n in _list(needs, "items")],
            records=[{**_pick(r, ("id", "state", "severity", "source", "stale")), "as_of": hub.iso(r.get("as_of"))}
                     for r in recs],
            disagreements=[{**_pick(r, ("id", "source", "state", "disagree")), "as_of": hub.iso(r.get("as_of")),
                            "since": hub.iso(since.get(r.get("id")))}
                           for r in recs if r.get("disagree")],
        )

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def printer_status(recent: int = 5) -> dict[str, Any]:
        """The Bambu X2D's live state (job, progress, temperatures, filament), the most recent prints
        (recent: 0-20), this week's totals, the workshop display, and spools marked low."""
        if not 0 <= recent <= 20:
            raise ValueError("recent must be between 0 and 20")
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/workshop")
        w = _shaped(data, errors, "/api/workshop")
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
        pi, backups = _shaped(data, errors, "/api/pi"), _shaped(data, errors, "/api/system/backups")
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
                          for o in _list(pi, "outages") if o.get("end") is None and o.get("ongoing", True)],
            backups=[{"name": b.get("name"), "last": hub.iso(b.get("last")), "hours_ago": b.get("hours")}
                     for b in _list(backups, "repos")],
        )

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def source_freshness(only_problems: bool = False) -> dict[str, Any]:
        """How fresh each hub data source is (printer, network, Plex, Homebridge and others): state, last
        reading, and whether it is older than its allowed age. only_problems keeps stale or failing sources."""
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/freshness")
        f = _shaped(data, errors, "/api/freshness", ("readings",))
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
        alerts = sorted(_list(_shaped(data, errors, "/api/alerts", ("alerts",)), "alerts"),
                        key=lambda a: a.get("ts") if isinstance(a.get("ts"), (int, float)) else 0, reverse=True)
        if since_hours is not None:
            cutoff = time.time() - since_hours * 3600
            alerts = [a for a in alerts if isinstance(a.get("ts"), (int, float)) and a["ts"] >= cutoff]
        if tag:
            alerts = [a for a in alerts if a.get("tag") == tag]
        return _result("pi-hub /api/alerts", errors, total=len(alerts),
                       alerts=[{"at": hub.iso(a.get("ts")), **_pick(a, ("tag", "title", "body"))}
                               for a in alerts[:limit]])

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def releases() -> dict[str, Any]:
        """What is live where: Pi Hub's release:<target> records, the canonical deployment state that each target's
        own deploy writes (pi-hub, localai, firmware, netmon, mac-watch, x2d-bridge-mac). Each has its state (live,
        behind, ahead, unknown, drifted), commit, the last deploy's result and message, and the latest verification by
        a probe. Read this first; deploy_state's live readings only verify it."""
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/records")
        recs = _list(_shaped(data, errors, "/api/records", ("records",)), "records")
        return _result("pi-hub /api/records", errors,
                       releases=[_release(r) for r in recs if str(r.get("id", "")).startswith("release:")])

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def deploy_state(target: str, intended: str | None = None) -> dict[str, Any]:
        """Deploy preflight for target pi-hub or localai. record is Pi Hub's release:<target> record, the deployment
        truth; live is read from the target itself and only verifies it (a mismatch is a warning). Also: the intended commit
        (pi-hub: a ref in the local checkout, default main; localai: an optional SHA), GitHub's heads, what the
        target's repository holds, the running release and its health, and for localai the PC checkout and the
        LocalAI Safe Deploy task. ready is false when blockers is non-empty: another session advanced the target,
        a release is pending or failed, the PC checkout is dirty, or a source couldn't be read. For pi-hub, ready is for a
        release by `git push pi <sha>:main`, which ships only the commit; checkout reports the local working tree as facts
        (clean, dirty or unknown), and install_sh says separately whether deploy/install.sh would run. Never changes
        anything."""
        out = await deploy.deploy_state(runner, target, intended)
        # Platform step 4: Pi Hub's release record is the deployment truth; live (read over SSH) only verifies it.
        async with client_factory() as c:
            data, errors = await hub.gather(c, "/api/records")
        recs = _list(_shaped(data, errors, "/api/records", ("records",)), "records")
        rec = next((r for r in recs if r.get("id") == f"release:{target}"), None)
        out["record"] = _release(rec) if rec else None
        out["live_is"] = "verification: read from the target itself and checked against record"
        running, recorded = _obj(out.get("live")).get("sha"), (out["record"] or {}).get("commit")
        if errors:
            out["warnings"].append(f"couldn't read Pi Hub's release:{target} record ({errors[0]['error']})")
        elif rec is None:
            out["warnings"].append(f"Pi Hub has no release:{target} record")
        elif running and recorded and not deploy._same(running, recorded):
            out["warnings"].append(f"the release record says {recorded[:10]}, but the target runs {running[:10]}")
        return out

    @mcp.tool(annotations=READ_ONLY, structured_output=True)
    async def service_logs(service: str, minutes: int = 60, lines: int = 100, contains: str | None = None) -> dict[str, Any]:
        """Recent log lines, newest last, for one allowlisted service: Pi units (pi-hub, pi-hub-helper,
        pi-hub-selfcheck, pi-hub-backup, pi-hub-rollback, pi-status, caddy, x2d-camera-bridge, x2d-camera-failover)
        or Local AI on the PC (localai, localai-https, localai-sandbox, localai-ollama-proxy, localai-deploy).
        minutes 1-1440 (ignored for localai-deploy, a file), lines 1-500, contains filters case-insensitively.
        Secrets are redacted and output is capped at 20 KB."""
        return await logs.logs(runner, service, minutes, lines, contains)

    return mcp
