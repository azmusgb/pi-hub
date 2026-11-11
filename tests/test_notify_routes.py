"""Phone notices from the other systems (platform step 5, D2): POST /api/notify/{source}, sent through events.push()."""
import hashlib
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hubapp, events, lab_guard, notify_routes, releases, system  # noqa: E402

client = TestClient(hubapp.app)
KEYS = {"localai": "k-localai-" + "1" * 40, "mac": "k-mac-" + "2" * 40}
LAB_KEY = "k-lab-" + "3" * 40
HEADERS = {"localai": {"X-Hub-Deploy-Key": KEYS["localai"]}, "mac-watch": {"X-Hub-Deploy-Key": KEYS["mac"]},
           "print-lab": {"X-Hub-Mac-Key": LAB_KEY}}
KIND = {"localai": "failed", "mac-watch": "outage", "print-lab": "verdict"}


def post(source, json=None, headers=None):
    body = {"kind": KIND[source], "title": "Run failed", "body": "Step 3 of 5"} if json is None else json
    return client.post(f"/api/notify/{source}", json=body, headers=HEADERS[source] if headers is None else headers)


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    keys = tmp_path / "deploy_keys"
    keys.mkdir()
    for name, key in KEYS.items():
        (keys / f"{name}.sha256").write_text(hashlib.sha256(key.encode()).hexdigest() + "\n")
    monkeypatch.setattr(releases, "KEY_DIR", str(keys))
    lab = tmp_path / "lab_mac_key.sha256"
    lab.write_text(hashlib.sha256(LAB_KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(lab))
    monkeypatch.setattr(system, "ALERTS_FILE", str(tmp_path / "alerts.jsonl"))
    sent = []

    def push(title, body="", tags="", priority="default", urgent=False, click=None):
        if events.quiet_now() and not urgent:
            return "Held back for quiet hours."
        sent.append({"tags": tags, "title": title, "body": body, "priority": priority, "urgent": urgent, "click": click})
        return "Sent."

    monkeypatch.setattr(events, "push", push)
    monkeypatch.setattr(events, "quiet_now", lambda now=None: False)
    yield sent


def test_each_source_posts_with_its_own_key(fresh):
    for source in ("localai", "mac-watch", "print-lab"):
        r = post(source)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "outcome": "sent"}
    assert [s["title"] for s in fresh] == ["Local AI: Run failed", "Mac watchdog: Run failed", "Print lab: Run failed"]
    assert [s["priority"] for s in fresh] == ["high", "high", "default"]
    assert [s["tags"] for s in fresh] == ["warning", "rotating_light", "incoming_envelope"]


def test_a_key_posts_only_for_its_own_source(fresh):
    assert post("mac-watch", headers=HEADERS["localai"]).status_code == 401
    assert post("localai", headers=HEADERS["mac-watch"]).status_code == 401
    assert post("localai", headers=HEADERS["print-lab"]).status_code == 401
    assert post("print-lab", headers=HEADERS["mac-watch"]).status_code == 401
    assert post("localai", headers={"X-Hub-Deploy-Key": "wrong"}).json()["detail"] == notify_routes.WRONG_KEY
    assert client.post("/api/notify/pi-hub", json={}, headers=HEADERS["localai"]).status_code == 401
    assert fresh == []


def test_no_key_from_another_site_is_refused_before_the_route(fresh):
    r = client.post("/api/notify/localai", json={"kind": "failed", "title": "x"},
                    headers={"Origin": "https://evil.example"})
    assert r.status_code == 403 and fresh == []


def test_over_plain_http_through_caddy_the_key_doesnt_count(fresh):
    r = post("localai", headers={**HEADERS["localai"], "X-Forwarded-Proto": "http"})
    assert r.status_code == 401 and fresh == []


@pytest.mark.parametrize("body", [
    {"kind": "outage", "title": "x"},  # not a localai kind
    {"kind": "failed"},
    {"kind": "failed", "title": "   "},
    {"kind": "failed", "title": "x", "body": 5},
    {"kind": "failed", "title": "x", "click": "http://localai.home.arpa/"},
    {"kind": "failed", "title": "x", "click": "https://evil.example/"},
    {"kind": "failed", "title": "x", "dedupe": ""},
    {"kind": "failed", "title": "x", "click": "https://evil.example\\@localai.home.arpa/"},
    {"kind": "failed", "title": "x", "click": "https://user@localai.home.arpa/"},
    {"kind": "failed", "title": "x", "click": "https://localai.home.arpa:8443/"},
    {"kind": "failed", "title": "x", "click": "https://localai.home.arpa/ x"},
    {"kind": "failed", "title": "x", "click": "https://localai.home.arpa/\u00e9"},
    {"kind": "failed", "title": "x", "click": "https://localai.home.arpa.evil.example/"},
    ["not", "an", "object"],
])
def test_invalid_notices_are_400(fresh, body):
    r = post("localai", json=body)
    assert r.status_code == 400 and r.json()["detail"] == notify_routes.INVALID
    assert fresh == []


def test_too_big_is_413(fresh):
    r = post("localai", json={"kind": "failed", "title": "x", "body": "y" * 3000})
    assert r.status_code == 413


def test_title_is_one_line_and_click_passes_through(fresh):
    r = post("localai", json={"kind": "failed", "title": "Run\r\nX-Evil: 1", "click": "https://localai.home.arpa/r/1"})
    assert r.status_code == 200
    assert fresh[0]["title"] == "Local AI: Run X-Evil: 1" and fresh[0]["click"] == "https://localai.home.arpa/r/1"
    post("localai", json={"kind": "failed", "title": "y", "click": "https://LOCALAI.home.arpa?run=1#top"})
    assert fresh[1]["click"] == "https://localai.home.arpa/?run=1#top"  # rebuilt from its parts


def test_the_assistant_registry_address_is_a_click_host_and_the_old_hosts_still_are(fresh):
    """A6: Local AI's tap link moves to assistant.rahe-home.duckdns.org; notices already sent keep their old hosts."""
    for host in ("assistant.rahe-home.duckdns.org", "localai.home.arpa", "10.0.0.81"):
        r = post("localai", json={"kind": "failed", "title": host, "click": f"https://{host}/r/1"})
        assert r.status_code == 200, host
        assert fresh[-1]["click"] == f"https://{host}/r/1"


@pytest.mark.parametrize("click", [
    "http://assistant.rahe-home.duckdns.org/",
    "https://assistant.rahe-home.duckdns.org:8443/",
    "https://assistant.rahe-home.duckdns.org.evil.example/",
    "https://user@assistant.rahe-home.duckdns.org/",
    "https://evil.rahe-home.duckdns.org/",
])
def test_lookalikes_of_the_assistant_address_are_refused(fresh, click):
    assert post("localai", json={"kind": "failed", "title": "x", "click": click}).status_code == 400


def test_quiet_hours_hold_a_non_urgent_kind_and_pass_an_urgent_one(fresh, monkeypatch):
    monkeypatch.setattr(events, "quiet_now", lambda now=None: True)
    assert post("localai", json={"kind": "finished", "title": "Done"}).json()["outcome"] == "held"
    assert post("localai", json={"kind": "failed", "title": "Broke"}).json()["outcome"] == "sent"
    assert [s["title"] for s in fresh] == ["Local AI: Broke"]


def test_a_repeat_within_ten_minutes_is_a_duplicate(fresh):
    assert post("localai", json={"kind": "failed", "title": "A", "dedupe": "run-7"}).json()["outcome"] == "sent"
    assert post("localai", json={"kind": "failed", "title": "A again", "dedupe": "run-7"}).json()["outcome"] == "duplicate"
    assert post("localai", json={"kind": "failed", "title": "B", "dedupe": "run-8"}).json()["outcome"] == "sent"
    assert len(fresh) == 2
    # the same dedupe from another source is its own notice
    assert post("mac-watch", json={"kind": "outage", "title": "A", "dedupe": "run-7"}).json()["outcome"] == "sent"


def test_a_repeat_after_the_window_is_sent_again(fresh):
    n = {"kind": "failed", "title": "A", "body": "", "click": None, "dedupe": "d"}
    assert notify_routes.take("localai", n, now=1_000_000) == "sent"
    assert notify_routes.take("localai", n, now=1_000_000 + 599) == "duplicate"
    assert notify_routes.take("localai", n, now=1_000_000 + 601) == "sent"


def test_a_failed_send_isnt_a_duplicate_so_the_sender_can_retry(fresh, monkeypatch):
    monkeypatch.setattr(events, "push", lambda *a, **k: "The phone message didn't go out.")
    r = post("localai")
    assert r.status_code == 502
    monkeypatch.setattr(events, "push", lambda *a, **k: "Sent.")
    assert post("localai").json()["outcome"] == "sent"


def test_the_cap_sends_one_summary_then_429(fresh):
    for i in range(notify_routes.CAP):
        assert post("localai", json={"kind": "failed", "title": f"n{i}"}).status_code == 200
    r = post("localai", json={"kind": "failed", "title": "one too many"})
    assert r.status_code == 429
    r = post("localai", json={"kind": "failed", "title": "two too many"})
    assert r.status_code == 429
    titles = [s["title"] for s in fresh]
    assert len(titles) == notify_routes.CAP + 1 and titles[-1] == "More from Local AI"
    assert post("mac-watch").status_code == 200  # the cap is per source


def test_every_notice_but_a_duplicate_lands_in_the_alerts_history(fresh, monkeypatch, tmp_path):
    (tmp_path / "alerts.jsonl").write_text('{"ts": 1, "title": "Plex is down", "tag": "plex"}\n')
    post("localai", json={"kind": "failed", "title": "A", "dedupe": "x"})
    post("localai", json={"kind": "failed", "title": "A", "dedupe": "x"})
    monkeypatch.setattr(events, "quiet_now", lambda now=None: True)
    post("print-lab", json={"kind": "verdict", "title": "E-022 ready", "body": "Judge it"})
    alerts = client.get("/api/alerts").json()["alerts"]
    assert [a["title"] for a in alerts] == ["Print lab: E-022 ready", "Local AI: A", "Plex is down"]
    assert alerts[0]["body"] == "Judge it (held for quiet hours)" and alerts[0]["tag"] == "incoming_envelope"
    assert alerts[1]["tag"] == "warning"


def test_old_rows_are_pruned(fresh):
    n = {"kind": "failed", "title": "A", "body": "", "click": None, "dedupe": "d"}
    notify_routes.take("localai", n, now=1_000_000)
    notify_routes.take("localai", {**n, "dedupe": "e"}, now=1_000_000 + 31 * 86400)
    assert len(notify_routes.history()) == 1


def test_alerts_carry_their_cause_so_a_problem_and_its_recovery_group(fresh, tmp_path):
    # A7 decision 5: the Alerts page groups by cause per day; the history itself stays one entry per alert.
    (tmp_path / "alerts.jsonl").write_text('{"ts": 1, "title": "Pi is running hot", "tag": "fire"}\n'
                                           '{"ts": 2, "title": "Pi has cooled down", "tag": "white_check_mark"}\n'
                                           '{"ts": 3, "title": "Something new", "tag": "warning"}\n')
    notify_routes.take("mac-watch", {"kind": "outage", "title": "House offline", "body": "", "click": None, "dedupe": "o"})
    notify_routes.take("mac-watch", {"kind": "back", "title": "House back", "body": "", "click": None, "dedupe": "b"})
    notify_routes.take("localai", {"kind": "failed", "title": "Job A", "body": "", "click": None, "dedupe": "a"})
    alerts = client.get("/api/alerts").json()["alerts"]
    by = {a["title"]: (a["cause"], a["side"]) for a in alerts}
    assert by["Pi is running hot"] == ("hot", "problem") and by["Pi has cooled down"] == ("hot", "recovery")
    assert by["Something new"] == ("title:Something new", "event")
    assert by["Mac watchdog: House offline"] == ("mac-watch:outage", "problem")
    assert by["Mac watchdog: House back"] == ("mac-watch:outage", "recovery")
    assert by["Local AI: Job A"] == ("localai:failed:Job A", "problem")


def test_every_pi_status_alert_title_has_a_cause():
    # pi-status.py's watch() writes the titles; system.ALERT_CAUSES pairs them. A new or renamed title fails here.
    import re
    src = open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "deploy", "pi-status.py")).read()
    block = src[src.index("messages = {"):src.index("for key, val in now.items()")]
    titles = re.findall(r'\(\("([^"]+)", .*?\),\s*\("([^"]+)",', block, re.S)
    called = re.findall(r'notify\("([^"]+)"', src)
    found = {t for pair in titles for t in pair} | set(called)
    assert len(titles) == 6 and found <= set(system.ALERT_CAUSES)
    for good, bad in titles:
        assert system.ALERT_CAUSES[good][0] == system.ALERT_CAUSES[bad][0]
