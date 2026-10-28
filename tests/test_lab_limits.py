"""Lab bodies are read as a stream and refused at the cap, so one big upload cannot fill the Pi's memory."""
import asyncio
import hashlib
import os
import pathlib
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"
CODE_FILE = os.path.join(tempfile.mkdtemp(), "setup-code")
open(CODE_FILE, "w").write("LABS-4321\n")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import auth, lab, lab_guard  # noqa: E402
from hub import app as hub_app  # noqa: E402

SAME = {"Origin": "http://testserver"}
KEY = "hub-lab-key-0123456789abcdef0123456789abcdef"
SHA = "0" * 64
CHUNK = 64 * 1024
MIB = 1024 * 1024


@pytest.fixture
def env(tmp_path, monkeypatch):
    os.environ["HUB_DB"] = str(tmp_path / "hub.db")
    os.environ["HUB_LAB_DIR"] = str(tmp_path / "lab")
    os.environ["HUB_SETUP_CODE_FILE"] = CODE_FILE
    lab._ready_dbs.clear()
    auth._tries.clear()
    key_file = tmp_path / "lab_mac_key.sha256"
    key_file.write_text(hashlib.sha256(KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(key_file))
    c = TestClient(hub_app.app)
    assert c.post("/api/setup", json={"code": "LABS-4321", "owner_password": "long enough", "pin": "123456"},
                  headers=SAME).status_code == 200
    c.cookies.clear()
    assert c.post("/api/signin", json={"pin": "123456"}, headers=SAME).status_code == 200
    return c


def drive(method, path, headers, total, chunk=CHUNK):
    """Call the app at the ASGI level with a body of `total` bytes in chunks; return (status, body, chunks_consumed)."""
    state = {"sent": 0, "consumed": 0}
    sent_msgs = []

    async def receive():
        state["consumed"] += 1
        n = min(chunk, total - state["sent"])
        state["sent"] += n
        return {"type": "http.request", "body": b"x" * n, "more_body": state["sent"] < total}

    async def send(msg):
        sent_msgs.append(msg)

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "path": path,
             "raw_path": path.encode(), "query_string": b"", "scheme": "http", "server": ("testserver", 80),
             "client": ("127.0.0.1", 1), "root_path": "",
             "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]}
    asyncio.run(hub_app.app(scope, receive, send))
    status = next(m["status"] for m in sent_msgs if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in sent_msgs if m["type"] == "http.response.body")
    return status, body, state["consumed"]


def mac_headers():
    return {"host": "testserver", "x-hub-mac-key": KEY, "content-type": "application/octet-stream"}


def test_photo_over_8mib_streamed_is_refused_early(env):
    status, body, consumed = drive("PUT", f"/api/lab/hex-tile/photos/{SHA}.jpg", mac_headers(), 64 * MIB)
    assert status == 413
    assert b"limit 8 MB" in body
    assert consumed <= (8 * MIB) // CHUNK + 2


def test_incoming_photo_over_8mib_streamed_is_refused_early(env):
    from hub import db
    lab.ready()
    db.run("INSERT OR REPLACE INTO lab_projects (project, meta, index_json, synced_at) VALUES (?, '{}', '{}', 'x')", "hex-tile")
    cookie = "; ".join(f"{k}={v}" for k, v in env.cookies.items())
    h = {"host": "testserver", "origin": "http://testserver", "cookie": cookie}
    status, body, consumed = drive("PUT", f"/api/lab/hex-tile/incoming/{SHA}.jpg", h, 64 * MIB)
    assert status == 413
    assert consumed <= (8 * MIB) // CHUNK + 2


def test_index_over_4mib_streamed_is_refused_early(env):
    status, body, consumed = drive("POST", "/api/lab/hex-tile/sync", mac_headers(), 64 * MIB)
    assert status == 413
    assert b"limit 4 MB" in body
    assert consumed <= (4 * MIB) // CHUNK + 2


def test_request_over_64kib_streamed_is_refused_early(env):
    from hub import db
    lab.ready()
    db.run("INSERT OR REPLACE INTO lab_projects (project, meta, index_json, synced_at) VALUES (?, '{}', '{}', 'x')", "hex-tile")
    cookie = "; ".join(f"{k}={v}" for k, v in env.cookies.items())
    h = {"host": "testserver", "origin": "http://testserver", "cookie": cookie,
         "content-type": "application/json"}
    status, body, consumed = drive("POST", "/api/lab/hex-tile/requests", h, 64 * MIB)
    assert status == 413
    assert b"limit 64 KB" in body
    assert consumed <= 3

    status, body, consumed = drive("POST", "/api/lab/hex-tile/requests/rq-0123456789abcdef/result",
                                   mac_headers(), 64 * MIB)
    assert status == 413
    assert consumed <= 3


def test_declared_length_over_cap_is_refused_without_reading(env):
    h = {**mac_headers(), "content-length": str(9 * MIB)}
    status, body, consumed = drive("PUT", f"/api/lab/hex-tile/photos/{SHA}.jpg", h, 64 * MIB)
    assert status == 413
    assert consumed == 0


def test_understated_content_length_cannot_dodge_the_cap(env):
    h = {**mac_headers(), "content-length": "10"}
    status, body, consumed = drive("PUT", f"/api/lab/hex-tile/photos/{SHA}.jpg", h, 64 * MIB)
    assert status == 413
    assert consumed <= (8 * MIB) // CHUNK + 2


def test_caddyfile_caps_lab_bodies():
    text = (pathlib.Path(__file__).resolve().parent.parent / "deploy/caddy/Caddyfile").read_text()
    blocks = [text.split("home.home.arpa {", 1)[1].split("\n}\n", 1)[0],
              text.split("\nhttp:// {", 1)[1].split("\n}\n", 1)[0]]
    for block in blocks:
        lab = block.split("handle /api/lab/* {", 1)[1].split("reverse_proxy", 1)[0]
        assert "request_body" in lab and "max_size 9MB" in lab
        assert block.index("handle /api/lab/*") < block.rindex("\thandle {")
    http_lab = blocks[1].split("handle /api/lab/* {", 1)[1].split("reverse_proxy", 1)[0]
    assert "request_header -X-Hub-Mac-Key" in http_lab
