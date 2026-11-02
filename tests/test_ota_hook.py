"""Run the real OTA publish hook (deploy/bambuhelper-post-receive) against a temporary git repo, with sudo, tar and mv
stubbed so it runs the same on the Mac and on the Pi."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

import pytest

from hub import releases

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "d" * 40


def manifest(stable):
    return json.dumps({"schemaVersion": 1, "board": "ws_lcd_350", "channels": {"stable": stable}})


@pytest.fixture
def hook(tmp_path):
    out, inbox, tools, repo = tmp_path / "updates", tmp_path / "inbox", tmp_path / "bin", tmp_path / "repo"
    out.mkdir()
    tools.mkdir()
    script = (ROOT / "deploy/bambuhelper-post-receive").read_text()
    script = script.replace("/srv/bambuhelper-updates", str(out)).replace("/var/lib/pi-hub-releases/inbox", str(inbox))
    runner = tmp_path / "post-receive"
    runner.write_text(script)
    runner.chmod(0o755)
    stub = tools / "stub"
    stub.write_text("#!" + sys.executable + "\n" + r'''
import fnmatch, os, pathlib, shutil, sys, tarfile
name, args = pathlib.Path(sys.argv[0]).name, sys.argv[1:]
if name == "sudo":
    args = [a for a in args if a != "-n"]
    os.execvp(args[0], args)
elif name == "tar":  # tar -x -C dir --wildcards pattern...
    dest = args[args.index("-C") + 1]
    patterns = [a for a in args[args.index("--wildcards") + 1:]]
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|") as t:
        for m in t:
            if any(fnmatch.fnmatch(m.name, p) for p in patterns):
                t.extract(m, dest, filter="data")
elif name == "mv":
    args = [a for a in args if a != "-f"]
    if args[0] == "-T":
        os.replace(args[1], args[2])
    else:
        shutil.move(args[0], args[1])
''')
    stub.chmod(0o755)
    for name in ("sudo", "tar", "mv"):
        (tools / name).symlink_to(stub)
    git = ["git", "-C", str(repo), "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false"]
    subprocess.run(["git", "init", "-q", "-b", "main", str(repo)], check=True)

    def push(stable, ref="refs/heads/main"):
        (repo / "releases").mkdir(exist_ok=True)
        (repo / "firmware").mkdir(exist_ok=True)
        (repo / "releases/device-update.json").write_text(manifest(stable))
        (repo / "firmware/OS-OTA.bin").write_bytes(b"\0bin")
        (repo / "firmware/notes.txt").write_text("not published")
        subprocess.run([*git, "add", "-A"], check=True)
        subprocess.run([*git, "commit", "-q", "-m", "publish"], check=True)
        new = subprocess.run([*git, "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        env = {**os.environ, "PATH": f"{tools}{os.pathsep}{os.environ['PATH']}", "GIT_DIR": str(repo / ".git")}
        done = subprocess.run([str(runner)], input=f"{'0' * 40} {new} {ref}\n", env=env, capture_output=True, text=True)
        return new, done

    return {"out": out, "inbox": inbox, "push": push}


def reports(inbox):
    return [json.loads(p.read_text()) for p in sorted(inbox.glob("firmware-*.json"))] if inbox.exists() else []


def test_publish_is_unchanged(hook):
    new, done = hook["push"]({"version": "12.7.1", "sourceCommit": SOURCE})
    assert done.returncode == 0, done.stderr
    assert f"bambuhelper-updates: published {new[:7]}" in done.stdout
    current = hook["out"] / "current"
    assert os.readlink(current) == f"publish-{new}"
    assert (current / "releases/device-update.json").exists() and (current / "firmware/OS-OTA.bin").exists()
    assert not (current / "firmware/notes.txt").exists()


def test_publish_writes_a_firmware_report(hook):
    new, done = hook["push"]({"version": "12.7.1", "sourceCommit": SOURCE})
    assert done.returncode == 0, done.stderr
    [body] = reports(hook["inbox"])
    assert body["commit"] == SOURCE and body["version"] == "12.7.1"
    assert (body["target"], body["result"], body["mechanism"]) == ("firmware", "deployed", "ota-hook")
    assert body["message"] == f"Published Workshop OS 12.7.1 (publish {new[:7]})"
    assert releases.valid("firmware", body, time.time()) is not None
    assert not list(hook["inbox"].glob("*.tmp"))


def test_no_source_commit_publishes_without_a_report(hook):
    new, done = hook["push"]({"version": "12.7.1"})
    assert done.returncode == 0, done.stderr
    assert os.readlink(hook["out"] / "current") == f"publish-{new}"
    assert "bambuhelper-updates: no release report" in done.stdout
    assert reports(hook["inbox"]) == []


def test_other_branches_are_ignored(hook):
    _, done = hook["push"]({"version": "12.7.1", "sourceCommit": SOURCE}, ref="refs/heads/wip")
    assert done.returncode == 0 and done.stdout == ""
    assert not (hook["out"] / "current").exists() and reports(hook["inbox"]) == []
