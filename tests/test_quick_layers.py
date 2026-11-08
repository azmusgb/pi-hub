"""A19 P5: the layers of a sliced Quick Print job, read from the sliced file. The parser on synthetic and real G-code, the
refusals, the sidecar and its lifecycle, and the owner-only routes."""
import io
import json
import time
import zipfile
from pathlib import Path

import pytest

from hub import db, quick, quick_layers
from test_quick_worker import GOOD_BLOCK, SAME, claimed, env, finish, new_job, push, sliced_file  # noqa: F401

HEAD = ["; HEADER", *GOOD_BLOCK, "; MACHINE_START_GCODE_END", "M83"]
REAL = Path(__file__).parent / "fixtures" / "quick-real-4-layers.gcode.3mf"


def plate(*layers: str, head=HEAD, tail=("; filament_ids = GFL99", "; machine_start_gcode = MS")) -> str:
    return "\n".join([*head, *layers, *tail, ""])


L0 = """; CHANGE_LAYER
; Z_HEIGHT: 0.2
; FEATURE: Outer wall
G1 X10 Y10 F3000
G1 X20 Y10 E1.5 F6000
G1 X20 Y20 E1.5
; FEATURE: Sparse infill
G1 X5 Y5 E-0.4
G1 X6 Y5 E0.1 F12000"""
L1 = """; CHANGE_LAYER
; Z_HEIGHT: 0.4
; FEATURE: Outer wall
G1 X30 Y30
G1 X40 Y30 E2"""


def read(text: str, tmp_path, name="p.3mf"):
    p = tmp_path / name
    p.write_bytes(sliced_file(text))
    side = tmp_path / (name + ".layers")
    st = quick_layers._new("k")
    quick_layers.parse(p, side, st)
    return st, side


def test_layers_are_read_with_their_figures(tmp_path):
    st, side = read(plate(L0, L1), tmp_path)
    assert st["state"] == "ready" and len(st["layers"]) == 2
    a, b = st["layers"]
    assert (a["z"], a["features"]) == (0.2, ["Outer wall", "Sparse infill"])
    assert a["extrusion_mm"] == pytest.approx(10 + 10 + 1, abs=0.01)  # two outer-wall legs and the 1 mm infill leg
    assert a["filament_mm"] == pytest.approx(1.5 + 1.5 + 0.1)
    assert a["speed"] == [100.0, 200.0]
    assert a["travel_mm"] == pytest.approx(14.14 + 21.21, abs=0.02)  # the move in from the origin and the retract move are travel
    assert b["z"] == 0.4 and b["extrusion_mm"] == pytest.approx(10) and b["filament_mm"] == 2
    assert st["bounds"] == [5.0, 5.0, 40.0, 30.0]  # extruded points only; the bare travel corner counts only where printing starts
    assert side.is_file() and quick_layers._summary_path(side).is_file()
    assert not side.with_name(side.name + ".part").exists()


def test_a_layer_has_its_own_geometry_and_travel_is_not_extrusion(tmp_path):
    st, side = read(plate(L0, L1), tmp_path)
    with open(side, "rb") as f:
        f.seek(st["offsets"][0])
        g = json.loads(f.readline())
    assert g["i"] == 0 and g["z"] == 0.2
    assert g["extrusion"][0] == {"f": "Outer wall", "s": 100.0, "p": [10.0, 10.0, 20.0, 10.0, 20.0, 20.0]}
    assert g["extrusion"][1]["f"] == "Sparse infill"
    assert g["travel"] == [[0.0, 0.0, 10.0, 10.0], [20.0, 20.0, 5.0, 5.0]]  # the wipe/retract move is travel


def test_a_speed_change_starts_a_new_run_so_each_run_has_one_speed(tmp_path):
    st, side = read(plate(L0), tmp_path)
    with open(side, "rb") as f:
        g = json.loads(f.readline())
    assert [r["s"] for r in g["extrusion"]][0] == 100.0 and len(g["extrusion"]) == 2


def test_absolute_extrusion_is_unavailable_not_guessed(tmp_path):
    st, side = read(plate(L0, head=[*HEAD[:-1], "M82"]), tmp_path)
    assert st["state"] == "unavailable" and "absolute" in st["reason"]
    assert not side.exists() and not side.with_name(side.name + ".part").exists()


def test_no_layer_markers_is_unavailable(tmp_path):
    st, _ = read(plate("G1 X1 Y1 E1"), tmp_path)
    assert st["state"] == "unavailable"


def test_a_file_that_is_not_a_plate_fails_closed(tmp_path):
    p = tmp_path / "x.3mf"
    p.write_bytes(b"not a zip")
    st = quick_layers._new("k")
    quick_layers.parse(p, tmp_path / "x.3mf.layers", st)
    assert st["state"] == "failed" and "couldn't be read" in st["reason"]
    assert not list(tmp_path.glob("*.layers*"))


def test_layers_past_the_cap_are_said_not_drawn(tmp_path, monkeypatch):
    monkeypatch.setattr(quick_layers, "MAX_LAYERS", 1)
    st, _ = read(plate(L0, L1), tmp_path)
    assert st["state"] == "ready" and len(st["layers"]) == 1 and "first 1 layers" in st["truncated"]


def test_a_time_budget_keeps_what_was_read(tmp_path, monkeypatch):
    monkeypatch.setattr(quick_layers, "BUDGET_SECONDS", -1)
    body = "\n".join(["G1 X1 Y1 E0.1"] * 20001 + ["; CHANGE_LAYER", "; Z_HEIGHT: 0.6", "G1 X2 Y2 E0.1"])
    st, _ = read(plate(L0, body), tmp_path)
    assert st["state"] == "ready" and "stopped after" in st["truncated"] and len(st["layers"]) >= 1


def test_a_real_studio_file_gives_four_layers_with_real_geometry(tmp_path):
    side = tmp_path / "real.layers"
    st = quick_layers._new("k")
    quick_layers.parse(REAL, side, st)
    assert st["state"] == "ready" and len(st["layers"]) == 4
    l0 = st["layers"][0]
    assert l0["z"] == 0.2 and l0["extrusion_mm"] > 1000 and "Outer wall" in l0["features"]
    assert l0["speed"] and l0["speed"][0] > 0
    x0, y0, x1, y1 = st["bounds"]
    assert 100 < x0 < x1 < 200 and 0 < y0 < y1 < 300


# --- routes ----------------------------------------------------------------------------------------------------

def slice_ok(c, text: str) -> str:
    jid = new_job(c)
    j = claimed(c)
    data = sliced_file(text)
    assert push(c, j, data).status_code == 200
    assert finish(c, j, data).status_code == 200
    assert db.one("SELECT state FROM quick_jobs WHERE id = ?", jid)["state"] == "sliced"
    return jid


def wait_ready(c, jid, tries=100):
    for _ in range(tries):
        r = c.get(f"/api/quick/jobs/{jid}/layers")
        assert r.status_code == 200, r.text
        if r.json()["state"] != "building":
            return r.json()
        time.sleep(0.05)
    raise AssertionError("never finished")


@pytest.fixture(autouse=True)
def fresh_builds():
    quick_layers._builds.clear()
    yield
    quick_layers._builds.clear()


def test_the_summary_and_one_layer_are_served_to_the_owner(env):
    jid = slice_ok(env, plate(L0, L1))
    s = wait_ready(env, jid)
    assert s["state"] == "ready" and [x["z"] for x in s["layers"]] == [0.2, 0.4] and s["progress"] == 1.0
    g = env.get(f"/api/quick/jobs/{jid}/layers/1").json()
    assert g["z"] == 0.4 and g["extrusion"][0]["p"] == [30.0, 30.0, 40.0, 30.0]
    assert env.get(f"/api/quick/jobs/{jid}/layers/2").status_code == 404
    assert env.get(f"/api/quick/jobs/{jid}/layers/-1").status_code == 404


def test_layers_need_the_owner(env):
    jid = slice_ok(env, plate(L0))
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    anon = TestClient(hub_app.app)
    assert anon.get(f"/api/quick/jobs/{jid}/layers").status_code in (401, 403)
    assert anon.get(f"/api/quick/jobs/{jid}/layers/0").status_code in (401, 403)


def test_a_job_without_a_slice_says_so(env):
    jid = new_job(env, queue=False)
    r = env.get(f"/api/quick/jobs/{jid}/layers")
    assert r.status_code == 200 and r.json()["state"] == "none" and r.json()["layers"] == []
    assert env.get("/api/quick/jobs/nope/layers").status_code == 404


def test_a_restart_loads_the_summary_from_the_sidecar_without_a_new_pass(env, monkeypatch):
    jid = slice_ok(env, plate(L0, L1))
    wait_ready(env, jid)
    quick_layers._builds.clear()
    monkeypatch.setattr(quick_layers, "parse", lambda *a, **k: (_ for _ in ()).throw(AssertionError("re-read")))
    assert env.get(f"/api/quick/jobs/{jid}/layers").json()["state"] == "ready"
    assert env.get(f"/api/quick/jobs/{jid}/layers/0").json()["z"] == 0.2


def test_a_new_slice_is_read_afresh_not_from_the_old_one(env):
    jid = slice_ok(env, plate(L0, L1))
    wait_ready(env, jid)
    job = quick.get(jid)
    b = quick_layers._builds[jid]
    assert b["key"] == job["slice_sha256"]
    quick_layers._builds[jid]["key"] = "someone-elses-sha"
    r = env.get(f"/api/quick/jobs/{jid}/layers")
    assert r.status_code == 200 and quick_layers._builds[jid]["key"] == job["slice_sha256"]


def test_evicting_a_slice_takes_its_sidecars_and_sweep_removes_orphans(env):
    jid = slice_ok(env, plate(L0, L1))
    wait_ready(env, jid)
    job = quick.get(jid)
    side = quick_layers.sidecar_path(job)
    assert side.is_file() and quick_layers._summary_path(side).is_file()
    db.run("UPDATE quick_jobs SET updated = 0 WHERE id = ?", jid)
    assert quick.evict(10 ** 9, now=time.time() + 10 ** 7) > 0
    assert not side.exists() and not quick_layers._summary_path(side).exists()
    orphan = quick.QUICK_DIR / "slices" / "gone.3mf.layers"
    orphan.write_text("x")
    quick.sweep()
    assert not orphan.exists()


def test_the_sidecar_counts_toward_the_quota(env):
    jid = slice_ok(env, plate(L0, L1))
    before = quick.usage()["files"]
    wait_ready(env, jid)
    assert quick.usage()["files"] > before
