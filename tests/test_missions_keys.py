"""Per-source mission keys (A35 §7.4; M1b plan decision 6, step H1): each source's key works for that source alone,
and none of them can post a release report."""
import hashlib

import pytest

from hub import releases
from hub.missions import keys

KEY = {name: f"k-{name}-" + "9" * 40 for name in keys.KEYS.values()}


class Req:
    def __init__(self, key, proto="https"):
        self.headers = {"x-hub-deploy-key": key, "x-forwarded-proto": proto} if key else {}


@pytest.fixture(autouse=True)
def key_dir(monkeypatch, tmp_path):
    for name, key in KEY.items():
        (tmp_path / f"{name}.sha256").write_text(hashlib.sha256(key.encode()).hexdigest() + "\n")
    monkeypatch.setattr(releases, "KEY_DIR", str(tmp_path))


def test_each_source_checks_only_its_own_key():
    for source in keys.KEYS:
        for name, key in KEY.items():
            assert keys.key_ok(Req(key), source) is (name == keys.KEYS[source]), (source, name)
        assert keys.key_ok(Req(None), source) is False
        assert keys.key_ok(Req(KEY[keys.KEYS[source]], proto="http"), source) is False  # never over plain http


def test_an_unknown_source_has_no_key():
    assert keys.key_ok(Req(KEY["mission-claude"]), "owner") is False


def test_a_release_target_cannot_use_a_mission_key():
    assert not set(releases.KEY_FOR.values()) & {"mission-claude", "mission-importer"}
    for target in releases.TARGETS:
        for name in ("mission-claude", "mission-importer"):
            assert releases.key_ok(Req(KEY[name]), target) is False, (target, name)
