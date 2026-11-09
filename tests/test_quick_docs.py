"""A19 P9: docs/quick-print.md can't drift from the code it describes, and the reference sync tool does its one job."""
import importlib.util
import json
import shutil
from pathlib import Path

import pytest

from hub import quick, quick_check, quick_worker

ROOT = Path(__file__).resolve().parents[1]
DOC = (ROOT / "docs" / "quick-print.md").read_text()
spec = importlib.util.spec_from_file_location("sync_quick_reference", ROOT / "tools" / "sync_quick_reference.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def test_every_slice_failure_cause_has_its_next_action():
    for cause in quick_worker.REASONS:
        assert f"`{cause}`" in DOC, f"docs/quick-print.md has no row for {cause}"


def test_every_state_is_named():
    for state in quick.STATES:
        assert f"`{state}`" in DOC, state


def test_the_versions_the_doc_states_are_the_ones_in_the_code():
    from hub import lab_start
    assert lab_start.SUPPORTED_VERSION in DOC and all(v in DOC for v in quick_worker.ALLOWED_STUDIO)
    assert f"{quick.QUOTA >> 30} GiB" in DOC and f"{quick.RESERVE >> 30} GiB" in DOC


def test_the_doc_names_the_scripts_and_flags_that_exist():
    for name in ("deploy/lab-key.sh", "deploy/bambuddy-staging-key.py", "deploy/bambuddy-control-key.py", "tools/sync_quick_reference.py"):
        assert name in DOC and (ROOT / name).is_file(), name
    assert "--rotate" in (ROOT / "deploy" / "lab-key.sh").read_text()
    assert "HUB_QUICK" in (ROOT / "hub" / "app.py").read_text()


def test_the_docs_say_what_is_not_proven():
    assert "## Not yet proven" in DOC and "unverified" in DOC.lower()


# --- the reference sync ----------------------------------------------------------------------------------------------

@pytest.fixture
def pair(tmp_path):
    mine = tmp_path / "hub.json"
    shutil.copy(quick_check.REFERENCE, mine)
    return tmp_path / "source.json", mine


def run(args, mine):
    return sync.main(args, hub_copy=mine)


def test_the_shipped_reference_is_a_valid_reference():
    assert sync.load(quick_check.REFERENCE)["block_lines"] > 0


def test_check_passes_when_equal_and_fails_when_not(pair, capsys):
    src, mine = pair
    shutil.copy(mine, src)
    assert run(["--source", str(src), "--check"], mine) == 0 and "in sync" in capsys.readouterr().out
    data = json.loads(src.read_text())
    data["block_lines"] += 1
    src.write_text(json.dumps(data))
    assert run(["--source", str(src), "--check"], mine) == 1 and "DIFFERENT" in capsys.readouterr().out


def test_write_copies_only_when_different(pair):
    src, mine = pair
    data = json.loads(mine.read_text())
    data["commands"] = [*data["commands"], "G1"]
    src.write_text(json.dumps(data))
    assert run(["--source", str(src), "--write"], mine) == 0
    assert json.loads(mine.read_text())["commands"][-1] == "G1"
    before = mine.stat().st_mtime_ns
    assert run(["--source", str(src), "--write"], mine) == 0 and mine.stat().st_mtime_ns == before


@pytest.mark.parametrize("body", ["not json", "[]", '{"commands": "x", "machine_start_sha256": "a", "block_lines": 1}', '{"commands": []}'])
def test_a_bad_or_missing_source_is_refused_and_changes_nothing(pair, body, capsys):
    src, mine = pair
    before = mine.read_text()
    src.write_text(body)
    assert run(["--source", str(src), "--write"], mine) == 2
    assert run(["--source", str(src.with_name("missing.json")), "--check"], mine) == 2
    assert mine.read_text() == before and "sync_quick_reference" in capsys.readouterr().err
