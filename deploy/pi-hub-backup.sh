#!/bin/bash
# Nightly backup of the hub's data and the Pi's settings. Keeps the last 14 days.
set -euo pipefail
DEST=/var/backups/pi-hub
STAMP=$(date +%Y%m%d-%H%M)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$DEST" && chmod 755 "$DEST"
# A consistent copy of the hub database, taken with SQLite's own backup.
python3 - "$WORK/hub.db" <<'PYBACKUP'
import pathlib, shutil, sqlite3, sys
out = pathlib.Path(sys.argv[1])
# File mutations commit through SQLite transactions. Hold the writer lock while
# snapshotting both the database and its referenced project files.
lock = sqlite3.connect("/var/lib/pi-hub/hub.db", timeout=30, isolation_level=None)
lock.execute("BEGIN IMMEDIATE")
try:
    src = sqlite3.connect("file:/var/lib/pi-hub/hub.db?mode=ro", uri=True)
    dst = sqlite3.connect(out)
    src.backup(dst)
    dst.close()
    src.close()
    files = out.parent / "var/lib/pi-hub/project-files"
    files.mkdir(parents=True)
    if lock.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_files'").fetchone():
        for (name,) in lock.execute("SELECT stored_name FROM project_files"):
            if pathlib.Path(name).name != name:
                raise ValueError("Invalid project file path in database")
            shutil.copy2(pathlib.Path("/var/lib/pi-hub/project-files") / name, files / name)
finally:
    lock.rollback()
    lock.close()
PYBACKUP

# Optional legacy services may be absent; errors archiving existing files must
# fail the backup instead of publishing a silently incomplete archive.
SOURCES=()
for source in etc/fstab etc/samba etc/avahi etc/systemd/system etc/pi-status etc/pi-hub \
              var/lib/pi-hub/lab var/lib/homebridge opt/homepage/config opt/netmon usr/local/bin; do
  if [ -e "/$source" ]; then SOURCES+=("$source"); fi
done
# tar exits 1 when a file (the lab folder, mostly) changed while it was read; that still leaves a usable archive.
rc=0
tar -czf "$WORK/backup.tgz" \
  --exclude='var/lib/homebridge/node_modules' --exclude='var/lib/homebridge/*.log' \
  --exclude='var/lib/homebridge/backups' --exclude='var/lib/pi-hub/lab/*/incoming' --exclude='*/.venv.old-armhf' \
  -C / "${SOURCES[@]}" -C "$WORK" hub.db var/lib/pi-hub/project-files || rc=$?
[ "$rc" -le 1 ] || exit "$rc"

install -m 640 -o root -g pi-backup "$WORK/backup.tgz" "$DEST/pi-$STAMP.tgz"
ls -1t "$DEST"/pi-*.tgz | tail -n +15 | xargs -r rm -f
echo "saved $DEST/pi-$STAMP.tgz"
