from fastapi.testclient import TestClient

from hub import app as hub_app, sources
from hub.things import network
from tests.helpers_records import T, merged

NOW = 1_000_000


def test_internet_states():
    assert network.internet(None) is None
    assert network.internet({"status": "ok", "wan_ms": 20, "dns_ms": 30})["headline"] == "Internet OK"
    assert network.internet({"status": "bad"})["state"] == "down"
    assert network.internet({"status": "bad"})["headline"] == "Internet down"
    assert network.internet({"status": "unknown"})["state"] == "unknown"
    assert network.internet({})["headline"] == "No reading"
    assert network.internet("x")["state"] == "unknown"


def test_internet_slow_is_strictly_over_100_and_ignores_none():
    assert network.internet({"status": "ok", "wan_ms": 100, "dns_ms": 100})["state"] == "ok"
    assert network.internet({"status": "ok", "wan_ms": 101, "dns_ms": 5})["state"] == "slow"
    assert network.internet({"status": "ok", "wan_ms": None, "dns_ms": 150})["headline"] == "Internet slow"
    assert network.internet({"status": "ok", "wan_ms": None, "dns_ms": None})["state"] == "ok"


def test_adguard():
    assert network.adguard(None) is None
    r = network.adguard({"ok": True, "queries": 200, "blocked": 50})
    assert r["state"] == "blocking" and r["headline"] == "Blocking ads: 50 of 200 today"
    d = network.adguard({"ok": False, "message": "x"})
    assert d["state"] == "not_answering" and d["headline"] == "AdGuard isn't answering"
    assert d["cause"] == "Ad blocking is off for the house until it answers."
    down = network.adguard({"ok": False, "message": "The hub's helper isn't running."})
    assert down["state"] == "unknown" and down["headline"] == "No reading"
    assert down["cause"] == "The hub's helper isn't running."
    assert network.adguard({"ok": True})["state"] == "unknown"
    assert network.adguard({"ok": True, "queries": "a", "blocked": 1})["state"] == "unknown"


def test_adguard_down_is_a_problem_even_when_the_internet_is_ok():
    net = merged(network.internet({"status": "ok", "wan_ms": 10, "dns_ms": 10}))
    ag = merged(network.adguard({"ok": False}))
    assert net["state"] == "ok" and net["severity"] == "ok"
    assert ag["state"] == "not_answering" and ag["severity"] == "attention"


def test_backups_ok_and_behind():
    ok = network.backups({"ok": True, "ages": {"pi": NOW - 22 * 3600, "mac": NOW - 3600}}, NOW)
    assert ok["state"] == "ok" and ok["headline"] == "Backed up: Pi 22 h ago, Mac 1 h ago"
    assert [m["name"] for m in ok["detail"]["machines"]] == ["Pi", "Mac"]
    behind = network.backups({"ok": True, "ages": {"pi": NOW - 3600, "mac": NOW - 3 * 86400}}, NOW)
    assert behind["state"] == "behind" and behind["headline"] == "The Mac hasn't backed up for 3 days"
    never = network.backups({"ok": True, "ages": {"pi": None}}, NOW)
    assert never["state"] == "behind" and "never" in never["headline"].lower()
    assert network.backups({"ok": True, "ages": {"pi": NOW - 48 * 3600}}, NOW)["state"] == "ok"


def test_backups_unknown_and_none():
    assert network.backups(None, NOW) is None
    assert network.backups({"ok": True, "ages": {}}, NOW)["state"] == "unknown"
    r = network.backups({"ok": False, "message": "helper down"}, NOW)
    assert r["state"] == "unknown" and r["headline"] == "No reading" and r["cause"] == "helper down"
    assert network.backups({"ok": False}, NOW)["cause"] == ""


def test_camera():
    assert network.camera(None) is None
    assert network.camera({"ok": True})["headline"] == "Live from the MacBook"
    assert network.camera({"ok": True})["state"] == "live"
    r = network.camera({"ok": False, "reason": "liveview_off"})
    assert r["state"] == "no_picture" and r["cause"].startswith("LAN Only Liveview is off")
    assert network.camera({"ok": False, "reason": "printer_unreachable"})["cause"] == "The printer isn't answering on the network."
    assert network.camera({"ok": False, "reason": None})["cause"] == "Neither camera bridge has a picture."


def test_api_camera_body_is_unchanged(monkeypatch):
    body = {"ok": True, "source": "mac", "since": 5, "reason": None, "sources": {"mac": {"up": True, "fresh": True}}}
    monkeypatch.setattr(sources, "camera_health", lambda: body)
    assert TestClient(hub_app.app).get("/api/camera").json() == body


def test_api_camera_never_returns_null_on_a_bad_health_reply(monkeypatch):
    import io
    import urllib.request as ur
    monkeypatch.setattr(sources, "_printer_port_open", lambda port: False)
    c = TestClient(hub_app.app)
    for raw in (b"not json", b"[1, 2]"):
        sources._cache.clear()
        monkeypatch.setattr(ur, "urlopen", lambda *a, _raw=raw, **k: io.BytesIO(_raw))
        body = c.get("/api/camera").json()
        assert body["ok"] is False and body["source"] is None and body["sources"] == {}
        assert body["reason"] == "printer_unreachable"
    sources._cache.clear()
