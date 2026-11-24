"""home-mission: exit codes and what it prints."""
import json

import httpx

from home_mcp import hub
from home_mcp.mission import cli, spool
from mission_fixtures import FakeHub, MANIFEST, SHA, sized_event


def write_manifest(tmp_path, experiments=False, **changes):
    m = {k: v for k, v in MANIFEST.items() if experiments or k != "experiments"}
    m.update(changes)
    p = tmp_path / "a34.json"
    p.write_text(json.dumps(m))
    return str(p)


def test_validate_exit_codes(tmp_path, capsys):
    assert cli.main(["validate", write_manifest(tmp_path)]) == 0
    assert capsys.readouterr().out.strip() == "ok"
    assert cli.main(["validate", write_manifest(tmp_path, extra=1)]) == 1
    assert "manifest.extra: unknown field" in capsys.readouterr().out
    assert cli.main(["validate", str(tmp_path / "missing.json")]) == 1


def test_import_dry_run_prints_counts_and_unavailable_and_sends_nothing(tmp_path, capsys, monkeypatch):
    sent = []
    monkeypatch.setattr(hub, "make_client", lambda *a, **k: sent.append(1))
    path = write_manifest(tmp_path, experiments=True)
    code = cli.main(["import", path, "--repo", "azmusgb/pi-hub", "--commit", SHA, "--print-lab", str(tmp_path / "nolab"),
                     "--dry-run"])
    out = capsys.readouterr().out
    assert code == 0 and sent == []
    assert "   2 stage.imported" in out and "   1 plan.imported" in out
    assert "unavailable: hex-tile/E-007" in out
    assert "all valid; nothing sent" in out


def test_import_dry_run_refuses_a_bad_commit(tmp_path, capsys):
    code = cli.main(["import", write_manifest(tmp_path), "--repo", "azmusgb/pi-hub", "--commit", "main", "--dry-run"])
    assert code == 1 and "initiative.imported" in capsys.readouterr().out


def _patch_hub(monkeypatch, fake):
    real = hub.make_client
    monkeypatch.setattr(hub, "make_client", lambda transport=None: real(transport=httpx.MockTransport(fake)))
    monkeypatch.setenv("HOME_MCP_HUB_URL", "https://hub.test")
    monkeypatch.setenv("HOME_MISSION_KEY_IMPORTER", "importer-key")


def test_import_against_a_hub_without_routes_says_so_and_exits_2(tmp_path, capsys, monkeypatch):
    fake = FakeHub(httpx.Response(404))
    _patch_hub(monkeypatch, fake)
    code = cli.main(["import", write_manifest(tmp_path), "--repo", "azmusgb/pi-hub", "--commit", SHA])
    assert code == 2 and "Pi Hub has no mission routes yet (M1b)" in capsys.readouterr().out
    assert fake.requests[0].url.path == "/api/missions/events/importer"


def test_import_posts_every_event_once_when_the_hub_answers(tmp_path, capsys, monkeypatch):
    fake = FakeHub()
    _patch_hub(monkeypatch, fake)
    path = write_manifest(tmp_path)
    assert cli.main(["import", path, "--repo", "azmusgb/pi-hub", "--commit", SHA]) == 0
    first = set(fake.ids)
    assert cli.main(["import", path, "--repo", "azmusgb/pi-hub", "--commit", SHA]) == 0
    assert fake.ids == first and len(first) > 5  # the same commit again adds nothing


def test_import_without_a_key_does_not_post(tmp_path, capsys, monkeypatch):
    fake = FakeHub()
    _patch_hub(monkeypatch, fake)
    monkeypatch.delenv("HOME_MISSION_KEY_IMPORTER")
    monkeypatch.setattr("home_mcp.shell.run", _no_keychain)
    assert cli.main(["import", write_manifest(tmp_path), "--repo", "azmusgb/pi-hub", "--commit", SHA]) == 1
    assert fake.requests == [] and "no importer key" in capsys.readouterr().out


async def _no_keychain(argv, timeout=30):
    from home_mcp.shell import Run
    return Run(44, "", "")


def test_drain_command_reports_off(capsys):
    assert cli.main(["drain"]) == 0
    assert capsys.readouterr().out.startswith("disabled")


def test_spool_status(capsys):
    assert cli.main(["spool", "status"]) == 0
    assert capsys.readouterr().out.strip() == "0 events waiting"
    spool.append(sized_event(1), "claude")
    assert cli.main(["spool", "status"]) == 0
    out = capsys.readouterr().out
    assert "1 events waiting (claude 1)" in out and "oldest: " in out
