"""The event and manifest validators: the contract's grammar, never echoing a value."""
import copy

import pytest

from home_mcp.mission import validate
from mission_fixtures import AT, MANIFEST, SHA, SPEC, UUID, event, manifest

SECRET = "SECRET-VALUE-do-not-echo"


def test_contract_and_schema_load_from_repo_docs():
    contract, schema = validate.load_contract(), validate.load_schema()
    assert contract["contract"] == "mission-events" and contract["version"] == 1
    assert schema["schema"] == "mission-manifest" and schema["version"] == 1
    assert validate.CONTRACT_FILE == validate.REPO_ROOT / "docs/contracts/mission-events-v1.json"
    assert validate.SCHEMA_FILE == validate.REPO_ROOT / "docs/missions/manifest.schema.json"
    assert validate.CONTRACT_FILE.is_file() and validate.SCHEMA_FILE.is_file()


def test_missing_contract_is_a_clear_error_not_an_empty_contract(monkeypatch, tmp_path):
    validate.load_contract.cache_clear()
    monkeypatch.setattr(validate, "CONTRACT_FILE", tmp_path / "nope.json")
    try:
        with pytest.raises(RuntimeError, match="cannot read .*nope.json.*pi-hub checkout"):
            validate.load_contract()
    finally:
        validate.load_contract.cache_clear()


def test_a_valid_manifest_passes():
    assert validate.validate_manifest(copy.deepcopy(MANIFEST)) == []


def test_validator_rejects_unknown_fields_bad_ids_and_cycles():
    m = manifest()
    m["surprise"] = 1
    m["stages"][0]["extra"] = SECRET                                   # unknown field
    m["stages"][1]["id"] = "other:stage:p1"                            # wrong initiative
    m["workstreams"][0]["id"] = "a34:task:shell"                       # wrong kind for its list
    m["tasks"][0]["workstream"] = "a34:workstream:nowhere"             # unresolved reference
    m["tasks"].append({"id": "a34:task:measure", "workstream": "a34:workstream:shell", "title": "dup"})
    m["stages"].append({"id": "a34:stage:p2", "n": 0, "title": "same n"})
    m["dependencies"] = [{"from": "a34:stage:p0", "to": "a34:stage:p2", "kind": "blocks"},
                         {"from": "a34:stage:p2", "to": "a34:stage:p0", "kind": "informs"}]
    m["tasks"][0]["title"] = ""                                        # text:160 needs 1 character
    problems = validate.validate_manifest(m)
    joined = "\n".join(problems)
    for expected in ("manifest.surprise: unknown field", "manifest.stages[0].extra: unknown field",
                     "manifest.stages[1].id: not child_id", "manifest.workstreams[0].id: not child_id",
                     "manifest.tasks[0].workstream", "manifest.tasks[1].id: id is not unique",
                     "manifest.stages: stage n is not unique", "manifest.dependencies: contains a cycle",
                     "manifest.tasks[0].title: not text:160"):
        assert expected in joined, expected
    assert SECRET not in joined


def test_manifest_rules_on_evidence_and_dependency_ends():
    m = manifest()
    m["evidence"][0]["source"] = SPEC                       # both source and pr
    m["evidence"][1].pop("source")                          # neither
    m["dependencies"] = [{"from": "a34:stage:p1", "to": "a34:stage:ghost", "kind": "blocks"}]
    m["evidence"][0]["links"] = [{"entity": "a34:task:ghost", "role": "supports"}]
    joined = "\n".join(validate.validate_manifest(m))
    assert joined.count("exactly one of source or pr is required") == 2
    assert "manifest.dependencies[0].to: no entity" in joined
    assert "manifest.evidence[0].links[0].entity: no entity" in joined


@pytest.mark.parametrize("change,where", [
    (lambda m: m["initiative"].update(status="finished"), "initiative.status"),
    (lambda m: m["tasks"][0].update(state="verified"), "tasks[0].state"),
    (lambda m: m["experiments"].append("not-an-experiment"), "experiments[1]"),
    (lambda m: m.pop("stages"), "manifest.stages: missing"),
    (lambda m: m.update(manifest=2), "manifest.manifest"),
    (lambda m: m["decisions"][0].pop("answer_source"), "decisions[0].answer_source: missing"),
])
def test_manifest_field_rules(change, where):
    m = manifest()
    change(m)
    assert any(where in p for p in validate.validate_manifest(m))


def test_valid_events_for_each_source():
    assert validate.validate_event("claude", event()) == []
    assert validate.validate_event("claude", event("tool.finished", {
        "session_id": UUID, "tool_use_id": "toolu_1", "tool": "Bash", "label": "Ran tests", "duration_ms": 12,
        "failed": False, "model": None, "effort": "high", "remote": "azmusgb/pi-hub"})) == []
    assert validate.validate_event("claude", event("gap", {"dropped": 3, "oldest_at": AT})) == []
    assert validate.validate_event("importer", event("plan.imported", {
        "manifest": {"repo": "azmusgb/pi-hub", "path": "docs/missions/a34.json", "commit": SHA}, "entities": 4})) == []
    assert validate.validate_event("localai", event("execution.state", {"execution_id": "e1", "state": "running"})) == []


@pytest.mark.parametrize("source,ev,where", [
    ("importer", event(), "event.type: not allowed for source importer"),
    ("nobody", event(), "source: not a known source"),
    ("claude", event(body={"prompt_id": UUID}), "event.body.session_id: missing"),
    ("claude", event(body={"session_id": UUID, "prompt_id": UUID, "branch": "x" * 121}), "event.body.branch"),
    ("claude", event(event_id="not-a-uuid"), "event.event_id: not uuid"),
    ("claude", event(at="2026-11-24 10:00"), "event.at: not iso"),
    ("claude", event(initiative="A"), "event.initiative: not slug"),
    ("claude", event(source="claude"), "event.source: unknown field"),
    ("claude", event(seq=1), "event.seq: unknown field"),
    ("claude", {**event(), "body": "text"}, "event.body: not an object"),
    ("claude", event("tool.finished", {"session_id": UUID, "tool_use_id": "t", "tool": "Bash", "label": "a\x07b"}),
     "event.body.label: not label"),
    ("claude", event("tool.finished", {"session_id": UUID, "tool_use_id": "t", "tool": "Bash", "label": "ok",
                                       "duration_ms": True}), "event.body.duration_ms"),
    ("claude", event("evidence.reported", {"session_id": UUID, "kind": "commit", "repo": "azmusgb/pi-hub",
                                           "links": [{"entity": "a34:task:x", "role": "bogus"}]}),
     "event.body.links[0].role"),
    ("claude", event("session.attached", {"session_id": UUID, "cwd_name": "x", "lineage": [UUID] * 21}),
     "event.body.lineage"),
    ("claude", event(late="yes"), "event.late: not bool"),
])
def test_event_problems_name_the_field(source, ev, where):
    problems = validate.validate_event(source, ev)
    assert any(where in p for p in problems), problems


def test_event_over_4096_bytes_is_refused_and_value_not_echoed():
    ev = event("evidence.reported", {"session_id": UUID, "kind": "test", "repo": "azmusgb/pi-hub",
                                     "summary": SECRET + "x" * 400,
                                     "links": [{"entity": "a34:task:x", "role": "supports"}] * 10})
    ev["body"]["links"] = [{"entity": "a34:task:" + "a" * 30, "role": "supports", "x": SECRET * 20}] * 10
    problems = validate.validate_event("claude", ev)
    assert any("bytes, over 4096" in p for p in problems)
    assert SECRET not in "\n".join(problems)


def test_never_accepted_fields_are_refused_at_any_depth():
    for name in ("prompt", "prompt_text", "message", "last_assistant_message", "tool_input", "tool_response",
                 "transcript", "thinking", "reasoning", "output", "content"):
        top = event(**{name: SECRET})
        assert f"event.{name}: never accepted" in validate.validate_event("claude", top)
        body = event(body={"session_id": UUID, "prompt_id": UUID, name: SECRET})
        assert f"event.body.{name}: never accepted" in validate.validate_event("claude", body)
    nested = event("evidence.reported", {"session_id": UUID, "kind": "pr", "repo": "azmusgb/pi-hub",
                                         "links": [{"entity": "a34:task:x", "role": "supports",
                                                    "meta": {"deep": [{"content": SECRET}]}}]})
    problems = validate.validate_event("claude", nested)
    assert "event.body.links[0].meta.deep[0].content: never accepted" in problems
    assert SECRET not in "\n".join(problems)
    # reported once, not again as an unknown field
    assert not any(p.endswith("content: unknown field") for p in problems)
