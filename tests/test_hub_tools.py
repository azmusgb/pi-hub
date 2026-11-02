"""Each tool through a real MCP client, against a mocked hub: success, trimming, validation and failures."""
import json
import time

import httpx
import pytest
from mcp import Client

from home_mcp import hub
from home_mcp.server import build_server

NOW = time.time()

FIXTURES = {
    "/api/now": {
        "summary": "2 small things to check",
        "issues": [{"tone": "warn", "what": "Raspberry Pi", "say": "Pi 64 °C.", "href": "/pi"}],
        "printer": {"state": "printing", "headline": "Printing TILE, 40%", "left": "1 h", "stale": False,
                    "nozzle_temp": 220.0},
        "network": {"status": "ok", "orbi_ms": 3.1},
        "movies": {"big": "ignored"},
    },
    "/api/needs": {"count": 1, "items": [{"id": "n1", "source": "lab", "tone": "warn", "title": "Dry filament",
                                          "detail": "AMS humid", "link": "/lab", "as_of": "2026-10-31T10:00"}]},
    "/api/records": {"as_of": NOW, "events": [], "records": [
        {"id": "printer", "state": "printing", "severity": "ok", "source": "bambuddy", "stale": False,
         "as_of": NOW - 5, "headline": "Printing", "detail": {"big": "x"},
         "disagree": "pi-status reports No status; Bambuddy reports printing"},
        {"id": "plex", "state": "idle", "severity": "ok", "source": "pi_status", "stale": True, "as_of": NOW - 900,
         "headline": "Idle", "disagree": ""},
        {"id": "hub", "state": "disagreement", "severity": "attention", "source": "hub", "stale": False,
         "as_of": NOW, "disagree": "", "detail": {"disagree_since": {"printer": NOW - 3000}}},
        {"id": "release:pi-hub", "state": "live", "severity": "ok", "source": "pi-hub-release", "stale": False,
         "as_of": NOW, "headline": "aaaaaaa is live", "disagree": "",
         "detail": {"target": "pi-hub", "label": "Pi Hub", "commit": "a" * 40, "mechanism": "pi-hub-release",
                    "deployed_at": NOW - 60, "last": {"commit": "a" * 40, "result": "deployed", "at": NOW - 60,
                                                      "message": "Tests passed."},
                    "verified": {"commit": "a" * 10, "at": NOW - 5, "by": "pi-hub current release"}}},
        {"id": "release:netmon", "state": "unknown", "severity": "info", "source": "release", "stale": False,
         "as_of": NOW, "headline": "Not publishing yet", "disagree": "",
         "detail": {"target": "netmon", "label": "netmon", "commit": None}},
    ]},
    "/api/workshop": {
        "printer": {"state": "printing", "headline": "Printing TILE", "progress": 40, "job_name": "TILE",
                    "temperatures": {"huge": "dict"}, "actions": ["pause"]},
        "prints": [{"id": i, "name": f"P{i}", "word": "Finished", "started": NOW - 7200, "ended": NOW - 3600,
                    "seconds": 3600, "error": None, "grams": None} for i in range(8)],
        "week": {"finished": 3, "hours": 9.5},
        "display": {"state": "online", "firmware": "1.2"},
        "spools": [{"id": 1, "material": "PLA", "colour": "Red", "brand": None, "grams_left": 40, "low": True},
                   {"id": 2, "material": "ABS", "colour": "Blue", "brand": None, "grams_left": 900, "low": False}],
    },
    "/api/pi": {
        "health": {"temp": 63.3, "power": "ok", "uptime_h": 12.0},
        "live": {"cpu_series": [1] * 500, "mem_free_gb": 2.1, "mem_total_gb": 8.0},
        "services": [{"unit": "pi-hub", "name": "Pi Hub", "what": "x", "state": "active"},
                     {"unit": "homebridge", "name": "Homebridge", "what": "x", "state": "failed"}],
        "storage": [{"name": "SD card", "mounted": True, "total_gb": 30.8, "free_gb": 12.8, "used_pct": 59}],
        "updates": [],
        "history": [{"ts": 1}] * 300,
        "selfcheck": {"ts": NOW, "passed": False, "total": 3, "failed": 1,
                      "checks": [{"name": "Page /", "ok": True, "detail": "95 ms"},
                                 {"name": "Plex", "ok": False, "detail": "timeout"}]},
        "outages": [{"what": "Homebridge", "start": NOW - 600, "end": None},
                    {"what": "Plex", "start": NOW - 9000, "end": NOW - 8000}],
    },
    "/api/system/backups": {"repos": [{"name": "hub", "last": NOW - 3600, "hours": 1}], "available": True},
    "/api/freshness": {"as_of": NOW, "readings": [
        {"key": "printer", "label": "X2D", "state": "current", "checked_at": NOW - 10, "max_age": 90,
         "reading": "Printing"},
        {"key": "plex", "label": "Plex", "state": "current", "checked_at": NOW - 4000, "max_age": 300,
         "reading": "Idle"},
        {"key": "cam", "label": "Camera", "state": "error", "checked_at": NOW - 5, "max_age": 60, "reading": "?"},
    ]},
    "/api/alerts": {"alerts": [
        {"ts": NOW - 60, "title": "Display offline", "body": "b", "tag": "warning"},
        {"ts": NOW - 7200, "title": "Print done", "body": "b", "tag": "info"},
        {"ts": NOW - 30, "title": "Newest", "body": "b", "tag": "warning"},
    ]},
}


def factory(handler):
    return lambda: hub.make_client(httpx.MockTransport(handler))


def serve(fixtures=FIXTURES, status=None):
    def handler(request):
        path = request.url.path
        if status and path in status:
            return httpx.Response(status[path], json={"detail": "nope"})
        if path not in fixtures:
            return httpx.Response(404)
        body = fixtures[path]
        return httpx.Response(200, text=body) if isinstance(body, str) else httpx.Response(200, json=body)
    return factory(handler)


async def call(server, tool, args=None):
    async with Client(server) as client:
        result = await client.call_tool(tool, args or {})
    return result


async def data(server, tool, args=None):
    result = await call(server, tool, args)
    assert not result.is_error, result.content
    return result.structured_content


async def test_lists_read_only_tools():
    async with Client(build_server(serve())) as client:
        tools = (await client.list_tools()).tools
    assert sorted(t.name for t in tools) == sorted(
        ["hub_now", "printer_status", "pi_health", "source_freshness", "recent_alerts", "releases", "deploy_state", "service_logs"])
    assert all(t.annotations.read_only_hint for t in tools)


async def test_hub_now_combines_now_and_needs_and_trims():
    d = await data(build_server(serve()), "hub_now")
    assert d["ok"] is True and d["summary"] == "2 small things to check"
    assert d["issues"] == [{"tone": "warn", "what": "Raspberry Pi", "say": "Pi 64 °C."}]
    assert d["printer"] == {"state": "printing", "headline": "Printing TILE, 40%", "left": "1 h", "stale": False}
    assert d["network"] == "ok"
    assert d["needs"][0]["title"] == "Dry filament" and "link" not in d["needs"][0]
    assert "movies" not in json.dumps(d) and "detail" not in json.dumps(d["records"])


async def test_hub_now_keeps_staleness_and_disagreements_explicit():
    d = await data(build_server(serve()), "hub_now")
    by_id = {r["id"]: r for r in d["records"]}
    assert by_id["plex"]["stale"] is True and by_id["printer"]["stale"] is False
    assert by_id["plex"]["source"] == "pi_status" and by_id["plex"]["as_of"].startswith("20")
    [dis] = d["disagreements"]
    assert dis["id"] == "printer" and dis["source"] == "bambuddy"
    assert dis["disagree"] == "pi-status reports No status; Bambuddy reports printing"
    assert dis["since"] < dis["as_of"]


async def test_hub_now_partial_failure_keeps_what_worked():
    d = await data(build_server(serve(status={"/api/needs": 500})), "hub_now")
    assert d["ok"] is False and d["summary"] == "2 small things to check" and d["needs"] == []
    assert d["records"]
    assert d["errors"] == [{"source": "pi-hub /api/needs", "error": "http", "detail": "HTTP 500"}]


async def test_printer_status_limits_prints_and_lists_low_spools():
    d = await data(build_server(serve()), "printer_status", {"recent": 3})
    assert len(d["recent_prints"]) == 3 and d["recent_prints"][0]["started"].startswith("20")
    assert "temperatures" not in d["printer"] and d["printer"]["progress"] == 40
    assert d["low_spools"] == [{"id": 1, "material": "PLA", "colour": "Red", "brand": None, "grams_left": 40}]
    assert d["week"] == {"finished": 3, "hours": 9.5}


@pytest.mark.parametrize("recent", [-1, 21])
async def test_printer_status_rejects_out_of_range(recent):
    result = await call(build_server(serve()), "printer_status", {"recent": recent})
    assert result.is_error


async def test_pi_health_drops_series_and_flags_failures():
    d = await data(build_server(serve()), "pi_health")
    text = json.dumps(d)
    assert "cpu_series" not in text and "history" not in text
    assert d["memory"] == {"mem_free_gb": 2.1, "mem_total_gb": 8.0}
    assert {"unit": "homebridge", "name": "Homebridge", "state": "failed"} in d["services"]
    assert d["selfcheck"]["failing"] == [{"name": "Plex", "detail": "timeout"}]
    assert [o["what"] for o in d["open_outages"]] == ["Homebridge"]
    assert d["backups"][0]["hours_ago"] == 1


async def test_source_freshness_marks_stale_and_filters():
    d = await data(build_server(serve()), "source_freshness")
    by_key = {r["key"]: r for r in d["readings"]}
    assert by_key["printer"]["stale"] is False and by_key["plex"]["stale"] is True
    assert by_key["plex"]["age_seconds"] == 4000
    problems = await data(build_server(serve()), "source_freshness", {"only_problems": True})
    assert sorted(r["key"] for r in problems["readings"]) == ["cam", "plex"]


async def test_recent_alerts_sorts_filters_and_limits():
    d = await data(build_server(serve()), "recent_alerts", {"limit": 2})
    assert [a["title"] for a in d["alerts"]] == ["Newest", "Display offline"] and d["total"] == 3
    d = await data(build_server(serve()), "recent_alerts", {"since_hours": 1})
    assert d["total"] == 2
    d = await data(build_server(serve()), "recent_alerts", {"tag": "info"})
    assert [a["title"] for a in d["alerts"]] == ["Print done"]


@pytest.mark.parametrize("args", [{"limit": 0}, {"limit": 101}, {"since_hours": 0}])
async def test_recent_alerts_rejects_bad_arguments(args):
    assert (await call(build_server(serve()), "recent_alerts", args)).is_error


async def test_unreachable_hub_is_a_structured_failure():
    def handler(request):
        raise httpx.ConnectError("connection refused", request=request)
    d = await data(build_server(factory(handler)), "pi_health")
    assert d["ok"] is False and d["services"] == [] and d["health"] is None
    assert {e["error"] for e in d["errors"]} == {"unreachable"}
    assert len(d["errors"]) == 2


async def test_timeout_and_bad_json_are_named():
    def handler(request):
        if request.url.path == "/api/now":
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(200, text="<html>not json</html>")
    d = await data(build_server(factory(handler)), "hub_now")
    errors = {e["source"]: e for e in d["errors"]}
    assert errors["pi-hub /api/now"]["detail"] == "timed out"
    assert errors["pi-hub /api/needs"]["error"] == "bad_json"


async def test_unexpected_shapes_do_not_crash():
    weird = {p: [] for p in FIXTURES} | {"/api/pi": {"live": None, "selfcheck": "x", "services": "nope"}}
    for tool in ("hub_now", "printer_status", "pi_health", "source_freshness", "recent_alerts"):
        d = await data(build_server(serve(weird)), tool)
        assert d["source"].startswith("pi-hub")


def test_iso_handles_bad_values():
    assert hub.iso(None) is None and hub.iso("x") is None and hub.iso(True) is None
    assert hub.iso(0).startswith("19")


def test_make_client_uses_env(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME_MCP_HUB_URL", "https://example.test/")
    monkeypatch.setenv("HOME_MCP_TIMEOUT", "not-a-number")
    monkeypatch.setenv("HOME_MCP_HUB_CA", str(tmp_path / "missing.crt"))
    client = hub.make_client()
    assert str(client.base_url) == "https://example.test" and client.timeout.read == 10.0


def test_make_client_defaults_to_the_hub_real_name(monkeypatch):
    for name in ("HOME_MCP_HUB_URL", "HOME_MCP_HUB_CA", "HOME_MCP_TIMEOUT"):
        monkeypatch.delenv(name, raising=False)
    assert str(hub.make_client().base_url) == "https://hub.rahe-home.duckdns.org"


async def test_a_moved_hub_is_named_not_bad_json():
    def handler(request):
        return httpx.Response(308, headers={"location": f"https://new.example{request.url.path}"})
    d = await data(build_server(factory(handler)), "hub_now")
    errors = {e["source"]: e for e in d["errors"]}
    assert errors["pi-hub /api/now"] == {"source": "pi-hub /api/now", "error": "http",
                                         "detail": "HTTP 308 to https://new.example/api/now"}


# --- Review of 31 Oct 2026: a malformed answer is an error, never "nothing needs attention" --------------------

async def test_hub_now_arrays_where_objects_belong_are_schema_errors():
    bad = {**FIXTURES, "/api/now": [], "/api/needs": [], "/api/records": []}
    d = await data(build_server(serve(fixtures=bad)), "hub_now")
    assert d["ok"] is False
    assert sorted(e["source"] for e in d["errors"] if e["error"] == "bad_shape") == [
        "pi-hub /api/needs", "pi-hub /api/now", "pi-hub /api/records"]


async def test_hub_now_keeps_good_sources_beside_a_schema_error():
    bad = {**FIXTURES, "/api/needs": {"items": "not a list"}}
    d = await data(build_server(serve(fixtures=bad)), "hub_now")
    assert d["ok"] is False and d["summary"] == "2 small things to check" and d["records"]
    assert [e["source"] for e in d["errors"]] == ["pi-hub /api/needs"]


@pytest.mark.parametrize("tool,path", [("printer_status", "/api/workshop"), ("pi_health", "/api/pi"),
                                       ("source_freshness", "/api/freshness"), ("recent_alerts", "/api/alerts")])
async def test_every_tool_reports_a_wrong_shape(tool, path):
    d = await data(build_server(serve(fixtures={**FIXTURES, path: ["unexpected"]})), tool)
    assert d["ok"] is False and any(e["source"] == f"pi-hub {path}" and e["error"] == "bad_shape" for e in d["errors"])


async def test_releases_lists_every_release_record_trimmed():
    d = await data(build_server(serve()), "releases")
    assert d["ok"] is True and [r["target"] for r in d["releases"]] == ["pi-hub", "netmon"]
    pi = d["releases"][0]
    assert (pi["state"], pi["commit"], pi["mechanism"], pi["dirty"]) == ("live", "a" * 40, "pi-hub-release", False)
    assert pi["last"]["result"] == "deployed" and pi["last"]["message"] == "Tests passed." and pi["last"]["at"]
    assert pi["verified"]["by"] == "pi-hub current release"
    assert d["releases"][1]["last"] is None and d["releases"][1]["state"] == "unknown"


async def test_releases_hub_down_is_an_error_not_an_empty_list():
    d = await data(build_server(serve(status={"/api/records": 502})), "releases")
    assert d["ok"] is False and d["releases"] == [] and d["errors"][0]["source"] == "pi-hub /api/records"


def _fixtures_with(commit):
    recs = [dict(r) for r in FIXTURES["/api/records"]["records"]]
    for r in recs:
        if r["id"] == "release:pi-hub":
            r["detail"] = {**r["detail"], "commit": commit}
    return {**FIXTURES, "/api/records": {**FIXTURES["/api/records"], "records": recs}}


async def test_deploy_state_carries_the_record_and_labels_live_as_verification():
    from test_deploy_logs import FakeHosts, LIVE
    d = await data(build_server(serve(_fixtures_with(LIVE)), runner=FakeHosts()), "deploy_state", {"target": "pi-hub"})
    assert d["record"]["commit"] == LIVE and d["live_is"].startswith("verification")
    assert not [w for w in d["warnings"] if "release record" in w]


async def test_deploy_state_warns_when_the_record_and_the_target_disagree():
    from test_deploy_logs import FakeHosts
    d = await data(build_server(serve(_fixtures_with("b" * 40)), runner=FakeHosts()), "deploy_state", {"target": "pi-hub"})
    assert any(w.startswith("the release record says bbbbbbbbbb, but the target runs") for w in d["warnings"])
    assert d["ready"] is True, "a disagreement is a warning; the preflight's own blockers decide readiness"


async def test_deploy_state_without_a_record_or_the_hub_says_so():
    from test_deploy_logs import FakeHosts
    d = await data(build_server(serve(), runner=FakeHosts()), "deploy_state", {"target": "localai"})
    assert d["record"] is None and "Pi Hub has no release:localai record" in d["warnings"]
    d = await data(build_server(serve(status={"/api/records": 503}), runner=FakeHosts()), "deploy_state", {"target": "localai"})
    assert d["record"] is None and any("couldn't read Pi Hub's release:localai record" in w for w in d["warnings"])
