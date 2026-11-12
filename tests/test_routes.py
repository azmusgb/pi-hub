"""Platform step 7, PR 7.4: the server knows the shell's addresses (the kit's page list, since A22 step 12) and answers any other
path with a real 404 page, not the shell; /api/* is unchanged; the old /scan/* proxy moves to the scan host."""
import json
import re
from pathlib import Path

from fastapi.testclient import TestClient

from hub import app as hub_app

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "hub" / "static" / "js"


SAME = {"Origin": "http://testserver"}  # a change has to come from the hub's own page


def client():
    return TestClient(hub_app.app)


def test_every_listed_page_and_redirect_gets_the_shell():
    c = client()
    for path in sorted(hub_app.SHELL_PATHS):
        r = c.get(path)
        assert r.status_code == 200, path
        assert 'id="view"' in r.text, path


def test_an_unknown_path_gets_a_404_page_not_the_shell():
    shell = client().get("/").text
    for path in ("/nope", "/control/x", "/system/health", "/next/"):
        r = client().get(path)
        assert r.status_code == 404, path
        assert r.headers["content-type"].startswith("text/html")
        assert "<h1>Page not found</h1>" in r.text and r.text != shell
        assert 'href="/"' in r.text and 'href="/system"' in r.text
        assert 'href="/static/ui/tokens.css"' in r.text and "saved-theme.js" in r.text


def test_api_paths_are_unchanged():
    r = client().get("/api/no-such-thing")
    assert r.status_code == 404 and r.headers["content-type"].startswith("application/json")


def test_scan_moves_to_the_scan_host_keeping_path_and_query():
    c = client()
    r = c.get("/scan/api/v1/context?x=1", follow_redirects=False)
    assert r.status_code == 308
    assert r.headers["location"] == "https://scan.rahe-home.duckdns.org/api/v1/context?x=1"
    # A22 section 10: GET /scan is Pi Hub's Scan page now; any other method to it still moves, keeping the method.
    for method in ("POST", "PUT", "DELETE"):
        r = c.request(method, "/scan?x=1", headers=SAME, follow_redirects=False)
        assert r.status_code == 308, method
        assert r.headers["location"] == "https://scan.rahe-home.duckdns.org/?x=1"
    for method in ("POST", "PUT", "DELETE"):
        assert c.request(method, "/scan/api/v1/scan", headers=SAME, follow_redirects=False).status_code == 308, method


def test_get_scan_is_the_scan_page_in_the_shell():
    r = client().get("/scan", follow_redirects=False)
    assert r.status_code == 200 and 'id="view"' in r.text


def _listed():
    """Pi Hub's pages and old addresses as the kit's page list has them (A22 section 3), read here on its own."""
    pages = json.loads((ROOT / "hub/static/ui/pages.json").read_text())["pages"]
    mine = [p for p in pages if p["system"] == "hub" and p.get("built") is not False and "#" not in p["path"]]
    drawn = {p["path"] for p in mine if p["role"] != "standalone"} | {"/assistant"}
    return drawn, {a for p in mine for a in p.get("aliases", [])}


def test_the_router_draws_exactly_the_pages_the_server_lists():
    main = (JS / "main.js").read_text()
    block = main[main.index("const ROUTES = {"):main.index("};", main.index("const ROUTES = {"))]
    drawn = set(re.findall(r'^\s*"(/[^"]*)":', block, re.M))
    pages, redirects = _listed()
    assert drawn == pages
    assert not pages & redirects
    assert hub_app.SHELL_PATHS == pages | redirects


def test_retired_paths_are_redirects_only():
    pages, redirects = _listed()
    for path in ("/control", "/movies", "/next", "/more", "/apps/status"):
        assert path in redirects and path not in pages
        assert path in hub_app.SHELL_PATHS


def test_a_page_not_built_yet_and_a_page_the_server_writes_are_not_shell_paths():
    # Print lab's Designs and Lab tools are in the list with built: false (step 15 builds them): a 404 until then.
    for path in ("/lab/designs", "/lab/tools"):
        assert path not in hub_app.SHELL_PATHS
        assert client().get(path).status_code == 404
    assert "/privacy" not in hub_app.SHELL_PATHS and client().get("/privacy").status_code == 200
