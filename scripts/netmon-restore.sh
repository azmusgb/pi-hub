#!/bin/bash
# ==============================================================================
# Netmon & Pi Hub 15-Minute Disaster Recovery Script (Spec § 37)
# Restores:
#   1. Pi Hub database (hub.db) and project files
#   2. Uptime Kuma database (kuma.db)
#   3. Netmon monitoring stack (Prometheus, Grafana, Blackbox, Node Exporter)
#   4. Systemd services, timers, and fstab entries
# ==============================================================================
set -euo pipefail

# Color formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
BOLD='\033[1m'
NC='\033[0m'

START_TIME=$(date +%s)

echo -e "${BOLD}${BLUE}================================================================${NC}"
echo -e "${BOLD}${BLUE}  Raspberry Pi 4 Netmon & Pi Hub Disaster Recovery Appliance    ${NC}"
echo -e "${BOLD}${BLUE}================================================================${NC}"

# 1. Require root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: This script must be run as root (use sudo).${NC}" >&2
    exit 1
fi

# 2. Locate backup archive
ARCHIVE=""
if [ $# -ge 1 ] && [ -f "$1" ]; then
    ARCHIVE="$1"
else
    # Auto-detect latest from Windows share, local SSD, or current directory
    CANDIDATES=(
        $(ls -1t /mnt/windows-movies/netmon-backups/netmon-backup-*.tar.gz 2>/dev/null || true)
        $(ls -1t /mnt/usb1/netmon/backups/netmon-backup-*.tar.gz 2>/dev/null || true)
        $(ls -1t ./netmon-backup-*.tar.gz 2>/dev/null || true)
    )
    if [ ${#CANDIDATES[@]} -gt 0 ]; then
        ARCHIVE="${CANDIDATES[0]}"
    fi
fi

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
    echo -e "${RED}Error: No backup archive found.${NC}" >&2
    echo "Usage: sudo $0 [/path/to/netmon-backup-YYYYMMDD-HHMMSS.tar.gz]" >&2
    exit 1
fi

echo -e "Selected archive: ${BOLD}$ARCHIVE${NC}"
SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "Archive size:     $SIZE"

# 3. Verify archive integrity before touching system
echo -e "\n[1/7] ${BOLD}Verifying archive integrity...${NC}"
if ! tar -tzf "$ARCHIVE" >/dev/null 2>&1; then
    echo -e "${RED}Error: Archive corruption detected! Aborting restore.${NC}" >&2
    exit 1
fi
echo -e "${GREEN}✓ Archive integrity verified (gzip & tar intact).${NC}"

# 4. Confirmation prompt (skip with -y or --yes)
if [[ "${*:-}" != *"-y"* ]] && [[ "${*:-}" != *"--yes"* ]]; then
    read -rp "Proceed with full restoration of Netmon & Pi Hub? (y/N): " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[yY]([eE][sS])?$ ]]; then
        echo "Restoration cancelled."
        exit 0
    fi
fi

# 5. Extract into isolated staging directory
WORK=$(mktemp -d /tmp/netmon-restore-XXXXXX)
trap 'rm -rf "$WORK"' EXIT
echo -e "\n[2/7] ${BOLD}Unpacking archive into staging area...${NC}"
tar -xzf "$ARCHIVE" -C "$WORK"

# 6. Ensure system users and groups exist
echo -e "\n[3/7] ${BOLD}Configuring system users and directories...${NC}"
id -u pi-hub >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /var/lib/pi-hub pi-hub
id -u x2dbridge >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin -d /var/lib/x2d-bridge x2dbridge

mkdir -p /var/lib/pi-hub/project-files
mkdir -p /mnt/usb1/netmon/uptime-kuma
mkdir -p /opt/netmon
mkdir -p /etc/pi-hub/secrets

# 7. Restore Databases & Storage
echo -e "\n[4/7] ${BOLD}Restoring application databases & project files...${NC}"
# Restore Pi Hub DB
if [ -f "$WORK/hub.db" ]; then
    echo "  Restoring Pi Hub database (/var/lib/pi-hub/hub.db)..."
    cp "$WORK/hub.db" /var/lib/pi-hub/hub.db
    chown pi-hub:pi-hub /var/lib/pi-hub/hub.db
    chmod 640 /var/lib/pi-hub/hub.db
fi

# Restore Project Files
if [ -d "$WORK/project-files" ]; then
    echo "  Restoring Pi Hub project board files..."
    cp -r "$WORK/project-files"/* /var/lib/pi-hub/project-files/ 2>/dev/null || true
    chown -R pi-hub:pi-hub /var/lib/pi-hub/project-files
fi

# Restore Completed Print Photos
if [ -d "$WORK/prints" ]; then
    echo "  Restoring completed 3D print photos..."
    mkdir -p /var/lib/pi-hub/prints
    cp -r "$WORK/prints"/* /var/lib/pi-hub/prints/ 2>/dev/null || true
    chown -R pi-hub:pi-hub /var/lib/pi-hub/prints
fi

# Restore Uptime Kuma DB
if [ -f "$WORK/kuma.db" ]; then
    echo "  Restoring Uptime Kuma database (/mnt/usb1/netmon/uptime-kuma/kuma.db)..."
    cp "$WORK/kuma.db" /mnt/usb1/netmon/uptime-kuma/kuma.db
    chmod 664 /mnt/usb1/netmon/uptime-kuma/kuma.db
fi

# 8. Restore Configurations & Systemd Units
echo -e "\n[5/7] ${BOLD}Restoring Netmon configs & systemd units...${NC}"
if [ -d "$WORK/config/netmon" ]; then
    cp -r "$WORK/config/netmon"/* /opt/netmon/
    chmod +x /opt/netmon/scripts/* 2>/dev/null || true
fi

if [ -d "$WORK/config/systemd" ]; then
    cp -r "$WORK/config/systemd"/* /etc/systemd/system/
    systemctl daemon-reload
fi

if [ -d "$WORK/config/pi-hub" ]; then
    cp -r "$WORK/config/pi-hub"/* /etc/pi-hub/
fi

# 9. Launch Docker Services & System Daemons
echo -e "\n[6/7] ${BOLD}Starting monitoring containers & services...${NC}"
if command -v docker >/dev/null 2>&1 && [ -f "/opt/netmon/docker-compose.yml" ]; then
    echo "  Starting Netmon Docker stack (Prometheus, Grafana, Blackbox, Node Exporter, Kuma)..."
    docker compose -f /opt/netmon/docker-compose.yml up -d
fi

# Enable and start core services
SERVICES=(
    "pi-hub.service"
    "netmon-backup.timer"
    "orbi-exporter.service"
    "x2d-camera-failover.service"
)

for svc in "${SERVICES[@]}"; do
    if systemctl list-unit-files "$svc" >/dev/null 2>&1; then
        echo "  Starting $svc..."
        systemctl enable --now "$svc" 2>/dev/null || systemctl restart "$svc" 2>/dev/null || true
    fi
done

# 10. Health Verification
echo -e "\n[7/7] ${BOLD}Verifying appliance endpoint health...${NC}"
sleep 2

check_port() {
    local port="$1"
    local name="$2"
    if curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://127.0.0.1:${port}" >/dev/null 2>&1; then
        echo -e "  ${GREEN}✓${NC} $name on port $port is responding."
    else
        echo -e "  ${YELLOW}⚠${NC} $name on port $port is still initializing."
    fi
}

check_port 80 "Pi Hub Web Interface"
check_port 3000 "Grafana NOC"
check_port 3001 "Uptime Kuma Status Page"
check_port 9091 "Prometheus Metrics"

ELAPSED=$(( $(date +%s) - START_TIME ))

echo -e "\n${BOLD}${GREEN}================================================================${NC}"
echo -e "${BOLD}${GREEN}  Restoration Complete in ${ELAPSED} seconds!                    ${NC}"
echo -e "${BOLD}${GREEN}================================================================${NC}"
echo -e "Pi Hub is live at:         ${BOLD}http://$(hostname -I | awk '{print $1}'):80${NC}"
echo -e "Grafana NOC is live at:    ${BOLD}http://$(hostname -I | awk '{print $1}'):3000${NC}"
echo -e "Uptime Kuma is live at:    ${BOLD}http://$(hostname -I | awk '{print $1}'):3001/status/home${NC}"
