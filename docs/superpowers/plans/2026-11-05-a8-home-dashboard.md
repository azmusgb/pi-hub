# A8 Home is a dashboard: the day, Needs you and the systems on one screen — Plan

Date: 2026-11-05 · Status: **approved; decisions 1-11 as written (owner, "proceed with your recommendations", 5 Nov 2026)**; P3 added for A9 (proposed with #127) · Baseline: `2026-11-01-platform-product-architecture-design.md`
plus amendment A8 (`2026-11-05-amendment-a8-home-dashboard.md`, #123), which amends §5.5, §9 ("Home") and A7's P1 and
P3 for Home.

**Goal:** Home shows the state of the house at a glance on a phone, an iPad, the Mac and a TV: what happened today, what
needs the owner, and every system's live readings, as in the approved prototype
(https://claude.ai/artifact/2YFCdUfzb7ajwRMoWRe25M).

## Spec

- **A8, Decisions D1-D7, Not changed and Delivery.** Delivery: "One Pi Hub PR: `/api/today` with tests, Home's new
  layout replacing the control room on `/`, checked in the browser at 390, 820, 1180, 1440, 1920 and 3840 px, dark and
  light, with axe over Home."
- **Not changed (A8):** "A7 for every other page. The wall display (`/wall`) keeps its own board. The kit's look and
  tokens. The strip, rail, search and the Assistant button."
- **Waits on:** A8 states no dependency, and none is added here. A7's kit 2.6.0 (`renderList` with verb actions) is
  already synced (below).

## Done means

A8 gives no numbered criteria. Decision 1 proposes these, one per A8 decision:

1. **D1:** Home opens on the Today band: five lanes (X2D, Workshop display, Raspberry Pi, Backups, Updates) from local
   midnight to midnight, a Now line, hatched future, and four counts (prints finished, failed, power dips, updates
   shipped). Pointing at, tapping or tabbing to a mark writes "what, when" in the line under the band. "Since you last
   looked" is gone from Home.
2. **D2:** Needs you is drawn by `ApplianceNeeds.renderList`, `bad` items first; hovering, focusing or tapping an item
   that has a mark today lights that mark; AdGuard paused is not in the list (it is on the Network row).
3. **D3:** the Systems rack shows five rows (X2D, Raspberry Pi, Network, Storage, This week), lamp first, state in words,
   readings, and a link to the row's page; a row in warning has the warn wash.
4. **D4:** the readouts that are the point of a row use `--ui-stretch-readout`; Home has no camera and no camera timer.
5. **D5:** at 390, 820, 1180, 1440, 1920×1080 and 3840×2160, dark and light, the page matches A8's table: no horizontal
   scroll, the band's text the same size at every width, TV layouts fit one screen without scrolling; axe reports no
   violations on Home.
6. **D6:** with each source withheld in a test (Bambuddy, the record store, the self-check file, backups, releases) its
   lane or row stays in place and reads `source_down`'s words; a quiet day shows empty tracks and zero counts; loading
   shows kit skeletons.
7. **D7:** `GET /api/today` returns the lanes for the hub's local day, each with `source` and `available`, from the
   sources A8's table names, with the limits it states.

## What exists today (read on 5 Nov 2026, at `origin/main` 00ed176)

**Home (non-wall):** `now.js` `mount()` builds `.home-context` and calls `mountControlRoom(state, …, {search: false})`
with `state.homeMode = true` (`hub/static/js/now.js:1198-1209`). `load()` fetches `/api/now`, `/api/outside`,
`/api/home` and `/api/camera`, then `/api/needs` (`now.js:1226-1282`). A camera `<img>` timer runs every 2 s
(`now.js:1216-1223`). The router refreshes every 15 s and on becoming visible (`now.js:14`, `main.js:293`, `main.js:326`).

**Control room** (`hub/static/js/control-room.js`): `mountControlRoom` (478) opens `EventSource('/api/records/stream')`;
`renderControlRoom` (359) draws Now (printer hero 266, other active rows 297), Needs you (`mergeProblems` 173 →
`problemItems` → `renderList`) and Since you last looked (localStorage `pi-control-last-seen`, 241-254). Its only caller
is Home (`now.js:9`, `1205`); `command-palette.js:7` imports `navigateSpa`, `RECORD_LABELS` and `recordPath`; tests import
the pure helpers (`tests/test_control_room.mjs`, `tests/test_home_control.mjs`). `renderActiveItem` reads an undefined
`d` at line 322 on a branch only reachable off Home, where nothing mounts it (latent; found 5 Nov). The `.cr-*` styles
are in `hub/static/enhance.css` from about line 634.

**Sources the band can use:**

| Lane | Source today | Notes |
|---|---|---|
| X2D | `bambuddy.prints()` (`hub/bambuddy.py:105`), cached 60 s: `id, name, status, word, started, ended, seconds` | epoch seconds; `ended` null while running; returns `None` when Bambuddy doesn't answer |
| Workshop display | `record_events` (`hub/records.py:18`), `thing = workshop_display`, `new` offline/online; 30-day retention | `records.recent_events()` (`records.py:269`) returns `[]` on a database error, the same as an empty day |
| Raspberry Pi, self-check | `system.selfcheck()` (`hub/system.py:174`) reads `/var/lib/pi-hub-selfcheck/last.json`: `ts, passed, total, failed` | latest run only; nightly at 04:15 |
| Raspberry Pi, power | `record_events`, `thing = pi`, `new = power` (record built at `hub/things/house.py:117-126`) | `pi_power` is a flag ("Low voltage earlier" until reboot), not an event time |
| Backups | `/api/system/backups` (`hub/app.py:216`), helper-cached 300 s: `repos[{name, last}]` | latest run per repo only |
| Updates | `release:<target>` records, `detail.deployed_at` (`hub/releases.py:209-212`) | latest release per system only |

**Rack sources:** `/api/now` (`printer`, `pi`), `/api/pi` (`storage`, `selfcheck`, `updates`), `/api/workshop`
(`week`, `prints`), `/api/records` (`internet`, `adguard`, `pc`, `local_ai`, `backups`, `movie_copy`),
`/api/network/adguard`.

**Kit:** 2.6.0 synced in `hub/static/ui` (`renderList`, `.ui-skeleton` at `components.css:43`, `--ui-stretch-readout`).
AdGuard paused reaches Home's list only through `mergeProblems`' record branch (the `adguard` record, severity
attention, `hub/things/network.py:55`); `/api/needs` (`hub/needs.py`) doesn't carry it.

**Live (5 Nov, `mcp__home__hub_now` 15:30):** printing at 81 %; Needs: Ad blocking, Raspberry Pi (low voltage), E-026,
E-027; 27 records, none stale.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Done criteria** are the seven above, one per A8 decision, so acceptance is by looking at the page at the sizes A8
   names. Rejected: a single "matches the prototype" criterion, which nobody can check point by point.
2. **`/api/today`'s shape.** `{day: "YYYY-MM-DD", tz, now, lanes: [{id, label, source, available, marks: [...]}],
   counts: {finished, failed, power, updates}}`. A mark is a span `{start, end, kind, title}` or a point `{at, kind,
   title}`, times in epoch seconds, `kind` one of `ok|bad|warn|run|deployed`; `title` is the plain sentence the line
   under the band shows. The day is the hub's local day (`datetime.now().astimezone()`), the same clock every other
   Pi Hub time uses. Rejected: the browser computing the day from raw sources, which would put six fetches and the
   source quirks in JavaScript.
3. **A failed read is never an empty lane.** Each lane reads its source in its own `try`; a failure returns
   `available: false` and no marks, and the page says `source_down` for it. The record-store lanes query `record_events`
   in `today.py` with their own error path rather than through `recent_events()`, which returns `[]` on failure.
   `counts` adds only lanes that answered, and a count over a lane that didn't answer reads "—", not 0.
4. **Spans that cross midnight** start at 00:00 (a print or an outage that began yesterday). A running print is drawn
   from its print-log `started` to now, with its remaining time from `/api/now`'s `minutes_left` as the dashed ghost;
   a running entry with no `started` draws only the ghost. Rejected: the printer record's `detail.started`, which is
   when the hub first saw the print, not when it began.
5. **The low-voltage mark** is the time of the `record_events` row where the `pi` record changed to `power`, titled
   "Low voltage seen". When the flag is set but no row exists today (it was raised on an earlier day), the lane draws
   no mark and the Pi row keeps its warning. That is A8 D7's stated limit, not a new policy.
6. **Needs you is the same list as now, ordered and minus one item.** Home keeps `mergeProblems` → `problemItems` →
   `renderList`; the list is sorted `bad` before `attention` before `warn`, stable within a tone. A record in a
   deliberate state is left out of the merge: the table is `{adguard: ["paused"]}`, and A8 D2 is its authority. The
   Home badge counts the same filtered list, so the badge and the list agree (baseline §5.5). Rejected: lowering the
   `adguard` record's severity, which would also change Network and the wall; A8 changes only the Needs list.
7. **A need lights a mark by its record.** A record need lights the newest of today's marks in its lane (`pi` → Raspberry
   Pi, `workshop_display` → Workshop display, `printer` → X2D); a print-lab need (source "Print lab") lights the running
   print, if any. Anything else lights nothing. This is a pure function with its own tests.
8. **The rack reads the existing routes with the page's refresh.** One `Promise.all` of `/api/now`, `/api/pi`,
   `/api/workshop`, `/api/records`, `/api/network/adguard`, `/api/system/backups` and `/api/today`, each through
   `settle()` with a 6 s limit, every 15 s while visible, as Home does today. A row whose route didn't answer keeps its
   place and reads `source_down`; a row never shows the previous answer as current. Rejected: keeping the records
   `EventSource` for live rows; the 15 s poll is A8 D6's cadence and drops a long-lived connection per open Home. It
   costs up to 15 s of latency on a row that changes.
9. **Band and rack are Home compositions, not kit components.** They use only existing `--ui-*` tokens and kit text
   styles, in a new `hub/static/home-dashboard.css`, with no new token. The TV scaling uses CSS `zoom` (Safari, Chrome,
   Firefox 126+); a browser without it gets the 1440 layout at its size. Rejected: proposing them to appliance-ui
   first, since nothing else draws them; if the wall or the display adopts them, that is the moment to promote.
10. **The control room goes, proven dead first.** Home stops importing `mountControlRoom`, `loadControlRoom`,
    `leaveControlRoom` and `setControlNeeds`. The PR removes `renderControlRoom`, `renderPrinterHero`,
    `renderActiveItem` (and with it the undefined `d`), the mount/load/leave functions, the last-seen storage and the
    `.cr-*` CSS, after a grep at the PR's base shows no other caller. The pure helpers still used stay. A test asserts
    `control-room.js` no longer exports `mountControlRoom` and `now.js` imports nothing from it but helpers.
11. **The wall is untouched.** `isWallMode()` keeps its branch (`now.js:1182-1197`, `loadWall`); a test renders the wall
    path and checks its board still mounts.

## PRs, one at a time

### P1. Pi Hub: `GET /api/today`

- **Covers:** A8 D7 in full; D1's data and D6's source-down data.
- **Change:** `hub/today.py` (`build(now)` → the shape in decision 2), the route in `hub/app.py` next to `/api/now`, same
  auth as `/api/now`. No UI.
- **Tests (written first, `tests/test_today.py`):** a print yesterday 22:00 to today 01:50 starts at 00:00; finished,
  failed, cancelled and running prints map to `ok`, `bad`, `bad`, `run`; two prints in order and out of order; Bambuddy
  `None` → X2D `available: false`; display offline then online → one span, offline still open → span to now; record
  store raising → both record lanes unavailable, not empty; the Pi power row today → a `warn` point, none today → no
  mark; self-check from yesterday → no mark; backups and releases today vs yesterday; counts skip unavailable lanes;
  local midnight from a fixed TZ.
- **Merges alone.** Evidence: criterion 7 and the data half of 6.

### P2. Pi Hub: Home's dashboard

- **Covers:** A8 D1-D6 in full; decisions 6-11.
- **Change:** `hub/static/js/home-dashboard.js` (band, counts, rack, needs ordering and lighting), `now.js` non-wall
  branch mounts it, `home-dashboard.css` linked in `index.html` after `home.css`, `sw.js` cache version bumped,
  control room removed (decision 10).
- **Tests (written first):** `tests/test_home_dashboard.mjs` over `fake_dom`: lane layout narrow vs wide; a mark's
  target at least 24 × 40; Now line and hour labels don't collide; needs order and the deliberate-state filter; badge
  equals list length; need → mark lighting table; a route failing → its row reads `source_down`; a quiet day → zero
  counts and empty tracks; no camera element on Home. Existing tests that assert the control room on Home change in
  their own commit, named in the PR.
- **Browser:** `tests/browser/structure.mjs` and axe over Home with the stub, screenshots at A8's six sizes in dark and
  light attached to the PR.
- **Needs P1 merged** (it reads `/api/today`). Evidence: criteria 1-6 in the browser with stubbed sources.

### P3. Pi Hub: the band on a phone (amendment A9)

- **Covers:** A9 D1-D3 in full, and A8 D1's Now sweep on first load, which P2 left out (not in this plan's P2 list; found
  after P2 shipped).
- **Waits on:** A9 merged (#127).
- **Change:** `bandLayout` takes the span's end: one hour after Now, at least six hours after midnight, never past the
  next midnight, when the band is narrower than 520 px; hour steps follow the hours shown. The counts get short labels
  on phones, with the full words for screen readers. The Now line sweeps from midnight once per page load, under
  `prefers-reduced-motion: no-preference` only, and never on a refresh.
- **Tests (written first):** the phone span at 1 AM, 6 PM and 11:30 PM; a mark after the span's end is clipped, not
  dropped (the running print's dashed finish); hour labels don't touch at 300-519 px over each span; the wide band is
  unchanged; short labels only under 600 px; the sweep runs once and not with reduced motion.
- **Browser:** live hub at 320, 375, 390 and 430 px, dark and light, and at 1440 px to show desktop unchanged; axe over
  Home.
- **Evidence:** the owner's "squished" screen (IMG_1553) against the same view after the deploy.

### Coverage

| Criterion | Evidenced by |
|---|---|
| 1 Today band | P2 tests and screenshots; acceptance |
| 2 Needs you | P2 tests; acceptance |
| 3 Rack | P2 screenshots; acceptance |
| 4 Readouts, no camera | P2 test (no camera element); screenshots |
| 5 Sizes, axe | P2 browser run; acceptance on the iPhone, iPad and TV |
| 6 States | P1 tests (data), P2 tests (rendering) |
| 7 `/api/today` | P1 tests; acceptance (live response read) |
| A9 phone band, short counts, TV 1.2× | P3 tests and phone screenshots; acceptance on the iPhone |

## Acceptance

After P2 is deployed (by the owner's session, after `deploy_state`), the owner opens Home on the iPhone, the iPad
(both orientations), the Mac and the TV, and checks criteria 1-5 against the live day; one live `/api/today` response is
read and compared with the band. Recorded in `docs/operations.md` as "A8 accepted <date>". Until then A8 is merged,
deployed or runtime verified, never done.

## Out of scope (noted, not gated)

- **Event times the Pi doesn't keep:** a real low-voltage time needs `pi-status` to log power transitions, and a full
  release history needs each target's deploy log. Both change `deploy/` or other repos; follow-up issue to open in
  pi-hub after acceptance if the owner wants them.
- **The wall's board** keeps its own layout (A8, Not changed). Bringing the band to the wall would be its own amendment.
- **Live push for rack rows** (decision 8's latency trade): revisit only if the 15 s delay shows up in use.
