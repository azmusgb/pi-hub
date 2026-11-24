"""scripts/install-claude-mission.sh, run with CLAUDE_DIR in a temp directory: links, a config written once, the
settings.json entries printed and the file itself never touched."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "install-claude-mission.sh"
EVENTS = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest",
          "SubagentStart", "SubagentStop", "Stop"]


@pytest.fixture
def claude(tmp_path):
    d = tmp_path / "claude"
    d.mkdir()
    (d / "settings.json").write_text('{"hooks": {"Stop": []}, "keep": "me"}\n')
    return d


def install(claude: Path, *args) -> subprocess.CompletedProcess:
    env = {**os.environ, "CLAUDE_DIR": str(claude), "PYTHON": sys.executable}
    return subprocess.run(["bash", str(SCRIPT), *args], capture_output=True, text=True, env=env, timeout=30)


def printed_entries(out: str) -> dict:
    return json.loads(out[out.index("\n{") + 1:])


def test_install_links_writes_config_once_and_leaves_settings_alone(claude):
    settings = (claude / "settings.json").read_bytes()
    r = install(claude)
    assert r.returncode == 0, r.stderr
    hook, skill = claude / "hooks" / "mission-report.py", claude / "skills" / "mission"
    assert hook.is_symlink() and hook.resolve() == ROOT / "claude" / "hooks" / "mission-report.py"
    assert skill.is_symlink() and (skill / "SKILL.md").resolve() == ROOT / "claude" / "skills" / "mission" / "SKILL.md"
    cfg = json.loads((claude / "mission-config.json").read_text())
    assert cfg == {"enabled": False, "drain": [str(ROOT / ".venv" / "bin" / "home-mission"), "drain"]}
    assert (claude / "settings.json").read_bytes() == settings

    (claude / "mission-config.json").write_text('{"enabled": true}')  # the owner's later change
    again = install(claude)
    assert again.returncode == 0, again.stderr
    assert (claude / "mission-config.json").read_text() == '{"enabled": true}'
    assert "already links" in again.stdout and "left as it is" in again.stdout
    assert (claude / "settings.json").read_bytes() == settings


def test_install_prints_the_exact_hook_entries(claude):
    r = install(claude)
    entries = printed_entries(r.stdout)
    assert list(entries) == EVENTS
    for event in EVENTS:
        [group] = entries[event]
        assert group == {"hooks": [{"type": "command", "command": f"{sys.executable} -I {claude}/hooks/mission-report.py",
                                    "timeout": 3, "async": True}]}


def test_dry_run_changes_nothing(claude):
    before = sorted(p.name for p in claude.rglob("*"))
    r = install(claude, "--dry-run")
    assert r.returncode == 0, r.stderr
    assert "would link" in r.stdout and "would write" in r.stdout
    assert sorted(p.name for p in claude.rglob("*")) == before
    assert list(printed_entries(r.stdout)) == EVENTS


def test_an_existing_file_is_refused_not_replaced(claude):
    (claude / "hooks").mkdir()
    (claude / "hooks" / "mission-report.py").write_text("mine")
    r = install(claude)
    assert r.returncode == 1 and "refusing" in r.stderr
    assert (claude / "hooks" / "mission-report.py").read_text() == "mine"


def test_the_skill_runner_finds_home_mission_through_the_link(claude):
    install(claude)
    runner = claude / "skills" / "mission" / "home-mission"
    exe = ROOT / ".venv" / "bin" / "home-mission"
    r = subprocess.run([str(runner), "--help"], capture_output=True, text=True, timeout=30)
    if exe.exists():
        assert r.returncode == 0 and "attach" in r.stdout
    else:
        assert r.returncode == 1 and "uv sync" in r.stderr
