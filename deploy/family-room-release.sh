#!/bin/bash
# The family-room panel's pages on the Pi (docs/operations.md "Family-room panel"). Run on the Mac:
#   deploy/family-room-release.sh publish [checkout]   ship the committed prototype/ of ~/dev/family-room (or checkout)
#   deploy/family-room-release.sh rollback             switch back to the release before the current one
#   deploy/family-room-release.sh list                 show the releases, newest first, and which one is live
# Each release is /srv/family-room/releases/<commit>, with version.json naming its commit; /srv/family-room/current
# points at the live one and is switched in one rename, so the panel never sees half a release. The five newest are
# kept, and the current and previous ones are never removed. Changes nothing on the Skylight or in Caddy.
# FR_REMOTE (a command that runs one shell string on the Pi) and FR_ROOT are for the tests.
set -euo pipefail
REMOTE=${FR_REMOTE:-"ssh -o BatchMode=yes pi"}
ROOT=${FR_ROOT:-/srv/family-room}
say() { echo "family-room: $*"; }
remote() { $REMOTE "$1"; }

# The Pi side, given the root, an action and its arguments on stdin's script. Every path it touches is under the root.
pi_side() {
  remote "bash -s -- '$ROOT' $*" <<'EOF'
set -euo pipefail
root="$1" action="$2" keep=5
rel="$root/releases" log="$root/releases.log"
[ -d "$rel" ] || { echo "family-room: $rel is missing; run deploy/install.sh from the Mac first"; exit 1; }
live() { basename "$(readlink "$root/current" 2>/dev/null || true)"; }
switch() {  # atomically point current at releases/$1 and record it
  ln -sfn "releases/$1" "$root/current.new"
  python3 -c 'import os, sys; os.replace(sys.argv[1], sys.argv[2])' "$root/current.new" "$root/current"  # rename(2): atomic
  printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" "$1" >> "$log"
}
previous() {  # the newest release in the log, other than the live one, that still exists
  [ -f "$log" ] || return 0
  awk '{c[NR] = $3} END {for (i = NR; i > 0; i--) print c[i]}' "$log" | while read -r c; do
    if [ "$c" != "$(live)" ] && [ -d "$rel/$c" ]; then echo "$c"; break; fi
  done || true
}
case "$action" in
  unpack)  # $3 commit, $4 tar path (already uploaded)
    c="$3" tar="$4"
    case "$c" in *[!0-9a-f]*|"") echo "family-room: bad commit name"; exit 1 ;; esac
    if [ -d "$rel/$c" ]; then echo "family-room: $c is already on the Pi"; rm -f "$tar"
    else
      tmp="$rel/.$c.tmp"; rm -rf "$tmp"; mkdir -p "$tmp"
      tar -xf "$tar" -C "$tmp" --strip-components=1; rm -f "$tar"
      [ -f "$tmp/index.html" ] && [ -f "$tmp/version.json" ] || { rm -rf "$tmp"; echo "family-room: the release has no index.html or version.json"; exit 1; }
      chmod -R a+rX "$tmp"; mv "$tmp" "$rel/$c"
    fi
    switch "$c" publish
    prev=$(previous)
    ls -1t "$rel" | grep -v '^\.' | tail -n +$((keep + 1)) | while read -r old; do
      [ "$old" = "$c" ] || [ "$old" = "$prev" ] || rm -rf "${rel:?}/$old"
    done
    echo "family-room: $c is live"
    ;;
  rollback)
    p=$(previous)
    [ -n "$p" ] || { echo "family-room: no earlier release to go back to"; exit 1; }
    switch "$p" rollback
    echo "family-room: back to $p"
    ;;
  list)
    l=$(live)
    ls -1t "$rel" | grep -v '^\.' | while read -r c; do
      printf '%s %s %s\n' "$([ "$c" = "$l" ] && echo '*' || echo ' ')" "$c" "$(sed -n 's/.*"published": *"\([^"]*\)".*/\1/p' "$rel/$c/version.json" 2>/dev/null)"
    done
    ;;
  *) echo "family-room: unknown action $action"; exit 1 ;;
esac
EOF
}

case "${1:-}" in
  publish)
    SRC=${2:-$HOME/dev/family-room}
    git -C "$SRC" rev-parse --git-dir >/dev/null 2>&1 || { say "$SRC is not a git checkout"; exit 1; }
    # What ships is the committed prototype/, so the version names exactly what is live.
    if [ -n "$(git -C "$SRC" status --porcelain -- prototype)" ]; then say "prototype/ has changes that aren't committed; commit them first"; exit 1; fi
    COMMIT=$(git -C "$SRC" rev-parse --short=12 HEAD)
    WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
    git -C "$SRC" archive --format=tar --prefix=release/ HEAD prototype | tar -x -C "$WORK"
    mv "$WORK/release/prototype" "$WORK/$COMMIT"
    printf '{"commit": "%s", "full": "%s", "published": "%s"}\n' "$COMMIT" "$(git -C "$SRC" rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$WORK/$COMMIT/version.json"
    tar -cf "$WORK/release.tar" -C "$WORK" "$COMMIT"
    remote "cat > '$ROOT/releases/.incoming-$COMMIT.tar'" < "$WORK/release.tar"
    pi_side unpack "$COMMIT" "'$ROOT/releases/.incoming-$COMMIT.tar'"
    ;;
  rollback) pi_side rollback ;;
  list) pi_side list ;;
  *) sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
