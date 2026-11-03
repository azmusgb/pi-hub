"""Home, the wall, Needs you and Source responses read the records, so no two of them can disagree."""
import os
import tempfile
import time

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(tempfile.mkdtemp(), "hub.db"))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, now, records, sources  # noqa: E402
from tests.helpers_records import PI, T, bud, records_from  # noqa: E402

QUIET = dict(PI, mirror={"last_ok": T})
NET_PC_ON = {"win_ok": True, "status": "ok", "wan_ms": 20, "dns_ms": 10}


@pytest.fixture
def client(monkeypatch):
    """A hub whose records are `held`, with Local AI's feed empty and no source polled by the views."""
    held = {}
    monkeypatch.setattr(records, "all", lambda: held)
    monkeypatch.setattr(sources, "localai_feed", lambda: {"cards": []})
    monkeypatch.setattr(sources, "plex_sessions", lambda: [])
    monkeypatch.setattr(sources, "network_metrics", lambda: None)
    for name in ("pi_status", "bambuddy_printer", "lab_printing"):
        monkeypatch.setattr(sources, name, lambda name=name: pytest.fail(f"{name} polled: the views read the records"))
    c = TestClient(hub_app.app)
    c.held = held
    return c


def test_adguard_down_appears_in_now_and_needs(client):
    client.held.update(records_from(QUIET, bud(), NET_PC_ON, adguard={"ok": False, "message": "timed out"}))
    issues = client.get("/api/now").json()["issues"]
    assert [(i["what"], i["href"]) for i in issues] == [("Ad blocking", "/network")]
    assert issues[0]["say"] == "AdGuard isn't answering. Ad blocking is off for the house until it answers."
    items = client.get("/api/needs").json()["items"]
    assert [(i["id"], i["source"], i["link"]) for i in items] == [("pi:Ad blocking", "Pi Hub", "/network")]
    assert items[0]["detail"] == issues[0]["say"]


def test_pc_answering_with_local_ai_down_blames_local_ai_not_the_pc(client):
    client.held.update(records_from(dict(QUIET, ai_state="Down"), bud(), NET_PC_ON))
    issue = next(i for i in client.get("/api/now").json()["issues"] if i["what"] == "Local AI")
    assert "Local AI isn't answering" in issue["say"]
    assert "may be off" not in issue["say"].lower()
    assert issue["href"] == "/workshop" and issue["tone"] == "bad"
    item = next(i for i in client.get("/api/needs").json()["items"] if i["title"] == "Local AI")
    assert item["detail"] == issue["say"]


def test_home_and_help_tell_the_same_printer_story(client):
    # 26-27 Oct: Home said "Printing 11%" while Help said "3D printer: No status"
    client.held.update(records_from(dict(QUIET, x2d_state="No status"), bud("RUNNING", progress=11), NET_PC_ON))
    printer = client.get("/api/now").json()["printer"]
    row = next(r for r in client.get("/api/freshness").json()["readings"] if r["key"] == "printer")
    assert printer["state"] == "printing" and printer["progress"] == 11
    assert row["reading"] == printer["headline"] == "Printing HEX_TILE_v72, 11%"


def test_a_quiet_source_says_so_instead_of_a_state(client):
    before = records_from(QUIET, bud("RUNNING", progress=11), NET_PC_ON)
    client.held.update(before, printer=records.merge(before["printer"], None, T + 600))
    d = client.get("/api/now").json()
    issue = next(i for i in d["issues"] if i["what"] == "Bambu X2D")
    assert "Bambuddy not answering since" in issue["say"] and issue["tone"] == "warn"
    # the last reading stays on the card, marked stale, with no buttons that would need Bambuddy
    assert d["printer"]["state"] == "printing" and d["printer"]["stale"] is True and d["printer"]["actions"] == []
    assert "Bambuddy not answering since" in d["printer"]["detail"]


def test_a_failed_print_links_to_the_workshop_without_a_fix(client):
    client.held.update(records_from(QUIET, bud("FAILED", progress=40, awaiting=True), NET_PC_ON))
    d = client.get("/api/now").json()
    issue = d["issues"][0]
    assert issue["what"] == "Bambu X2D" and issue["href"] == "/workshop" and "fix" not in issue
    assert d["printer"]["state"] == "error" and d["printer"]["actions"] == ["clear"]


def _quiet_pi(after=600):
    """A refresh's records, then pi-status stops answering: every record it feeds goes stale."""
    before = records_from(QUIET, bud(), NET_PC_ON)
    return {id: (records.merge(r, None, T + after) if r["source"] == "pi_status" else r) for id, r in before.items()}


def test_a_quiet_source_is_one_issue_not_one_per_thing(client):
    client.held.update(_quiet_pi())
    issues = client.get("/api/now").json()["issues"]
    since = time.strftime("%H:%M", time.localtime(T))
    assert issues == [{"tone": "warn", "what": "The Pi's status service", "href": "/pi",
                       "say": f"Isn't answering since {since}. Last readings for Local AI, Workshop display, "
                              "Raspberry Pi, Movies drive, Movie copy from the PC, Movies, Smart-home controls "
                              "are shown as they were."}]
    items = client.get("/api/needs").json()["items"]
    assert [(i["id"], i["title"], i["tone"], i["link"]) for i in items] == [
        ("pi:source:pi_status", "The Pi's status service", "warn", "/pi")]
    assert items[0]["detail"] == issues[0]["say"]


def test_a_quiet_pi_status_takes_movies_with_it(client):
    # R28: the Movies record is built from pi-status's services.plex, so it goes quiet with pi-status, not alone
    assert records.SOURCE["plex"] == "pi_status"
    before = records_from(QUIET, bud(), NET_PC_ON)
    quiet = records_from(None, bud(), NET_PC_ON, now=T + 100)  # pi-status didn't answer this time
    held = {id: records.merge(before.get(id), quiet.get(id), T + 100) for id in before}
    assert held["plex"]["stale"] and held["plex"]["source"] == "pi_status"
    client.held.update(held)
    issues = client.get("/api/now").json()["issues"]
    assert [i["what"] for i in issues] == ["The Pi's status service"] and "Movies," in issues[0]["say"]


def test_one_stale_record_keeps_its_own_issue(client):
    before = records_from(QUIET, bud(), NET_PC_ON)
    client.held.update(before, pi=records.merge(before["pi"], None, T + 600))
    issues = client.get("/api/now").json()["issues"]
    assert [i["what"] for i in issues] == ["Raspberry Pi"]
    assert "not answering since" in issues[0]["say"]
    assert [i["id"] for i in client.get("/api/needs").json()["items"]] == ["pi:Raspberry Pi"]


def test_a_fix_comes_from_the_records_action():
    issue = now.issues_from(records_from(dict(QUIET, drive_state="Not mounted")))[0]
    assert (issue["fix"], issue["fix_label"], issue["href"]) == ("remount:movies", "Remount it", "/drives")
