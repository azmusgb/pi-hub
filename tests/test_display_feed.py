"""The workshop display's feed v2, served by Pi Hub: household cards from Pi Hub's own records, AI cards from Local AI
when the PC answers, and the long poll that says when they change."""
import copy
import json
import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("FEED-4321\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, bambuddy, display_ai, display_feed, display_routes, sources  # noqa: E402
from hub import app as hub_app  # noqa: E402
from helpers_records import PI, bud, records_from  # noqa: E402

SAME = {"Origin": "http://testserver"}
FIXTURE = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "display_feed_v2.json")))
AI_KINDS = {"watch", "running", "done", "image", "disk"}
NOW = 1793458800.0  # 2026-10-31T15:00:00Z, the fixture's time


def ai_on(approvals=2):
    return {"available": True, "checkedAt": int(NOW),
            "cards": copy.deepcopy([c for c in FIXTURE["cards"] if c["kind"] in AI_KINDS]),
            "approvals": {"count": approvals, "speech": "Needs you: 2 approvals wait. One run failed."},
            "images": copy.deepcopy(FIXTURE["images"]), "messages": copy.deepcopy(FIXTURE["messages"])}


AI_OFF = display_ai._empty(NOW)
RECS = records_from(dict(PI, drive_state="Missing"), bambuddy=bud("RUNNING", progress=40))
LAB_ITEM = {"id": "pi:lab:hex-tile:E-021", "source": "Print lab", "tone": "attention", "title": "E-021: Judge the print",
            "detail": "Look at the top face.", "link": "/lab?e=E-021&do=judge", "as_of": ""}
NEEDS = {"count": 4, "unread": [], "items": [
    {"id": "pi:Movies drive", "source": "Pi Hub", "tone": "bad", "title": "Movies drive",
     "detail": "Movies may not play because the storage drive disconnected.", "link": "/drives"},
    LAB_ITEM,
    {"id": "localai:needs-2", "source": "Local AI", "tone": "attention", "title": "Needs you", "detail": "2 approvals wait.",
     "link": "tool:assistant"},
    {"id": "pi:Movie copy from the PC", "source": "Pi Hub", "tone": "warn", "title": "Movie copy from the PC",
     "detail": "No reading", "link": "/drives"}]}
SESSIONS = [{"title": "The Matrix", "show": "", "year": 1999, "kind": "movie", "who": "bill", "device": "Living room TV",
             "state": "playing", "progress": 42, "minutes_left": None}]
SPOOLS = [{"id": 1, "low": True, "measured": True}, {"id": 2, "low": False, "measured": True},
          {"id": 3, "low": False, "measured": True}]


def feed(**kw):
    args = dict(now=NOW, ai=ai_on(), recs=RECS, needs_list=NEEDS, lab=[LAB_ITEM], messages=FIXTURE["messages"],
                sessions=SESSIONS, spools=SPOOLS)
    args.update(kw)
    return display_feed.build(**args)


def kind(f, k):
    return next((c for c in f["cards"] if c["kind"] == k), None)


def same_type(a, b):
    return type(a) is type(b) or (isinstance(a, (int, float)) and isinstance(b, (int, float))
                                  and not isinstance(a, bool) and not isinstance(b, bool))


def test_shape_matches_local_ais_feed_v2():
    f = feed()
    for key, value in FIXTURE.items():
        assert key in f and same_type(f[key], value), key
    assert f["ai"] == {"available": True, "checkedAt": int(NOW)}
    for theirs in FIXTURE["cards"]:
        if theirs["kind"] == "weather":  # Local AI's own; Pi Hub doesn't send it (step 1)
            continue
        ours = kind(f, theirs["kind"])
        assert ours is not None, theirs["kind"]
        for field, value in theirs.items():
            assert field in ours and same_type(ours[field], value), (theirs["kind"], field)
    for name in ("needs", "images", "messages"):
        for field, value in FIXTURE[name][0].items():
            assert field in f[name][0] and same_type(f[name][0][field], value), (name, field)
    assert [c["kind"] for c in f["cards"]][:6] == ["needs", "printer", "lab", "home", "playing", "materials"]


def test_ai_pictures_go_through_pi_hub():
    f = feed()
    assert [i["imageUrl"] for i in f["images"]] == ["/api/display/images/0", "/api/display/images/1"]
    assert kind(f, "image")["imageUrl"] == "/api/display/images/0"
    assert "/api/images/view" not in json.dumps(f)


def test_pc_asleep_hides_ai_cards_and_says_so():
    f = feed(ai=AI_OFF, messages=[])
    kinds = [c["kind"] for c in f["cards"]]
    assert not AI_KINDS & set(kinds)
    assert {"kind": "ai", "id": "ai-off", "title": "AI unavailable — PC asleep", "tone": "info"} in f["cards"]
    assert f["ai"] == {"available": False, "checkedAt": int(NOW)}
    assert "images" not in f
    assert {"needs", "printer", "lab", "home", "playing", "materials"} <= set(kinds)


@pytest.mark.parametrize("down, gone", [
    ({"recs": {**RECS, "printer": {**RECS["printer"], "stale": True}}}, "printer"),
    ({"sessions": None}, "playing"),
    ({"lab": []}, "lab"),
])
def test_each_source_down_affects_only_its_card(down, gone):
    base, f = feed(), feed(**down)
    others = lambda x: [c for c in x["cards"] if c["kind"] != gone]  # noqa: E731
    assert others(f) == others(base)
    if gone == "printer":
        card = kind(f, "printer")
        assert card["stale"] is True and card["tone"] == "warning" and card != kind(base, "printer")
    else:
        assert kind(f, gone) is None


def test_needs_count_adds_approvals():
    card = kind(feed(), "needs")
    # the household's three (Local AI's own "Needs you" row is the approvals, counted once) plus two approvals
    assert card["count"] == 5 and card["text"] == "Movies drive" and card["tone"] == "attention"
    assert card["id"] == "needs-5" and card["ask"] == "needs"
    only_ai = kind(feed(needs_list={"count": 0, "items": [], "unread": []}), "needs")
    assert only_ai["count"] == 2 and only_ai["text"] == "2 approvals wait."
    clear = kind(feed(ai=AI_OFF, needs_list={"count": 0, "items": [], "unread": []}), "needs")
    assert clear["count"] == 0 and clear["tone"] == "ok" and clear["title"] == "All clear"
    f = feed()
    assert f["needsCount"] == 4 and [n["id"] for n in f["needs"]] == [i["id"] for i in NEEDS["items"]]


def test_size_within_local_ais_caps():
    long = "Ω" * 300
    ai = ai_on()
    ai["cards"] = [{"kind": k, "id": f"{k}-{n}-" + "x" * 80, "title": long, "text": long, "tone": "info"}
                   for k in AI_KINDS for n in range(3)]
    ai["images"] = [{"title": long, "imageUrl": "/api/images/view?filename=" + "y" * 200, "at": 1}] * 12
    items = [{"id": "pi:" + "z" * 100 + str(n), "source": long, "tone": "bad", "title": long, "detail": long}
             for n in range(20)]
    messages = [{"seq": n, "title": "t" * 24, "text": "m" * 120, "tone": "info", "chime": True,
                 "action": {"type": "show", "page": "printer"}, "source": "api", "at": 1} for n in range(4)]
    f = feed(ai=ai, needs_list={"count": 20, "items": items, "unread": []}, messages=messages,
             sessions=[dict(SESSIONS[0], title=long, device=long)] * 3)
    assert len(f["cards"]) <= 12 and len(f["needs"]) <= 6 and len(f["images"]) <= 6
    for c in f["cards"]:
        assert len(c["title"]) <= 24 and len(c.get("text", "")) <= 90 and len(c["id"]) <= 48
    for n in f["needs"]:
        assert len(n["title"]) <= 24 and len(n["detail"]) <= 90 and len(n["source"]) <= 24 and len(n["id"]) <= 64
    for i in f["images"]:
        assert len(i["title"]) <= 90
    assert len(json.dumps(f, ensure_ascii=False).encode()) <= 12288  # the display's kMaxBodyBytes


def test_signature_ignores_times():
    assert display_feed.signature(FIXTURE) == "c21881b441a775b2"  # Local AI's signature() of the same feed
    later = copy.deepcopy(FIXTURE)
    later["at"] = "2026-10-31T15:30:00.000Z"
    for c in later["cards"]:
        c.pop("at", None)
        if c["kind"] == "done":
            c["text"] = "Translate the manual · 42 min ago"
    assert display_feed.signature(later) == display_feed.signature(FIXTURE)
    later["cards"][0]["text"] = "Something else"
    assert display_feed.signature(later) != display_feed.signature(FIXTURE)
    assert display_feed.signature(feed()) == display_feed.signature(feed(now=NOW + 600))


# ---- the routes ----

@pytest.fixture
def env(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    auth._tries.clear()
    monkeypatch.setattr(display_ai, "cards", lambda now, fetch=None: display_ai._empty(now))
    monkeypatch.setattr(sources, "localai_feed", lambda: None)
    monkeypatch.setattr(sources, "plex_sessions", lambda: None)
    monkeypatch.setattr(bambuddy, "spools", lambda: None)
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "FEED-4321", "owner_password": "long enough", "pin": "123456"},
                  headers=SAME).status_code == 200
    code = c.post("/api/display/pair/start", headers=SAME).json()["code"]
    key = TestClient(hub_app.app).post("/api/display/pair", json={"code": code}, headers=SAME).json()["key"]
    return TestClient(hub_app.app), {"X-Hub-Display-Key": key}


def test_feed_needs_the_display_key(env):
    c, key = env
    assert c.get("/api/display/feed").status_code == 401
    assert c.get("/api/display/feed", headers={"X-Hub-Display-Key": "hubd_wrong"}).status_code == 401
    assert c.get("/api/display/events?since=x").status_code == 401
    r = c.get("/api/display/feed", headers=key)
    assert r.status_code == 200
    f = r.json()
    assert f["v"] == 2 and f["ai"]["available"] is False and kind(f, "ai")["id"] == "ai-off"
    assert kind(f, "needs") is not None


def test_unknown_signature_answers_at_once(env, monkeypatch):
    c, key = env
    monkeypatch.setattr(display_routes, "EVENTS_WAIT", 5)
    for since in ("", "stale-from-before-a-restart"):
        t = time.monotonic()
        r = c.get(f"/api/display/events?since={since}", headers=key)
        assert time.monotonic() - t < 2 and r.status_code == 200
        assert r.json()["changed"] is True and len(r.json()["sig"]) == 16
    sig = c.get("/api/display/events", headers=key).json()["sig"]
    assert sig == display_feed.signature(c.get("/api/display/feed", headers=key).json())


def test_same_signature_waits_then_answers_unchanged(env, monkeypatch):
    c, key = env
    monkeypatch.setattr(display_routes, "EVENTS_WAIT", 0.6)
    monkeypatch.setattr(display_routes, "EVENTS_SLICE", 0.1)
    sig = c.get("/api/display/events", headers=key).json()["sig"]
    t = time.monotonic()
    r = c.get(f"/api/display/events?since={sig}", headers=key).json()
    assert r == {"sig": sig, "changed": False} and time.monotonic() - t >= 0.5


def test_a_change_answers_before_the_wait_ends(env, monkeypatch):
    c, key = env
    monkeypatch.setattr(display_routes, "EVENTS_WAIT", 5)
    monkeypatch.setattr(display_routes, "EVENTS_SLICE", 0.1)
    sig = c.get("/api/display/events", headers=key).json()["sig"]
    calls = []

    def waking(now, fetch=None):
        calls.append(now)
        return ai_on() if len(calls) > 2 else display_ai._empty(now)
    monkeypatch.setattr(display_ai, "cards", waking)
    t = time.monotonic()
    r = c.get(f"/api/display/events?since={sig}", headers=key).json()
    assert r["changed"] is True and r["sig"] != sig and time.monotonic() - t < 3
