import importlib.util
import json
import os
import tempfile
from pathlib import Path

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(tempfile.mkdtemp(), "hub.db"))

from fastapi.testclient import TestClient  # noqa: E402

from hub import actions, app as hub_app  # noqa: E402

spec = importlib.util.spec_from_file_location("helper", Path(__file__).resolve().parents[1] / "deploy/pi-hub-helper.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def test_backup_ages_are_the_newest_snapshot_in_each_repo(tmp_path):
    pi = tmp_path / "pi/snapshots"; pi.mkdir(parents=True)
    (tmp_path / "mac/snapshots").mkdir(parents=True)
    for name, t in (("a", 1_700_000_000), ("b", 1_700_050_000)):
        (pi / name).write_text("x"); os.utime(pi / name, (t, t))
    ages = helper.backups_ages({"Pi": str(tmp_path / "pi"), "Mac": str(tmp_path / "mac"), "Gone": str(tmp_path / "nope")})
    assert ages == {"Pi": 1_700_050_000, "Mac": None, "Gone": None}


def test_adguard_stats_reads_two_numbers_and_survives_a_failure():
    assert helper.adguard_stats(lambda: {"num_dns_queries": 900, "num_blocked_filtering": 120, "top_clients": []}) \
        == {"queries": 900, "blocked": 120}
    def broken():
        raise OSError("refused")
    assert helper.adguard_stats(broken) is None


def test_the_api_turns_backup_ages_into_hours(monkeypatch):
    now = 1_800_000_000
    monkeypatch.setattr(hub_app.time, "time", lambda: now)
    monkeypatch.setattr(actions, "helper", lambda name, timeout=0: {"ok": True, "ages": {"Pi": now - 6 * 3600, "Mac": None}}
                        if name == "backups:ages" else {"ok": False})
    hub_app.sources._cache.pop("helper-backups", None)
    r = TestClient(hub_app.app).get("/api/system/backups").json()
    assert r["repos"] == [{"name": "Pi", "last": now - 6 * 3600, "hours": 6}, {"name": "Mac", "last": None, "hours": None}]


def test_the_api_says_when_adguard_is_unavailable(monkeypatch):
    monkeypatch.setattr(actions, "helper", lambda name, timeout=0: {"ok": False, "message": "refused"})
    hub_app.sources._cache.pop("helper-adguard", None)
    assert TestClient(hub_app.app).get("/api/network/adguard").json() == {"available": False}
