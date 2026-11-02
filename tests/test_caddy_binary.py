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


def test_url_quoted_for_the_pis_shell():
    # ssh joins its arguments into one line for the remote shell; an unquoted & would cut the URL short.
    assert "ssh -o BatchMode=yes pi \"bash -s -- '$CADDY_URL' '$CADDY_SHA256'\" <<'EOF'" in INSTALL
    assert "'" not in _pin("CADDY_URL")


def test_duckdns_token_reaches_caddy_but_is_optional():
    line = next(x for x in INSTALL.splitlines() if "caddy.service.d/gate.conf" in x and "printf" in x)
    assert "EnvironmentFile=-/etc/pi-hub/secrets/duckdns.env" in line


def test_the_old_names_only_redirect_or_serve_machines():
    caddyfile = open(os.path.join(ROOT, "deploy", "caddy", "Caddyfile")).read()
    sites = re.findall(r"^(\S+) \{$", caddyfile, re.M)
    old = [x for x in sites if x.endswith("home.arpa")]
    assert sorted(old) == ["*.home.arpa", "home.home.arpa", "updates.home.arpa"]
    assert "redir https://{labels.2}.rahe-home.duckdns.org{uri} 308" in caddyfile
    block = caddyfile.split("\nhome.home.arpa {", 1)[1].split("\n}\n", 1)[0]
    assert "handle /api/display/*" in block and "handle /api/lab/*" in block
    assert "redir https://hub.rahe-home.duckdns.org{uri} 308" in block
    assert "gated" not in block  # nothing for people on the old name


def test_every_tool_has_a_real_name():
    caddyfile = open(os.path.join(ROOT, "deploy", "caddy", "Caddyfile")).read()
    real = set(re.findall(r"^\t@([a-z]+) host \1\.rahe-home\.duckdns\.org$", caddyfile, re.M))
    assert real == {"hub", "assistant", "bambuddy", "paperless", "homebox", "backups", "network", "status", "adguard",
                    "devices", "pi", "scan", "family"}
