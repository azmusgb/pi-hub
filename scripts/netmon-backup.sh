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

LOCAL_DIR="/mnt/usb1/netmon/backups"
WINDOWS_DIR="/mnt/windows-movies/netmon-backups"
STAMP=$(date +%Y%m%d-%H%M%S)
ARCHIVE="netmon-backup-${STAMP}.tar.gz"
WORK=$(mktemp -d /tmp/netmon-backup-XXXXXX)
trap 'rm -rf "$WORK"' EXIT

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting automated backup..."

# 1. Snapshot Uptime Kuma DB
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

# 5. Store locally on SSD (/mnt/usb1/netmon/backups)
mkdir -p "$LOCAL_DIR"
cp "$WORK/$ARCHIVE" "$LOCAL_DIR/$ARCHIVE"
chmod 600 "$LOCAL_DIR/$ARCHIVE"
prune_backups "$LOCAL_DIR"
LOCAL_COUNT=$(ls -1t "$LOCAL_DIR"/netmon-backup-*.tar.gz 2>/dev/null | wc -l)
echo "  Saved locally: $LOCAL_DIR/$ARCHIVE"

# 6. Synchronize off-Pi to Windows share
OFF_PI_COUNT=0
if [ -d "$WINDOWS_DIR" ] && [ -w "$WINDOWS_DIR" ]; then
    echo "  Synchronizing off-Pi to Windows share ($WINDOWS_DIR)..."
    cp "$WORK/$ARCHIVE" "$WINDOWS_DIR/$ARCHIVE"
    chmod 600 "$WINDOWS_DIR/$ARCHIVE" 2>/dev/null || true
    prune_backups "$WINDOWS_DIR"
    OFF_PI_COUNT=$(ls -1t "$WINDOWS_DIR"/netmon-backup-*.tar.gz 2>/dev/null | wc -l)
    echo "  Off-Pi sync verified: $WINDOWS_DIR/$ARCHIVE"
else
    echo "  WARNING: Windows share directory $WINDOWS_DIR is not writable or unmounted." >&2
    if [ -f "/etc/pi-status/ntfy_topic" ]; then
        TOPIC=$(cat /etc/pi-status/ntfy_topic | tr -d '[:space:]')
        curl -s -d "Automated backup could not sync to Windows share //10.0.0.21/Movies/netmon-backups. Check network share mount." \
             -H "Title: Netmon Backup Warning" -H "Priority: high" -H "Tags: warning" \
             "https://ntfy.sh/$TOPIC" >/dev/null 2>&1 || true
    fi
    exit 1
fi

# 7. Record health record for Pi Hub and Local AI
STATUS_JSON=$(cat <<JSON
{
  "timestamp": $(date +%s),
  "time_human": "$(date '+%a %-I:%M %p')",
  "archive": "$ARCHIVE",
  "size": "$SIZE",
  "status": "success",
  "local_count": $LOCAL_COUNT,
  "off_pi_count": $OFF_PI_COUNT
}
JSON
)
mkdir -p /var/lib/pi-hub
echo "$STATUS_JSON" > /var/lib/pi-hub/last_backup.json 2>/dev/null || true
echo "$STATUS_JSON" > "$LOCAL_DIR/latest.json" 2>/dev/null || true

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete and validated!"
