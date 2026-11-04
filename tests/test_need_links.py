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


CONTROL_ROOM = (ROOT / "hub/static/js/control-room.js").read_text()


def _js_object(name):
    block = CONTROL_ROOM[CONTROL_ROOM.index(f"export const {name} = {{"):]
    block = block[:block.index("};")]
    return dict(re.findall(r'^\s*"?([a-z_:]+)"?: "([^"]+)",', block, re.M))


def _js_const(name):
    return re.search(rf'^export const {name} = "([^"]+)";', CONTROL_ROOM, re.M).group(1)


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
    browser, prefixes = _js_object("RECORD_PATHS"), _js_object("RECORD_PREFIX_PATHS")
    server = {k: v for k, v in now.HREF.items() if not any(k.startswith(p) for p in prefixes)}
    assert server == browser  # the same keys both ways, each to the same page
    for key, path in now.HREF.items():  # release:<target> and other prefixed ids
        for prefix, page in prefixes.items():
            if key.startswith(prefix):
                assert path == page, (key, path, page)
    unknown = now.issue_from({"id": "something_new", "severity": "attention", "headline": "x"})["href"]
    assert _js_const("RECORD_FALLBACK") == unknown == "/system"


# Literal page paths in the browser's link builders: none may be a redirect or a retired path.
LINK_BUILDERS = ["now.js", "control-room.js", "home-cards.js", "command-palette.js", "sections.js"]
RETIRED = {"/scan"}  # answered by the server with a 308 to the scan host (7.4), never a shell page


def test_browser_links_never_point_at_a_redirect_or_retired_path():
    bad = set(ROUTES["redirects"]) | RETIRED
    found = []
    for name in LINK_BUILDERS:
        text = (ROOT / "hub/static/js" / name).read_text()
        for m in re.finditer(r'(?:href|path|link)\s*[:=]\s*["`](/[a-z][a-z/-]*)(?=["`?#])|^\s*[a-z_]+: "(/[a-z][a-z/-]*)",', text, re.M):
            path = m.group(1) or m.group(2)
            if path.rstrip("/") in bad:
                found.append(f"{name}: {path}")
    assert found == []


def test_records_with_their_own_page_link_there_not_to_health():
    assert now.HREF["backups"] == "/backups"
    assert now.HREF["paper_printer"] == "/print"
    assert now.HREF["plex"] == "/media"
    assert now.HREF["devices"] == "/network"


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


def test_local_ai_the_display_and_the_pc_open_health_where_they_are_shown():
    """Workshop flow W.1: their cards left Workshop; Health shows their state."""
    for key in ("local_ai", "workshop_display", "pc"):
        assert now.HREF[key] == "/system", key
    assert now.HREF["pc_printing"] == "/workshop"
    found = now.issues({"services": {}, "drive_state": None, "ai_state": "Down", "display_state": "Offline"})
    links = {i["what"]: (i.get("href"), i.get("link_label")) for i in found}
    assert links["Windows PC"] == ("/system", "Check Health")
    assert links["Workshop display"] == ("/system", "Check Health")
