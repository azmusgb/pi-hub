"""Focused contract tests for Print Lab v2 qualification requests."""
import pytest

from hub import lab
from hub.lab_qualification import _problem, _stored_payload


def body(**changes):
    payload = {
        "decision": "qualified",
        "reason": "Evidence supports this exact run.",
        "reference_experiment": "E-019",
        "run_seen": "RUN-025-01",
        "build_seen": "BLD-025-01",
        "evidence_reviewed": True,
    }
    payload.update(changes)
    return {
        "id": "rq-0123456789abcdef",
        "experiment": "E-025",
        "run": payload.get("run_seen"),
        "payload": payload,
    }


def test_valid_qualification_contract():
    assert _problem(body()) is None
    assert "qualification" in lab.ACT_KINDS


def test_legacy_run_is_still_accepted_during_migration():
    data = body(run_seen="PR-025-01")
    data["run"] = "PR-025-01"
    assert _problem(data) is None


@pytest.mark.parametrize("field,value", [
    ("decision", "maybe"),
    ("reason", "   "),
    ("reference_experiment", "Q-019"),
    ("run_seen", "../RUN-025-01"),
    ("build_seen", "E-025-01"),
    ("evidence_reviewed", False),
])
def test_bad_payloads_are_refused(field, value):
    data = body(**{field: value})
    if field == "run_seen":
        data["run"] = value
    assert _problem(data)


def test_top_level_run_must_match_reviewed_run():
    data = body()
    data["run"] = "RUN-025-02"
    assert _problem(data) == "run must match run_seen"


def test_stored_payload_is_minimal_and_reason_is_trimmed():
    payload = body(reason="  Reviewed and accepted.  ")["payload"]
    assert _stored_payload(payload) == {
        "decision": "qualified",
        "reason": "Reviewed and accepted.",
        "reference_experiment": "E-019",
        "run_seen": "RUN-025-01",
        "build_seen": "BLD-025-01",
        "evidence_reviewed": True,
    }