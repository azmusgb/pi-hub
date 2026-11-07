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


def test_localai_release_reads_healthz(files, monkeypatch):
    opener = _Opener()
    opener.open = lambda req, timeout=None: (opener.reqs.append(req), io.BytesIO(b'{"status": "ok", "releaseCommit": "' + b"a" * 40 + b'"}'))[1]
    monkeypatch.setattr(pi_status.ssl, "create_default_context", lambda cafile=None: object())
    monkeypatch.setattr(pi_status.urllib.request, "build_opener", lambda *h: opener)
    assert pi_status.localai_release() == "a" * 40
    assert opener.reqs[0].full_url == "https://10.0.0.21/healthz"
    assert opener.reqs[0].get_header("X-localai-hub-key") is None  # /healthz is open; the key goes only to /api/world


def test_localai_release_without_ca_raises(files):
    files[1].unlink()
    with pytest.raises(RuntimeError):
        pi_status.localai_release()


@pytest.mark.parametrize("raw, said", [
    ("0x0", "Good"),
    ("0x1", "Low voltage now"),
    ("0x50005", "Low voltage now"),
    ("0x4", "Slowed by heat"),
    ("0x8", "Slowed by heat"),
    ("0x10000", "Low voltage earlier"),
    ("0x50000", "Low voltage earlier"),   # voltage dipped, then throttled: the voltage is the problem
    ("0xe0000", "Slowed by heat earlier"),  # the Pi's own reading on 7 Nov 2026: heat only, no under-voltage bit
    ("0x40000", "Slowed by heat earlier"),
    ("0x20000", "Slowed by heat earlier"),
])
def test_pi_power_names_heat_and_voltage_apart(raw, said):
    assert pi_status.power_word(int(raw, 16)) == said


def _watch(monkeypatch, temps):
    """Runs pi-status's watch() over one status per temperature and returns the alert titles it sent."""
    steady = {"services": {"plex": True, "homebridge": True}, "drive_state": "Connected", "ai_state": "Ready",
              "display_state": "Online", "x2d_state": "Idle", "x2d_progress": 0}
    readings = iter(temps)

    def status():
        try:
            return {**steady, "pi_temp": next(readings)}
        except StopIteration:
            raise KeyboardInterrupt from None  # ends the loop once every reading is spent

    sent = []
    monkeypatch.setattr(pi_status, "status", status)
    monkeypatch.setattr(pi_status.time, "sleep", lambda s: None)
    monkeypatch.setattr(pi_status, "notify", lambda title, *a, **k: sent.append(title))
    with pytest.raises(KeyboardInterrupt):
        pi_status.watch()
    return sent


def test_a_pi_hovering_at_80_degrees_alerts_once_not_on_every_wobble(monkeypatch):
    # 7 Nov 05:34-06:06: about 16 "running hot" / "cooled down" alerts as the Pi wobbled across 80 °C.
    wobble = [70, 70] + [80.3, 80.3, 79.8, 79.8] * 4
    assert _watch(monkeypatch, wobble) == ["Pi is running hot"]


def test_the_pi_has_cooled_down_once_it_holds_below_75(monkeypatch):
    sent = _watch(monkeypatch, [70, 70, 81, 81, 77, 77, 74, 74, 81, 81])
    assert sent == ["Pi is running hot", "Pi has cooled down", "Pi is running hot"]
