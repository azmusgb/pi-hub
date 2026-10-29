"""Qualification request endpoint for Print Lab v2.

This is intentionally separate from the legacy generic request validator. The
browser may queue a decision, but the Mac remains authoritative: lab pull
revalidates the exact run/build/reference/evidence state before applying it.
"""
from __future__ import annotations

import json
import re

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

from . import db, lab
from .auth import need

DECISIONS = {"qualified", "continue", "rejected"}
EXPERIMENT_RE = re.compile(r"^E-\d{3,}$")
RUN_RE = re.compile(r"^(?:RUN|PR)-\d{3,}-\d{2,}$")
BUILD_RE = re.compile(r"^BLD-\d{3,}-\d{2,}$")

# lab.list_requests hides top-level run for experiment-level actions. Qualification
# carries the exact immutable run snapshot in payload.run_seen, so keep the queue
# compatible with the existing Mac pull guard while the canonical validator owns
# the real RUN/PR check.
if "qualification" not in lab.ACT_KINDS:
    lab.ACT_KINDS = (*lab.ACT_KINDS, "qualification")


def _full(rx: re.Pattern[str], value) -> bool:
    return isinstance(value, str) and rx.fullmatch(value) is not None


def _problem(data) -> str | None:
    if not isinstance(data, dict):
        return "Invalid JSON request body"
    if not lab._full(lab.REQUEST_ID_RE, data.get("id")):
        return "Request id must look like rq-0123456789abcdef"
    if not _full(EXPERIMENT_RE, data.get("experiment")):
        return "Invalid experiment id"
    if not _full(RUN_RE, data.get("run")):
        return "run must look like RUN-025-01 or PR-025-01"
    payload = data.get("payload")
    if not isinstance(payload, dict):
        return "payload must be an object"
    if payload.get("decision") not in DECISIONS:
        return "decision must be qualified, continue, or rejected"
    reason = payload.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        return "A qualification decision needs a reason."
    if len(reason.strip()) > lab.MAX_REASON:
        return f"Keep the qualification reason to {lab.MAX_REASON} characters."
    if not _full(EXPERIMENT_RE, payload.get("reference_experiment")):
        return "reference_experiment must look like E-019"
    if not _full(RUN_RE, payload.get("run_seen")):
        return "run_seen must look like RUN-025-01 or PR-025-01"
    if payload.get("run_seen") != data.get("run"):
        return "run must match run_seen"
    if not _full(BUILD_RE, payload.get("build_seen")):
        return "build_seen must look like BLD-025-01"
    if payload.get("evidence_reviewed") is not True:
        return "evidence_reviewed must be true"
    return None


def _stored_payload(payload: dict) -> dict:
    return {
        "decision": payload["decision"],
        "reason": payload["reason"].strip(),
        "reference_experiment": payload["reference_experiment"],
        "run_seen": payload["run_seen"],
        "build_seen": payload["build_seen"],
        "evidence_reviewed": True,
    }


@lab.router.post("/{project}/qualification")
async def create_qualification_request(project: str, request: Request):
    """Queue one owner qualification decision for canonical Mac-side validation."""
    _, by = need(request, "household")
    lab.ready()
    lab.check_project(project)
    if not db.one("SELECT 1 FROM lab_projects WHERE project = ?", project):
        raise HTTPException(404, "No such project.")

    data = lab._load_request_json(await lab.read_capped(request, lab.MAX_KIND_REQUEST))
    if len(json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()) > lab.MAX_KIND_REQUEST:
        raise HTTPException(413, "Too large for the print lab: 4 KB at most.")
    problem = _problem(data)
    if problem:
        raise HTTPException(400, problem)

    req_id = data["id"]
    existing = db.one("SELECT id, status FROM lab_requests WHERE id = ?", req_id)
    if existing:
        return JSONResponse({"ok": True, "id": req_id, "status": existing["status"]})

    pending = db.one(
        "SELECT COUNT(*) AS c FROM lab_requests WHERE project = ? AND status = 'pending'", project
    )["c"]
    if pending >= lab.MAX_PENDING:
        raise HTTPException(429, "The Mac hasn't picked up the last 20 requests. Check that the Mac is awake.")
    total = db.one("SELECT COUNT(*) AS c FROM lab_requests WHERE status = 'pending'")["c"]
    if total >= lab.MAX_PENDING_TOTAL:
        raise HTTPException(
            429,
            f"The Mac hasn't picked up the last {lab.MAX_PENDING_TOTAL} requests across all projects. Check that the Mac is awake.",
        )

    payload = _stored_payload(data["payload"])
    db.run(
        "INSERT INTO lab_requests (id, project, kind, experiment, run, run_seen, payload, status, created_at, by_device) "
        "VALUES (?, ?, 'qualification', ?, ?, NULL, ?, 'pending', ?, ?)",
        req_id,
        project,
        data["experiment"],
        data["run"],
        json.dumps(payload),
        lab.now_iso(),
        (by or "")[:80],
    )
    return JSONResponse({"ok": True, "id": req_id, "status": "pending"})
