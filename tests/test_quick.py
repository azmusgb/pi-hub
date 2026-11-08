"""A19 P2: Quick Print jobs, model uploads, the allowed state changes, stale inputs, storage rules and retention.
No page, no Mac, no Bambuddy yet. Owner only."""
import io
import os
import struct
import tempfile
import time
import zipfile

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("QUIC-4321\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, auth, db, lab, quick  # noqa: E402

SAME = {"Origin": "http://testserver"}
OCT = {**SAME, "Content-Type": "application/octet-stream"}
GIB = 1024 ** 3


@pytest.fixture
def env(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    os.environ["HUB_LAB_DIR"] = str(tmp_path / "lab")
    auth._tries.clear()
    lab._ready_dbs.clear()
    quick._ready_dbs.clear()
    monkeypatch.setattr(quick, "QUICK_DIR", tmp_path / "quick")
    monkeypatch.setattr(quick, "CHUNK", 1024)
    monkeypatch.setattr(quick, "free_bytes", lambda: 100 * GIB)  # plenty unless a test says otherwise
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "QUIC-4321", "owner_password": "long enough"}, headers=SAME).status_code == 200
    return c


def stl(n=2) -> bytes:
    body = b"".join(struct.pack("<12fH", 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0) for _ in range(n))
    return b"\0" * 80 + struct.pack("<I", n) + body


def three_mf(extra=None, model=b"<model/>") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("3D/3dmodel.model", model)
        for k, v in (extra or {}).items():
            z.writestr(k, v)
    return buf.getvalue()


def send(c, data: bytes, name="part.stl", expect_start=200):
    r = c.post("/api/quick/uploads", json={"filename": name, "size": len(data)}, headers=SAME)
    assert r.status_code == expect_start, r.text
    if r.status_code != 200:
        return r
    uid, off, last = r.json()["id"], 0, None
    while off < len(data):
        last = c.put(f"/api/quick/uploads/{uid}?offset={off}", content=data[off:off + 1024], headers=OCT)
        if last.status_code != 200:
            return last
        off = last.json()["offset"]
    return last


def upload(c, data=None, name="part.stl") -> dict:
    r = send(c, data or stl(), name)
    assert r.status_code == 200 and r.json()["done"], r.text
    return r.json()["job"]


def raw_job(job_id):
    return db.one("SELECT * FROM quick_jobs WHERE id = ?", job_id)


def force(job_id, **cols):
    db.run(f"UPDATE quick_jobs SET {', '.join(k + ' = ?' for k in cols)} WHERE id = ?", *cols.values(), job_id)


# --- Q1/Q10: its own record ------------------------------------------------------------------------------------

def test_a_job_has_no_experiment_run_budget_or_verdict(env):
    j = upload(env)
    assert j["state"] == "draft" and j["name"] == "part.stl"
    cols = set(raw_job(j["id"]))
    assert not {"experiment", "run", "budget", "verdict", "project"} & cols
    assert "model_file" not in j  # the page never sees a server path


def test_quick_is_not_a_project_and_no_experiment_route_takes_it(env):
    assert env.get("/api/lab/projects").json() == {"projects": []}
    db.conn().executescript(lab.DB_SCHEMA)
    db.run("INSERT INTO lab_projects (project, meta, index_json, synced_at) VALUES ('quick', '{}', '{}', 'x')")
    assert env.get("/api/lab/projects").json() == {"projects": []}  # never listed, even if a row got there
    with pytest.raises(Exception, match="Invalid project name"):
        lab.check_project("quick")  # the guard every project route, including the Mac's sync, runs
    for method, path in (("get", "/api/lab/quick"), ("get", "/api/lab/quick/requests"),
                         ("post", "/api/lab/quick/requests"), ("get", "/api/lab/quick/photos")):
        r = getattr(env, method)(path, headers=SAME)
        assert r.status_code in (400, 404, 405), (path, r.status_code)
    with pytest.raises(Exception):
        lab.queue_request("quick", {"id": "rq-0123456789abcdef", "kind": "slice", "experiment": "E-001", "run": "E-001-01"}, "x")
    with pytest.raises(Exception):
        hub_app._start_target("quick", "E-001")


def test_owner_only(env):
    j = upload(env)
    env.cookies.clear()
    for r in (env.get("/api/quick/jobs"), env.get(f"/api/quick/jobs/{j['id']}"), env.get("/api/quick/storage"),
              env.post("/api/quick/uploads", json={"filename": "a.stl", "size": 10}, headers=SAME),
              env.post(f"/api/quick/jobs/{j['id']}/cancel", headers=SAME)):
        assert r.status_code == 401


# --- upload: each rejection ------------------------------------------------------------------------------------

def test_a_whole_upload_becomes_a_draft_and_the_file_is_in_place(env, tmp_path):
    data = stl(30)
    j = upload(env, data)
    p = quick.model_path(raw_job(j["id"]))
    assert p.read_bytes() == data and j["model_bytes"] == len(data)
    assert not list((tmp_path / "quick" / "tmp").iterdir())
    assert db.one("SELECT COUNT(*) AS n FROM quick_uploads")["n"] == 0
    assert env.get("/api/quick/jobs").json()["jobs"][0]["id"] == j["id"]


def test_resume_after_an_interruption(env):
    data = stl(40)
    uid = env.post("/api/quick/uploads", json={"filename": "a.stl", "size": len(data)}, headers=SAME).json()["id"]
    assert env.put(f"/api/quick/uploads/{uid}?offset=0", content=data[:1024], headers=OCT).status_code == 200
    assert env.get(f"/api/quick/uploads/{uid}").json()["offset"] == 1024
    r = env.put(f"/api/quick/uploads/{uid}?offset=0", content=data[:1024], headers=OCT)
    assert r.status_code == 409 and r.json()["offset"] == 1024
    off = 1024
    while off < len(data):
        r = env.put(f"/api/quick/uploads/{uid}?offset={off}", content=data[off:off + 1024], headers=OCT)
        off = r.json()["offset"]
    assert r.json()["done"] is True


@pytest.mark.parametrize("name,body,why", [
    ("a.stl", b"", "size"),
    ("a.obj", b"x" * 10, "Only STL"),
    ("a.stl", b"hello world" * 20, "valid STL"),                 # wrong magic with a .stl name
    ("a.stl", stl(3)[:-10], "valid STL"),                          # truncated
    ("a.stl", b"\0" * 80 + struct.pack("<I", 0), "valid STL"),     # zero triangles
    ("a.stl", b"\0" * 80 + struct.pack("<I", 1) + struct.pack("<12fH", float("nan"), *([0] * 11), 0), "numbers"),
    ("a.3mf", b"not a zip at all", "valid 3MF"),
    ("a.3mf", three_mf({"../evil.txt": "x"}), "unsafe path"),
    ("a.3mf", three_mf({"/abs.txt": "x"}), "unsafe path"),
    ("a.3mf", three_mf({"a\\b.txt": "x"}), "unsafe path"),
    ("a.3mf", three_mf({"_rels/.rels": '<Relationship Target="http://x.example/a.model"/>'}), "outside itself"),
    ("a.3mf", three_mf({"_rels/.rels": '<Relationship Target="/../../etc/passwd"/>'}), "outside itself"),
    ("a.3mf", three_mf(model=b'<component p:path="//server/share/a.model"/>'), "outside itself"),
])
def test_each_rejection_leaves_nothing_behind(env, tmp_path, name, body, why):
    if not body:
        r = env.post("/api/quick/uploads", json={"filename": name, "size": 0}, headers=SAME)
        assert r.status_code == 400
        return
    r = send(env, body, name, expect_start=200 if name != "a.obj" else 400)
    quick.ready()
    assert r.status_code in (400, 422) and why in r.json()["detail"]
    assert db.one("SELECT COUNT(*) AS n FROM quick_jobs")["n"] == 0
    assert db.one("SELECT COUNT(*) AS n FROM quick_uploads")["n"] == 0
    for d in ("tmp", "models"):
        assert not list((tmp_path / "quick" / d).glob("*")) if (tmp_path / "quick" / d).exists() else True


def test_symlink_entry_is_refused(env):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("3D/3dmodel.model", "<model/>")
        zi = zipfile.ZipInfo("link.txt")
        zi.external_attr = (0o120777 << 16)
        z.writestr(zi, "/etc/passwd")
    r = send(env, buf.getvalue(), "a.3mf")
    assert r.status_code == 422 and "symbolic" in r.json()["detail"]


def test_zip_bomb_and_too_many_entries(env, monkeypatch):
    monkeypatch.setattr(quick, "MAX_EXPANDED", 10_000)
    r = send(env, three_mf({"big.bin": b"0" * 50_000}), "a.3mf")
    assert r.status_code == 422 and "unpack" in r.json()["detail"]
    monkeypatch.setattr(quick, "MAX_EXPANDED", 200 * 1024 ** 2)
    monkeypatch.setattr(quick, "MAX_ENTRIES", 5)
    r = send(env, three_mf({f"f{i}.txt": "x" for i in range(10)}), "b.3mf")
    assert r.status_code == 422 and "more than" in r.json()["detail"]


def _forge_sizes(data: bytes, size: int) -> bytes:
    """The same archive claiming every entry is `size` bytes, in both the local and the central headers."""
    b = bytearray(data)
    for sig, off in ((b"PK\x03\x04", 22), (b"PK\x01\x02", 24)):
        i = b.find(sig)
        while i >= 0:
            b[i + off:i + off + 4] = struct.pack("<I", size)
            i = b.find(sig, i + 4)
    return bytes(b)


def test_declared_sizes_are_not_trusted(env, monkeypatch):
    monkeypatch.setattr(quick, "MAX_EXPANDED", 100_000)
    bomb = three_mf({"big.bin": b"0" * 300_000})  # compresses to a few hundred bytes, unpacks to 300 KB, three times the budget
    r = send(env, _forge_sizes(bomb, 10), "a.3mf")
    assert r.status_code == 422, r.text
    assert quick.usage()["files"] == 0 and db.one("SELECT COUNT(*) AS n FROM quick_jobs")["n"] == 0
    # an honest archive over the budget is refused by the unpacking too, not only by its header
    monkeypatch.setattr(quick, "MAX_EXPANDED", 200_000)
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as w:
        w.writestr("3D/3dmodel.model", "<model/>")
        w.writestr("a.bin", b"0" * 150_000)
        w.writestr("b.bin", b"1" * 150_000)
    assert send(env, _forge_sizes(z.getvalue(), 10), "b.3mf").status_code == 422


def test_a_3mf_with_no_model_is_refused(env):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("readme.txt", "hi")
    assert "no 3D model" in send(env, buf.getvalue(), "a.3mf").json()["detail"]


def test_a_good_3mf_and_an_ascii_stl_are_accepted(env):
    assert upload(env, three_mf(), "a.3mf")["state"] == "draft"
    ascii_stl = b"solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n"
    assert upload(env, ascii_stl, "b.stl")["state"] == "draft"


def test_oversize_declared_or_streamed_is_refused(env, monkeypatch):
    monkeypatch.setattr(quick, "MAX_MODEL", 2000)
    assert env.post("/api/quick/uploads", json={"filename": "a.stl", "size": 5000}, headers=SAME).status_code == 400
    uid = env.post("/api/quick/uploads", json={"filename": "a.stl", "size": 1500}, headers=SAME).json()["id"]
    r = env.put(f"/api/quick/uploads/{uid}?offset=0", content=b"x" * 1024 + b"y" * 1000, headers=OCT)
    assert r.status_code == 413
    assert env.get(f"/api/quick/uploads/{uid}").json()["offset"] == 0  # the oversize piece was dropped whole


def test_duplicate_upload_points_at_the_existing_job(env):
    j = upload(env)
    r = send(env, stl(), "again.stl")
    assert r.status_code == 409 and r.json()["duplicate_of"] == j["id"]
    assert db.one("SELECT COUNT(*) AS n FROM quick_jobs")["n"] == 1
    env.post(f"/api/quick/jobs/{j['id']}/cancel", headers=SAME)
    assert send(env, stl(), "again.stl").status_code == 200  # a canceled one doesn't block a fresh upload


def test_canceling_an_upload_removes_it(env, tmp_path):
    uid = env.post("/api/quick/uploads", json={"filename": "a.stl", "size": 3000}, headers=SAME).json()["id"]
    env.put(f"/api/quick/uploads/{uid}?offset=0", content=b"x" * 1024, headers=OCT)
    assert env.delete(f"/api/quick/uploads/{uid}", headers=SAME).status_code == 200
    assert env.get(f"/api/quick/uploads/{uid}").status_code == 404
    assert not list((tmp_path / "quick" / "tmp").iterdir())


# --- Q7: states ------------------------------------------------------------------------------------------------

LEGAL = [(a, b) for a, tos in quick.ALLOWED.items() for b in tos]


@pytest.mark.parametrize("a,b", LEGAL)
def test_every_legal_transition(env, a, b):
    j = upload(env, stl(3), "t.stl")["id"]
    force(j, state=a, slice_sha256="a" * 64, sliced_hash=raw_job(j)["request_hash"])
    assert quick.transition(j, b)["state"] == b


def test_every_illegal_transition_is_refused(env):
    """Every state pair the table doesn't allow, on one job (set up once: a job per pair made the suite slow on the Pi)."""
    j = upload(env, stl(3), "t.stl")["id"]
    pairs = [(a, b) for a in quick.STATES for b in quick.STATES if b not in quick.ALLOWED[a]]
    assert len(pairs) > 50
    for a, b in pairs:
        force(j, state=a, slice_sha256="a" * 64, sliced_hash=raw_job(j)["request_hash"])
        with pytest.raises(quick.QuickError) as e:
            quick.transition(j, b)
        assert e.value.status == 409 and raw_job(j)["state"] == a, f"{a} -> {b}"


def test_compare_and_set_stops_a_second_mover(env):
    j = upload(env)["id"]
    quick.transition(j, "ready_to_slice", expect="draft")
    with pytest.raises(quick.QuickError, match="not draft"):
        quick.transition(j, "ready_to_slice", expect="draft")


@pytest.mark.parametrize("state", ["failed", "stale", "canceled", "needs_attention"])
def test_a_failed_stale_or_canceled_job_cannot_be_staged_or_started(env, state):
    j = upload(env)["id"]
    force(j, state=state, slice_sha256="a" * 64, sliced_hash=raw_job(j)["request_hash"])
    for to in ("staging", "staged", "queued_in_bambuddy", "start_requested", "start_accepted", "printing_confirmed"):
        with pytest.raises(quick.QuickError):
            quick.transition(j, to)


def test_staging_needs_a_current_stored_slice(env):
    j = upload(env)["id"]
    force(j, state="sliced")
    with pytest.raises(quick.QuickError, match="needs a new slice"):  # no slice sha recorded
        quick.transition(j, "staging")
    force(j, slice_sha256="a" * 64, sliced_hash="old")
    with pytest.raises(quick.QuickError, match="needs a new slice"):  # sliced from other inputs
        quick.transition(j, "staging")
    force(j, sliced_hash=raw_job(j)["request_hash"], file_removed=1)
    with pytest.raises(quick.QuickError, match="needs a new slice"):  # file gone
        quick.transition(j, "staging")


def test_unknown_state_or_field_is_refused(env):
    j = upload(env)["id"]
    with pytest.raises(quick.QuickError):
        quick.transition(j, "printing")
    with pytest.raises(quick.QuickError):
        quick.transition(j, "ready_to_slice", model_sha256="x")


# --- stale by input --------------------------------------------------------------------------------------------

def sliced_job(env):
    j = upload(env)["id"]
    h = raw_job(j)["request_hash"]
    force(j, state="sliced", slice_sha256="a" * 64, sliced_hash=h)
    return j


@pytest.mark.parametrize("edit", [{"settings": {"wall_loops": 4}}, {"transform": [1] * 15 + [2]}])
def test_changing_transform_or_settings_makes_a_slice_stale(env, edit):
    j = sliced_job(env)
    r = env.patch(f"/api/quick/jobs/{j}", json=edit, headers=SAME)
    assert r.status_code == 200 and r.json()["state"] == "stale" and "changed" in r.json()["reason"]
    with pytest.raises(quick.QuickError):
        quick.transition(j, "staging")


def test_a_changed_model_is_a_new_hash_and_so_stale(env):
    j = sliced_job(env)
    force(j, model_sha256="f" * 64)
    assert quick.request_hash("f" * 64, None, {}) != raw_job(j)["sliced_hash"]
    assert quick.request_hash("a" * 64, None, {}) != quick.request_hash("b" * 64, None, {})


def test_an_edit_that_changes_nothing_keeps_the_slice(env):
    j = sliced_job(env)
    assert env.patch(f"/api/quick/jobs/{j}", json={"settings": {}}, headers=SAME).json()["state"] == "sliced"


def test_a_staged_slice_goes_stale_too(env):
    j = sliced_job(env)
    force(j, state="staged")
    assert env.patch(f"/api/quick/jobs/{j}", json={"settings": {"layer_height": 0.12}}, headers=SAME).json()["state"] == "stale"


def test_a_draft_just_takes_the_edit(env):
    j = upload(env)["id"]
    r = env.patch(f"/api/quick/jobs/{j}", json={"settings": {"wall_loops": 3}, "transform": None}, headers=SAME)
    assert r.json()["state"] == "draft" and r.json()["settings"] == {"wall_loops": 3}


@pytest.mark.parametrize("state", ["queued", "preparing", "slicing", "validating", "staging", "queued_in_bambuddy",
                                   "start_requested", "start_accepted", "printing_confirmed", "outcome_uncertain", "canceled"])
def test_no_edit_while_in_flight_or_after_a_start(env, state):
    j = upload(env)["id"]
    force(j, state=state)
    r = env.patch(f"/api/quick/jobs/{j}", json={"settings": {"wall_loops": 3}}, headers=SAME)
    assert r.status_code == 409 and raw_job(j)["settings"] == "{}"


@pytest.mark.parametrize("body", [{}, {"settings": []}, {"settings": {"Bad Key": 1}}, {"settings": {"a": [1]}},
                                  {"settings": {"a": float("inf")}}, {"transform": [1, 2]}, {"transform": "x"},
                                  {"transform": [float("nan")] * 16}, {"settings": {f"k{i}": 1 for i in range(30)}}])
def test_bad_edits_are_refused(env, body):
    import json as _json
    j = upload(env)["id"]
    r = env.patch(f"/api/quick/jobs/{j}", content=_json.dumps(body).replace("Infinity", "1e999"), headers={**SAME, "Content-Type": "application/json"})
    assert r.status_code == 400


# --- storage ---------------------------------------------------------------------------------------------------

def test_quota_counts_partial_uploads_and_two_at_once_cannot_both_pass(env, monkeypatch):
    monkeypatch.setattr(quick, "QUOTA", 5000)
    a = env.post("/api/quick/uploads", json={"filename": "a.stl", "size": 3000}, headers=SAME)
    assert a.status_code == 200
    b = env.post("/api/quick/uploads", json={"filename": "b.stl", "size": 3000}, headers=SAME)
    assert b.status_code == 507 and "full" in b.json()["detail"]
    assert quick.usage()["uploads"] == 3000  # declared, though nothing has arrived
    assert env.post("/api/quick/uploads", json={"filename": "c.stl", "size": 2000}, headers=SAME).status_code == 200


def test_a_claimed_slice_reserves_its_ceiling(env, monkeypatch):
    monkeypatch.setattr(quick, "QUOTA", 5000)
    j = upload(env, stl(3), "a.stl")["id"]
    force(j, state="slicing", slice_reserved=4000)
    assert quick.usage()["slices"] == 4000
    assert env.post("/api/quick/uploads", json={"filename": "b.stl", "size": 3000}, headers=SAME).status_code == 507


def test_a_large_scratch_counts_beyond_its_reservation(env, tmp_path, monkeypatch):
    j = upload(env, stl(3), "a.stl")["id"]
    force(j, state="slicing", slice_reserved=100)
    scratch = tmp_path / "quick" / "scratch" / j
    scratch.mkdir(parents=True)
    (scratch / "big").write_bytes(b"x" * 9000)
    assert quick.usage()["slices"] == 9000


def test_low_free_space_refuses_with_the_reason_and_deletes_nothing_in_flight(env, tmp_path, monkeypatch):
    j = upload(env, stl(3), "a.stl")["id"]
    force(j, state="slicing")  # in flight: protected
    p = quick.model_path(raw_job(j))
    monkeypatch.setattr(quick, "free_bytes", lambda: quick.RESERVE + 100)
    r = env.post("/api/quick/uploads", json={"filename": "b.stl", "size": 5000}, headers=SAME)
    assert r.status_code == 507 and "keeps" in r.json()["detail"] and "free" in r.json()["detail"]
    assert p.exists() and raw_job(j)["file_removed"] == 0
    assert db.one("SELECT COUNT(*) AS n FROM quick_uploads")["n"] == 0


def test_the_quota_never_overrides_the_os_reserve(env, monkeypatch):
    monkeypatch.setattr(quick, "free_bytes", lambda: quick.RESERVE)  # exactly at the reserve: nothing more fits
    assert env.post("/api/quick/uploads", json={"filename": "b.stl", "size": 1}, headers=SAME).status_code == 507


def test_abandoned_temp_files_go_after_an_hour_and_finished_files_stay(env, tmp_path):
    j = upload(env, stl(3), "keep.stl")["id"]
    uid = env.post("/api/quick/uploads", json={"filename": "a.stl", "size": 3000}, headers=SAME).json()["id"]
    env.put(f"/api/quick/uploads/{uid}?offset=0", content=b"x" * 500, headers=OCT)
    (tmp_path / "quick" / "tmp" / "orphan.part").write_bytes(b"x")
    quick.sweep(now=time.time() + 1800)
    assert env.get(f"/api/quick/uploads/{uid}").status_code == 200  # half an hour: still there
    quick.sweep(now=time.time() + 3700)
    assert env.get(f"/api/quick/uploads/{uid}").status_code == 404
    assert not list((tmp_path / "quick" / "tmp").iterdir())
    assert quick.model_path(raw_job(j)).exists()


def test_scratch_of_an_active_slice_is_not_swept(env, tmp_path):
    j = upload(env, stl(3), "a.stl")["id"]
    force(j, state="slicing", slice_reserved=100)
    s = tmp_path / "quick" / "scratch" / j
    s.mkdir(parents=True)
    done = tmp_path / "quick" / "scratch" / ("0" * 16)
    done.mkdir()
    quick.sweep(now=time.time() + 7200)
    assert s.exists() and not done.exists()


def test_a_restart_keeps_uploads_in_flight(env):
    uid = env.post("/api/quick/uploads", json={"filename": "a.stl", "size": 3000}, headers=SAME).json()["id"]
    env.put(f"/api/quick/uploads/{uid}?offset=0", content=b"x" * 1024, headers=OCT)
    quick._ready_dbs.clear()  # a process restart: state is read back from the database and disk
    assert env.get(f"/api/quick/uploads/{uid}").json()["offset"] == 1024


# --- retention -------------------------------------------------------------------------------------------------

_n = iter(range(2, 10_000))


def old_job(env, state, name, age=40 * 86400, **cols):
    j = upload(env, stl(next(_n)), name)["id"]
    force(j, state=state, updated=int(time.time()) - age, **cols)
    return j


@pytest.mark.parametrize("state", sorted(quick.PROTECTED))
def test_each_protected_state_keeps_its_files(env, state):
    j = old_job(env, state, "p.stl")
    assert quick.evict(10 ** 9) == 0
    assert quick.model_path(raw_job(j)).exists() and raw_job(j)["state"] == state


@pytest.mark.parametrize("col,val", [("queue_item_id", "7"), ("bambuddy_file_id", "12"), ("hold", 1),
                                     ("awaiting_cleanup", 1), ("slice_reserved", 100)])
def test_an_old_looking_job_with_a_live_reference_is_protected(env, col, val):
    j = old_job(env, "failed", "r.stl", **{col: val})
    assert quick.evict(10 ** 9) == 0
    assert quick.model_path(raw_job(j)).exists()


def test_eviction_order_and_what_stays(env):
    draft = old_job(env, "draft", "d.stl", age=2 * 86400)
    failed = old_job(env, "failed", "ff.stl", age=1 * 86400)
    sliced_old = old_job(env, "sliced", "so.stl", age=30 * 86400, slice_sha256="a" * 64)
    sliced_new = old_job(env, "sliced", "sn.stl", age=3600, slice_sha256="b" * 64)
    fresh_draft = old_job(env, "draft", "fd.stl", age=60)
    size = lambda j: raw_job(j)["model_bytes"]
    quick.evict(size(draft) + 1)  # needs two files: the abandoned draft first, then the failed job
    assert raw_job(draft)["file_removed"] == 1 and raw_job(failed)["file_removed"] == 1
    assert raw_job(sliced_old)["file_removed"] == 0
    quick.evict(10 ** 9)
    assert raw_job(sliced_old)["file_removed"] == 1
    assert raw_job(sliced_new)["file_removed"] == 0 and raw_job(fresh_draft)["file_removed"] == 0
    kept = raw_job(failed)
    assert kept["model_sha256"] and kept["name"] == "ff.stl" and kept["state"] == "failed"  # the record stays
    assert raw_job(sliced_old)["state"] == "stale" and "removed" in raw_job(sliced_old)["reason"]
    assert raw_job(draft)["state"] == "canceled"


def test_a_removed_file_is_never_offered_for_reprint_or_staging(env):
    j = old_job(env, "sliced", "x.stl", slice_sha256="a" * 64)
    force(j, sliced_hash=raw_job(j)["request_hash"])
    assert env.get(f"/api/quick/jobs/{j}").json()["can_reprint_file"] is True
    quick.evict(10 ** 9)
    r = env.get(f"/api/quick/jobs/{j}").json()
    assert r["can_reprint_file"] is False and r["file_removed"] == 1
    with pytest.raises(quick.QuickError):
        quick.transition(j, "staging")


def test_a_full_store_makes_room_by_evicting_inactive_files_only(env, monkeypatch):
    old = old_job(env, "failed", "old.stl")
    live = old_job(env, "slicing", "live.stl")
    monkeypatch.setattr(quick, "QUOTA", raw_job(old)["model_bytes"] + raw_job(live)["model_bytes"] + 100)
    r = env.post("/api/quick/uploads", json={"filename": "n.stl", "size": 500}, headers=SAME)
    assert r.status_code == 200
    assert raw_job(old)["file_removed"] == 1 and raw_job(live)["file_removed"] == 0


def test_cancel_route_and_its_log(env):
    j = upload(env)["id"]
    r = env.post(f"/api/quick/jobs/{j}/cancel", headers=SAME)
    assert r.status_code == 200 and r.json()["state"] == "canceled"
    assert env.post(f"/api/quick/jobs/{j}/cancel", headers=SAME).status_code == 409
    assert any(a["action"] == "quick print" and j in a["result"] for a in auth.recent_actions())


def test_unknown_job_and_bad_ids(env):
    assert env.get("/api/quick/jobs/0123456789abcdef").status_code == 404
    assert env.get("/api/quick/jobs/..%2Fetc").status_code == 404
    assert env.get("/api/quick/uploads/nothex").status_code == 404
