#!/bin/bash
set -euo pipefail

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
sudo mkdir -p /mnt/usb1/netmon/{prometheus,grafana,uptime-kuma}
sudo chown -R 65534:65534 /mnt/usb1/netmon/prometheus
sudo chown -R 472:472 /mnt/usb1/netmon/grafana

echo "Starting Docker Compose stack..."
cd /opt/netmon
sudo docker-compose pull
sudo docker-compose up -d --remove-orphans

echo "NETMON stack started successfully!"
EOF

echo "Deployment complete!"
