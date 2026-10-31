#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

PI_HOST="${1:-pi}"

echo "Deploying NETMON stack to $PI_HOST..."

rsync -avz --exclude='.git' ./ "$PI_HOST:/tmp/netmon/"

ssh "$PI_HOST" 'bash -s' << 'EOF'
set -euo pipefail

echo "Copying files to /opt/netmon..."
sudo mkdir -p /opt/netmon
sudo cp -r /tmp/netmon/* /opt/netmon/
sudo rm -rf /tmp/netmon

# One home, step 6: once the Pi is locked (pi-lock.py apply ran), the files just copied are unlocked again. Lock them
# before anything starts, and again as the last step (below), so no restart in between runs an unlocked file.
relock() { if [ -d /var/backups/pi-lock ]; then sudo python3 /opt/pi-hub/current/deploy/pi-lock.py apply; fi; }
relock


echo "Installing CLI diagnostic shortcuts to /usr/local/bin..."
sudo install -m 755 /opt/netmon/scripts/* /usr/local/bin/

echo "Ensuring persistent storage directories on SSD (/mnt/usb1/netmon)..."
sudo mkdir -p /mnt/usb1/netmon/{prometheus,grafana,uptime-kuma,backups}
sudo chown -R 65534:65534 /mnt/usb1/netmon/prometheus
sudo chown -R 472:472 /mnt/usb1/netmon/grafana

echo "Configuring systemd services and timers..."
sudo cp /opt/netmon/systemd/* /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable netmon.service orbi-exporter.service iperf3.service netmon-backup.timer
sudo systemctl restart orbi-exporter.service iperf3.service netmon-backup.timer
# The timer runs the backup; the old cron.daily link made it run twice a night.
sudo rm -f /etc/cron.daily/netmon-backup

echo "Starting Docker Compose stack..."
cd /opt/netmon
# Grafana's first-start admin password comes from the Pi's secret, never the placeholder in docker-compose.yml.
# It is read inside a root shell, so it never appears on a command line (ps shows sudo's arguments).
sudo bash -c '
  GF_ADMIN_PASSWORD="$(cat /etc/pi-hub/secrets/grafana_admin 2>/dev/null || true)"
  if [ -z "$GF_ADMIN_PASSWORD" ] && [ ! -e /mnt/usb1/netmon/grafana/grafana.db ]; then
    echo "Refusing to create Grafana with the placeholder password: save it in /etc/pi-hub/secrets/grafana_admin first." >&2
    exit 1
  fi
  export GF_ADMIN_PASSWORD
  docker-compose up -d --remove-orphans
'

# The lock again, last: pi-lock brings Grafana, Kuma, the exporters and the Orbi exporter up on 127.0.0.1.
relock

echo "Reloading Prometheus..."
curl -s -X POST http://localhost:9091/-/reload || true

echo "NETMON stack started successfully!"
EOF

echo "Deployment complete!"
