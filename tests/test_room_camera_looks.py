"""Quick looks for the Room view camera (amendment A20 D2, plan P2): three built-in looks (Night, Bright, Bed close-up),
up to 8 custom looks stored in the settings table under room_camera_looks, validating names and control settings."""
import os
import sys
import tempfile
import pytest

from fastapi.testclient import TestClient

os.environ["HUB_NO_SAMPLER"] = "1"
_tmp = tempfile.mkdtemp()
CODE_FILE = os.path.join(_tmp, "setup-code")
with open(CODE_FILE, "w") as f:
    f.write("ABCD-1234\n")

from hub import room_camera, app as hub_app, auth, db  # noqa: E402

ORIGIN = {"Origin": "http://testserver"}


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch, tmp_path):
    monkeypatch.setenv("HUB_SETUP_CODE_FILE", CODE_FILE)
    db_file = tmp_path / "test.db"
    monkeypatch.setenv("HUB_DB", str(db_file))
    auth._ready()
    auth._tries.clear()
    auth.setup("ABCD-1234", "correct-horse-battery")
    yield


def owner_client(monkeypatch):
    monkeypatch.setattr(hub_app, "need", lambda request, role: ("owner", "test-device"))
    return TestClient(hub_app.app)


def household_client(monkeypatch):
    from hub import auth
    monkeypatch.setattr(auth, "who", lambda request: ("household", "test-tablet"))
    return TestClient(hub_app.app)


def test_builtin_looks_returned():
    """Three built-in looks are always present in the returned looks list."""
    looks = room_camera.get_looks()
    builtin_names = [look["name"] for look in looks if look.get("builtin")]
    assert builtin_names == ["Night", "Bright", "Bed close-up"]
    night = next(l for l in looks if l["name"] == "Night")
    assert night["values"]["ev"] == 1.5
    assert night["values"]["brightness"] == 0.1
    assert night["values"]["denoise"] == "hq"
    assert night["values"]["metering"] == "average"

    bright = next(l for l in looks if l["name"] == "Bright")
    assert bright["values"]["ev"] == -0.5
    assert bright["values"]["contrast"] == 1.2

    bed = next(l for l in looks if l["name"] == "Bed close-up")
    assert bed["values"]["zoom"] == 2.0
    assert bed["values"]["centre_x"] == 50
    assert bed["values"]["centre_y"] == 50
    assert bed["values"]["ev"] == 0.5


def test_save_custom_look():
    """Owner can save a custom look; it is persisted in the store."""
    look = room_camera.save_look("My Look", {"ev": 1.0, "contrast": 1.5})
    assert look["name"] == "My Look"
    assert look["values"]["ev"] == 1.0
    assert look["values"]["contrast"] == 1.5
    assert not look.get("builtin")

    looks = room_camera.get_looks()
    names = [l["name"] for l in looks]
    assert "My Look" in names


def test_refuse_builtin_name():
    """Cannot overwrite or use a built-in look name (case-insensitive)."""
    with pytest.raises(room_camera.Invalid) as exc:
        room_camera.save_look("night", {"ev": 1.0})
    assert exc.value.field == "name"

    with pytest.raises(room_camera.Invalid) as exc:
        room_camera.save_look("Bright", {"ev": 1.0})
    assert exc.value.field == "name"


def test_refuse_names_of_the_rows_own_chips():
    """A look can't be called Auto or Save this look: the chips row already has those (A23 P4)."""
    for name in ("Auto", "auto", " Save this look "):
        with pytest.raises(room_camera.Invalid) as exc:
            room_camera.save_look(name, {"ev": 1.0})
        assert exc.value.field == "name"


def test_refuse_invalid_name():
    """Names must be 1-24 characters without control characters."""
    with pytest.raises(room_camera.Invalid):
        room_camera.save_look("", {"ev": 1.0})
    with pytest.raises(room_camera.Invalid):
        room_camera.save_look("   ", {"ev": 1.0})
    with pytest.raises(room_camera.Invalid):
        room_camera.save_look("a" * 25, {"ev": 1.0})
    with pytest.raises(room_camera.Invalid):
        room_camera.save_look("look\n1", {"ev": 1.0})


def test_refuse_duplicate_name_case_insensitive():
    """Duplicate look names are refused ignoring case."""
    room_camera.save_look("Nozzle Focus", {"ev": 0.5})
    with pytest.raises(room_camera.Invalid) as exc:
        room_camera.save_look("nozzle focus", {"ev": 1.0})
    assert exc.value.field == "name"


def test_refuse_ninth_custom_look():
    """At most 8 custom looks allowed."""
    for i in range(8):
        room_camera.save_look(f"Look {i}", {"ev": 0.5})
    with pytest.raises(room_camera.Invalid) as exc:
        room_camera.save_look("Look 9", {"ev": 0.5})
    assert "8" in exc.value.reason


def test_refuse_turn_flips_preset_in_look():
    """Turn, flips, and preset are refused in a look (only framing, light, colour, detail)."""
    for bad_key in ("turn", "mirror", "flip", "preset"):
        with pytest.raises(room_camera.Invalid) as exc:
            room_camera.save_look("Bad", {bad_key: 0})
        assert exc.value.field == bad_key


def test_validate_look_values():
    """Values in a look are checked against CONTROLS specification."""
    with pytest.raises(room_camera.Invalid) as exc:
        room_camera.save_look("Bad Range", {"ev": 5.0})  # EV max is 2
    assert exc.value.field == "ev"

    with pytest.raises(room_camera.Invalid) as exc:
        room_camera.save_look("Bad Denoise", {"denoise": "extreme"})
    assert exc.value.field == "denoise"


def test_delete_look():
    """Owner can delete a custom look, but cannot delete a built-in look."""
    room_camera.save_look("To Delete", {"ev": 0.5})
    assert any(l["name"] == "To Delete" for l in room_camera.get_looks())
    room_camera.delete_look("To Delete")
    assert not any(l["name"] == "To Delete" for l in room_camera.get_looks())

    with pytest.raises(room_camera.Invalid):
        room_camera.delete_look("Night")
    with pytest.raises(room_camera.Invalid):
        room_camera.delete_look("Nonexistent")


def test_looks_routes_auth_and_crud(monkeypatch):
    """GET, POST, DELETE /api/camera/room/looks routes."""
    anon = household_client(monkeypatch)

    # GET looks: household/anon is refused (requires owner)
    r = anon.get("/api/camera/room/looks")
    assert r.status_code in (401, 403)

    owner = owner_client(monkeypatch)
    r = owner.get("/api/camera/room/looks")
    assert r.status_code == 200
    data = r.json()
    assert len(data["looks"]) >= 3

    # POST save look
    anon = household_client(monkeypatch)
    r = anon.post("/api/camera/room/looks", json={"name": "Test", "values": {"ev": 0.5}})
    assert r.status_code in (401, 403)

    owner = owner_client(monkeypatch)
    r = owner.post("/api/camera/room/looks", json={"name": "Test", "values": {"ev": 0.5}}, headers=ORIGIN)
    assert r.status_code == 200
    assert r.json()["look"]["name"] == "Test"

    # Action logged
    logs = db.rows("SELECT * FROM action_log WHERE action = 'room-camera:look'")
    assert len(logs) == 1
    assert "saved 'Test'" in logs[0]["result"]

    # DELETE look
    anon = household_client(monkeypatch)
    r = anon.delete("/api/camera/room/looks/Test")
    assert r.status_code in (401, 403)

    owner = owner_client(monkeypatch)
    r = owner.delete("/api/camera/room/looks/Test", headers=ORIGIN)
    assert r.status_code == 200

    logs = db.rows("SELECT * FROM action_log WHERE action = 'room-camera:look'")
    assert len(logs) == 2
    assert "deleted 'Test'" in logs[1]["result"]
