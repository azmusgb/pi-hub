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


def rec(state, headline="H", cause="C", stale=False, **detail):
    r = {"state": state, "headline": headline, "cause": cause}
    if detail:
        r["detail"] = detail
    if stale:
        r["stale"] = True
    return r


STARTED = T - 1000  # one print: every record below belongs to it
FAILED = {"printer": rec("failed", "The print failed", "Stopped at 40%.", last_progress=40, started=STARTED),
          "obico": rec("watching")}
FINE = {"printer": rec("idle"), "obico": rec("watching")}


def test_failed_print_pushes_once_with_click_and_urgent():
    send = Send()
    assert urgent.check(FAILED, T, send=send) == ["print"]
    assert urgent.check(FAILED, T + 30, send=send) == []
    assert len(send.calls) == 1
    (title, body), k = send.calls[0]
    assert title == "X2D print stopped at 40%" and body == "Stopped at 40%."
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
    urgent.check({"printer": rec("printing", started=STARTED), "obico": rec("failure", "Obico sees spaghetti", "")},
                 T, send=send)
    urgent.check({"printer": rec("failed", started=STARTED, last_progress=30), "obico": rec("failure")}, T + 60,
                 send=send)
    assert [c[0] for c in send.calls] == [("X2D print failed", "Obico sees spaghetti.")]


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


def test_hms_is_a_print_cause_and_pc_has_its_own_link():
    send = Send()
    got = urgent.check({"hms": rec("stopped"), "pc_printing": rec("off_while_printing")}, T, send=send)
    assert sorted(got) == ["pc", "print"]
    clicks = sorted(k["click"] for _, k in send.calls)
    assert clicks == ["https://home.home.arpa/", "https://home.home.arpa/workshop"]


def test_recently_pushed():
    urgent.check(FAILED, T, send=Send())
    assert urgent.recently_pushed("print", T + 599)
    assert not urgent.recently_pushed("print", T + 600)
    assert not urgent.recently_pushed("pc", T)


def _rule(kind, action="notify", target=None):
    return {"id": 1, "trigger": kind, "action": action, "target": target, "enabled": 1}


SENT_BY_HUB = {"status": "skipped", "message": "Print failures reach your phone as the hub's urgent alerts."}


def test_print_failed_rule_skips_its_push_after_urgent(monkeypatch):
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    urgent.check(FAILED, T, send=Send())
    monkeypatch.setattr(events.time, "time", lambda: T + 30)
    assert events.execute(_rule("print_failed"), "print_failed", "at 40%") == SENT_BY_HUB
    assert sent == []


def test_print_failed_rule_never_pushes_even_without_an_urgent_alert(monkeypatch):
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    assert events.execute(_rule("print_failed"), "print_failed", "at 40%") == SENT_BY_HUB
    assert sent == []


def test_pc_down_rule_still_pushes_without_an_urgent_alert(monkeypatch):
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")
    assert events.execute(_rule("pc_down"), "pc_down")["status"] == "succeeded"
    assert len(sent) == 1


def test_print_failed_rule_still_runs_non_notify_actions(monkeypatch):
    from hub import homecontrol
    set_to = []
    monkeypatch.setattr(homecontrol, "accessories", lambda: [{"id": "lamp", "name": "Lamp", "control": "On"}])
    monkeypatch.setattr(homecontrol, "set_value", lambda id, c, v: set_to.append((id, v)))
    assert events.execute(_rule("print_failed", "turn_on", "lamp"), "print_failed")["status"] == "succeeded"
    assert set_to == [("lamp", True)]


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
    monkeypatch.setattr(events.time, "time", lambda: T + 30)
    assert events.execute(_rule("print_failed"), "print_failed", "at 40%") == SENT_BY_HUB
    assert events.execute(_rule("pc_down"), "pc_down")["message"] == "Phone alert held back for quiet hours."
    assert len(out) == 1


def test_pc_down_rule_still_runs_non_notify_actions(monkeypatch):
    from hub import homecontrol
    urgent.check({"pc_printing": rec("off_while_printing")}, T, send=Send())
    monkeypatch.setattr(events.time, "time", lambda: T + 30)
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
    monkeypatch.setattr(events.time, "time", lambda: T + 60)
    events.loop_pass(True, T, PRINTING)
    events.loop_pass(False, T + 30, PRINTING)
    events.loop_pass(False, T + 60, inputs(bambuddy=bud("FAILED", 40, awaiting=True)))
    events.loop_pass(False, T + 90, inputs(bambuddy=bud("FAILED", 40, awaiting=True)))
    assert records.get("printer")["state"] == "failed"
    assert [e["kind"] for e in events.recent(10)] == ["print_failed"]
    assert len(sent) == 1 and sent[0][1].get("urgent") is True


def test_webhook_failure_then_loop_is_one_phone_alert(monkeypatch):
    """Bambuddy's webhook fires print_failed before any records pass; the next pass sends the one push."""
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append((a, k)) or "Sent.")
    monkeypatch.setattr(events.time, "time", lambda: T + 45)
    events.loop_pass(True, T, PRINTING)
    events.loop_pass(False, T + 30, PRINTING)
    events.fire("print_failed", detail="Print failed", dedupe=events.PRINT_DEDUPE)  # as hub/app.py does
    assert sent == []
    events.loop_pass(False, T + 60, inputs(bambuddy=bud("FAILED", 40, awaiting=True)))
    events.loop_pass(False, T + 90, inputs(bambuddy=bud("FAILED", 40, awaiting=True)))
    assert len(sent) == 1
    assert sent[0][1] == {"tags": "rotating_light", "priority": "high", "urgent": True,
                          "click": "https://home.home.arpa/workshop"}


def _cancel(monkeypatch, awaiting):
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append((a, k)) or "Sent.")
    monkeypatch.setattr(events.time, "time", lambda: T + 60)
    events.loop_pass(True, T, PRINTING)
    events.loop_pass(False, T + 30, inputs(bambuddy=bud("RUNNING", 30)))
    events.loop_pass(False, T + 60, inputs(bambuddy=bud("FAILED", 30, awaiting=awaiting)))
    events.loop_pass(False, T + 90, inputs(bambuddy=bud("FAILED", 30, awaiting=awaiting)))
    return sent


def test_a_cancel_without_awaiting_plate_clear_sends_no_alert(monkeypatch):
    """The ruled behaviour: FAILED without awaiting_plate_clear is an idle record, and print_failed's own
    notify never sends, so a cancel like this one reaches no phone."""
    sent = _cancel(monkeypatch, awaiting=False)
    assert records.get("printer")["state"] == "idle"
    assert "print_failed" in [e["kind"] for e in events.recent(10)]
    assert sent == []


def test_a_cancel_awaiting_plate_clear_is_one_urgent_push(monkeypatch):
    sent = _cancel(monkeypatch, awaiting=True)
    assert len(sent) == 1 and sent[0][1]["urgent"] is True
    assert sent[0][0][0] == "X2D print stopped at 30%"


def test_a_retry_that_fails_within_600s_pushes_again(monkeypatch):
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append((a, k)) or "Sent.")
    monkeypatch.setattr(events.time, "time", lambda: T + 300)
    events.loop_pass(True, T, PRINTING)
    events.loop_pass(False, T + 30, inputs(bambuddy=bud("RUNNING", 20)))
    events.loop_pass(False, T + 60, inputs(bambuddy=bud("FAILED", 20, awaiting=True)))  # push 1
    events.loop_pass(False, T + 90, IDLE)  # the plate cleared
    events.loop_pass(False, T + 120, inputs(bambuddy=bud("RUNNING", 1)))  # the retry
    events.loop_pass(False, T + 150, inputs(bambuddy=bud("RUNNING", 5)))
    events.loop_pass(False, T + 180, inputs(bambuddy=bud("FAILED", 5, awaiting=True)))  # 120 s after push 1
    events.loop_pass(False, T + 210, inputs(bambuddy=bud("FAILED", 5, awaiting=True)))
    assert [a[0] for a, _ in sent] == ["X2D print stopped at 20%", "X2D print stopped at 5%"]


def test_a_retry_failing_while_the_hub_missed_the_clear_pushes_again():
    send = Send()
    urgent.check(FAILED, T, send=send)
    retry = {"printer": rec("failed", last_progress=5, started=T + 100), "obico": rec("watching")}
    assert urgent.check(retry, T + 200, send=send) == ["print"]
    assert urgent.check(retry, T + 230, send=send) == []
    assert len(send.calls) == 2


def test_hms_stop_reason_is_named_in_the_body():
    send = Send()
    urgent.check({"printer": rec("failed", "", "", last_progress=12, started=STARTED),
                  "hms": rec("stopped", "Printer needs attention (0500_0200)", "")}, T, send=send)
    assert send.calls[0][0] == ("X2D print stopped at 12%", "Printer needs attention (0500_0200).")


def test_obico_with_no_cause_does_not_repeat_the_title():
    send = Send()
    urgent.check({"obico": rec("failure", "Failure detected on the X2D", "")}, T, send=send)
    title, body = send.calls[0][0]
    assert body != title and body == "Failure detected on the X2D."


def test_body_falls_back_to_the_workshop_page():
    send = Send()
    urgent.check({"printer": rec("failed", "", "")}, T, send=send)
    assert send.calls[0][0] == ("X2D print failed", "Open the Workshop page to look.")


def test_policy_and_preview_agree_on_print_failed(monkeypatch):
    monkeypatch.setattr(events, "quiet_now", lambda now=None: True)
    rule = _rule("print_failed")
    assert events.policy(rule, "print_failed") == SENT_BY_HUB
    events.fire("print_failed", "at 10%")
    p = events.preview({"trigger": "print_failed", "action": "notify"})
    assert p["would_run"] == 0 and p["would_skip"] == p["matches"] == 1
    assert p["now"] == SENT_BY_HUB
    assert p["text"] == "Print failures are sent by the hub's urgent alerts."


def test_the_seeded_print_failed_rule_is_relabelled():
    text = "Print failures are sent by the hub's urgent alerts"
    row = db.one("SELECT label FROM rules WHERE trigger = 'print_failed' AND action = 'notify'")
    assert row["label"] == text
    db.run("UPDATE rules SET label = 'Send a phone alert when a 3D print fails or stops early' "
           "WHERE trigger = 'print_failed'")
    db.run("INSERT INTO rules (trigger, action, label) VALUES ('print_failed', 'notify', 'my own words')")
    events._relabelled.clear()  # the hub starting on an existing install's DB
    events.ready()
    labels = sorted(r["label"] for r in db.rows("SELECT label FROM rules WHERE trigger = 'print_failed'"))
    assert labels == sorted([text, "my own words"])
    rules = {r["id"]: r for r in events.rules()}
    assert all(events.describe(r) == text + "." for r in rules.values()
               if r["trigger"] == "print_failed" and r["action"] == "notify")


def test_an_error_in_the_skip_falls_through_to_the_rule(monkeypatch):
    sent = []
    monkeypatch.setattr(events, "push", lambda *a, **k: sent.append(a) or "Sent.")

    def boom(*a, **k):
        raise RuntimeError("db locked")
    monkeypatch.setattr(urgent, "recently_pushed", boom)
    assert events.execute(_rule("pc_down"), "pc_down")["status"] == "succeeded"
    assert len(sent) == 1


def test_restart_with_every_record_stale_and_fine_changes_nothing():
    send = Send()
    events.loop_pass(True, T, PRINTING)  # the hub before the restart: records stored, all fine
    urgent.check(FAILED, T + 30, send=send)  # an open occurrence from before the restart
    send.calls.clear()
    records._reset_memory()
    records.load()  # every remembered record comes back stale
    recs = records.all()
    assert recs and all(r.get("stale") for r in recs.values())
    assert urgent.check(recs, T + 600, send=send) == []
    assert send.calls == []
    assert db.one("SELECT cleared_at FROM push_occurrences WHERE cause = 'print'")["cleared_at"] is None


def test_fallback_titles():
    send = Send()
    urgent.check({"hms": {"state": "stopped"}, "pc_printing": {"state": "off_while_printing"}}, T, send=send)
    assert sorted(c[0][0] for c in send.calls) == ["The PC needs you", "X2D print failed"]


def test_first_seen_is_kept_only_while_the_failing_push_stays_open():
    send = Send("The phone message didn't go out.")
    urgent.check(FAILED, T, send=send)
    urgent.check(FAILED, T + 30, send=send)
    assert db.one("SELECT first_seen FROM push_occurrences")["first_seen"] == T
    urgent.check(FINE, T + 60, send=send)
    urgent.check(FAILED, T + 2000, send=send)  # a new occurrence after a clear
    assert db.one("SELECT first_seen FROM push_occurrences")["first_seen"] == T + 2000
