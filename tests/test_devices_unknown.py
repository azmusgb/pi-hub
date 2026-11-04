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
