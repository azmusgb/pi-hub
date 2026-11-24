"""The importer: deterministic ids, print-lab read from origin/main, and a missing experiment said out loud."""
import json
import os
import subprocess

from home_mcp import shell
from home_mcp.mission import importer
from home_mcp.mission.validate import validate_event, validate_manifest
from mission_fixtures import AT, MANIFEST, SHA, manifest

REF = {"repo": "azmusgb/pi-hub", "path": "docs/missions/a34.json", "commit": SHA}
RECORD = {"schema": 1, "record_type": "experiment", "id": "E-007", "project": "hex-tile",
          "question_text": "Does the seam hold?", "hypothesis": "Yes", "prediction": "No break under 5 kg",
          "findings": [{"n": 1}, {"n": 2}]}


class FakeGit:
    """Stands in for the git runner: records argv, answers fetch, rev-parse and show."""

    def __init__(self, records=None, fetch=0, head="abc1234def5678\n"):
        self.records, self.fetch, self.head, self.calls = records or {}, fetch, head, []

    def __call__(self, argv):
        self.calls.append(argv)
        if argv[3:] == ["fetch", "-q"] or argv[3] == "fetch":
            return shell.Run(self.fetch, "", "")
        if argv[3] == "rev-parse":
            return shell.Run(0, self.head, "")
        if argv[3] == "show":
            ref = argv[4]
            return shell.Run(0, json.dumps(self.records[ref]), "") if ref in self.records else shell.Run(128, "", "fatal")
        raise AssertionError(argv)


GOOD = {"origin/main:projects/hex-tile/experiments/E-007.json": RECORD}


def test_importer_ids_are_stable_for_a_commit_and_change_with_it():
    git = FakeGit(GOOD)
    a = importer.build(manifest(), REF, print_lab="/x", git=git, at=AT)
    b = importer.build(manifest(), REF, print_lab="/x", git=git, at="2026-11-25T00:00:00+00:00")
    assert [e["event_id"] for e in a.events] == [e["event_id"] for e in b.events]
    other = importer.build(manifest(), {**REF, "commit": "a" * 40}, print_lab="/x", git=git, at=AT)
    assert not {e["event_id"] for e in a.events} & {e["event_id"] for e in other.events}
    assert len({e["event_id"] for e in a.events}) == len(a.events)  # distinct within one import
    moved = importer.build(manifest(), {**REF, "path": "docs/missions/other.json"}, print_lab="/x", git=git, at=AT)
    assert not {e["event_id"] for e in a.events} & {e["event_id"] for e in moved.events}


def test_importer_orders_events_and_ends_with_the_plan_and_every_event_validates():
    assert validate_manifest(manifest()) == []
    r = importer.build(manifest(), REF, print_lab="/x", git=FakeGit(GOOD), at=AT)
    types = [e["type"] for e in r.events]
    assert types[0] == "initiative.imported" and types[-1] == "plan.imported"
    assert types.index("stage.imported") < types.index("gate.imported") < types.index("workstream.imported")
    assert types.count("stage.imported") == 2 and types.count("dependency.imported") == 1
    assert r.events[-1]["body"] == {"manifest": REF, "entities": len(r.events) - 1}
    for ev in r.events:
        assert validate_event("importer", ev) == [], ev["type"]
    exp = next(e for e in r.events if e["type"] == "experiment.imported")["body"]
    assert exp == {"id": "a34:experiment:hex-tile-e-007", "project": "hex-tile", "record": "E-007",
                   "question": "Does the seam hold?", "hypothesis": "Yes", "prediction": "No break under 5 kg",
                   "findings": 2, "source": {"repo": "azmusgb/print-lab", "path": "projects/hex-tile/experiments/E-007.json",
                                             "commit": "abc1234def5678"}}
    assert r.unavailable == []


def test_importer_reads_print_lab_from_origin_main_not_the_checkout(tmp_path):
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
           "GIT_COMMITTER_EMAIL": "t@t"}

    def git(*args, cwd):
        return subprocess.run(["git", *args], cwd=cwd, env=env, check=True, capture_output=True, text=True).stdout.strip()

    origin, a, b = tmp_path / "origin.git", tmp_path / "a", tmp_path / "b"
    git("init", "--bare", "-b", "main", str(origin), cwd=tmp_path)
    git("clone", "-q", str(origin), str(a), cwd=tmp_path)
    rel = a / "projects/hex-tile/experiments/E-007.json"
    rel.parent.mkdir(parents=True)
    rel.write_text(json.dumps({**RECORD, "question_text": "old question"}))
    git("add", ".", cwd=a)
    git("commit", "-qm", "old", cwd=a)
    git("push", "-q", "origin", "HEAD:main", cwd=a)
    git("clone", "-q", str(origin), str(b), cwd=tmp_path)  # the stale checkout the importer must not read
    rel.write_text(json.dumps({**RECORD, "question_text": "new question"}))
    git("commit", "-qam", "new", cwd=a)
    git("push", "-q", "origin", "HEAD:main", cwd=a)
    head = git("rev-parse", "HEAD", cwd=a)
    (b / "projects/hex-tile/experiments/E-007.json").write_text(json.dumps({**RECORD, "question_text": "dirty"}))

    r = importer.build(manifest(), REF, print_lab=str(b), at=AT)  # the real git runner: fetch, then show origin/main
    exp = next(e for e in r.events if e["type"] == "experiment.imported")["body"]
    assert exp["question"] == "new question"
    assert exp["source"]["commit"] == head
    assert r.unavailable == []


def test_the_importer_runs_fetch_then_show_against_origin_main():
    git = FakeGit(GOOD)
    importer.build(manifest(), REF, print_lab="/lab", git=git, at=AT)
    assert git.calls[0] == ["git", "-C", "/lab", "fetch", "-q"]
    assert git.calls[-1] == ["git", "-C", "/lab", "show", "origin/main:projects/hex-tile/experiments/E-007.json"]
    assert len([c for c in git.calls if c[3] == "fetch"]) == 1  # one fetch per import, not per experiment


def test_missing_experiment_is_unavailable_not_skipped():
    m = manifest(experiments=["hex-tile/E-007", "hex-tile/E-099"])
    r = importer.build(m, REF, print_lab="/x", git=FakeGit(GOOD), at=AT)
    assert r.unavailable == [{"id": "hex-tile/E-099", "reason": "not found on print-lab origin/main"}]
    assert [e["body"]["record"] for e in r.events if e["type"] == "experiment.imported"] == ["E-007"]
    assert r.events[-1]["type"] == "plan.imported"


def test_unreadable_print_lab_makes_every_experiment_unavailable():
    r = importer.build(manifest(), REF, print_lab="/x", git=FakeGit(GOOD, fetch=1), at=AT)
    assert r.unavailable == [{"id": "hex-tile/E-007", "reason": "git fetch failed, so origin/main may be stale"}]
    r = importer.build(manifest(), REF, print_lab="/x", git=FakeGit(GOOD, head="not a sha"), at=AT)
    assert r.unavailable[0]["reason"] == "cannot read origin/main"
    bad = {"origin/main:projects/hex-tile/experiments/E-007.json": {"id": "E-007"}}
    r = importer.build(manifest(), REF, print_lab="/x", git=FakeGit(bad), at=AT)
    assert r.unavailable[0]["reason"] == "the record has no id or question_text"


def test_long_or_dirty_record_text_is_fitted_to_the_contract():
    rec = {**RECORD, "question_text": "q\x07" + "x" * 600, "hypothesis": "h" * 2000}
    r = importer.build(manifest(), REF, print_lab="/x", git=FakeGit({
        "origin/main:projects/hex-tile/experiments/E-007.json": rec}), at=AT)
    ev = next(e for e in r.events if e["type"] == "experiment.imported")
    assert len(ev["body"]["question"]) == 500 and ev["body"]["question"].endswith("…")
    assert len(ev["body"]["hypothesis"]) == 1000
    assert validate_event("importer", ev) == []


def test_a_manifest_without_experiments_never_touches_git():
    git = FakeGit()
    m = {k: v for k, v in MANIFEST.items() if k != "experiments"}
    importer.build(m, REF, print_lab="/x", git=git, at=AT)
    assert git.calls == []
