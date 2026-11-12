# Step 13, One site: the shared values and the check. Both apps read one `tokens.css`, and a check stops new literals — Plan

Date: 2026-11-12 · Status: **proposed** · Covers: baseline §11 step 13, amendment A22 brief 3
(`docs/superpowers/specs/2026-11-11-amendment-a22-one-site.md`, merged in #230 as 15d858d).

**Goal:** every colour, size, space, radius, shadow, duration and layer in Pi Hub and the Assistant comes from the
kit's `tokens.css`, the Assistant gains a light theme, and a check in each repo fails a PR that adds a new literal or
a private name. Nothing is meant to look different except the Assistant in light, and the places A22 itself names.

## Spec

- Baseline §11 step 13: "**One site: the shared values and the check (A22, brief 3).** The kit's added values, both
  apps on one `tokens.css`, the ratchet check. Its first PR per repo can follow the kit release; the rest runs beside
  14-16."
- A22 section 12, Brief 3 (the table of changes, "Done when", "Tested by", "Order").
- A22 section 1 (the rule, the values to add, what each app changes, the build check), 6.4 (the "← Pi Hub" bar),
  8.4 (the PC's phrases), 9.5 O3 (the bar's accessibility).
- A22 is under the baseline's `## Amendments` on `origin/main`, so it is approved.
- **Waits on:** nothing but its own kit release. The baseline gives step 13 no "After". Step 14 waits on this step's
  first LocalAI PR ("after LocalAI takes the current kit (13's first PR there)").
- Design contract: appliance-ui `DESIGN.md`, read at the start of each PR here, not from this plan.
- Brief 3 inherits "for every brief": tests and browser checks run on the Mac; nothing runs the full suite or a
  deploy on the Pi.

## Done means

Brief 3's "Done when", numbered, plus the recorded look every step carries:

1. Both apps load the same `tokens.css`.
2. The Assistant has a light theme.
3. No private name remains for a kit value in either app.
4. Both baselines are lower than on the day they were committed.
5. The check fails on a PR that adds a hex colour.
6. The look is recorded in `docs/operations.md`.

Brief 3's table also changes print-lab (two pages take the kit) and adds `ui-backbar` and two phrases to the kit.
"Done when" does not name them; decision 9 says how this plan treats them.

## What exists today (read on 12 Nov 2026)

Code read at `origin/main`: pi-hub e3dfe6b, appliance-ui 89e7df3 (kit 2.18.0), LocalAI 1108ba8, print-lab 89c12bf.

**Live:** the Pi runs 793c248 (steps 11 and 12; `main` is one docs commit ahead). The Assistant runs `release`
90d11ba; its `main` is not shipped, so nothing merged to LocalAI since 10 Nov is live.

**The kit**

- `tokens.json` has `color` (17), `font`, `size` (`fs1`-`fs7`), `radius` (`r1`-`r4`), `space.unit`, `headerHeight`
  and `fluid`. It has no spacing steps, pill radius, shadow, backdrop, duration, easing or layer.
- The kit's own CSS writes five literals: the palette's backdrop `rgb(0 0 0 / .5)` and `.14s ease-out`
  (`src/palette.css:2,18`), the skeleton's `1.6s ease-in-out` (`src/components.css:43`), and two lamp rings drawn with
  `currentColor` (`components.css:27-28`).
- `check/` holds `verify.mjs` and `verify.py`; `scripts/sync.mjs` copies `dist/`, `fonts/` and those two into an app
  and writes `VERSION`. There is no `check/literals.mjs`.
- `consumers.json` lists pi-hub, LocalAI and the display. `npm run drift` today: pi-hub current; LocalAI
  `behind-needs-change` (copy 2.7.0; 2.9.0 and 2.17.0 need a consumer change); the display behind at 2.15.0, skippable.
- `PHRASES` (`src/needs.js:15`) has `pc_off: 'The PC is off or asleep'` and `assistant_down`; no `pc_waking`. The
  same table is built to `dist/needs.h` for the display. There is no `ui-backbar`.

**Pi Hub**

- Loads the kit's `tokens.css` first (`hub/static/index.html:86`), then 15 stylesheets of its own (6,838 lines).
- The alias layer: `app.css:5-58` (`--bg`, `--surface`, `--text-2`, `--accent`, `--danger`, `--r-xs`-`--r-full`,
  `--glass-*`, `--ease`, `--dur`, `--shadow-1/2`, `--font-*`) and `enhance.css:7-23` (`--spring`, `--smooth`,
  `--snap`, `--z-*`, `--s-1`-`--s-10`, `--sh-1`-`--sh-3`). 105 distinct private names are defined across the 15 files,
  139 definitions in `app.css` alone.
- A rough count of mine over the 15 `.css` files (not the check's; the check's numbers are the ones that count, and
  A22's audit counted 308, 333 and 981 with scripts and pages included): colour 269, type size 301, spacing 920,
  radius 95, motion 48, shadow 23, layer 18. Largest: `home.css`, `app.css`, `lab.css`, `enhance.css`, `pages.css`.
- Pi Hub keeps its own copy of the two phrases (`hub/static/js/sections.js:63`) beside the kit's.
- `tests/test_appliance_ui.py` runs the kit's `verify.py`; nothing checks literals. The Pi's release runs
  `node --test tests/*.mjs`, so a check added there also runs on the Pi at each deploy.

**The Assistant (LocalAI)**

- `index.html:6` loads `/ui/components.css`, `/app.css`, `/ui/needs.css`; **not** `tokens.css`. `<html>` is fixed to
  `data-theme="dark"`. `app.css` (2,679 lines, the only stylesheet) defines every `--ui-*` name itself
  (`app.css:789-794`), on top of `--ds-*`, `--ux-*` and `--st-*`: 860 mentions, 111 distinct private names.
- `app.css` has no `rem` value, so the kit's fluid root will not move the Assistant's own sizes; it moves only what
  the kit draws there (Needs you rows, the page parts).
- Colours of the kit did not change between 2.7.0 and 2.18.0, so `tests/appliance-ui.test.cjs`'s colour test still
  holds after a sync. Its other test requires each `--ui-*` name to be aliased in `app.css`, which loading
  `tokens.css` makes wrong.
- The same rough count over `app.css`: spacing 1,015, colour 201, radius 55, shadow 44, layer 33, motion 33, type 32.
  Scripts and pages hold 139 more colour literals in 17 files; the largest are `ui.js` (40) and `street/*.js`.
- It calls no `toolsFor('documents')` or `toolsFor('media')`, so kit 2.17.0 asks nothing of it. Kit 2.9.0 does: the
  kit's parts size by their container.
- `scripts/local-ci.mjs:253` runs "Kit drift", warn-only. `tests/design-system-ui.mjs` and `tests/visual-ui.mjs`
  (stored screenshots under `tests/visual/`) are its look checks; both assume dark.

**print-lab**

- `tools/camera_fit/index.html` (498 lines, one `<style>`, 7 colour literals) is served by `server.py`, which answers
  `/`, its API and `/assembly/img/` and nothing else. `tools/fusion/ParamsPanel/palette.html` (640 lines, 19 colour
  literals) is one self-contained file that Fusion opens from disk. Neither loads the kit.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Three kit releases, not one.** K3 the values, K4 the check, K5 the bar and the phrases. Brief 3 writes one row
   ending "Release". Split, each can be reviewed alone, and the first PR in each app needs only K3 and K4. Rejected:
   one release, which would hold the values behind the bar's design.
2. **The new values are web values only.** `tokens.css` and `tokens.json` gain them; `tokens.h` does not, because the
   display draws no shadow, sheet or animation from the kit. K3 is therefore "skippable" for the display. No new
   value carries text, so `docs/contrast.md` gains no row; if the appliance-ui PR changes a number so that one does,
   the row comes with it (1.3).
3. **What the check reads.** A22 1.5 names "any `.css` file and any `style` attribute or `<style>` block"; its counts
   and its allow list ("the Agent World art files", which are scripts) show it also means colours written in scripts.
   So: a `.css` file and a `<style>` block are read in all eight categories; a `style="…"` attribute, in a page or in
   a script's markup, likewise; a script is otherwise read for colour literals only. **The trade:** a size set through
   `element.style` in a script is not seen. Seeing it needs a parser, and the check is a text scan that runs in under
   a second on the Pi. Rejected: scanning stylesheets only, which would leave LocalAI's 139 script colours unwatched.
4. **The baseline's shape and its one-way rule.** `.kit-literals-baseline.json` holds the kit version it was measured
   with and a count per file and category. The check fails when a count is above the baseline (a rise), when it is
   below (the PR must lower the baseline), when a file is new and not zero, and when the baseline names a file that
   is gone. `--write-baseline` writes lower numbers and refuses to write a higher one; raising a number is a hand
   edit that shows in the diff. Rejected: a writer that records whatever it measures, which would let a rise pass
   unnoticed.
5. **The per-instance list lives in `.kit-literals-allow.json`**, as `names` beside `files`. A22 1.5 says "the app's
   per-instance list" without saying where. Pi Hub's starts with 1.4's list (`--pct`, `--x`, `--y`, `--size`, `--vx`,
   `--vy`, `--vz`, `--box`, `--wall-*`, `--cam-*`, `--band-accent`) and no file; LocalAI's starts with the Agent
   World art files and the names its first PR finds are per-instance, each named in that PR.
6. **Step 13 ends at its six criteria, not at zero literals.** Criterion 3 is about names; criterion 4 asks only that
   the baselines went down. Spacing and type literals that remain after the names are gone stay under the ratchet
   and fall in later work. Rejected: holding the step open until every count is zero, which brief 3's "never a gate"
   rules out.
7. **A clean-up PR is one stylesheet, and the alias definitions go last.** Brief 3: "one file at a time". Each PR
   replaces every private name used in one stylesheet with its `--ui-*` name and lowers the baseline; scripts and
   pages that use a name go with the stylesheet that defines the part. The definitions in `app.css` and `enhance.css`
   are deleted in the last PR, when nothing reads them. **The trade:** 15 stylesheets and the last PR are 16 Pi Hub PRs. Six stylesheets are
   under 150 lines; this plan lets those six share two PRs (11 stylesheet PRs and the last one, 12 in all), and says
   so in each. If the owner wants strictly one file each, it is 16.
8. **Where a rename changes the look, the PR says so.** Most aliases point at the kit value already and change
   nothing. A22 1.3 names the ones that do not: five radii round down onto the kit's four, glass becomes `--ui-bar`
   or `--ui-surface`, five shadows become two, four easings become one. Brief 3: "a visible change is a finding to
   explain". Each clean-up PR carries before and after screenshots of the pages its stylesheet draws, phone and
   desktop, both themes, and lists each visible difference with the A22 line that asks for it. A difference with no
   such line is fixed or brought to the owner.
9. **print-lab, the bar and the phrases are in this step and are evidenced by their own PRs**, though "Done when"
   omits them. print-lab takes one copy of the kit at `tools/ui/` (one new line in `consumers.json`); Camera fit's
   server gains a read-only `/ui/<file>` route for the files `VERSION` lists, and the Fusion panel links the copy by
   a relative path. Rejected: a copy beside each page, which is two consumers for two small pages. The bar is used
   where this step already touches a page: Camera fit (P1) and the Privacy note (H6). The Assistant's "← Home" link
   becomes the bar in L3. Each is partial coverage of 6.4 until all three are in.
10. **The phrases.** `pc_off` becomes "The PC is asleep" and `pc_waking` "The PC is waking up": 8.4's headings, as
    `assistant_down` already is. 8.4's short forms and sentences belong to the banner, which is brief 4. In H6 Pi Hub
    drops its own copy (`sections.js:63`) and reads the kit's `PHRASES`, so the Assistant button's label changes
    from "The PC is off or asleep" to "The PC is asleep". The button stays disabled until brief 4 enables it.
11. **The Assistant's light theme is switched on last.** `data-theme="dark"` stays on `<html>` until no private
    colour name is left; a page half on kit values would be unreadable in light. The last LocalAI PR removes the
    attribute and reruns the look checks in both themes. Rejected: switching it on with L3.
12. **LocalAI's clean-up order** is the shell and shared parts first, then Setup, Improve, Projects, Work, Ask:
    brief 4's order, so each section's values are the kit's before or as it becomes content. Type moves from the px
    set (13, 15, 17, 22, 28) to the kit's scale section by section; the mapping of each size is stated in the PR
    that makes it.

## The PRs, one at a time

Each PR is based on `main` of its repo, names the requirement it implements, says full or partial, and pastes its
evidence. Pi Hub PRs that touch `hub/static` bump `SHELL`.

**appliance-ui**

- **K3, the values (kit 2.19.0).** A22 1.3, full. `tokens.json` gains `--ui-s-1`-`--ui-s-8`, `--ui-r-pill`,
  `--ui-shadow-1/2`, `--ui-backdrop`, `--ui-dur-1/2`, `--ui-ease`, `--ui-z-bar/toast/sheet/palette`; `DESIGN.md`'s
  token table names each. The kit's own literals (the backdrop, the palette's `.14s ease-out`) use them. Evidence:
  build and tests; `npm run contrast` unchanged or with its new rows; the demo screenshots before and after.
  Changelog: skippable.
- **K4, the check (kit 2.20.0).** A22 1.5, full. `check/literals.mjs` and its tests; `sync.mjs` copies it beside
  `verify.mjs`. Tests, by name: each of the eight categories is rejected and each allowed form passes; a rise fails;
  a fall without a lowered baseline fails; a new file with one literal fails; a removed file still in the baseline
  fails; an allowed file is skipped and an allowed name passes; two files are reported in a fixed order; the writer
  refuses to raise a number; **adding one hex colour to a fixture exits 1 and names the file and category**
  (criterion 5). The kit runs it over its own `src/` with a baseline of its own. Changelog: skippable (an app turns
  the check on in its own PR).
- **K5, the bar and the phrases (kit 2.21.0).** A22 6.4, 8.4 and 9.5 O3, full for the kit. `ui-backbar`: one link in
  `<nav aria-label="Pi Hub">`, first in the document, 44 px high, not sticky, the arrow `aria-hidden`, the name "Back
  to Pi Hub". `pc_off` reworded, `pc_waking` added; `needs.h` follows. Evidence: tests, demo screenshots in both
  themes, axe on the demo. Changelog: needs consumer change (web): an app with its own copy of `pc_off` drops it.

**pi-hub**

- **H6, check on.** Brief 3's pi-hub row, first half. Sync to the current kit; commit `.kit-literals-baseline.json`
  and `.kit-literals-allow.json`; `tests/test_kit_literals.mjs` runs the check in `node --test`; `sections.js` reads
  the kit's phrases; the Privacy note gains the bar. Evidence: the check's output; both suites; the sprawl check; a
  scratch run with one hex added, exit 1, pasted (criterion 5 for Pi Hub).
- **H7 to H17, one stylesheet each, the six small ones in two** (decision 7), smallest first, `home.css` and `app.css` late. Criteria 3 and 4,
  partial each. Evidence per PR: the check's output with the lowered baseline; the width sweep; decision 8's
  screenshots; axe through `structure.mjs`.
- **H18, the alias layer goes.** Criterion 3, full for Pi Hub. `app.css:5-58` and `enhance.css:7-23` keep only what
  the allow list names. A test asserts no custom property outside `--ui-*` and the allow list is defined.

**LocalAI**

- **L3, the current kit and `tokens.css`.** Brief 3's LocalAI row, first half; criterion 1, full. Sync 2.7.0 to
  current: each kit part gets a container-sized parent (2.9.0). `index.html` loads `/ui/tokens.css` first; the
  `--ui-*` definitions at `app.css:789-794` are deleted; the alias test in `tests/appliance-ui.test.cjs` is changed
  **in its own commit** (it now asserts `tokens.css` is loaded and `app.css` defines no `--ui-*` name); the baseline
  and the allow list are committed; the check is a step in `scripts/local-ci.mjs` beside "Kit drift"; the "← Home"
  link becomes the bar. Evidence: local CI's counts; the check's output; `design-system-ui.mjs`; the stored
  screenshots, with each changed one explained (the kit's parts now scale with the root).
- **L4 to L9, by section** (decision 12): shell and shared parts, Setup, Improve, Projects, Work, Ask. Criteria 3 and
  4, partial each. The `fs-1` assertion (`appliance-ui.test.cjs:31`) is changed in its own commit in the PR that
  moves that size. Evidence per PR: the check's output with the lowered baseline; local CI; before and after
  screenshots of that section.
- **L10, light.** Criteria 2 and 3, full for the Assistant. `data-theme="dark"` leaves `<html>`; `design-system-ui.mjs`
  and the stored screenshots run in both themes; the stored set gains its light half in its own commit.

**print-lab**

- **P1, the two pages take the kit.** Brief 3's print-lab row, full. `tools/ui/` (synced), `consumers.json` in the
  kit gains print-lab in the same pair of PRs, Camera fit's `/ui/` route with a test that a path outside `VERSION`'s
  list is refused, both pages on kit values, the bar on Camera fit. Evidence: print-lab's tests; screenshots of both
  pages in both themes.

**Order.** K3, K4, then H6 and L3 at once (they are independent). K5 can land any time before H6 and L3, or be taken
by a later sync in each. Everything after H6 and L3 runs beside steps 14 to 16 and gates none of them. P1 needs K3
and K5.

## Coverage

| Criterion | PR | Evidence |
|---|---|---|
| 1 One `tokens.css` | L3 (Pi Hub already loads it) | a test in each repo that the page links the kit's file and defines no `--ui-*` name |
| 2 The Assistant in light | L10 | `design-system-ui.mjs` in both themes; screenshots; the owner's look |
| 3 No private name | H7-H18, L4-L10 | the check's "names" count at zero outside the allow list, in both repos |
| 4 Baselines lower | every clean-up PR | the first and the latest baseline, side by side, in the acceptance record |
| 5 A hex colour fails | K4, H6, L3 | the kit's test; a scratch run in each app, pasted |
| 6 Recorded | O3 | `docs/operations.md` |
| Brief's table: print-lab, bar, phrases | P1, K5, H6, L3 | decision 9 |

## Owner steps

- **O1. Merges.** Each PR on the owner's "merge" for it.
- **O2. Ship the Assistant.** Nothing in LocalAI is live until `npm run ship`. The last ship failed on 10 Nov; L3
  cannot be seen, and step 14 cannot be accepted, until that is cleared. Pi Hub deploys are the owner's session's,
  after the preflight.
- **O3. The look.** After H18 and L10 are live: the owner opens four pages of each app on a phone and a desktop and
  sees nothing changed in Pi Hub beyond what the PRs listed, and the Assistant readable in light.
- **Before the first LocalAI PR:** list the peer sessions and message whichever is working in LocalAI, so two sessions
  do not rewrite `app.css` at once.

## Acceptance

Recorded in `docs/operations.md` under "One site (A22)" as "Step 13 accepted <date>", after H18 and L10 are live and
P1 is merged:

- Both apps' pages link the same kit `tokens.css`, at the same kit version.
- With the system set to light, the Assistant is light, and the owner has read a page of each section in it.
- Each repo's check reports no private name; the first and the current baselines are written side by side.
- A scratch change adding `#ff0000` fails the check in each repo; the output is quoted.
- The owner has looked at four pages per app, phone and desktop, and found no change that a PR did not list.

Until then the status is the ladder's word: merged, deployed, runtime verified. H6 and L3 being merged makes the
check live, not the step accepted.

## Out of scope (noted, not gated)

- **The Assistant's ship is broken.** Local AI's update failed on 10 Nov and `release` is 90d11ba. Owner: the
  Assistant's own session and the owner; steps 11 (its Assistant half), 13 and 14 all wait on it for acceptance.
- **The display's copy** is at kit 2.15.0. The reworded phrase reaches the Workshop display only when its firmware
  repo syncs and is flashed; that is its own release, by its own plan.
- **LocalAI's 85 window-width media queries.** A10's rule (layouts by their own width) is enforced in Pi Hub only.
  Step 14 moves the Assistant's pages into Pi Hub's frame, where it will matter; it belongs to that plan.
- **The banner** (asleep, waking, down) and the enabled Assistant button are brief 4. This step only gives the kit
  the two phrases.
- **The sprawl check already fails on `main`** (`test_lint_findings`, `big_files`). Each PR reports its own change
  against `main`.
- **`tests/test_room_view.mjs` is flaky under load** (about 2 failures in 40 runs, none alone). It is not touched
  here; it needs its own fix PR.
