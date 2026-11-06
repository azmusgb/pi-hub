# A10 Responsive, not adaptive: one fluid scale and layouts that flow, site-wide — Plan

Date: 2026-11-05 · Status: **proposed** · Baseline: `2026-11-01-platform-product-architecture-design.md` plus amendment
A10 (`2026-11-05-amendment-a10-responsive.md`, #129), which amends the page rules as restated in A6 and A7, A8 D5, A9,
and the appliance-ui design contract (`DESIGN.md`).

**Goal:** every Pi Hub page fills the screen it is on. Type and space grow smoothly from a phone to a TV, columns appear
where they fit and stack where they don't, and no screen gets the cramped end of a fixed layout, as on the owner's iPad
and iPhone ("squished").

## Spec

- **A10 D1-D6, Not changed and Delivery.** Delivery: "A plan before code, in these PRs, each reviewable alone: 1.
  appliance-ui … 2. Pi Hub, shell … 3. Pi Hub, Home: D4. 4. Pi Hub, the other pages, one area per PR (Workshop,
  Documents, Media, Home & network, System) … 5. The width sweep (D6) as a script in `tests/browser`, run on every PR
  from step 2."
- **Not changed (A10):** "The anatomy of every page (A7), Home's content and order (A8), the kit's colours and contrast,
  the words, the wall display's board, and the workshop display."
- **Waits on:** A10 states no dependency beyond its own order, and none is added here. A8 and A9 are deployed
  (1cfcc26); their acceptance is still open (see Acceptance).
- **LocalAI:** "The Assistant's own pages pick up the fluid tokens through the kit; replacing its breakpoints is a
  follow-up in LocalAI's own plan."

## Done means

A10 gives no numbered criteria. Decision 1 proposes these, one per A10 decision:

1. **D1:** the kit's `fs1`-`fs7`, its space step and the readout sizes are fluid: today's size at 360 px, about 1.25×
   at 1920 px and wider, never smaller than today. They are set once in appliance-ui and synced; no Pi Hub stylesheet
   sets its own fluid curve. Colours and the contrast table are unchanged.
2. **D2:** no stylesheet in `hub/static` (the wall's rules and the kit's tokens for the workshop display excepted)
   has a `width` media query other than the shell's rail/tab-bar switch, which is marked as such. Components that
   rearrange do it with container queries or intrinsic grids.
3. **D3:** no content column, label column, gauge or chart has a fixed pixel width; the page's cap is in `rem`.
4. **D4:** Home has two columns where Needs you gets at least about 22 rem and Systems about 36 rem, stacked otherwise;
   rack rows rearrange by their own width; the band's rows, bars, name column and type scale with its width, names go
   above the tracks when beside doesn't fit, the whole day shows when an hour gets at least 24 px, otherwise midnight to
   an hour after Now (at least six hours); no TV zoom.
5. **D5:** the workshop display (480 × 320) and `tokens.h` sizes it uses are unchanged.
6. **D6:** `tests/browser/sweep.mjs` checks every page from 320 to 2560 px in 20 px steps, dark and light, for
   horizontal overflow, clipped text, small targets and overlapping marks or labels, and passes for every page.

## What exists today (read on 5 Nov 2026, `origin/main` a486841, appliance-ui 2ec587c)

- **Kit (appliance-ui 2.8.0; Pi Hub's copy is 2.6.0, `hub/static/ui/VERSION`).** `tokens.json` holds
  `size.fs1`-`fs7` = 12, 13, 14, 16, 20, 26, 34 (px), `space.unit` = 4, radii 4/6/9/14 and
  `headerHeight {wide: 48, narrow: 44, breakpoint: 720}`. `scripts/build.mjs` writes `dist/tokens.css`
  (`--ui-fs-1: 12px` …, `--ui-space: 4px`, and `@media (max-width:719px){--ui-header-h:44px}`) and `dist/tokens.h`
  (`#define UI_FS_1 12` … for the display, plus RGB565 colours). The kit's own stylesheets switch at windows too:
  `components.css` 760 and 599, `needs.css` 600, `palette.css` 760. `scripts/sync.mjs` copies `dist/` into an app with
  a `VERSION` file and refuses to replace a newer copy. `npm test` runs 87 tests including the contrast table.
- **Pi Hub's stylesheets.** 18 files, about 6,500 lines, linked in `hub/static/index.html:86-106`. `app.css` sets no
  root font size (16 px) and has its own tokens (`--rail-w`, `--rail-w-compact`, `--tabbar-h`, radii, glass). Font sizes
  are mostly `rem` already (221 rem or `clamp` sizes, 42 of them `clamp`; 3 in px); padding, gaps and widths are mostly
  px. No stylesheet uses a container query.
- **Width media queries, by file** (`git grep -n "@media" origin/main -- hub/static`):

  | File | Widths | Area |
  |---|---|---|
  | `app.css` | 861 and 860 ×4 (rail vs tab bar), 1180/861 (compact rail), 480, 560, 640 | shell |
  | `ambient.css` | 861 (`body[data-house="cinema"] .rail`) | shell |
  | `pages.css` | 1680 (page cap), 420 (`.wifi`) | shell; Home & network |
  | `enhance.css` | 640, 860 ×2, `(max-width:860px), (pointer:coarse)` ×2 | shell |
  | `components.css` | 480 | shell |
  | `ui/tokens.css`, `ui/components.css`, `ui/needs.css`, `ui/palette.css` | 719, 760, 599, 600, 760 | kit |
  | `home-dashboard.css` | 1000 (columns), 640 (phone), 1800 landscape (zoom 1.2) | Home |
  | `home.css` | wall: 441, 453, 481, 496, 1374; non-wall: 621 `.now-layout` 1024, 713 `.house-grid` 600, 889 `.hero`/`.quick-tasks` 600, 910 alerts 1181, 932 `.wx-now` 768, 1120 `.band-content` 600 | wall (out); Home |
  | `lab.css` | 960, 640, 641, 640, 760 | Workshop |
  | `workshop-pi-rich.css` | 1024/1023 | Workshop |
  | `movies.css` | 720, 540, 560 | Media |
  | `household-features.css` | 1280, 600 ×2 | Home & network |
  | `lists-rich.css`, `settings-rich.css`, `movies-print-rules-alerts-rich.css` | none | Documents, System, Media |

  Documents has no stylesheet of its own: its pages use the shell's and the kit's rules.
- **Page cap.** `pages.css:6-7`: `.stage .top, .stage main, .stage .foot { max-width: 1120px }`, and 1440 px from a
  1680 px window.
- **Home.** `home-dashboard.js:10` `NARROW = 520` switches the band's whole layout (A9); rows 44/52 px, bars 14/16 px,
  the phone span. `home-dashboard.css`: two columns 4 : 8 above 1000 px, phone block at 640 px (short count labels),
  TV zoom 1.2 at 1800 px landscape on `.home-context, .home-dash`. `sw.js` shell cache v157.
- **Browser checks.** `tests/browser/structure.mjs` (390 and 1440 px, dark and light, axe, seven pages) and `wall.mjs`
  pin Playwright 1.55.1, whose `chromium_headless_shell-1193` is not installed on the Mac; an earlier
  `npx playwright install` hung on its lock. Neither runs on release; they are run from the Mac.
- **Previewing a branch against live data.** During A8/A9 a throwaway proxy (session scratchpad, not in the repo)
  served a worktree's `hub/static` and forwarded `GET /api/*` to `https://hub.rahe-home.duckdns.org`, refusing every
  other method. It is how the A9 screenshots were taken.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Done criteria** are the six above, one per A10 decision, so each can be checked by a test, the sweep or a look.
   Rejected: "the sweep passes" alone, which says nothing about D1's scale or D5's display.
2. **One fluid curve, owned by the kit, on the root.** The kit's tokens become `rem` (`--ui-fs-1: 0.75rem` …,
   `--ui-space: 0.25rem`), and `tokens.css` sets the curve once:
   `html { font-size: clamp(100%, 0.9423rem + 0.2564vw, 125%) }`, which is 16 px at 360 px and 20 px at 1920 px and
   wider. Every `rem` in Pi Hub (221 font sizes already) then follows the same curve with no per-page work, the floor at
   360 px is exactly today's size, and a reader's own larger text setting still scales everything, because the curve is
   in `%` and `rem`. Rejected: a `clamp(…px, …vw, …px)` per token, which is seven curves to keep in step, doesn't move
   Pi Hub's own `rem` sizes, and stops following the browser's text size and zoom (a WCAG 1.4.4 risk). The trade: any
   Pi Hub `rem` that was sized for a fixed 16 px root now grows up to 25 %; the sweep (decision 8) is what catches one
   that no longer fits.
3. **What stays fixed.** Radii stay px (shape, not space). `tokens.h` keeps today's px values: the workshop display is
   a fixed screen (D5), and the build test asserts its `UI_FS_*` are unchanged. The kit's header height becomes
   `2.75rem` (44 px at 360 px, 55 px at 1920 px) and its 720 px switch is removed, since it is not the rail/tab-bar
   switch D2 allows. Kit version **2.9.0**: token names don't change, their values and units do.
4. **The shell's allowed window switches** are the rail versus tab bar (`app.css` 860/861, `ambient.css` 861) and the
   compact rail (`app.css` 1180/861), each marked `/* A10 D2: shell switch */`. `enhance.css`'s touch rules become
   `(pointer: coarse)` only: a target's size depends on the pointer, not the width. Everything else in the table above
   is replaced.
5. **Page cap 70rem** (1120 px at a 16 px root, about 1,260 px on a 1366 px iPad landscape, 1,400 px from 1920 px),
   replacing both `pages.css` rules. Rejected: no cap, which leaves 2560 px lines of text on a desktop.
6. **Home (D4) in concrete terms.**
   - `.home-dash` is a container; at `@container (min-width: calc(58rem + gap))` it becomes
     `minmax(22rem, 2fr) minmax(36rem, 3fr)`, otherwise one column. The 1000 px query and the 4 : 8 split go.
   - Each rack row is a container: name, readings and link on one line when the row is at least 34 rem, readings under
     the name below that. The count tally gets its short labels by its own container width, not the 640 px window.
   - The band reads its own width and computed font size. Row height, bar height and the name column are in `em` of
     the band's type (today's 44 px row = 2.75em at 16 px). Names sit beside the tracks when the track beside them would
     give an hour at least 24 px for the whole day; otherwise names go above and the track takes the full width. The span
     is the whole day when an hour gets at least 24 px on that track, otherwise A9's rule (midnight to Now + 1 h, at least
     six hours). `NARROW = 520` goes. Hit boxes stay at least 44 × 44 px.
   - The TV's 1.2× zoom and its 1800 px query go.
   - A9's tests that assert the 520 px switch or the 640 px short labels change in their own commit, named in the PR.
7. **One check that the switches stay gone.** `tests/test_css_responsive.mjs` (node, runs on release with the other
   `.mjs` tests) fails on any width media query in `hub/static/**/*.css` that is not marked as a shell switch, except
   the wall's rules (selectors under the wall's `body` class) and a pending list of files. Each area PR deletes its
   files from the pending list, so the list only shrinks and is empty after P9. Rejected: relying on review, which is
   how 30 switches accumulated.
8. **The sweep (D6) as a script.**
   - `tests/browser/sweep.mjs [base-url]` opens each of the seven pages once per colour scheme in a touch context
     (`hasTouch`, so `pointer: coarse` and the 44 px floor apply), then resizes the window from 320 to 2560 px in
     20 px steps, at 900 px tall (1080 at 1920 and wider), checking after each resize. That is 113 widths × 2 schemes
     × 7 pages without reloading.
   - Checks: `scrollWidth > innerWidth` on the document; an element whose text is wider than its box and whose
     overflow hides it without an ellipsis and full text in a `title` or label; a link, button or field under 44 × 44
     px; and boxes that intersect among children of any element marked `data-no-overlap` (the band's hour labels, Now
     label and lane names, the tally, rack readings). Generic text overlap is not checked; it is too noisy to gate on.
   - It writes a JSON report and screenshots at the named sizes (320, 390, 820, 1024, 1180, 1366, 1440, 1920, 2560)
     for the owner. A pending-pages list, like decision 7's, lets it gate from P3 while areas are still adaptive.
   - The trade: checking only in a touch context misses a mouse-only layout bug; there is no mouse-only layout after
     decision 4, so the mouse pass is the existing `structure.mjs` at 390 and 1440.
9. **The sweep runs a branch against live data, read-only.** `tests/browser/preview.py` (stdlib only) serves a
   worktree's `hub/static` and forwards `GET /api/*` to the live hub, refusing every other method with 405, plus an
   `--fixture` flag for the long-content and empty states. Committed with the sweep, so the check is reproducible, not
   a session artefact. Rejected: a stub API only, which never shows real names and real lengths; a deploy per PR, which
   puts the check after the release instead of before the merge. Setup needs Playwright's pinned browser on the Mac
   (`npx playwright install chromium`); if the install's lock hangs again, the PR says so and runs the sweep with
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointed at an installed Chromium, recorded in the evidence.
10. **Areas keep their own PRs, in the spec's order,** and each converts its px widths and paddings to `rem` or
    `clamp()` only where the sweep or D3 needs it, not as a blanket rewrite. Documents has no stylesheet of its own;
    its PR is the sweep passing for `/documents` after P4, plus any fix that pass finds.
11. **LocalAI picks up the kit** in one small LocalAI PR syncing kit 2.9.0, shipped by the owner's usual
    `npm run ship -- <PR>` after local CI. Replacing LocalAI's breakpoints is its own plan, as A10 says.

## PRs, one at a time

Every Pi Hub PR below bumps `sw.js`'s shell cache, attaches the sweep report and the named-size screenshots, and is
deployed after merge with the deploy preflight. None is stacked on another: each is based on `main` after the one before
merges.

### P1. appliance-ui: fluid tokens, kit 2.9.0

- **Covers:** A10 D1 in full; D2 for the kit's own stylesheets; D5's `tokens.h`; decisions 2 and 3.
- **Change:** `tokens.json` sizes and space as rem (floors kept as the px they equal), `scripts/build.mjs` writes the
  root curve and rem tokens to `tokens.css` and unchanged px to `tokens.h`; header height 2.75rem, its 720 px switch
  removed; `components.css`, `needs.css`, `palette.css` switch by container, not window; `DESIGN.md`'s Type, Space and
  shape, "Layouts adapt to the width" and "Before a screen is done" rewritten to A10 (fluid scale, D2, the sweep).
- **Tests (written first):** `build.test.mjs`: `tokens.css` has no px font size or space, the root curve gives 16 px
  at 360 and 20 px at 1920 and 2560 (evaluated), `tokens.h`'s `UI_FS_*` and colours are byte-identical to 2.8.0; no
  width media query in `dist/*.css`; the contrast table unchanged.
- **Merges alone.** Evidence: criterion 1 and 5.

### P2. Pi Hub: the width sweep and the responsive lint

- **Covers:** A10 D6 in full (as a tool), decisions 7, 8 and 9.
- **Change:** `tests/browser/sweep.mjs`, `tests/browser/preview.py`, `tests/test_css_responsive.mjs` with every
  current file pending; `data-no-overlap` on the band's labels, the tally and rack readings; README lines in
  `tests/browser`.
- **Tests:** the lint passes on `main` with everything pending and fails on a fixture stylesheet with an unmarked width
  query; `preview.py` refuses POST, PUT and DELETE (a pytest).
- **Merges alone,** independent of P1. Evidence: the baseline sweep report of `main`, which is the "before" every later
  PR is measured against.

### P3. Pi Hub: the shell

- **Covers:** A10 D1 in Pi Hub (kit synced), D2 for the shell, D3's page cap; decisions 4 and 5.
- **Waits on:** P1 and P2 merged.
- **Change:** kit 2.9.0 synced into `hub/static/ui`; `pages.css` cap 70rem (both rules replaced); `app.css`,
  `ambient.css`, `enhance.css`, `components.css` reduced to the marked shell switches, touch rules by pointer; their
  files leave the lint's pending list; `pages.css`'s `.wifi` 420 px rule becomes intrinsic.
- **Tests:** the lint with the shell files no longer pending; the sweep passes for the shell (rail, tab bar, strip,
  search, Assistant button) on every page; `structure.mjs` and axe at 390 and 1440.
- **Evidence:** criterion 3's page cap and the shell half of 2; screenshots of Home at 820, 1024 and 1366 before and
  after.

### P4. Pi Hub: Home (A10 D4)

- **Covers:** A10 D4 in full; decision 6; Home's non-wall rules in `home.css`.
- **Waits on:** P3 merged.
- **Change:** `home-dashboard.css` (container columns, row containers, tally by container, zoom removed),
  `home-dashboard.js` (`bandLayout` from the band's width and font size, `NARROW` removed), `home.css`'s six non-wall
  queries replaced. The wall's five rules are untouched.
- **Tests (written first, `tests/test_home_dashboard.mjs`):** names beside vs above at the measured threshold; the span
  is the whole day exactly when an hour gets 24 px and A9's span below it, at 1 AM, 6 PM and 11:30 PM; row and bar
  heights scale with the font size; hit boxes stay 44 × 44; hour labels don't touch at every band width from 280 to
  2400 px in 20 px steps; no zoom rule. A9's tests that assert 520 px and 640 px change in their own commit.
- **Browser:** the sweep for `/`, and screenshots at the named sizes plus 1920 × 1080 for the TV.
- **Evidence:** criterion 4; the owner's IMG_1578 (iPad) and IMG_1553 (iPhone) screens against the same views after.

### P5-P9. Pi Hub: the other pages, one area per PR

Each covers A10 D2 and D3 for its area, waits on P3, leaves the lint's pending list, and passes the sweep for its pages.
They can merge in any order after P3; the spec's order is kept unless one is blocked.

- **P5 Workshop:** `lab.css` (960, 640, 641, 640, 760) and `workshop-pi-rich.css` (1024/1023).
- **P6 Documents:** the sweep for `/documents` and any fix it finds (decision 10).
- **P7 Media:** `movies.css` (720, 540, 560); `movies-print-rules-alerts-rich.css` is already query-free and only
  needs the sweep.
- **P8 Home & network:** `household-features.css` (1280, 600 ×2) and its `pages.css` rules.
- **P9 System:** `settings-rich.css` and `lists-rich.css` are query-free; the sweep for `/system` and any fix.

After P9 the lint's and the sweep's pending lists are empty; that PR asserts they are.

### P10. LocalAI: kit 2.9.0 sync

- **Covers:** A10's "The Assistant's own pages pick up the fluid tokens through the kit"; decision 11.
- **Waits on:** P1 merged. Independent of P2-P9.
- **Change:** `node scripts/sync.mjs` into LocalAI's kit folder on a branch on the Mac; LocalAI's own breakpoints left
  alone (its follow-up plan).
- **Owner step:** `npm run ship -- <PR>` after local CI; that is LocalAI's deploy.

### Coverage

| Criterion | Evidenced by |
|---|---|
| 1 D1 fluid kit | P1 build tests; P3 sync; acceptance (type grows on the iPad and TV) |
| 2 D2 no window switches | P2 lint, emptied by P3-P9 |
| 3 D3 no fixed widths, rem cap | P3 (cap), P4-P9 sweeps |
| 4 D4 Home flows | P4 tests and sweep; acceptance on the iPhone, iPad and TV |
| 5 D5 display unchanged | P1 test (`tokens.h` identical) |
| 6 D6 sweep passes | P2 tool; P9 asserts no pending pages |
| The Assistant follows the kit | P10 |

## Acceptance

After P4 is deployed, the owner opens Home on the iPhone, the iPad (both orientations), the Mac and the TV and checks
criterion 4 and that nothing is squished; after P9, the same for the other pages on the iPad and the iPhone. A8 and A9's
acceptance is still open and A10 amends A8 D5 and A9, so this plan proposes one record covering all three after P4's
look: "A8, A9 and A10 (Home) accepted <date>" in `docs/operations.md`, then "A10 accepted <date>" after P9's. Until
then A10 is merged, deployed or runtime verified, never done.

## Out of scope (noted, not gated)

- **The wall's board** (`/wall`, five rules in `home.css`) keeps its own fixed layout (A10, Not changed).
- **The workshop display** (D5).
- **LocalAI's breakpoints:** its own plan, as A10 says; P10 only syncs the kit.
- **print-lab's Fusion panel and blueprint report** follow `DESIGN.md` (print-lab #39) but are not web pages served by
  Pi Hub; they pick up the contract's text when next changed.
- **Running the sweep on release:** it needs a browser, which the Pi's release check doesn't have; it runs from the Mac
  on each PR. Moving it into a CI runner would be its own plan if the owner wants it.
