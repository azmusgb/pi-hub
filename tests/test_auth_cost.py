"""The owner password's hashing cost in production. tests/conftest.py lowers it for the test process, so the value is
read from a fresh interpreter that never loads the conftest."""
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION = {"n": 2 ** 14, "r": 8, "p": 1, "dklen": 32}


def _fresh(code):
    out = subprocess.run([sys.executable, "-I", "-c", code], cwd=ROOT, capture_output=True, text=True,
                         env={"PATH": "/usr/bin:/bin", "HUB_NO_SAMPLER": "1", "PYTHONPATH": str(ROOT)})
    assert out.returncode == 0, out.stderr
    return json.loads(out.stdout)


def test_production_password_cost_is_unchanged():
    assert _fresh("import json, sys; sys.path.insert(0, '.'); from hub import auth; print(json.dumps(auth.SCRYPT_COST))") == PRODUCTION


def test_a_production_hash_is_real_scrypt_at_that_cost():
    # The hash path itself uses the constant: a digest made by hub.auth equals hashlib.scrypt at the production cost.
    got = _fresh("import hashlib, json, sys; sys.path.insert(0, '.'); from hub import auth; "
                 "h = auth._hash('correct horse'); "
                 "d = hashlib.scrypt(b'correct horse', salt=bytes.fromhex(h['salt']), n=2**14, r=8, p=1, dklen=32).hex(); "
                 "print(json.dumps([h['hash'] == d, auth._check('correct horse', h), auth._check('wrong one', h)]))")
    assert got == [True, True, False]


def test_the_test_process_uses_the_cheap_cost_and_still_round_trips():
    from hub import auth
    assert auth.SCRYPT_COST["n"] < PRODUCTION["n"]
    stored = auth._hash("correct horse")
    assert auth._check("correct horse", stored) and not auth._check("wrong one", stored)
