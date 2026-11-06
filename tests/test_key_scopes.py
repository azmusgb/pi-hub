import importlib.util
import os

import pytest

_spec = importlib.util.spec_from_file_location(
    "key_scopes", os.path.join(os.path.dirname(__file__), "..", "deploy", "bambuddy-key-scopes.py"))
key_scopes = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(key_scopes)

URL = "http://127.0.0.1:8000"
AUTH = {"Authorization": "Bearer tok"}
ALL_ON = {f: True for f in key_scopes.FLAGS}


def today():
    """Bambuddy's keys as read on 6 Nov 2026 (print-lab with everything on), plus one the script doesn't manage."""
    return [{"id": 6, "name": "print-lab", **ALL_ON, "printer_ids": None},
            {"id": 1, "name": "Pi Hub (read)", "can_read_status": True, "can_queue": True, "can_manage_library": True},
            {"id": 4, "name": "Pi Hub control", "can_control_printer": True, "printer_ids": [1]},
            {"id": 2, "name": "Local AI Materials (read)", "can_read_status": True, "can_queue": True},
            {"id": 3, "name": "Local AI Clear plate (control)", **ALL_ON, "printer_ids": [1]},
            {"id": 9, "name": "Someone else's", "can_read_status": True, "key": "bb_should_never_print"}]


def fake(keys, ignore_patch=False):
    calls = []

    def call(method, url, body, headers):
        calls.append((method, url, body, headers))
        if method == "GET":
            return [dict(k) for k in keys]
        if method == "PATCH" and not ignore_patch:
            k = next(k for k in keys if url.endswith(f"/api-keys/{k['id']}"))
            k.update(body)
        return {}
    return calls, call


def by_id(keys):
    return {k["id"]: k for k in keys}


def test_each_key_ends_with_only_what_its_app_uses():
    keys = today()
    calls, call = fake(keys)
    out = []
    assert key_scopes.apply(URL, AUTH, call, out.append) == 5
    k = by_id(keys)
    on = lambda key: {f for f in key_scopes.FLAGS if key.get(f)}  # noqa: E731
    assert on(k[6]) == {"can_read_status", "can_manage_library"}
    assert on(k[1]) == {"can_read_status"} and on(k[2]) == {"can_read_status"}
    assert on(k[4]) == {"can_control_printer", "can_queue"} and k[4]["printer_ids"] == [1]
    assert on(k[3]) == {"can_read_status", "can_control_printer"} and k[3]["printer_ids"] == [1]
    assert on(k[9]) == {"can_read_status"}  # not managed: untouched
    assert all(h == AUTH for _, _, _, h in calls)
    assert not any(m == "PATCH" and u.endswith("/9") for m, u, _, _ in calls)


def test_only_the_print_lab_key_and_pi_hub_control_may_touch_the_library_or_queue():
    for key_id, (_, keep) in key_scopes.KEYS.items():
        if "can_queue" in keep:
            assert key_id == 4
        if "can_manage_library" in keep:
            assert key_id == 6


def test_running_again_changes_nothing():
    keys = today()
    _, call = fake(keys)
    key_scopes.apply(URL, AUTH, call, lambda s: None)
    calls, call = fake(keys)
    assert key_scopes.apply(URL, AUTH, call, lambda s: None) == 0
    assert [m for m, *_ in calls] == ["GET", "GET"]


@pytest.mark.parametrize("change, said", [
    (lambda ks: ks.pop(0), "key 6 (print-lab) isn't in Bambuddy"),
    (lambda ks: ks[0].update(name="print lab"), "key 6 is named 'print lab'"),
    (lambda ks: ks.append({"id": 12, "name": "Pi Hub control"}), "2 keys are named 'Pi Hub control'"),
])
def test_a_missing_renamed_or_duplicated_key_stops_before_any_change(change, said):
    keys = today()
    change(keys)
    calls, call = fake(keys)
    with pytest.raises(SystemExit, match="Nothing was changed: .*" + said.replace("(", r"\(").replace(")", r"\)")):
        key_scopes.apply(URL, AUTH, call, lambda s: None)
    assert [m for m, *_ in calls] == ["GET"]


def test_a_change_bambuddy_ignored_is_reported():
    calls, call = fake(today(), ignore_patch=True)
    with pytest.raises(SystemExit, match="didn't take the change for: .*print-lab"):
        key_scopes.apply(URL, AUTH, call, lambda s: None)


def test_it_prints_names_and_permissions_never_a_key():
    out = []
    _, call = fake(today())
    key_scopes.apply(URL, AUTH, call, out.append)
    text = "\n".join(out)
    assert "bb_" not in text and "tok" not in text
    assert "print-lab" in text and "Read, Library" in text and "left alone" in text


def test_sign_in_asks_once_when_the_saved_password_is_refused():
    def call(method, url, body, headers):
        if body["password"] == "old":
            raise key_scopes.LoginRefused("no")
        return {"access_token": "tok"}
    assert key_scopes.sign_in(URL, "bill", "old", lambda: ("", "new"), call) == AUTH
    with pytest.raises(SystemExit, match="Run this in a terminal"):
        key_scopes.sign_in(URL, "bill", "old", None, call)


def test_two_factor_sign_in_changes_nothing():
    with pytest.raises(SystemExit, match="Nothing was changed"):
        key_scopes.login(URL, "bill", "pw", lambda *a: {"access_token": None, "requires_2fa": True})
