"""Characterization of deploy_state and the tool list: every scenario's full output (blockers, warnings, errors, ready,
every field) and the served tools' names, descriptions and schemas are pinned to a recorded copy, so a refactor of
deploy.pi_hub, deploy.localai or build_server cannot change what a deploy preflight reads. as_of is the only field
dropped. Regenerate the recording only for an intended change: GOLDEN=1 uv run pytest tests/test_deploy_characterization.py"""
import json
import os
from pathlib import Path

import pytest
from mcp import Client

from home_mcp import deploy, shell
from home_mcp.server import build_server
from test_deploy_logs import LIVE, NEW, OTHER, FakeHosts, ok
from test_hub_tools import FIXTURES, serve

GOLDEN = Path(__file__).parent / "fixtures" / "deploy_golden.json"
REL = lambda **kw: {"sha": LIVE[:10], "status": "live", "message": "ok", "ts": 1, **kw}  # noqa: E731


def _pc(**over):
    hosts = FakeHosts()
    hosts.pc |= over
    return hosts


def _pi_advanced():
    hosts = FakeHosts(pi_main=OTHER, live=OTHER[:10], releases=[REL(sha=OTHER[:10], ts=2)])
    hosts.refs["main"] = NEW
    hosts.refs[OTHER[:10]] = OTHER
    return hosts


def _pi_feature():
    hosts = FakeHosts()
    hosts.refs["feat/x"] = NEW
    return hosts


def _pi_unknown_live():
    hosts = FakeHosts()
    hosts.unknown.add(LIVE)
    return hosts


def _pi_many_dirty():
    paths = "".join(f" M f{i}.py\0" for i in range(7)) + "".join(f"?? u{i}\0" for i in range(6))
    return FakeHosts(dirty=paths + "R  new.py\0old.py\0")


PI = {
    "aligned": ("pi-hub", None, FakeHosts),
    "new_on_top": ("pi-hub", None, lambda: _with_main(FakeHosts(github_main=NEW), NEW)),
    "advanced": ("pi-hub", None, _pi_advanced),
    "live_differs": ("pi-hub", None, lambda: FakeHosts(pi_main=NEW)),
    "newest_not_running": ("pi-hub", None, lambda: FakeHosts(releases=[REL(), REL(sha=NEW[:10], status="failed", message="gate", ts=2)])),
    "running_failed": ("pi-hub", None, lambda: FakeHosts(releases=[REL(status="failed", message="recovery")])),
    "no_record": ("pi-hub", None, lambda: FakeHosts(releases=[])),
    "non_dict_history_entries": ("pi-hub", None, lambda: FakeHosts(releases=["x", 3, REL(ts="bad")])),
    "bad_history": ("pi-hub", None, lambda: FakeHosts(pi_ssh=ok(f"/opt/pi-hub/releases/{LIVE[:10]}\nnot json"))),
    "history_not_list": ("pi-hub", None, lambda: FakeHosts(pi_ssh=ok(f"/opt/pi-hub/releases/{LIVE[:10]}\n{{}}"))),
    "pi_unreachable": ("pi-hub", None, lambda: FakeHosts(pi_ssh=shell.Run(255, "", "ssh: timed out"))),
    "pi_command_failed": ("pi-hub", None, lambda: FakeHosts(pi_ssh=shell.Run(1, "", ""))),
    "dirty_tracked": ("pi-hub", None, lambda: FakeHosts(dirty=" M hub/app.py\0")),
    "dirty_untracked": ("pi-hub", None, lambda: FakeHosts(dirty="?? data/\0?? notes.txt\0")),
    "dirty_many_and_rename": ("pi-hub", None, _pi_many_dirty),
    "dirty_unparseable": ("pi-hub", None, lambda: FakeHosts(dirty="garbage\0")),
    "unknown_target_commit": ("pi-hub", None, lambda: _with_unknown(FakeHosts(pi_main=OTHER), OTHER)),
    "unknown_live_commit": ("pi-hub", None, _pi_unknown_live),
    "feature_ref": ("pi-hub", "feat/x", _pi_feature),
    "feature_ref_on_github": ("pi-hub", "feat/x", lambda: _with_ancestor(_pi_feature(), NEW, LIVE)),
    "missing_ref": ("pi-hub", "nope", FakeHosts),
    "intended_is_live": ("pi-hub", LIVE[:10], FakeHosts),
    "github_unreachable": ("pi-hub", None, lambda: _with_runner(FakeHosts(), github="down")),
    "local_main_moved": ("pi-hub", NEW, lambda: _with_main(FakeHosts(), OTHER, {NEW: NEW})),
}

LOCALAI = {
    "healthy": ("localai", None, FakeHosts),
    "unshipped_main": ("localai", None, lambda: FakeHosts(gh_main=NEW)),
    "dirty_pc": ("localai", None, lambda: FakeHosts(pc_dirty=" M a.js\n")),
    "dirty_pc_unreadable": ("localai", None, lambda: _with_runner(FakeHosts(), pc_dirty=True)),
    "pending_release": ("localai", NEW[:12], lambda: FakeHosts(gh_release=NEW)),
    "pending_release_no_intended": ("localai", None, lambda: FakeHosts(gh_release=NEW)),
    "unhealthy": ("localai", None, lambda: _pc(health="UNREACHABLE", healthDetail="refused", deploymentStatus="ROLLED_BACK")),
    "identity_mismatch": ("localai", None, lambda: _pc(deploymentIdentityMismatch=True)),
    "task_failed_result": ("localai", None, lambda: _pc(taskLastResult=267009)),
    "task_not_installed": ("localai", None, lambda: _pc(taskInstalled=False)),
    "bad_json": ("localai", None, lambda: FakeHosts(pc_out=ok("Format-List output"))),
    "empty_object": ("localai", None, lambda: FakeHosts(pc_out=ok("{}"))),
    "list_status": ("localai", None, lambda: FakeHosts(pc_out=ok("[]"))),
    "missing_fields": ("localai", None, lambda: FakeHosts(pc_out=ok('{"health": "HEALTHY"}'))),
    "bad_commit": ("localai", None, lambda: _pc(currentCommit="not-a-sha")),
    "ssh_unreachable": ("localai", None, lambda: FakeHosts(pc_out=shell.Run(255, "", "timed out"))),
    "intended_live": ("localai", LIVE, FakeHosts),
    "intended_unrelated": ("localai", "d" * 40, FakeHosts),
    "intended_unrelated_no_release": ("localai", "d" * 40, lambda: _with_runner(FakeHosts(), github="missing")),
    "github_unreachable": ("localai", None, lambda: _with_runner(FakeHosts(), github="down")),
    "github_missing_release": ("localai", None, lambda: _with_runner(FakeHosts(), github="missing")),
}


def _with_main(hosts, sha, extra=None):
    hosts.refs["main"] = sha
    hosts.refs.update(extra or {})
    return hosts


def _with_unknown(hosts, sha):
    hosts.unknown.add(sha)
    return hosts


def _with_ancestor(hosts, a, d):
    hosts.ancestors.add((a, d))
    return hosts


def _with_runner(hosts, github=None, pc_dirty=False):
    """The fake with one source answering badly: GitHub down or missing a branch, or the PC's git status failing."""
    async def run(argv, timeout=30):
        if github and argv[0] == "git" and argv[3:5] == ["ls-remote", "origin"]:
            if github == "down":
                return shell.Run(128, "", "fatal: unable to access")
            return ok(f"{LIVE}\trefs/heads/main\n")
        if pc_dirty and argv[0] == "ssh" and argv[-1] == deploy.PC_DIRTY:
            return shell.Run(255, "", "timed out")
        return await hosts(argv, timeout)
    return run


def _scenario(table, name):
    target, intended, make = table[name]
    return target, intended, make()


async def _run_all():
    out = {}
    for prefix, table in (("pi", PI), ("localai", LOCALAI)):
        for name in table:
            target, intended, hosts = _scenario(table, name)
            d = await deploy.deploy_state(hosts, target, intended)
            d.pop("as_of")
            out[f"{prefix}:{name}"] = d
    return out


def _normal(v):
    return json.loads(json.dumps(v))


@pytest.fixture(autouse=True)
def _repos(monkeypatch):
    monkeypatch.setenv("HOME_MCP_PIHUB_REPO", "/repo/pi-hub")
    monkeypatch.setenv("HOME_MCP_LOCALAI_REPO", "/repo/localai")


async def _tools_and_record_warnings():
    async with Client(build_server(serve(), runner=FakeHosts())) as client:
        tools = [{"name": t.name, "description": t.description, "annotations": t.annotations.model_dump(mode="json") if t.annotations else None,
                  "input": t.input_schema, "output": t.output_schema} for t in (await client.list_tools()).tools]
    warnings = {}
    cases = {
        "record_matches": (FIXTURES, "pi-hub", FakeHosts()),
        "record_mismatch": (FIXTURES, "pi-hub", FakeHosts(live=OTHER[:10], pi_main=OTHER, releases=[REL(sha=OTHER[:10])])),
        "no_record": ({**FIXTURES, "/api/records": {"records": []}}, "pi-hub", FakeHosts()),
        "record_unreadable": ({}, "pi-hub", FakeHosts()),
        "localai_no_record": (FIXTURES, "localai", FakeHosts()),
    }
    for name, (fixtures, target, hosts) in cases.items():
        async with Client(build_server(serve(fixtures), runner=hosts)) as client:
            d = (await client.call_tool("deploy_state", {"target": target})).structured_content
        d.pop("as_of")
        rec = d.get("record")
        if rec:  # the fixture's record times are relative to the clock
            rec["deployed_at"] = "<time>"
            for part in ("last", "verified"):
                if rec[part]:
                    rec[part]["at"] = "<time>"
        warnings[name] = d
    return {"tools": tools, "deploy_state_record": warnings}


async def _recording():
    return _normal({"deploy": await _run_all(), "server": await _tools_and_record_warnings()})


async def test_deploy_state_and_tools_match_the_recording():
    got = await _recording()
    if os.environ.get("GOLDEN"):
        GOLDEN.write_text(json.dumps(got, indent=1, sort_keys=True) + "\n")
    want = json.loads(GOLDEN.read_text())
    assert got["deploy"].keys() == want["deploy"].keys()
    for name in want["deploy"]:
        assert got["deploy"][name] == want["deploy"][name], name
    assert got["server"] == want["server"]
