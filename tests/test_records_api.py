import asyncio
import json
import os
import tempfile

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from hub import app as hubapp, events, records  # noqa: E402
from tests.helpers_records import T, bud, inputs  # noqa: E402

client = TestClient(hubapp.app)


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    os.environ["HUB_DB"] = os.path.join(tempfile.mkdtemp(), "hub.db")
    records._reset_memory()
    events._forget()
    monkeypatch.setattr(events, "push", lambda *a, **k: "Sent.")
    events.ready()
    records.refresh(T, inputs=inputs())
    yield
    records._subscribers.clear()


def test_records_list_order_and_fields():
    body = client.get("/api/records").json()
    assert isinstance(body["as_of"], float)
    ids = [r["id"] for r in body["records"]]
    assert ids and ids == [k for k in records.KINDS if k in records.all()]
    assert body["records"][0]["id"] in records.KINDS
    for r in body["records"]:
        assert {"id", "state", "headline"} <= set(r)
    assert client.get("/api/records").headers["cache-control"] == "no-store"


class Req:
    def __init__(self):
        self.gone = False

    async def is_disconnected(self):
        return self.gone


def parse(chunk):
    event = data = None
    for line in chunk.strip().split("\n"):
        if line.startswith("event: "):
            event = line[7:]
        elif line.startswith("data: "):
            data = json.loads(line[6:])
    return event, data, chunk


def test_stream_snapshot_then_change_then_cleanup():
    async def run():
        req = Req()
        gen = hubapp.records_stream(req, ping=0.2)
        ev, data, _ = parse(await gen.__anext__())
        assert ev == "snapshot"
        assert [r["id"] for r in data["records"]] == [r["id"] for r in client.get("/api/records").json()["records"]]
        assert len(records._subscribers) == 1
        await asyncio.to_thread(records.refresh, T + 30, inputs(bambuddy=bud("RUNNING", 10)))
        ev, data, _ = parse(await gen.__anext__())
        assert ev == "change"
        assert data["record"]["id"] == data["id"] and data["new"] and "headline" in data
        # nothing more: a ping arrives
        assert (await gen.__anext__()).startswith(": ping")
        req.gone = True
        with pytest.raises(StopAsyncIteration):
            await gen.__anext__()
        assert len(records._subscribers) == 0

    asyncio.run(run())


def test_closing_the_generator_unsubscribes():
    async def run():
        gen = hubapp.records_stream(Req(), ping=0.2)
        await gen.__anext__()
        assert len(records._subscribers) == 1
        await gen.aclose()
        assert len(records._subscribers) == 0

    asyncio.run(run())


def test_stream_route_response_headers():
    async def run():
        resp = await hubapp.api_records_stream(Req())
        assert resp.media_type == "text/event-stream"
        assert resp.headers["cache-control"] == "no-store" and resp.headers["x-accel-buffering"] == "no"
        await resp.body_iterator.aclose()

    asyncio.run(run())
