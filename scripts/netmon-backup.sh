#!/bin/bash
# ==============================================================================
# Automated Netmon & Pi Hub Backup (Spec § 37)
# Snapshots:
#   1. kuma.db (Uptime Kuma) via SQLite backup API (online, zero-corruption)
#   2. hub.db (Pi Hub) via SQLite backup API (online, zero-corruption)
#   3. Netmon configs: Docker compose, Prometheus, Grafana, scripts, inventory
#   4. System service definitions & fstab
# Bundles into a dated tarball, retains 14 days locally on SSD, and
# synchronizes off-Pi to Windows share: //10.0.0.21/Movies/netmon-backups.
# ==============================================================================
set -euo pipefail

LOCAL_DIR="${NETMON_BACKUP_DIR:-/mnt/usb1/netmon/backups}"
WINDOWS_DIR="${NETMON_BACKUP_SHARE:-/mnt/windows-movies/netmon-backups}"
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="netmon-backup-${STAMP}.tar.gz"
STATUS_FILES=("${NETMON_BACKUP_STATUS:-/var/lib/pi-hub/last_backup.json}" "$LOCAL_DIR/latest.json")
STEP="starting"
WORK=""

# Phone alert on the household ntfy servers (pi-status's list; ntfy.sh when it's missing).
notify() {
    local title="$1" body="$2" topic server
    [ -f /etc/pi-status/ntfy_topic ] || return 0
    topic=$(tr -d '[:space:]' < /etc/pi-status/ntfy_topic)
    [ -n "$topic" ] || return 0
    { grep -Ev '^[[:space:]]*(#|$)' /etc/pi-status/ntfy_servers 2>/dev/null || echo "https://ntfy.sh"; } | while read -r server; do
        curl -s --max-time 10 -d "$body" -H "Title: $title" -H "Priority: high" -H "Tags: warning" "${server%/}/$topic" >/dev/null 2>&1 || true
    done
}

# The health record Pi Hub reads. A failure keeps the last success's time and archive, so "last good backup" stays true.
record() {
    mkdir -p "$(dirname "${STATUS_FILES[0]}")" "$LOCAL_DIR" 2>/dev/null || true
    python3 - "$1" "$2" "${ARCHIVE:-}" "${SIZE:-}" "${LOCAL_COUNT:-0}" "${OFF_PI_COUNT:-0}" "${STATUS_FILES[@]}" << 'PYRECORD' || true
import json, os, sys, time
status, message, archive, size, local_count, off_pi_count, *paths = sys.argv[1:]
try:
    with open(paths[0]) as f:
        old = json.load(f)
except (OSError, ValueError):
    old = {}
now = int(time.time())
rec = {"timestamp": now, "time_human": time.strftime("%a %-I:%M %p"), "status": status, "message": message}
if status == "success":
    rec.update(archive=archive, size=size, local_count=int(local_count), off_pi_count=int(off_pi_count),
               last_success=now, last_success_archive=archive)
else:
    rec.update(last_success=old.get("last_success") or (old.get("timestamp") if old.get("status") == "success" else None),
               last_success_archive=old.get("last_success_archive") or old.get("archive"))
for p in paths:
    try:
        with open(p + ".tmp", "w") as f:
            json.dump(rec, f, indent=2)
        os.replace(p + ".tmp", p)
    except OSError:
        pass
PYRECORD
}

finish() {
    local code=$?
    if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
    if [ "$code" -ne 0 ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup FAILED while $STEP (exit $code)." >&2
        record "failed" "Failed while $STEP (exit $code)."
        notify "Netmon backup failed" "The nightly backup failed while $STEP. The last good backup is still on the SSD; see journalctl -u netmon-backup."
    fi
}
trap finish EXIT

# Work on the SSD beside the backups, never /tmp (the SD card or RAM): photos and project files make it large.
STEP="preparing the work folder on the SSD"
mkdir -p "$LOCAL_DIR"
find "$LOCAL_DIR" -maxdepth 1 -name '.work-*' -type d -mmin +60 -exec rm -rf {} + 2>/dev/null || true  # a run killed mid-way
WORK=$(mktemp -d "$LOCAL_DIR/.work-XXXXXX")

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting automated backup..."

# 1. Snapshot Uptime Kuma DB
STEP="snapshotting Uptime Kuma"
KUMA_DB="/mnt/usb1/netmon/uptime-kuma/kuma.db"
if [ -f "$KUMA_DB" ]; then
    echo "  Snapshotting Uptime Kuma database ($KUMA_DB)..."
    python3 - "$KUMA_DB" "$WORK/kuma.db" << 'PYBACKUP'
import sys, sqlite3
src_path, dst_path = sys.argv[1], sys.argv[2]
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dst = sqlite3.connect(dst_path)
src.backup(dst)
dst.close()
src.close()
PYBACKUP
else
    echo "  Notice: kuma.db not found at $KUMA_DB, skipping."
fi

# 2. Snapshot Pi Hub DB & Project Files
STEP="snapshotting Pi Hub"
HUB_DB="/var/lib/pi-hub/hub.db"
if [ -f "$HUB_DB" ]; then
    echo "  Snapshotting Pi Hub database ($HUB_DB)..."
    python3 - "$HUB_DB" "$WORK/hub.db" << 'PYBACKUP'
import sys, sqlite3
src_path, dst_path = sys.argv[1], sys.argv[2]
src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
dst = sqlite3.connect(dst_path)
src.backup(dst)
dst.close()
src.close()
PYBACKUP
else
    echo "  Notice: hub.db not found at $HUB_DB, skipping."
fi

if [ -d "/var/lib/pi-hub/project-files" ]; then
    echo "  Archiving Pi Hub project board files..."
    mkdir -p "$WORK/project-files"
    cp -r /var/lib/pi-hub/project-files/* "$WORK/project-files/" 2>/dev/null || true
fi

if [ -d "/var/lib/pi-hub/prints" ]; then
    echo "  Archiving completed 3D print photos..."
    mkdir -p "$WORK/prints"
    cp -r /var/lib/pi-hub/prints/* "$WORK/prints/" 2>/dev/null || true
fi

# 3. Archive Netmon configuration, systemd units, and environment
STEP="copying configuration"
mkdir -p "$WORK/config"
if [ -d "/opt/netmon" ]; then
    mkdir -p "$WORK/config/netmon"
    cp -r /opt/netmon/docker-compose.yml "$WORK/config/netmon/" 2>/dev/null || true
    for dir in prometheus grafana scripts inventory systemd; do
        if [ -d "/opt/netmon/$dir" ]; then
            cp -r "/opt/netmon/$dir" "$WORK/config/netmon/"
        fi
    done
fi

mkdir -p "$WORK/config/systemd"
cp -r /etc/systemd/system/netmon* /etc/systemd/system/orbi* /etc/systemd/system/iperf3* /etc/systemd/system/pi-hub* "$WORK/config/systemd/" 2>/dev/null || true

if [ -f "/etc/fstab" ]; then
    cp /etc/fstab "$WORK/config/fstab"
fi

if [ -d "/etc/pi-hub" ]; then
    mkdir -p "$WORK/config/pi-hub"
    # Not the secrets (Plex token, setup code, app passwords): this archive goes to a Windows share. They are in the
    # encrypted Backrest backups instead.
    (cd /etc/pi-hub && find . -path ./secrets -prune -o -type f -print | cpio -pdm "$WORK/config/pi-hub" 2>/dev/null) || true
fi

# 4. Create compressed tarball & verify integrity
STEP="compressing and checking the archive"
echo "  Compressing into $ARCHIVE..."
tar -czf "$WORK/$ARCHIVE" -C "$WORK" $(ls "$WORK" | grep -v "\.tar\.gz$")
SIZE=$(du -h "$WORK/$ARCHIVE" | cut -f1)
echo "  Archive created ($SIZE). Verifying integrity..."
tar -tzf "$WORK/$ARCHIVE" >/dev/null
echo "  Integrity check passed."

# Pruning function (keeps newest 14 archives, never deletes if under threshold)
prune_backups() {
    local target_dir="$1"
    local keep=14
    if [ -d "$target_dir" ]; then
        local total
        total=$(ls -1t "$target_dir"/netmon-backup-*.tar.gz 2>/dev/null | wc -l)
        if [ "$total" -gt "$keep" ]; then
            echo "  Pruning old archives in $target_dir (total: $total, keeping: $keep)..."
            ls -1t "$target_dir"/netmon-backup-*.tar.gz | tail -n +"$((keep + 1))" | while read -r old_file; do
                echo "    Pruned: $(basename "$old_file")"
                rm -f "$old_file"
            done
        else
            echo "  Retention OK in $target_dir ($total of max $keep retained)."
        fi
    fi
}

# 5. Store locally on SSD (/mnt/usb1/netmon/backups); the work folder is on the same disk, so this is a rename
STEP="saving on the SSD"
mv "$WORK/$ARCHIVE" "$LOCAL_DIR/$ARCHIVE"
chmod 600 "$LOCAL_DIR/$ARCHIVE"
prune_backups "$LOCAL_DIR"
LOCAL_COUNT=$(ls -1t "$LOCAL_DIR"/netmon-backup-*.tar.gz 2>/dev/null | wc -l)
echo "  Saved locally: $LOCAL_DIR/$ARCHIVE"

# 6. Synchronize off-Pi to Windows share
STEP="copying to the Windows share"
OFF_PI_COUNT=0
if [ -d "$WINDOWS_DIR" ] && [ -w "$WINDOWS_DIR" ]; then
    echo "  Synchronizing off-Pi to Windows share ($WINDOWS_DIR)..."
    cp "$LOCAL_DIR/$ARCHIVE" "$WINDOWS_DIR/$ARCHIVE"
    chmod 600 "$WINDOWS_DIR/$ARCHIVE" 2>/dev/null || true
    prune_backups "$WINDOWS_DIR"
    OFF_PI_COUNT=$(ls -1t "$WINDOWS_DIR"/netmon-backup-*.tar.gz 2>/dev/null | wc -l)
    echo "  Off-Pi sync verified: $WINDOWS_DIR/$ARCHIVE"
else
    echo "  WARNING: Windows share directory $WINDOWS_DIR is not writable or unmounted." >&2
    STEP="copying to the Windows share (it isn't mounted or writable; today's archive is on the SSD)"
    exit 1
fi

# 7. Record health record for Pi Hub and Local AI
record "success" "Saved on the SSD and the Windows share."

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete and validated!"
