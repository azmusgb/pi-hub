import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, db  # noqa: E402
from hub import app as hub_app  # noqa: E402


@pytest.fixture
def c():
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    return TestClient(hub_app.app)


def test_shortcut_key_adds_to_lists_and_reads_them_back(c):
    key = auth.add_shortcut_key("Bill's iPhone")
    hdr = {"Authorization": f"Bearer {key}"}
    r = c.post("/api/shortcut/add", json={"text": "  oat milk ", "list": "Groceries"}, headers=hdr)
    assert r.status_code == 200 and r.text == "Added oat milk to the shopping list."
    assert c.post("/api/shortcut/add", content="bin bags", headers=hdr).text == "Added bin bags to the shopping list."
    assert c.get("/api/shortcut/list?list=shopping", headers=hdr).text == "2 on the shopping list: oat milk, bin bags."
    assert auth.shortcut_keys()[0]["last_used"]


def test_bad_or_missing_key_is_refused(c):
    assert c.post("/api/shortcut/add", json={"text": "x"}, headers={"Authorization": "Bearer hub_nope"}).status_code == 401
    assert c.post("/api/shortcut/add", json={"text": "x"}).status_code == 403  # no key: the normal page rules apply
    assert c.get("/api/shortcut/status").status_code == 401


def test_removed_key_stops_working(c):
    key = auth.add_shortcut_key("Old phone")
    auth.remove_shortcut_key(auth.shortcut_keys()[0]["id"])
    assert c.get("/api/shortcut/status", headers={"Authorization": f"Bearer {key}"}).status_code == 401


def test_keys_are_stored_only_as_hashes(c):
    key = auth.add_shortcut_key("Phone")
    assert key not in str(db.rows("SELECT * FROM shortcut_keys"))
