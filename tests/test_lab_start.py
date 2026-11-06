"""Start a staged lab print (A12 plan P3): owner only, both ticks, S5 read at the tap, S3 by the file's sha256, a queue
item with manual_start then its start, the device logged and lab pull told (S6). Bambuddy is a fake throughout."""
import hashlib
import json
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("LABS-5678\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, auth, lab, lab_guard, lab_start, printer_control, sources  # noqa: E402

SAME = {"Origin": "http://testserver"}
KEY = "hub-lab-key-start-0123456789abcdef0123456789abcd"
MAC = {"X-Hub-Mac-Key": KEY}
FILE = b"the checked build's bytes"
SHA = hashlib.sha256(FILE).hexdigest()
TICKS = {"plate_clear": True, "filament_ok": True}


def experiment(status="approved", staged=True, **kw):
    x = {"id": "E-026", "status": status, "shown_build": "BLD-026-02"}
    if staged:
        x["staged"] = {"library_file": 7, "folder": 1, "sha256": SHA, "at": "2026-11-06T10:00:00+00:00",
                       "bambuddy": "1.3.0"}
    return x | kw


class FakeBambuddy:
    def __init__(self, version="1.3.0", file=FILE, queue=201, start=200):
        self.version, self.file, self.queue_status, self.start_status = version, file, queue, start
        self.calls = []

    def __call__(self, method, path, key, body=None):
        self.calls.append((method, path, key, body))
        if path == "/updates/version":
            return 200, json.dumps({"version": self.version}).encode()
        if path == "/library/files/7/download":
            return (200, self.file) if self.file is not None else (404, b'{"detail":"File not found"}')
        if method == "POST" and path == "/queue/":
            return self.queue_status, json.dumps({"id": 41}).encode()
        if path == "/queue/41/start":
            return self.start_status, (b'{"detail":"deficit"}' if self.start_status == 409 else b"{}")
        if method == "DELETE":
            return 200, b"{}"
        return 404, b"{}"


@pytest.fixture
def printer(monkeypatch):
    state = {"connected": True, "bambuddy_state": "FINISH", "hms": [], "bed_temp": 24.0}
    monkeypatch.setattr(sources, "bambuddy_printer", lambda timeout=1: dict(state) if state else None)
    return state


@pytest.fixture
def fake(monkeypatch):
    f = FakeBambuddy()
    monkeypatch.setattr(lab_start, "_call", f)
    real = lab_start.start
    monkeypatch.setattr(lab_start, "start", lambda x, ck, rk, call=None: real(x, ck, rk, call=f))
    monkeypatch.setattr(lab_start, "control_key", lambda: "ctl-key")
    monkeypatch.setattr(lab_start, "read_key", lambda: "read-key")
    return f


@pytest.fixture
def client(tmp_path, monkeypatch, printer):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_LAB_DIR"] = str(tmp_path / "lab")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    lab._ready_dbs.clear()
    auth._tries.clear()
    key_file = tmp_path / "lab_mac_key.sha256"
    key_file.write_text(hashlib.sha256(KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(key_file))
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "LABS-5678", "owner_password": "long enough"},
                  headers=SAME).status_code == 200
    c.cookies.clear()
    assert c.post("/api/signin", json={"password": "long enough"}, headers=SAME).json()["role"] == "owner"
    sync(c, experiment())
    return c


def sync(c, x):
    ix = {"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-11-06T10:00:00Z",
          "fingerprint": "fp-" + json.dumps(x, sort_keys=True), "experiments": [x], "records": {}}
    r = c.post("/api/lab/hex-tile/sync", json=ix, headers=MAC)
    assert r.status_code == 200, r.text


def start(c, **body):
    return c.post("/api/printer/start", json={"project": "hex-tile", "experiment": "E-026", **TICKS, **body},
                  headers=SAME)


def kinds(fake):
    return [(m, p) for m, p, _, _ in fake.calls]


def test_start_checks_the_file_then_queues_with_manual_start_and_starts_it(client, fake):
    r = start(client)
    assert r.status_code == 200, r.text
    assert r.json()["ok"] and r.json()["queue_item"] == 41
    assert kinds(fake) == [("GET", "/updates/version"), ("GET", "/library/files/7/download"), ("POST", "/queue/"),
                           ("POST", "/queue/41/start")]
    queued = fake.calls[2]
    assert queued[3] == {"printer_id": 1, "library_file_id": 7, "manual_start": True}  # never one that starts alone
    assert queued[2] == "ctl-key" and fake.calls[1][2] == "read-key"


def test_start_logs_the_device_and_tells_lab_pull(client, fake):
    start(client)
    act = auth.recent_actions(1)[0]
    assert act["action"] == "printer:start:hex-tile:E-026" and act["role"] == "owner" and act["result"].startswith("Sent.")
    items = client.get("/api/lab/hex-tile/requests?status=pending", headers=MAC).json()["items"]
    (req,) = [i for i in items if i["kind"] == "one_tap"]
    assert req["experiment"] == "E-026" and req["run"] is None
    p = req["payload"]
    assert (p["build"], p["queue_item"], p["library_file"]) == ("BLD-026-02", 41, 7) and p["tapped_at"].endswith("+00:00")


@pytest.mark.parametrize("ticks", [{"plate_clear": False}, {"filament_ok": None}, {"plate_clear": "yes"}])
def test_both_ticks_are_needed(client, fake, ticks):
    r = start(client, **ticks)
    assert r.status_code == 400 and "Tick both" in r.json()["detail"] and fake.calls == []


@pytest.mark.parametrize("change, said", [
    ({"bambuddy_state": "RUNNING"}, "isn't idle (running)"),
    ({"hms": [{"code": "0300"}]}, "has an error"),
    ({"bed_temp": 36.0}, "The bed is 36 °C"),
    ({"bed_temp": None}, "bed temperature is unknown"),
    ({"connected": False}, "can't see the printer"),
])
def test_the_printer_must_be_ready_at_the_tap(client, fake, printer, change, said):
    printer.update(change)
    r = start(client)
    assert r.status_code == 409 and said in r.json()["detail"] and "Nothing was sent" in r.json()["detail"]
    assert fake.calls == []


@pytest.mark.parametrize("x, said", [
    (experiment(status="printing"), "isn't staged"),
    (experiment(staged=False), "isn't staged"),
    (experiment() | {"staged": {"library_file": "7"}}, "incomplete"),
])
def test_only_a_staged_ready_or_approved_build_starts(client, fake, x, said):
    sync(client, x)
    r = start(client)
    assert r.status_code == 409 and said in r.json()["detail"] and fake.calls == []


def test_an_unknown_experiment_is_refused(client, fake):
    r = start(client, experiment="E-999")
    assert r.status_code == 409 and "no such experiment" in r.json()["detail"]


def test_a_file_that_isnt_the_checked_build_starts_nothing(client, fake):
    fake.file = b"something else"
    r = start(client)
    assert r.status_code == 502 and "isn't the build the lab checked" in r.json()["detail"]
    assert ("POST", "/queue/") not in kinds(fake)


def test_a_missing_file_starts_nothing(client, fake):
    fake.file = None
    r = start(client)
    assert r.status_code == 502 and "no longer has the staged file" in r.json()["detail"]


def test_another_bambuddy_version_starts_nothing(client, fake):
    fake.version = "1.4.0"
    r = start(client)
    assert r.status_code == 502 and "proven on 1.3.0" in r.json()["detail"] and len(fake.calls) == 1


def test_a_refused_start_removes_the_queue_item(client, fake):
    fake.start_status = 409
    r = start(client)
    assert r.status_code == 502 and "enough filament" in r.json()["detail"]
    assert ("DELETE", "/queue/41") in kinds(fake)
    items = client.get("/api/lab/hex-tile/requests?status=pending", headers=MAC).json()["items"]
    assert not [i for i in items if i["kind"] == "one_tap"]  # nothing started, nothing to tell the lab
    assert auth.recent_actions(1)[0]["result"].startswith("Bambuddy didn't start it")


def test_a_refused_queue_says_the_key_needs_queue(client, fake):
    fake.queue_status = 403
    r = start(client)
    assert r.status_code == 502 and "needs Queue" in r.json()["detail"]
    assert ("POST", "/queue/41/start") not in kinds(fake)


def test_no_control_key(client, fake, monkeypatch):
    monkeypatch.setattr(lab_start, "control_key", lambda: "")
    r = start(client)
    assert r.status_code == 503 and "control key isn't set up" in r.json()["detail"] and fake.calls == []


def test_one_command_at_a_time(client, fake):
    assert printer_control.hold("pause") is None
    try:
        r = start(client)
    finally:
        printer_control.release()
    assert r.status_code == 409 and "already sending" in r.json()["detail"] and fake.calls == []


def test_only_the_owner_can_start(client, fake):
    client.cookies.clear()
    r = start(client)
    assert r.status_code == 401 and fake.calls == []


def test_bad_names_are_refused(client, fake):
    assert start(client, project="../x").status_code == 400
    assert start(client, experiment="E-26; drop").status_code == 400


def test_the_page_can_ask_whether_it_can_start(client, fake, printer):
    r = client.get("/api/printer/start/hex-tile/E-026")
    assert r.status_code == 200 and r.json()["reasons"] == [] and r.json()["build"] == "BLD-026-02"
    printer["bed_temp"] = 40
    assert "The bed is 40 °C" in client.get("/api/printer/start/hex-tile/E-026").json()["reasons"][0]
    assert fake.calls == []


def test_the_check_reports_the_printer_state_and_trays_for_the_sheet(client, printer):  # A12 P4
    trays = [{"slot": 1, "type": "PLA", "color": "057748", "name": "PLA Basic", "remain": 80}]
    printer["ams_trays"] = trays
    assert client.get("/api/printer/start/hex-tile/E-026").json()["printer"] == {"state": "FINISH", "trays": trays}
    printer.clear()  # Bambuddy unreachable: no state, no trays, and a reason
    got = client.get("/api/printer/start/hex-tile/E-026").json()
    assert got["printer"] == {"state": None, "trays": []} and got["reasons"]


def test_the_phone_cannot_send_a_one_tap_request_itself(client):
    r = client.post("/api/lab/hex-tile/requests", headers=SAME,
                    json={"id": "rq-0123456789abcdef", "kind": "one_tap", "experiment": "E-026", "payload": {}})
    assert r.status_code == 400


def test_clear_pause_and_resume_log_the_device_too(client, printer, monkeypatch):
    printer.update(bambuddy_state="RUNNING")
    monkeypatch.setattr(printer_control, "run", lambda a, post=None: {"ok": True, "say": "Paused.", "steps": {"p": "ok"}})
    assert client.post("/api/printer/pause", headers=SAME).status_code == 200
    assert auth.recent_actions(1)[0]["action"] == "printer:pause"
