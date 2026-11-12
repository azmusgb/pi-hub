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
