"""system._updates: what apt reports, with security archives marked, and a failed read raised rather than read as empty."""
import os
import subprocess

os.environ["HUB_NO_SAMPLER"] = "1"

import pytest  # noqa: E402

from hub import system  # noqa: E402

APT = """Listing...
vim-common/stable-security 2:9.1.1230-2+deb13u2 arm64 [upgradable from: 2:9.1.1230-2]
vim-tiny/stable 2:9.1.1230-2+deb13u2 arm64 [upgradable from: 2:9.1.1230-2]
"""


def fake(out, code=0):
    return lambda *a, **k: subprocess.CompletedProcess(a, code, out, "")


def test_updates_carry_version_and_whether_the_archive_is_security(monkeypatch):
    monkeypatch.setattr(system.subprocess, "run", fake(APT))
    assert system._updates() == [
        {"name": "vim-common", "version": "2:9.1.1230-2+deb13u2", "security": True},
        {"name": "vim-tiny", "version": "2:9.1.1230-2+deb13u2", "security": False},
    ]


def test_nothing_pending_is_an_empty_list(monkeypatch):
    monkeypatch.setattr(system.subprocess, "run", fake("Listing...\n"))
    assert system._updates() == []


def test_a_failed_apt_raises_so_the_cache_holds_unknown(monkeypatch):
    monkeypatch.setattr(system.subprocess, "run", fake("", 100))
    with pytest.raises(RuntimeError):
        system._updates()
