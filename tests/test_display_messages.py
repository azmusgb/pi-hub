"""Banners and the heartbeat: Pi Hub's own channel to the workshop display."""
import os
import tempfile
from datetime import datetime
from zoneinfo import ZoneInfo

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("DISP-4321\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, db, display_messages  # noqa: E402
from hub import app as hub_app  # noqa: E402
from hub.things import house  # noqa: E402

SAME = {"Origin": "http://testserver"}
NOON = datetime(2026, 10, 31, 12, 0, tzinfo=ZoneInfo("America/New_York")).timestamp()
LATE = datetime(2026, 10, 31, 23, 30, tzinfo=ZoneInfo("America/New_York")).timestamp()


@pytest.fixture
def env(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    monkeypatch.setenv("TZ", "America/New_York")
    display_messages._sends.clear()
    auth._tries.clear()
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "DISP-4321", "owner_password": "long enough", "pin": "123456"},
                  headers=SAME).status_code == 200
    return c


def paired(c):
    code = c.post("/api/display/pair/start", headers=SAME).json()["code"]
    key = TestClient(hub_app.app).post("/api/display/pair", json={"code": code}, headers=SAME).json()["key"]
    return {"X-Hub-Display-Key": key, **SAME}


def test_notify_rate_limit(env):
    for n in range(6):
        assert env.post("/api/display/notify", json={"title": f"t{n}"}, headers=SAME).status_code == 200
    r = env.post("/api/display/notify", json={"title": "seventh"}, headers=SAME)
    assert r.status_code == 429
    display_messages._sends.clear()
    assert env.post("/api/display/notify", json={"title": "again"}, headers=SAME).status_code == 200


def test_rate_limit_window_is_a_minute(env):
    for n in range(6):
        display_messages.post(f"t{n}", now=NOON)
    with pytest.raises(display_messages.Refused):
        display_messages.post("x", now=NOON + 59)
    assert display_messages.post("x", now=NOON + 61)


def test_messages_expire_after_15_minutes(env):
    display_messages.post("old", now=NOON)
    assert [m["title"] for m in display_messages.pending(NOON + 14 * 60)] == ["old"]
    assert display_messages.pending(NOON + 15 * 60 + 1) == []


def test_seq_only_grows_even_across_a_clock_step_back(env):
    a = display_messages.post("a", now=NOON)
    b = display_messages.post("b", now=NOON - 100)
    assert b > a
    assert [m["seq"] for m in display_messages.pending(NOON)] == [a, b]


def test_quiet_hours_chime_only_failures(env):
    display_messages.post("day", chime=True, now=NOON)
    assert display_messages.pending(NOON)[0]["chime"] is True
    display_messages.post("night", chime=True, now=LATE)
    display_messages.post("fail", tone="warning", chime=True, now=LATE + 1)
    got = {m["title"]: m for m in display_messages.pending(LATE + 2)}
    assert got["night"]["chime"] is False and got["fail"]["chime"] is True


def test_message_shape_and_validation(env):
    display_messages.post("T" * 40, "x " * 100, tone="bogus", chime=True, action={"type": "timer", "minutes": 5}, now=NOON)
    m = display_messages.pending(NOON)[0]
    assert list(m) == ["seq", "title", "text", "tone", "chime", "action", "at"]
    assert len(m["title"]) == 24 and len(m["text"]) <= 120 and m["tone"] == "info"
    assert m["action"] == {"type": "timer", "minutes": 5} and m["at"] == int(NOON)
    for bad in ({"type": "timer", "minutes": 0}, {"type": "timer", "minutes": 241}, {"type": "show", "page": "x"}, {}):
        with pytest.raises(ValueError):
            display_messages.post("t", action=bad, now=NOON)
    with pytest.raises(ValueError):
        display_messages.post("  ", now=NOON)


def test_notify_who_may_send(env, monkeypatch):
    anon = TestClient(hub_app.app)
    assert anon.post("/api/display/notify", json={"title": "x"}, headers=SAME).status_code == 401
    assert anon.post("/api/display/notify", json={"title": "x"}, headers=paired(env)).status_code == 200
    monkeypatch.setattr("hub.lab_guard.mac_key_ok", lambda request: True)
    assert anon.post("/api/display/notify", json={"title": "mac"}, headers=SAME).status_code == 200
    assert env.post("/api/display/notify", json={"title": "bad", "action": {"type": "zap"}}, headers=SAME).status_code == 400
    row = db.one("SELECT device, action, result FROM action_log WHERE action = 'display:notify' ORDER BY rowid DESC")
    assert row["device"] == "Workshop display"


def test_feed_merges_banners_with_ai_messages_capped(env):
    import time
    from hub import display_routes
    now = time.time()
    for n in range(5):
        display_messages.post(f"hub{n}", "z" * 300 if n == 0 else "", now=now - 10 + n)
    ai = {"messages": [{"seq": 1, "title": "ai1", "text": "", "tone": "info", "chime": False, "action": None, "at": int(now) - 5},
                       {"seq": 2, "title": "ai2", "text": "", "tone": "info", "chime": False, "action": None, "at": int(now) - 1}]}
    orig = display_routes.display_ai.cards
    display_routes.display_ai.cards = lambda n: {**orig(n), "messages": ai["messages"]}
    try:
        msgs = display_routes.feed_now()["messages"]
    finally:
        display_routes.display_ai.cards = orig
    assert len(msgs) == 6
    ats = [m["at"] for m in msgs]
    assert ats == sorted(ats)
    assert {m["title"] for m in msgs} >= {"ai2", "hub4"}
    assert all(len(m["text"]) <= 120 for m in msgs)


def test_heartbeat_needs_the_display_key(env):
    anon = TestClient(hub_app.app)
    assert anon.post("/api/display/heartbeat", json={"version": "1"}, headers=SAME).status_code == 401
    assert env.post("/api/display/heartbeat", json={"version": "1"}, headers=SAME).status_code == 401  # owner isn't the display
    assert display_messages.last_heartbeat() is None


def test_heartbeat_updates_the_display_record(env):
    body = {"version": "v11.7", "sourceSha": "abc", "uptimeS": 5, "rssi": -60, "heapFree": 1, "psramFree": 2,
            "camera": "ok", "junk": "dropped"}
    assert TestClient(hub_app.app).post("/api/display/heartbeat", json=body, headers=paired(env)).status_code == 200
    beat = display_messages.last_heartbeat()
    assert beat["version"] == "v11.7" and "junk" not in beat
    # the Pi's status service says offline, but the fresher heartbeat wins
    rec = house.workshop_display({"display_state": "Offline", "display_firmware": "old"})
    assert rec["state"] == "online" and rec["detail"]["firmware"] == "v11.7"
    # and with the status service silent
    assert house.workshop_display(None)["state"] == "online"
    # an old heartbeat is ignored: the existing source speaks again
    display_messages.store_heartbeat(beat, 1000)
    assert display_messages.last_heartbeat() is None
    assert house.workshop_display({"display_state": "Offline"})["state"] == "offline"
    assert house.workshop_display(None) is None


def test_heartbeat_is_not_logged_and_is_hardened(env):
    c, h = TestClient(hub_app.app), paired(env)
    before = db.one("SELECT COUNT(*) AS n FROM action_log")["n"]
    r = c.post("/api/display/heartbeat", json={"version": {"a": [1]}, "sourceSha": "s" * 500, "uptimeS": "x",
                                               "rssi": -61.7, "heapFree": True, "psramFree": 9, "camera": "c" * 99,
                                               "extra": 1}, headers=h)
    assert r.status_code == 200
    assert db.one("SELECT COUNT(*) AS n FROM action_log")["n"] == before
    beat = display_messages.last_heartbeat()
    assert beat == {"sourceSha": "s" * 64, "rssi": -61, "psramFree": 9, "camera": "c" * 32}
    assert c.post("/api/display/heartbeat", json={"camera": False, "version": 7}, headers=h).status_code == 200
    assert display_messages.last_heartbeat() == {"version": "7", "camera": False}


def test_heartbeat_over_2kb_is_refused_and_never_reaches_the_record(env):
    c, h = TestClient(hub_app.app), paired(env)
    assert c.post("/api/display/heartbeat", json={"version": "v" * 10240}, headers=h).status_code == 413
    assert display_messages.last_heartbeat() is None
    assert c.post("/api/display/heartbeat", json={"version": {"nested": "v" * 100}}, headers=h).status_code == 200
    assert len(str(house.workshop_display(None)["detail"]["firmware"] or "")) <= 64
    assert "nested" not in repr(house.workshop_display(None))


# ---- final review fixes ----

MAC_KEY = "mac-lab-key-for-tests"


@pytest.fixture
def mac_key(tmp_path, monkeypatch):
    import hashlib
    from hub import lab_guard
    f = tmp_path / "lab_mac_key.sha256"
    f.write_text(hashlib.sha256(MAC_KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(f))
    return MAC_KEY


def test_mac_notify_without_origin(env, mac_key):
    anon = TestClient(hub_app.app)
    r = anon.post("/api/display/notify", json={"title": "From the Mac"}, headers={"X-Hub-Mac-Key": mac_key})
    assert r.status_code == 200 and r.json()["ok"] is True
    r = anon.post("/api/display/notify", json={"title": "x"}, headers={"X-Hub-Mac-Key": "wrong"})
    assert r.status_code == 401
    # no key at all and no Origin: still the same-origin refusal
    assert anon.post("/api/display/notify", json={"title": "x"}).status_code == 403
    row = db.one("SELECT role, result FROM action_log WHERE action = 'display:notify' ORDER BY rowid DESC")
    assert row == {"role": "mac", "result": "ok"}


def test_display_key_without_origin(env):
    h = {"X-Hub-Display-Key": paired(env)["X-Hub-Display-Key"]}  # no Origin
    anon = TestClient(hub_app.app)
    assert anon.post("/api/display/heartbeat", json={"version": "v1"}, headers=h).status_code == 200
    assert anon.post("/api/display/notify", json={"title": "x"}, headers=h).status_code == 200


def test_notify_body_over_4kb_is_413(env):
    r = env.post("/api/display/notify", content=b'{"title": "x"' + b" " * 5000 + b"}",
                 headers={**SAME, "Content-Type": "application/json"})
    assert r.status_code == 413
    assert display_messages.pending(__import__("time").time()) == []


def test_heartbeat_reads_its_body_capped(env, monkeypatch):
    from hub import lab_guard
    caps = []
    real = lab_guard.read_capped

    async def spy(request, cap):
        caps.append(cap)
        return await real(request, cap)
    h = paired(env)
    monkeypatch.setattr(lab_guard, "read_capped", spy)
    c = TestClient(hub_app.app)
    assert c.post("/api/display/heartbeat", json={"version": "1"}, headers=h).status_code == 200
    assert c.post("/api/display/notify", json={"title": "x"}, headers=h).status_code == 200
    assert caps == [2048, 4096]
    assert c.post("/api/display/heartbeat", content=iter([b"x" * 1500, b"x" * 1500]), headers=h).status_code == 413
