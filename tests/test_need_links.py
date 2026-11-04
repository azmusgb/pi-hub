"""Every Needs you item opens the exact page and item it is about (UX item 7): no retired path, no section landing page
when a deeper one exists, and the server's record links agree with the browser's (control-room.js RECORD_PATHS)."""
import json
import re
from pathlib import Path

from hub import needs, now

ROOT = Path(__file__).resolve().parents[1]
NOW = 1793500000


def _routes():
    text = (ROOT / "hub/static/js/routes.js").read_text()
    return json.loads(text[re.search(r"^export default", text, re.M).end():].strip().rstrip(";"))


ROUTES = _routes()


def _record_paths():
    text = (ROOT / "hub/static/js/control-room.js").read_text()
    block = text[text.index("export const RECORD_PATHS = {"):]
    block = block[:block.index("};")]
    return dict(re.findall(r'^\s*([a-z_]+): "([^"]+)",', block, re.M))


def _lab(*ns, project="hex-tile"):
    return [(project, "2026-11-04T00:00:00Z", list(ns))]


def _need(eid, action, urgency=1):
    return {"id": eid, "action": action, "why": "x", "urgency": urgency}


def test_a_lab_need_opens_its_project_and_experiment():
    items = needs.build([], None, NOW, lab=_lab(_need("E-025", "Judge the print"), _need("E-026", "Approve or drop"),
                                               project="vase-mode"))["items"]
    links = {i["title"].split(":")[0]: i["link"] for i in items}
    assert links["E-025"] == "/lab?p=vase-mode&e=E-025&do=judge"
    assert links["E-026"] == "/lab?p=vase-mode&e=E-026"


def test_record_links_are_shell_pages_never_redirects_or_retired_paths():
    for key, href in now.HREF.items():
        path = href.split("?")[0]
        assert path in ROUTES["pages"], (key, href)
        assert path not in ROUTES["redirects"], (key, href)


def test_server_and_browser_agree_on_each_records_page():
    browser = _record_paths()
    for key, path in browser.items():
        assert now.HREF.get(key) == path, (key, now.HREF.get(key), path)


def test_records_with_their_own_page_link_there_not_to_health():
    assert now.HREF["backups"] == "/backups"
    assert now.HREF["paper_printer"] == "/print"
    assert now.HREF["plex"] == "/media"
    assert now.HREF["devices"] == "/network"
    assert now.issue_from({"id": "something_new", "severity": "attention", "headline": "x"})["href"] == "/system"


def test_the_hubs_live_issues_never_link_a_retired_path():
    found = now.issues(None) + now.issues({"services": {}, "drive_state": None, "ai_state": "Down",
                                          "display_state": "Offline", "x2d_state": "Error"})
    hrefs = [i["href"] for i in found if "href" in i]
    assert hrefs and not any(h.split("?")[0] in ROUTES["redirects"] for h in hrefs)
    assert now.quiet_source("bambuddy", [{"id": "printer", "as_of": NOW}])["href"] == "/system"


def test_local_ai_items_open_the_assistant_page_they_are_about():
    feed = {"cards": [
        {"kind": "needs", "id": "needs-2", "title": "Needs you", "text": "2 approvals", "tone": "attention"},
        {"kind": "running", "id": "running-r1", "title": "Working on", "text": "Research", "tone": "warning"},
        {"kind": "done", "id": "done-r2", "title": "Didn't finish", "text": "Report", "tone": "warning"},
        {"kind": "disk", "id": "disk-C", "title": "Disk", "text": "C: 3 GB free", "tone": "attention"},
        {"kind": "watch", "id": "watch-x", "title": "Worth a look", "text": "A monitor fired", "tone": "warning"},
        {"kind": "odd", "id": "odd-1", "title": "Odd", "text": "?", "tone": "warning"},
    ]}
    links = {i["id"]: i["link"] for i in needs.build([], feed, NOW)["items"]}
    assert links["localai:needs-2"] == "tool:assistant/#inbox"
    assert links["localai:running-r1"] == "tool:assistant/#work"
    assert links["localai:done-r2"] == "tool:assistant/#work"
    assert links["localai:disk-C"] == "tool:assistant/#status"
    assert links["localai:watch-x"] == "tool:assistant/#inbox"
    assert links["localai:odd-1"] == "tool:assistant"

