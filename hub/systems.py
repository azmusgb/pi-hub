"""What runs where (baseline decision 2; Atlas redesign spec, PR 4): the one list of hosts, each with the status records
and deploy targets that live on it. Local AI's Architecture page draws its Systems strip from GET /api/systems; the
states come from the records (release records are the deployment truth, D1 + D7), never from a list in the page.
Every record kind and every deploy target belongs to exactly one host (tests/test_systems.py holds that)."""
import time

from . import records, releases

HOSTS = [
    {"id": "pi", "label": "Raspberry Pi", "runs": "Always on",
     "services": ["hub", "pi", "devices", "plex", "movies_drive", "adguard", "paper_printer", "weather", "internet"],
     "targets": ["pi-hub", "netmon"]},
    {"id": "pc", "label": "Windows PC", "runs": "May sleep",
     "services": ["local_ai", "pc", "pc_printing", "movie_copy"], "targets": ["localai"]},
    {"id": "mac", "label": "Mac", "runs": "When it is awake",
     "services": ["mac_lab"], "targets": ["mac-watch", "x2d-bridge-mac", "print-lab"]},
    {"id": "devices", "label": "Devices", "runs": "On the home network",
     "services": ["printer", "camera", "hms", "obico", "workshop_display"], "targets": ["firmware"]},
    {"id": "offsite", "label": "Off-site", "runs": "Google Drive, nightly",
     "services": ["backups"], "targets": []},
]

# deploy target -> its GitHub repository (System › Versions links commits with the same table, versions.js REPO)
REPOS = {"pi-hub": "azmusgb/pi-hub", "localai": "azmusgb/LocalAI", "firmware": "azmusgb/bambuhelper-smart-display",
         "netmon": "azmusgb/netmon", "mac-watch": "azmusgb/LocalAI", "x2d-bridge-mac": "azmusgb/bambuhelper-smart-display",
         "print-lab": "azmusgb/print-lab"}
# deploy target -> the repository name Atlas keeps snapshots under (versions.js ATLAS); others aren't mapped yet
ATLAS = {"pi-hub": "pi-hub", "localai": "localai", "mac-watch": "localai", "print-lab": "print-lab"}


def _service(kind, rec):
    rec = rec or {}
    return {"id": kind, "label": records.LABELS.get(kind, kind), "state": rec.get("state") or "unknown",
            "severity": rec.get("severity") or "attention", "headline": rec.get("headline") or "",
            "stale": bool(rec.get("stale"))}


def _target(target, rec):
    detail = (rec or {}).get("detail") or {}
    return {"id": target, "label": releases.TARGETS[target], "repo": REPOS.get(target), "atlas": ATLAS.get(target),
            "state": (rec or {}).get("state") or "unknown", "commit": detail.get("commit") or None,
            "deployed_at": detail.get("deployed_at") or None, "version": detail.get("version") or None}


def body():
    """The hosts with each service's and target's current state; only names and states, never a record's detail."""
    recs = records.all()
    return {"as_of": time.time(), "hosts": [
        {"id": h["id"], "label": h["label"], "runs": h["runs"],
         "services": [_service(k, recs.get(k)) for k in h["services"]],
         "targets": [_target(t, recs.get(releases.PREFIX + t)) for t in h["targets"]]}
        for h in HOSTS]}
