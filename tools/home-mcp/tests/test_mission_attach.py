"""home-mission attach, detach, task and status: what the /mission skill runs."""
import json

import pytest

from home_mcp.mission import cli, local, spool
from home_mcp.mission.validate import validate_event
from hook_fixtures import SID, SID2, git_repo


@pytest.fixture
def repo(tmp_path):
    return git_repo(tmp_path / "pi-hub")


def enable():
    local.config_path().parent.mkdir(parents=True, exist_ok=True)
    local.config_path().write_text('{"enabled": true}')


def spooled() -> list[dict]:
    return [e["event"] for e in spool.read_all()] if spool.spool_path().exists() else []


def run(*argv) -> int:
    return cli.main(list(argv))


def test_attach_records_the_binding_while_off_and_spools_nothing(repo, capsys):
    assert run("attach", "a34", "shell", "--cwd", str(repo), "--session", SID) == 0
    out = capsys.readouterr().out
    assert "attached" in out and "not spooled: no mission-config.json" in out
    b = local.load_bindings()[local.cwd_key(str(repo))]
    assert (b["initiative"], b["workstream"], b["session_id"], b["branch"], b["remote"]) == \
        ("a34", "a34:workstream:shell", SID, "feat/a35-mission-hook", "azmusgb/pi-hub")
    assert spooled() == []


def test_attach_spools_a_valid_session_attached_when_on(repo, capsys):
    enable()
    assert run("attach", "a34", "a34:workstream:shell", "--cwd", str(repo), "--session", SID) == 0
    assert "spooled session.attached" in capsys.readouterr().out
    [ev] = spooled()
    assert ev["type"] == "session.attached" and validate_event("claude", ev) == []
    assert ev["body"]["start_source"] == "attach" and ev["body"]["cwd_name"] == "pi-hub"


def test_attach_refuses_bad_ids_and_keeps_lineage_on_reattach(tmp_path, repo, capsys):
    assert run("attach", "A34!", "--cwd", str(repo)) == 1
    assert run("attach", "a34", "other:workstream:x", "--cwd", str(repo)) == 1
    assert not local.attach_path().exists()
    assert run("attach", "a34", "--cwd", str(repo), "--session", SID) == 0
    assert run("attach", "a34", "--cwd", str(repo), "--session", SID2) == 0
    assert local.load_bindings()[local.cwd_key(str(repo))]["lineage"] == [SID]
    moved = git_repo(tmp_path / "elsewhere")
    assert run("attach", "a35", "--cwd", str(moved), "--session", SID2) == 0
    assert list(local.load_bindings()) == [local.cwd_key(str(moved))]  # one binding per session


def test_unsubstituted_session_leaves_the_binding_waiting(repo, capsys):
    assert run("attach", "a34", "--cwd", str(repo), "--session", "${CLAUDE_SESSION_ID}") == 0
    assert "next hook firing" in capsys.readouterr().out
    assert local.load_bindings()[local.cwd_key(str(repo))]["session_id"] is None
    assert run("task", "measure", "start", "--cwd", str(repo)) == 1
    assert "waiting for this session's id" in capsys.readouterr().out


def test_task_start_and_done_spool_valid_events(repo, capsys):
    enable()
    run("attach", "a34", "--cwd", str(repo), "--session", SID)
    assert run("task", "measure", "start", "--cwd", str(repo)) == 0
    assert run("task", "a34:task:measure", "done", "--summary", "Budget met\nwith margin", "--cwd", str(repo)) == 0
    started, done = spooled()[1:]
    assert (started["type"], started["body"]["task"]) == ("task.started", "a34:task:measure")
    assert (done["type"], done["body"]["summary"]) == ("task.done", "Budget met with margin")
    for ev in (started, done):
        assert validate_event("claude", ev) == []
    assert run("task", "a35:task:measure", "start", "--cwd", str(repo)) == 1  # another initiative's task
    assert "not a task of a34" in capsys.readouterr().out


def test_task_needs_an_attach(tmp_path, capsys):
    assert run("task", "measure", "start", "--cwd", str(tmp_path)) == 1
    assert "not attached here" in capsys.readouterr().out


def test_detach_removes_the_binding_and_spools_session_ended(repo, capsys):
    enable()
    run("attach", "a34", "--cwd", str(repo), "--session", SID)
    assert run("detach", "--cwd", str(repo)) == 0
    assert local.load_bindings() == {}
    ended = spooled()[-1]
    assert (ended["type"], ended["body"]["reason"]) == ("session.ended", "detached")
    assert validate_event("claude", ended) == []
    assert run("detach", "--cwd", str(repo)) == 0
    assert "nothing to detach" in capsys.readouterr().out


def test_status_shows_binding_reporting_and_spool(repo, capsys):
    assert run("status", "--cwd", str(repo)) == 0
    out = capsys.readouterr().out
    assert "not attached here" in out and "reporting: off" in out and "0 events waiting" in out
    enable()
    local.config_path().write_text(json.dumps({"enabled": True, "drain": ["/bin/true", "drain"]}))
    run("attach", "a34", "shell", "--cwd", str(repo), "--session", SID)
    capsys.readouterr()
    assert run("status", "--session", SID, "--cwd", "/") == 0  # found by session id from anywhere
    out = capsys.readouterr().out
    assert "-> a34 (a34:workstream:shell)" in out and f"session: {SID}" in out
    assert "reporting: on" in out and "1 events waiting (claude 1)" in out and "drain: no command" not in out
