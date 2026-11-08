# A20 Room view richer controls: live adjust, quick looks, snapshots, viewing tools — Plan

Date: 2026-11-08 · Status: **proposed** · Covers: amendment A20
(`docs/superpowers/specs/2026-11-08-amendment-a20-room-camera-richer-controls.md`, merged in #191 as f85d593).

**Goal:** the owner adjusts the Room view's light, colour and detail while looking at it, with no restart gap. They can
tap a saved look, keep a snapshot, and inspect the picture on a phone with fullscreen, zoom, a grid and a histogram.

## Spec

- Amendment A20, decisions D1–D6, and its "Done means" (proposed there for this plan to adopt, see decision 1).
- A17 R5 and A18 C3, as A20 amends them: frames are never stored except an owner-tapped snapshot (D3), and the live
  group applies without a restart (D1). Everything else in A17 and A18 stands; both are live and A18's P3 acceptance
  is still open.
- A20 states no dependency beyond A17 and A18, which are live.
- Design contract: appliance-ui `DESIGN.md` after Pi Hub's baseline and amendments, with A10 (fluid) and A14 (text
  size).

## Done means

A20 gives five criteria as "proposed, for the plan". Decision 1 adopts them with one change, and they are numbered here:

1. A slider changes the picture within about 0.5 s on the owner's phone, with no restart gap.
2. A saved look applies in one tap and survives a Pi Hub restart.
3. A snapshot is saved, listed and deleted, and the 200 limit is shown to hold.
4. Pinch, pan and fullscreen work on a phone, and the controls pass axe and the width sweep.
5. With Picamera2 forced to fail, the Room view still works through A18's path.

## What exists today (read on 8 Nov 2026; pi-hub `origin/main` f85d593)

- **The capture** (`hub/room_camera.py`, 591 lines): `RoomCamera` runs one `rpicam-vid` child (`VID`, line 36) shared by
  at most `MAX_VIEWERS = 4` responses. It stops `STOP_AFTER = 10 s` after the last viewer, and a live response ends
  itself after `LIVE_LIMIT = 300 s`. A capture with no first frame in `FIRST_FRAME = 13 s`, or none for `STALL = 5 s`,
  has failed and is restarted once. `FrameSplitter` (line 268) cuts the MJPEG stream into frames. `apply()` (line 348)
  saves, marks the cached frame stale (`settings_at`) and restarts the child once. Every start and stop runs under one
  lock.
- **The table:** `CONTROLS` (lines 53–106), `validate()` (148) and `capture_args()` (215) are the one place a value
  becomes an argument. `describe_changes()` (253) writes the log text.
- **Routes** (`hub/app.py:644–728`): `/api/camera/room`, `/room.jpg`, `/room/live`, `/room/settings` (GET, POST) and
  `/room/settings/reset`, each `need(request, "owner")`. Writes then call `auth.log`.
- **The page** (`hub/static/js/workshop.js`): `cameraAside` (207), `roomCam` (184), the settings form (`settingField`
  247, `makeSettings` 287, `drawSettings` 328) kept outside the redrawn aside, and live start and stop (`startLive`
  789, `stopLive` 797).
- **The Pi** (read-only SSH, today):
  - Pi Hub runs under `/usr/bin/python3` (`ExecStart=/usr/bin/python3 -m uvicorn …`), user `pi-hub`, group `video`,
    `ProtectSystem=strict`, `ReadWritePaths=/var/lib/pi-hub`, `MemoryMax=200M`.
  - `python3-picamera2` 0.3.38-1, `python3-libcamera` and `libcamera0.7` 0.7.2 are installed (the OS image brought them).
    `deploy/install.sh:116–119` doesn't list them, so a rebuilt Pi gets them only if its image has them.
  - Camera memory (CMA): 512 MB total. 114 MB free now with no capture running; it was 29 MB free on 7 Nov. It moves,
    so a number from one day is not a limit.
  - Disk: 9.9 GB free of 29 GB. `/var/lib/pi-hub` is writable by `pi-hub`.
  - `deploy/pi-hub-backup.sh` copies `hub.db` and `project-files/`, not other folders under `/var/lib/pi-hub`.
- **Not measured yet:** Pi Hub's memory with Picamera2 loaded, the time from a control change to a changed frame, and
  whether each control name works on this sensor with libcamera 0.7. P1 measures them.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Done means: adopt A20's five, and say how 1 is measured.** "About 0.5 s" is the owner's own phone, so P1 measures
   what the Pi controls: the time from a control change to the first frame that shows it, at each preset. The chain
   after the drag is: the page's 200 ms send throttle, the network (about 20 ms at home, 100 ms or more away), the
   hub, the camera applying it in 2–3 frames (0.2–0.3 s at Data saver's 10 fps), then the next frame to the browser.
   At home that should land near 0.5 s. **Away from home it may not, and Data saver's 10 fps sets a floor.** If P1
   measures more than 0.5 s at home, P1 reports it and doesn't ship a claim. Raising the live frame rate is a change
   to A17 R4 and would be an amendment.
2. **Picamera2 runs in a helper process the hub owns, not inside the hub's own process.** A20 D1 says "in-process
   Picamera2 pipeline owned by `room_camera.py`", which allows two readings.
   - **Reading 1, inside the hub's own process:** simplest wiring, but a libcamera fault or a stuck camera takes the
     whole hub down (the Home page, the lab mirror, the display's data), and its memory counts against the hub's own
     `MemoryMax`.
   - **Reading 2, a child process (`hub/room_camera_helper.py`) that `room_camera.py` starts and stops:** same Picamera2,
     same pipeline, and it still counts in the unit's `MemoryMax` because it's in the same cgroup. A crash or hang is
     the helper's: the hub kills it, as it kills `rpicam-vid` today, and falls back (decision 5). It writes JPEG frames
     to stdout, which `FrameSplitter` already cuts, and reads one JSON control per line from stdin.
   - **Recommended: Reading 2.** The hub's other jobs shouldn't fail because a camera does. It reuses the start, stop,
     stall and restart logic (`_spawn`, `_failed`, `_kill`). Cost: one more small file and a protocol to test.
3. **The controls table says which are live.** Each `CONTROLS` entry gains `live: true|false`.
   - **Live:** `ev`, `brightness`, `contrast`, `saturation`, `sharpness`, `awb`, `metering`, `exposure`, `manual`,
     `shutter`, `gain`, `denoise`. These map to Picamera2 controls through one table in the helper
     (`ExposureValue`, `Brightness`, `Contrast`, `Saturation`, `Sharpness`, `AwbMode`, `AeMeteringMode`,
     `AeExposureMode`, `AeEnable` with `ExposureTime` and `AnalogueGain`, `NoiseReductionMode`).
   - **Restarts once, as A18:** Turn, mirror, flip, live preset, and zoom with its centre (A20 D1 says so).
     Picamera2's `ScalerCrop` could change zoom live; that is noted below and not taken, because A20 says restart.
   - The page draws the live badge from the hub's table, so no list is repeated in JavaScript.
4. **Trying is not saving.** A live change goes to the camera and is shown to every viewer (there is one camera; A18
   C4 says so). It is not stored until **Save**.
   - The hub holds the live values in memory. When the capture stops or restarts, the camera returns to the saved
     settings, and the page shows "Back to the saved settings".
   - **Why not save every change:** a drag would write the database dozens of times, and a bad value would survive a
     restart of the Pi. Cost: closing the tab loses a try. The page shows "Not saved" with Save beside it.
   - Two owner sessions at once: the last change wins, and the page shows the camera's current values on each poll.
5. **Live channel: one POST route, newest wins, with a fallback engine.**
   - `POST /api/camera/room/live-controls` takes `{key, value}`, owner only, validated against the table and
     refused (422, with the field) for a key that isn't `live`. A burst over 10 per second per device gets 429.
   - **Rejected: a WebSocket.** It adds a connection to authenticate and keep alive for one small message. The page
     sends at most 5 per second and drops all but the newest while one is in flight.
   - **Fallback:** if the helper can't import Picamera2, exits early, or gets no frame in `FIRST_FRAME`, the hub marks
     the engine `rpicam` for the life of the process, starts A18's `rpicam-vid` path, and the state carries
     `engine: "rpicam"`. The form then shows A18's Apply for every control. A fault never leaves the owner without a
     picture. The camera is opened by one process at a time: the existing lock covers the helper, the one-shot still
     and `rpicam-vid`.
6. **While Camera settings is open, the picture is live.** A slider on a still that refreshes every 2 s can't meet
   Done 1. Opening the disclosure starts the live stream, with A17 R4's limits unchanged: it stops when the page is
   hidden, after 5 minutes, and with at most 4 viewers.
   - **Trade-off:** about 1.4 Mbit/s at Data saver while the form is open, on a phone away from home. The disclosure
     says "Live while you adjust".
   - Rejected: a still with a refresh after each change. It would show the effect 2 s late.
7. **A look holds Framing, Light, Colour and Detail, and never Turn, flips or Live quality.** A20 D2 says "never Turn"
   and lists "Bed close-up", which needs zoom. So a look may include zoom and centre, and applying one with a different
   zoom restarts the capture once (about 2 s). A look that leaves zoom as it is applies live.
   - Applying a look is a try (decision 4). **Save** keeps it as the camera's settings.
   - Saved looks: the `settings` table, one key (`room_camera_looks`), a list of at most 8. A name is 1–24 characters
     with no control characters, unique ignoring case, and cannot be one of the three built-ins.
   - **The built-in numbers are starting points, untested:** Night (`ev` +1.5, `brightness` +0.1, `denoise` high
     quality, `metering` average), Bright (`ev` −0.5, `contrast` 1.2), Bed close-up (`zoom` 2, centre 50% across and
     50% down, `ev` +0.5). P3 is where the owner tunes them on the lit chamber; until then they are labelled as
     starting points on the page.
8. **Snapshots: files in `/var/lib/pi-hub/room-snapshots/`, with a sidecar of settings.**
   - A snapshot is the newest frame when the stream runs, or one fresh still at the preset's size. It is written as
     `<epoch-ms>.jpg` with `<epoch-ms>.json` (time, preset, settings in force), by write-to-temp then rename.
   - **200 limit:** enforced under the capture lock on each write, oldest removed first, so two quick taps can't pass
     it. The list reads the folder, so a file removed by hand just disappears from the list.
   - **Routes (owner):** `POST /api/camera/room/snapshots`, `GET …/snapshots` (newest first), `GET …/snapshots/<id>.jpg`,
     `DELETE …/snapshots/<id>`. An id must match `^\d{13}$` and is joined to the folder only after that check.
     A larger-than-2-MiB frame (`MAX_FRAME`) is refused.
   - **Log:** one line for each save and each delete, naming the id. Never the picture.
   - **Not backed up:** `pi-hub-backup.sh` copies `hub.db` and `project-files/` only, so snapshots are lost if the Pi's
     card fails. Three ways to treat that are named in "Out of scope", with an owner.
9. **Viewing tools are drawn in the browser, from what the page already receives.**
   - **Pinch and pan:** pointer events with `touch-action: none` on the picture only. Keyboard: `+` and `−` zoom,
     arrows pan, `0` resets. The page labels it "View zoom" and the camera's control "Camera zoom", so they aren't
     confused (A20 D4).
   - **Fullscreen:** `requestFullscreen` where the browser has it. iPhone Safari doesn't allow it on an element, so
     there the picture expands to a fixed overlay that fills the screen, with a visible Close and Escape.
   - **Histogram and grid:** the histogram samples a 160×120 canvas copy of the image twice a second, only while it
     is on, and not while the page is hidden. Off by default. The grid is a CSS overlay.
10. **Pinned picture on a phone.** The picture is `position: sticky` at the top of the Camera settings panel, with its
    height capped to 40% of the viewport, so a slider can be judged against it. On a wide screen the picture and
    controls sit side by side.
11. **Live changes are logged once, on Save.** One `room-camera:settings` line with the fields that changed since the
    saved value (A18 C5's format). A look saved or deleted logs `room-camera:look`. Drags are not logged (A20 D6).
12. **The Pi's rebuild needs the package.** P1 adds `python3-picamera2` to `deploy/install.sh`'s package list, so a
    rebuilt Pi has the helper's dependency, and a missing one is visible in the deploy output.

## What the camera state can say (reading the camera, not just holding settings)

- **Never read:** state `unavailable`, reason `capture_failed` or `not_detected`, as A17.
- **Read OK:** `engine: "picamera2"` or `"rpicam"`, with `live_values` (the tried values) when they differ from the saved
  ones.
- **Helper died after a good read:** the existing single restart, then fallback to `rpicam`, with the state saying so.
  Never the last frame shown as current: frames older than the last live change or apply are stale (`settings_at`
  rule, extended to live changes).
- **Restart of Pi Hub:** the live values are gone, the saved settings and the looks remain.

## PRs, one at a time

No stacked PRs: each is based on main after the one before it merges, except P2, which can merge independently of P1.

### P1. Backend: helper engine, live controls, fallback (`hub/room_camera.py`, `hub/room_camera_helper.py`, `hub/app.py`, `deploy/install.sh`)

- **Covers:** A20 D1 and D6 (full for the backend), decisions 2–6, 11 (live part) and 12.
- **Tests first** (`tests/test_room_camera.py`, with a fake helper that speaks the stdin and stdout protocol):
  - A live-control change reaches the helper exactly once as a validated number or table word; no other text reaches it.
  - A key that isn't `live`, an unknown key, an out-of-range value, and a value with spaces or `;` are each refused with
    the field named.
  - Twelve changes in one second: the 11th and later get 429, the camera gets the rest.
  - Live values vanish when the capture stops, restarts, or Pi Hub restarts. The saved settings stay.
  - A restart-class change (zoom, preset, turn) restarts once; a live-class change restarts nothing.
  - **Fallback:** a helper that fails to import, exits early, or sends no frame in `FIRST_FRAME` leaves the engine
    `rpicam`, and A18's tests still pass against it (Done 5). Two viewers and a still never open the camera at once.
  - A stale frame (taken before the last live change) is never served as current.
  - The live route refuses a household viewer and a signed-out one.
  - `test_service_unit.py` is unchanged; a new check reads `install.sh` for `python3-picamera2`.
- **Measurements on the Pi (a table in the PR):** for each preset, one minute live, with the helper:
  - change-to-frame time over 10 changes of `ev`, recorded as the median and the worst;
  - the hub's and the helper's memory against `MemoryMax=200M`, CPU, temperature, CMA free, bandwidth.
  - If the helper plus the hub exceed 170 MB, or a preset fails to start or starves the CMA, P1 stops and reports it.
    Raising `MemoryMax` is a unit change and a restart, so it is the owner's call.
  - Every Picamera2 control name from decision 3 is tried once on this sensor; any that this libcamera ignores is
    reported, and that control is made restart-class rather than shipped as live.
- **Evidence:** both test suites' output; the measurement table; after deploy, `GET /api/camera/room` shows
  `engine: "picamera2"`, and one live `ev` change through `curl` changes the stream.

### P2. Backend: quick looks and snapshots (`hub/room_camera.py`, `hub/app.py`)

- **Covers:** A20 D2 and D3 (full for the backend), decisions 7, 8 and 11 (look and snapshot logging). Independent of P1.
- **Tests first** (`tests/test_room_camera_looks.py`, `tests/test_room_snapshots.py`):
  - Looks: three built-ins; save, rename refusal, a ninth refused, a duplicate name ignoring case refused, a built-in's
    name refused; a look's values validated against the table; Turn, flips and preset refused in a look; a look survives
    a new `RoomCamera` over the same store.
  - Snapshots: save writes the pair of files; the 201st removes the oldest; two simultaneous saves never exceed 200;
    `../x`, `1`, a 14-digit id and a path with a slash are refused before any file access; delete removes both files;
    a missing sidecar still lists; a frame over `MAX_FRAME` is refused; none of the routes works for a household viewer
    or a signed-out one; no frame is written anywhere when no one has tapped save.
- **Evidence:** test output; after deploy, a snapshot saved with `curl`, listed, fetched and deleted, with the folder
  seen empty on the Pi.

### P3. Page: live sliders, quick looks, Save (`hub/static/js/workshop.js`, its CSS)

- **Covers:** A20 D1 (page), D2 (page), D5 and D6, decisions 4, 6, 7, 10. Full for the page.
- **What the owner sees:** with the Room view chosen, Camera settings opens a panel: the picture pinned at the top,
  look chips (Night, Bright, Bed close-up, then their own), the groups from A18, a "Live" badge on the live controls,
  and "Not saved" with **Save** and **Reset to defaults**. Controls that restart say "Restarts the picture".
- **States:** closed; open and live; trying (Not saved); saving; saved; refused (reason by the field, focus moved to
  it); restart gap ("Restarting", then the picture); engine `rpicam` (A18's Apply, with the line "Live adjust isn't
  available, so changes apply with Apply"); camera unavailable; hub didn't answer; live paused after 5 minutes
  (one tap restarts it).
- **Tests first** (`tests/test_room_view.mjs`): every state; sends at most 5 changes per second and only the newest;
  the badges follow the hub's table; a look applies and then Save sends the whole object; a look with a different zoom
  shows the restart line; a look name's long and empty cases; an edit survives an aside redraw; owner only.
- **Checks:** the width sweep and axe; screenshots at phone, tablet and desktop widths in light and dark, with the panel
  closed, trying, refused, restarting and on the fallback engine. SHELL bump in `sw.js`.

### P4. Page: snapshots and viewing tools (`hub/static/js/workshop.js`, its CSS)

- **Covers:** A20 D3 (page) and D4, decisions 8 (page) and 9. Full for the page.
- **What the owner sees:** under the picture, tools for Fullscreen, View zoom, Grid and Histogram; **Save snapshot**
  with "n of 200"; and a Snapshots list of thumbnails, newest first, each with time, open and **Delete** (the kit's
  inline confirm).
- **States:** empty ("No snapshots yet"), saving, saved, full ("Oldest removed" is said once), delete confirm, the hub
  refused or didn't answer, long list (the list scrolls inside itself; the page doesn't grow without end).
- **Tests first** (`tests/test_room_view.mjs`): pinch and key handling math; the iPhone overlay path when
  `requestFullscreen` is absent; the histogram samples only while on and visible; every snapshot state.
- **Checks:** as P3, plus keyboard-only use of every tool and a focus-visible check. SHELL bump.

### P5. Acceptance (owner)

- **Covers:** Done means 1–5.
- **Steps:**
  1. At home, on the phone, open Camera settings. Drag exposure and white balance until the dark room reads well;
     confirm there is no gap. Try each look and tune the three built-ins' numbers; save one of your own.
  2. Away, over Tailscale: note whether sliders still feel direct (decision 1's caveat), and try a look.
  3. Save a snapshot, open it, delete it. Pinch, pan, fullscreen, grid and histogram on the phone.
  4. Reload and restart: the saved settings and your look are still there; a tried, unsaved change is not.
  5. Fallback check: with a note on how it is forced (the test hook, a maintenance step the owner approves), see that
     the Room view shows a picture with Apply.
- **Record:** "A20 accepted <date>" in `docs/operations.md`, with the measurements and the final look numbers. A18's
  "accepted" line is separate and still owed.

### Owner steps outside the PRs

- **Releases:** each deploy restarts `pi-hub`, as every release does, with the preflight; no confirmation needed.
- **If P1's measurements need a higher `MemoryMax`:** a unit change and restart. Asked first.
- **Forcing the fallback for step 5:** a small, reversible change on the Pi. Asked first.

## Coverage

| Requirement | Evidenced by |
|---|---|
| D1 live adjust, restart-class for turn, zoom and preset, fallback | P1 (tests, measurements, fallback), P3 |
| D2 quick looks, three built-ins, up to 8 saved, one tap | P2 (store), P3 (chips) |
| D3 owner-tapped snapshot, 200 limit, list, delete | P2 (routes, files), P4 (page) |
| D4 fullscreen, pinch and pan, grid, histogram, client-side | P4 |
| D5 layout, pinned picture, native inputs | P3, P4 |
| D6 validation, owner only, one log line on Save | P1, P2, P3 |
| Done 1 (slider within about 0.5 s, no gap) | P1 (measured), P5 step 1–2 |
| Done 2 (look in one tap, survives restart) | P2, P5 step 4 |
| Done 3 (snapshot saved, listed, deleted, limit holds) | P2 (limit), P4, P5 step 3 |
| Done 4 (pinch, pan, fullscreen, axe, sweep) | P4 checks, P5 step 3 |
| Done 5 (Picamera2 fails, Room view still works) | P1 (fallback tests), P5 step 5 |

## Acceptance

The owner does P5 on the live page and the record goes in `docs/operations.md` as "A20 accepted <date>". Until then the
ladder applies: merged, deployed, runtime verified. A matching commit on the Pi is a deploy, not acceptance.

## Out of scope (noted, not gated)

- **Snapshots aren't in the Pi's backup.** Options: add `room-snapshots/` to `pi-hub-backup.sh`, accept the loss, or move
  the owner's keepers into the lab record through print-lab's spec. Owner: the owner chooses; recorded here so it isn't
  forgotten. Without it, snapshots are a convenience, not a record.
- **Zoom live through `ScalerCrop`.** It would make zoom and Bed close-up restart-free. It is a one-line change in the
  helper after P1, but A20 D1 says zoom restarts, so it takes an amendment.
- **A higher live frame rate** if P1 shows 10 fps sets the delay floor (decision 1): an A17 R4 amendment.
- **Timelapse, attaching a snapshot to an experiment, Room view on the display:** A20 "Not decided here". Their
  follow-ups are a print-lab spec and a display amendment, if the owner wants them.
