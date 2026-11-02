"""The family-room panel's site on the Pi: Caddy's rules for it, and deploy/family-room-release.sh, run against a local
folder in place of the Pi (FR_REMOTE="sh -c", FR_ROOT=<tmp>)."""
import json
import os
import re
import subprocess

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CADDYFILE = open(os.path.join(ROOT, "deploy", "caddy", "Caddyfile")).read()
INSTALL = open(os.path.join(ROOT, "deploy", "install.sh")).read()
RELEASE = os.path.join(ROOT, "deploy", "family-room-release.sh")


def _block(name):
    start = CADDYFILE.index(f"({name}) {{")
    depth, i = 0, CADDYFILE.index("{", start)
    for j in range(i, len(CADDYFILE)):
        depth += {"{": 1, "}": -1}.get(CADDYFILE[j], 0)
        if depth == 0:
            return CADDYFILE[i:j + 1]
    raise AssertionError(name)


def test_family_name_serves_the_panel_site():
    assert re.search(r"@family host family\.rahe-home\.duckdns\.org\n\thandle @family \{\n\t\timport site_family\n", CADDYFILE)


def test_only_the_skylight_and_the_mac_get_in_before_anything_else():
    body = _block("site_family")
    lines = [ln.strip() for ln in body.splitlines() if ln.strip()]
    assert lines[1] == "route {"
    assert lines[2] == "@outsider not remote_ip 10.0.0.18/32 100.109.178.34/32"
    assert lines[3] == 'respond @outsider "Not here." 403'
    assert lines[4:6] == ["@write not method GET HEAD", "respond @write 405"]


def test_laundry_goes_to_the_read_only_shortcut_route_with_the_key_added_by_caddy():
    body = _block("site_family")
    laundry = body[body.index("handle @laundry"):body.index("handle {", body.index("handle @laundry"))]
    assert "@laundry path /api/laundry" in body
    assert "rewrite * /api/shortcut/laundry" in laundry
    assert 'header_up Authorization "Bearer {$FAMILY_ROOM_HUB_KEY}"' in laundry
    assert "header_up -Cookie" in laundry
    assert "import hub_peer" not in laundry and "header_up -X-Hub-Peer" in laundry
    assert "reverse_proxy 127.0.0.1:8100" in laundry
    # Nothing else is forwarded to the hub: every other path is a file from the current release.
    assert body.count("reverse_proxy") == 1
    assert "root * /srv/family-room/current" in body


def test_caddy_reads_the_key_from_an_optional_root_only_file():
    line = next(x for x in INSTALL.splitlines() if "caddy.service.d/gate.conf" in x and "printf" in x)
    assert "EnvironmentFile=-/etc/pi-hub/secrets/family_room.env" in line
    assert "chmod 600 /etc/pi-hub/secrets/family_room.env" in INSTALL
    assert "/srv/family-room /srv/family-room/releases" in INSTALL


# ---- deploy/family-room-release.sh ----

def _git(repo, *args):
    subprocess.run(["git", "-C", repo, *args], check=True, capture_output=True,
                   env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                        "GIT_COMMITTER_EMAIL": "t@t"})


def _commit(repo, text):
    with open(os.path.join(repo, "prototype", "index.html"), "w") as f:
        f.write(text)
    _git(repo, "add", "-A")
    _git(repo, "commit", "-qm", text)
    return subprocess.run(["git", "-C", repo, "rev-parse", "--short=12", "HEAD"], capture_output=True, text=True).stdout.strip()


@pytest.fixture
def site(tmp_path):
    src, pi = tmp_path / "family-room", tmp_path / "srv"
    (src / "prototype").mkdir(parents=True)
    (pi / "releases").mkdir(parents=True)
    _git(str(src), "init", "-q", "-b", "main")
    env = {**os.environ, "FR_REMOTE": "sh -c", "FR_ROOT": str(pi)}

    def run(*args, ok=True):
        r = subprocess.run(["bash", RELEASE, *args], capture_output=True, text=True, env=env)
        assert (r.returncode == 0) == ok, r.stdout + r.stderr
        return r.stdout + r.stderr

    return str(src), pi, run


def _live(pi):
    return os.path.basename(os.readlink(pi / "current"))


def test_publish_names_the_commit_and_switches_current(site):
    src, pi, run = site
    a = _commit(src, "one")
    assert f"{a} is live" in run("publish", src)
    assert _live(pi) == a
    assert (pi / "current" / "index.html").read_text() == "one"
    assert json.loads((pi / "current" / "version.json").read_text())["commit"] == a
    b = _commit(src, "two")
    run("publish", src)
    assert _live(pi) == b
    out = run("list")
    assert f"* {b}" in out and f"  {a}" in out


def test_rollback_goes_to_the_previous_release_and_back(site):
    src, pi, run = site
    a = _commit(src, "one")
    run("publish", src)
    b = _commit(src, "two")
    run("publish", src)
    assert f"back to {a}" in run("rollback")
    assert (pi / "current" / "index.html").read_text() == "one"
    assert f"back to {b}" in run("rollback")
    log = (pi / "releases.log").read_text().split("\n")
    assert [ln.split()[1:] for ln in log if ln] == [["publish", a], ["publish", b], ["rollback", a], ["rollback", b]]


def test_nothing_to_roll_back_to(site):
    src, pi, run = site
    _commit(src, "one")
    run("publish", src)
    assert "no earlier release" in run("rollback", ok=False)


def test_uncommitted_changes_are_refused(site):
    src, pi, run = site
    _commit(src, "one")
    (pi.parent / "family-room" / "prototype" / "index.html").write_text("edited")
    assert "aren't committed" in run("publish", src, ok=False)
    assert not (pi / "current").exists()


def test_keeps_five_and_never_the_previous(site):
    src, pi, run = site
    commits = []
    for n in range(7):
        commits.append(_commit(src, f"v{n}"))
        run("publish", src)
        os.utime(pi / "releases" / commits[-1], (1_000_000 + n, 1_000_000 + n))  # distinct ages for ls -t
    kept = sorted(p.name for p in (pi / "releases").iterdir() if not p.name.startswith("."))
    assert kept == sorted(commits[2:])
    assert _live(pi) == commits[-1]


def test_republishing_the_same_commit_just_switches_to_it(site):
    src, pi, run = site
    a = _commit(src, "one")
    run("publish", src)
    _commit(src, "two")
    run("publish", src)
    _git(src, "checkout", "-q", a)
    assert "already on the Pi" in run("publish", src)
    assert _live(pi) == a
