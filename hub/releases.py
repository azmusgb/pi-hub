"""Release records (platform step 3): one `release:<target>` record per deploy target, the canonical deployment state.

Each target's deploy writes its record when it finishes (spec §4, D1 + D7 amendment). Deploys on the Pi drop a report in
INBOX, which the hub reads every loop pass: the hub only reads it (ProtectSystem keeps it out), so the writer keeps its own
last few reports and a report read twice is a no-op. Probes only verify: a mismatch makes the record `drifted`, never a
new commit. Release records are facts about the last deploy, not readings, so they are never marked stale.
"""
import json
import os
import re
import sys
import threading
from datetime import datetime

from . import now as now_mod
from . import records

PREFIX = "release:"
# target -> label, in the order System › Versions lists them
TARGETS = {"pi-hub": "Pi Hub", "localai": "Local AI", "firmware": "Display firmware", "netmon": "netmon",
           "mac-watch": "Mac watchdog", "x2d-bridge-mac": "Mac camera bridge"}
MECHANISMS = {"pi-hub-release", "safe-deploy", "ota-hook", "netmon-deploy", "mac-install"}
RESULTS = {"deployed", "failed", "rolled-back"}
SEVERITY = {"live": "ok", "behind": "info", "ahead": "info", "unknown": "info", "drifted": "attention"}
SOURCE = "release"
INBOX = os.environ.get("HUB_RELEASE_INBOX", "/var/lib/pi-hub-releases/inbox")
CURRENT = os.environ.get("HUB_CURRENT_RELEASE", "/opt/pi-hub/current")
FUTURE = 300  # seconds a report's time may be ahead of the hub's clock
HEX = re.compile(r"[0-9a-f]{7,40}")
INVALID = "That release report isn't valid."

for _t, _label in TARGETS.items():
    records.LABELS[PREFIX + _t] = _label + " deploy"
    now_mod.HREF[PREFIX + _t] = "/settings"  # the Versions card; System › Versions replaces it (step 3, PR 3.2)

_lock = threading.Lock()
_refused = set()  # inbox files already reported as invalid, so each is logged once


def ids():
    return [PREFIX + t for t in TARGETS]


def _short(commit):
    return (commit or "")[:7]


def _same(a, b):
    """Two commit names for one commit: a short name is a prefix of the full one."""
    return bool(a and b) and (a.startswith(b) or b.startswith(a))


def _hex(value):
    return value if isinstance(value, str) and HEX.fullmatch(value) else None


def valid(target, body, now):
    """A normalised report, or None. `commit` is the commit the deploy was about; `running` is what runs after it
    (required for rolled-back; for failed, None means unchanged)."""
    if target not in TARGETS or not isinstance(body, dict):
        return None
    commit, result, mechanism = _hex(body.get("commit")), body.get("result"), body.get("mechanism")
    if not commit or result not in RESULTS or mechanism not in MECHANISMS:
        return None
    try:
        raw = body.get("at")
        when = datetime.fromisoformat(raw) if isinstance(raw, str) else None
    except ValueError:
        when = None
    at = when.timestamp() if when is not None and when.tzinfo is not None else None
    if at is None or at > now + FUTURE:
        return None
    out = {"commit": commit, "result": result, "mechanism": mechanism, "at": at}
    for key in ("running", "previous", "head"):
        if body.get(key) is not None:
            if not _hex(body[key]):
                return None
            out[key] = body[key]
    if result == "rolled-back" and "running" not in out:
        return None
    message = body.get("message", "")
    if not isinstance(message, str) or len(message) > 200:
        return None
    out["message"] = message
    return out


def _state(running, head, detail):
    if not running:
        return "unknown"
    if detail.get("drift_from") == running:
        return "drifted"
    if head and not _same(head, running):
        return "behind"
    return "live"


def _build(target, detail, prev, now, source):
    """The stored record for `detail`, with severity, headline and since."""
    label, last, running = TARGETS[target], detail.get("last") or {}, detail.get("commit")
    state = _state(running, detail.get("head"), detail)
    severity = "attention" if last.get("result") in ("failed", "rolled-back") else SEVERITY[state]
    cause = last.get("message") or ""
    if state == "unknown" and not last:
        headline = "Not publishing yet"
    elif state == "drifted":
        severity = "attention"
        headline = f"{label} is running {_short(detail['verified']['commit'])}, not the recorded {_short(running)}"
    elif last.get("result") == "failed":
        headline = (f"{label} deploy failed: {_short(running)} is still running" if running
                    else f"{label} deploy of {_short(last['commit'])} failed")
    elif last.get("result") == "rolled-back":
        headline = f"{label} deploy of {_short(last['commit'])} was rolled back: {_short(running)} is running"
    elif state == "behind":
        headline = f"{_short(running)} is live; {_short(detail['head'])} is not deployed"
    else:
        headline = f"{_short(running)} is live"
    rec = records.make(PREFIX + target, state, headline, source, cause=cause, detail=detail)
    changed = prev is None or prev["state"] != state or prev["severity"] != severity
    rec.update(as_of=now, stale=False, severity=severity, since=now if changed else prev["since"])
    return rec


def put(target, report, now):
    """Applies one validated report; returns the record. The same report twice, or one older than the last, is a no-op."""
    with _lock:
        prev = records.get(PREFIX + target)
        detail = dict(prev["detail"]) if prev else {}
        last = detail.get("last") or {}
        if last and (report["at"] < last["at"] or
                     (report["at"], report["commit"], report["result"]) == (last["at"], last["commit"], last["result"])):
            return prev
        running = detail.get("commit")
        if report["result"] == "deployed":
            if running and not _same(running, report["commit"]):
                detail["previous"] = running
            elif report.get("previous"):
                detail["previous"] = report["previous"]
            running = report["commit"]
            detail["deployed_at"] = report["at"]
        elif report.get("running"):
            if not _same(report["running"], running):
                detail["previous"], detail["deployed_at"] = running, report["at"]
            running = report["running"]
        detail.update(target=target, label=TARGETS[target], commit=running, mechanism=report["mechanism"],
                      head=report.get("head"),
                      last={k: report[k] for k in ("commit", "result", "at", "message")})
        detail.pop("drift_from", None)  # a deploy says what runs now; the next probe checks it again
        rec = _build(target, detail, prev, now, report["mechanism"])
        records.store({rec["id"]: rec}, now)
        return rec


def seed(now):
    """An `unknown` record ("Not publishing yet") for each target that has none."""
    new = {}
    for target in TARGETS:
        if records.get(PREFIX + target) is None:
            new[PREFIX + target] = _build(target, {"target": target, "label": TARGETS[target], "commit": None},
                                          None, now, SOURCE)
    return records.store(new, now) if new else []


def read_inbox(now, path=None):
    """Applies every report in the inbox, oldest first. Writers name files <target>-<epoch>-<rand>.json."""
    path = INBOX if path is None else path
    try:
        names = [n for n in os.listdir(path) if n.endswith(".json")]
    except OSError:
        return 0
    reports = []
    for name in names:
        try:
            with open(os.path.join(path, name)) as f:
                body = json.load(f)
        except (OSError, ValueError):
            body = None
        target = body.get("target") if isinstance(body, dict) else None
        report = valid(target, body, now)
        if report is None:
            if name not in _refused:
                _refused.add(name)
                print(f"releases: {name}: {INVALID}", file=sys.stderr)
            continue
        reports.append((report["at"], name, target, report))
    for _, _, target, report in sorted(reports, key=lambda r: (r[0], r[1])):
        put(target, report, now)
    return len(reports)


def verify_pi_hub(now, current=None):
    """Pi Hub's own drift check: the release folder `current` points at against the record's commit."""
    current = CURRENT if current is None else current
    try:
        running = os.path.basename(os.path.realpath(current, strict=True))
    except OSError:
        return None
    with _lock:
        prev = records.get(PREFIX + "pi-hub")
        detail = dict(prev["detail"]) if prev else {}
        commit = detail.get("commit")
        if not commit or not HEX.fullmatch(running or ""):
            return None
        drift = None if _same(commit, running) else commit
        if drift == detail.get("drift_from") and (detail.get("verified") or {}).get("commit") == running:
            return prev
        detail["verified"] = {"commit": running, "at": now, "by": "pi-hub current release"}
        if drift:
            detail["drift_from"] = drift
        else:
            detail.pop("drift_from", None)
        rec = _build("pi-hub", detail, prev, now, prev["source"])
        records.store({rec["id"]: rec}, now)
        return rec


def loop(now):
    """One pass: seed the targets, read the Pi's inbox, check Pi Hub's own release."""
    seed(now)
    read_inbox(now)
    verify_pi_hub(now)
