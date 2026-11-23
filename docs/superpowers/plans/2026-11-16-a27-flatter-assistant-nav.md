# A27 flatter Assistant navigation: implementation plan

Date: 2026-11-16. Spec: `docs/superpowers/specs/2026-11-15-amendment-a27-flatter-assistant-navigation.md` (merged #273).
Status: **approved, in progress**. Plan merged; appliance-ui kit 2.26.0 carries D1 to D3 in `pages.json` (the five
tools as cards of Developer tools, the admin pages as cards of System › Assistant, In progress and Shipped as stages of
Changes, and a `redirects` list for every retired id). Step 1 is Pi Hub's sync to kit 2.27.0 and the tests that hold its
links to that shape; the Activity merge, steps 2 to 4 and D4, D5 are not built.

## What the live code says (checked 16 Nov on `origin/main` of both repos)

A27's problem statement is partly stale. The nesting lives in Pi Hub's `hub/static/ui/pages.json` (29 Assistant pages), and
LocalAI's `app/public/view-registry.js` is a second list that has already moved on:

| Decision | Pi Hub `pages.json` today | LocalAI `view-registry.js` today | Work left |
|---|---|---|---|
| D1 two levels | Four: `Setup (assistant-status) › Developer tools › Files, Repository, PowerShell, Browser, n8n` | Developer tools is one page; the five tools are System › Tools cards (`tool:true`) | Pi Hub: five `tools-*` pages stop being nav entries (cards, open in place) |
| D2 filters | `changes-in-progress`, `changes-shipped` are tabs of Changes; `signals`, `claude-code`, `atlas` too | In progress and Shipped already share stage chips on Changes (`lights:'backlog'`) | Pi Hub: In progress and Shipped become filters; Signals + Claude Code become one `activity` page; Atlas stays |
| D3 Setup → System | `assistant-status` is a section with `models`, `developer-tools`, `assistant-settings`, `audit-log` beneath | Domain `system` with Status, Models, Tools, Settings, Audit log | Both: one System tab "Assistant" (card list), `Setup` removed |
| D4 Assistant home | `ask` page with Chat, Image, Decisions | Home has pins (`pins.js`) and recents | Verify Pinned and Recent exist on Ask; promote ⌘K (palette already reads the registry) |
| D5 twelve orphan views | per A27 | `run`, `runs`, `ask`, `create` aliases exist | Check each against the live pages; fix only the ones still orphaned |

So the job is smaller than A27's text suggests: one merge (Activity), one move (admin pages into System › Assistant),
five tools demoted to cards, two tabs turned into filters, and verification of Home/palette.

## Order (each step shippable alone; Pi Hub first because it draws the frame)

1. **Pi Hub: pages and routes.** `pages.json`: remove the `tools-*` entries and `changes-in-progress`/`changes-shipped` as
   tabs (keep their addresses working as redirects to `changes` with the stage filter); replace `signals` + `claude-code`
   with `activity`; add the System tab `assistant` with the five admin pages as cards; drop the `assistant-status`
   section. Tests that read the file: `tests/test_need_links.py`, `tests/test_routes.py`, `tests/test_sections.mjs`, the
   site map and palette. Old links keep working (redirect list), each with a test.
2. **LocalAI: registry and pages.** `view-registry.js`: `activity` view (Signals and Claude Code as two filters of one list),
   retire the `lights` workarounds for In progress and Shipped, new ids in `ALIASES`; the admin pages answer under the new
   System › Assistant frame; Developer tools keeps its card page (the unpushed spike commit `4d94722` in
   `~/dev/.worktrees/LocalAI/spike-dev-tools-cards` is the starting point). `index.html` ids and the Playwright tests move in
   the same PR (ids are contracts).
3. **Home and palette.** Ask/Home shows Pinned and Recent first; ⌘K gets its own visible button in the frame. Short, no
   new component if the kit's palette already does it (check appliance-ui before adding anything).
4. **Retire dead entries.** Delete the retired ids from both lists once redirects are proven; update `docs/` and the
   Site map.

## Verification (per step)

- Pi Hub: `pytest` (routes, need links, sections), `node tests/test_sections.mjs`, the width sweep and axe where the repo
  has them, screenshots at 390, 820 and 1440 px, light and dark.
- LocalAI: `npm test`, the kit literals check, `npm run ci -- <PR>`, browser tests (`atlas`, navigation, palette),
  visual baselines regenerated for the pages that change.
- Evidence from A27: no path deeper than two levels (a test walks `pages.json`), every old address still resolves,
  Assistant entries drop from about 28 to about 14.

## Risks

- Two navigation lists (Pi Hub `pages.json`, LocalAI `view-registry.js`) must agree; a test should compare the page ids so
  they cannot drift (`tests/test_systems.py` does this for the Atlas table; do the same here).
- Old bookmarks and Needs-you links point at the retired ids; `tests/test_need_links.py` must cover each.
- A Pi Hub change ships through its release path (tests on the Pi, then switch); the LocalAI change through
  `npm run ship`. The two must land in order or the frame and the pages disagree for a few minutes.

## Owner decisions

Answered by the owner on 23 Nov 2026:

1. Developer tools stays inside System › Assistant (card, then tool). It is not pinned to Home.
2. Activity is one list with filters (All, Signals, Claude Code), not sections on one page.

## Not in step 1: the Activity merge

Replacing `signals` and `claude-code` with one `activity` page (decision 2) is not in Pi Hub's step 1 PR. Local AI has
no `activity` view yet, so the merge lands in order: a kit change to `pages.json` (the `activity` row and redirects for
the two ids), then step 2 (Local AI's `activity` view), then a Pi Hub sync of that kit.
