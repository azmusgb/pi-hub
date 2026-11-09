# A23 Room view controls on the picture: bars on the image, drag to frame, looks as chips, one group at a time — Plan

Date: 2026-11-09 · Status: **proposed** · Covers: amendment A23
(`docs/superpowers/specs/2026-11-09-amendment-a23-room-view-controls-on-the-picture.md`, merged in #218 as 7390981).

**Goal:** the owner changes the Room view without scrolling. Turn, flip, zoom and framing are done on the picture
itself, a look is one tap, and the panel below shows one short group at a time.

## Spec

- Amendment A23, decisions D1–D9, and its "Done means" (proposed there for this plan to adopt, see decision 1).
- A23 amends A20 D5 only. A17, A18 and A20 stand otherwise: the same controls and ranges (A18 C2), owner only (A18
  C1), live adjust (A20 D1), looks (A20 D2), snapshots (A20 D3), viewing tools (A20 D4) and validation (A20 D6). All
  three are live; A18 and A20 acceptance is still open and stays separate.
- A23 states no dependency beyond A20, which is live.
- Design contract: appliance-ui `DESIGN.md` after Pi Hub's baseline and amendments, with A10 (fluid) and A14 (text size).

**Before P1: the amendment list.** The baseline counts an amendment as approved once it is merged under
`## Amendments` (line 1012 of the baseline). Today that list holds A17, A18, A19 and A21. **A23 is not in it, and
neither is A20**, although #218 and #191 merged their files. A small docs PR (#219) adds both entries (A23: "Approved by the
owner on 9 Nov 2026 (pi-hub #218)") and sets each file's status line to match. P1 waits for the owner to merge it; no
step of this plan is built on an amendment that isn't listed.

## Done means

A23 gives seven criteria as "proposed, for the plan". Decision 1 adopts them unchanged:

1. While watching, the picture carries no camera controls.
2. While adjusting, turn, flip, mirror, zoom in/out, fit, grid, snapshot and full screen work from the picture, and the
   panel has no Turn, Mirror, Flip, Zoom or centre controls.
3. Dragging the zoomed picture moves the camera's framing, and the camera ends where the drag ended; arrow keys do the
   same in 1% steps.
4. One tap on a look chip applies it; Auto returns the look-able settings to the defaults.
5. The panel shows one of Light, Colour or Detail at a time; Manual exposure is folded.
6. At 320 px wide every control on the picture is fully visible, a 44 px target, and doesn't cover more of the picture
   than the three bars; the width sweep and axe pass; screenshots at phone, tablet and desktop, light and dark, are
   reviewed.
7. Owner acceptance on the real camera, recorded in `docs/operations.md`.

## What exists today (read on 9 Nov 2026; pi-hub `origin/main` 7390981, the Pi on 45c5e78)

- **The table** (`hub/room_camera.py:77`): 19 controls in six groups (Orientation, Framing, Light, Colour, Detail, Live
  quality). Every one is live (`LIVE_KEYS`, line 126). Looks may not hold `turn`, `mirror`, `flip` or `preset`
  (`FORBIDDEN_LOOK_KEYS`, line 122); the built-ins are at line 113. Live changes are limited to 10 per device per
  second (`LIVE_RATE`, line 130).
- **Orientation is split between the camera and the page.** `capture_args` (line 275) gives the camera 180°, mirror
  and flip; a quarter turn is left to the page, which rotates the picture in CSS (`workshop-pi-rich.css:119–129`) from
  `state().rotate` (line 472). Zoom and centre become a crop of the sensor (`--roi`, line 288), clamped so the crop stays
  on the sensor.
- **The live route** (`hub/app.py:727`) takes exactly one `{key, value}` and answers with the value, `live_values` and
  the state. `live_values` (`room_camera.py:384`) is cleared when the capture stops or a save applies.
- **The page** (`hub/static/js/workshop.js`, 1,617 lines):
  - `makeSettings` (322) builds the "Camera settings" disclosure: looks row, every group, then Save, Apply, Reset and
    Save snapshot. Opening it starts live and pins the picture (`ws-cam-box--pinned`).
  - `drawSettings` (504) and `syncSettings` (527) draw and update the groups; the centre sliders are disabled at 1×.
  - `renderViewTools` (805): Fullscreen, View zoom, Grid, Histogram under the picture. `attachViewingHandlers` (927):
    pinch and one-finger pan of the view, `+ − 0` and arrows.
  - `roomCam` (198) builds the figure; `drawCam` (1399) redraws it when the room state, size or turn changes, which
    opens a new live stream.
- **Two defects found while reading** (fixed in P2, see decisions 4 and 7):
  - `queueLiveControl` (430) keeps **one** pending change for all keys. `applyLook` (397) queues each of a look's
    values in a loop, so only the last reaches the camera: Night sends only `metering`. The panel shows all four, and
    Save stores all four, so the picture and the panel disagree until Save.
  - On iPhone, `toggleFullscreen` (884) clones the picture into an overlay. Cloning a live `<img>` opens a second
    stream, one of the four allowed viewers, and the clone carries no controls.
- **The kit:** icon-only buttons are `ui-btn--icon` with an `aria-label` (`hub/static/ui/components.css:110`). There is
  no kit tabs part; the Lists page has its own `tabs` row with `role="tablist"` (`lists.js:15`). `SHELL` is
  `pi-hub-shell-v195`.
- **Tests that cover this today:** `tests/test_room_view.mjs` (page), `tests/test_room_camera.py`,
  `test_room_camera_live.py`, `test_room_camera_looks.py`, `test_room_snapshots.py`; `tests/browser/sweep.mjs`.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Done means: adopt A23's seven as written.** Each is visible on the page, so each maps to a PR's screenshots or
   tests and to P5's walk-through (Coverage, below).
2. **A look and Auto reach the camera as one change: the live route also takes `{values: {...}}`.**
   - **Model 1, send each key in turn** (today's route): Auto resets 12 settings. At the page's 5 per second that's
     about 2.4 s, the picture changes in steps, and a refusal halfway leaves half a look.
   - **Model 2, one request with several values:** validated whole against the table (all or none), applied to the
     helper in one control message, counted as **one** change against `LIVE_RATE`, logged as today (not at all until
     Save). The single `{key, value}` form stays for sliders and taps.
   - **Recommended: Model 2.** A look is one tap (A20 D2, A23 D5); it should land as one picture change. Cost: one
     more request shape to validate and test. It is a change to A20 plan decision 5, which was this level's call.
3. **Auto is the defaults of Light, Colour and Detail, computed from the table.** The keys are every control whose
   `group` is Light, Colour or Detail, minus `preset` (A23 D6 puts Live quality's one control in Detail's tab, but A20
   D2 keeps it out of looks). So Auto never touches Turn, Mirror, Flip, Zoom, centre or preset (A23 D5). The page reads
   the groups from the hub's table; no key list is written in JavaScript.
4. **One pending value per control, newest wins.** The page keeps a pending map keyed by control and sends at most 5
   requests a second, as now. Five taps on Turn send one value: the last (A23 D2). Each control also remembers the
   camera's **last confirmed** value (from the route's answer); a refused or failed send puts that control back to it
   and says why in the status line. This fixes the one-slot defect above.
5. **The bars are built once and moved, never rebuilt.** A quarter turn changes the picture's shape, and `drawCam`
   rebuilds the figure. The three bars live on `state` (as the settings panel does) and are appended into whichever
   frame shows the picture: the page's, the browser's fullscreen element, or the iPhone overlay. On iPhone the overlay
   takes the frame itself and gives it back on Close, instead of cloning it, so full screen opens no second stream.
6. **Words on the bars, two icons.** Under DESIGN.md's writing and icon rules:
   - Top: the live badge (`ui-chip--live`, "Live · 10 fps" from the preset, or "Starting…" / "No picture: <reason>"),
     then **Turn 90°** (the label shows the turn now in force: "Turn 0°", "Turn 90°" …), **Flip**, **Mirror** with
     `aria-pressed`.
   - Side: **+** and **−** as `ui-btn--icon` with `aria-label` "Zoom in" and "Zoom out", then **Fit**. Their visible
     words are the bottom line's "Camera zoom 1.5×", which DESIGN.md requires for an icon-only control.
   - Bottom: "Camera zoom 1.5× · drag to frame" (at 1×: "Camera zoom 1×"), then **Grid**, **Histogram**,
     **Snapshot**, **Full screen**.
   - Targets 44 × 44 px with 8 px between. At 320 px the top and bottom bars wrap to two rows rather than shrink.
7. **Fit is one change of three values.** Zoom 1×, centre 50/50, through decision 2's form, so it is never seen half
   done.
8. **Drag maps the screen to the sensor through the picture's orientation.** The centre is a point on the sensor;
   the finger moves on the screen. The page undoes, in order, the CSS quarter turn, then the camera's 180°, mirror and
   flip, so "the picture follows the finger" holds at every turn. A pixel of drag moves the centre by
   `100 / (zoom × frame size)` percent, so the picture under the finger stays under it. The centre is clamped to the
   range where the crop can still move (`50 ± 50 × (1 − 1/zoom)`), so a drag never sends a value that changes nothing.
   - **Whether libcamera applies the crop before or after the camera's 180°, mirror and flip on this sensor is not
     read in the code.** P3 checks all eight combinations on the Pi and fixes the mapping before the page ships;
     the result goes in the PR as a table.
   - While dragging: the frame shifts at once with the existing `--vx/--vy` transform, the newest centre is sent
     at most 5 times a second, and the final centre is always sent on release, then the shift is cleared when the
     next frame arrives.
9. **Gestures by state.** Watching: pinch and one-finger pan change the view (A20 D4, as today). Adjusting at more than
   1×: one finger frames the camera, pinch does nothing, View zoom is reset to 1× on entering Adjust so two zooms
   never stack. At 1×: a drag does nothing. Keys while the picture has focus and Adjust is open: arrows move the centre
   1%, `+` and `−` change camera zoom by 0.5, `0` is Fit; while watching they keep A20's view meanings.
10. **"Unsaved changes" comes from the hub, not the page.** The Adjust summary says "Unsaved changes" while
    `state().live_values` holds anything that differs from the saved settings, so it is right on a second device too,
    and it goes when the camera restarts (A23 D7). The page's own `dirty` stays for the Save button.
11. **Tabs: the Lists page's `tabs` row, made a shared part first.** P4 moves it into `components.css` as `ui-tabs`
    (DESIGN.md: two to five tabs, 48 px high, 16 px labels, selected marked by wash, accent text and accent bar), uses
    it on Lists and here, and deletes the old copy. Arrow keys move between tabs, as the ARIA tabs pattern. The last
    tab is kept per device in `localStorage` under `hub-room-adjust-tab`, read in a try.
12. **What leaves the panel, and when.** P2 removes Turn, Mirror, Flip and Zoom from the panel (they are on the
    picture). The centre sliders stay until P3 ships drag and keys, so framing is never unreachable between PRs.

## What the camera state can say (for the bars)

- **Starting:** live opened, no frame yet. Badge "Starting…", every camera button disabled with that reason.
- **Live:** frame received. Buttons enabled; each shows the last confirmed value.
- **Sending:** a change is pending. The button shows the new value at once; nothing says "applied" until the answer.
- **Refused (422) or too fast (429) or no answer:** the control returns to its last confirmed value, the status line
  says why, focus stays where it was.
- **Live stopped** (hidden page, 5 minutes, four viewers): badge "Paused", camera buttons disabled, "Watch live"
  restarts it.
- **Camera unavailable:** badge "No picture: <A17 reason>", camera buttons disabled, Snapshot disabled.
- **Fallback engine (`rpicam`):** the bars stay, but a tap changes the panel's draft and says "Applies with Apply";
  drag is off (it would restart the capture on every move), and the bottom line says so.

## PRs, one at a time

No stacked PRs: each is based on main after the one before it merges. P1 can merge independently of the others.

### P1. Backend: several values in one live change (`hub/room_camera.py`, `hub/app.py`)

- **Covers:** decision 2 (full), backend for decisions 3 and 7.
- **Tests first** (`tests/test_room_camera_live.py`):
  - `{values: {...}}` with 1, 4 and 12 keys reaches the helper as one control message.
  - One bad key or value refuses the whole request with the field named; the camera gets nothing.
  - Every value is validated against the table, as the single form is; nothing else reaches the helper.
  - Both shapes count against `LIVE_RATE` as one change each; the 11th in a second gets 429.
  - A body with both `key` and `values`, an empty `values`, or more than 19 keys is refused.
  - Household and signed-out are refused. `live_values` holds every key after one request.
- **Evidence:** both suites' counts; after deploy, one `curl` of Night's values changes the stream once.

### P2. Page: watching and adjusting, the bars, the live channel (`workshop.js`, `workshop-pi-rich.css`)

- **Covers:** A23 D1, D2, D9 (full); decisions 4, 5, 6, 7, 10, 12. The rename to **Adjust**.
- **What the owner sees:** the Room view as today with Watch live, Full screen and the view tools. Open **Adjust**: the
  picture goes live, the three bars appear on it, the watching toolbar hides, and the panel holds the looks row, the
  remaining groups (Turn, Mirror, Flip and Zoom gone; centre still there), Save, Reset and the status line.
  Save snapshot moves to the bottom bar. Full screen keeps the bars.
- **Tests first** (`tests/test_room_view.mjs`): every state above; no camera control in the picture while watching;
  four Turn taps send one value; a refused Turn returns to the confirmed one; Night now sends all four values
  (the defect's regression test); a quarter turn moves the same bar elements into the new frame; the iPhone overlay
  moves the frame and opens no second image request; the summary's "Unsaved changes" follows `live_values`; owner
  only; Tab order top, side, bottom.
- **Checks:** sweep and axe; screenshots at 320, 390, 820, 1024 and 1440 px, light and dark, watching, adjusting,
  starting, refused, unavailable, fallback, full screen. SHELL bump in `sw.js`.

### P3. Page: drag and keys to frame; the centre sliders go (`workshop.js`, its CSS)

- **Covers:** A23 D3, D4 (full); decisions 8, 9, 12.
- **On the Pi first (measurement, a table in the PR):** for Turn 0°, 90°, 180°, 270° with and without mirror and flip,
  drag right on the zoomed picture and record which way the printer moves. Every row must read "follows the finger".
- **Tests first** (`tests/test_room_view.mjs`): the mapping for all eight orientations; the clamp at 2× and 4×; at 1× a
  drag sends nothing; a long drag sends at most 5 per second and always the release position; arrows move 1%;
  `+ − 0` mean camera zoom in Adjust and view zoom while watching; pinch does nothing in Adjust; entering Adjust
  resets View zoom; the fallback engine turns drag off.
- **Checks:** as P2, plus a drag on a phone-size touch emulation. SHELL bump.

### P4. Page: looks as chips, Auto, tabs, Manual exposure folded (`workshop.js`, `components.css`, `lists.js`, CSS)

- **Covers:** A23 D5, D6, D8 (full); decisions 3, 11.
- **What the owner sees:** chips **Auto**, Night, Bright, Bed close-up, their own looks, **Save this look**; the chip in
  force pressed, un-pressed by any later change. Tabs **Light**, **Colour**, **Detail**. Light shows Exposure
  compensation, Brightness, Contrast and a closed **Manual exposure** fold (Metering, Exposure mode, Manual exposure,
  Shutter, Gain; Shutter and Gain disabled until Manual is on). Colour: White balance, Saturation. Detail: Sharpness,
  Noise reduction, Live quality. Below: Save, Reset (inline confirm) and "Changes apply live. Save keeps them."
- **Tests first:** Auto's keys come from the table's groups and exclude preset; Auto and a look each send one request;
  a pressed chip un-presses on a slider change; the last tab survives a reload and a storage that throws; tab arrow
  keys; long look names and eight saved looks wrap; the Lists page's tabs still pass their tests with `ui-tabs`.
- **Checks:** as P2. SHELL bump. Sprawl check (the tabs move must not leave two copies).

### P5. Acceptance (owner)

- **Covers:** Done means 1–7.
- **Steps, on the phone at home, then away over Tailscale:**
  1. Watching: no camera buttons on the picture; pinch still zooms the view.
  2. Open Adjust. Set Turn to 180° (the picture is upside down today). Flip, Mirror, zoom in and out, Fit, Grid,
     Snapshot and Full screen, each from the picture. Confirm the panel has none of them.
  3. Zoom to 2×, drag the bed into the middle; the picture stays where you let go. Do it again with the arrow keys on
     a computer.
  4. Tap Night, then Auto; Auto leaves the framing alone.
  5. Walk the three tabs; Manual exposure is closed until opened.
  6. Close Adjust with a change unsaved: the summary says "Unsaved changes". Save it.
- **Record:** "A23 accepted <date>" in `docs/operations.md`, with the P3 orientation table. A18's and A20's
  acceptance lines are separate and still owed.

### Owner steps outside the PRs

- **The amendment-list PR (#219)** (before P1): merge.
- **Releases:** each deploy restarts `pi-hub`, as every release does, with the preflight; no confirmation needed.

## Coverage

| Requirement | Evidenced by |
|---|---|
| D1 watching and adjusting | P2 tests and screenshots, P5 steps 1–2 |
| D2 three bars, states, coalesced taps | P1, P2, P5 step 2 |
| D3 drag to frame, keys | P3 (Pi table, tests), P5 step 3 |
| D4 pinch view-only while watching | P3, P5 step 1 |
| D5 chips, Auto first | P1 (one change), P4, P5 step 4 |
| D6 tabs, Manual exposure folded | P4, P5 step 5 |
| D7 leaving keeps changes, "Unsaved changes" | P2, P5 step 6 |
| D8 Save, Reset, snapshots below | P2, P4 |
| D9 phone, keyboard, 44 px, reduced motion | P2–P4 checks |
| Done 1–2 | P2, P5 steps 1–2 |
| Done 3 | P3, P5 step 3 |
| Done 4 | P1, P4, P5 step 4 |
| Done 5 | P4, P5 step 5 |
| Done 6 (320 px, sweep, axe, screenshots) | P2–P4 checks |
| Done 7 | P5 record |

## Acceptance

The owner does P5 on the live page and the record goes in `docs/operations.md` as "A23 accepted <date>". Until then
the ladder applies: merged, deployed, runtime verified. A matching commit on the Pi is a deploy, not acceptance.

## Out of scope (noted, not gated)

- **A read-only Full screen for the household** (A23 "Not decided here", A17 R3's follow-up): an amendment if the owner
  wants it.
- **Timelapse:** A20's named follow-up, unchanged.
- **A shared tabs part in appliance-ui.** Decision 11 makes it a Pi Hub kit class; whether appliance-ui adopts it is
  that repo's call, raised there after P4.
