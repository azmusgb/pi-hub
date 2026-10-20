#!/bin/bash
# Nightly backup of the hub's data and the Pi's settings. Keeps the last 14 days.
set -euo pipefail
DEST=/var/backups/pi-hub
STAMP=$(date +%Y%m%d-%H%M)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$DEST" && chmod 755 "$DEST"
# A consistent copy of the hub database, taken with SQLite's own backup.
python3 - "$WORK/hub.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect("file:/var/lib/pi-hub/hub.db?mode=ro", uri=True)
dst = sqlite3.connect(sys.argv[1])
src.backup(dst)
dst.close()
PY

tar -czf "$WORK/backup.tgz" \
  --exclude='var/lib/homebridge/node_modules' --exclude='var/lib/homebridge/*.log' \
  --exclude='var/lib/homebridge/backups' --exclude='*/.venv.old-armhf' \
  -C / etc/fstab etc/samba etc/avahi etc/systemd/system etc/pi-status etc/pi-hub \
       var/lib/homebridge opt/homepage/config usr/local/bin \
  -C "$WORK" hub.db 2>/dev/null || true

install -m 600 "$WORK/backup.tgz" "$DEST/pi-$STAMP.tgz"
ls -1t "$DEST"/pi-*.tgz | tail -n +15 | xargs -r rm -f
echo "saved $DEST/pi-$STAMP.tgz"
