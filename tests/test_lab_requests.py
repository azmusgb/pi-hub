"""Print lab requests are checked as Local AI checks them (app/print-lab.js): six kinds, photos named only by their
sha256, observations at most 16 KiB and everything else 4 KiB, and `by` is the household sign-in, never the browser's user agent."""
import hashlib
import json
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("LABS-5678\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, auth, lab, lab_guard  # noqa: E402

SAME = {"Origin": "http://testserver"}
KEY = "hub-lab-key-requests-0123456789abcdef0123456789"
MAC = {"X-Hub-Mac-Key": KEY}
SHA_A = "a" * 64
SHA_B = "b" * 64
URL = "/api/lab/hex-tile/requests"
SNAP = {"subject": {"experiment": "E-005"}, "outcomes": {"face": "clean"}, "source": {"kind": "phone"}}

_n = [0]


def rid():
    _n[0] += 1
    return f"rq-{_n[0]:016x}"


def body(kind, payload, experiment="E-005", run="PR-005-01", **extra):
    return {"id": rid(), "kind": kind, "experiment": experiment, "run": run, "payload": payload, **extra}


VALID = {
    "verdict": lambda: body("verdict", {"lighting": "diagnostic", "grades": {"tabs": {"outer_wall": "A"}}}),
    "photos": lambda: body("photos", {"run": "PR-005-01", "photos": [{"sha256": SHA_A, "tab": "A"},
                                                                     {"sha256": SHA_B, "tab": None}]}),
    "start": lambda: body("start", {"tapped_at": "2026-10-28T09:00:00Z"}, run=None, run_seen="PR-005-01"),
    "approve": lambda: body("approve", {"reason": "Looks right", "build_seen": "E-005-3",
                                        "reasons_seen": ["no_verdict", "old_build"]}, run=None),
    "abandon": lambda: body("abandon", {"reason": "Wrong filament"}, run=None),
    "observation": lambda: body("observation", {"snapshots": [SNAP]}),
    "observation_correction": lambda: body("observation_correction", {
        "observation": "OBS-0001", "expected_rev": 2, "snapshot": SNAP, "reason": "Wrong tab"}),
}


@pytest.fixture
def client(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_LAB_DIR"] = str(tmp_path / "lab")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    lab._ready_dbs.clear()
    auth._tries.clear()
    key_file = tmp_path / "lab_mac_key.sha256"
    key_file.write_text(hashlib.sha256(KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(key_file))
    c = TestClient(hub_app.app)
    r = c.post("/api/setup", json={"code": "LABS-5678", "owner_password": "long enough", "pin": "123456"},
               headers=SAME)
    assert r.status_code == 200, r.text
    c.cookies.clear()
    assert c.post("/api/signin", json={"pin": "123456"}, headers=SAME).json()["role"] == "household"
    make_project(c, "hex-tile")
    return c


def make_project(c, name):
    ix = {"schema": "print-lab-index/1", "project": name, "generated_at": "2026-10-28T09:00:00Z",
          "fingerprint": "fp-" + name, "experiments": [], "records": {}}
    r = c.post(f"/api/lab/{name}/sync", json=ix, headers=MAC)
    assert r.status_code == 200, r.text


def post(c, data, **headers):
    return c.post(URL, json=data, headers={**SAME, **headers})


def pending(c):
    r = c.get(URL + "?status=pending", headers=MAC)
    assert r.status_code == 200, r.text
    return {i["id"]: i for i in r.json()["items"]}


@pytest.mark.parametrize("kind", sorted(VALID))
def test_each_kind_is_accepted(client, kind):
    data = VALID[kind]()
    r = post(client, data)
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "id": data["id"], "status": "pending"}
    item = pending(client)[data["id"]]
    assert item["kind"] == kind


def test_buttons_store_only_what_lab_pull_reads(client):
    start = VALID["start"]()
    start["payload"]["extra"] = "dropped"
    approve = VALID["approve"]()
    approve["payload"]["reason"] = "  Looks right  "
    approve["payload"]["extra"] = "dropped"
    for d in (start, approve):
        assert post(client, d).status_code == 200
    items = pending(client)
    s, a = items[start["id"]], items[approve["id"]]
    assert s["run"] is None and s["run_seen"] == "PR-005-01"
    assert s["payload"] == {"tapped_at": "2026-10-28T09:00:00Z"}
    assert a["run"] is None and "run_seen" not in a
    assert a["payload"] == {"reason": "Looks right", "build_seen": "E-005-3",
                            "reasons_seen": ["no_verdict", "old_build"]}


@pytest.mark.parametrize("kind", ["delete", "observations", "", None, ["verdict"]])
def test_unknown_kind_is_refused(client, kind):
    data = VALID["verdict"]()
    data["kind"] = kind
    assert post(client, data).status_code == 400


def photos(list_):
    return body("photos", {"run": "PR-005-01", "photos": list_})


@pytest.mark.parametrize("bad", [
    [],
    [{"sha256": f"{i:064x}"} for i in range(51)],
    [{"sha256": "../x"}],
    [{"sha256": "../../photos/" + SHA_A}],
    [{"sha256": "/etc/passwd"}],
    [{"sha256": "/" + SHA_A}],
    [{"sha256": SHA_A.upper()}],
    [{"sha256": "a" * 63}],
    [{"sha256": "a" * 65}],
    [{"sha256": SHA_A + "\n"}],
    [{"sha256": SHA_A, "tab": "x" * 17}],
    [{"sha256": SHA_A, "tab": "x" * 41}],
    [{"sha256": SHA_A, "tab": ""}],
    [{"sha256": SHA_A, "tab": "a/b"}],
    [{"sha256": SHA_A, "tab": 7}],
    [SHA_A],
    [None],
    "not a list",
])
def test_bad_photos_are_refused(client, bad):
    # 51 photos are also over Local AI's 4 KB request limit, so that one may be refused as too large first.
    assert post(client, photos(bad)).status_code in ((400, 413) if len(bad) > 50 else (400,))
    assert lab.request_problem("photos", {"photos": bad}, set()) is not None


def test_photo_limits_at_the_edge_are_accepted(client):
    # 50 photos fit in 4 KB without tabs (as in Local AI); with 16-character tabs only the shape check passes.
    many = [{"sha256": f"{i:064x}"} for i in range(50)]
    assert post(client, photos(many)).status_code == 200
    assert post(client, photos([{"sha256": SHA_A, "tab": "t" * 16}])).status_code == 200
    tabbed = [{"sha256": f"{i:064x}", "tab": "t" * 16} for i in range(50)]
    assert lab.request_problem("photos", {"photos": tabbed}, set()) is None


def test_observation_over_16kib_is_refused(client):
    snap = {**SNAP, "outcomes": {"note": "x" * (16 * 1024)}}
    r = post(client, body("observation", {"snapshots": [snap]}))
    assert r.status_code in (400, 413)
    assert pending(client) == {}


def test_observation_up_to_16kib_is_accepted(client):
    snap = {**SNAP, "outcomes": {"note": "x" * (12 * 1024)}}
    assert post(client, body("observation", {"snapshots": [snap]})).status_code == 200


@pytest.mark.parametrize("kind", ["verdict", "photos", "start", "approve", "abandon"])
def test_other_kinds_over_4kib_are_refused(client, kind):
    data = VALID[kind]()
    data["pad"] = "x" * (4 * 1024)
    assert post(client, data).status_code == 413
    assert pending(client) == {}


def test_other_kinds_just_under_4kib_are_accepted(client):
    data = VALID["verdict"]()
    data["payload"]["note"] = "x" * (3 * 1024 + 512)
    assert post(client, data).status_code == 200


@pytest.mark.parametrize("payload", [
    {"observation": "OBS-01", "expected_rev": 1, "snapshot": SNAP, "reason": "x"},
    {"observation": "OBS-0001\n", "expected_rev": 1, "snapshot": SNAP, "reason": "x"},
    {"observation": "OBS-0001", "expected_rev": 0, "snapshot": SNAP, "reason": "x"},
    {"observation": "OBS-0001", "expected_rev": True, "snapshot": SNAP, "reason": "x"},
    {"observation": "OBS-0001", "expected_rev": 1.5, "snapshot": SNAP, "reason": "x"},
    {"observation": "OBS-0001", "expected_rev": 2 ** 53, "snapshot": SNAP, "reason": "x"},
    {"observation": "OBS-0001", "expected_rev": 1, "snapshot": {"subject": {}}, "reason": "x"},
    {"observation": "OBS-0001", "expected_rev": 1, "snapshot": SNAP, "reason": "  "},
    {"observation": "OBS-0001", "expected_rev": 1, "snapshot": SNAP, "reason": "x" * 501},
    {"observation": "OBS-0001", "expected_rev": 1, "snapshot": SNAP},
])
def test_bad_observation_corrections_are_refused(client, payload):
    assert post(client, body("observation_correction", payload)).status_code == 400


@pytest.mark.parametrize("payload", [
    {"snapshots": []},
    {"snapshots": [SNAP] * 9},
    {"snapshots": [{"subject": {}, "outcomes": {}}]},
    {"snapshots": [{"subject": "x", "outcomes": {}, "source": {}}]},
    {"snapshots": "x"},
])
def test_bad_observations_are_refused(client, payload):
    assert post(client, body("observation", payload)).status_code == 400


@pytest.mark.parametrize("kind,payload,extra", [
    ("start", {"tapped_at": "not a date"}, {}),
    ("start", {"tapped_at": "2026-10-28T09:00:00Z" + " " * 30}, {}),
    ("start", {}, {}),
    ("start", {"tapped_at": "2026-10-28T09:00:00Z"}, {"run_seen": "../x"}),
    ("approve", {"reason": "ok", "build_seen": "E-005", "reasons_seen": []}, {}),
    ("approve", {"reason": "ok", "build_seen": "E-005-3", "reasons_seen": ["Bad Code"]}, {}),
    ("approve", {"reason": "ok", "build_seen": "E-005-3", "reasons_seen": ["a"] * 31}, {}),
    ("approve", {"reason": "ok", "build_seen": "E-005-3", "reasons_seen": "a"}, {}),
    ("approve", {"reason": "   ", "build_seen": "E-005-3", "reasons_seen": []}, {}),
    ("abandon", {"reason": ""}, {}),
    ("abandon", {"reason": "x" * 501}, {}),
    ("abandon", {"reason": 5}, {}),
])
def test_bad_button_requests_are_refused(client, kind, payload, extra):
    assert post(client, body(kind, payload, run=None, **extra)).status_code == 400


def test_buttons_name_an_experiment_not_a_variant(client):
    assert post(client, body("abandon", {"reason": "x"}, experiment="E-005-01", run=None)).status_code == 400
    assert post(client, body("abandon", {"reason": "x"}, experiment="Q-005", run=None)).status_code == 400


def test_request_problem_is_the_shared_check():
    assert lab.request_problem("photos", {"photos": [{"sha256": "../x"}]}, set()) is not None
    assert lab.request_problem("photos", {"photos": [{"sha256": SHA_A, "tab": "A"}]}, set()) is None
    assert lab.request_problem("start", {"tapped_at": "2026-10-28T09:00:00Z"}, {"PR-005-01"}) is None
    assert lab.request_problem("start", {"tapped_at": "2026-10-28T09:00:00Z"}, {"../x"}) is not None
    assert lab.request_problem("abandon", {"reason": "x"}, set()) is None
    assert lab.request_problem("nope", {}, set()) is not None


def test_result_with_a_list_body_is_refused(client):
    data = VALID["verdict"]()
    assert post(client, data).status_code == 200
    r = client.post(f"{URL}/{data['id']}/result", json=["applied"], headers=MAC)
    assert r.status_code == 400
    assert pending(client)[data["id"]]["status"] == "pending"


def test_result_message_must_be_text(client):
    data = VALID["verdict"]()
    assert post(client, data).status_code == 200
    r = client.post(f"{URL}/{data['id']}/result", json={"status": "applied", "message": {"x": 1}}, headers=MAC)
    assert r.status_code == 400


def test_result_for_a_malformed_id_is_404(client):
    r = client.post(f"{URL}/rq-NOT-AN-ID/result", json={"status": "applied"}, headers=MAC)
    assert r.status_code == 404


def test_applied_photos_remove_only_their_incoming_files(client, tmp_path):
    project = tmp_path / "lab" / "hex-tile"
    (project / "incoming").mkdir(parents=True)
    (project / "photos").mkdir(parents=True)
    inc = project / "incoming" / f"{SHA_A}.jpg"
    inc.write_bytes(b"\xff\xd8incoming")
    decoy = project / "photos" / f"{SHA_B}.jpg"
    decoy.write_bytes(b"\xff\xd8kept")
    outside = tmp_path / "victim.jpg"
    outside.write_bytes(b"\xff\xd8kept")

    data = photos([{"sha256": SHA_A}])
    assert post(client, data).status_code == 200
    # A row stored before these checks (or written some other way) still can't reach outside incoming/.
    crafted = {"photos": [{"sha256": SHA_A}, {"sha256": f"../photos/{SHA_B}"}, {"sha256": str(tmp_path / "victim")},
                          {"sha256": SHA_B.upper()}, "junk", None]}
    from hub import db
    db.run("UPDATE lab_requests SET payload = ? WHERE id = ?", json.dumps(crafted), data["id"])

    r = client.post(f"{URL}/{data['id']}/result", json={"status": "applied", "message": "ok"}, headers=MAC)
    assert r.status_code == 200, r.text
    assert not inc.exists()
    assert decoy.exists()
    assert outside.exists()


def test_by_is_the_household_sign_in_not_the_user_agent(client):
    data = VALID["verdict"]()
    assert post(client, data, **{"User-Agent": "EvilAgent/9.9 (spoofed)"}).status_code == 200
    by = pending(client)[data["id"]]["by"]
    assert by == "A browser"
    assert "EvilAgent" not in by


def test_by_names_the_person_when_they_signed_in_with_their_own_pin(client):
    client.cookies.clear()
    assert client.post("/api/signin", json={"password": "long enough"}, headers=SAME).json()["role"] == "owner"
    r = client.post("/api/settings/person-add", json={"name": "Ann", "kind": "adult", "pin": "246810"}, headers=SAME)
    assert r.status_code == 200, r.text
    ann = TestClient(hub_app.app, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"})
    assert ann.post("/api/signin", json={"pin": "246810"}, headers=SAME).json()["role"] == "household"
    data = VALID["abandon"]()
    assert ann.post(URL, json=data, headers={**SAME, "User-Agent": "EvilAgent/1"}).status_code == 200
    assert pending(client)[data["id"]]["by"] == "Ann on iPhone"


def raw(c, text, url=URL, **headers):
    return c.post(url, content=text.encode("utf-8", "surrogatepass"),
                  headers={**SAME, "Content-Type": "application/json", **headers})


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_nan_and_infinity_are_refused_and_the_queue_stays_readable(client, constant):
    data = VALID["verdict"]()
    text = json.dumps(data).replace('"diagnostic"', constant)
    assert constant in text
    assert raw(client, text).status_code == 400
    assert post(client, VALID["verdict"]()).status_code == 200
    r = client.get(URL + "?status=pending", headers=MAC)
    assert r.status_code == 200 and len(r.json()["items"]) == 1


@pytest.mark.parametrize("constant", ["NaN", "Infinity", "-Infinity"])
def test_result_refuses_nan_and_infinity(client, constant):
    data = VALID["verdict"]()
    assert post(client, data).status_code == 200
    r = raw(client, '{"status": "applied", "message": "ok", "n": %s}' % constant,
            url=f"{URL}/{data['id']}/result", **MAC)
    assert r.status_code == 400
    assert pending(client)[data["id"]]["status"] == "pending"


@pytest.mark.parametrize("escaped", [True, False])
def test_a_lone_surrogate_is_invalid_json(client, escaped):
    data = VALID["abandon"]()
    text = json.dumps(data).replace("Wrong filament", "\\ud800" if escaped else "\ud800")
    assert raw(client, text).status_code == 400
    assert pending(client) == {}


def test_result_with_a_lone_surrogate_is_refused(client):
    data = VALID["verdict"]()
    assert post(client, data).status_code == 200
    r = raw(client, '{"status": "applied", "message": "\\udc00"}', url=f"{URL}/{data['id']}/result", **MAC)
    assert r.status_code == 400


@pytest.mark.parametrize("kind", ["nope", None, "observation"])
def test_oversize_is_413_whatever_the_kind(client, kind):
    data = VALID["verdict"]()
    data["kind"] = kind
    data["pad"] = "x" * (17 * 1024)
    assert post(client, data).status_code == 413


def test_photo_routes_refuse_a_sha_with_a_trailing_newline(client):
    bad = SHA_A + "%0A"
    assert client.put(f"/api/lab/hex-tile/photos/{bad}.jpg", content=b"\xff\xd8", headers=MAC).status_code == 400
    assert client.get(f"/api/lab/hex-tile/photo/{bad}.jpg").status_code == 404
    assert client.put(f"/api/lab/hex-tile/incoming/{bad}.jpg", content=b"\xff\xd8",
                      headers=SAME).status_code == 400
    assert client.get(f"/api/lab/hex-tile/incoming/{bad}.jpg", headers=MAC).status_code == 404


def test_request_regexes_need_the_whole_value(client):
    """The routes check with fullmatch: Python's `$` alone would let `<sha>\\n` through."""
    assert lab.SHA_RE.match(SHA_A + "\n") is not None
    assert not lab._full(lab.SHA_RE, SHA_A + "\n")


@pytest.mark.parametrize("number", ["1e999", "-1e999"])
def test_overflowing_numbers_are_refused_and_the_queue_stays_readable(client, number):
    data = body("observation", {"snapshots": [{**SNAP, "outcomes": {"score": "HERE"}}]})
    text = json.dumps(data).replace('"HERE"', number)
    assert number in text
    assert raw(client, text).status_code == 400
    assert post(client, VALID["observation"]()).status_code == 200
    r = client.get(URL + "?status=pending", headers=MAC)
    assert r.status_code == 200 and len(r.json()["items"]) == 1


@pytest.mark.parametrize("number", ["1e999", "-1e999"])
def test_result_refuses_overflowing_numbers(client, number):
    data = VALID["verdict"]()
    assert post(client, data).status_code == 200
    r = raw(client, '{"status": "applied", "message": "ok", "n": {"m": [%s]}}' % number,
            url=f"{URL}/{data['id']}/result", **MAC)
    assert r.status_code == 400
    assert pending(client)[data["id"]]["status"] == "pending"


def test_request_in_unknown_project_is_404(client):
    r = client.post("/api/lab/fake-0/requests", json=VALID["verdict"](), headers=SAME)
    assert r.status_code == 404, r.text


def test_global_pending_cap_across_projects(client):
    names = [f"proj-{i}" for i in range(6)]
    for n in names:
        make_project(client, n)
    sent = 0
    for n in names[:5]:
        for _ in range(20):
            r = client.post(f"/api/lab/{n}/requests", json=VALID["verdict"](), headers=SAME)
            assert r.status_code == 200, r.text
            sent += 1
    assert sent == 100
    r = client.post(f"/api/lab/{names[5]}/requests", json=VALID["verdict"](), headers=SAME)
    assert r.status_code == 429
    assert "100" in r.json()["detail"]


def test_project_name_with_trailing_newline_is_refused(client):
    r = client.get("/api/lab/hex-tile%0A/requests", headers=MAC)
    assert r.status_code == 400, r.text
    r = client.post("/api/lab/hex-tile%0A/requests", json=VALID["verdict"](), headers=SAME)
    assert r.status_code == 400, r.text


def test_record_id_with_trailing_newline_is_refused(client):
    r = client.get("/api/lab/hex-tile/record/E-001%0A", headers=SAME)
    assert r.status_code == 404, r.text
    ix = {"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-10-28T10:00:00Z",
          "fingerprint": "fp-nl", "experiments": [], "records": {"E-001\n": {"sha256": "x"}}}
    r = client.post("/api/lab/hex-tile/sync", json=ix, headers=MAC)
    assert r.status_code == 422, r.text


def test_sync_record_not_an_object_is_422(client):
    ix = {"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-10-28T10:00:00Z",
          "fingerprint": "fp-bad", "experiments": [], "records": {"E-001": "nope"}}
    r = client.post("/api/lab/hex-tile/sync", json=ix, headers=MAC)
    assert r.status_code == 422, r.text


def test_sync_experiments_not_a_list_is_422(client):
    ix = {"schema": "print-lab-index/1", "project": "hex-tile", "generated_at": "2026-10-28T10:00:00Z",
          "fingerprint": "fp-bad2", "experiments": 5, "records": {}}
    r = client.post("/api/lab/hex-tile/sync", json=ix, headers=MAC)
    assert r.status_code == 422, r.text
