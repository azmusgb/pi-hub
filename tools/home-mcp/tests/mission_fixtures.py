"""Shared builders for the mission tests: a valid manifest, a valid event, a fake hub that dedupes by event id."""
import copy

import httpx

from home_mcp import hub

UUID = "11111111-1111-4111-8111-111111111111"
AT = "2026-11-24T10:00:00+00:00"
SHA = "91f635359f2927d9c61251a9d2c18f2b2adc27ee"
SPEC = {"repo": "azmusgb/pi-hub", "path": "docs/superpowers/specs/a34.md", "commit": SHA}

MANIFEST = {
    "manifest": 1,
    "initiative": {"id": "a34", "title": "A34 Pi Hub draws the Assistant", "intent": "Pi Hub renders the Assistant.",
                   "status": "active", "spec": SPEC},
    "stages": [
        {"id": "a34:stage:p0", "n": 0, "title": "P0", "gates": [
            {"id": "a34:gate:p0-budget", "criterion": "The budget is met.", "evidence_kinds": ["measurement", "pr"]}]},
        {"id": "a34:stage:p1", "n": 1, "title": "P1"},
    ],
    "workstreams": [{"id": "a34:workstream:shell", "stage": "a34:stage:p0", "title": "Shell", "repo": "azmusgb/pi-hub",
                     "branch": "feat/shell"}],
    "tasks": [{"id": "a34:task:measure", "workstream": "a34:workstream:shell", "title": "Measure", "state": "planned"}],
    "dependencies": [{"from": "a34:stage:p1", "to": "a34:stage:p0", "kind": "blocks"}],
    "decisions": [{"id": "a34:decision:d1", "question": "Draw it here?", "kind": "yesno", "answer": "Yes",
                   "answer_source": SPEC, "options": ["Yes", "No"], "recommended": "Yes", "answered_at": AT}],
    "risks": [{"id": "a34:risk:budget", "kind": "risk", "title": "Budget", "mitigation": "Measure", "status": "open"}],
    "evidence": [{"id": "a34:evidence:pr311", "kind": "pr", "summary": "P0 plan", "pr": {"repo": "azmusgb/pi-hub", "pr": 311},
                  "links": [{"entity": "a34:task:measure", "role": "supports"}]},
                 {"id": "a34:evidence:spec", "kind": "spec", "summary": "The spec", "source": SPEC}],
    "experiments": ["hex-tile/E-007"],
}


def manifest(**changes) -> dict:
    m = copy.deepcopy(MANIFEST)
    m.update(changes)
    return m


def event(etype="turn.started", body=None, **env) -> dict:
    body = {"session_id": UUID, "prompt_id": UUID} if body is None else body
    return {"event_id": UUID, "type": etype, "at": AT, "initiative": "a34", "body": body, **env}


def sized_event(i: int, pad: int = 300) -> dict:
    return {"type": "turn.started", "at": f"2026-11-24T10:{i % 60:02d}:{i // 60:02d}+00:00", "initiative": "a34",
            "body": {"session_id": UUID, "prompt_id": UUID, "pad": "x" * pad}}


class FakeHub:
    """Stands in for Pi Hub's events route: records requests, dedupes by event id like the real route will."""

    def __init__(self, *responses):
        self.ids: set[str] = set()
        self.requests: list[httpx.Request] = []
        self.responses = list(responses)  # consumed first; each a Response or an exception to raise

    def __call__(self, request: httpx.Request) -> httpx.Response:
        import json
        self.requests.append(request)
        if self.responses:
            r = self.responses.pop(0)
            if isinstance(r, Exception):
                raise r
            if r.status_code != 200:
                return r
            return self._take(json.loads(request.content))
        return self._take(json.loads(request.content))

    def _take(self, events) -> httpx.Response:
        new = [e["event_id"] for e in events if e["event_id"] not in self.ids]
        self.ids.update(new)
        return httpx.Response(200, json={"accepted": len(new), "duplicates": len(events) - len(new), "seq_max": len(self.ids)})

    def factory(self):
        return lambda: hub.make_client(transport=httpx.MockTransport(self))
