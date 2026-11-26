"""The ledger's validator reads docs/contracts/mission-events-v1.json itself (M1b plan decision 1): a change to the
file changes what is accepted, with no code, and a token it can't check fails at load rather than at a post."""
import copy
import json

import pytest

from hub.missions import contract

EVENT = {"event_id": "00000000-0000-4000-8000-000000000001", "type": "note.reported", "at": "2026-11-25T18:00:00Z",
         "initiative": "a34", "body": {"session_id": "00000000-0000-4000-8000-000000000002", "words": "Hello"}}


def written(tmp_path, change):
    data = copy.deepcopy(contract.CURRENT.data)
    change(data)
    path = tmp_path / "contract.json"
    path.write_text(json.dumps(data))
    return contract.load(path)


def test_validator_reads_the_contract_file(tmp_path):
    assert contract.PATH.name == "mission-events-v1.json" and contract.CURRENT.data == json.loads(
        contract.PATH.read_text())
    with pytest.raises(contract.Refused) as e:
        contract.CURRENT.check("claude", EVENT, 0)
    assert e.value.code == "unknown_type"

    def add_type(data):
        data["sources"]["claude"].append("note.reported")
        data["types"]["note.reported"] = {"required": {"words": "text:20"}, "optional": {}}
    added = written(tmp_path, add_type)
    assert added.check("claude", EVENT, 0) is None
    with pytest.raises(contract.Refused) as e:
        added.check("claude", {**EVENT, "body": {**EVENT["body"], "words": "x" * 21}}, 0)
    assert (e.value.code, e.value.detail) == ("bad_field", "event 0: body.words: doesn't fit its grammar")

    def tighter_limit(data):
        data["limits"]["event_bytes"] = 100
    with pytest.raises(contract.Refused) as e:
        written(tmp_path, tighter_limit).check("claude", {**EVENT, "type": "turn.finished",
                                                          "body": {"session_id": EVENT["body"]["session_id"]}}, 0)
    assert e.value.code == "too_large"


def test_a_token_the_validator_cannot_check_fails_at_load(tmp_path):
    def unknown_token(data):
        data["types"]["turn.finished"]["optional"]["colour"] = "colour"
    with pytest.raises(ValueError, match="can't check: colour"):
        written(tmp_path, unknown_token)
