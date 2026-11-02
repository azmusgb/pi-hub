#!/bin/bash
# Makes a deploy key for a deploy off the Pi (platform step 3) and puts it where it is used, without ever showing it:
#   deploy/deploy-key.sh localai   # the PC's Safe Deploy reads C:\LocalAI\stack\pi-hub-deploy.key
#   deploy/deploy-key.sh mac       # the Mac's agents read the login Keychain, service pi-hub-deploy-key
# Run from the Mac. Add --rotate to replace a key that exists. The key lives only in this shell's memory and reaches the
# PC and the Keychain on stdin: never in output, process arguments or logs. The Pi keeps only its SHA-256, readable by
# the hub (root:pi-hub 0640), in /etc/pi-hub/secrets/deploy_keys/<name>.sha256.
set -euo pipefail
NAME="${1:-}"
ROTATE=0
[ "${2:-}" = "--rotate" ] && ROTATE=1
PI=${DEPLOY_KEY_PI:-pi}
PC=${DEPLOY_KEY_PC:-windows}
DIR=/etc/pi-hub/secrets/deploy_keys
PC_FILE='C:\LocalAI\stack\pi-hub-deploy.key'
case "$NAME" in
  localai|mac) ;;
  *) echo "Usage: $0 localai|mac [--rotate]" >&2; exit 2 ;;
esac

rc=0
ssh -n "$PI" "sudo test -e $DIR/$NAME.sha256" || rc=$?
if [ "$rc" = 0 ] && [ "$ROTATE" != 1 ]; then
  echo "The $NAME deploy key already exists. Run with --rotate to replace it." >&2; exit 1
elif [ "$rc" != 0 ] && [ "$rc" != 1 ]; then
  echo "Couldn't reach the Pi ($PI) to check for an existing key." >&2; exit 1
fi

KEY=$(openssl rand -hex 32)
HASH=$(printf '%s' "$KEY" | shasum -a 256 | cut -d' ' -f1)
[ ${#KEY} = 64 ] && [ ${#HASH} = 64 ] || { echo "Couldn't make a key." >&2; exit 1; }

# 1. The key where it is used. A failure here stops before the Pi expects a key nobody has.
if [ "$NAME" = localai ]; then
  # The script carries no secret; it reads the key from stdin and leaves the file readable by the task's account only.
  PS=$(cat <<PSEOF
\$ErrorActionPreference = 'Stop'
\$k = [Console]::In.ReadToEnd()
if (\$k -notmatch '^[0-9a-f]{64}\$') { throw 'No key arrived on stdin.' }
\$p = '$PC_FILE'
\$t = "\$p.new"
[IO.File]::WriteAllText(\$t, \$k)
icacls \$t /inheritance:r /grant:r "\${env:USERNAME}:R" 'SYSTEM:F' 'Administrators:F' | Out-Null
if (Test-Path \$p) { Remove-Item -Force \$p }
Move-Item -Force \$t \$p
'placed'
PSEOF
)
  ENC=$(printf '%s' "$PS" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')
  printf '%s' "$KEY" | ssh "$PC" "powershell -NoProfile -NonInteractive -EncodedCommand $ENC" | grep -q placed ||
    { echo "Couldn't place the key on the PC ($PC)." >&2; exit 1; }
  WHERE="on the PC at $PC_FILE"
else
  # security's interactive mode reads its command from stdin, so the key is never one of its arguments.
  printf 'add-generic-password -U -a pi-hub -s pi-hub-deploy-key -w %s\n' "$KEY" | security -i >/dev/null ||
    { echo "Couldn't save the key in the Keychain." >&2; exit 1; }
  WHERE="in this Mac's login Keychain (service pi-hub-deploy-key)"
fi
unset KEY

# 2. Its hash on the Pi; the hub reads it on every report, so no restart.
printf '%s\n' "$HASH" | ssh "$PI" "sudo sh -c 'install -d -m 750 -o root -g pi-hub $DIR && t=\$(mktemp $DIR/.key.XXXXXX) && cat > \$t && chown root:pi-hub \$t && chmod 640 \$t && mv -f \$t $DIR/$NAME.sha256'" ||
  { echo "The key is $WHERE, but its hash didn't reach the Pi. Run again with --rotate." >&2; exit 1; }
echo "The $NAME deploy key is in place: the key $WHERE, its SHA-256 on the Pi. The key was not shown."
