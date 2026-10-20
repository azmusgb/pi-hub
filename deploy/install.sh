#!/bin/bash
# Installs or updates Pi Hub on the Pi. Run from the Mac: deploy/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."
quiet() { grep -v "post-quantum\|store now\|openssh.com/pq\|server may need" || true; }

COPYFILE_DISABLE=1 tar --no-xattrs --exclude __pycache__ -czf /tmp/pi-hub.tgz hub deploy
scp -q /tmp/pi-hub.tgz pi:/tmp/pi-hub.tgz 2>&1 | quiet
ssh -o BatchMode=yes pi 'bash -s' <<'EOF' 2>&1 | quiet
set -euo pipefail
id pi-hub >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin pi-hub
sudo mkdir -p /opt/pi-hub /etc/pi-hub/secrets
sudo tar -xzf /tmp/pi-hub.tgz -C /opt/pi-hub
sudo find /opt/pi-hub -name __pycache__ -prune -exec rm -rf {} +
sudo chown -R root:root /opt/pi-hub

# Plex key: readable by the hub only.
if [ -s /opt/homepage/secrets/plex_token ] && [ ! -s /etc/pi-hub/secrets/plex_token ]; then
  sudo install -m 640 -o root -g pi-hub /opt/homepage/secrets/plex_token /etc/pi-hub/secrets/plex_token
fi
sudo chown root:pi-hub /etc/pi-hub/secrets && sudo chmod 750 /etc/pi-hub/secrets

# Phone icons
command -v rsvg-convert >/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq librsvg2-bin >/dev/null
for s in 180 192 512; do
  sudo rsvg-convert -w $s -h $s /opt/pi-hub/hub/static/icon.svg -o /opt/pi-hub/hub/static/icon-$s.png
done

# The status and alerts service the hub reads from.
if ! cmp -s /opt/pi-hub/deploy/pi-status.py /usr/local/bin/pi-status.py; then
  sudo install -m 755 /opt/pi-hub/deploy/pi-status.py /usr/local/bin/pi-status.py
  sudo systemctl restart pi-status
fi
sudo mkdir -p /var/lib/pi-status && sudo touch /var/lib/pi-status/alerts.jsonl && sudo chmod 644 /var/lib/pi-status/alerts.jsonl

python3 -c "import qrcode" 2>/dev/null || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq python3-qrcode >/dev/null

# The helper (fixed list of admin actions) and the nightly backup.
sudo install -d -m 755 /usr/local/lib/pi-hub
sudo install -m 755 /opt/pi-hub/deploy/pi-hub-helper.py /opt/pi-hub/deploy/pi-hub-backup.sh /usr/local/lib/pi-hub/
for u in pi-hub.service pi-hub-helper.service pi-hub-backup.service pi-hub-backup.timer; do
  sudo install -m 644 /opt/pi-hub/deploy/$u /etc/systemd/system/$u
done

# One-time setup code for the hub's Settings page.
if [ ! -s /etc/pi-hub/setup-code ]; then
  python3 -c "import secrets; a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c=''.join(secrets.choice(a) for _ in range(8)); print(c[:4] + '-' + c[4:])" \
    | sudo tee /etc/pi-hub/setup-code >/dev/null
fi
sudo chown root:pi-hub /etc/pi-hub/setup-code && sudo chmod 640 /etc/pi-hub/setup-code

sudo systemctl daemon-reload
sudo systemctl enable pi-hub >/dev/null 2>&1
sudo systemctl enable --now pi-hub-backup.timer >/dev/null 2>&1
sudo systemctl enable pi-hub-helper >/dev/null 2>&1
sudo systemctl restart pi-hub-helper
sudo systemctl restart pi-hub
for i in $(seq 1 20); do curl -fs -o /dev/null http://127.0.0.1/healthz && break; sleep 1; done
systemctl is-active pi-hub
curl -s http://127.0.0.1/api/now | python3 -c "import json,sys; d=json.load(sys.stdin); print('summary:', d['summary'], '| printer:', d['printer']['headline'], '| playing:', d['movies']['playing'])"
EOF
