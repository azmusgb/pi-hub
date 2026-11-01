"""pi-status reads Local AI's /api/world with Pi Hub's key, and only over HTTPS verified by Local AI's CA."""
import importlib.util
import io
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("pi_status", Path(__file__).resolve().parents[1] / "deploy" / "pi-status.py")
pi_status = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pi_status)


@pytest.fixture
def files(tmp_path, monkeypatch):
    key, ca = tmp_path / "key", tmp_path / "ca.crt"
    key.write_text("secret\n")
    ca.write_text("x")
    monkeypatch.setattr(pi_status, "LOCALAI_KEY_FILE", str(key))
    monkeypatch.setattr(pi_status, "LOCALAI_CA_FILE", str(ca))
    return key, ca


class _Opener:
    def __init__(self):
        self.reqs = []
        self.timeouts = []

    def open(self, req, timeout=None):
        self.reqs.append(req)
        self.timeouts.append(timeout)
        return io.BytesIO(b'{"printer": {"state": "idle"}}')


def test_world_sends_the_key(files, monkeypatch):
    opener = _Opener()
    monkeypatch.setattr(pi_status.ssl, "create_default_context", lambda cafile=None: object())
    monkeypatch.setattr(pi_status.urllib.request, "build_opener", lambda *h: opener)
    assert pi_status.world() == {"printer": {"state": "idle"}}
    assert opener.reqs[0].get_header("X-localai-hub-key") == "secret"
    assert opener.reqs[0].full_url == "https://10.0.0.21/api/world"
    # a slow TLS handshake (2-5 s, 1 Nov) isn't "down"; and it stays inside the hub's 6 s wait for pi-status
    assert 1.5 < opener.timeouts[0] < 6


@pytest.mark.parametrize("missing", ["key", "ca"])
def test_world_never_calls_without_key_and_ca(files, monkeypatch, missing):
    (files[0] if missing == "key" else files[1]).unlink()
    monkeypatch.setattr(pi_status.urllib.request, "build_opener", lambda *h: pytest.fail("called Local AI"))
    with pytest.raises(Exception):
        pi_status.world()
    assert pi_status.cached("world-test-" + missing, 15, pi_status.world) is None


def test_status_is_not_offered_to_other_websites():
    # Only the hub reads /status, server to server; it relays what Local AI keeps behind sign-in.
    src = (Path(__file__).resolve().parents[1] / "deploy" / "pi-status.py").read_text()
    assert "Access-Control-Allow-Origin" not in src


@pytest.mark.parametrize("models, want", [
    ({"loaded": None, "queue": None}, "Can't answer"),  # Local AI answered, Ollama didn't (iPad, 1 Nov)
    ({"loaded": [], "queue": {"active": 0, "waiting": 0}}, "Ready"),  # Ollama up, nothing loaded yet
    ({"loaded": [{"name": "m"}], "queue": {"active": 1, "waiting": 0}}, "Busy"),
])
def test_ai_state_tells_ollama_down_from_nothing_loaded(monkeypatch, models, want):
    answers = {"world": {"models": models, "printer": {}, "kiosk": {}}}
    monkeypatch.setattr(pi_status, "cached", lambda key, ttl, fn: answers.get(key))
    assert pi_status.status()["ai_state"] == want
