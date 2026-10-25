import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
os.environ.setdefault("HUB_DB", os.path.join(tempfile.mkdtemp(), "hub.db"))

from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hub_app, paperless  # noqa: E402

PAGE = {"results": [{"id": 42, "title": "AT&T bill", "created": "2026-10-01T00:00:00Z", "correspondent": 3}]}


def owner(monkeypatch):
    monkeypatch.setattr(hub_app, "need", lambda request, role: ("owner", "test"))


def fake(monkeypatch, calls, result=PAGE, token="tok"):
    def get(url, token):
        calls.append(url)
        if isinstance(result, Exception):
            raise result
        return result
    monkeypatch.setattr(paperless, "_get", get)
    monkeypatch.setattr(paperless, "_token", lambda: token)


def test_search_encodes_and_caps_the_query(monkeypatch):
    calls = []
    fake(monkeypatch, calls)
    out = paperless.search('bill "AT&T" ' + "x" * 200)
    assert "query=bill+%22AT%26T%22" in calls[0] and "page_size=8" in calls[0]
    q = calls[0].split("query=")[1].split("&")[0]
    assert len(q.replace("+", " ").replace("%22", '"').replace("%26", "&")) <= 100
    assert out == [{"id": 42, "title": "AT&T bill", "created": "2026-10-01", "link": "tool:paperless/documents/42/details"}]


def test_empty_query_returns_recent(monkeypatch):
    calls = []
    fake(monkeypatch, calls)
    paperless.search("   ")
    assert "query=" not in calls[0] and "ordering=-created" in calls[0]


def test_documents_says_unavailable_when_paperless_is_off(monkeypatch):
    fake(monkeypatch, [], result=OSError("refused"))
    owner(monkeypatch)
    r = TestClient(hub_app.app).get("/api/documents", params={"q": "bill"})
    assert r.status_code == 200 and r.json()["available"] is False and r.json()["results"] == []


def test_no_token_means_unavailable(monkeypatch):
    calls = []
    fake(monkeypatch, calls, token=None)
    assert paperless.search("bill") is None and calls == []
    owner(monkeypatch)
    r = TestClient(hub_app.app).get("/api/documents").json()
    assert r["available"] is False and r["open"] == "tool:paperless"


def test_documents_are_for_the_owner_only(monkeypatch):
    calls = []
    fake(monkeypatch, calls)
    r = TestClient(hub_app.app).get("/api/documents", params={"q": "tax"})
    assert r.status_code == 401 and calls == []


def test_scan_signed_out_page_is_styled():
    c = TestClient(hub_app.app)
    r = c.get("/scan/")
    assert r.status_code == 401 and r.headers["content-type"].startswith("text/html")
    html = r.text
    assert "<h1>Scan needs the household PIN</h1>" in html
    assert 'href="/static/ui/tokens.css"' in html and 'href="/static/ui/components.css"' in html
    assert 'class="ui-btn ui-btn--primary"' in html and 'target="_top"' in html
    assert 'lang="en"' in html and "Open Pi Hub" not in html


def test_scan_signed_out_page_follows_the_hub_theme():
    html = TestClient(hub_app.app).get("/scan/").text
    head = html[:html.index("</head>")]
    assert '<script src="/static/js/saved-theme.js"></script>' in head
    assert head.index("saved-theme.js") < head.index("/static/ui/tokens.css")
