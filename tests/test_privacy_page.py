"""/privacy: the privacy note Google's consent screen links to for the pi-offsite backup app (A5)."""
from fastapi.testclient import TestClient

from hub.app import app


def test_privacy_is_a_standalone_page_that_says_what_the_app_stores():
    r = TestClient(app).get("/privacy")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/html")
    body = r.text
    assert "<title>Privacy note · Pi Hub</title>" in body and "<h1>Privacy note</h1>" in body  # its name in the page list
    assert "drive.file" in body
    assert "encrypted" in body
    assert "<main" in body and '<script type="module"' not in body  # not the app shell


def test_privacy_starts_with_the_way_back_to_pi_hub():
    # A22 6.4 (kit 2.21.0): a page of ours outside the frame starts with the kit's back bar, one link, named.
    body = TestClient(app).get("/privacy").text
    bar = '<nav class="ui-backbar" aria-label="Pi Hub"><a href="/" aria-label="Back to Pi Hub">'
    assert body.count('class="ui-backbar"') == 1 and bar in body
    assert body.index("<body>") < body.index(bar) < body.index("<main")  # the first thing in the document
    assert body.split(bar)[0].split("<body>")[1].strip() == ""
    assert '<script src="/static/ui/backbar.js" defer></script>' in body  # back to the Pi Hub page they came from
