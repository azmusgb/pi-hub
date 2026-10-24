#!/usr/bin/env python3
"""Copies the Windows PC's movies onto the Pi's own drive, so Plex can play them while the PC is off.

One way only: new and changed films on the PC's share are copied to /mnt/usb1/Movies. Runs nightly from
pi-hub-movies-mirror.timer, or from "Copy new movies now" on the Drives page.

Guards, so a bad night never empties the Pi's copy:
- nothing is copied unless the share is really mounted and lists at least 90% of the films the last
  good run saw (run with --accept-drop once after deliberately removing many films on the PC);
- films gone from the PC are moved to /mnt/usb1/.movies-removed and deleted after 30 days;
- the copy stops before the drive would be more than 90% full.
The result is saved to /var/lib/pi-hub-mirror/state.json for the hub's pages and the self-check.
"""
import fcntl
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

SOURCE = "/mnt/windows-movies"
DEST = "/mnt/usb1/Movies"
REMOVED = "/mnt/usb1/.movies-removed"
STATE = "/var/lib/pi-hub-mirror/state.json"
PLEX_TOKEN_FILE = "/etc/pi-hub/secrets/plex_token"
VIDEO = (".mp4", ".mkv", ".m4v", ".avi", ".mov", ".wmv", ".ts", ".webm")
SUBTITLES = (".srt", ".sub", ".idx", ".ass", ".ssa", ".vtt")
MEDIA = VIDEO + SUBTITLES
MIN_SHARE = 0.9
MAX_FULL = 0.9
KEEP_REMOVED_DAYS = 30


def media_files(root):
    """(relative path, size) of each film and subtitle file under root, skipping hidden files and folders."""
    for top, dirs, files in os.walk(root):
        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
        for name in sorted(files):
            if not name.startswith(".") and name.lower().endswith(MEDIA):
                path = os.path.join(top, name)
                yield os.path.relpath(path, root), os.path.getsize(path)


def films(files):
    return [f for f in files if f[0].lower().endswith(VIDEO)]


def _pattern(ext):
    # rsync patterns are case-sensitive; Windows names often aren't lower case.
    return "*." + "".join(f"[{c.lower()}{c.upper()}]" if c.isalpha() else c for c in ext[1:])


def rsync_args(source, dest):
    return (["rsync", "-rt", "--modify-window=2", "--prune-empty-dirs", "--itemize-changes",
             "--exclude=.*", "--include=*/"] + [f"--include={_pattern(e)}" for e in MEDIA] + ["--exclude=*", f"{source}/", f"{dest}/"])


def load_state(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(path, state):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w") as f:
        json.dump(state, f)
    os.chmod(path + ".tmp", 0o644)
    os.replace(path + ".tmp", path)


def purge_removed(removed, now, keep_days=KEEP_REMOVED_DAYS):
    """Deletes set-aside films older than keep_days; returns the bytes still set aside."""
    kept = 0
    try:
        names = os.listdir(removed)
    except OSError:
        return 0
    for name in names:
        path = os.path.join(removed, name)
        if now - os.path.getmtime(path) > keep_days * 86400:
            shutil.rmtree(path, ignore_errors=True)
        else:
            kept += sum(size for _, size in media_files(path))
    return kept


def rescan_plex(token_file=PLEX_TOKEN_FILE):
    try:
        with open(token_file) as f:
            token = f.read().strip()
        req = urllib.request.Request("http://127.0.0.1:32400/library/sections/all/refresh", headers={"X-Plex-Token": token})
        urllib.request.urlopen(req, timeout=10).close()
    except Exception:  # noqa: BLE001
        pass


def sync(source=SOURCE, dest=DEST, removed=REMOVED, state_path=STATE, accept_drop=False, is_mount=os.path.ismount,
         rescan=rescan_plex, now=None):
    now = now or time.time()
    state = load_state(state_path)
    state.update(status="running", started=int(now), message="Copying new movies from the PC.")
    save_state(state_path, state)

    def finish(status, message, **kw):
        state.update(kw, status=status, message=message, finished=int(time.time()))
        if status == "ok":
            state["last_ok"] = state["finished"]
        save_state(state_path, state)
        return state

    if not is_mount(source):
        return finish("skipped", "The PC's movie share isn't mounted, so nothing was copied. Is the PC on?")
    try:
        source_files = list(media_files(source))
    except OSError as e:
        return finish("failed", f"Couldn't read the PC's movie share: {e.strerror or e}.")
    count = len(films(source_files))
    last = state.get("source_count") or 0
    if not count:
        return finish("skipped", "The PC's movie share lists no movies, so nothing was copied or removed.")
    if last and count < last * MIN_SHARE and not accept_drop:
        return finish("skipped", f"The PC's share lists {count} movies, down from {last}. Nothing was copied or removed in case "
                                 "the share is only partly readable. If those films were removed on purpose, run the copy with --accept-drop.")

    os.makedirs(dest, exist_ok=True)
    st = os.statvfs(dest)
    capacity = st.f_blocks * st.f_frsize
    used_elsewhere = (st.f_blocks - st.f_bfree) * st.f_frsize - sum(size for _, size in media_files(dest))
    needed = sum(size for _, size in source_files)
    if used_elsewhere + needed > capacity * MAX_FULL:
        return finish("failed", f"The movies need {needed / 1e9:.0f} GB, which would fill the Pi's drive past 90%. "
                                "Nothing was copied; free space or fit a bigger drive.", source_count=count)

    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime(now))
    args = rsync_args(source, dest)
    args[1:1] = ["--delete", "--backup", f"--backup-dir={os.path.join(removed, stamp)}"]
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=8 * 3600)
    except subprocess.TimeoutExpired:
        return finish("failed", "The copy took more than 8 hours and was stopped. It carries on from there next time.")
    lines = r.stdout.splitlines()
    copied = sum(1 for line in lines if line.startswith(">f"))
    gone = sum(1 for line in lines if line.startswith("*deleting") and line.rstrip().lower().endswith(MEDIA))
    if r.returncode not in (0, 24):
        detail = (r.stderr.strip().splitlines() or [f"rsync code {r.returncode}"])[-1][:160]
        return finish("failed", f"The copy stopped part-way ({detail}). It carries on from there next time.", copied=copied)

    check = subprocess.run(rsync_args(source, dest)[:1] + ["--dry-run", "--delete"] + rsync_args(source, dest)[1:],
                           capture_output=True, text=True, timeout=3600)
    differ = [line for line in check.stdout.splitlines() if line.startswith((">f", "*deleting"))]
    mirror = films(list(media_files(dest)))
    set_aside = purge_removed(removed, now)
    if copied or gone:
        rescan()
    result = dict(source_count=count, mirror_count=len(mirror), mirror_bytes=sum(size for _, size in mirror),
                  copied=copied, removed=gone, set_aside_bytes=set_aside)
    if differ:
        return finish("failed", f"{len(differ)} file{'s' if len(differ) > 1 else ''} still differ after the copy. It tries again next time.", **result)
    what = f"Copied {copied} new or changed file{'s' if copied != 1 else ''}" if copied else "Nothing new to copy"
    return finish("ok", f"{what}; {len(mirror)} movies on the Pi." + (f" {gone} removed on the PC set aside for 30 days." if gone else ""), **result)


def main(argv):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    with open(STATE + ".lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            print("A copy is already running.")
            return 0
        state = sync(accept_drop="--accept-drop" in argv)
    print(state["message"])
    return 1 if state["status"] == "failed" else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
