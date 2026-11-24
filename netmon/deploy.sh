#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

PI_HOST="${1:-pi}"
# release:netmon (platform step 3): the commit this tree is at, and whether it has uncommitted changes. rsync copies the
# working tree, not a commit, so a dirty deploy says so.
COMMIT=$(git rev-parse HEAD 2>/dev/null || true)
DIRTY=0
[ -z "$(git status --porcelain -- . 2>/dev/null)" ] || DIRTY=1

echo "Deploying NETMON stack to $PI_HOST..."

rsync -avz --exclude='.git' ./ "$PI_HOST:/tmp/netmon/"

# shellcheck disable=SC2029 # meant: the Mac's commit goes to the Pi as arguments (a hex sha and 0/1)
ssh "$PI_HOST" "bash -s -- '$COMMIT' '$DIRTY'" << 'EOF'
set -euo pipefail
commit="$1" dirty="$2" step="copying files"
# Every deploy reports to Pi Hub: deployed at the end, or failed with the step it stopped at. A report that can't be
# written doesn't change the deploy's outcome.
report() { sudo bash /opt/netmon/release-report.sh "$@" || echo "Couldn't write the release report."; }
trap 'rc=$?; if [ "$rc" -ne 0 ] && [ -f /opt/netmon/release-report.sh ]; then report failed "$commit" "$dirty" "Failed while $step"; fi' EXIT

echo "Copying files to /opt/netmon..."
sudo mkdir -p /opt/netmon
sudo cp -r /tmp/netmon/* /opt/netmon/
sudo rm -rf /tmp/netmon

step="preparing Grafana's admin password"
# Grafana's first-start admin password goes into a root-only env file from the Pi's secret, never a placeholder or a
# command line. Every compose `up` (pi-lock's just below, this script's and the boot unit's) reads the same file,
# so it must exist first.
sudo bash -c '
  set -e
  secret=/etc/pi-hub/secrets/grafana_admin env=/etc/pi-hub/secrets/grafana_admin.env
  if [ -s "$secret" ]; then
    umask 077
    printf "GF_SECURITY_ADMIN_PASSWORD=%s\n" "$(tr -d "\r\n" < "$secret")" > "$env.tmp" && mv "$env.tmp" "$env"
  elif [ -e /mnt/usb1/netmon/grafana/grafana.db ]; then
    [ -e "$env" ] || install -m 600 /dev/null "$env"  # an existing Grafana keeps its own password
  else
    echo "Refusing to create Grafana without an admin password: save it in $secret first." >&2
    exit 1
  fi
'

# One home, step 6: once the Pi is locked (pi-lock.py apply ran), the files just copied are unlocked again. Lock them
# before anything starts, and again as the last step (below), so no restart in between runs an unlocked file.
relock() { if [ -d /var/backups/pi-lock ]; then sudo python3 /opt/pi-hub/current/deploy/pi-lock.py apply; fi; }
relock


step="installing the scripts and services"
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

step="starting the Docker Compose stack"
echo "Starting Docker Compose stack..."
cd /opt/netmon
sudo docker-compose up -d --remove-orphans

# The lock again, last: pi-lock brings Grafana, Kuma, the exporters and the Orbi exporter up on 127.0.0.1.
relock

step="reloading Prometheus"
echo "Reloading Prometheus..."
# A Prometheus that compose just recreated takes a moment to answer; a reload that then fails is a failed deploy.
for _ in $(seq 1 30); do curl -fs -o /dev/null http://localhost:9091/-/ready && break; sleep 1; done
curl -fsS -X POST http://localhost:9091/-/reload >/dev/null

echo "NETMON stack started successfully!"
report deployed "$commit" "$dirty"
EOF

echo "Deployment complete!"
