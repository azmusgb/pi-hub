"""deploy_state and service_logs against a fake command runner: what each target's records say, mapped to
blockers and warnings, and logs bounded, filtered and redacted."""
import json

import pytest
from mcp import Client

from home_mcp import deploy, logs, shell
from home_mcp.server import build_server

LIVE, NEW, OTHER = "a" * 40, "b" * 40, "c" * 40


def ok(out=""):
    return shell.Run(0, out, "")


class FakeHosts:
    """Answers the exact commands deploy_state and logs run, from a small description of each machine."""

    def __init__(self, **kw):
        self.refs = {"main": LIVE, LIVE: LIVE, NEW: NEW, OTHER: OTHER, LIVE[:10]: LIVE}
        self.ancestors = {(LIVE, NEW), (LIVE, LIVE), (NEW, NEW), (OTHER, OTHER)}  # (ancestor, descendant)
        self.unknown = set()
        self.dirty = ""
        self.github_main = LIVE
        self.pi_main = LIVE
        self.live = LIVE[:10]
        self.releases = [{"sha": LIVE[:10], "status": "live", "message": "Tests passed.", "ts": 1793481254}]
        self.pi_ssh = None
        self.pc = {"health": "HEALTHY", "healthDetail": "ok", "deploymentStatus": "HEALTHY", "currentCommit": LIVE,
                   "deploymentIdentityMismatch": False, "repoHead": LIVE, "originRelease": LIVE,
                   "deployedAt": "2026-10-31T00:48:21-04:00", "previousCommit": OTHER, "taskInstalled": True,
                   "taskState": "Ready", "taskLastRunTime": "/Date(1793484163000)/", "taskLastResult": 0,
                   "taskNextRunTime": "/Date(1793484459000)/", "checkedAt": "2026-10-31T18:03:51-04:00"}
        self.pc_out = None
        self.pc_dirty = ""
        self.gh_release, self.gh_main = LIVE, LIVE
        self.log_out = shell.Run(0, "", "")
        self.calls = []
        self.__dict__.update(kw)

    async def __call__(self, argv, timeout=30):
        self.calls.append(argv)
        if argv[0] == "ssh":
            cmd = argv[-1]
            if cmd == deploy.PI_LIVE:
                return self.pi_ssh or ok(f"/opt/pi-hub/releases/{self.live}\n" + json.dumps(self.releases))
            if cmd == deploy.PC_STATUS:
                return self.pc_out or ok(json.dumps(self.pc))
            if cmd == deploy.PC_DIRTY:
                return ok(self.pc_dirty)
            return self.log_out
        args = argv[3:]
        if args[:3] == ["rev-parse", "--verify", "--quiet"]:
            ref = args[3].removesuffix("^{commit}")
            return ok(self.refs[ref] + "\n") if ref in self.refs else shell.Run(1, "", "")
        if args == ["status", "--porcelain"]:
            return ok(self.dirty)
        if args[:2] == ["ls-remote", "origin"] and "refs/heads/release" in args:
            return ok(f"{self.gh_main}\trefs/heads/main\n{self.gh_release}\trefs/heads/release\n")
        if args[:2] == ["ls-remote", "origin"]:
            return ok(f"{self.github_main}\trefs/heads/main\n")
        if args[:2] == ["ls-remote", "pi"]:
            return ok(f"{self.pi_main}\trefs/heads/main\n")
        if args[:2] == ["merge-base", "--is-ancestor"]:
            a, d = args[2], args[3]
            if a in self.unknown or d in self.unknown:
                return shell.Run(128, "", "fatal: Not a valid commit name")
            return ok() if (a, d) in self.ancestors else shell.Run(1, "", "")
        raise AssertionError(f"unexpected command {argv}")


async def test_pi_hub_aligned_is_ready_and_says_already_live():
    d = await deploy.deploy_state(FakeHosts(), "pi-hub")
    assert d["ok"] and d["ready"] and d["blockers"] == []
    assert d["intended"] == {"ref": "main", "sha": LIVE}
    assert d["live"] == {"sha": LIVE[:10], "status": "live", "message": "Tests passed.", "at": d["live"]["at"]}
    assert d["warnings"] == ["the intended commit is already live; a release would be a no-op"]


async def test_pi_hub_new_commit_on_top_of_live_is_ready():
    hosts = FakeHosts(github_main=NEW)
    hosts.refs["main"] = NEW
    d = await deploy.deploy_state(hosts, "pi-hub")
    assert d["ready"] and d["warnings"] == [] and d["intended"]["sha"] == NEW


async def test_pi_hub_advanced_by_another_session_blocks():
    hosts = FakeHosts(pi_main=OTHER, live=OTHER[:10],
                      releases=[{"sha": OTHER[:10], "status": "live", "message": "x", "ts": 2}])
    hosts.refs["main"] = NEW
    hosts.refs[OTHER[:10]] = OTHER
    d = await deploy.deploy_state(hosts, "pi-hub")
    assert not d["ready"]
    assert any("another session may have released" in b for b in d["blockers"])


async def test_pi_hub_live_differs_from_repository_blocks():
    d = await deploy.deploy_state(FakeHosts(pi_main=NEW), "pi-hub")
    assert any("a release failed or is in progress" in b for b in d["blockers"])


async def test_pi_hub_newest_attempt_not_running_blocks():
    releases = [{"sha": LIVE[:10], "status": "live", "message": "ok", "ts": 1},
                {"sha": NEW[:10], "status": "failed", "message": "gate failed", "ts": 2}]
    d = await deploy.deploy_state(FakeHosts(releases=releases), "pi-hub")
    assert any("newest release attempt" in b and "gate failed" in b for b in d["blockers"])


async def test_pi_hub_dirty_checkout_blocks():
    d = await deploy.deploy_state(FakeHosts(dirty=" M hub/app.py\n"), "pi-hub")
    assert not d["local_checkout_clean"] and any("uncommitted changes" in b for b in d["blockers"])


async def test_pi_hub_unknown_target_commit_says_fetch():
    hosts = FakeHosts(pi_main=OTHER)
    hosts.unknown.add(OTHER)
    d = await deploy.deploy_state(hosts, "pi-hub")
    assert any("fetch to compare" in b for b in d["blockers"])


async def test_pi_hub_unreachable_pi_is_an_error_and_blocks():
    d = await deploy.deploy_state(FakeHosts(pi_ssh=shell.Run(255, "", "ssh: connect to host pi: timed out")), "pi-hub")
    assert d["ok"] is False and not d["ready"]
    assert d["errors"][0]["error"] == "unreachable" and "timed out" in d["errors"][0]["detail"]


async def test_pi_hub_intended_not_on_github_and_not_main_warns():
    hosts = FakeHosts()
    hosts.refs["feat/x"] = NEW
    d = await deploy.deploy_state(hosts, "pi-hub", "feat/x")
    assert any("not on GitHub main" in w for w in d["warnings"])
    assert any("install.sh ships local main" in w for w in d["warnings"])


async def test_pi_hub_missing_ref_blocks():
    d = await deploy.deploy_state(FakeHosts(), "pi-hub", "nope")
    assert any("nope is not a commit" in b for b in d["blockers"])


@pytest.mark.parametrize("target,intended", [("netmon", None), ("pi-hub", "--upload-pack=x"),
                                             ("pi-hub", "main..evil"), ("localai", "main")])
async def test_deploy_state_rejects_bad_arguments(target, intended):
    with pytest.raises(ValueError):
        await deploy.deploy_state(FakeHosts(), target, intended)


async def test_localai_healthy_is_ready_and_notes_unshipped_main():
    d = await deploy.deploy_state(FakeHosts(gh_main=NEW), "localai")
    assert d["ok"] and d["ready"]
    assert d["safe_deploy_task"]["last_run"].startswith("2026-10-31")
    assert d["pc_checkout"] == {"head": LIVE, "release_as_fetched": LIVE, "clean": True}
    assert d["warnings"] == [f"main ({NEW[:12]}) has merged work not shipped to release ({LIVE[:12]})"]


async def test_localai_dirty_pc_checkout_blocks():
    d = await deploy.deploy_state(FakeHosts(pc_dirty=" M app/server/chat.js\n"), "localai")
    assert d["pc_checkout"]["clean"] is False and any("Safe Deploy skips" in b for b in d["blockers"])


async def test_localai_pending_release_blocks():
    d = await deploy.deploy_state(FakeHosts(gh_release=NEW), "localai", NEW[:12])
    assert any("not deployed yet" in b for b in d["blockers"])
    assert "the intended commit is on release, waiting for Safe Deploy" in d["warnings"]


async def test_localai_unhealthy_blocks():
    hosts = FakeHosts()
    hosts.pc |= {"health": "UNREACHABLE", "healthDetail": "refused", "deploymentStatus": "ROLLED_BACK"}
    d = await deploy.deploy_state(hosts, "localai")
    assert any("health is UNREACHABLE" in b for b in d["blockers"])
    assert any("ROLLED_BACK" in b for b in d["blockers"])


async def test_localai_bad_status_json_is_an_error():
    d = await deploy.deploy_state(FakeHosts(pc_out=ok("Format-List output")), "localai")
    assert d["ok"] is False and d["errors"][0]["error"] == "bad_json" and not d["ready"]


@pytest.mark.parametrize("args", [{"service": "bash"}, {"service": "pi-hub", "minutes": 0},
                                  {"service": "pi-hub", "minutes": 1441}, {"service": "pi-hub", "lines": 501},
                                  {"service": "pi-hub", "contains": ""}])
async def test_logs_rejects_bad_arguments(args):
    with pytest.raises(ValueError):
        await logs.logs(FakeHosts(), **args)


async def test_logs_commands_are_fixed_per_service():
    hosts = FakeHosts()
    for service in ("pi-hub", "localai", "localai-deploy"):
        await logs.logs(hosts, service, 15, 40)
    cmds = [c[-1] for c in hosts.calls]
    assert cmds[0] == "journalctl -u pi-hub --since -15min -n 40 --no-pager -o short-iso"
    assert cmds[1] == "docker logs --timestamps --since 15m --tail 40 local-ai-appliance 2>&1"
    assert cmds[2] == "powershell -NoProfile -Command \"Get-Content -LiteralPath 'C:\\LocalAI\\.deploy\\auto-deploy.log' -Tail 40\""
    assert [c[-2] for c in hosts.calls] == ["pi", "windows", "windows"]


def test_redaction():
    assert logs.redact("token=abc123 ok") == "token=[redacted] ok"
    assert "xyz" not in logs.redact("Authorization: Bearer xyz")
    assert "xyz" not in logs.redact("authorization=Basic xyz")
    assert logs.redact('"password": "hunter2"') == '"password": "[redacted]"'
    assert logs.redact("GET /api?key=s3cret&x=1") == "GET /api?key=[redacted]&x=1"
    assert logs.redact("blob " + "Zx9" * 20) == "blob [redacted]"
    assert logs.redact(f"deployed {LIVE}") == f"deployed {LIVE}"
    path = "/opt/pi-hub/releases/22cf1f6a76/hub/static/js/some-long-module-name-for-the-wall.mjs"
    assert logs.redact(f"GET {path} 200") == f"GET {path} 200"
    assert logs.redact("x" * 60) == "x" * 60
    assert logs.redact("access_token=abc") == "access_token=[redacted]"
    assert logs.redact("client_secret: abc") == "client_secret: [redacted]"
    assert logs.redact("FOO_API_KEY=abc") == "FOO_API_KEY=[redacted]"
    assert logs.redact("X-Hub-Mac-Key: abc") == "X-Hub-Mac-Key: [redacted]"
    assert logs.redact("spin up the pinned spool") == "spin up the pinned spool"


async def test_logs_filters_redacts_and_drops_no_entries():
    out = "-- No entries --\nINFO started\nERROR token=abc failed\nerror again\n"
    d = await logs.logs(FakeHosts(log_out=ok(out)), "pi-hub", contains="error")
    assert d["ok"] and d["lines"] == ["ERROR token=[redacted] failed", "error again"] and d["count"] == 2


async def test_logs_filter_cannot_probe_redacted_values():
    hosts = FakeHosts(log_out=ok("login password=hunter2\n"))
    assert (await logs.logs(hosts, "pi-hub", contains="hunter2"))["lines"] == []
    assert (await logs.logs(hosts, "pi-hub", contains="password=h"))["lines"] == []


async def test_logs_byte_cap_keeps_newest():
    out = "\n".join(f"line {i} " + "word " * 180 for i in range(60))
    d = await logs.logs(FakeHosts(log_out=ok(out)), "pi-hub", lines=500)
    assert d["truncated"] and d["lines"][-1].startswith("line 59")
    assert sum(len(x) for x in d["lines"]) <= logs.MAX_BYTES


async def test_logs_failure_is_structured_and_redacted():
    d = await logs.logs(FakeHosts(log_out=shell.Run(1, "", "denied for token=abc")), "localai")
    assert d["ok"] is False and d["lines"] == []
    assert d["errors"][0] == {"source": "docker on windows", "error": "command", "detail": "denied for token=[redacted]"}


async def test_tools_are_served_read_only():
    async with Client(build_server(runner=FakeHosts())) as client:
        tools = {t.name: t for t in (await client.list_tools()).tools}
        assert {"deploy_state", "service_logs"} <= set(tools)
        assert tools["deploy_state"].annotations.read_only_hint
        result = await client.call_tool("deploy_state", {"target": "pi-hub"})
        assert result.structured_content["ready"] is True
        bad = await client.call_tool("service_logs", {"service": "rm -rf"})
        assert bad.is_error


def test_clean_stderr_drops_ssh_banner():
    err = "** WARNING: connection is not using a post-quantum key exchange algorithm.\n** x\nreal error"
    assert shell.clean_stderr(err) == "real error"


def test_ssh_env_recovers_agent_socket(monkeypatch):
    monkeypatch.delenv("SSH_AUTH_SOCK", raising=False)
    monkeypatch.setattr(shell, "_agent_socket", None)
    monkeypatch.setattr(shell.subprocess, "run", lambda *a, **k: shell.subprocess.CompletedProcess(a, 0, "/tmp/agent\n", ""))
    assert shell.ssh_env()["SSH_AUTH_SOCK"] == "/tmp/agent"
    monkeypatch.setenv("SSH_AUTH_SOCK", "/tmp/mine")
    assert shell.ssh_env()["SSH_AUTH_SOCK"] == "/tmp/mine"
