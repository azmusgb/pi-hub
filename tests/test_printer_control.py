import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
KEY_FILE = os.path.join(_tmp, "bambuddy_control_key")
with open(CODE_FILE, "w") as f:
    f.write("ABCD-1234\n")
os.environ["HUB_BAMBUDDY_CONTROL_KEY_FILE"] = KEY_FILE

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, auth, printer_control, sources  # noqa: E402

PASSWORD = "correct horse"
ORIGIN = {"Origin": "http://testserver"}
REFUSED = "Bambuddy refused the hub's control key. Make a new one (docs/operations.md)."
NO_KEY = "The hub can't control the printer yet: its Bambuddy control key isn't set up."


@pytest.fixture(autouse=True)
def key_file(monkeypatch):
    # another test module may import the hub first, before HUB_BAMBUDDY_CONTROL_KEY_FILE is set
    monkeypatch.setattr(printer_control, "KEY_FILE", KEY_FILE)


@pytest.fixture
def tmp_key():
    with open(KEY_FILE, "w") as f:
        f.write("ctl-key\n")
    yield
    os.remove(KEY_FILE)


@pytest.fixture
def no_key():
    if os.path.exists(KEY_FILE):
        os.remove(KEY_FILE)


@pytest.fixture
def client():
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    auth._tries.clear()
    c = TestClient(hub_app.app)
    r = c.post("/api/setup", json={"code": "abcd-1234", "owner_password": PASSWORD, "pin": "123456"}, headers=ORIGIN)
    assert r.status_code == 200, r.text
    c.cookies.clear()
    return c


@pytest.fixture
def owner(client):
    assert client.post("/api/signin", json={"password": PASSWORD}, headers=ORIGIN).status_code == 200
    return client


def test_clear_posts_plate_then_errors_with_the_control_key(tmp_key):
    calls = []
    r = printer_control.run("clear", post=lambda path, key: calls.append((path, key)) or "ok")
    assert calls == [("clear-plate", "ctl-key"), ("hms/clear", "ctl-key")]
    assert r == {"ok": True, "say": "Plate cleared. Ready for the next print.",
                 "steps": {"clear-plate": "ok", "hms/clear": "ok"}}


def test_pause_and_resume_words(tmp_key):
    assert printer_control.run("pause", post=lambda p, k: "ok")["say"] == "Paused. Resume it here or on the printer."
    assert printer_control.run("resume", post=lambda p, k: "ok")["say"] == "Resumed."


@pytest.mark.parametrize("result,say", [
    ("refused", REFUSED),
    ("no answer", "Bambuddy isn't answering. Check the Pi, or use the printer's screen."),
    ("HTTP 409", "Bambuddy couldn't do that (HTTP 409)."),
])
def test_bambuddy_errors_are_shown_and_stop_the_steps(tmp_key, result, say):
    calls = []
    r = printer_control.run("clear", post=lambda p, k: calls.append(p) or result)
    assert r["ok"] is False and r["say"] == say and calls == ["clear-plate"]


def test_missing_key_says_so_without_calling_bambuddy(no_key):
    r = printer_control.run("pause", post=lambda p, k: pytest.fail("called Bambuddy"))
    assert r == {"ok": False, "say": NO_KEY, "steps": {"print/pause": "no key"}}


def test_an_empty_key_file_counts_as_missing(no_key):
    with open(KEY_FILE, "w") as f:
        f.write("  \n")
    try:
        assert printer_control.run("pause", post=lambda p, k: pytest.fail("called Bambuddy"))["say"] == NO_KEY
    finally:
        os.remove(KEY_FILE)


def test_endpoint_is_owner_only(client):
    assert client.post("/api/printer/pause", headers=ORIGIN).status_code == 401
    assert client.post("/api/signin", json={"pin": "123456"}, headers=ORIGIN).json()["role"] == "household"
    r = client.post("/api/printer/pause", headers=ORIGIN)
    assert r.status_code == 401 and r.json()["detail"] == "Sign in as the owner first."


def test_endpoint_unknown_action_is_404(owner, monkeypatch):
    monkeypatch.setattr(printer_control, "run", lambda a: pytest.fail("ran"))
    assert owner.post("/api/printer/stop", headers=ORIGIN).status_code == 404


def test_endpoint_shows_bambuddy_errors(owner, monkeypatch):
    monkeypatch.setattr(printer_control, "run", lambda a: {"ok": False, "say": REFUSED, "steps": {"print/pause": "refused"}})
    r = owner.post("/api/printer/pause", headers=ORIGIN)
    assert r.status_code == 502 and r.json()["detail"] == REFUSED


def test_endpoint_no_key_is_503(owner, no_key):
    r = owner.post("/api/printer/clear", headers=ORIGIN)
    assert r.status_code == 503 and r.json()["detail"] == NO_KEY


def test_endpoint_ok_drops_the_status_cache(owner, monkeypatch):
    sources._cache["bambuddy_printer"] = (time.time(), {"state": "RUNNING"})
    monkeypatch.setattr(printer_control, "run", lambda a: {"ok": True, "say": "Resumed.", "steps": {"print/resume": "ok"}})
    r = owner.post("/api/printer/resume", headers=ORIGIN)
    assert r.status_code == 200 and r.json() == {"ok": True, "say": "Resumed."}
    assert "bambuddy_printer" not in sources._cache


def test_endpoint_never_returns_the_key(owner, tmp_key, monkeypatch):
    for result in ("ok", "refused", "no answer"):
        monkeypatch.setattr(printer_control, "_post", lambda p, k, r=result: r)
        assert "ctl-key" not in owner.post("/api/printer/clear", headers=ORIGIN).text


def test_default_post_maps_bambuddy_answers(monkeypatch):
    import urllib.error

    class Resp:
        status = 200
        def __enter__(self): return self
        def __exit__(self, *a): return False

    seen = {}
    def fake(req, timeout):
        seen.update(url=req.full_url, key=req.get_header("X-api-key"), method=req.get_method(), timeout=timeout)
        return Resp()
    monkeypatch.setattr(printer_control.urllib.request, "urlopen", fake)
    assert printer_control._post("print/pause", "k1") == "ok"
    assert seen == {"url": "http://127.0.0.1:8000/api/v1/printers/1/print/pause", "key": "k1", "method": "POST", "timeout": 5}

    def http(code):
        def raise_(req, timeout):
            raise urllib.error.HTTPError(req.full_url, code, "x", {}, None)
        return raise_
    monkeypatch.setattr(printer_control.urllib.request, "urlopen", http(403))
    assert printer_control._post("print/pause", "k1") == "refused"
    monkeypatch.setattr(printer_control.urllib.request, "urlopen", http(409))
    assert printer_control._post("print/pause", "k1") == "HTTP 409"
    monkeypatch.setattr(printer_control.urllib.request, "urlopen", lambda req, timeout: (_ for _ in ()).throw(TimeoutError()))
    assert printer_control._post("print/pause", "k1") == "no answer"
