"""Shared test setup. Kept to what every test needs and nothing that changes what a test checks."""
import os

import pytest

# Under pytest-xdist (the Pi's release runs `-n 3`, A34 P0 decision 7) every worker is its own process with the same
# environment, so a HUB_DB given to the run would be one database shared by all of them. Each worker moves it into a
# folder of its own beside the given path, before any hub module reads it; the recorder's prints folder hangs off
# HUB_DB's folder, so it moves with it. A serial run keeps the path it was given.
_worker = os.environ.get("PYTEST_XDIST_WORKER")
if _worker and os.environ.get("HUB_DB"):
    _given = os.environ["HUB_DB"]
    _own = os.path.join(os.path.dirname(_given), "worker-" + _worker)
    os.makedirs(_own, exist_ok=True)
    os.environ["HUB_DB"] = os.path.join(_own, os.path.basename(_given))

from hub import auth  # noqa: E402  (after HUB_DB is settled)

# The owner password is hashed with scrypt at n=2**14 (122 ms a hash on the Pi), and most test fixtures set up a hub,
# so the suite spent minutes hashing. Tests only need the hash to round-trip, so they use a cheap cost. This patches the
# module in this process only; tests/test_auth_cost.py pins the production value from a fresh interpreter.
auth.SCRYPT_COST = {"n": 2, "r": 1, "p": 1, "dklen": 32}


@pytest.fixture(scope="module", autouse=True)
def _own_db_per_file(tmp_path_factory):
    """Each test file starts on a database of its own. Many files read whichever HUB_DB the files before them left set
    (a fixture's `os.environ["HUB_DB"] = …` stays after it), so their result depended on which files ran first; under
    pytest-xdist a worker runs its own subset of files in its own order. Seen: test_needs.py picked up another file's
    pending lab requests as a "Print lab on the Mac" need. A test or fixture that sets its own HUB_DB still wins, and
    the file's tests share this one as they did the one before; on leaving the file the old value comes back."""
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("HUB_DB", str(tmp_path_factory.mktemp("hub-db") / "hub.db"))
        yield
