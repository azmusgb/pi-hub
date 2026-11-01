"""One home, step 6 (lock): plain http on the old addresses keeps only the machine callers' paths; browsers go to the
gate, on the same page. Reads the Caddyfile as Caddy adapts it (skipped where caddy isn't installed)."""
import json
import os
import shutil
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CADDYFILE = os.path.join(ROOT, "deploy", "caddy", "Caddyfile")
MACHINE_PATHS = ["/api/now", "/api/now/*", "/api/needs", "/api/records", "/api/webhook/bambuddy", "/api/shortcut/*", "/home-ca.crt", "/healthz"]

def _has_duckdns():
    if not shutil.which("caddy"):
        return False
    mods = subprocess.run(["caddy", "list-modules"], capture_output=True, text=True).stdout.split()
    return "dns.providers.duckdns" in mods


# The Caddyfile names the DuckDNS module, so only a Caddy with it (the Pi's pinned build) can adapt it.
pytestmark = pytest.mark.skipif(not _has_duckdns(), reason="caddy with the DuckDNS module not installed")


@pytest.fixture(scope="module")
def plain_http():
    out = subprocess.run(["caddy", "adapt", "--config", CADDYFILE], capture_output=True, text=True, check=True).stdout
    servers = json.loads(out)["apps"]["http"]["servers"].values()
    server = next(s for s in servers if s.get("listen") == [":80"])
    (top,) = server["routes"]
    (sub,) = top["handle"]
    return sub["routes"]


def _handlers(node):
    if isinstance(node, dict):
        if "handler" in node:
            yield node
        for v in node.values():
            yield from _handlers(v)
    elif isinstance(node, list):
        for v in node:
            yield from _handlers(v)


def _paths(route):
    return sorted(p for m in route.get("match", []) for p in m.get("path", []))


def test_machine_paths_reach_the_hub(plain_http):
    want = sorted(p for p in MACHINE_PATHS if p != "/home-ca.crt")
    route = next((r for r in plain_http if _paths(r) == want), None)
    assert route, [_paths(r) for r in plain_http]
    proxies = [h for h in _handlers(route["handle"]) if h["handler"] == "reverse_proxy"]
    assert [u["dial"] for p in proxies for u in p["upstreams"]] == ["127.0.0.1:8100"]


def test_machine_paths_match_any_host(plain_http):
    # Siri Shortcuts come over Tailscale (http://pi.<tailnet>.ts.net), Bambuddy and Local AI by IP.
    want = sorted(p for p in MACHINE_PATHS if p != "/home-ca.crt")
    route = next(r for r in plain_http if _paths(r) == want)
    assert all("host" not in m for m in route["match"])


def test_browsers_keep_their_path(plain_http):
    last = plain_http[-1]
    assert "match" not in last
    (redir,) = [h for h in _handlers(last["handle"]) if h["handler"] == "static_response"]
    assert redir["status_code"] == 308
    assert redir["headers"]["Location"] == ["https://home.home.arpa{http.request.uri}"]
    assert not [h for h in _handlers(last["handle"]) if h["handler"] == "reverse_proxy"]


def test_ca_still_served_over_http(plain_http):
    route = next(r for r in plain_http if _paths(r) == ["/home-ca.crt"])
    assert any(h["handler"] == "file_server" for h in _handlers(route["handle"]))


def test_caddy_restarts():
    install = open(os.path.join(ROOT, "deploy", "install.sh")).read()
    line = next(x for x in install.splitlines() if "caddy.service.d/gate.conf" in x and "printf" in x)
    assert "Restart=always" in line
