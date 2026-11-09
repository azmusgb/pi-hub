"""A19 P9: HUB_QUICK=0 removes Quick Print and leaves the rest of the hub as it was. The app is started in a fresh
interpreter each way, since the switch is read once when it is imported."""
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = """
import json, os, sys
sys.path.insert(0, os.environ["REPO"])
from fastapi.testclient import TestClient
from hub import app
c = TestClient(app.app)
paths = ["/api/quick/jobs", "/api/quick/storage", "/api/lab/quick/worker/claim", "/api/quick/jobs/aaaaaaaaaaaaaaaa/monitor"]
quick = {p: c.get(p).status_code for p in paths}
other = {p: c.get(p).status_code for p in ["/api/lab/projects", "/api/health", "/sw.js"]}
print(json.dumps({"quick": quick, "other": other, "routes": sorted(r.path for r in app.app.routes if "quick" in getattr(r, "path", ""))}))
"""


def run(flag: str | None, tmp_path) -> dict:
    env = {**os.environ, "HUB_NO_SAMPLER": "1", "HUB_DB": str(tmp_path / "hub.db"), "HUB_LAB_DIR": str(tmp_path / "lab"),
           "HUB_QUICK_DIR": str(tmp_path / "quick"), "REPO": str(ROOT)}
    env.pop("HUB_QUICK", None)
    if flag is not None:
        env["HUB_QUICK"] = flag
    out = subprocess.run([sys.executable, "-I", "-c", PROBE], cwd=ROOT, env=env, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-800:]
    return json.loads(out.stdout.strip().splitlines()[-1])


def test_the_switch_removes_every_quick_route_and_nothing_else(tmp_path):
    on = run(None, tmp_path / "on")
    off = run("0", tmp_path / "off")
    assert any("/quick/" in r or r.startswith("/api/quick") for r in on["routes"])
    assert off["routes"] == [] and all(code == 404 for code in off["quick"].values()), off
    assert off["other"] == on["other"], (on["other"], off["other"])  # the experiment routes answer exactly as before


def test_any_other_value_leaves_it_on(tmp_path):
    assert run("1", tmp_path)["routes"]
