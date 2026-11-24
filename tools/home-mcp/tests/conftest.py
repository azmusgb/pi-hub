"""Keep every test off the real ~/.claude: mission paths and keys point into a temp directory."""
import pytest


@pytest.fixture(autouse=True)
def _mission_env(tmp_path, monkeypatch):
    for name, leaf in (("SPOOL", "spool.jsonl"), ("LOCK", "drain.lock"), ("LOG", "drain.log"),
                       ("CONFIG", "config.json")):
        monkeypatch.setenv(f"HOME_MISSION_{name}", str(tmp_path / "mission" / leaf))
    for source in ("CLAUDE", "IMPORTER", "LOCALAI"):
        monkeypatch.delenv(f"HOME_MISSION_KEY_{source}", raising=False)
