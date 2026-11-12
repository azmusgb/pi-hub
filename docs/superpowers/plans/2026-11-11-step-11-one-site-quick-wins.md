# Step 11, One site: quick wins. Every page is headed by its own name, and the leftover names go — Plan

Date: 2026-11-11 · Status: **proposed** · Covers: baseline §11 step 11, amendment A22 brief 1
(`docs/superpowers/specs/2026-11-11-amendment-a22-one-site.md`, merged in #230 as 15d858d).

**Goal:** a page says its own name at the top (Printer, not Workshop), each thing has one name wherever the owner
reads it, and the Assistant's unused copy of the old lab code is removed once it is proved unused. Nothing moves,
and no menu changes.

## Spec

- Baseline §11 step 11: "**One site: quick wins (amendment A22, brief 1).** Titles name the page, the label fixes, and
  the Assistant's leftover lab code. Independent of 2-10."
- A22 section 12, Brief 1 (the table of changes, "Done when", "Tested by", "Not in this brief").
- A22 section 2.3 (the page head) and section 8.1 (one name per thing) give the words.
- A22 is listed under the baseline's `## Amendments` on `origin/main` (15d858d), so it is approved.
- Step 11 waits on nothing. Step 12 is "After 11".
- Design contract: appliance-ui `DESIGN.md`, read for this work on 11 Nov 2026; the baseline and its amendments win
  where they differ.
- Brief 1's rule for every brief: tests and browser checks run on the Mac. Nothing here runs the full suite on the
  Pi.

## Done means

A22 brief 1's "Done when", numbered, plus the acceptance every step carries (decision 1):

1. No page's title is its area's name.
2. The seven label fixes of A22 section 8 are in the Assistant.
3. The old lab API answers 404, once the Assistant is back and the caller check is clean.
4. Each of the eleven Assistant views that are in no menu is at least in ⌘K, and `runs` still opens Work.
5. Pi Hub's own names are right: Wall display, Settings with no "Setup" nameplate, `/privacy` in the Site map and
   ⌘K, an Assistant entry in ⌘K that opens `/assistant`, the app named "Pi Hub", and "Assistant" as the button's
   spoken name.
6. print-lab's `lab page` help and the kit's tool list use the same names.
7. The owner has looked at the live pages and it is recorded in `docs/operations.md`.

## What exists today (read on 11 Nov 2026)

Code read at each repo's `origin/main`: pi-hub 15d858d, LocalAI 5938b0f, appliance-ui e1e97ac (kit 2.16.0),
print-lab bc640ae.

**Live** (`release:` records, 22:52): Pi Hub runs 0ccd5c9. Local AI runs 90d11ba; its last update, on 10 Nov at
14:12, failed ("The automatic update failed; the deploy log on the host has the details"), and its last health
check on record is 8 Nov. A22's audit found the Assistant not answering on 11 Nov. LocalAI `main` is five merges
ahead of `release` (#522 to #526).

**Pi Hub**

- **A strip page is headed by its area.** `pageHeading` (`hub/static/js/system-strip.js:42-47`) returns the strip's
  label as the heading, so `/workshop` reads "Workshop", `/documents` "Documents", `/media` "Media", `/devices`
  "Home & network" and `/system` "System". `main.js:280-282` writes it to `#page-title` and sets the browser tab to
  "Page · Area · Pi Hub". `tests/test_area_strips.mjs` ("a strip page is headed by its area; the tab names the
  page") asserts today's behaviour.
- **The strips** (`system-strip.js:7-25`): System (7 pages), Workshop (Printer, Print lab, Quick Print), Documents
  (Papers, Print, Lists), Media (Movies, Drives), Home & network (Devices, Network, Weather).
- **Wall:** `main.js:62` titles `/wall` "Wall", and `main.js:281` writes "Wall" to the tab. The Site map and ⌘K
  already say "Wall display" (`map.js:15`, `command-palette.js:11`).
- **Settings:** the faceplate's nameplate reads "Setup" (`settings.js:24`). `faceplate()` uses `name` for both the
  nameplate and the section's `aria-label` (`page-parts.js:11-16`).
- **`/privacy`** is a page the server writes whole (`hub/app.py:1530-1552`), outside the shell. It is in neither
  `routes.js`, the Site map nor ⌘K. Google's consent screen for the off-site backup links to it.
- **⌘K** (`command-palette.js:9-30`) lists 20 pages and no Assistant entry. Its Go results leave out the `hub` tool
  (line 49). The Ask provider hands a question to the Assistant (line 112).
- **Names:** `manifest.webmanifest` has `"name": "Home"` and `"short_name": "Home"`. "Assistant (Local AI)" appears
  four times: `index.html:231`, `index.html:264`, `main.js:49` (which rewrites the label every minute) and the
  frame's title at `assistant.js:94`.
- **The kit copy:** `hub/static/ui/tools.js` is generated from the kit ("do not edit; change appliance-ui and
  sync") and names the `hub` tool "Home". `SHELL` is `pi-hub-shell-v198` (`sw.js:2`).

**The Assistant (LocalAI)**

- **The registry** (`app/public/view-registry.js`) is the one list its menu, palette and headings read. Against the
  seven fixes:
  1. Claude Code: the label is right, but `short:'Claude'` puts "Claude" in the strip.
  2. Atlas: the label is "Architecture" with `short:'Atlas'`; the heading is `<h1>Architecture</h1>`
     (`index.html:245`).
  3. In progress: the view is labelled "In progress", but the registry's own text still says "Doing"
     (`view-registry.js:40-41`), and the chip's word is to be read in the Changes page's code by its PR.
  4. Decisions: the view is "Inbox" in the registry, the nav button (`index.html:12`) and the heading
     (`index.html:227`).
  5. Assistant settings: the view and its heading are "Settings" (`index.html:237`).
  6. Developer tools: the view and its heading are "Tools" (`index.html:236`).
  7. A tab's heading is its parent's: Sources, Memory and Library read "Projects" (`index.html:113, 228, 107`), and
     Assistant automations reads "Work" (`index.html:219`). The registry's header comment states this as the rule
     ("shows the parent's heading").
- **Hidden views:** `runs`, `ask`, `create` and `spreadsheets` have `domain:'hidden'`; `ALIASES` sends `runs` to
  `work`. The palette is the kit's (`app/public/ui/palette.js`) fed from the registry.
- **Lab leftovers:** `app/print-lab.js`, `app/display-lab.js`, `app/lab-callers.js`, their routes
  (`app/server.js:151, 185, 600-601`), and five test files (`tests/print-lab-ui.mjs`, `print-lab.test.cjs`,
  `print-lab-requests.test.cjs`, `display-lab.test.cjs`, `lab-callers.test.cjs`). `/api/lab-callers` reports who has
  called the old API; it can only be read while the Assistant runs.

**print-lab:** `lab/page.py:134-135` says "the page itself is in Local AI" and "open the print lab page in Local AI";
the module's first lines say the same.

**appliance-ui:** `tools.json:5` names the `hub` tool "Home".

**The sprawl check fails on `main` before any change** ("rose above baseline: test_lint_findings +68, big_files +2",
seen on 11 Nov with #230). See "Out of scope".

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Done means: brief 1's "Done when", plus a recorded look by the owner.** Brief 1 lists four conditions and
   leaves Pi Hub's own name fixes and the two small repos to its table; criteria 5 and 6 name them so each has
   evidence. Criterion 7 is the ladder every step uses (merged, deployed, runtime verified, accepted).
2. **This step changes what a page is headed by, not what a page is called.** The heading becomes the page's strip
   word as it is today: "Devices" and "Network" stay until step 12.
   - **Model 1, titles only (recommended).** Brief 1 says "Not in this brief. Areas, the page list, any move of a
     page", and A22 section 3 makes `pages.json` the one place a page's name is written. Renaming Devices to Lights
     and Network to Internet here would write the new names into `system-strip.js` and `command-palette.js` by hand,
     and step 12 would then replace both.
   - **Model 2, rename now.** The owner sees "Lights" and "Internet" a step sooner.
   - The cost of Model 1: for one step the Network page is headed "Network" inside an area still called
     "Home & network". That is today's strip, unchanged.
3. **The browser tab stays "Page · Area · Pi Hub"** (A22 2.3: "as today"). Only the heading changes.
4. **The wall is "Wall display"** in its title and its tab (`main.js:62, 281`), matching the Site map and ⌘K.
5. **Settings' faceplate has no nameplate text, and is still named for a screen reader.** A22 2.3: "'Setup' on
   Settings becomes no nameplate at all". `faceplate()` gains an optional `label` used for `aria-label` when `name`
   is absent; Settings passes "Setup progress". The lamp ("2 steps left") stays where it is. Rejected: renaming the
   nameplate "Settings", which repeats the page's title one line below it.
6. **`/privacy` stays a page the server writes; it is listed, not moved.** It must open without a sign-in for
   Google's consent screen, so it cannot become a shell page. The Site map lists "Privacy" under System and ⌘K gets
   a "Privacy" entry; both are ordinary links (a full page load). It is not added to `routes.js` `pages`, which
   lists what the shell draws. Rejected: leaving it out because the household never needs it; A22's rule is that no
   page is reachable only by knowing its address.
7. **⌘K's Assistant entry behaves as the rail's Assistant button does.** One "Assistant" row in Go, area
   "Assistant", opening `/assistant`. While the PC is off or the Assistant is down it shows the same phrase the
   button shows (`assistantButton`, `sections.js:92-100`) as its hint. It adds no state of its own.
8. **All four "Assistant (Local AI)" strings become "Assistant".** Brief 1 names the two in `index.html`; the same
   words at `main.js:49` would put the old label back within a minute, and `assistant.js:94` is the frame's spoken
   name. A22 8.1 retires the phrase in "anything the owner reads".
9. **The app's name and short name both become "Pi Hub".** An icon already on a phone's home screen keeps "Home"
   until it is added again; the plan doesn't ask the household to do that.
10. **The kit change is a patch release, 2.16.1.** One name in `tools.json`, its generated `dist`, and the version.
    Pi Hub syncs it in the same PR that needs it. The Assistant is on kit 2.7.0 and takes the current kit in step
    13; it is not synced here.
11. **The Assistant's renames change labels, never addresses or ids.** `inbox`, `tools`, `settings`,
    `architecture` and `automationStudio` keep their ids and `#` addresses; each old word is added to the view's
    `aka` so ⌘K still finds it. The section names Ask and Setup wait for step 14 (brief 1 says so).
12. **A tab's heading is its own name.** The registry's rule ("shows the parent's heading") is reversed for Sources,
    Memory, Library and Assistant automations, and its comment is rewritten to say so.
13. **The Assistant's changes merge on the Mac's CI and ship when the owner decides to ship.** The failed update of
    10 Nov is not understood yet, and brief 1 makes shipping "the owner's call, not this brief's". So L1 below can
    merge, and criteria 2 and 4 are evidenced on the live Assistant only after a ship. Until then they are "merged,
    not deployed".
14. **The lab code is deleted only on a clean caller report read from the running Assistant**, as brief 1 says:
    "nothing is deleted on a guess". If the report names a caller, L2 stops and reports who. The step is not held
    open for L2: see Acceptance.
15. **Evidence is screenshots from the Mac's preview, then the live look.** Printer, Health and Papers at 390 and
    1440 px, light and dark (brief 1), from `tests/browser/preview.py`, pasted in H1's PR.

## The PRs, one at a time

Each is based on `main` of its repo. H1, K1, L1 and PL1 are independent and can be reviewed in any order. H2 waits
for K1's release. L2 waits for the caller report.

**P0 (this PR). The plan.** Coverage: plan only.

**K1. appliance-ui: the hub tool is named "Pi Hub"; kit 2.16.1.**
- Requirement: brief 1's appliance-ui row; A22 8.1 ("The site: Pi Hub"). Full.
- Changes: `tools.json`, the generated `dist/tools.js`, the version, the changelog line.
- Evidence: the kit's own checks pass; `dist/tools.js` names it "Pi Hub".

**H1. pi-hub: a page is headed by its own name.**
- Requirement: criterion 1; A22 2.3. Full for Pi Hub.
- Commit 1 (the test alone): `tests/test_area_strips.mjs` "a strip page is headed by its area" becomes "a strip
  page is headed by its own name; the tab names the page and its area". The reason, for the PR: A22 2.3 amends A7
  P1. It fails until commit 2.
- Commit 2: `pageHeading` returns the current strip entry's label as the heading; the comment above it is
  rewritten; `/wall` is "Wall display" (decision 4); `SHELL` becomes v199.
- New test (brief 1's): for every page in `routes.js`, the heading equals its strip label, or its `PAGES` title
  when it is on no strip; no heading equals a strip's area label unless the page's own name is that word.
- Evidence: both suites' counts; `structure.mjs` (one `h1`, axe) and the width sweep on the Mac; the twelve
  screenshots of decision 15.
- What the owner will see: the top of Printer reads "Printer", Papers "Papers", Movies "Movies", Devices "Devices",
  Health "Health". The strip under it and the rail are unchanged.

**H2. pi-hub: the leftover names.** After K1 is released.
- Requirement: criterion 5 (names) and criterion 6 (Pi Hub's copy of the kit). Full for those.
- Changes: `settings.js` and `page-parts.js` (decision 5); `manifest.webmanifest` (decision 9); the four strings of
  decision 8; `hub/static/ui` synced to kit 2.16.1; `SHELL` bumped.
- Tests: Settings' faceplate has no nameplate text and has an accessible name; the manifest's two names; no file
  under `hub/static` contains "Assistant (Local AI)"; the kit drift check reports 2.16.1, unmodified.
- Evidence: suite counts; a screenshot of Settings at 390 and 1440 px, light and dark; `structure.mjs`.

**H3. pi-hub: `/privacy` and the Assistant in the Site map and ⌘K.**
- Requirement: criterion 5 (the rest). Full.
- Changes: `map.js` lists "Privacy" under System as a plain link; `command-palette.js` gains "Privacy" and the
  "Assistant" row of decision 7; `SHELL` bumped.
- Tests: the Site map's data holds `/privacy` once, under System; `goResults("privacy")` and
  `goResults("assistant")` each return their row; with the PC off the Assistant row carries the button's phrase;
  `/privacy` still answers 200 without a session (existing server test, extended if it doesn't assert that).
- Evidence: suite counts; a screenshot of the Site map and of ⌘K showing each row.

**L1. LocalAI: the seven label fixes, and every view findable.**
- Requirement: criteria 2 and 4. Full in the repo; live only after a ship (decision 13).
- Changes: `view-registry.js` (labels, `short`, `aka`, the header comment) and the headings and nav button in
  `index.html`, per the list under "What exists today"; the chip reads "In progress".
- Tests: its registry tests updated for the new labels, each changed test in its own commit with the reason; one
  new test that every view in the registry, hidden ones included, is returned by the palette's search for its
  label, and that `runs` resolves to `work`.
- Evidence: LocalAI's local CI on the Mac (GitHub Actions doesn't run for it).

**L2. LocalAI: remove the old lab code.** Gated: see decision 14.
- Requirement: criterion 3; baseline D5. Full when it lands.
- Before any edit: read `/api/lab-callers` on the running Assistant and paste the report in the PR.
- Changes, only on a clean report: delete the three modules, their routes and their five test files; add a test
  that `/api/lab/projects` answers 404 and that nothing in `app/` requires the deleted modules.
- Evidence: the pasted report; local CI.

**PL1. print-lab: `lab page` says where the page is.**
- Requirement: criterion 6; brief 1's print-lab row. Full.
- Changes: `lab/page.py:134-135` and the module's opening lines say the page is Pi Hub's Print lab.
- Evidence: `lab page --help` output pasted; print-lab's tests.

**Owner steps**

- **O1. Merge each PR** (each on its own "merge").
- **O2. Deploy Pi Hub** after H1 to H3: the owner's Claude Code session, after the deploy preflight, with peers
  told. One deploy for the three, since the Pi is running warm.
- **O3. The Assistant's failed update of 10 Nov:** read the deploy log on the PC and decide whether to ship.
  `npm run ship` then carries #522 to #526 and L1. Starting or restarting the Assistant is a service action and
  needs the owner's word at the time.
- **O4. Look at the live pages** (Acceptance).

## Coverage

| Criterion | PR | Evidence |
|---|---|---|
| 1 Titles | H1 | the route-title test; twelve screenshots; O4 |
| 2 Seven labels | L1 | registry tests; live after O3 |
| 3 Old lab API 404 | L2 | caller report; the 404 test; live after O3 |
| 4 Views in ⌘K | L1 | the palette test; live after O3 |
| 5 Pi Hub's names | H1 (Wall display), H2, H3 | tests and screenshots named above; O4 |
| 6 print-lab and kit names | PL1, K1, H2 (sync) | help output; drift check |
| 7 Recorded | O4 | `docs/operations.md` |

## Acceptance

Recorded in `docs/operations.md` under "One site (A22)", in two parts, because half of this step waits on a machine
that is down:

- **Pi Hub half, "Accepted <date>":** after O2, the owner opens Printer, Papers, Movies, Health and Settings on a
  phone and a desktop and sees each headed by its own name; opens ⌘K and finds Assistant and Privacy; sees "Wall
  display" on the wall's tab. Criteria 1, 5 and 6.
- **Assistant half, "Accepted <date>":** after O3 and a ship, the owner sees the seven labels, finds a hidden view
  (Spreadsheets) through ⌘K, and `/api/lab/projects` answers 404. Criteria 2, 3 and 4.

Step 11 is "accepted" when both are recorded. Until then the status is the ladder's word for each half. Step 12
needs only the Pi Hub half merged: the baseline says "After 11", and nothing in step 12's first PRs (the kit's
`pages.json`) reads the Assistant's labels. If the owner reads "After 11" as "after 11 is accepted", step 12 waits
for O3; that is the owner's reading to give, and this plan flags it rather than deciding it.

## Out of scope (noted, not gated)

- **The sprawl check already fails on `main`.** Each PR here reports its own change against `main` and leaves the
  baseline file alone. Owner: a `/sprawl-audit` of pi-hub, as its own piece of work.
- **Why the Assistant's update failed on 10 Nov.** O3 is the owner's; this plan fixes nothing on the PC.
- **Lights, Internet, Household, Network, five areas.** Step 12.
- **The Assistant's section names Ask and Setup, and its second menu.** Step 14.
- **Icons already on a home screen** keep the name "Home" (decision 9).
