# A37 Printer pilot: the Printer page says its reading — Plan

Date: 2026-11-25. Status: **proposed** (approved when the owner merges this PR); nothing built.

## Goal

Workshop › Printer opens with one or two sentences that say what the printer is doing, with the plate and its action
under them, so the first screen on the phone, the iPad and the laptop answers "what is it doing, and what can I do".
The owner then uses the live page on all three and says go or stop for the rest of A37.

## Spec

- Amendment A37, `docs/superpowers/specs/2026-11-25-amendment-a37-spoken-readout.md`, approved by the owner's merge of
  pi-hub #344 (`002303e`) and listed under the baseline's `## Amendments`. This plan covers **Migration step 2** only:
  "Pi Hub pilot: Printer (`/workshop`), after the kit sync. It needs nothing from A36." and its **Gate**.
- Decisions built here: **R1** (the head is the reading) and **R2** (the kit writes the sentence; Pi Hub supplies
  facts), both for the Printer page only, and **R4** for the Printer's plate, less its last sentence (the meter's fill
  is kit release two). R3, R5, R6 and R7 are not touched.
- The design is the kit's spec, `appliance-ui/docs/superpowers/specs/2026-11-25-spoken-readout-design.md` (S1, S2,
  S4), merged in appliance-ui #58.
- **Waits on:** "after the kit sync" (A37 step 2). Kit 2.32.0 is merged (appliance-ui #59, `1d6f8c4`); the sync is
  pi-hub #347, open. Nothing else: A37 says the pilot "needs nothing from A36".

## Done means (A37 "Evidence required", quoted, the parts that name the Printer)

1. "`tests/`: the Printer's mapping from `/api/now` to the kit's reading for printing, paused, finished, failed and
   idle, and for a stale, a down and a never-read source".
2. "Browser, per moved page: the width sweep from 320 to 2560 px in dark and light with no overflow, clipping or
   overlap; axe with no serious or critical finding; keyboard only, focus kept across a refresh; the `h1` holds the
   page's name for a screen reader."
3. "First screen, asserted: at 390 × 844 the sentence and either the plate's action or the first ask's action; at
   1024 × 1366 and 1440 × 900 the sentence, the plate and the first ask."
4. "The live page after each release, read at the three sizes, with what was seen in the PR."
5. The Gate: "the owner uses the live page on the phone, the iPad and the laptop, then says go or stop. Stop reverts
   one page and ends this amendment's rollout".

Criterion 1's Home and `more` clauses, and criterion 3's "first ask" on Home, belong to later steps.

## What exists today (read on 25 Nov 2026, `origin/main`: pi-hub `002303e`, appliance-ui `1d6f8c4`)

- **The page head is the shell's, not the page's.** `hub/static/index.html:143-153` holds `h1.brand#page-title` and
  `p.top-sub#page-subtitle` inside `header.ui-shell-head.top`, with the Search button (`:158`) and the Assistant link (`:168`) beside them. The router
  writes the name at `hub/static/js/main.js:281` and the purpose at `main.js:122-128` and `:282`. No page module
  touches the `h1`; `page-parts.js` has no head part.
- **The Printer page** is `hub/static/js/workshop.js` (2,277 lines). `mount()` (`:46`) draws a loading faceplate;
  `load()` (`:2164`) runs every 15 s (`every`, `:13`), reads `/api/workshop` and five optional sources, and redraws
  the band only when its signature changes (`:2197`). `failed()` (`:2271`) draws a "No answer" faceplate with a
  readout of "—" when `/api/workshop` doesn't answer.
- **The plate today** is `printerPlate()` (`workshop.js:1681`), pure and tested (`tests/test_a7_workshop_lab.mjs`),
  built by `faceplate()` (`page-parts.js:12`): nameplate and lamp, the readout ("45 %"), a caption ("Done in about 6 h
  16 min, around 9:42 PM." or the card's `detail`), a progress bar (`.line`, Pi Hub's own), a source-and-age line
  (`ws-freshness`), "Last print", six readings (Print, Layer, Nozzle, Bed, AMS, Material), the owner's buttons, and
  the camera as the aside.
- **The facts come from one card.** `/api/workshop`'s `printer` is `now.printer_from(records.get("printer"))`
  (`hub/app.py:485`), "the same card /api/now gives", so A37's "from `/api/now`" and this page's read agree. The card
  (`hub/now.py:211-232`) has `state` (`printing`, `paused`, `stopped` for a finished record, `error` for a failed one,
  `idle`, `none`; `PRINTER_STATE`, `:177`), `progress`, `minutes_left`, `job_name`, `stale`, `as_of` (epoch seconds),
  `actions`, and `telemetry` `{status, source, observed_at}` where `status` is `live`, `degraded` (the Pi's backup
  readings), `stale`, `offline` or `none` (`_telemetry`, `:193`).
- **Two facts the card cannot give honestly today:**
  - `progress` is `0` when the record has no number (`now.py:222`: `pct if isinstance(pct, (int, float)) else 0`), so
    "not known" and "0%" are the same value.
  - The record knows when its state last changed (`since`, `hub/records.py:153`), which for a finished record is when
    the print ended; the card doesn't pass it on.
- **The kit, after #347:** `hub/static/ui/say.js` (`ApplianceSay.compose`, `render`) and the classes `ui-say`,
  `ui-vh`, `ui-faceplate--plate`, `ui-faceplate__job` in `components.css`. Nothing loads `say.js` yet:
  `index.html:341` loads `ui/needs.js` as a classic script, and `hub/static/sw.js:3` lists the kit's files it caches.
  The kit's own rules were written and tested for the plate **without** an aside (`demo/say.html`); `--plate` with
  `--aside` (the camera) has not been drawn anywhere.
- **Checks:** `node --test tests/*.mjs` with `tests/helpers/fake_dom.mjs`; `pytest`; from the Mac,
  `tests/browser/sweep.mjs` (320 to 2560 px, dark and light, already covers `/workshop`), `structure.mjs` (axe) and
  `preview.py` (this checkout's pages over the live hub's data, read-only). `AGENTS.md`: a change under `hub/static`
  bumps `SHELL` in `sw.js` (now `pi-hub-shell-v240`); the sprawl and kit-literals checks run on every PR.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Two PRs, so "stop" reverts one.** PR A adds two fields to the printer card (decision 2); PR B is the page. A stop
   at the gate reverts PR B alone; PR A's fields are additive, read by nothing else, and stay. Rejected: one PR, where
   a revert would also remove fields a later page might already read.
2. **The card gains `percent` and `since`; nothing is renamed.** `percent` is the same number as `progress`, or `null`
   when the record has none; `since` is the record's own `since`. The page's mapping reads `percent`, never
   `progress`, so a missing reading is never "0% through". Rejected: treating `progress: 0` as unknown in the page
   (a print really is at 0% for its first minutes). A37's "No new route, store, page or key" is kept: these are two
   fields on an existing response, and "key" there means a credential.
3. **The mapping is one pure function, `printerReading(card, opts)`, in a new `hub/static/js/printer-reading.js`.**
   Home will use the same function at step 4, so it does not live in `workshop.js`. It returns the kit's reading and
   writes no words. The table:

   | The card | The kit's reading |
   |---|---|
   | no card yet (first load) | `state: "loading"` |
   | `telemetry.status` `live` or `degraded` | `state: "live"` |
   | `stale` true, or `telemetry.status` `stale` | `state: "stale"`, `as_of` = the card's `as_of`, `source` = `telemetry.source` |
   | `telemetry.status` `offline` | `state: "unavailable"` |
   | `state: "none"` with `telemetry.status` `none` | `state: "unknown"` |
   | `/api/workshop` failed, a card was read earlier | that card as `state: "stale"`, `source: "Pi Hub"` |
   | `/api/workshop` failed, no card ever read | `state: "unavailable"` |
   | `state` `printing` / `paused` / `stopped` / `error` / `idle` | `status` `printing` / `paused` / `finished` / `failed` / `idle` |
   | `percent` (null stays null) | `percent` |
   | `job_name` through `jobTitle()` | `job` |
   | `minutes_left` | `left_min`; `done_at` = `as_of` + `minutes_left` |
   | `since`, only when `status` is `finished` | `finished_at` |
   | `actions` includes `clear` | `plate_ask: true` |

   Times go to the kit in milliseconds. `name` is not passed, so the kit says "X2D".
4. **Backup readings are `live`.** With `telemetry.status` `degraded` the numbers are current, from the Pi's status
   service; the plate's job line names that source, as the page does today. Rejected: `stale`, which would put a
   current reading in the past tense.
5. **Printer offline is `unavailable`: "The X2D isn't answering."** Bambuddy answered and said the printer is not
   connected. Two readings: (a) `unavailable`, which is what the owner would find at the printer; (b) `unknown` ("The
   X2D hasn't reported yet."), which is false once it has reported. Chosen: (a). The kit has no "offline" status and
   this plan adds none.
6. **When the hub's own status doesn't answer, the head keeps the last card in the past tense.** "The X2D was 45%
   through Clip 12 min ago. Pi Hub hasn't answered since 3:06 PM." With no earlier card it is "The X2D isn't
   answering." This trades precision for honesty in the second case: the sentence names the printer when the silent
   party is the hub; the plate's lamp ("No answer") and its line say which. Rejected: leaving the last live sentence
   up (a stale reading in the present tense, A37's first anti-goal), and a Pi Hub phrase of its own (R2: Pi Hub writes
   no sentence text).
7. **`done_at` is counted from the card's `as_of`, not from the browser's clock at draw time,** so the estimate does
   not slide later with each redraw. This is this plan's choice; the spec is silent.
8. **An idle printer gets no "Its last print finished at…".** The card has no time for the last finished print once
   the record is idle (`since` is then when it became idle). The plate keeps today's "Last print" line. Rejected:
   passing `since` for idle, which would state a time the hub did not read.
9. **The head stays the shell's `h1#page-title`; a page opts in.** A page module that exports `says = true` gets the
   `h1` as `ui-say` in loading state at route time, and no purpose line; the router clears both when the next page
   opens. The page calls a new `sayHead(composed)` in `page-parts.js`, which is the only caller of
   `ApplianceSay.render`. Every other page is drawn exactly as today. Rejected: a second `h1` inside the page (two
   `h1`s, and A22's one name per page).
10. **Search and the Assistant stay in the shell head, in a row above the sentence on a saying page** (R1), by one
    modifier on the existing header in `app.css`. The kit's `ui-page__head--say` is not used: the shell's head is the
    kit's `ui-shell-head`, and wrapping it would change every page.
11. **What the plate keeps and drops.** Kept: nameplate and lamp; the job line (`ui-faceplate__job`: the job's name
    and "source · age", today's `ws-freshness`); the meter; "Last print"; Layer, Nozzle, Bed, AMS, Material; the
    buttons; the camera aside. Dropped: the readout and "%"; the "Done in about…" caption (the sentence says it); the
    "Print" reading (the job line says it). The card's `detail` (for example "Check that the printer is on and
    Bambuddy can reach it.") is kept as the job line when nothing is printing and the reading is not stale.
    The meter becomes the kit's `ui-meter` with today's ARIA; its colour changes only with kit release two.
12. **If the plate and the camera aside don't compose, the fix is a kit patch release (2.32.1), not Pi Hub CSS.** The
    kit never drew the two together. Step B3 looks first; a Pi Hub override would be an edit the next sync can't see.

## PRs, one at a time

Each names A37 and states its coverage. PR A can merge any time; PR B needs #347 and PR A merged.

### PR A: the card says what it doesn't know (`hub/now.py`)

- A37 R2, partial (the facts the mapping needs). Evidence: tests.
- `printer_from()` adds `percent` (number or `None`) and `since` (the record's, or `None`). `progress` is unchanged.
- Tests, in `tests/test_printer_card.py` (it already covers `printer_from`), written first:
  - a record with no progress number gives `percent: None` and `progress: 0`;
  - a record at 0 gives `percent: 0`;
  - a failed record gives `percent` = its `last_progress`;
  - `since` is the record's `since`; no record gives neither field a value (`None`), and the existing keys are
    untouched (Home, the wall and `printer-actions.js` read this card's existing keys).
- Checks: `pytest`, the sprawl check. No `hub/static` change, so no `SHELL` bump.

### PR B: the Printer page (`hub/static`)

A37 R1, R2 and R4 (less the meter's fill) for one page: full for the Printer, partial for the amendment.

- **B1. The mapping.** `hub/static/js/printer-reading.js`, `printerReading(card, { failed = false, last = null })`.
  Tests first, `tests/test_a37_printer_reading.mjs`, one per row of decision 3's table, and these by name:
  - printing, paused, finished, failed and idle each give their `status`;
  - stale: `state: "stale"`, with `as_of` in milliseconds and the source's name;
  - down (`failed` with `last`): the last card, stale, `source: "Pi Hub"`; `failed` with no `last`: `unavailable`;
  - never read (`state: "none"`): `unknown`, never `idle`;
  - `percent: null` stays null, and `progress: 0` beside it is ignored;
  - `since` is passed only for finished; idle passes no `finished_at`;
  - a card with unknown `state` or `telemetry.status` gives `unknown`, never a guess;
  - each result, run through the real `ApplianceSay.compose` (loaded from `hub/static/ui/say.js`), gives the expected
    sentence, so the two halves are tested together, not against a copy of the kit's words.
- **B2. The head.** `index.html` loads `/static/ui/say.js` beside `needs.js`; `sw.js` lists it and `SHELL` goes up;
  `page-parts.js` gains `sayHead(composed)`; `main.js` handles `mod.says` (decision 9) and resets the `h1` on every
  route; `app.css` gains the header's row (decision 10). Tests first, `tests/test_a37_say_head.mjs`:
  - on `/workshop` the `h1` has `ui-say`, a hidden "Printer: " label and no purpose line; `document.title` is
    unchanged;
  - leaving for `/system` gives back the plain `h1` and its purpose line, with no `ui-say`, `data-say` or `aria-busy`
    left behind;
  - before the first answer the `h1` is the skeleton with `aria-busy`, never text;
  - a second identical reading does not touch the DOM (the kit's `render` returns false).
- **B3. The plate.** `faceplate()` takes `plate` and `job`; `printerPlate()` uses them (decision 11); `load()` and
  `failed()` call `sayHead(ApplianceSay.compose({ page: "printer", label, reading }, { now: Date.now(), ago:
  ApplianceNeeds.ago }))`, with `label` from the page list (A22). `failed()` keeps the last card (decision 6) and
  loses its "—". The band's redraw signature already changes each minute (`workshop.js:2197`), so a stale age moves.
  - `tests/test_a7_workshop_lab.mjs` asserts the readout and caption that R4 removes. Per `AGENTS.md`, those
    assertions change in their own commit, saying why (A37 R4), before the code.
  - New assertions: no `.ui-readout` or caption on the plate; the job line holds the job and the source's age; the
    meter has `role="progressbar"` with the percent; no meter when `percent` is null; nothing the head says is drawn a
    second time as text on the page (the percent, the estimate).
  - Dead code removed and proven dead first: the `.line` bead rules for this page in `workshop-pi-rich.css`, if no
    other page uses them (`git grep` for callers; the sprawl check).
- **B4. The browser checks**, from the Mac against `preview.py`, in the PR with their output:
  - `sweep.mjs --pages /workshop` at text 1, 1.15 and 1.3;
  - `structure.mjs` (axe: no serious or critical finding);
  - a new `tests/browser/printer-say.mjs`: at 390 × 844 the sentence and the plate's action are inside the first
    screen; at 1024 × 1366 and 1440 × 900 the sentence and the whole plate are; the `h1`'s accessible name starts with
    "Printer"; a focused plate button is still focused after a refresh. It uses fixtures for printing, paused, stale
    and a failed `/api/workshop`, so the states don't depend on what the printer is doing that day;
  - screenshots at phone, tablet and desktop widths, light and dark, looked at and attached;
  - `ui-ux-reviewer` and `qa-release` before the PR opens.
- **B5. Deploy and the live read.** After the owner says merge: the deploy preflight (`deploy_state`), `git push pi
  main` by the owner's session, then the live `/workshop` read at 390, 1024 and 1440 px, with what was seen written in
  the PR (criterion 4). A matching commit is a deploy, not the check.

### Which step evidences which criterion

| Criterion | Step |
|---|---|
| 1 mapping tests | PR A's tests; B1 |
| 2 sweep, axe, keyboard, `h1` name | B2 (name), B4 |
| 3 first screen | B4 (`printer-say.mjs`) |
| 4 live page read | B5 |
| 5 the gate | **owner**, below |

## Owner steps

1. Merge pi-hub #347 (the kit sync), then this plan.
2. Say "merge" for PR A and PR B when each is ready.
3. **The gate.** Use the live Printer page on the phone, the iPad and the laptop, through at least one print and one
   idle spell, then say **go** or **stop**. The gate is that use, not a date.
   - Go: kit release two is planned next (A37 step 3).
   - Stop: PR B is reverted in one PR and deployed; R5 to R7 are not built (A37 call 6).

## Acceptance

Recorded in `docs/operations.md` as a row for A37 step 2: merged, deployed, runtime verified (B5's read), then
"Accepted <date>: go" or "Stopped <date>" in the owner's words. No status doc says the pilot is done before that row
has the owner's answer.

## Out of scope (noted, not gated)

- Home, the Needs-you rows, the grid rows on Pi Hub's lists and the badge (R3, R5, R6, R7): A37 steps 3 and 4, each
  with its own plan after a go.
- The meter's fill colour: kit release two.
- "Needs you here" on the Printer page keeps today's boxes until R5.
- The wall and the Workshop display: unchanged by A37.
- Every other page keeps its title and its purpose line for now. R1 also drops the purpose line from pages with no
  reading; that goes with each page's own move (A37 step 4), not with the pilot.
- `/assistant` signed out at 1440 px draws a nested shell (seen 25 Nov while reading the live hub). Not part of A37;
  it needs its own `/fix`.
