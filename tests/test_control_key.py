import importlib.util
import os

import pytest

_spec = importlib.util.spec_from_file_location(
    "control_key", os.path.join(os.path.dirname(__file__), "..", "deploy", "bambuddy-control-key.py"))
control_key = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(control_key)

URL = "http://127.0.0.1:8000"
FLAGS_OFF = ["can_queue", "can_read_status", "can_manage_library", "can_manage_inventory", "can_manage_maintenance",
             "can_manage_archives", "can_manage_projects", "can_access_cloud", "can_update_energy_cost",
             "can_send_notifications"]


def fake_bambuddy(login=None, created=None):
    calls = []

    def call(method, url, body, headers):
        calls.append((method, url, body, headers))
        if url.endswith("/api/v1/auth/login"):
            return login if login is not None else {"access_token": "tok", "requires_2fa": False}
        return created if created is not None else {"id": 7, "key": "bb_secret"}
    return calls, call


def test_makes_a_control_only_key_for_printer_one():
    calls, call = fake_bambuddy()
    assert control_key.make_key(URL, "bill", "pw", call) == "bb_secret"
    (m1, u1, b1, _), (m2, u2, b2, h2) = calls
    assert (m1, u1, b1) == ("POST", URL + "/api/v1/auth/login", {"username": "bill", "password": "pw"})
    assert (m2, u2) == ("POST", URL + "/api/v1/api-keys/")
    assert h2["Authorization"] == "Bearer tok"
    assert b2 == {"name": "Pi Hub control", "can_control_printer": True, "printer_ids": [1], **{f: False for f in FLAGS_OFF}}


def test_two_factor_login_stops_without_showing_the_password():
    _, call = fake_bambuddy(login={"access_token": None, "requires_2fa": True})
    with pytest.raises(SystemExit) as e:
        control_key.make_key(URL, "bill", "pw-secret", call)
    assert "pw-secret" not in str(e.value) and str(e.value)


def test_a_reply_without_a_key_stops():
    _, call = fake_bambuddy(created={"id": 7})
    with pytest.raises(SystemExit) as e:
        control_key.make_key(URL, "bill", "pw", call)
    assert "bb_secret" not in str(e.value) and str(e.value)


# The saved password went stale when Bambuddy's sign-in was set up (25 Oct: "HTTP 401 to auth/login"): the owner is asked
# in their own terminal instead, never in chat.
def refusing(good_user, good_pw):
    calls, ok = fake_bambuddy()

    def call(method, url, body, headers):
        if url.endswith("/api/v1/auth/login") and (body["username"], body["password"]) != (good_user, good_pw):
            raise control_key.LoginRefused("Bambuddy said HTTP 401 to auth/login.")
        return ok(method, url, body, headers)
    return calls, call


def test_a_stale_saved_password_falls_back_to_asking():
    asked = []
    _, call = refusing("bill", "typed")
    ask = lambda: asked.append(1) or ("bill", "typed")  # noqa: E731
    assert control_key.get_key(URL, "bill", "stale", ask, call) == "bb_secret"
    assert asked == [1]


def test_no_saved_password_asks_straight_away():
    _, call = refusing("owner", "typed")
    assert control_key.get_key(URL, "bill", None, lambda: ("owner", "typed"), call) == "bb_secret"


def test_a_wrong_typed_password_stops_without_showing_it():
    _, call = refusing("bill", "right")
    with pytest.raises(SystemExit) as e:
        control_key.get_key(URL, "bill", "stale", lambda: ("bill", "wrong-secret"), call)
    assert "wrong-secret" not in str(e.value) and "stale" not in str(e.value) and str(e.value)


def test_without_a_terminal_it_does_not_ask():
    _, call = refusing("bill", "typed")
    with pytest.raises(SystemExit):
        control_key.get_key(URL, "bill", "stale", None, call)
