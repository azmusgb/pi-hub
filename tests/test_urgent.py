import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402

from hub import db, events, records, urgent  # noqa: E402
from tests.helpers_records import T, bud, inputs  # noqa: E402

IDLE = inputs()
PRINTING = inputs(bambuddy=bud("RUNNING", 10))


@pytest.fixture(autouse=True)
def fresh_db():
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    records._reset_memory()
    events._forget()
    events.ready()


class Send:
    def __init__(self, answer="Sent."):
        self.calls, self.answer = [], answer

    def __call__(self, *a, **k):
        self.calls.append((a, k))
        return self.answer


def rec(state, headline="H", cause="C", stale=False):
    r = {"state": state, "headline": headline, "cause": cause}
    if stale:
        r["stale"] = True
    return r


FAILED = {"printer": rec("failed", "The print failed", "Stopped at 40%."), "obico": rec("watching")}
FINE = {"printer": rec("idle"), "obico": rec("watching")}


def test_failed_print_pushes_once_with_click_and_urgent():
    send = Send()
    assert urgent.check(FAILED, T, send=send) == ["print"]
    assert urgent.check(FAILED, T + 30, send=send) == []
    assert len(send.calls) == 1
    (title, body), k = send.calls[0]
    assert title == "The print failed" and body == "Stopped at 40%."
    assert k == {"tags": "rotating_light", "priority": "high", "urgent": True,
                 "click": "https://home.home.arpa/workshop"}
    row = db.one("SELECT * FROM push_occurrences WHERE cause = 'print'")
    assert row == {"cause": "print", "first_seen": T, "pushed_at": T, "cleared_at": None}


def test_restart_does_not_repush_an_open_occurrence():
    send = Send()
    urgent.check(FAILED, T, send=send)
    records._reset_memory()  # a new process: nothing in memory, same DB
    events._forget()
    assert urgent.check(FAILED, T + 60, send=send) == []
    assert len(send.calls) == 1


def test_stale_records_never_push():
    send = Send()
    stale = {"printer": rec("failed", stale=True), "obico": rec("failure", stale=True),
             "hms": rec("stopped", stale=True), "pc_printing": rec("off_while_printing", stale=True)}
    assert urgent.check(stale, T, send=send) == []
    assert send.calls == []


def test_stale_records_do_not_clear_an_occurrence():
    send = Send()
    urgent.check(FAILED, T, send=send)
    urgent.check({"printer": rec("failed", stale=True), "obico": rec("watching", stale=True)}, T + 30, send=send)
    assert db.one("SELECT cleared_at FROM push_occurrences WHERE cause = 'print'")["cleared_at"] is None


def test_printer_failed_and_obico_failure_are_one_push():
    send = Send()
    urgent.check({"printer": rec("printing"), "obico": rec("failure", "Obico sees spaghetti", "x")}, T, send=send)
    urgent.check({"printer": rec("failed"), "obico": rec("failure")}, T + 60, send=send)
    assert [c[0][0] for c in send.calls] == ["Obico sees spaghetti"]


def test_flap_within_600s_is_one_push():
    send = Send()
    urgent.check(FAILED, T, send=send)
    urgent.check(FINE, T + 30, send=send)
    assert db.one("SELECT cleared_at FROM push_occurrences")["cleared_at"] == T + 30
    urgent.check(FAILED, T + 600, send=send)  # 570 s after the clear
    assert len(send.calls) == 1
    assert db.one("SELECT cleared_at FROM push_occurrences")["cleared_at"] is None


def test_clear_for_600s_then_again_pushes_again():
    send = Send()
    urgent.check(FAILED, T, send=send)
    urgent.check(FINE, T + 30, send=send)
    urgent.check(FINE, T + 300, send=send)  # still clear: the clear time stays the first one
    assert urgent.check(FAILED, T + 630, send=send) == ["print"]
    assert len(send.calls) == 2


def test_a_failed_push_is_retried_next_pass():
    send = Send("The phone message didn't go out.")
    assert urgent.check(FAILED, T, send=send) == []
    row = db.one("SELECT * FROM push_occurrences")
    assert row["first_seen"] == T and row["pushed_at"] is None
    send.answer = "Sent."
    assert urgent.check(FAILED, T + 30, send=send) == ["print"]
    assert len(send.calls) == 2


def test_hms_and_pc_use_their_own_causes_and_links():
    send = Send()
    got = urgent.check({"hms": rec("stopped"), "pc_printing": rec("off_while_printing")}, T, send=send)
    assert sorted(got) == ["hms", "pc"]
    clicks = sorted(k["click"] for _, k in send.calls)
    assert clicks == ["https://home.home.arpa/", "https://home.home.arpa/workshop"]


def test_recently_pushed():
    urgent.check(FAILED, T, send=Send())
    assert urgent.recently_pushed("print", T + 599)
    assert not urgent.recently_pushed("print", T + 600)
    assert not urgent.recently_pushed("pc", T)


def _rule(kind, action="notify", target=None):
    return {"id": 1, "trigger": kind, "action": action, "target": target, "enabled": 1}


def test_print_failed_rule_skips_its_push_after_urgent(monkeypatch):
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    urgent.check(FAILED, T, send=Send())
    monkeypatch.setattr(urgent.time, "time", lambda: T + 30)
    assert events.execute(_rule("print_failed"), "print_failed", "at 40%") == {
        "status": "skipped", "message": "Already sent as an urgent alert."}
    assert sent == []


def test_print_failed_rule_still_pushes_without_an_urgent_alert(monkeypatch):
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    assert events.execute(_rule("print_failed"), "print_failed", "at 40%")["status"] == "succeeded"
    assert len(sent) == 1


def test_quiet_hours_do_not_hold_urgent(monkeypatch, tmp_path):
    topic = tmp_path / "topic"
    topic.write_text("t0pic\n")
    monkeypatch.setattr(events, "TOPIC_FILE", str(topic))
    monkeypatch.setattr(events, "ntfy_servers", lambda: ["http://ntfy.test"])
    monkeypatch.setattr(events, "quiet_now", lambda now=None: True)
    out = []

    class Resp:
        def close(self):
            pass

    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", lambda req, timeout=None: out.append(req) or Resp())
    assert urgent.check(FAILED, T) == ["print"]  # the real events.push
    assert len(out) == 1 and out[0].get_header("Priority") == "high"
    monkeypatch.setattr(urgent.time, "time", lambda: T + 30)
    assert events.execute(_rule("print_failed"), "print_failed", "at 40%") == {
        "status": "skipped", "message": "Already sent as an urgent alert."}
    assert len(out) == 1


def test_pc_down_rule_still_runs_non_notify_actions(monkeypatch):
    from hub import homecontrol
    urgent.check({"pc_printing": rec("off_while_printing")}, T, send=Send())
    monkeypatch.setattr(urgent.time, "time", lambda: T + 30)
    sent, set_to = [], []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    monkeypatch.setattr(homecontrol, "accessories", lambda: [{"id": "lamp", "name": "Lamp", "control": "On"}])
    monkeypatch.setattr(homecontrol, "set_value", lambda id, c, v: set_to.append((id, v)))
    assert events.execute(_rule("pc_down"), "pc_down")["message"] == "Already sent as an urgent alert."
    assert events.execute(_rule("pc_down", "turn_on", "lamp"), "pc_down")["status"] == "succeeded"
    assert set_to == [("lamp", True)] and sent == []


def test_a_failure_seen_by_the_loop_is_one_phone_alert(monkeypatch):
    """Through the loop's own pass: the record turns failed and the print_failed rule fires in the same pass."""
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append((a, k)) or "Sent.")
    monkeypatch.setattr(urgent.time, "time", lambda: T + 60)
    events.loop_pass(True, T, PRINTING)
    events.loop_pass(False, T + 30, PRINTING)
    events.loop_pass(False, T + 60, inputs(bambuddy=bud("FAILED", 40, awaiting=True)))
    events.loop_pass(False, T + 90, inputs(bambuddy=bud("FAILED", 40, awaiting=True)))
    assert records.get("printer")["state"] == "failed"
    assert [e["kind"] for e in events.recent(10)] == ["print_failed"]
    assert len(sent) == 1 and sent[0][1].get("urgent") is True
