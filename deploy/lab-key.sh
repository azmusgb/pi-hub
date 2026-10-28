#!/bin/bash
# Makes the Print lab's Mac key. Run as root on the Pi: sudo bash /opt/pi-hub/current/deploy/lab-key.sh
# Only the key's SHA-256 is stored (lab_mac_key.sha256); the key itself is printed once. --rotate replaces an existing one.
set -euo pipefail
FILE=${LAB_KEY_HASH_FILE:-/etc/pi-hub/secrets/lab_mac_key.sha256}
ROTATE=0
[ "${1:-}" = "--rotate" ] && ROTATE=1
if [ "$(id -u)" != 0 ] && [ -z "${LAB_KEY_ALLOW_NON_ROOT:-}" ]; then
  echo "Run as root: sudo bash $0" >&2; exit 1
fi
if [ -e "$FILE" ] && [ "$ROTATE" != 1 ]; then
  echo "$FILE already exists. Run with --rotate to replace it (the Mac's key must then be replaced too)." >&2
  exit 1
fi
KEY=$(python3 -c 'import secrets; print(secrets.token_hex(32))')
DIR=$(dirname "$FILE")
mkdir -p "$DIR"
if [ -z "${LAB_KEY_SKIP_CHOWN:-}" ]; then chown root:pi-hub "$DIR" && chmod 750 "$DIR"; fi
TMP=$(umask 077; mktemp "$DIR/.lab_key.XXXXXX")
printf '%s' "$KEY" | python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.read().encode()).hexdigest())' > "$TMP"
chmod 640 "$TMP"
if [ -z "${LAB_KEY_SKIP_CHOWN:-}" ]; then chown root:pi-hub "$TMP"; fi
mv -f "$TMP" "$FILE"
echo "Hub lab key (shown once, not stored on the Pi):"
echo "KEY: $KEY"
echo "Save it on the Mac at ~/.config/print-lab/hub.key with mode 0600 (chmod 0600 ~/.config/print-lab/hub.key)."
