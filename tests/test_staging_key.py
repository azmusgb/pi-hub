"""The owner's script that makes the Quick Print staging key (A19 P6). Never run here: Bambuddy is a fake."""
import importlib.util
import os

import pytest

_spec = importlib.util.spec_from_file_location(
    "staging_key", os.path.join(os.path.dirname(__file__), "..", "deploy", "bambuddy-staging-key.py"))
staging_key = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(staging_key)

URL = "http://127.0.0.1:8000"


def fake(login=None, created=None):
    calls = []

    def call(method, url, body, headers):
        calls.append((method, url, body, headers))
        if url.endswith("/api/v1/auth/login"):
            return login if login is not None else {"access_token": "tok", "requires_2fa": False}
        return created if created is not None else {"id": 8, "key": "bb_stage"}
    return calls, call


def test_the_key_can_read_status_and_manage_the_library_for_printer_one_and_nothing_else():
    calls, call = fake()
    assert staging_key.make_key(URL, "bill", "pw", call) == "bb_stage"
    body = calls[1][2]
    assert body["name"] == "Pi Hub staging" and body["printer_ids"] == [1]
    assert body["can_read_status"] is True and body["can_manage_library"] is True
    on = sorted(k for k, v in body.items() if k.startswith("can_") and v)
    assert on == ["can_manage_library", "can_read_status"]
    for off in ("can_queue", "can_control_printer", "can_manage_archives", "can_access_cloud"):
        assert body[off] is False


def test_it_writes_a_different_file_from_the_control_key():
    assert staging_key.KEY_FILE.endswith("bambuddy_staging_key")
    assert staging_key.KEY_FILE != "/etc/pi-hub/secrets/bambuddy_control_key"


def test_two_factor_login_stops_and_says_what_to_make_by_hand():
    _, call = fake(login={"access_token": None, "requires_2fa": True})
    with pytest.raises(SystemExit) as e:
        staging_key.make_key(URL, "bill", "pw", call)
    assert "Manage library" in str(e.value) and "pw" not in str(e.value)
