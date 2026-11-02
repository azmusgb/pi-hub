"""deploy/deploy-key.sh with stub ssh and security: the key reaches its place on stdin only, never output or argv."""
import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
pytestmark = pytest.mark.skipif(not all(shutil.which(t) for t in ("openssl", "shasum", "iconv", "base64")),
                                reason="deploy-key.sh runs on the Mac; this host lacks its tools")
STUB = r'''
import os, pathlib, sys
log = pathlib.Path(os.environ["LOG"])
name = pathlib.Path(sys.argv[0]).name
n = len(list(log.glob("*.argv")))
data = sys.stdin.read() if not sys.stdin.isatty() else ""
(log / f"{n:02d}-{name}.argv").write_text("\0".join(sys.argv))
(log / f"{n:02d}-{name}.stdin").write_text(data)
cmd = " ".join(sys.argv[1:])
if name == "ssh" and "test -e" in cmd:
    sys.exit(0 if os.environ.get("EXISTS") else 1)
if name == "ssh" and "powershell" in cmd:
    print("placed")
'''


@pytest.fixture
def run(tmp_path):
    tools, log = tmp_path / "bin", tmp_path / "log"
    tools.mkdir(); log.mkdir()
    stub = tools / "stub"
    stub.write_text("#!" + sys.executable + "\n" + STUB)
    stub.chmod(0o755)
    for name in ("ssh", "security"):
        (tools / name).symlink_to(stub)

    def go(*args, exists=False):
        env = {**os.environ, "PATH": f"{tools}:{os.environ['PATH']}", "LOG": str(log), "EXISTS": "1" if exists else ""}
        r = subprocess.run(["bash", str(ROOT / "deploy/deploy-key.sh"), *args], env=env, capture_output=True, text=True,
                           stdin=subprocess.DEVNULL)
        calls = {p.stem: (p.read_text(), p.with_suffix(".stdin").read_text()) for p in sorted(log.glob("*.argv"))}
        return r, calls
    return go


@pytest.mark.parametrize("name", ["localai", "mac"])
def test_deploy_key_never_printed(run, name):
    r, calls = run(name)
    assert r.returncode == 0, r.stdout + r.stderr
    if name == "localai":
        [key] = [stdin for (argv, stdin) in calls.values() if "powershell" in argv]
    else:
        [line] = [stdin for k, (argv, stdin) in calls.items() if k.endswith("security")]
        key = line.rsplit(" ", 1)[1].strip()
    assert len(key) == 64 and all(c in "0123456789abcdef" for c in key)
    assert key not in r.stdout and key not in r.stderr
    for argv, _ in calls.values():
        assert key not in argv
    [hashed] = [stdin for (argv, stdin) in calls.values() if "deploy_keys" in argv and "mktemp" in argv]
    assert hashed.strip() == hashlib.sha256(key.encode()).hexdigest()
    assert "was not shown" in r.stdout


def test_existing_key_needs_rotate(run):
    r, calls = run("localai", exists=True)
    assert r.returncode == 1 and "--rotate" in r.stderr
    assert not any("powershell" in argv for argv, _ in calls.values())


def test_rotate_replaces(run):
    r, _ = run("localai", "--rotate", exists=True)
    assert r.returncode == 0, r.stderr


def test_unknown_name_is_refused(run):
    r, calls = run("pi-hub")
    assert r.returncode == 2 and calls == {}
