"""What runs where (Atlas redesign spec, PR 4; baseline decision 2): one list of hosts, each with its status records and
its deploy targets, read by Local AI's Architecture page as GET /api/systems over the gate's plain-http machine paths."""
import os
import re
import tempfile
from pathlib import Path

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hubapp, records, releases, systems  # noqa: E402

client = TestClient(hubapp.app)
ROOT = Path(__file__).resolve().parents[1]
A = "a" * 40


@pytest.fixture(autouse=True)
def fresh():
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    records._reset_memory()
    yield


def fake(monkeypatch, recs):
    monkeypatch.setattr(records, "all", lambda: {r["id"]: r for r in recs})


def test_hosts_come_in_the_pages_order_with_how_they_run():
    body = client.get("/api/systems").json()
    assert [h["id"] for h in body["hosts"]] == ["pi", "pc", "mac", "devices", "offsite"]
    pi, pc = body["hosts"][0], body["hosts"][1]
    assert (pi["label"], pi["runs"]) == ("Raspberry Pi", "Always on")
    assert (pc["label"], pc["runs"]) == ("Windows PC", "May sleep")
    assert isinstance(body["as_of"], float)


def test_every_status_record_and_deploy_target_belongs_to_exactly_one_host():
    things = [t for h in systems.HOSTS for t in h["services"]]
    targets = [t for h in systems.HOSTS for t in h["targets"]]
    assert sorted(things) == sorted(records.KINDS), "a new record kind needs a host in hub/systems.py"
    assert sorted(targets) == sorted(releases.TARGETS), "a new deploy target needs a host in hub/systems.py"


def test_a_target_names_its_repository_and_what_is_live(monkeypatch):
    fake(monkeypatch, [{"id": "release:localai", "state": "live", "severity": "ok", "headline": "8d1b65c is live",
                        "detail": {"commit": A, "deployed_at": "2026-11-04T17:30:00-05:00", "version": "2.0.1250",
                                   "head": "secret-ish", "last": {"message": "x"}}}])
    pc = next(h for h in client.get("/api/systems").json()["hosts"] if h["id"] == "pc")
    (t,) = pc["targets"]
    assert t == {"id": "localai", "label": "Local AI", "repo": "azmusgb/LocalAI", "atlas": "localai", "state": "live",
                 "commit": A, "deployed_at": "2026-11-04T17:30:00-05:00", "version": "2.0.1250"}


def test_a_target_with_no_record_is_unknown_not_missing():
    mac = next(h for h in client.get("/api/systems").json()["hosts"] if h["id"] == "mac")
    assert [(t["id"], t["state"], t["commit"]) for t in mac["targets"]] == [
        ("mac-watch", "unknown", None), ("x2d-bridge-mac", "unknown", None), ("print-lab", "unknown", None)]
    assert [t["atlas"] for t in mac["targets"]] == ["localai", None, "print-lab"]


def test_a_service_says_its_state_and_whether_that_reading_is_stale(monkeypatch):
    fake(monkeypatch, [{"id": "backups", "state": "behind", "severity": "attention", "headline": "Off-site copy is 2 days old",
                        "stale": True, "detail": {"anything": 1}}])
    off = next(h for h in client.get("/api/systems").json()["hosts"] if h["id"] == "offsite")
    assert off["services"] == [{"id": "backups", "label": "Backups", "state": "behind", "severity": "attention",
                                "headline": "Off-site copy is 2 days old", "stale": True}]
    pi = next(h for h in client.get("/api/systems").json()["hosts"] if h["id"] == "pi")
    hub = next(s for s in pi["services"] if s["id"] == "hub")
    assert (hub["state"], hub["severity"], hub["headline"]) == ("unknown", "attention", "")


def test_repositories_agree_with_system_versions():
    # System › Versions links each target's commit to GitHub: both read the same repository for a target.
    src = (ROOT / "hub/static/js/versions.js").read_text()
    block = re.search(r"const REPO = \{(.*?)\};", src, re.S).group(1)
    js = dict(re.findall(r'"?([\w-]+)"?:\s*"([^"]+)"', block))
    assert js == systems.REPOS


def test_the_gate_lets_machine_callers_read_it():
    caddy = (ROOT / "deploy/caddy/Caddyfile").read_text()
    line = next(l for l in caddy.splitlines() if l.strip().startswith("@machine path"))
    assert " /api/systems " in line + " "
