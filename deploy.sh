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
sudo docker-compose up -d --remove-orphans

echo "Reloading Prometheus..."
curl -s -X POST http://localhost:9091/-/reload || true

echo "NETMON stack started successfully!"
EOF

echo "Deployment complete!"
