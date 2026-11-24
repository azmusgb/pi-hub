"""A manifest (docs/missions/<id>.json) plus where it lives (repo, path, commit) -> the importer's events, in
order, ending with plan.imported (A35 §8, decisions 7 and 13 of the M1a plan). Event ids are deterministic, so
importing the same commit again is a no-op at Pi Hub and a new commit makes new events.

Experiments a manifest names are read from print-lab's origin/main after a fetch, never from the working checkout,
which lags (~/dev checkouts lag origin). One that can't be read is reported `unavailable`, never skipped."""
import asyncio
import json
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field

from .. import hub, shell

NAMESPACE = uuid.UUID("5e3f9a1c-8b47-4d62-a0c5-35a1c0de0a35")  # fixed forever: changing it re-ids every import
PRINT_LAB = "azmusgb/print-lab"
GIT_TIMEOUT = 30
_CONTROL = re.compile(r"[\x00-\x09\x0b-\x1f\x7f]")
_SHA = re.compile(r"[0-9a-f]{7,40}")
Git = Callable[[list[str]], shell.Run]


def run_git(argv: list[str]) -> shell.Run:
    return asyncio.run(shell.run(argv, GIT_TIMEOUT))


@dataclass
class ImportResult:
    events: list[dict] = field(default_factory=list)
    unavailable: list[dict] = field(default_factory=list)  # {"id": "hex-tile/E-007", "reason": "..."}


def event_id(path: str, commit: str, entity: str, etype: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"{path}@{commit}#{entity}#{etype}"))


def fit(text, limit: int) -> str:
    """Text made to satisfy the contract's text:N: control characters become spaces, and a string over the limit is
    cut with an ellipsis. Record text from print-lab is the only input that isn't already validated."""
    clean = _CONTROL.sub(" ", str(text)).strip()
    return clean if len(clean) <= limit else clean[:limit - 1].rstrip() + "…"


def _drop_none(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


def slug_of(experiment: str) -> str:
    """'hex-tile/E-007' -> 'hex-tile-e-007', a contract slug for the child id."""
    return experiment.lower().replace("/", "-")


def _experiment(entry: str, initiative: str, repo: str, git: Git, head: dict) -> tuple[dict | None, str | None]:
    """(body, None) for an experiment record, or (None, why unavailable). `head` caches the fetch and rev-parse."""
    if "commit" not in head:
        fetched = git(["git", "-C", repo, "fetch", "-q"])
        if fetched.code != 0:
            head["commit"], head["why"] = None, "git fetch failed, so origin/main may be stale"
        else:
            rev = git(["git", "-C", repo, "rev-parse", "origin/main"])
            sha = rev.out.strip()
            if rev.code != 0 or not _SHA.fullmatch(sha):
                head["commit"], head["why"] = None, "cannot read origin/main"
            else:
                head["commit"], head["why"] = sha, None
    if head["commit"] is None:
        return None, head["why"]
    project, _, record = entry.partition("/")
    path = f"projects/{project}/experiments/{record}.json"
    shown = git(["git", "-C", repo, "show", f"origin/main:{path}"])
    if shown.code != 0:
        return None, "not found on print-lab origin/main"
    try:
        rec = json.loads(shown.out)
    except ValueError:
        return None, "the record is not JSON"
    if not isinstance(rec, dict) or not isinstance(rec.get("id"), str) or not rec["id"].strip() \
            or not isinstance(rec.get("question_text"), str) or not rec["question_text"].strip():
        return None, "the record has no id or question_text"
    findings = rec.get("findings")
    body = _drop_none({
        "id": f"{initiative}:experiment:{slug_of(entry)}", "project": project, "record": fit(rec["id"], 20),
        "question": fit(rec["question_text"], 500),
        "hypothesis": fit(rec["hypothesis"], 1000) if isinstance(rec.get("hypothesis"), str) and rec["hypothesis"].strip() else None,
        "prediction": fit(rec["prediction"], 500) if isinstance(rec.get("prediction"), str) and rec["prediction"].strip() else None,
        "findings": len(findings) if isinstance(findings, list) and len(findings) <= 1000 else None,
        "source": {"repo": PRINT_LAB, "path": path, "commit": head["commit"]},
    })
    return body, None


def build(manifest: dict, manifest_ref: dict, print_lab: str | None = None, git: Git = run_git,
          at: str | None = None) -> ImportResult:
    """The events for `manifest`, in the order Pi Hub folds them into a proposed revision. `manifest_ref` is
    {repo, path, commit}. The manifest must already have passed validate_manifest."""
    initiative = manifest["initiative"]["id"]
    path, commit = manifest_ref["path"], manifest_ref["commit"]
    at = at or hub.now_iso()
    result = ImportResult()

    def add(etype: str, entity: str, body: dict) -> None:
        result.events.append({"event_id": event_id(path, commit, entity, etype), "type": etype, "at": at,
                              "initiative": initiative, "body": body})

    init = manifest["initiative"]
    add("initiative.imported", initiative, _drop_none(
        {"title": init["title"], "intent": init["intent"], "status": init["status"], "manifest": manifest_ref,
         "spec": init.get("spec")}))
    for stage in manifest["stages"]:
        add("stage.imported", stage["id"], {k: stage[k] for k in ("id", "n", "title")})
        for gate in stage.get("gates", []):
            add("gate.imported", gate["id"], _drop_none({**gate, "stage": stage["id"]}))
    for kind, etype in (("workstreams", "workstream.imported"), ("tasks", "task.imported")):
        for item in manifest.get(kind, []):
            add(etype, item["id"], dict(item))
    for dep in manifest.get("dependencies", []):
        add("dependency.imported", f"{dep['from']}>{dep['to']}>{dep['kind']}", dict(dep))
    for kind, etype in (("decisions", "decision.imported"), ("risks", "risk.imported"),
                        ("evidence", "evidence.imported")):
        for item in manifest.get(kind, []):
            add(etype, item["id"], dict(item))
    head: dict = {}
    repo = print_lab or shell.printlab_repo()
    for entry in manifest.get("experiments", []):
        body, why = _experiment(entry, initiative, repo, git, head)
        if body is None:
            result.unavailable.append({"id": entry, "reason": why})
        else:
            add("experiment.imported", body["id"], body)
    add("plan.imported", initiative, {"manifest": manifest_ref, "entities": len(result.events)})
    return result
