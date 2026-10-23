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

# 2. Snapshot Pi Hub DB
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
    cp -r /etc/pi-hub/* "$WORK/config/pi-hub/" 2>/dev/null || true
fi

# 4. Create compressed tarball
echo "  Compressing into $ARCHIVE..."
tar -czf "$WORK/$ARCHIVE" -C "$WORK" $(ls "$WORK" | grep -v "\.tar\.gz$")
SIZE=$(du -h "$WORK/$ARCHIVE" | cut -f1)
echo "  Archive created ($SIZE)."

# 5. Store locally on SSD (/mnt/usb1/netmon/backups)
mkdir -p "$LOCAL_DIR"
cp "$WORK/$ARCHIVE" "$LOCAL_DIR/$ARCHIVE"
chmod 644 "$LOCAL_DIR/$ARCHIVE"
# Retain last 14 backups locally
ls -1t "$LOCAL_DIR"/netmon-backup-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "  Saved locally: $LOCAL_DIR/$ARCHIVE"

# 6. Synchronize off-Pi to Windows share
if [ -d "$WINDOWS_DIR" ] && [ -w "$WINDOWS_DIR" ]; then
    echo "  Synchronizing off-Pi to Windows share ($WINDOWS_DIR)..."
    cp "$WORK/$ARCHIVE" "$WINDOWS_DIR/$ARCHIVE"
    # Retain last 14 backups on Windows share
    ls -1t "$WINDOWS_DIR"/netmon-backup-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
    echo "  Off-Pi sync verified: $WINDOWS_DIR/$ARCHIVE"
else
    echo "  WARNING: Windows share directory $WINDOWS_DIR is not writable or unmounted." >&2
    exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete!"
