"""The drainer: one at a time, off by default, replay-safe, and honest about every outcome."""
import fcntl
import json
import os

import httpx
import pytest

from home_mcp import shell
from home_mcp.mission import drain, spool
from mission_fixtures import FakeHub, sized_event

KEY = "k-very-secret-key"


@pytest.fixture
def on(monkeypatch):
    """Mission reporting enabled, a key in the environment, and an https hub URL."""
    drain.config_path().parent.mkdir(parents=True, exist_ok=True)
    drain.config_path().write_text('{"enabled": true}')
    monkeypatch.setenv("HOME_MISSION_KEY_CLAUDE", KEY)
    monkeypatch.setenv("HOME_MCP_HUB_URL", "https://hub.test")


def fill(n=3, source="claude"):
    return [spool.append(sized_event(i), source) for i in range(n)]


async def run(fake, runner=shell.run):
    return await drain.drain(fake.factory(), runner)


def log_text():
    return drain.log_path().read_text() if drain.log_path().exists() else ""


async def test_disabled_config_means_drain_does_nothing(monkeypatch):
    monkeypatch.setenv("HOME_MCP_HUB_URL", "https://hub.test")
    monkeypatch.setenv("HOME_MISSION_KEY_CLAUDE", KEY)
    fill()
    fake = FakeHub()
    r = await run(fake)  # no config file at all
    assert (r.status, fake.requests, spool.status()["count"]) == ("disabled", [], 3)
    assert "off" in r.detail
    for text in ('{"enabled": false}', '{"enabled": "true"}', "{not json", "[]"):
        drain.config_path().parent.mkdir(parents=True, exist_ok=True)
        drain.config_path().write_text(text)
        r = await run(fake)
        assert (r.status, fake.requests, spool.status()["count"]) == ("disabled", [], 3), text


async def test_drain_posts_batches_of_50_with_the_contract_header_and_key(on):
    fill(120)
    fake = FakeHub()
    r = await run(fake)
    assert (r.status, r.posted, spool.status()["count"]) == ("done", 120, 0)
    assert [len(json.loads(q.content)) for q in fake.requests] == [50, 50, 20]
    q = fake.requests[0]
    assert q.url.path == "/api/missions/events/claude"
    assert q.headers["X-Mission-Contract"] == "1" and q.headers["X-Hub-Deploy-Key"] == KEY
    assert all("source" not in e for e in json.loads(q.content))
    assert len(fake.ids) == 120


async def test_old_events_are_marked_late_and_keep_their_at(on):
    fill(1)
    fake = FakeHub()
    await run(fake)
    (e,) = json.loads(fake.requests[0].content)
    assert e["late"] is True and e["at"] == sized_event(0)["at"]


async def test_one_drainer_at_a_time(on):
    fill()
    fake = FakeHub()
    drain.lock_path().parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(drain.lock_path(), os.O_CREAT | os.O_RDWR)
    fcntl.flock(fd, fcntl.LOCK_EX)  # another drainer holds it
    try:
        r = await run(fake)
        assert (r.status, fake.requests, spool.status()["count"]) == ("busy", [], 3)
    finally:
        os.close(fd)
    assert (await run(fake)).status == "done"  # released: the next one runs


async def test_replayed_spool_sends_each_event_id_once_to_a_fake_hub(on):
    ids = fill(7)
    fake = FakeHub()
    await run(fake)
    first = set(fake.ids)
    assert first == set(ids)
    for e in fake.requests:  # put the same events back, as a retry after a lost reply would
        for ev in json.loads(e.content):
            spool.append(ev, "claude")
    r = await run(fake)
    assert r.posted == 7 and fake.ids == first and len(fake.ids) == 7  # the hub counted duplicates, stored none


async def test_a_lost_reply_resends_the_same_ids_and_the_hub_dedupes(on):
    ids = fill(4)
    fake = FakeHub()

    class LostReply(FakeHub):
        def __call__(self, request):
            if not self.requests:  # the hub takes the batch, the answer never arrives
                self.requests.append(request)
                self._take(json.loads(request.content))
                raise httpx.ReadTimeout("lost")
            return super().__call__(request)

    fake = LostReply()
    assert (await run(fake)).status == "stopped" and spool.status()["count"] == 4
    assert (await run(fake)).status == "done"
    assert fake.ids == set(ids) and spool.status()["count"] == 0


@pytest.mark.parametrize("response", [
    httpx.Response(503), httpx.Response(500), httpx.Response(429, headers={"Retry-After": "30"}),
    httpx.ConnectError("down"), httpx.ReadTimeout("slow"),
    httpx.Response(401, json={"error": "bad_key"}), httpx.Response(404),  # setup problems, not bad events
    httpx.Response(409, json={"error": "version"}),  # the hub wants another contract version: every event would fail
])
async def test_drain_keeps_events_on_5xx_and_unreachable(on, response):
    ids = fill(3)
    r = await run(FakeHub(response))
    assert r.status == "stopped" and r.kept == 3
    assert [e["event"]["event_id"] for e in spool.read_all()] == ids
    assert "stopped" in log_text() and KEY not in log_text()


async def test_drain_drops_and_logs_on_4xx_without_the_key(on):
    fill(3)
    body = "echo-of-the-secret-body " + KEY
    r = await run(FakeHub(httpx.Response(400, text=body)))
    assert (r.status, r.dropped, spool.status()["count"]) == ("done", 3, 0)
    log = log_text()
    assert "400" in log and "3" in log
    assert KEY not in log and "echo-of-the-secret-body" not in log
    assert len(log.splitlines()) == 1


async def test_no_key_keeps_the_spool_and_logs_why_without_a_key(on, monkeypatch):
    monkeypatch.delenv("HOME_MISSION_KEY_CLAUDE")
    fill(2)
    asked = []

    async def keychain(argv, timeout=30):
        asked.append((argv, timeout))
        return shell.Run(44, "", "item not found")

    fake = FakeHub()
    r = await run(fake, keychain)
    assert (r.status, fake.requests, spool.status()["count"]) == ("stopped", [], 2)
    assert asked == [(["security", "find-generic-password", "-s", "pi-hub-mission-claude-key", "-w"], 2.0)]
    assert "no key for source claude" in log_text()


async def test_the_key_comes_from_the_keychain_item_when_no_env(on, monkeypatch):
    monkeypatch.delenv("HOME_MISSION_KEY_CLAUDE")
    fill(1)

    async def keychain(argv, timeout=30):
        return shell.Run(0, "from-keychain\n", "")

    fake = FakeHub()
    assert (await run(fake, keychain)).status == "done"
    assert fake.requests[0].headers["X-Hub-Deploy-Key"] == "from-keychain"


async def test_a_non_https_hub_never_gets_the_key(on, monkeypatch):
    monkeypatch.setenv("HOME_MCP_HUB_URL", "http://hub.test")
    fill(2)
    fake = FakeHub()
    r = await run(fake)
    assert (r.status, fake.requests, spool.status()["count"]) == ("stopped", [], 2)


async def test_an_unknown_source_line_is_dropped_and_the_rest_sent(on):
    spool.append(sized_event(0), "mystery")
    ids = fill(2)
    fake = FakeHub()
    r = await run(fake)
    assert (r.posted, r.dropped, fake.ids, spool.status()["count"]) == (2, 1, set(ids), 0)


async def test_an_empty_spool_is_reported_empty(on):
    assert (await run(FakeHub())).status == "empty"


async def test_decisions_hub_key_default_behaviour_is_unchanged(monkeypatch):
    from home_mcp import decisions
    monkeypatch.delenv("HOME_MCP_HUB_KEY", raising=False)
    calls = []

    async def keychain(argv, timeout=30):
        calls.append((argv, timeout))
        return shell.Run(0, "deploy-key\n", "")

    assert await decisions.hub_key(keychain) == ("deploy-key", None)
    assert calls == [(["security", "find-generic-password", "-s", "pi-hub-deploy-key", "-w"], 5.0)]


class AppendingHub(FakeHub):
    """A hub that, while answering, sees a hook append `per_post` more events: the drain-on-idle gap."""

    def __init__(self, *responses, posts_that_append: int = 1, source: str = "claude"):
        super().__init__(*responses)
        self.left = posts_that_append
        self.source = source

    def __call__(self, request):
        if self.left:
            self.left -= 1
            spool.append(sized_event(99), self.source)
        return super().__call__(request)


async def test_drain_posts_events_appended_during_a_pass(on):
    fill(2)
    fake = AppendingHub()
    r = await run(fake)
    assert (r.status, r.posted, spool.status()["count"]) == ("done", 3, 0)
    assert len(fake.requests) == 2


async def test_drain_stops_after_max_passes_and_releases_the_lock(on):
    fill(1)
    fake = AppendingHub(posts_that_append=1000)
    r = await run(fake)
    assert r.status == "done" and len(fake.requests) == drain.MAX_PASSES
    assert spool.status()["count"] == 1
    again = await run(FakeHub())
    assert again.status == "done" and spool.status()["count"] == 0  # not "busy": the lock was released


async def test_a_missing_key_skips_only_that_source(on, monkeypatch):
    spool.append(sized_event(1), "importer")  # no HOME_MISSION_KEY_IMPORTER, and the Keychain says no
    fill(2)

    async def keychain(argv, timeout=30):
        return shell.Run(44, "", "item not found")

    fake = FakeHub()
    r = await run(fake, keychain)
    assert (r.status, r.posted, r.skipped) == ("stopped", 2, ["importer"])
    assert spool.status()["by_source"] == {"importer": 1}
    assert [q.url.path for q in fake.requests] == ["/api/missions/events/claude"]
    assert "no key for source importer" in log_text() and "importer" in r.detail


async def test_a_5xx_on_a_later_pass_reports_what_was_posted(on):
    fill(1)
    fake = AppendingHub(httpx.Response(200), httpx.Response(503))
    r = await run(fake)
    assert (r.status, r.posted, r.kept) == ("stopped", 1, 1)
    assert "503" in r.detail
