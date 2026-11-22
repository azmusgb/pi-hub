"""Room view snapshots (amendment A20 D3, plan P2): a saved still and its settings as <id>.jpg + <id>.json in
SNAPSHOT_DIR, newest MAX_SNAPSHOTS kept. The id is the save time in milliseconds."""
import json
import os
import re
import time

from . import room_camera
from .room_camera import Invalid

SNAPSHOT_DIR = os.environ.get("HUB_SNAPSHOT_DIR", "/var/lib/pi-hub/room-snapshots")
MAX_SNAPSHOTS = 200

_SNAPSHOT_ID_RE = re.compile(r"^\d{13}$")


def validate_snapshot_id(snapshot_id):
    if not isinstance(snapshot_id, str) or not _SNAPSHOT_ID_RE.match(snapshot_id):
        raise Invalid("id", "Invalid snapshot id.")
    return snapshot_id


def get_snapshot_path(snapshot_id, ext="jpg"):
    s_id = validate_snapshot_id(snapshot_id)
    return os.path.join(SNAPSHOT_DIR, f"{s_id}.{ext}")


def list_snapshots():
    if not os.path.isdir(SNAPSHOT_DIR):
        return []
    items = []
    try:
        filenames = os.listdir(SNAPSHOT_DIR)
    except OSError:
        return []
    for fn in filenames:
        if fn.endswith(".jpg") and len(fn) == 17 and fn[:13].isdigit():
            s_id = fn[:13]
            meta_path = os.path.join(SNAPSHOT_DIR, f"{s_id}.json")
            meta = {}
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r") as f:
                        meta = json.load(f)
                except Exception:
                    pass
            items.append({
                "id": s_id,
                "created_at": meta.get("created_at", int(s_id) / 1000.0),
                "preset": meta.get("preset"),
                "settings": meta.get("settings", {}),
            })
    items.sort(key=lambda x: x["id"], reverse=True)
    return items


def delete_snapshot(snapshot_id):
    s_id = validate_snapshot_id(snapshot_id)
    jpg_path = get_snapshot_path(s_id, "jpg")
    json_path = get_snapshot_path(s_id, "json")
    removed = False
    for p in (jpg_path, json_path):
        try:
            os.remove(p)
            removed = True
        except FileNotFoundError:
            pass
    if not removed:
        raise Invalid("id", f"Snapshot {snapshot_id!r} not found.")


def _enforce_snapshot_limit(limit=MAX_SNAPSHOTS):
    snaps = list_snapshots()
    if len(snaps) >= limit:
        # list_snapshots is newest first; oldest are at the end
        to_remove = snaps[limit - 1:]
        for s in to_remove:
            try:
                delete_snapshot(s["id"])
            except Exception:
                pass


async def save_snapshot(cam=None):
    c = cam or room_camera.CAMERA
    # Check running stream frame or take one-shot still under lock
    jpg, at = await c.still()
    if len(jpg) > room_camera.MAX_FRAME:
        raise Invalid(None, f"Snapshot frame too large ({len(jpg)} bytes).")

    os.makedirs(SNAPSHOT_DIR, exist_ok=True)
    _enforce_snapshot_limit(MAX_SNAPSHOTS)

    s_id = str(int(time.time() * 1000))
    # Ensure uniqueness if called in the same millisecond
    while os.path.exists(os.path.join(SNAPSHOT_DIR, f"{s_id}.jpg")):
        time.sleep(0.001)
        s_id = str(int(time.time() * 1000))

    settings = c.settings()
    meta = {
        "id": s_id,
        "created_at": at,
        "preset": settings.get("preset"),
        "settings": settings,
    }

    tmp_jpg = os.path.join(SNAPSHOT_DIR, f".tmp-{s_id}.jpg")
    tmp_json = os.path.join(SNAPSHOT_DIR, f".tmp-{s_id}.json")

    with open(tmp_jpg, "wb") as f:
        f.write(jpg)
    with open(tmp_json, "w") as f:
        json.dump(meta, f)

    os.replace(tmp_jpg, os.path.join(SNAPSHOT_DIR, f"{s_id}.jpg"))
    os.replace(tmp_json, os.path.join(SNAPSHOT_DIR, f"{s_id}.json"))

    return meta

