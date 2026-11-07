"""Start waits for the bed (amendment A12b): only the bed can be waited for, everything is checked again when it cools,
one hold, 45 minutes, owner-cancellable, a restart drops it. Bambuddy is the fake from test_lab_start."""
import pytest

from hub import auth, lab_hold, lab_start, sources
from test_lab_start import SAME, client, experiment, fake, kinds, printer, start, sync  # noqa: F401  (fixtures)


@pytest.fixture(autouse=True)
def clean_hold():
    lab_hold._hold = lab_hold._last = None
    yield
    lab_hold._hold = lab_hold._last = None


def pnow():
    return sources.bambuddy_printer(timeout=1)


def hold(client, **body):
    return start(client, wait_for_bed=True, **body)


def test_a_warm_bed_with_wait_for_bed_is_held_and_nothing_is_sent(client, fake, printer):
    printer["bed_temp"] = 52.0
    r = hold(client)
    assert r.status_code == 200 and r.json()["held"] is True and "52 °C" in r.json()["say"]
    assert fake.calls == []
    got = client.get("/api/printer/start/hex-tile/E-026").json()
    assert got["bed_only"] is True and got["hold"]["experiment"] == "E-026" and got["hold"]["minutes"] == 45
    assert auth.recent_actions(1)[0]["action"] == "printer:hold:placed:hex-tile:E-026"


def test_without_wait_for_bed_a_warm_bed_is_still_refused(client, fake, printer):
    printer["bed_temp"] = 52.0
    r = start(client)
    assert r.status_code == 409 and "The bed is 52 °C" in r.json()["detail"] and lab_hold.state("hex-tile", "E-026")["hold"] is None


@pytest.mark.parametrize("change", [{"bambuddy_state": "RUNNING"}, {"hms": [{"code": "0300"}]}, {"connected": False}])
def test_only_the_bed_can_be_waited_for(client, fake, printer, change):
    printer.update(change, bed_temp=52.0)
    r = hold(client)
    assert r.status_code == 409 and lab_hold.state("hex-tile", "E-026")["hold"] is None and fake.calls == []


def test_a_cool_bed_with_wait_for_bed_starts_at_once(client, fake, printer):
    r = hold(client)
    assert r.json().get("held") is None and r.json()["queue_item"] == 41


def test_the_hold_sends_when_the_bed_is_cool_and_logs_and_tells_lab_pull(client, fake, printer):
    printer["bed_temp"] = 52.0
    hold(client)
    lab_hold.step(pnow)
    assert fake.calls == [] and lab_hold.state("hex-tile", "E-026")["hold"]["bed"] == 52.0  # still waiting
    printer["bed_temp"] = 34.0
    lab_hold.step(pnow)
    assert kinds(fake)[-1] == ("POST", "/queue/41/start")
    st = lab_hold.state("hex-tile", "E-026")
    assert st["hold"] is None and st["last"]["status"] == "sent" and st["last"]["queue_item"] == 41
    assert auth.recent_actions(1)[0]["action"] == "printer:hold:sent:hex-tile:E-026"
    items = client.get("/api/lab/hex-tile/requests?status=pending", headers={"X-Hub-Mac-Key": __import__("test_lab_start").KEY}).json()["items"]
    (req,) = [i for i in items if i["kind"] == "one_tap"]
    assert req["payload"]["queue_item"] == 41 and req["payload"]["tapped_at"].endswith("+00:00")
    n = len(fake.calls)
    lab_hold.step(pnow)
    assert len(fake.calls) == n  # nothing left to send


def test_another_refusal_while_waiting_ends_the_hold_without_sending(client, fake, printer):
    printer["bed_temp"] = 52.0
    hold(client)
    printer.update(bambuddy_state="RUNNING", bed_temp=30.0)
    lab_hold.step(pnow)
    last = lab_hold.state("hex-tile", "E-026")["last"]
    assert last["status"] == "refused" and "isn't idle" in last["say"] and fake.calls == []


def test_a_changed_staged_build_ends_the_hold(client, fake, printer):
    printer["bed_temp"] = 52.0
    hold(client)
    x = experiment()
    x["staged"] = dict(x["staged"], sha256="0" * 64)
    sync(client, x)
    printer["bed_temp"] = 30.0
    lab_hold.step(pnow)
    assert lab_hold.state("hex-tile", "E-026")["last"]["status"] == "cancelled" and fake.calls == []


def test_the_hold_expires_after_45_minutes(client, fake, printer):
    printer["bed_temp"] = 52.0
    hold(client)
    t0 = lab_hold._hold["at"]
    lab_hold.step(pnow, now=lambda: t0 + 45 * 60 - 1)
    assert lab_hold.state("hex-tile", "E-026")["hold"] is not None
    printer["bed_temp"] = 30.0
    lab_hold.step(pnow, now=lambda: t0 + 45 * 60)
    assert lab_hold.state("hex-tile", "E-026")["last"]["status"] == "expired" and fake.calls == []


def test_cancelling_stops_the_start_and_is_logged(client, fake, printer):
    printer["bed_temp"] = 52.0
    hold(client)
    r = client.delete("/api/printer/start/hex-tile/E-026", headers=SAME)
    assert r.status_code == 200 and r.json()["cancelled"] is True
    printer["bed_temp"] = 30.0
    lab_hold.step(pnow)
    assert fake.calls == [] and auth.recent_actions(1)[0]["action"] == "printer:hold:cancelled:hex-tile:E-026"
    assert client.delete("/api/printer/start/hex-tile/E-026", headers=SAME).json()["cancelled"] is False


def test_only_one_hold_at_a_time(client, fake, printer):
    printer["bed_temp"] = 52.0
    assert hold(client).status_code == 200
    r = hold(client)
    assert r.status_code == 409 and "Already waiting" in r.json()["detail"]


def test_cancelling_needs_the_owner(client, fake, printer):
    client.cookies.clear()
    assert client.delete("/api/printer/start/hex-tile/E-026", headers=SAME).status_code in (401, 403)


def test_bed_only_names_exactly_the_bed():
    x = experiment()
    p = {"connected": True, "bambuddy_state": "FINISH", "hms": [], "bed_temp": 50.0}
    assert lab_start.bed_only(p, x) is True
    assert lab_start.bed_only(dict(p, bed_temp=20.0), x) is False  # nothing refuses
    assert lab_start.bed_only(dict(p, bed_temp=None), x) is False  # unknown isn't warm
    assert lab_start.bed_only(dict(p, bed_temp=True), x) is False
    assert lab_start.bed_only(dict(p, bambuddy_state="RUNNING"), x) is False
    assert lab_start.bed_only(p, experiment(staged=False)) is False
    assert lab_start.bed_only(None, x) is False
