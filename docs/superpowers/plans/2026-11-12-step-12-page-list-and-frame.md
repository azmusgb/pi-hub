# Step 12, One site: the page list and the shared frame. One list names every page, and the menu has five areas — Plan

Date: 2026-11-12 · Status: **proposed** · Covers: baseline §11 step 12, amendment A22 brief 2
(`docs/superpowers/specs/2026-11-11-amendment-a22-one-site.md`, merged in #230 as 15d858d).

**Goal:** a page's name, heading and address are written once, in the kit's `pages.json`, and Pi Hub's rail, phone
tab bar, strips, ⌘K and Site map are drawn from it. The menu becomes Home · Workshop · Household · Network · System,
with no More tab. No address changes.

## Spec

- Baseline §11 step 12: "**One site: the page list and the shared frame (A22, brief 2).** `pages.json` in the kit,
  five areas, the generated rail, tab bar, strips, ⌘K and Site map. After 11."
- A22 section 12, Brief 2 (the table of changes, "Done when", "Tested by", "Phones must not get worse").
- A22 sections 2.1 to 2.4 (the frame, the five areas, the page head, search), 3 (the page list, its format, the
  complete list, the tools, the tests), 8.1, 8.2 and 8.6 (names), 9.1 and 9.2 (accessibility), 10 (old addresses).
- A22 is under the baseline's `## Amendments` on `origin/main`, so it is approved.
- **Waits on:** "After 11" (decision 1). Steps 14 and 15 are "After 12".
- Design contract: appliance-ui `DESIGN.md`, read at the start of each PR here, not from this plan.
- Brief 2 inherits "for every brief": tests and browser checks run on the Mac; nothing runs the full suite or a
  deploy on the Pi.

## Done means

Brief 2's "Done when" and "Phones must not get worse", numbered, plus the recorded look every step carries:

1. A phone shows five tabs and no More.
2. Every page in 3.3's Pi Hub table opens from its strip, from ⌘K and from the Site map (decision 3 says which rows
   that is in this step).
3. Every alias in section 10 redirects (decision 4 says which rows).
4. Changing a `label` in `pages.json` changes the strip, the title, ⌘K and the Site map together.
5. The owner opens Movies, Papers and Health on their own phone, and none takes more taps than section 2.2 says
   (Movies one, Papers two, Health one).
6. The look is recorded in `docs/operations.md`.

## What exists today (read on 12 Nov 2026)

Code read at `origin/main`: pi-hub f65abc0, appliance-ui 2dd34b2 (kit 2.16.1).

**Live:** the Pi runs 0ccd5c9, so step 11's Pi Hub PRs (#232, #233, #234) are merged and not deployed. The Pi
still answers on 10.0.0.30; `main` (since #229) and the `pi` SSH alias say 10.0.0.80, so the deploy preflight fails
until the address move is finished (out of scope, below). LocalAI #529 (step 11's labels) is open.

**The kit**

- `tools.json` is the one list of 16 linked apps; `scripts/build.mjs` writes `dist/tools.js` and `dist/tools.h` from
  it and `scripts/sync.mjs` copies `dist/` into each app. There is no `pages.json`.
- A tool's `area` is one of `home`, `assistant`, `workshop`, `documents`, `media`, `network`, `system`
  (Paperless, Scan and Homebox are `documents`; Plex is `media`). `toolsFor(area)` (`dist/tools.js`) is how Pi Hub
  picks an area's tools (`hub/static/js/section-links.js:36`).
- `status` (Uptime Kuma) and `homebox` are ordinary entries. `n8n` and `comfy` are not in the file. The Assistant's
  purpose line reads "Local AI on the PC, which may sleep".
- `DESIGN.md:208,225` documents `ui-tabs` for two to five tabs.

**Pi Hub: the same facts are written in seven places**

| Fact | Where |
|---|---|
| Addresses and old paths | `hub/static/js/routes.js:4-21` (22 pages, 12 redirects); the server reads the same file (`hub/app.py:1504-1512`) to answer any other path with a 404 |
| Six areas and their pages | `SECTIONS`, `hub/static/js/sections.js:9-16` |
| The phone's tabs (Home, Workshop, Documents, Media, More) | `PHONE`, `sections.js:19` |
| The rail and tab bar | static links in `hub/static/index.html:184-220` (one `nav`, seven entries, More shown on a phone) |
| The strips | `STRIPS`, `hub/static/js/system-strip.js:7-25` |
| Route titles and the one-line purposes | `PAGES` and `subtitles`, `hub/static/js/main.js:60-120` |
| ⌘K's pages and their search words | `PAGES`, `hub/static/js/command-palette.js:9-30` |

- The Site map (`hub/static/js/map.js:25-60`) is built from `SECTIONS`, `STRIPS`, `SERVER_PAGES` and the tools.
- `/more` is a page (`hub/static/js/more.js`, 12 lines) listing Home & network, System and the Site map.
- `/scan`, with any method and any sub-path, is a 308 to the Scan app (`hub/app.py:1494-1498`). `/apps/scan` goes to
  `/documents`, and `/apps/status` and `/status` to `/network` (`routes.js`).
- Settings draws its six groups as a row of `#group-<id>` links marked `aria-current="true"`
  (`hub/static/js/settings.js:94-117,278`). They are in no menu, ⌘K or Site map.
- The strip's `nav` is named by its area ("System"), not "System pages" (`system-strip.js:54`); the strip entry
  already carries `aria-current="page"`. The tab bar is 68 px (`app.css:13`) and the page pads its foot by that much
  (`app.css:296`), with no `scroll-padding-bottom`.
- The Assistant's Site map rows are five (`ASSISTANT_PAGES`, `hub/static/js/assistant.js:25`), opened as
  `/assistant?to=<view>`; ⌘K has one Assistant row (step 11).
- Tests that name the six areas, More or the old Scan link: `tests/test_sections.mjs`, `test_nav_links.mjs`,
  `test_home_cards.mjs`, `test_area_strips.mjs`, `test_system_strip.mjs`, `test_workshop_strip.mjs`,
  `test_ux_honest_states.mjs`, `tests/test_pages.py`, `tests/test_need_links.py`, and the browser checks
  `structure.mjs`, `sweep.mjs` and `tabbar.mjs`.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **"After 11" is read as: step 11's Pi Hub PRs are merged.** Step 11's plan flagged this reading and the owner
   merged it. The kit PR (K2) reads nothing from the Assistant. One sequencing rule is this plan's own, not the
   spec's: H4 does not merge until step 11's Pi Hub half has been deployed and looked at, because one deploy carrying
   both would leave nothing for step 11's look to see on its own.
2. **`pages.json` holds the complete list of 3.3 from its first release**, so the words test checks every name on
   the site once. A row whose page is not built yet carries `"built": false`; nothing draws such a row, and
   `test_pages_routes` skips it. Two Pi Hub rows start that way: Print lab › Designs and Print lab › Lab tools, which
   step 15 builds. *This adds one optional field to 3.2's format*, removed when step 15 lands. Rejected: leaving the
   rows out until step 15 (the words test would not see their names), and building the two tabs now with section
   8.5's empty states ("This fills in after its next sync" would be untrue before step 15 adds the sync). If the
   owner counts a new field as a spec change, the fallback is to leave the two rows out.
3. **In this step Pi Hub draws only `system: hub` rows from the list.** The Assistant's 29 rows are in the file and
   checked for names, but its Site map rows and its ⌘K row stay as step 11 left them until step 14 frames each
   section. Brief 2's "Done when" names "3.3's Pi Hub table"; brief 4 lists the `/assistant/<path>` routes as its
   own change; and an entry called "Decisions" must not open a page still headed "Inbox". Rejected: listing all 29
   in ⌘K now through `/assistant?to=`.
4. **Section 10's aliases, by step.** This step delivers every Pi Hub row whose target exists: the nine that work
   today, `/apps/status` and `/status` to `/system`, `/apps/scan` to `/scan`, `/more` to `/map`.
   `/assistant?to=<route>` to `/assistant/<path>` lands with step 14, section by section, because its targets do.
5. **Uptime Kuma's entry is marked `retired: true` now and deleted in step 15.** Two readings of 3.4's "Removed":
   - *Removed in this step.* Brief 2 says "Update `tools.json` (3.4)". But Kuma keeps running until step 15, and
     section 10 says nothing links to it "after brief 5".
   - *Retired now, removed when it stops (recommended).* It leaves every "Open in" row in this step, shows in the
     Site map under "No longer used" beside Homebox, and its entry and host go in step 15. No running tool is left
     without a link, and the end state is 3.4's.
6. **Tools move with their pages.** In `tools.json`, `documents` and `media` become `household`, and each page's
   "Open in" row comes from its `tools` in the list. `toolsFor(area)` stays for the Site map's per-area list.
   Rejected: keeping the old area words in the kit after the areas are gone.
7. **`n8n` and `comfy` get a `via` field**, an address on the Assistant's own origin (`/go/n8n`, `/go/comfy`),
   since every other tool's address is `<id>.<house>`. The build refuses an entry with both or neither.
8. **Search words stay in Pi Hub**, in one map keyed by page id; a test fails on a key that is not a page. They are
   hints, not names, and include the retired words (typing "devices" still finds Lights). Rejected: a `keywords`
   field in the list, which 3.2 does not have.
9. **The server reads the synced `hub/static/ui/pages.json`** for its paths and aliases; `routes.js` is deleted and
   the router imports the kit's generated `pages.js`. `test_pages_routes` compares the list with the route table in
   `main.js` (each `hub` path has a page module, and each module a row).
10. **The rail's five links stay written in `index.html`**, and `test_pages_areas` fails when they differ from the
    list. They are in the first paint and the offline shell, before any script runs. The cost: renaming an area is
    two edits, and the test catches a missed one. The strips, titles, ⌘K and Site map are drawn from the list at run
    time, which is what criterion 4 checks. Rejected: drawing the rail in script (an empty menu while it loads).
11. **One new module, `hub/static/js/site.js`**, answers every question the seven places answered: the area of a
    path, its strip, its heading and tab title, its purpose, its alias target, its search row. `SECTIONS`, `PHONE`,
    `STRIPS`, both `PAGES` tables, `subtitles`, `more.js` and `routes.js` are deleted in the same PR.
12. **Purpose lines are today's** (`main.js:98-120`), reworded only for Lights, Internet, Papers and Movies, as 3.2
    says. K2's PR body lists all of them for the owner to read in one place.
13. **Settings' six groups become `ui-tabs`**, and the kit's rule becomes "two to six" in K2 (2.1 says six is
    proposed with the page list). Each group keeps its `#group-<id>` address.
14. **The Scan page is one line and its "Open in Scan ↗" link.** The server answers `GET /scan` with the shell;
    `/scan/<anything>`, and `POST`, `PUT` or `DELETE` to `/scan`, keep the 308. That is section 10's row, and the
    only server route this step changes. No auth, gate, Caddy or printer route is touched.
15. **Household's icon** is new; Network keeps Home & network's. H4's screenshots show both for the owner's look.
16. **If "Household" or "Workshop" clips at 320 px at the largest text size**, the bar shows icons with labels under
    them at `--ui-fs-1` (9.1 F6). H4's sweep decides; the plan does not assume it clips.

## The PRs, one at a time

Each is based on `main`, runs both suites and the sprawl check on the Mac, and pastes the counts.

**K2, appliance-ui 2.17.0: the page list.** Implements 3.1 to 3.4 and 8.6. Full coverage of the kit's part.

- `pages.json` (3.2's format, 3.3's rows, section 10's aliases, decision 2's field); the build writes
  `dist/pages.json` and `dist/pages.js`, and `sync.mjs` copies them.
- A schema test (roles and their required `reach`, a parent for `tab`, `filter` and `mode`, one page per alias, a
  shared `path` only for a page and its first tab) and `pages-words.test.mjs` (no two pages share a `label`,
  sentence case with 8.1's exceptions, none of 8.6's retired words).
- `tools.json`: decisions 5, 6 and 7; Homebox `retired: true`; the Assistant's purpose becomes "Runs on the PC,
  which may be asleep".
- `DESIGN.md`: `ui-tabs` two to six. `CHANGELOG.md`, version, `docs/contrast.md` restamped.
- Evidence: the kit's suite; the generated files in the diff.

**H4, pi-hub: the frame reads the list.** After K2 is released, and after decision 1's rule. Implements 2.2, 2.3,
2.4 (Pi Hub's rows), 3.5, 9.1 F2, F3 and F6, 9.2 and section 10. Full coverage of criteria 1 to 4.

- Kit synced to 2.17.0. `site.js` (decision 11); the server reads the list (decision 9).
- Five areas in the rail and tab bar; Household opens on Movies; `/more` redirects to `/map`.
- Names from the list: Lights, Internet, the areas Household and Network.
- The Scan page (decision 14); `/apps/scan` to `/scan`; `/apps/status` and `/status` to `/system`.
- ⌘K and the Site map from the list, each entry with its area; Settings' groups and Privacy are entries; the Site
  map gains "No longer used".
- The strip's `nav` is named "{Area} pages"; `scroll-padding-bottom` of the bar's height plus the safe-area inset;
  the Home tab's name is "Home, 7 need you" with the badge hidden from assistive tech.
- The six `test_pages_*` tests and the Site map check (3.5). `SHELL` bumped.
- **Tests this makes wrong, each changed in its own commit with the reason:** `test_sections.mjs` (six areas,
  `PHONE`, `/apps/scan`), `test_nav_links.mjs:119` and `test_home_cards.mjs:36` (the Scan link),
  `test_area_strips.mjs`, `test_system_strip.mjs`, `test_workshop_strip.mjs`, `test_ux_honest_states.mjs`,
  `test_pages.py`, `test_need_links.py`, and the area lists in `structure.mjs`, `sweep.mjs` and `tabbar.mjs`.
- Evidence: suite counts; `tabbar.mjs`; the width sweep at 320 to 2560 px, three text sizes, light and dark; axe
  with no serious or critical finding; the keyboard walk of 9.6 steps 1 to 5 and 8, written out; screenshots at
  phone, tablet and desktop in both themes; a test that changes one `label` in a copy of the list and sees the
  strip, title, ⌘K row and Site map row change (criterion 4).

**H5, pi-hub: Settings' groups as tabs.** After H4; independent of everything else. Implements 2.1's `ui-tabs` row
and 3.3's Settings rows. Full.

- The row becomes a `tablist` named "Settings"; arrow keys, Home and End move; the address still chooses the group.
- Evidence: a tabs test; axe; screenshots of the six tabs at 320 px and desktop.

**Owner steps**

- **O1.** Finish the address move, so the Pi can be deployed to (a network change; out of scope, below).
- **O2.** Step 11's Pi Hub half deployed and looked at (step 11's O4), before H4 merges.
- **O3.** After H4 and H5 are deployed: the look in "Acceptance".

Deploys are the owner's session's, after the deploy preflight, never part of a PR here.

## Coverage

| Criterion | PR | Evidence |
|---|---|---|
| 1 Five tabs, no More | H4 | `test_pages_areas`; `tabbar.mjs`; the sweep; O3 |
| 2 Every Pi Hub page from strip, ⌘K and Site map | K2, H4, H5 | `test_pages_reach`, `test_pages_routes`, the Site map check |
| 3 Aliases redirect | H4 | `test_pages_redirects` |
| 4 One label, four places | H4 | the label-change test; `test_pages_headings` |
| 5 Phone taps | O3 | the owner's phone |
| 6 Recorded | O3 | `docs/operations.md` |

`pages-registry.test.cjs` (3.5, LocalAI) is not in this step: LocalAI gets the list when it takes the current kit
(step 13's first PR there) and uses it in step 14.

## Acceptance

Recorded in `docs/operations.md` under "One site (A22)" as "Step 12 accepted <date>", after H4 and H5 are live:

- On their own phone the owner sees five tabs; reaches Movies in one tap, Papers in two and Health in one; opens
  Scan from Household's strip; and finds no More.
- On a desktop the owner sees the same five in the rail; opens ⌘K and finds Lights, Internet, a Settings group and
  Privacy, each with its area; opens the Site map and sees every page under its area and "No longer used".
- An old address (`/more`, `/apps/status`) lands where section 10 says.

Until then the status is the ladder's word: merged, deployed, runtime verified.

## Out of scope (noted, not gated)

- **The address move (#229).** `main` names the Pi 10.0.0.80, the PC .81 and the Mac .92; on 12 Nov the Pi is on
  .30 and the Mac on .82. Until the router's reservations take effect nothing can be deployed. Owner: the router
  and the Pi's lease; it is a network change and needs the owner each time.
- **The Assistant's entries, sections Ask and Setup, and `/assistant/<path>`.** Step 14.
- **Print lab's Designs and Lab tools, filling in Scan, stopping Uptime Kuma.** Step 15.
- **The banner's words and `pc_waking`** (8.4). Step 14, with the banner.
- **The wall draws a second `h1`** (`hub/static/js/now.js:832`). 2.3 says one per document; the wall has no frame,
  so it is not this step's change. Owner of the follow-up: step 13's check, which reads every page.
- **The sprawl check already fails on `main`.** Each PR reports its own change. H4 deletes seven lists and should
  lower the counts; if it does, it lowers the baseline in the same PR.
