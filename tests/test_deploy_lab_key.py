import hashlib
import os
import re
import stat
import subprocess
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "deploy/lab-key.sh"


def run(tmp_path, *args):
    env = {**os.environ, "LAB_KEY_HASH_FILE": str(tmp_path / "secrets/lab_mac_key.sha256"),
           "LAB_KEY_SKIP_CHOWN": "1", "LAB_KEY_ALLOW_NON_ROOT": "1"}
    return subprocess.run(["bash", str(SCRIPT), *args], capture_output=True, text=True, env=env, timeout=20)


def test_syntax():
    assert subprocess.run(["bash", "-n", str(SCRIPT)]).returncode == 0


def test_writes_only_the_hash_and_prints_the_key_once(tmp_path):
    r = run(tmp_path)
    assert r.returncode == 0, r.stderr
    f = tmp_path / "secrets/lab_mac_key.sha256"
    key = re.search(r"^KEY: ([0-9a-f]{64})$", r.stdout, re.M).group(1)
    assert f.read_text().strip() == hashlib.sha256(key.encode()).hexdigest()
    assert key not in f.read_text()
    assert stat.S_IMODE(f.stat().st_mode) == 0o640
    assert "~/.config/print-lab/hub.key" in r.stdout and "0600" in r.stdout


def test_refuses_to_overwrite_without_rotate(tmp_path):
    run(tmp_path)
    f = tmp_path / "secrets/lab_mac_key.sha256"
    before = f.read_text()
    r = run(tmp_path)
    assert r.returncode != 0 and "--rotate" in r.stderr
    assert f.read_text() == before
    r = run(tmp_path, "--rotate")
    assert r.returncode == 0 and f.read_text() != before
