#!/bin/bash
# Pull the Paperless nightly export from the PC (read-only share PaperlessExport$, automounted at
# /mnt/paperless-export) into dated hard-link snapshots on the Pi's drive; keep 14.
set -euo pipefail
src=/mnt/paperless-export
dst=/mnt/usb1/backups/paperless
state=/var/lib/pi-paperless-backup/state.json
mountpoint -q /mnt/usb1 || { echo "usb1 not mounted"; exit 1; }
ls "$src"/manifest.json >/dev/null   # triggers the automount; fails if the PC is off
mkdir -p "$dst"
today="$dst/$(date +%F)"
prev=$(ls -1d "$dst"/20* 2>/dev/null | grep -v "$today" | tail -1 || true)
rsync -a --delete ${prev:+--link-dest="$prev"} "$src"/ "$today".tmp/
rm -rf "$today"; mv "$today".tmp "$today"
ls -1d "$dst"/20* | head -n -14 | xargs -r rm -rf
files=$(ls "$today" | wc -l)
printf '{"last_ok": %s, "snapshot": "%s", "files": %s}\n' "$(date +%s)" "$(basename "$today")" "$files" > "$state.tmp"
mv "$state.tmp" "$state"
echo "ok $(du -sh "$today" | cut -f1) $files files"
