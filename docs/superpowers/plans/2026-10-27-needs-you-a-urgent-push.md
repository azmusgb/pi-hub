# One Needs you, Plan A: Pi Hub urgent push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A failure Obico detects, a failed print or HMS stop/pause, and the PC going off during a print each reach
the phone once, past quiet hours, from Pi Hub alone, and tapping the notification opens the right page; the same
causes show in Needs you.

**Architecture:** Three new hub records (`obico`, `hms`, `pc_printing`) built in the existing records loop from
Bambuddy and the hub's own records, so they appear in Needs you like every other problem. A new `hub/urgent.py`
decides which records are urgent, keeps one push per occurrence in a DB table, sends through `events.push` (gaining
`click` and high priority), and lets the existing `print_failed`/`pc_down` rules skip their own push when it already
went.

**Tech Stack:** Python 3 / FastAPI / SQLite (Pi Hub), pytest.

**Spec:** `/Users/billrahe/dev/pi-hub/docs/superpowers/specs/2026-10-27-one-needs-you-design.md` (decisions N1, N5,
N6; section "Pi Hub: printer-side signals").

## Global Constraints

- Urgent (N5): Obico `failure`; printer record `failed`; HMS severity 1 or 2; PC (`local_ai` record) `down` for ≥ 120 s
  while the printer record is `printing` or `paused`. Everything else list-only. Urgent never changes how an item looks.
- One sender (N6): one push per occurrence; pushed on appearing, never on clearing; again only after the cause has been
  clear for 600 s; kept in the hub DB so a restart doesn't re-push. Printer `failed` and Obico `failure` within 120 s
  are one push. Existing `print_failed`/`pc_down` rules keep non-push actions; their `notify` is skipped while an
  occurrence for the same cause was pushed in the last 600 s.
- Stale records (a source not answering) never trigger a push.
- Push: `urgent=True`, `priority="high"`, `click` = a `https://home.home.arpa/...` address (works away from home via
  Tailscale per one-home D3).
- Obico source: Bambuddy `GET /api/v1/obico/printer-status` → `per_printer: {"<id>": {class: safe|warning|failure|
  error|unknown, score, frame_count, error}}`; the X2D is printer `1`. HMS source: the printer status `hms_errors:
  [{code, module, severity, ...}]` (1 stop, 2 pause, 3 notice).
- Titles: Obico failure "Failure detected on the X2D"; warning "Possible print problem"; blind "Failure detection can't
  see the printer"; HMS "Printer needs attention (<code>)"; PC "The PC is off during a print" with cause "Failure
  detection has stopped until it's back."
- Deploys are the owner's (`git push pi main`); stop before it.
- Tests: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests` and `node --test tests/*.mjs`.
  Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. The hub restarts while a failure is still showing → no second push (Task 4 test).
2. Bambuddy stops answering mid-print → stale obico/hms/printer records push nothing (Task 4 test).
3. A failed print at 02:00 inside quiet hours → pushed anyway; the old `print_failed` rule's quiet-hours hold doesn't
   also send later (Task 4 test).
4. Obico flaps failure → safe → failure within a few minutes → one push (Task 4 test).
5. The PC drops for 90 s during a print → no push; for 150 s → one push (Task 3 test).

---

### Task 1: `events.push` gains a click link and high priority

**Files:** Modify `hub/events.py` (`push`, ~134). Test: `tests/test_push.py` (new).

**Interfaces:**
- Produces: `push(title, body="", tags="", priority="default", urgent=False, click=None) -> str`; when `click` is set,
  the ntfy request carries header `Click: <click>`; when `urgent` and `priority == "default"`, the header is
  `Priority: high`.

- [ ] **Step 1: Failing tests** (monkeypatch `urllib.request.urlopen` to capture requests; `TOPIC_FILE` to a temp file;
  `ntfy_servers` to one server): `test_click_header_is_sent`, `test_urgent_defaults_to_high_priority`,
  `test_quiet_hours_still_hold_non_urgent` (existing behaviour kept), `test_no_click_header_without_click`.
- [ ] **Step 2: Run** `... tests/test_push.py` — FAIL.
- [ ] **Step 3: Implement** in `push`.
- [ ] **Step 4: Run** the file and the full suite — PASS.
- [ ] **Step 5: Commit** — "push: click link and high priority for urgent".

### Task 2: `obico` and `hms` records

**Files:**
- Modify: `hub/bambuddy.py` (`obico_status()`), `hub/sources.py` (`_bambuddy` adds `"hms"`), `hub/records.py`
  (`KINDS`, `SOURCE`, `LABELS`), `hub/things/printer.py` (`obico()`, `hms()`), `hub/things/__init__.py` (fetcher
  `"obico"`, builders), `hub/now.py` (`HREF` for both → `/workshop`), `hub/needs.py` (one item per HMS code)
- Test: `tests/test_things_printer.py`, `tests/test_needs.py`

**Interfaces:**
- Produces:
  - `bambuddy.obico_status() -> dict | None` (cached 30 s via `sources.cached("bambuddy_obico", 30, …)`; None when
    Bambuddy doesn't answer)
  - `sources._bambuddy(...)["hms"] -> list[{"code": str, "severity": int, "module": int}]` (from `hms_errors`, `[]`
    when absent)
  - `KINDS["obico"] = {"watching": "ok", "off": "ok", "warning": "attention", "failure": "problem", "blind":
    "attention"}`; `KINDS["hms"] = {"clear": "ok", "notice": "attention", "stopped": "problem"}`;
    `SOURCE["obico"] = SOURCE["hms"] = "bambuddy"`; `LABELS` "Failure detection" and "Printer alerts".
  - `printer.obico(o: dict | None, printer_rec: dict | None) -> record | None`: `o is None` → None (source silent);
    not enabled → `off`; class of printer `"1"`: `failure` → `failure`, `warning` → `warning`, `error` while the
    printer record is printing/paused → `blind` (cause = Bambuddy's `error`); else `watching`. Headlines from the
    Global Constraints.
  - `printer.hms(b: dict | None) -> record | None`: `b is None` → None; any severity 1–2 → `stopped`, else any 3 →
    `notice`, else `clear`; `detail = {"errors": [...]}`; headline "Printer needs attention (<first code>)".
  - `needs.build`: an `hms` problem becomes one item per error, id `pi:source:hms:<code>`, title
    "Printer needs attention (<code>)", tone bad for severity 1–2 else warn.

- [ ] **Step 1: Failing tests:** `test_obico_failure_is_a_problem`, `test_obico_warning_is_attention`,
  `test_obico_error_while_printing_is_blind_and_quiet_when_idle`, `test_obico_off_when_disabled`,
  `test_obico_none_when_bambuddy_silent`, `test_hms_severity_maps_to_state`, `test_hms_empty_is_clear`,
  `test_needs_lists_one_item_per_hms_code`, `test_obico_and_hms_items_are_not_folded_into_the_printer_row`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the two files, then the full suite — PASS.
- [ ] **Step 5: Commit** — "records: failure detection and printer alerts from Bambuddy".

### Task 3: `pc_printing` record

**Files:** Modify `hub/records.py` (`KINDS`, `SOURCE` "hub", `LABELS` "PC during a print"), `hub/things/house.py`
(`pc_printing()`), `hub/things/__init__.py` (built after `printer` and `local_ai`), `hub/now.py` (`HREF` → `/`).
Test: `tests/test_things_house.py`.

**Interfaces:**
- Produces: `KINDS["pc_printing"] = {"fine": "ok", "off_while_printing": "problem"}`;
  `house.pc_printing(printer_rec, local_ai_rec, now) -> record`: `off_while_printing` when the printer record (this
  cycle) is printing/paused and the local_ai record is `down` with `now - since >= 120` (use the merged record's
  `since`; for this cycle's not-yet-merged record use `prev`'s `since` when its state was already `down`), else `fine`.

- [ ] **Step 1: Failing tests:** `test_pc_off_for_90s_during_a_print_is_fine`,
  `test_pc_off_for_150s_during_a_print_is_a_problem` (Review Focus 5), `test_pc_off_while_idle_is_fine`,
  `test_pc_off_while_paused_counts`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file, then the full suite — PASS.
- [ ] **Step 5: Commit** — "records: the PC off during a print".

### Task 4: `hub/urgent.py` — one push per occurrence, wired into the loop

**Files:**
- Create: `hub/urgent.py`
- Modify: `hub/events.py` (`run`: call `urgent.check(records.all(), time.time())` after `on_changes`; `execute`: skip
  `notify` for `print_failed`/`pc_down` when `urgent.recently_pushed(...)`)
- Test: `tests/test_urgent.py` (new)

**Interfaces:**
- Consumes: Task 1 `push(..., urgent=True, click=...)`; Tasks 2–3 records.
- Produces:
  - `CAUSES = {"print": [("printer", "failed"), ("obico", "failure")], "hms": [("hms", "stopped")],
    "pc": [("pc_printing", "off_while_printing")]}` and `CLICK = {"print": "https://home.home.arpa/workshop",
    "hms": "https://home.home.arpa/workshop", "pc": "https://home.home.arpa/"}`
  - table `push_occurrences(cause TEXT PRIMARY KEY, first_seen INTEGER, pushed_at INTEGER, cleared_at INTEGER)`
  - `check(recs: dict, now: float, send=events.push) -> list[str]` (causes pushed this call). A cause is active when
    any of its (record, state) pairs matches a **non-stale** record. Active with no row, or a row cleared ≥ 600 s ago →
    push (title/body from the first matching record's headline and cause) and upsert `first_seen=pushed_at=now,
    cleared_at=NULL`. Active with an open row, or a row cleared < 600 s ago → set `cleared_at=NULL`, no push.
    Inactive with an open row → `cleared_at=now`. Stale records count as neither active nor cleared (no change).
  - `recently_pushed(cause: str, now: float, within: int = 600) -> bool`
  - Rule mapping in `execute`: `print_failed` → `"print"`, `pc_down` → `"pc"`; when `recently_pushed`, return
    `{"status": "skipped", "message": "Already sent as an urgent alert."}` for `notify` only.

- [ ] **Step 1: Failing tests** (inject `send` to capture calls; temp DB per test via the existing fixtures):
  `test_failed_print_pushes_once_with_click_and_urgent`, `test_restart_does_not_repush_an_open_occurrence` (Review
  Focus 1: new process state, same DB), `test_stale_records_never_push` (Review Focus 2),
  `test_printer_failed_and_obico_failure_are_one_push`, `test_flap_within_600s_is_one_push` (Review Focus 4),
  `test_clear_for_600s_then_again_pushes_again`, `test_print_failed_rule_skips_its_push_after_urgent` and
  `test_quiet_hours_do_not_hold_urgent` (Review Focus 3: quiet hours on; urgent sent; the rule's notify returns
  skipped "Already sent…", not "Held back"), `test_pc_down_rule_still_runs_non_notify_actions`.
- [ ] **Step 2: Run** `... tests/test_urgent.py` — FAIL.
- [ ] **Step 3: Implement** `hub/urgent.py` and the two `events.py` changes.
- [ ] **Step 4: Run** the file, then the full suite and `node --test tests/*.mjs` — PASS.
- [ ] **Step 5: Commit** — "urgent: one push per occurrence for print failures, printer alerts and the PC".
- [ ] **Step 6: Stop** for the owner's `git push pi main`; afterwards check on the Pi that `push_occurrences` exists
  and `/api/needs` (Needs you) lists any current obico/hms/pc_printing problems.
