"""A19 P7: the 3D view's server side and its guards. The model route, the plate read from the file's own config lines, the
vendored Three.js matching its recorded hashes, and the 3D module being loaded by the Quick Print page and nowhere else."""
import hashlib
import re
from pathlib import Path

import pytest

from hub import db, quick
from test_quick_layers import HEAD, L0, L1, fresh_builds, plate, slice_ok, wait_ready  # noqa: F401
from test_quick_worker import SAME, env  # noqa: F401

STATIC = Path(__file__).parent.parent / "hub" / "static"
VENDOR = STATIC / "vendor" / "three-0.187.0"
CONFIG = ["; printable_area = 0x0,256x0,256x256,0x256", "; printable_height = 261", "; filament_ids = GFL99",
          "; machine_start_gcode = MS"]


def test_the_plate_comes_from_the_files_own_config_lines(env):
    jid = slice_ok(env, plate(L0, L1, tail=CONFIG))
    s = wait_ready(env, jid)
    assert s["plate"] == {"area": [0.0, 0.0, 256.0, 256.0], "height": 261.0}


def test_a_file_without_plate_lines_reports_none_not_a_guess(env):
    s = wait_ready(env, slice_ok(env, plate(L0, L1)))
    assert s["plate"] == {}


@pytest.mark.parametrize("line", [b"; printable_area = 0x0,5000x0,5000x5000", b"; printable_area = a,b,c",
                                  b"; printable_area = 0x0,1x1", b"; printable_height = -4", b"; printable_height = x"])
def test_a_nonsense_plate_line_is_dropped(line):
    from hub import quick_layers
    st = {"plate": {}}
    quick_layers._plate(st, line)
    assert st["plate"] == {}


def stl_job(env):
    from test_quick_worker import new_job
    return new_job(env, queue=False)


def test_the_model_route_serves_an_stl_to_the_owner_only(env):
    jid = stl_job(env)
    r = env.get(f"/api/quick/jobs/{jid}/model")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert r.content == quick.model_path(quick.get(jid)).read_bytes()
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    assert TestClient(hub_app.app).get(f"/api/quick/jobs/{jid}/model").status_code in (401, 403)


def test_the_model_route_says_so_when_there_is_no_stl(env):
    jid = stl_job(env)
    p = quick.model_path(quick.get(jid))
    p.rename(p.with_suffix(".3mf"))
    db.run("UPDATE quick_jobs SET model_file = ? WHERE id = ?", p.with_suffix(".3mf").name, jid)
    assert env.get(f"/api/quick/jobs/{jid}/model").status_code == 404
    db.run("UPDATE quick_jobs SET file_removed = 1 WHERE id = ?", jid)
    assert env.get(f"/api/quick/jobs/{jid}/model").status_code == 404
    assert env.get("/api/quick/jobs/nope/model").status_code == 404


def test_the_vendored_three_matches_its_recorded_hashes():
    readme = (VENDOR / "README.md").read_text()
    rows = re.findall(r"\| `([\w.]+)` \|.*?\| `([0-9a-f]{64})` \|$", readme, re.M)
    assert {n for n, _ in rows} == {"three.module.js", "three.core.js", "LICENSE", "OrbitControls.js"}
    for name, digest in rows:
        assert hashlib.sha256((VENDOR / name).read_bytes()).hexdigest() == digest, name
    assert "0.187.0" in readme and "MIT" in readme and "registry.npmjs.org/three/-/three-0.187.0.tgz" in readme
    assert "from './three.module.js';" in (VENDOR / "OrbitControls.js").read_text()


def test_only_the_quick_print_page_loads_the_3d_module():
    allowed = {"quick.js", "quick.css", "quick-3d.js", "quick-3d-data.js", "sw.js"}
    for p in STATIC.rglob("*"):
        if not p.is_file() or p.suffix not in (".js", ".html", ".css", ".webmanifest") or "vendor" in p.parts:
            continue
        text = p.read_text(errors="ignore")
        if p.name in allowed:
            continue
        assert "quick-3d" not in text and "vendor/three" not in text, f"{p.relative_to(STATIC)} reaches the 3D module"
    assert not re.search(r"^\s*import[^\n]*quick-3d", (STATIC / "js" / "quick.js").read_text(), re.M), "quick.js must import it lazily"
    assert 'import("./quick-3d.js")' in (STATIC / "js" / "quick.js").read_text()
    # the shell's own page list never mentions three
    assert "three" not in (STATIC / "index.html").read_text().lower()


def test_the_3d_files_never_touch_a_print_action():
    for name in ("quick-3d.js", "quick-3d-data.js"):
        text = (STATIC / "js" / name).read_text()
        assert not re.search(r"method:\s*[\"'](POST|PUT|PATCH|DELETE)|post\(|/start|/prepare|/slice|/cancel|/resolve", text), name
