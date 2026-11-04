"""Homebridge accessories: an on/off the bridge didn't report is unknown (None), never Off."""
from hub import homecontrol


def _serve(monkeypatch, items):
    monkeypatch.setattr(homecontrol, "_login", lambda: "t")
    monkeypatch.setattr(homecontrol, "_call", lambda *a, **k: items)


def _acc(chars, kind="Lightbulb", uid="a" * 64):
    return {"type": kind, "uniqueId": uid, "serviceName": "Lamp", "serviceCharacteristics": chars}


def test_a_reported_on_and_off_are_kept(monkeypatch):
    _serve(monkeypatch, [_acc([{"type": "On", "value": True}], uid="a" * 64),
                         _acc([{"type": "On", "value": 0}], kind="Outlet", uid="b" * 64)])
    assert {a["kind"]: a["on"] for a in homecontrol._accessories()} == {"light": True, "plug": False}


def test_no_on_value_is_unknown_not_off(monkeypatch):
    _serve(monkeypatch, [_acc([{"type": "On", "value": None}], uid="a" * 64),
                         _acc([], kind="Outlet", uid="b" * 64),
                         _acc([{"type": "Active"}], kind="Fanv2", uid="c" * 64)])
    assert [a["on"] for a in homecontrol._accessories()] == [None, None, None]


# A flash toggles and then restores. With the state unknown there is nothing true to restore, so the rule is blocked
# rather than leaving a lamp that was really on switched off.
def _flash(monkeypatch, on):
    from hub import events, homecontrol
    set_to = []
    monkeypatch.setattr(homecontrol, "accessories", lambda: [{"id": "lamp", "name": "Lamp", "control": "On", "on": on}])
    monkeypatch.setattr(homecontrol, "set_value", lambda id, c, v: set_to.append(v))
    monkeypatch.setattr(events.time, "sleep", lambda s: None)
    monkeypatch.setattr(events, "policy", lambda rule, kind: {"status": "would_run"})
    rule = {"id": 1, "trigger": "print_finished", "action": "flash", "target": "lamp", "enabled": 1}
    return events.execute(rule, "print_finished"), set_to


def test_flash_with_unknown_state_is_blocked_and_touches_nothing(monkeypatch):
    out, set_to = _flash(monkeypatch, None)
    assert out["status"] == "blocked" and "isn't known" in out["message"]
    assert set_to == []


def test_flash_restores_a_known_state(monkeypatch):
    assert _flash(monkeypatch, True)[1] == [False, True]
    assert _flash(monkeypatch, False)[1] == [True, False]
