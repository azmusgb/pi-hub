"""A19 P6: Prepare, Start, the sheet's checks, reconcile and the bed hold, against a fake Bambuddy and a fake printer."""
import hashlib
import io
import json
import re
import threading
import zipfile
from pathlib import Path

import pytest

from hub import auth, db, lab_hold, lab_start, printer_control, quick, quick_start
from test_quick_worker import SAME, env, new_job  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]
GOOD = {"connected": True, "bambuddy_state": "IDLE", "hms": [], "bed_temp": 24.0, "job_name": None,
        "ams_trays": [{"slot": 1, "type": "PLA", "color": "#ffffff", "name": "PLA Basic", "remain": 80}]}


def slice_3mf(types=("PLA",), extra=b"") -> bytes:
    buf = io.BytesIO()
    filaments = "".join(f'<filament id="{i + 1}" type="{t}" color="#FFFFFF" used_m="1" used_g="3"/>' for i, t in enumerate(types))
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Metadata/plate_1.gcode", "; fake\nM83\n" + extra.decode())
        z.writestr("Metadata/slice_info.config", f"<config><plate>{filaments}</plate></config>" if types else "<config/>")
    return buf.getvalue()


class Bambuddy:
    """The parts of Bambuddy Quick Print uses, with the failures a test can switch on."""

    def __init__(self):
        self.files, self.queue, self.calls, self.folders = {}, {}, [], [{"id": 1, "name": "print-lab", "parent_id": None}]
        self.version, self.next_id = lab_start.SUPPORTED_VERSION, 10
        self.fail_upload = self.fail_delete = self.corrupt = self.dup = self.fail_queue = False
        self.start_status, self.gate = 200, None

    def __call__(self, method, path, key, body=None):
        self.calls.append((method, path, key, body))
        if method == "GET" and path == "/updates/version":
            return 200, json.dumps({"version": self.version}).encode()
        if method == "GET" and path == "/library/folders":
            return 200, json.dumps(self.folders).encode()
        if method == "POST" and path == "/library/folders":
            self.folders.append({"id": 7, "name": body["name"], "parent_id": None})
            return 201, json.dumps({"id": 7}).encode()
        m = re.fullmatch(r"/library/files/(\d+)/download", path)
        if m:
            data = self.files.get(int(m.group(1)))
            return (200, data + (b"x" if self.corrupt else b"")) if data is not None else (404, b"")
        m = re.fullmatch(r"/library/files/(\d+)", path)
        if method == "DELETE" and m:
            if self.fail_delete:
                return 500, b""
            self.files.pop(int(m.group(1)), None)
            return 204, b""
        if method == "POST" and path == "/queue/":
            if self.fail_queue:
                return 500, b""
            i = self.next_id = self.next_id + 1
            self.queue[i] = body
            return 201, json.dumps({"id": i}).encode()
        m = re.fullmatch(r"/queue/(\d+)/start", path)
        if m:
            if self.gate:
                self.gate.wait(5)
            return self.start_status, json.dumps({"detail": "no"}).encode()
        m = re.fullmatch(r"/queue/(\d+)", path)
        if m and method == "GET":
            return (200, b"{}") if int(m.group(1)) in self.queue else (404, b"")
        if m and method == "DELETE":
            if self.fail_delete:
                return 500, b""
            self.queue.pop(int(m.group(1)), None)
            return 204, b""
        return 404, b""

    def upload(self, path, folder, key, name):
        self.calls.append(("UPLOAD", name, key, folder))
        if self.fail_upload:
            return 500, b""
        i = self.next_id = self.next_id + 1
        self.files[i] = Path(path).read_bytes()
        return 201, json.dumps({"id": i, "filename": name, "duplicate_of": 3 if self.dup else None}).encode()

    def sent(self, method, pattern):
        return [c for c in self.calls if c[0] == method and re.fullmatch(pattern, str(c[1]))]


@pytest.fixture
def bb(monkeypatch, tmp_path):
    b = Bambuddy()
    key = tmp_path / "staging"
    key.write_text("stage-key-123")
    monkeypatch.setattr(quick_start, "KEY_FILE", str(key))
    monkeypatch.setattr(lab_start, "control_key", lambda: "control-key-456")
    monkeypatch.setattr(lab_start, "read_key", lambda: "read-key-789")
    monkeypatch.setattr(lab_start, "_call", b)
    monkeypatch.setattr(quick_start, "upload_file", b.upload)
    monkeypatch.setattr(quick_start, "printer_now", lambda: dict(GOOD))
    return b


def sliced(c, data: bytes | None = None) -> str:
    """A job in `sliced` with its file on disk, the way a finished worker attempt leaves it."""
    j = new_job(c, queue=False)
    data = data or slice_3mf()
    p = quick.QUICK_DIR / "slices" / f"{j}.gcode.3mf"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)
    rh = db.one("SELECT request_hash FROM quick_jobs WHERE id = ?", j)["request_hash"]
    db.run("UPDATE quick_jobs SET state='sliced', slice_sha256=?, slice_file=?, slice_bytes=?, sliced_hash=? WHERE id=?",
           hashlib.sha256(data).hexdigest(), p.name, len(data), rh, j)
    return j


def staged(c, bb) -> str:
    j = sliced(c)
    assert quick_start.prepare(j, "owner", "dev")["ok"]
    return j


def row(j):
    return db.one("SELECT * FROM quick_jobs WHERE id = ?", j)


TICKS = {"plate_clear": True, "filament_ok": True}


def go(j, **kw):
    return quick_start.start(j, "owner", "Phone", printer_now=lambda: dict(GOOD), ticks=kw.pop("ticks", TICKS), **kw)


# --- Prepare --------------------------------------------------------------------------------------------------------

def test_prepare_uploads_reads_back_compares_and_marks_prepared(env, bb):
    j = sliced(env)
    r = quick_start.prepare(j, "owner", "Phone")
    assert r["ok"] and row(j)["state"] == "staged" and row(j)["bambuddy_file_id"]
    up = bb.sent("UPLOAD", r".*")[0]
    assert up[1] == f"quick_{j}.gcode.3mf" and up[3] == 7 and up[2] == "stage-key-123"  # the new quick-print folder, the staging key
    assert bb.folders[-1]["name"] == "quick-print"
    assert bb.sent("GET", r"/library/files/\d+/download")[0][2] == "read-key-789"
    assert bb.sent("POST", r"/queue/") == [] and bb.sent("POST", r"/queue/\d+/start") == []  # Prepare never starts anything
    assert [x["result"] for x in db.rows("SELECT result FROM action_log WHERE action = ?", f"quick:prepare:{j}")] == [
        f"prepared as Bambuddy file {row(j)['bambuddy_file_id']}"]


def test_an_existing_quick_print_folder_is_reused_and_a_second_one_is_refused(env, bb):
    bb.folders.append({"id": 5, "name": "quick-print", "parent_id": None})
    j = sliced(env)
    assert quick_start.prepare(j, "owner", "d")["ok"] and bb.sent("POST", r"/library/folders") == []
    assert bb.sent("UPLOAD", r".*")[0][3] == 5
    bb.folders.append({"id": 6, "name": "quick-print", "parent_id": None})
    k = sliced(env)
    r = quick_start.prepare(k, "owner", "d")
    assert not r["ok"] and "more than one" in r["say"] and row(k)["state"] == "sliced"


def test_no_staging_key_stops_before_anything_is_sent(env, bb, monkeypatch):
    monkeypatch.setattr(quick_start, "KEY_FILE", "/nonexistent")
    j = sliced(env)
    with pytest.raises(quick.QuickError) as e:
        quick_start.prepare(j, "owner", "d")
    assert e.value.status == 503 and "staging key" in e.value.message and row(j)["state"] == "sliced" and bb.calls == []


def test_a_stored_slice_that_doesnt_match_its_hash_is_not_uploaded(env, bb):
    j = sliced(env)
    (quick.QUICK_DIR / "slices" / f"{j}.gcode.3mf").write_bytes(slice_3mf(("PETG",)))
    with pytest.raises(quick.QuickError) as e:
        quick_start.prepare(j, "owner", "d")
    assert e.value.status == 409 and row(j)["state"] == "sliced" and bb.sent("UPLOAD", r".*") == []


def test_prepare_refuses_an_unsupported_bambuddy_version(env, bb):
    bb.version = "1.4.0"
    j = sliced(env)
    with pytest.raises(quick.QuickError) as e:
        quick_start.prepare(j, "owner", "d")
    assert "1.4.0" in e.value.message and bb.sent("UPLOAD", r".*") == []


@pytest.mark.parametrize("state", ["draft", "ready_to_slice", "queued", "stale", "failed", "canceled", "needs_attention", "staged"])
def test_only_a_sliced_job_can_be_prepared(env, bb, state):
    j = sliced(env)
    db.run("UPDATE quick_jobs SET state = ? WHERE id = ?", state, j)
    with pytest.raises(quick.QuickError) as e:
        quick_start.prepare(j, "owner", "d")
    assert e.value.status == 409 and bb.calls == []


def test_an_upload_that_fails_leaves_the_job_sliced_and_nothing_behind(env, bb):
    bb.fail_upload = True
    j = sliced(env)
    r = quick_start.prepare(j, "owner", "d")
    assert not r["ok"] and row(j)["state"] == "sliced" and row(j)["awaiting_cleanup"] == 0 and bb.files == {}


def test_a_read_back_that_differs_deletes_our_upload_and_says_so(env, bb):
    bb.corrupt = True
    j = sliced(env)
    r = quick_start.prepare(j, "owner", "d")
    assert not r["ok"] and "isn't the file that was uploaded" in r["say"]
    assert bb.files == {} and row(j)["state"] == "sliced" and row(j)["awaiting_cleanup"] == 0
    assert db.one("SELECT deleted FROM quick_bb_files")["deleted"] == 1


def test_a_cleanup_that_cant_be_confirmed_keeps_the_file_shown(env, bb):
    bb.corrupt = bb.fail_delete = True
    j = sliced(env)
    r = quick_start.prepare(j, "owner", "d")
    fid = next(iter(bb.files))
    assert not r["ok"] and f"library id {fid}" in r["say"] and "remove it there" in r["say"]
    assert row(j)["awaiting_cleanup"] == 1 and row(j)["bambuddy_file_id"] == str(fid) and row(j)["state"] == "sliced"


def test_an_identical_file_already_in_bambuddy_is_never_deleted_by_us(env, bb):
    bb.dup = True
    j = sliced(env)
    r = quick_start.prepare(j, "owner", "d")
    assert not r["ok"] and "identical file" in r["say"]
    assert bb.sent("DELETE", r"/library/files/\d+") == [] or all(c[1] != "/library/files/3" for c in bb.calls)


def test_only_a_file_we_recorded_uploading_can_be_deleted(env, bb):
    quick_start.ready()
    bb.files[99] = b"someone else's"
    assert quick_start._delete_own(99, "k", bb) is False and bb.sent("DELETE", r"/library/files/99") == [] and 99 in bb.files


def test_unprepare_removes_our_file_and_returns_to_sliced(env, bb):
    j = staged(env, bb)
    r = quick_start.unprepare(j, "owner", "d")
    assert r["ok"] and bb.files == {} and row(j)["state"] == "sliced" and row(j)["bambuddy_file_id"] is None


# --- Start ----------------------------------------------------------------------------------------------------------

def test_a_start_queues_manual_then_starts_and_records_the_attempt_first(env, bb):
    j = staged(env, bb)
    r = go(j)
    assert r["ok"] and r["state"] == "start_accepted" and row(j)["state"] == "start_accepted"
    q = bb.sent("POST", r"/queue/")[0]
    assert q[3]["manual_start"] is True and q[3]["library_file_id"] == int(row(j)["bambuddy_file_id"]) and q[2] == "control-key-456"
    assert [c[1] for c in bb.calls if c[0] == "POST"][-2:] == ["/queue/", f"/queue/{row(j)['queue_item_id']}/start"]
    a = db.one("SELECT * FROM quick_starts WHERE job = ?", j)
    assert a["phase"] == "accepted" and a["device"] == "Phone" and str(a["queue_item"]) == row(j)["queue_item_id"]
    log = db.rows("SELECT * FROM action_log WHERE action = ?", f"quick:start:{j}")
    assert len(log) == 1 and log[0]["device"] == "Phone" and a["attempt"] in log[0]["result"]


def test_no_start_without_both_ticks(env, bb):
    j = staged(env, bb)
    for t in ({}, {"plate_clear": True}, {"filament_ok": True}, {"plate_clear": True, "filament_ok": "yes"}):
        with pytest.raises(quick.QuickError) as e:
            go(j, ticks=t)
        assert e.value.status == 400
    assert bb.sent("POST", r"/queue/") == [] and row(j)["state"] == "staged"


@pytest.mark.parametrize("printer,says", [
    (None, "can't see the printer"), ({**GOOD, "connected": False}, "can't see the printer"),
    ({**GOOD, "bambuddy_state": "RUNNING"}, "isn't idle"), ({**GOOD, "hms": [{"code": "1"}]}, "has an error"),
    ({**GOOD, "bed_temp": 60.0}, "below 35"), ({**GOOD, "ams_trays": []}, "can't see what filament"),
    ({**GOOD, "ams_trays": [{"type": "PETG"}]}, "needs PLA; the printer has PETG"),
])
def test_a_printer_that_cant_take_it_sends_nothing(env, bb, printer, says):
    j = staged(env, bb)
    with pytest.raises(quick.QuickError) as e:
        quick_start.start(j, "owner", "d", printer_now=lambda: printer, ticks=TICKS)
    assert says in e.value.message and "Nothing was sent" in e.value.message
    assert bb.sent("POST", r"/queue/") == [] and row(j)["state"] == "staged" and printer_control.BUSY.acquire(False)
    printer_control.BUSY.release()


def test_a_slice_that_names_no_filament_blocks_start(env, bb):
    j = sliced(env, slice_3mf(types=()))
    assert quick_start.prepare(j, "owner", "d")["ok"]
    with pytest.raises(quick.QuickError) as e:
        go(j)
    assert "doesn't say what filament" in e.value.message and bb.sent("POST", r"/queue/") == []


def test_a_changed_stored_file_at_the_tap_starts_nothing(env, bb):
    j = staged(env, bb)
    (quick.QUICK_DIR / "slices" / f"{j}.gcode.3mf").write_bytes(slice_3mf(("PLA",), b"G1 X1"))
    with pytest.raises(quick.QuickError) as e:
        go(j)
    assert "isn't the one that was prepared" in e.value.message and bb.sent("POST", r"/queue/") == []


def test_a_changed_bambuddy_copy_at_the_tap_starts_nothing(env, bb):
    j = staged(env, bb)
    bb.corrupt = True
    with pytest.raises(quick.QuickError) as e:
        go(j)
    assert "Bambuddy's copy isn't the file that was prepared" in e.value.message and bb.sent("POST", r"/queue/") == []


def test_a_file_gone_from_bambuddy_at_the_tap_says_prepare_again(env, bb):
    j = staged(env, bb)
    bb.files.clear()
    with pytest.raises(quick.QuickError) as e:
        go(j)
    assert "Prepare again" in e.value.message and bb.sent("POST", r"/queue/") == []


def test_a_queue_add_that_fails_sends_nothing_and_keeps_the_job_prepared(env, bb):
    j = staged(env, bb)
    bb.fail_queue = True
    with pytest.raises(quick.QuickError) as e:
        go(j)
    assert e.value.status == 502 and "Nothing was sent" in e.value.message and row(j)["state"] == "staged"
    assert db.one("SELECT phase FROM quick_starts WHERE job = ?", j)["phase"] == "not_queued"


def test_a_start_bambuddy_refuses_removes_the_queue_item_and_stays_prepared(env, bb):
    j = staged(env, bb)
    bb.start_status = 409
    with pytest.raises(quick.QuickError) as e:
        go(j)
    assert "spool" in e.value.message and "queue item was removed" in e.value.message
    assert row(j)["state"] == "staged" and row(j)["queue_item_id"] is None and bb.queue == {}


def test_a_refused_start_whose_item_wont_delete_is_uncertain_and_names_the_item(env, bb):
    j = staged(env, bb)
    bb.start_status, bb.fail_delete = 409, True
    r = go(j)
    assert not r["ok"] and r["state"] == "outcome_uncertain" and row(j)["state"] == "outcome_uncertain"
    assert row(j)["queue_item_id"] and bb.queue


@pytest.mark.parametrize("status", [0, 500, 502, 504, 408, 429])
def test_a_lost_or_ambiguous_response_is_uncertain_and_never_retried(env, bb, status):
    j = staged(env, bb)
    bb.start_status = status
    r = go(j)
    assert r["state"] == "outcome_uncertain" and "Nothing will be retried" in r["say"]
    assert len(bb.sent("POST", r"/queue/\d+/start")) == 1 and bb.queue  # the item is left for the owner to read
    quick_start.step(dict(GOOD))
    assert len(bb.sent("POST", r"/queue/\d+/start")) == 1 and len(bb.sent("POST", r"/queue/")) == 1


def test_a_second_tap_after_the_first_changes_nothing(env, bb):
    j = staged(env, bb)
    go(j)
    with pytest.raises(quick.QuickError) as e:
        go(j)
    assert e.value.status == 409 and len(bb.sent("POST", r"/queue/")) == 1


def test_two_taps_at_once_one_wins(env, bb):
    j = staged(env, bb)
    bb.gate = threading.Event()
    out, errs = [], []

    def tap():
        try:
            out.append(go(j))
        except quick.QuickError as e:
            errs.append(e)
    first = threading.Thread(target=tap)
    first.start()
    for _ in range(200):  # until the first is inside Bambuddy's start call
        if bb.sent("POST", r"/queue/") and printer_control.BUSY.locked():
            break
        threading.Event().wait(0.01)
    tap()
    bb.gate.set()
    first.join(5)
    assert len(out) == 1 and out[0]["ok"] and len(errs) == 1 and errs[0].status == 409
    assert len(bb.sent("POST", r"/queue/")) == 1 and len(bb.sent("POST", r"/queue/\d+/start")) == 1


def test_a_quick_start_and_an_experiment_start_cannot_run_together(env, bb):
    j = staged(env, bb)
    assert printer_control.hold("start") is None  # an experiment's start holds the one gateway lock
    try:
        with pytest.raises(quick.QuickError) as e:
            go(j)
        assert e.value.status == 409 and bb.sent("POST", r"/queue/") == []
    finally:
        printer_control.release()
    assert go(j)["ok"]


def test_no_control_key_sends_nothing(env, bb, monkeypatch):
    j = staged(env, bb)
    monkeypatch.setattr(lab_start, "control_key", lambda: "")
    with pytest.raises(quick.QuickError) as e:
        go(j)
    assert e.value.status == 503 and bb.sent("POST", r"/queue/") == []


@pytest.mark.parametrize("state", ["sliced", "draft", "failed", "stale", "canceled", "needs_attention", "start_accepted", "printing_confirmed"])
def test_only_a_prepared_job_can_start(env, bb, state):
    j = sliced(env)
    db.run("UPDATE quick_jobs SET state = ? WHERE id = ?", state, j)
    with pytest.raises(quick.QuickError) as e:
        go(j)
    assert e.value.status == 409 and bb.calls == []


# --- Reconcile -------------------------------------------------------------------------------------------------------

def test_a_start_seen_printing_is_confirmed(env, bb):
    j = staged(env, bb)
    go(j)
    quick_start.step({**GOOD, "bambuddy_state": "RUNNING", "job_name": f"quick_{j}"})
    assert row(j)["state"] == "printing_confirmed"


def test_another_job_printing_does_not_confirm_this_one(env, bb):
    j = staged(env, bb)
    go(j)
    quick_start.step({**GOOD, "bambuddy_state": "RUNNING", "job_name": "quick_someoneelse"})
    assert row(j)["state"] == "start_accepted"


def test_not_seen_printing_in_five_minutes_is_uncertain(env, bb):
    j = staged(env, bb)
    go(j, now=lambda: 1000)
    quick_start.step(dict(GOOD), now=lambda: 1000 + quick_start.CONFIRM_SECONDS - 1)
    assert row(j)["state"] == "start_accepted"
    quick_start.step(dict(GOOD), now=lambda: 1000 + quick_start.CONFIRM_SECONDS)
    assert row(j)["state"] == "outcome_uncertain" and "wasn't seen printing" in row(j)["reason"]


def test_a_printer_that_cant_be_read_never_confirms_and_never_clears_an_uncertain(env, bb):
    j = staged(env, bb)
    go(j, now=lambda: 1000)
    quick_start.step(None, now=lambda: 1001)
    assert row(j)["state"] == "start_accepted"


def test_an_uncertain_start_later_seen_printing_becomes_confirmed(env, bb):
    j = staged(env, bb)
    bb.start_status = 0
    go(j)
    quick_start.step({**GOOD, "bambuddy_state": "PREPARE", "job_name": f"quick_{j}"})
    assert row(j)["state"] == "printing_confirmed"


def test_a_restart_during_start_is_uncertain_not_resumed(env, bb):
    a, b = staged(env, bb), staged(env, bb)
    db.run("UPDATE quick_jobs SET state = 'start_requested' WHERE id = ?", a)
    db.run("UPDATE quick_jobs SET state = 'start_accepted' WHERE id = ?", b)
    assert quick_start.boot() == 2
    assert row(a)["state"] == row(b)["state"] == "outcome_uncertain" and bb.sent("POST", r"/queue/\d+/start") == []


def test_a_restart_during_prepare_removes_our_upload_and_returns_to_sliced(env, bb):
    j = sliced(env)
    quick_start.ready()
    bb.files[50] = b"x"
    db.run("INSERT INTO quick_bb_files (file_id, job, filename, sha256, created) VALUES (50, ?, 'f', 'h', 1)", j)
    db.run("UPDATE quick_jobs SET state = 'staging' WHERE id = ?", j)
    quick_start.boot()
    assert row(j)["state"] == "sliced" and 50 not in bb.files


def test_resolve_needs_nothing_running_and_the_item_gone(env, bb):
    j = staged(env, bb)
    bb.start_status = 0
    go(j)
    item = int(row(j)["queue_item_id"])
    with pytest.raises(quick.QuickError) as e:
        quick_start.resolve(j, "owner", "d", printer_now=lambda: {**GOOD, "bambuddy_state": "RUNNING"})
    assert "running" in e.value.message and row(j)["state"] == "outcome_uncertain"
    with pytest.raises(quick.QuickError):
        quick_start.resolve(j, "owner", "d", printer_now=lambda: None)
    bb.fail_delete = True
    with pytest.raises(quick.QuickError) as e:
        quick_start.resolve(j, "owner", "d", printer_now=lambda: dict(GOOD))
    assert "couldn't be removed" in e.value.message and row(j)["state"] == "outcome_uncertain"
    bb.fail_delete, bb.start_status = False, 200
    assert quick_start.resolve(j, "owner", "d", printer_now=lambda: dict(GOOD))["ok"]
    assert item not in bb.queue and row(j)["state"] == "staged" and row(j)["queue_item_id"] is None
    assert go(j)["ok"] and db.one("SELECT COUNT(DISTINCT attempt) AS n FROM quick_starts WHERE job = ?", j)["n"] == 2  # a fresh attempt


# --- The bed hold ---------------------------------------------------------------------------------------------------

HOT = {**GOOD, "bed_temp": 60.0}


def test_a_hot_bed_alone_can_be_waited_for_and_the_start_follows(env, bb):
    j = staged(env, bb)
    assert quick_start.bed_only(row(j), HOT) and not quick_start.bed_only(row(j), {**HOT, "hms": [1]})
    lab_hold._hold = None
    h = lab_hold.place_quick(j, TICKS, "owner", "Phone")
    assert h["bed"] is None and lab_hold.quick_state(j)["hold"]
    lab_hold.step(lambda: HOT)
    assert lab_hold.quick_state(j)["hold"]["bed"] == 60.0 and bb.sent("POST", r"/queue/") == []
    lab_hold.step(lambda: dict(GOOD))
    assert row(j)["state"] == "start_accepted" and lab_hold.quick_state(j)["hold"] is None
    assert lab_hold.quick_state(j)["last"]["status"] == "sent"


def test_there_is_one_hold_in_all(env, bb):
    j, k = staged(env, bb), staged(env, bb)
    lab_hold._hold = None
    lab_hold.place_quick(j, TICKS, "owner", "d")
    try:
        with pytest.raises(ValueError, match="Already waiting"):
            lab_hold.place_quick(k, TICKS, "owner", "d")
        with pytest.raises(ValueError, match="Already waiting to start a Quick Print"):
            lab_hold.place("lab", "E-1", {"staged": {}}, "owner", "d")
    finally:
        lab_hold.cancel_quick(j, "owner", "d")
    assert lab_hold._hold is None


def test_a_hold_ends_without_sending_when_the_job_changes_or_something_else_refuses(env, bb):
    j = staged(env, bb)
    lab_hold._hold = None
    lab_hold.place_quick(j, TICKS, "owner", "d")
    lab_hold.step(lambda: {**HOT, "hms": [1]})
    assert lab_hold.quick_state(j)["last"]["status"] == "refused" and bb.sent("POST", r"/queue/") == []
    lab_hold.place_quick(j, TICKS, "owner", "d")
    db.run("UPDATE quick_jobs SET state = 'sliced' WHERE id = ?", j)
    lab_hold.step(lambda: HOT)
    assert lab_hold.quick_state(j)["last"]["status"] == "cancelled" and bb.sent("POST", r"/queue/") == []


def test_a_hold_expires(env, bb):
    j = staged(env, bb)
    lab_hold._hold = None
    lab_hold.place_quick(j, TICKS, "owner", "d", now=lambda: 0)
    lab_hold.step(lambda: HOT, now=lambda: lab_hold.HOLD_MINUTES * 60)
    assert lab_hold.quick_state(j)["last"]["status"] == "expired"


# --- The routes -----------------------------------------------------------------------------------------------------

def test_the_routes_need_the_owner(env, bb):
    j = sliced(env)
    from fastapi.testclient import TestClient
    from hub import app as hub_app
    anon = TestClient(hub_app.app)
    for method, tail in (("post", "prepare"), ("delete", "prepare"), ("post", "start"), ("delete", "start"), ("post", "resolve"), ("get", "start")):
        assert getattr(anon, method)(f"/api/quick/jobs/{j}/{tail}", headers=SAME).status_code in (401, 403), tail
    assert bb.calls == []


def test_prepare_then_start_through_the_routes(env, bb):
    j = sliced(env)
    r = env.post(f"/api/quick/jobs/{j}/prepare", headers=SAME)
    assert r.status_code == 200 and r.json()["job"]["state"] == "staged"
    c = env.get(f"/api/quick/jobs/{j}/start").json()
    assert c["reasons"] == [] and c["needs"] == ["PLA"] and c["printer"]["trays"][0]["type"] == "PLA"
    assert env.post(f"/api/quick/jobs/{j}/start", json={"plate_clear": True}, headers=SAME).status_code == 400
    ok = env.post(f"/api/quick/jobs/{j}/start", json=TICKS, headers=SAME)
    assert ok.status_code == 200 and ok.json()["state"] == "start_accepted"
    assert env.post(f"/api/quick/jobs/{j}/start", json=TICKS, headers=SAME).status_code == 409
    body = json.dumps([r.json(), c, ok.json()])
    for secret in ("stage-key-123", "control-key-456", "read-key-789"):
        assert secret not in body
        assert all(secret not in str(x["result"]) + str(x["action"]) for x in db.rows("SELECT * FROM action_log"))


def test_the_route_holds_for_the_bed_when_asked_and_it_is_the_only_thing(env, bb, monkeypatch):
    j = sliced(env)
    env.post(f"/api/quick/jobs/{j}/prepare", headers=SAME)
    monkeypatch.setattr(quick_start, "printer_now", lambda: dict(HOT))
    lab_hold._hold = None
    assert env.post(f"/api/quick/jobs/{j}/start", json=TICKS, headers=SAME).status_code == 409  # not asked to wait
    held = env.post(f"/api/quick/jobs/{j}/start", json={**TICKS, "wait_for_bed": True}, headers=SAME)
    assert held.status_code == 200 and held.json()["held"] is True
    assert env.post(f"/api/quick/jobs/{j}/start", json={**TICKS, "wait_for_bed": True}, headers=SAME).status_code == 409
    assert env.delete(f"/api/quick/jobs/{j}/start", headers=SAME).json()["cancelled"] is True
    assert bb.sent("POST", r"/queue/") == []


# --- Rules about the code itself ------------------------------------------------------------------------------------

def test_the_allow_list_refuses_everything_else():
    for method, path in (("GET", "/library/files/"), ("DELETE", "/library/folders/7"), ("POST", "/queue/batches/1/dispatch"),
                         ("GET", "/api-keys/"), ("POST", "/printers/1/print/stop"), ("PATCH", "/queue/3"), ("DELETE", "/library/files/x")):
        with pytest.raises(PermissionError):
            quick_start._bb(method, path, "k", call=lambda *a: (200, b""))


def test_quick_print_names_no_bambuddy_folder_but_quick_print():
    src = (ROOT / "hub" / "quick_start.py").read_text()
    assert quick_start.FOLDER == "quick-print"
    assert "print-lab" not in src.replace("print-lab folder", "")  # the experiment folder is never named here
    assert re.findall(r'folder_id=\{?[^"]*', src) and not re.search(r'"name":\s*"(?!\{)', src.replace('{"name": FOLDER}', ""))


def test_no_key_reaches_the_browser_the_palette_or_a_notification():
    for p in (ROOT / "hub" / "static" / "js").glob("*.js"):
        text = p.read_text()
        assert "staging_key" not in text and "control_key" not in text, p.name
    palette = (ROOT / "hub" / "static" / "js" / "command-palette.js").read_text()
    assert "/api/quick" not in palette and "quick/jobs" not in palette
    for p in (ROOT / "hub").glob("notify*.py"):
        assert "quick_start" not in p.read_text(), p.name


def test_the_state_table_allows_only_the_planned_start_moves():
    assert quick.ALLOWED["start_requested"] == {"start_accepted", "outcome_uncertain", "failed", "staged"}
    assert quick.ALLOWED["staged"] == {"queued_in_bambuddy", "sliced", "stale", "canceled"}
    assert "staged" in quick.ALLOWED["outcome_uncertain"] and "printing_confirmed" in quick.ALLOWED["outcome_uncertain"]
