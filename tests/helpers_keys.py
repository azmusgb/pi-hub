"""Shared helper for the machine-key tests: the deploy keys (X-Hub-Deploy-Key, releases.py) and print-lab's lab key
(X-Hub-Mac-Key, lab_guard.py), installed as the Pi keeps them (their SHA-256 only)."""
import hashlib

from hub import lab_guard, releases

KEYS = {"localai": "k-localai-" + "1" * 40, "mac": "k-mac-" + "2" * 40}
LAB_KEY = "k-lab-" + "3" * 40


def install_keys(monkeypatch, tmp_path):
    keys = tmp_path / "deploy_keys"
    keys.mkdir()
    for name, key in KEYS.items():
        (keys / f"{name}.sha256").write_text(hashlib.sha256(key.encode()).hexdigest() + "\n")
    monkeypatch.setattr(releases, "KEY_DIR", str(keys))
    lab = tmp_path / "lab_mac_key.sha256"
    lab.write_text(hashlib.sha256(LAB_KEY.encode()).hexdigest() + "\n")
    monkeypatch.setattr(lab_guard, "KEY_HASH_FILE", str(lab))
