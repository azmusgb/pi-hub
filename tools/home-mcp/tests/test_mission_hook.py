"""claude/hooks/mission-report.py, run as Claude Code runs it (python3 -I, JSON on stdin), against the payloads the
M0 spike recorded (A35 §21.1). Plan step 4's evidence."""
import fcntl
import json
import os
import resource
import signal
import sys
import time
from pathlib import Path

import pytest

from home_mcp.mission import cli, local, spool
from home_mcp.mission.validate import validate_event
from hook_fixtures import (AGENT, HOOK, MODEL, SECRET, SID, SID2, agent_post, base, bash_post, git_repo, payloads,
                           run_hook, transcript)


@pytest.fixture
def repo(tmp_path):
    return git_repo(tmp_path / "work" / "pi-hub")


@pytest.fixture
def tpath(tmp_path):
    return transcript(tmp_path / "transcript.jsonl")


def mission_dir() -> Path:
    return spool.spool_path().parent


def enable(drain=None):
    cfg = {"enabled": True, **({"drain": drain} if drain else {})}
    local.config_path().parent.mkdir(parents=True, exist_ok=True)
    local.config_path().write_text(json.dumps(cfg))


def attach(repo, session=SID, *extra):
    assert cli.main(["attach", "a34", *extra, "--cwd", str(repo), *(["--session", session] if session else [])]) == 0


def events() -> list[dict]:
    return [e["event"] for e in spool.read_all()] if spool.spool_path().exists() else []


def fire(payload, **kw) -> list[dict]:
    """Run the hook once and return the events it added. It must exit 0 and print nothing."""
    before = {e["event_id"] for e in events()}
    r, _ = run_hook(payload, **kw)
    assert (r.returncode, r.stdout) == (0, "")
    return [e for e in events() if e["event_id"] not in before]


def files_under(path: Path) -> dict[str, bytes]:
    return {str(p.relative_to(path)): p.read_bytes() for p in sorted(path.rglob("*")) if p.is_file()}


def test_off_by_default_writes_nothing(repo, tpath, capsys):
    attach(repo)  # the binding is the one thing kept while off
    capsys.readouterr()
    before = files_under(mission_dir())
    for text in (None, '{"enabled": false}', '{"enabled": "true"}', "{not json"):
        if text is not None:
            local.config_path().write_text(text)
            before = files_under(mission_dir())
        for payload in [*payloads(repo, tpath).values(), agent_post(repo, tpath),
                        bash_post(repo, tpath, "git commit -m x", "[main 1a2b3c4] x")]:
            fire(payload)
        assert files_under(mission_dir()) == before  # no spool, no state, no lock, binding unchanged
    assert not spool.spool_path().exists()


def test_off_still_rebinds_a_new_session_in_an_attached_cwd(repo, tpath):
    attach(repo)
    fire(base("SessionStart", repo, tpath, SID2, source="clear"))
    binding = local.load_bindings()[local.cwd_key(str(repo))]
    assert binding["session_id"] == SID2 and binding["lineage"] == [SID]
    assert not spool.spool_path().exists()


def test_unattached_session_writes_nothing(tmp_path, repo, tpath):
    enable()
    other = git_repo(tmp_path / "work" / "other")
    attach(other, SID2)  # another session, another directory
    before = files_under(mission_dir())
    for payload in [*payloads(repo, tpath).values(), agent_post(repo, tpath)]:
        assert fire(payload) == []
    assert files_under(mission_dir()) == before


def test_each_hook_event_maps_to_one_contract_event(repo, tpath):
    attach(repo, SID, "shell")
    enable()
    for etype, payload in payloads(repo, tpath).items():
        new = fire(payload)
        assert [e["type"] for e in new] == [etype], payload["hook_event_name"]
        ev = new[0]
        assert validate_event("claude", ev) == [], (etype, validate_event("claude", ev))
        body = ev["body"]
        assert ev["initiative"] == "a34"
        assert (body["session_id"], body["branch"], body["remote"], body["model"]) == \
            (SID, "feat/a35-mission-hook", "azmusgb/pi-hub", MODEL)
        assert body.get("effort") == ("high" if "effort" in payload else None)
    by_type = {e["type"]: e["body"] for e in events()}
    assert by_type["session.attached"]["workstream"] == "a34:workstream:shell"
    assert by_type["session.attached"]["start_source"] == "startup"
    assert by_type["tool.running"]["label"] == "Read hub/app.py"
    assert by_type["tool.finished"]["tool_use_id"] == "toolu_01ReadAbc" and by_type["tool.finished"]["duration_ms"] >= 0
    assert by_type["waiting.owner"] == {**by_type["waiting.owner"], "tool": "Bash", "label": "Echo a word"}
    assert by_type["turn.finished"]["prompt_id"] == by_type["turn.started"]["prompt_id"]
    assert by_type["session.ended"]["reason"] == "prompt_input_exit"


def test_no_prompt_tool_input_response_or_message_text_is_written(repo, tpath):
    attach(repo)
    enable()
    fired = [*payloads(repo, tpath).values(), agent_post(repo, tpath),
             bash_post(repo, tpath, f"git commit -m '{SECRET}'", f"[feat/x 1a2b3c4] {SECRET}\n 1 file changed"),
             bash_post(repo, tpath, f"gh pr create --title {SECRET}", f"{SECRET}\nhttps://github.com/azmusgb/pi-hub/pull/322\n",
                       tuid="toolu_01Pr"),
             base("SessionEnd", repo, tpath, reason=SECRET)]
    for payload in fired:
        fire(payload)
    written = files_under(mission_dir())
    assert len(events()) >= len(fired)  # not vacuous: the events were written
    for name, data in written.items():
        assert SECRET.encode() not in data, name
    never = ("prompt", "tool_input", "tool_response", "last_assistant_message", "message", "content", "transcript")
    for ev in events():
        assert not set(ev["body"]) & set(never)


def _tail_transcript(path: Path, lines: list[dict]) -> Path:
    path.write_text("".join(json.dumps(x) + "\n" for x in lines))
    return path


def test_model_comes_from_the_transcript_tail_only(tmp_path, repo):
    attach(repo)
    enable()
    pad = {"type": "user", "message": {"role": "user", "content": "x" * 70000}}

    def model_for(lines):
        t = _tail_transcript(tmp_path / f"t{len(list(tmp_path.glob('t*')))}.jsonl", lines)
        return fire(base("UserPromptSubmit", repo, t, prompt="p"))[0]["body"]["model"]

    newest = {"type": "assistant", "message": {"model": MODEL}}
    assert model_for([{"type": "assistant", "message": {"model": "claude-old"}}, newest,
                      {"type": "user", "message": {"model": "not-an-assistant-line"}}]) == MODEL
    assert model_for([newest, {"type": "assistant", "message": {"model": "<synthetic>"}}]) == MODEL
    assert model_for([newest, pad]) is None  # only the last 64 KB is read
    assert model_for([]) is None
    missing = base("UserPromptSubmit", repo, tmp_path / "gone.jsonl", prompt="p")
    assert fire(missing)[0]["body"]["model"] is None


def test_subagent_model_and_tokens_from_agent_response(repo, tpath):
    attach(repo)
    enable()
    p = payloads(repo, tpath)
    assert fire(p["subagent.started"])[0]["body"]["agent_type"] == "Explore"
    inside = base("PreToolUse", repo, tpath, tool_name="Grep", tool_input={"pattern": SECRET},
                  tool_use_id="toolu_01Inner", agent_id=AGENT, agent_type="Explore")
    assert fire(inside)[0]["body"]["agent_id"] == AGENT  # a tool inside the subagent says so
    fire(p["subagent.finished"])
    new = fire(agent_post(repo, tpath))
    assert [e["type"] for e in new] == ["tool.finished", "subagent.finished"]
    detail = new[1]["body"]
    assert (detail["agent_id"], detail["agent_type"], detail["subagent_model"], detail["tokens"], detail["duration_ms"]) \
        == (AGENT, "Explore", "claude-haiku-5", 18342, 41250)
    assert new[0]["body"]["label"] == "Agent: Find the spool"
    for ev in new:
        assert validate_event("claude", ev) == []


def test_resume_keeps_session_and_clear_adds_lineage(repo, tpath):
    attach(repo)
    enable()
    key = local.cwd_key(str(repo))
    resumed = fire(base("SessionStart", repo, tpath, SID, source="resume"))
    assert resumed[0]["body"]["start_source"] == "resume" and "lineage" not in resumed[0]["body"]
    assert local.load_bindings()[key]["session_id"] == SID and local.load_bindings()[key]["lineage"] == []
    cleared = fire(base("SessionStart", repo, tpath, SID2, source="clear"))
    assert cleared[0]["body"]["session_id"] == SID2 and cleared[0]["body"]["lineage"] == [SID]
    assert cleared[0]["body"]["start_source"] == "clear" and validate_event("claude", cleared[0]) == []
    assert fire(base("UserPromptSubmit", repo, tpath, SID, prompt="p")) == []  # the old session no longer reports
    assert len(fire(base("UserPromptSubmit", repo, tpath, SID2, prompt="p"))) == 1


def test_attach_without_a_session_id_is_completed_by_the_next_firing(tmp_path, repo, tpath):
    enable()
    attach(repo, session=None)
    assert local.load_bindings()[local.cwd_key(str(repo))].get("session_id") is None
    sub = repo / "hub"
    sub.mkdir()
    assert fire(base("UserPromptSubmit", sub, tpath, prompt="p")) == []  # a different directory doesn't claim it
    new = fire(base("UserPromptSubmit", repo, tpath, prompt="p"))
    assert [e["type"] for e in new] == ["session.attached", "turn.started"]
    assert new[0]["body"]["start_source"] == "attach"
    assert local.load_bindings()[local.cwd_key(str(repo))]["session_id"] == SID
    assert len(fire(base("UserPromptSubmit", sub, tpath, prompt="p"))) == 1  # bound by session id after a cd


def test_hook_exits_zero_within_2s_when_spool_is_locked_or_disk_full(repo, tpath):
    attach(repo)
    enable()
    payload = base("UserPromptSubmit", repo, tpath, prompt="p")
    path = spool.spool_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(f"{path}.lock", os.O_CREAT | os.O_RDWR)
    fcntl.flock(fd, fcntl.LOCK_EX)  # the lock spool.append waits for
    try:
        r, took = run_hook(payload)
    finally:
        os.close(fd)
    assert (r.returncode, r.stdout) == (0, "") and took < 2.0
    assert events() == []

    path.write_bytes(b"x" * 4096 + b"\n")  # then a full disk: no byte more may be written to any file

    def full_disk():
        signal.signal(signal.SIGXFSZ, signal.SIG_IGN)  # writes fail with EFBIG, as ENOSPC would, not with a signal
        resource.setrlimit(resource.RLIMIT_FSIZE, (4097, 4097))

    r, took = run_hook(payload, preexec=full_disk)
    assert (r.returncode, r.stdout, r.stderr) == (0, "", "") and took < 2.0
    assert path.read_bytes() == b"x" * 4096 + b"\n"


def test_bad_input_exits_zero_silently(repo, tpath):
    enable()
    attach(repo)
    for raw in ("", "not json", "[]", json.dumps({"session_id": "not-a-uuid", "hook_event_name": "Stop"})):
        r, _ = run_hook(None, raw=raw)
        assert (r.returncode, r.stdout, r.stderr) == (0, "", "")
    assert fire(base("Notification", repo, tpath, message=SECRET)) == []  # an event it isn't for


def test_git_and_gh_evidence_patterns(tmp_path, repo, tpath):
    attach(repo)
    enable()
    lab = git_repo(tmp_path / "work" / "print-lab", remote="https://github.com/azmusgb/print-lab.git")

    def evidence(command, stdout):
        new = fire(bash_post(repo, tpath, command, stdout, tuid=f"toolu_{abs(hash(command)) % 10**8}"))
        for ev in new:
            assert validate_event("claude", ev) == []
        return [e["body"] for e in new if e["type"] == "evidence.reported"]

    commit = evidence("git add -A && git commit -m 'feat: x'", "[feat/a35 1a2b3c4] feat: x\n 2 files changed\n")
    assert [(b["kind"], b["repo"], b["sha"]) for b in commit] == [("commit", "azmusgb/pi-hub", "1a2b3c4")]
    root = evidence("git commit -m first", "[main (root-commit) 0123456789abcdef] first\n")
    assert root[0]["sha"] == "0123456789abcdef"
    other = evidence(f"git -C '{lab}' commit -m x", "[main deadbee] x\n")
    assert other[0]["repo"] == "azmusgb/print-lab"  # credited to the repo it ran in
    pr = evidence("gh pr create --fill", "Creating pull request\nhttps://github.com/azmusgb/pi-hub/pull/322\n")
    assert [(b["kind"], b["repo"], b["pr"]) for b in pr] == [("pr", "azmusgb/pi-hub", 322)]
    both = evidence("git commit -m x && gh pr create --fill", "[b 1a2b3c4] x\nhttps://github.com/azmusgb/pi-hub/pull/9\n")
    assert sorted(b["kind"] for b in both) == ["commit", "pr"]
    # no evidence: output that only looks like it, or a command that only mentions it
    assert evidence("git log --oneline -1", "[main 1a2b3c4] looks like a commit line\n") == []
    assert evidence("cat notes.md", "https://github.com/azmusgb/pi-hub/pull/5\n") == []
    assert evidence("git commit -m x", "nothing to commit, working tree clean\n") == []
    assert evidence("gh pr create --fill", "a pull request already exists\n") == []


def test_labels_are_cleaned_to_the_contract(repo, tpath):
    attach(repo)
    enable()
    messy = "Run\n the\ttests\x1b[31m\x07 now " + "y" * 400
    new = fire(base("PreToolUse", repo, tpath, tool_name="Bash", tool_use_id="toolu_01Messy",
                    tool_input={"command": "pytest", "description": messy}))
    label = new[0]["body"]["label"]
    assert label.startswith("Run the tests [31m now yyy") and label.endswith("…") and len(label) == 240
    assert "\n" not in label and all(c.isprintable() for c in label)
    assert validate_event("claude", new[0]) == []
    blank = fire(base("PreToolUse", repo, tpath, tool_name="Bash", tool_use_id="toolu_01Blank",
                      tool_input={"description": "\n\t\x00 "}))
    assert blank[0]["body"]["label"] == "Bash"


def test_clean_unit():
    assert local.clean("a\r\nb\x00c d", 240) == "a b c d"
    assert local.clean("x" * 10, 5) == "xxxx…" and local.clean(None, 5) == ""


def test_label_falls_back_to_the_tool_name_without_labels_py(tmp_path, repo, tpath):
    attach(repo)
    enable()
    src = tmp_path / "src"
    src.mkdir()
    real = HOOK.parents[2] / "src" / "home_mcp" / "mission"
    for name in ("local.py", "spool.py", "validate.py"):  # links, so validate.py still finds the contract
        (src / name).symlink_to(real / name)
    new = fire(base("PreToolUse", repo, tpath, tool_name="Read", tool_use_id="toolu_01NoLabels",
                    tool_input={"file_path": "/a/b/c.py"}), env={"HOME_MISSION_SRC": str(src)})
    assert new[0]["body"]["label"] == "Read"


def _wait_for(path: Path, seconds: float = 5.0) -> bool:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if path.exists():
            return True
        time.sleep(0.05)
    return False


def test_drain_is_started_detached_only_when_idle_and_configured(tmp_path, repo, tpath):
    marker = tmp_path / "drained"
    attach(repo)
    payload = base("UserPromptSubmit", repo, tpath, prompt="p")
    enable()  # no drain command: nothing is spawned
    fire(payload)
    enable(drain=[sys.executable, "-c", f"import pathlib; pathlib.Path({str(marker)!r}).write_text('ran')"])
    lock = local.lock_path()
    fd = os.open(lock, os.O_CREAT | os.O_RDWR)
    fcntl.flock(fd, fcntl.LOCK_EX)  # a drain is running
    try:
        fire(payload)
        assert not _wait_for(marker, 1.0)
    finally:
        os.close(fd)
    fire(payload)
    assert _wait_for(marker)


def test_hook_source_imports_only_the_standard_library():
    import ast
    tree = ast.parse(HOOK.read_text())
    names = {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    names |= {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    assert names <= set(sys.stdlib_module_names), names - set(sys.stdlib_module_names)
    for name in ("local.py", "spool.py", "labels.py", "validate.py"):  # the modules it loads by path
        mod = ast.parse((HOOK.parents[2] / "src" / "home_mcp" / "mission" / name).read_text())
        assert not any(isinstance(n, ast.ImportFrom) and n.level for n in ast.walk(mod)), name
        used = {a.name.split(".")[0] for n in ast.walk(mod) if isinstance(n, ast.Import) for a in n.names}
        used |= {n.module.split(".")[0] for n in ast.walk(mod) if isinstance(n, ast.ImportFrom) and n.module}
        assert used <= set(sys.stdlib_module_names), (name, used - set(sys.stdlib_module_names))
