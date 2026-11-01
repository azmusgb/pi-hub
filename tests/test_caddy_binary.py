"""Caddy runs as the pinned build with the DuckDNS module (docs/superpowers/specs/2026-11-01-real-names-design.md, N3)."""
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTALL = open(os.path.join(ROOT, "deploy", "install.sh")).read()


def _pin(name):
    return re.search(rf"^{name}=(\S+)$", INSTALL, re.M).group(1)


def test_pin_is_exact():
    assert re.fullmatch(r"v\d+\.\d+\.\d+", _pin("CADDY_VERSION"))
    assert re.fullmatch(r"v\d+\.\d+\.\d+", _pin("CADDY_DUCKDNS"))
    assert re.fullmatch(r"[0-9a-f]{64}", _pin("CADDY_SHA256"))
    url = _pin("CADDY_URL")
    assert url.startswith('"https://caddyserver.com/api/download?os=linux&arch=arm64&')
    assert "version=$CADDY_VERSION" in url and "duckdns%40$CADDY_DUCKDNS" in url


def test_download_checked_before_install():
    check = INSTALL.index('= "$caddy_sha256" ]')
    assert check < INSTALL.index("/usr/local/bin/caddy.new")
    assert "list-modules | grep -qx dns.providers.duckdns" in INSTALL


def test_service_runs_pinned_binary():
    line = next(x for x in INSTALL.splitlines() if "caddy.service.d/gate.conf" in x and "printf" in x)
    assert "ExecStart=\\nExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile" in line
    assert "ExecReload=\\nExecReload=/usr/local/bin/caddy reload" in line
    assert "/usr/bin/caddy" not in line
    assert "--environ" not in line
