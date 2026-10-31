#!/bin/bash
# Lets the hub (group pi-hub) write into the PC's Movies share for Media › Add a movie: the fstab line gets
# gid=pi-hub,file_mode=0664,dir_mode=0775 (owner bjrmc keeps writing; Plex keeps reading). Remounting interrupts Plex
# playback for a few seconds. Run on the Pi as root:  sudo bash movies-share-writable.sh status|apply|undo
set -euo pipefail
MNT=/mnt/windows-movies
FSTAB=/etc/fstab
BACKUP=/etc/fstab.pre-movies-upload
want() { grep -E "[[:space:]]$MNT[[:space:]]" "$FSTAB" | grep -q "gid=$(getent group pi-hub | cut -d: -f3),.*file_mode=0664,dir_mode=0775"; }
case "${1:-status}" in
  status)
    want && echo "fstab: writable by pi-hub" || echo "fstab: not writable by pi-hub"
    mountpoint -q "$MNT" && echo "mounted" || echo "NOT mounted (PC off?)"
    sudo -u pi-hub test -w "$MNT" && echo "pi-hub can write" || echo "pi-hub cannot write" ;;
  apply)
    want && { echo "already applied"; exit 0; }
    gid=$(getent group pi-hub | cut -d: -f3)
    [ -f "$BACKUP" ] || cp -p "$FSTAB" "$BACKUP"
    sed -i -E "/[[:space:]]${MNT//\//\\/}[[:space:]]/ s/gid=[0-9]+/gid=$gid,file_mode=0664,dir_mode=0775/" "$FSTAB"
    want || { echo "fstab edit did not take; restoring"; cp -p "$BACKUP" "$FSTAB"; exit 1; }
    systemctl daemon-reload
    umount "$MNT" && mount "$MNT"
    "$0" status ;;
  undo)
    [ -f "$BACKUP" ] || { echo "no backup at $BACKUP"; exit 1; }
    cp -p "$BACKUP" "$FSTAB" && rm -f "$BACKUP"
    systemctl daemon-reload
    umount "$MNT" && mount "$MNT"
    "$0" status ;;
  *) echo "usage: $0 status|apply|undo" >&2; exit 2 ;;
esac
