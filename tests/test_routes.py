"""Platform step 7, PR 7.4: the server knows the shell's addresses (hub/static/js/routes.js) and answers any other
path with a real 404 page, not the shell; /api/* is unchanged; the old /scan/* proxy moves to the scan host."""
import re
from pathlib import Path

from fastapi.testclient import TestClient

from hub import app as hub_app

ROOT = Path(__file__).resolve().parents[1]
JS = ROOT / "hub" / "static" / "js"


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
    assert c.get("/scan", follow_redirects=False).headers["location"] == "https://scan.rahe-home.duckdns.org/"


def test_the_router_draws_exactly_the_pages_the_server_lists():
    main = (JS / "main.js").read_text()
    block = main[main.index("const PAGES = {"):main.index("};", main.index("const PAGES = {"))]
    drawn = set(re.findall(r'^\s*"(/[^"]*)":', block, re.M))
    assert drawn == set(hub_app._ROUTES["pages"])
    assert not set(hub_app._ROUTES["pages"]) & set(hub_app._ROUTES["redirects"])


def test_retired_paths_are_redirects_only():
    redirects = hub_app._ROUTES["redirects"]
    for path in ("/control", "/movies", "/next"):
        assert path in redirects and path not in hub_app._ROUTES["pages"]
