"""Approvals, Ask and pictures through Pi Hub to Local AI, live, only while the PC answers."""
import json
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
open(CODE_FILE, "w").write("PASS-4321\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, auth, display_ai, display_routes, sources  # noqa: E402

SAME = {"Origin": "http://testserver"}
JPEG = b"\xff\xd8\xff" + b"x" * 100


@pytest.fixture
def env(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    auth._tries.clear()
    monkeypatch.setattr(display_ai, "_cache", (0.0, None))
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "PASS-4321", "owner_password": "long enough"},
                  headers=SAME).status_code == 200
    code = c.post("/api/display/pair/start", headers=SAME).json()["code"]
    key = TestClient(hub_app.app).post("/api/display/pair", json={"code": code}, headers=SAME).json()["key"]
    return c, {"X-Hub-Display-Key": key, **SAME}


def fake(monkeypatch, answer):
    calls = []

    def forward(method, path, *, query="", body=None, timeout=10, fetch=None, cap=None):
        calls.append((method, path, query, body))
        if isinstance(answer, Exception):
            raise answer
        return answer
    monkeypatch.setattr(display_ai, "forward", forward)
    return calls


def images(monkeypatch, urls):
    monkeypatch.setattr(display_ai, "cards", lambda now, fetch=None: {"images": [{"title": "t", "imageUrl": u}
                                                                               for u in urls]})


def test_approvals_are_fetched_live_each_time(env, monkeypatch):
    c, disp = env
    calls = fake(monkeypatch, (200, b'{"items":[]}', "application/json"))
    for _ in range(2):
        r = c.get("/api/display/approvals", headers=disp)
        assert r.status_code == 200 and r.json() == {"items": []}
    assert [x[:2] for x in calls] == [("GET", "/api/display/approvals")] * 2


def test_needs_the_display_key(env, monkeypatch):
    c, _ = env
    calls = fake(monkeypatch, (200, b"{}", "application/json"))
    assert TestClient(hub_app.app).get("/api/display/approvals").status_code == 401
    assert TestClient(hub_app.app).get("/api/display/images/0").status_code == 401
    assert calls == []


def test_decide_is_forwarded_once_and_not_retried(env, monkeypatch):
    c, disp = env
    calls = fake(monkeypatch, (503, b"", "text/plain"))
    r = c.post("/api/display/approvals/decide", content=b'{"id":"a","decision":"approve"}', headers=disp)
    assert r.status_code == 503 and r.json() == {"error": "AI unavailable — PC asleep"}
    assert calls == [("POST", "/api/display/approvals/decide", "", b'{"id":"a","decision":"approve"}')]
    assert any(a["action"] == "display:approval" for a in auth.recent_actions(20))


def test_decide_passes_a_stale_refusal_through(env, monkeypatch):
    c, disp = env
    body = json.dumps({"error": "Open it again."}).encode()
    fake(monkeypatch, (409, body, "application/json"))
    r = c.post("/api/display/approvals/decide", content=b"{}", headers=disp)
    assert r.status_code == 409 and r.json() == {"error": "Open it again."}


@pytest.mark.parametrize("answer", [(502, b"x", "text/plain"), RuntimeError("boom")])
def test_pc_asleep_says_ai_unavailable(env, monkeypatch, answer):
    c, disp = env
    fake(monkeypatch, answer)
    for url in ("/api/display/approvals", "/api/display/ask?q=hi"):
        r = c.get(url, headers=disp)
        assert r.status_code == 503 and r.json() == {"error": "AI unavailable — PC asleep"}


def test_ask_forwards_the_query(env, monkeypatch):
    c, disp = env
    calls = fake(monkeypatch, (200, b'{"answer":"hi"}', "application/json"))
    assert c.get("/api/display/ask?q=hello+there", headers=disp).json() == {"answer": "hi"}
    assert calls == [("GET", "/api/display/ask", "q=hello+there", None)]


def test_images_proxy_streams_the_jpeg(env, monkeypatch):
    c, disp = env
    images(monkeypatch, ["/api/images/view?filename=x.png&type=output"])
    calls = fake(monkeypatch, (200, JPEG, "image/jpeg"))
    r = c.get("/api/display/images/0", headers=disp)
    assert r.status_code == 200 and r.content == JPEG and r.headers["content-type"] == "image/jpeg"
    assert calls == [("GET", "/api/images/view", "filename=x.png&type=output", None)]


@pytest.mark.parametrize("n", ["5", "-1", "abc"])
def test_images_out_of_range_or_not_a_number_is_404(env, monkeypatch, n):
    c, disp = env
    images(monkeypatch, ["/api/images/view?filename=x.png"])
    calls = fake(monkeypatch, (200, JPEG, "image/jpeg"))
    assert c.get(f"/api/display/images/{n}", headers=disp).status_code == 404
    assert calls == []


def test_images_never_forward_another_path(env, monkeypatch):
    c, disp = env
    images(monkeypatch, ["/api/other?x=1", "/api/images/view/../x", "http://evil/api/images/view"])
    calls = fake(monkeypatch, (200, JPEG, "image/jpeg"))
    for n in range(3):
        assert c.get(f"/api/display/images/{n}", headers=disp).status_code == 404
    assert calls == []


def test_images_over_5_mb_are_refused(env, monkeypatch):
    c, disp = env
    images(monkeypatch, ["/api/images/view?filename=x.png"])
    fake(monkeypatch, (200, b"x" * (5 * 1024 * 1024 + 1), "image/png"))
    assert c.get("/api/display/images/0", headers=disp).status_code == 502


def test_images_local_ai_4xx_passes_through(env, monkeypatch):
    c, disp = env
    images(monkeypatch, ["/api/images/view?filename=x.png"])
    fake(monkeypatch, (404, b'{"error":"gone"}', "application/json"))
    assert c.get("/api/display/images/0", headers=disp).status_code == 404


def test_poster_is_served_by_pi_hub_without_local_ai(env, monkeypatch):
    c, disp = env
    calls = fake(monkeypatch, (200, b"", "x"))
    monkeypatch.setattr(sources, "plex_sessions", lambda: [{"_thumb": "/t"}])
    monkeypatch.setattr(display_routes, "_poster_jpeg", lambda: JPEG)
    r = c.get("/api/display/images/poster", headers=disp)
    assert r.status_code == 200 and r.content == JPEG and r.headers["content-type"] == "image/jpeg"
    assert calls == []


def test_poster_404_when_nothing_plays(env, monkeypatch):
    c, disp = env
    monkeypatch.setattr(sources, "plex_sessions", lambda: [])
    assert c.get("/api/display/images/poster", headers=disp).status_code == 404


# ---- final review fixes ----

@pytest.mark.parametrize("status", [401, 403])
def test_local_ai_refusing_the_hub_key_is_ai_unavailable(env, monkeypatch, status):
    c, disp = env
    fake(monkeypatch, (status, b'{"error":"Pair the display first."}', "application/json"))
    for r in (c.get("/api/display/approvals", headers=disp), c.get("/api/display/ask?q=hi", headers=disp),
              c.post("/api/display/approvals/decide", content=b"{}", headers=disp)):
        assert r.status_code == 503 and r.json() == {"error": "AI unavailable — PC asleep"}
    images(monkeypatch, ["/api/images/view?filename=x.png"])
    assert c.get("/api/display/images/0", headers=disp).status_code == 503


@pytest.mark.parametrize("status", [301, 302, 307, 308])
def test_local_ai_redirect_is_502_and_never_leaks_its_address(env, monkeypatch, status):
    c, disp = env
    fake(monkeypatch, (status, b"Moved to https://10.0.0.21:8443/elsewhere", "text/plain"))
    r = c.get("/api/display/approvals", headers=disp)
    assert r.status_code == 502 and "10.0.0.21" not in r.text and "location" not in r.headers


def test_unicode_digit_picture_index_is_404(env, monkeypatch):
    c, disp = env
    images(monkeypatch, ["/api/images/view?filename=x.png"])
    calls = fake(monkeypatch, (200, JPEG, "image/jpeg"))
    for n in ("²", "١", "٣"):
        assert c.get(f"/api/display/images/{n}", headers=disp).status_code == 404
    assert calls == []


def test_images_route_passes_the_5_mb_cap_to_forward(env, monkeypatch):
    c, disp = env
    images(monkeypatch, ["/api/images/view?filename=x.png"])
    seen = []

    def forward(method, path, *, query="", body=None, timeout=10, fetch=None, cap=None):
        seen.append(cap)
        return 200, JPEG, "image/jpeg"
    monkeypatch.setattr(display_ai, "forward", forward)
    assert c.get("/api/display/images/0", headers=disp).status_code == 200
    assert seen == [5 * 1024 * 1024]


def test_decide_reads_its_body_capped(env, monkeypatch):
    from hub import lab_guard
    c, disp = env
    calls = fake(monkeypatch, (200, b"{}", "application/json"))
    caps = []
    real = lab_guard.read_capped

    async def spy(request, cap):
        caps.append(cap)
        return await real(request, cap)
    monkeypatch.setattr(lab_guard, "read_capped", spy)
    assert c.post("/api/display/approvals/decide", content=b'{"id":"a"}', headers=disp).status_code == 200
    assert caps == [8 * 1024]
    r = c.post("/api/display/approvals/decide", content=iter([b"x" * 5000, b"x" * 5000]), headers=disp)
    assert r.status_code == 413 and len(calls) == 1
