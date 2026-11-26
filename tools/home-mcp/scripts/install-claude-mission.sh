#!/usr/bin/env bash
# Install A35 mission reporting into Claude Code (plan step 6, run by the owner on the Mac):
#   - symlinks claude/hooks/mission-report.py into $CLAUDE_DIR/hooks/ and claude/skills/mission into $CLAUDE_DIR/skills/;
#   - writes $CLAUDE_DIR/mission-config.json {"enabled": false, "drain": [...]} only when it is absent (decision 3);
#   - prints the settings.json hook entries to add. It never edits settings.json.
# Safe to run again: links already in place and an existing config are left alone.
# Run it from the main pi-hub checkout: links into a worktree dangle once the worktree is removed, so a worktree is
# refused unless --allow-worktree is given.
#
# Usage: scripts/install-claude-mission.sh [--dry-run] [--allow-worktree]
# Env:   CLAUDE_DIR (default ~/.claude), PYTHON (default /opt/homebrew/bin/python3, else python3 on PATH; 3.10 or later)
set -euo pipefail

dry_run=0
allow_worktree=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    --allow-worktree) allow_worktree=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

here="$(cd "$(dirname "$0")/.." && pwd -P)"
claude_dir="${CLAUDE_DIR:-$HOME/.claude}"
hook_src="$here/claude/hooks/mission-report.py"
skill_src="$here/claude/skills/mission"
hook_dst="$claude_dir/hooks/mission-report.py"
skill_dst="$claude_dir/skills/mission"
config="$claude_dir/mission-config.json"
home_mission="$here/.venv/bin/home-mission"

case "$here" in
  */.worktrees/*)
    if [ "$allow_worktree" = 0 ]; then
      echo "refusing: $here is in a worktree; the hook and skill links would dangle once it is removed." >&2
      echo "Run this from the main pi-hub checkout (e.g. ~/dev/pi-hub/tools/home-mcp), or pass --allow-worktree." >&2
      exit 1
    fi ;;
esac

python="${PYTHON:-}"
if [ -z "$python" ]; then
  if [ -x /opt/homebrew/bin/python3 ]; then python=/opt/homebrew/bin/python3; else python="$(command -v python3 || true)"; fi
fi
if [ -z "$python" ] || ! "$python" -I -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
  echo "need Python 3.10 or later for the hook (set PYTHON); found: ${python:-none}" >&2
  exit 1
fi

for f in "$hook_src" "$skill_src/SKILL.md"; do
  [ -e "$f" ] || { echo "missing $f: run this from a pi-hub checkout" >&2; exit 1; }
done

say() { if [ "$dry_run" = 1 ]; then echo "would $*"; else echo "$*"; fi; }

# link SRC DST: make DST a symlink to SRC. A link to SRC already is fine; anything else at DST is refused, not replaced.
link() {
  local src="$1" dst="$2"
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    echo "ok: $dst already links to $src"
    return 0
  fi
  if [ -e "$dst" ] || [ -L "$dst" ]; then
    echo "refusing: $dst exists and is not a link to $src; move it aside and run again" >&2
    return 1
  fi
  say "link $dst -> $src"
  if [ "$dry_run" = 0 ]; then
    mkdir -p "$(dirname "$dst")"
    ln -s "$src" "$dst"
  fi
}

link "$hook_src" "$hook_dst"
link "$skill_src" "$skill_dst"

if [ -e "$config" ]; then
  echo "ok: $config exists; left as it is"
else
  say "write $config (reporting off)"
  if [ "$dry_run" = 0 ]; then
    mkdir -p "$claude_dir"
    "$python" -I - "$config" "$home_mission" <<'PY'
import json, os, sys
path, exe = sys.argv[1], sys.argv[2]
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)  # never overwrite one written meanwhile
with os.fdopen(fd, "w", encoding="utf-8") as f:
    json.dump({"enabled": False, "drain": [exe, "drain"]}, f, indent=1)
    f.write("\n")
PY
  fi
fi
[ -x "$home_mission" ] || echo "note: $home_mission is not built yet; run 'uv sync' in $here (the hook skips the drain until it exists)"

echo
echo "Add these entries to the \"hooks\" object in $claude_dir/settings.json (this script does not edit it)."
echo "Each event keeps its existing entries; append this one to the event's list:"
echo
"$python" -I - "$python" "$hook_dst" <<'PY'
import json, shlex, sys
command = f"{shlex.quote(sys.argv[1])} -I {shlex.quote(sys.argv[2])}"
events = ["SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
          "PermissionRequest", "SubagentStart", "SubagentStop", "Stop"]
entry = {"type": "command", "command": command, "timeout": 3, "async": True}
print(json.dumps({e: [{"hooks": [entry]}] for e in events}, indent=2))
PY
