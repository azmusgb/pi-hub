#!/bin/bash
# Ships Pi Hub to the Pi. Run from the Mac: deploy/install.sh
#
# The first run sets up what a release needs (the hub's user, secrets folder, setup code, packages,
# the git repo on the Pi and its hook). Every run then pushes main to the Pi, where the hook tests
# the new version, switches to it, checks every page and API, and goes back if anything fails.
set -euo pipefail
cd "$(dirname "$0")/.."
quiet() { grep -v "post-quantum\|store now\|openssh.com/pq\|server may need" || true; }

[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first; only committed work ships."; exit 1; }

scp -q deploy/pi-hub-release pi:/tmp/pi-hub-release 2>&1 | quiet
ssh -o BatchMode=yes pi 'bash -s' <<'EOF' 2>&1 | quiet
set -euo pipefail
id pi-hub >/dev/null 2>&1 || sudo useradd --system --no-create-home --shell /usr/sbin/nologin pi-hub
sudo mkdir -p /opt/pi-hub/releases /etc/pi-hub/secrets
sudo install -d -m 755 /usr/local/lib/pi-hub
# Bootstrap once. Thereafter invoke the incoming runner without replacing the old
# installed runner until its transaction has snapshotted it.
if [ ! -x /usr/local/lib/pi-hub/pi-hub-release ]; then
  sudo install -m 755 /tmp/pi-hub-release /usr/local/lib/pi-hub/pi-hub-release
fi
sudo install -m 755 /tmp/pi-hub-release /usr/local/lib/pi-hub/pi-hub-release-incoming.new
sudo mv -f /usr/local/lib/pi-hub/pi-hub-release-incoming.new /usr/local/lib/pi-hub/pi-hub-release-incoming
rm -f /tmp/pi-hub-release

# Plex key: readable by the hub only.
if [ -s /opt/homepage/secrets/plex_token ] && [ ! -s /etc/pi-hub/secrets/plex_token ]; then
  sudo install -m 640 -o root -g pi-hub /opt/homepage/secrets/plex_token /etc/pi-hub/secrets/plex_token
fi
sudo chown root:pi-hub /etc/pi-hub/secrets && sudo chmod 750 /etc/pi-hub/secrets

# One-time setup code for the hub's Settings page.
if [ ! -s /etc/pi-hub/setup-code ]; then
  python3 -c "import secrets; a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c=''.join(secrets.choice(a) for _ in range(8)); print(c[:4] + '-' + c[4:])" \
    | sudo tee /etc/pi-hub/setup-code >/dev/null
fi
sudo chown root:pi-hub /etc/pi-hub/setup-code && sudo chmod 640 /etc/pi-hub/setup-code

# What the hub, its tests and its helpers need.
need=""
for p in librsvg2-bin rsync smartmontools parted python3-qrcode python3-icalendar python3-recurring-ical-events \
         python3-pytest python3-httpx git nodejs; do dpkg -s "$p" >/dev/null 2>&1 || need="$need $p"; done
[ -z "$need" ] || sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $need >/dev/null
sudo mkdir -p /var/lib/pi-status && sudo touch /var/lib/pi-status/alerts.jsonl && sudo chmod 644 /var/lib/pi-status/alerts.jsonl

# The repo the Mac pushes to; its hook hands each push of main to pi-hub-release.
if [ ! -d /srv/pi-hub.git ]; then
  sudo install -d -o bjrmc -g bjrmc /srv/pi-hub.git
  git init -q --bare -b main /srv/pi-hub.git
fi
cat > /srv/pi-hub.git/hooks/post-receive <<'HOOK'
#!/bin/sh
while read old new ref; do
  [ "$ref" = refs/heads/main ] && sudo /usr/local/lib/pi-hub/pi-hub-release-incoming "$new"
done
HOOK
chmod 755 /srv/pi-hub.git/hooks/post-receive
EOF

git remote get-url pi >/dev/null 2>&1 || git remote add pi pi:/srv/pi-hub.git
git push pi main 2>&1 | grep -E "pi-hub:|failed:|^ !|rejected|Everything up-to-date" | sed 's/^remote: //'

# post-receive failures do not reject a git push; verify the actual running SHA.
EXPECTED=$(git rev-parse main)
ssh -o BatchMode=yes pi bash -s -- "$EXPECTED" <<'EOF' 2>&1 | quiet
set -euo pipefail
expected="${1:0:10}"
running=$(basename "$(readlink -f /opt/pi-hub/current)")
echo "running: $running"
[ "$running" = "$expected" ] || { echo "Release did not become live; inspect Settings → Versions."; exit 1; }
sudo systemctl enable pi-hub pi-hub-helper x2d-camera-failover >/dev/null 2>&1
sudo systemctl enable --now pi-hub-backup.timer pi-hub-selfcheck.timer >/dev/null 2>&1
EOF
