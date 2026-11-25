"""Amendment A4, requirement 1 (step 7a): the Assistant is framed on its own origin, never served under Pi Hub's. No
`site_hub` route proxies to Local AI, and the hub's server has no route that forwards to it either."""
import re
from pathlib import Path

from hub import app as hub_app

ROOT = Path(__file__).resolve().parents[1]
CADDY = (ROOT / "deploy" / "caddy" / "Caddyfile").read_text()
LOCAL_AI = re.compile(r"10\.0\.0\.81|assistant\.|localai|:3080", re.I)


def block(name):
    start = CADDY.index(f"({name}) {{")
    depth, i = 0, CADDY.index("{", start)
    for j in range(i, len(CADDY)):
        depth += {"{": 1, "}": -1}.get(CADDY[j], 0)
        if depth == 0:
            return CADDY[i:j + 1]
    raise AssertionError(f"{name} is not closed")


def test_no_site_hub_route_proxies_to_local_ai():
    hub = block("site_hub")
    for target in re.findall(r"reverse_proxy\s+(\S+)", hub):
        assert target == "127.0.0.1:8100", target
    assert not LOCAL_AI.search(hub)


def test_local_ai_is_reached_only_on_its_own_name():
    # The one proxy to Local AI is the assistant. site, on its own host.
    assert LOCAL_AI.search(block("site_assistant"))
    assert re.search(r"@assistant host assistant\.rahe-home\.duckdns\.org\s+handle @assistant \{\s+import site_assistant", CADDY)


def test_the_hub_has_no_route_into_local_ai():
    paths = [getattr(r, "path", "") for r in hub_app.app.routes]
    assert not [p for p in paths if re.match(r"/(ai|assistant|localai)(/|$)", p)], "the shell serves /assistant; nothing forwards"
    assert "/assistant" in hub_app.SHELL_PATHS, "/assistant is a shell page, drawn by the browser"


def test_the_assistants_server_side_calls_are_the_five_owner_only_api_ai_routes():
    """A34 D1 narrows A4's test: no browser request is proxied, and the only routes in which the hub's server calls Local AI
    for the Assistant's pages are these five (each owner-only, each mapped to one allow-listed path: tests/test_assistant_api.py)."""
    paths = sorted(f"{m} {r.path}" for r in hub_app.app.routes if getattr(r, "path", "").startswith("/api/ai") for m in r.methods)
    assert paths == ["GET /api/ai/models", "GET /api/ai/status", "GET /api/ai/tasks/{run_id}", "POST /api/ai/tasks",
                     "POST /api/ai/tasks/{run_id}/cancel"]


def test_the_shell_answers_the_three_assistant_pages_pi_hub_draws_and_no_other_assistant_path():
    for p in ("/assistant/status", "/assistant/models", "/assistant/run/run-1790000000000-001a2b3"):
        assert hub_app._is_shell_path(p), p
    for p in ("/assistant/run/", "/assistant/run/a", "/assistant/run/../x", "/assistant/chat", "/assistant/run/x/y"):
        assert not hub_app._is_shell_path(p), p
