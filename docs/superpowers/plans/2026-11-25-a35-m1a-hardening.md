# A35 M1a hardening: fixes found before the owner install — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the defects found in a review of the merged M1a Mac-side code (`tools/home-mcp` mission package, hook, install script) before plan step 6, the owner install, wires it into Claude Code.

**Architecture:** Two independent fixes: the install script (what step 6 registers and where it links to) and the drain (when it stops). No contract, schema or Pi Hub change.

**Tech Stack:** Python 3.12, pytest, bash.

**Spec:** `docs/superpowers/specs/2026-11-24-amendment-a35-mission-control.md` (§6.2 spool and drain, §21 M0 addendum); M1a plan `docs/superpowers/plans/2026-11-24-a35-m1a-mac-side.md` decisions 2, 3 and 12, step 6.

## Critique (read 25 Nov at origin/main 660ac6c; 281 home-mcp tests pass)

| # | Finding | Evidence | Failure scenario |
|---|---|---|---|
| 1 | The install script never registers `PostToolUseFailure`, though the hook handles it and #326's owner decision said to register it at step 6. | `scripts/install-claude-mission.sh:89-90` event list; hook `mission-report.py:182,257` | A Bash call that fails emits `tool.running` and never `tool.finished`; the mission board shows it running forever. |
| 2 | Run from a worktree, the install links the hook and skill into that worktree. | `install-claude-mission.sh:23` (`here` = the script's checkout) | Owner runs it from `~/dev/.worktrees/pi-hub/<branch>`; after the PR merges, `git worktree remove` / `wt clean` deletes the target. Every hook firing then errors, and `/mission` vanishes. |
| 3 | Drain-on-idle gap. A drain reads the spool once. Events appended while it runs wait for the next hook firing, which never comes after `session.ended`. | `drain.py:_drain_locked` reads `spool.read_all()` once; hook `_start_drain` skips when the lock is held | A session's last events (`turn.finished`, `session.ended`) land while a drain is posting; they sit in the spool until some later session fires a hook, and Pi Hub shows the session still live. |
| 4 | One source without a key stops the drain for every source. | `drain.py` loop: `return _stopped(...)` on a missing key | The importer key is absent (only claude reporting set up); a leftover importer line ahead of claude lines blocks all claude events indefinitely. |
| 5 | `spool.remove` reads the file twice under the lock to decide whether to rewrite. | `spool.py:remove` calls `_raw_lines(path)` again for the length check | Wasted read only; fold into task 2. |

Noted, not fixed here (for the M1b plan): the spec's ≤60 events/minute per source (§6.2 line 264) is below what one busy session emits (two events per tool call). The drain stops on 429 and keeps the spool, so nothing is lost, but the backlog drains only at hook frequency. M1b must size the limit or the hook's volume; recorded in the M1b plan's inputs, not changed here.

## Decisions this plan makes

None changes the spec. If the owner disagrees with one, it changes here.

1. **Worktree install is refused**, not warned: the script exits 1 when its checkout path contains `/.worktrees/`, unless `--allow-worktree` is given. A warning scrolls past; a dangling hook fires on every tool call. Rejected: copying files instead of linking (loses decision 3's "update by pulling").
2. **The drain loops until a pass finds nothing new**, at most `MAX_PASSES = 5` passes, so a flood can't hold the lock forever. Rejected: a launchd idle drainer (the M1a plan's rejected always-on process).
3. **A missing key skips that source** and the drain continues with the others; the result is `stopped` with every skipped source named. 5xx/unreachable/keep-codes still stop the whole drain (the hub or network is the problem, not the source).

## Global Constraints

- The hook stays standard-library only and never touches the network (M1a decision 2).
- A failed read is never success: events leave the spool only on 200 or a drop code (drain.py docstring).
- Logs carry codes and counts only, never a key or response body.

## Review Focus

1. A drain whose second pass hits a 5xx after the first posted: the result must report the posted count and keep the rest. Test in task 2.
2. A source whose key is missing while another's posts fine: the other's events leave the spool. Test in task 2.
3. Install run twice from the main checkout after a worktree refusal: idempotent, no partial links. Test in task 1.
4. `--dry-run` from a worktree: still refused (it would show links that would dangle). Test in task 1.
5. A flood that keeps appending: the drain stops after 5 passes and releases the lock. Test in task 2.

---

### Task 1: Install script registers PostToolUseFailure and refuses worktrees

**Files:**
- Modify: `tools/home-mcp/scripts/install-claude-mission.sh`
- Test: `tools/home-mcp/tests/test_install_claude_mission.py`

**Interfaces:** Produces the CLI flag `--allow-worktree`; exit code 1 with stderr containing `worktree` when refused.

- [ ] **Step 1: Write the failing tests** in `test_install_claude_mission.py`, reusing its existing fixture that runs the script with `CLAUDE_DIR` in tmp:
  - `test_prints_post_tool_use_failure_entry`: the printed JSON has key `"PostToolUseFailure"` with the same command as `"PostToolUse"`.
  - `test_refuses_from_a_worktree`: copy (or symlink-resolve) the script under `tmp/.worktrees/pi-hub/x/tools/home-mcp/`; run → exit 1, stderr contains `worktree`, no link created in `CLAUDE_DIR`.
  - `test_refuses_dry_run_from_a_worktree`: same with `--dry-run` → exit 1.
  - `test_allow_worktree_flag_installs`: with `--allow-worktree` → exit 0, hook link exists.
  - `test_rerun_after_refusal_is_clean`: refusal then a normal run from a non-worktree copy → exit 0, links point at the non-worktree copy.
- [ ] **Step 2: Run** `uv run pytest tests/test_install_claude_mission.py -q` → the new tests FAIL.
- [ ] **Step 3: Implement**: add `"PostToolUseFailure"` after `"PostToolUse"` in the events list; parse `--allow-worktree`; after computing `here`, `case "$here" in */.worktrees/*)` refuse unless allowed, message naming the main checkout. Update the usage comment.
- [ ] **Step 4: Run** the file's tests → PASS.
- [ ] **Step 5: Commit** `fix(home-mcp): mission install registers PostToolUseFailure and refuses worktrees`.

### Task 2: Drain closes the idle gap and isolates a missing key

**Files:**
- Modify: `tools/home-mcp/src/home_mcp/mission/drain.py`, `tools/home-mcp/src/home_mcp/mission/spool.py:remove`
- Test: `tools/home-mcp/tests/test_mission_drain.py`, `tools/home-mcp/tests/test_mission_spool.py`

**Interfaces:**
- `MAX_PASSES = 5` in `drain.py`.
- `DrainResult` gains `skipped: list[str]` (sources skipped for no key), default empty.
- `_drain_locked` keeps its signature; it now repeats a pass while the previous pass posted or dropped something and the spool still holds entries, up to `MAX_PASSES`.

- [ ] **Step 1: Write the failing tests** with the file's existing fake client and runner fixtures:
  - `test_drain_posts_events_appended_during_a_pass`: the fake client, on its first POST, calls `spool.append` with a new claude event; after `drain()` the spool is empty and `posted == 2` (or the batch count + 1).
  - `test_drain_stops_after_max_passes`: the fake client appends one event on every POST → result `done`, exactly `MAX_PASSES` POSTs, one event left in the spool, lock released (a second `drain()` is not `busy`).
  - `test_missing_key_skips_only_that_source`: spool holds an importer event then a claude event; runner returns a key only for claude → claude event posted and gone, importer event kept, `status == "stopped"`, `skipped == ["importer"]`, log line names importer.
  - `test_second_pass_5xx_keeps_rest_and_reports_posted`: first POST 200 and appends one event, second POST 503 → `status == "stopped"`, `posted == 1`, `kept == 1`.
  - In `test_mission_spool.py`, `test_remove_rewrites_when_only_torn_lines_go`: a spool with one torn line and one good line, `remove([])` → the file holds only the good line (pins behaviour through the refactor).
- [ ] **Step 2: Run** `uv run pytest tests/test_mission_drain.py tests/test_mission_spool.py -q` → the drain tests FAIL; the spool test passes (it pins current behaviour).
- [ ] **Step 3: Implement** in `drain.py`: wrap the per-pass body in a loop of up to `MAX_PASSES`; a pass with nothing posted or dropped ends it; on a missing key log, append the source to `result.skipped`, and `continue`; after the loop, if `skipped` is non-empty return `_stopped(result, "no key for " + ", ".join(skipped))`. In `spool.remove`, read `_raw_lines` once and compare against that list.
- [ ] **Step 4: Run** the two files, then the whole suite `uv run pytest -q` → all PASS (281 + new).
- [ ] **Step 5: Commit** `fix(home-mcp): mission drain re-reads the spool and skips only a keyless source`.

## Acceptance

- Merged: home-mcp suite green in the PR's evidence.
- Runtime verified at step 6 (owner install): `settings.json` gains a `PostToolUseFailure` entry; a failing tool call in an attached session leaves no `tool.running` without a `tool.finished` in the spool. Not observable before the owner installs; the PR says so.

## Out of scope (noted, not gated)

- The ≤60/min rate vs hook volume: input to the M1b plan (owner item "A35 M1b plan").
- A 4xx drop takes the whole batch of 50 (M1a plan decision: "4xx drops with a log line"). The hook validates each event before spooling, so a batch-level refusal should not occur; revisit if M1b's hub returns per-event errors.
