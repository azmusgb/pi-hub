# Print lab on Pi Hub, Plan D: lab items in Needs you, links to `/lab` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi Hub's Needs you lists what the print lab wants from the owner (judge, approve, send, fix the plan) from its
own stored lab index, so it works with the PC off; and every Print lab link in Pi Hub opens Pi Hub's own `/lab`.

**Architecture:** `hub/needs.py` gains lab items read from the `lab_projects` table that `hub/lab.py` keeps (each
project's last index, `index_json`, holds `needs` and `generated_at`). Local AI's feed cards that duplicate them
(`judge-*`, `lab-*`) are dropped. Links: `sections.js printLabUrl`, `home-cards.js labLink` and the Workshop page's
"Print lab ↗" switch from Local AI's `#printLab` to `/lab?e=<exp>` (the owner confirmed `/lab` after Plan C, 28 Oct).

**Tech Stack:** Python/FastAPI, SQLite (`hub/db.py`), vanilla ES modules; pytest, `node --test`.

**Spec:** `/Users/billrahe/dev/pi-hub/docs/superpowers/specs/2026-10-28-print-lab-on-hub-design.md` (L9, L10); item
shape and phrases from `docs/superpowers/specs/2026-10-27-one-needs-you-design.md` (N2, N4, N7, N8).

## Global Constraints

- Item: `id` `pi:lab:<project>:<exp>`; `source` "Print lab"; `title` "<exp>: <phrase>" (≤ 80); `detail` the need's
  `why` (≤ 200); `link` (the field `hub/needs.py` items already use) `/lab?e=<exp>&do=judge` for judge, `/lab?e=<exp>`
  otherwise; `as_of` the index's `generated_at`; never urgent, never pushed.
- Which needs: keep `urgency < 3` or action "Fix the plan"; exclude "Run the check"/"Run the build".
  Tone: "Judge the print" → attention, "Approve or drop" → attention, "Send it to the printer" → warn, "Fix the plan" → warn.
- "Judge the print" only when due: no `due_at`, or `due_at` ≤ now, or the printer record reports the print finished or
  failed (`records` printer state). Otherwise leave it out.
- Bad or old index data (missing `needs`, non-list, entries without `id`/`action`, unparsable `due_at`) never raises;
  the item is skipped.
- Drop Local AI feed cards whose id starts with `judge-` or `lab-` (the hub's copy is the source now).
- A `/lab?e=` link is built only from an id matching `^E-\d{1,6}$`.
- Service worker `SHELL` bump (v108) with `tests/test_appliance_ui.py`'s pin when static files change.
- Tests: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests`, `node --test tests/*.mjs`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The owner deploys.

## Review Focus

1. Two projects synced → items from both, ids distinct (Task 1).
2. The lab table doesn't exist yet on a fresh hub (no sync ever) → `/api/needs` still answers (Task 1).
3. An item already shown by the printer record ("printer finished, clear the plate") and a lab judge item → both
   kept; `_one_row(ABOUT_PRINTER)` must not fold the lab item away (its text says "print") (Task 1).
4. `/lab?e=E-022&do=judge` opens the verdict sheet on that experiment when a verdict is due (Task 2).

---

### Task 1: Lab items in `/api/needs`

**Files:** `hub/needs.py`, `hub/app.py` (`api_needs` passes the lab needs), `hub/lab.py` (a read helper), test
`tests/test_needs.py`.

**Interfaces:** Produces `lab.stored_needs() -> list[tuple[str, str, list]]` (project, generated_at, needs) — safe when
the table is absent; `needs.build(events, feed, now, problems=(), lab=(), printer_done=False)`.

- [ ] **Step 1: Failing tests:** each of the four kinds → right tone/title/link/`as_of`; urgency-3 "Run the check"
  excluded, "Fix the plan" kept; judge not before `due_at`, shown after it, shown early when `printer_done`; malformed
  entries skipped; two projects; feed cards `judge-…`/`lab-…` dropped, other feed cards kept; a lab judge item and
  the printer record both present after `_one_row`; `/api/needs` with no lab table → 200.
- [ ] **Step 2–4:** FAIL → implement → PASS (both suites).
- [ ] **Step 5: Commit** — "Needs you: the print lab's own asks, from the hub's copy".

### Task 2: Print lab links open `/lab`

**Files:** `hub/static/js/sections.js` (`printLabUrl`), `hub/static/js/home-cards.js` (`labLink`),
`hub/static/js/workshop.js` (the "Print lab ↗" action), `hub/static/js/lab.js` (honour `do=judge`), `sw.js`,
`tests/test_appliance_ui.py`, node tests beside the existing ones for these modules.

- [ ] **Step 1: Failing tests:** `printLabUrl("E-022")` → `/lab?e=E-022`; `labLink` label "Print lab: E-022" with
  href `/lab?e=E-022` and no "↗" (same origin), invalid id → null; the Workshop link → `/lab`; a test that `lab.js`
  reads `do=judge` and opens the verdict sheet only when that experiment has a due judge need (extract the decision as
  a pure exported function).
- [ ] **Step 2–4:** FAIL → implement (internal links get `data-link` so the SPA router takes them) → PASS.
- [ ] **Step 5: Commit** — "Print lab links open the hub's own lab page".
