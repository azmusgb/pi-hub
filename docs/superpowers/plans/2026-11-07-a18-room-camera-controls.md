# A18 Room view camera controls: set from the page — Plan

Date: 2026-11-07 · Status: **proposed** · Covers: amendment A18
(`docs/superpowers/specs/2026-11-07-amendment-a18-room-camera-controls.md`, merged in #178 as 8bdbd05).

**Goal:** the owner adjusts the Room view's camera from Workshop › Printer, without SSH or a restart. That covers turn,
mirror, zoom, light, colour, detail and live quality. Each change is checked on the hub, applied with one short
capture restart, and logged.

## Spec

- Amendment A18, decisions C1–C7 and its three steps.
- Amendment A17, as A18 amends it: R8 (rotation) and R4 (live quality) change; R1–R3 and R5–R7 stand. A17's plan
  (`2026-11-07-a17-room-camera.md`) and its P1/P2 are merged and live.
- A18 states no dependency beyond A17, which is live.
- Design contract: appliance-ui `DESIGN.md` after Pi Hub's baseline and amendments, with A10 (fluid) and A14 (text
  size).

## Done means

From A18's step 3, quoted and numbered:

1. "Change exposure and white balance until the dark room reads well, turn and zoom, try each live preset at home and
   away, and reset."
2. "Record it in `docs/operations.md` as 'A18 accepted <date>'."

C1–C7 are each evidenced by the PR that builds them; see Coverage.

## What exists today (read on 7 Nov 2026; pi-hub `origin/main` 8bdbd05, live 7be0478)

- **The capture** (`hub/room_camera.py`):
  - Fixed command lines: `VID` at line 31 (640×480, 10 fps, `--quality 50`) and `STILL` at line 34 (640×480,
    `-q 70`, 1.5 s).
  - `rotation()` (line 51) reads `ROOM_CAMERA_ROTATE` from the environment.
  - `capture_args()` (line 57) adds `--rotation 180` only for 180.
  - `_spawn()` (line 221) builds the live process from `capture_args(self.vid_cmd)`.
  - Every start and stop runs under one `asyncio.Lock` (`_bind`, line 118). A capture with no first frame within
    `FIRST_FRAME` (13 s) is reported `capture_failed`.
  - The state (line 124) carries `rotate`. It doesn't carry the picture's size.
- **The setting today:**
  - `/etc/pi-hub/room-camera.env` holds `ROOM_CAMERA_ROTATE=90`, written on 7 Nov 2026 with the owner's OK, followed by
    a pi-hub restart. Mode 644, owner root.
  - The unit reads it via `EnvironmentFile=-/etc/pi-hub/room-camera.env` (`deploy/pi-hub.service:12`).
  - `GET /api/camera/room` answers `rotate: 90`, and the page shows the picture upright as a portrait.
- **Storage:**
  - `hub/auth.py` has the `settings` table (line 24) and `get` / `put` of JSON values by key (lines 46–55).
  - The action log is `auth.log(role, device, action, result)` (line 237).
- **Routes** (`hub/app.py:640–656`): `/api/camera/room`, `/room.jpg` and `/room/live`, each `need(request, "owner")`.
  Owner writes elsewhere follow `api_printer_action` (`hub/app.py:515`): `need` owner, act, then `auth.log`.
- **The page** (`hub/static/js/workshop.js`):
  - `roomCam` (line 181) draws the figure, and `cameraAside` (line 202) the switch.
  - `drawCam` (line 540) redraws the aside whenever its signature changes (camera state, choice, live). Anything inside
    the aside is rebuilt then.
  - The CSS fixes the picture at 4:3 (`workshop-pi-rich.css:113–114`), and the turned frame at 3:4 (line 117).
- **The sensor** (`rpicam-hello --list-cameras`): OV5647.
  - Modes: 640×480 (62.5 fps), 1296×972 (46 fps), 1920×1080 (33 fps, a crop from the centre), 2592×1944 (15.6 fps).
  - `rpicam-vid --help` lists every A18 C2 option, including `--roi`, `--ev`, `--awb`, `--metering`, `--exposure`,
    `--shutter`, `--gain` and `--denoise`.
- **Memory on the Pi:**
  - Pi Hub used 61 MB, with a peak of 67 MB, against `MemoryMax=200M` (`deploy/pi-hub.service:27`).
  - The camera memory pool (CMA) had **29 MB free of 512 MB** with no capture running. A 640×480 capture worked with
    39 MB free earlier today. Whether 1296×972 and 1920×1080 fit isn't known.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **One table of controls, in `room_camera.py`.** A `CONTROLS` table holds each control's key, kind (choice, number or
   switch), range or choices, step, default and label. The hub validates against it, and the page draws its form from
   it (C6). There is no second copy in the JavaScript.
2. **How each control becomes `rpicam` arguments** (the gap below C2):
   - **Turn:** 180° becomes `--rotation 180`. 90° and 270° stay in CSS (A17 R8).
   - **Mirror:** `--hflip`. **Flip:** `--vflip`.
   - **Zoom and centre:** `--roi x,y,w,h` with `w = h = 1/zoom`. Each of `x` and `y` is the centre minus half the size,
     clamped so the box stays inside the picture. At 1×, no `--roi` is passed.
   - **Light, colour and detail:** passed as their own options (`--ev`, `--brightness`, `--contrast`, `--metering`,
     `--exposure`, `--awb`, `--saturation`, `--sharpness`). Noise reduction maps "fast" to `cdn_fast` and "high
     quality" to `cdn_hq`.
   - **Manual exposure:** `--shutter <µs>` and `--gain <n>`, passed only when it is on.
   - **The live preset** sets `--width`, `--height`, `--framerate` and `--quality`. Stills use the preset's size, at
     `-q 70` as today.
   - Every value reaches the command line only as a number formatted by the hub, or as a word from the table, in an
     argument list (never a shell string).
3. **The POST takes the whole settings object.**
   - Every key in the table is required, and unknown keys are refused.
   - A refusal is HTTP 422 with `{"field": …, "reason": …}`, so the page can put the reason beside that field (C7).
   - Rejected: partial updates merged into the stored value. With partial updates, what got applied depends on the
     order of writes. The page always has the whole form anyway.
4. **Apply holds the capture lock.**
   - Under the lock, Apply saves, marks the cached still as stale (so the next still is a fresh capture with the new
     settings), and restarts the live capture if one is running. A one-shot still that is mid-capture finishes first.
   - A second Apply while one is applying gets 409 (C6).
   - The response carries the new state, so the page can show a fresh still at once.
5. **The picture's size goes in the state.** `GET /api/camera/room` adds `size: [w, h]` from the preset. The page sets
   the picture's `aspect-ratio` from it, instead of the fixed 4:3. Sharp (1920×1080) is 16:9, and its quarter-turned
   frame becomes 9:16.
6. **The A17 file seeds once, read directly** (C4).
   - On the first read with no stored settings, `room_camera.py` reads `/etc/pi-hub/room-camera.env` itself, takes a
     valid `ROOM_CAMERA_ROTATE` as "Turn", and stores the settings. After that, the stored value wins and the file
     isn't read again.
   - **Why read the file and not the environment:** C4 removes the unit's `EnvironmentFile=` line in the same step.
     Once it's gone, the variable is no longer in the environment, so a seed from the environment would lose the 90°
     on the very release that ships this.
   - Pi Hub can't delete the file (`ProtectSystem=strict`). It is deleted on the Pi after P1's deploy shows "Turn: 90°"
     stored. That is a file change, not a restart, and is listed under owner steps.
7. **When the camera is unavailable, the fields lock but Reset stays.** C7 lists "camera unavailable (controls
   disabled, with the camera's reason)".
   - **The risk:** a setting that breaks the capture produces exactly that state, for example a shutter longer than the
     frame time at a high frame rate. With every control disabled, the owner couldn't undo it from the page.
   - **Reading 1:** every control is disabled, including Reset. The owner's only recovery is SSH.
   - **Reading 2:** the fields are disabled, but "Reset to defaults" stays enabled while the reason is
     `capture_failed`. With `not_detected`, everything is disabled, because no setting can bring a missing camera back.
   - **Recommended: Reading 2.** C3 makes Reset part of the form, and A18's goal is no more SSH for camera changes.
     Reading 1 would bring SSH back for the one case most likely to need it.
8. **The settings form lives outside the redrawn aside.**
   - The aside is rebuilt whenever the camera's state changes (`drawCam`), which would wipe an edit in progress.
   - So the "Camera settings" disclosure is its own persistent element, placed under the aside the way the live
     status line is. It is redrawn only on its own signature (settings, ranges, applying, refusal).
   - Unapplied values are kept in page state, so a state change mid-edit loses nothing.
9. **The log line names what changed.**
   - Apply logs `room-camera:settings` with, for example, "ev 0 → 1, white balance auto → tungsten". If nothing changed,
     the line says "No change".
   - Reset logs `room-camera:reset`.
   - Values are written; frames never are.
10. **The higher presets are measured before they ship** (the CMA risk above).
    - P1 runs Clear and Sharp on the Pi for one minute each, live through Pi Hub, and records bandwidth, CPU,
      temperature, Pi Hub's memory and CMA free.
    - If a preset fails to start or starves the pool, P1 stops and reports it to the owner rather than shipping it.
      Dropping or changing a preset C2 lists would be an amendment, not a quiet change here.
    - Trade-off: stills follow the preset's size. A Sharp still every 2 s costs more data than a Data saver one. P1
      measures it, and P2 shows it next to the preset.

## PRs, one at a time

### P1. Backend: settings, validation, apply and routes (`hub/room_camera.py`, `hub/app.py`, the unit)

- **Covers:** C2 (the table and every mapping), C3 (apply and reset, one restart), C4 (storage, seed, validation, the
  unit line removed), C5 (log), C6 (three routes, 409), plus decisions 1–6, 9 and 10. Full for the backend.
- **Tests first** (`tests/test_room_camera.py`, with the fake capture command extended to record its arguments):
  - Every control: its default; its edges accepted; out of range, the wrong type and a word not listed each refused
    with the field named. An unknown key and a missing key are refused.
  - The command line for each control, including the zoom box clamped at each edge, manual exposure on and off, and
    each preset.
  - Nothing reaches the arguments except table words and formatted numbers. A value with spaces or `;` is refused
    before it gets near them.
  - Apply while live restarts the capture exactly once. Apply with no capture running starts nothing, and the next
    still is a fresh capture with the new arguments.
  - A second Apply during the first gets 409.
  - Reset stores the defaults and restarts once.
  - The seed: the file with 90 seeds "Turn: 90°" once; a later change to the file is ignored; a missing or bad file
    seeds 0.
  - The state carries `size`.
  - All three settings routes refuse a household viewer and a signed-out one.
  - Apply and Reset each write one log line naming the changes.
- **Unit:** remove `EnvironmentFile=-/etc/pi-hub/room-camera.env`. `test_service_unit.py` checks that it's gone.
- **Evidence:**
  - Test output (both suites).
  - After deploy: `GET /api/camera/room/settings` shows "Turn: 90°", seeded from the file.
  - Decision 10's measurements, as a table in the PR.
  - One Apply through `curl` changes the still, and leaves one log line.

### P2. Page: the disclosure, form, Apply and Reset (`hub/static/js/workshop.js`, its CSS)

- **Covers:** C1 (owner only, under the Room view, closed by default, only while the Room view is chosen), C3 on the
  page (Apply, Reset with the kit's inline confirm, no restart while a slider moves), C7 (every state, layout,
  accessibility), plus decisions 5, 7 and 8. Full for the page.
- **What the owner sees:** under the Room view, a closed "Camera settings" disclosure. Open, it shows six groups, as
  A18 C2's table: Orientation, Framing, Light, Colour, Detail, Live quality.
  - Each control is a native `select`, `input type=range` (with its value shown) or checkbox, with a visible label.
  - Centre is enabled only above 1×. Shutter and gain are enabled only with manual exposure on.
  - Each preset shows its bandwidth.
  - Below the groups: "Apply", and "Reset to defaults".
- **States** (C7):
  - closed;
  - open with defaults;
  - edited ("Not applied yet");
  - applying (both buttons disabled, "Applying…");
  - applied (a fresh still, and "Applied" in the status line);
  - refused (the reason beside its field, and focus moved to that field);
  - camera unavailable (decision 7);
  - the hub didn't answer.
- **Tests first** (`tests/test_room_view.mjs`):
  - Every state above.
  - The form is drawn from the hub's table.
  - An edit survives an aside redraw.
  - Only the owner gets the disclosure.
  - Apply sends the whole object.
  - Reset asks first.
  - The aspect ratio follows `size`, including a turned Sharp picture.
- **Checks:** the width sweep and axe; screenshots at phone, tablet and desktop widths in light and dark, with the
  form open, edited, refused and unavailable.
- **SHELL** bump in `sw.js`.

### P3. Acceptance (owner)

- **Covers:** Done means 1–2.
- **Steps:**
  1. On the owner's phone at home, open Camera settings. Change exposure and white balance until the dark room reads
     well. Turn, mirror, zoom and move the centre.
  2. Try each live preset at home, then away over Tailscale. For each, note whether it plays smoothly and how the
     picture looks.
  3. Reset to defaults. Check that the picture returns and the action log shows each change.
- **Record:** "A18 accepted <date>" in `docs/operations.md`, with the chosen settings and P1's measurements.

### Owner steps outside the PRs

- **Delete `/etc/pi-hub/room-camera.env`** on the Pi once P1's deploy shows "Turn: 90°" stored (decision 6). It is a
  file change, with no restart. It is asked for first.
- **Releases:** P1's deploy installs the changed unit and restarts `pi-hub`, as every release does. Releases need no
  confirmation, but get the preflight.

## Coverage

| Requirement | Evidenced by |
|---|---|
| C1 owner only, a disclosure under the Room view | P1 (routes refuse others), P2 |
| C2 every control, ranges, presets with bandwidth | P1 (table, validation, arguments, decision 10), P2 (form) |
| C3 Apply and Reset, one restart, no restart while sliding | P1 (restart count, 409), P2 |
| C4 database storage, seed once, strict validation, unit line removed | P1 (tests, deploy check), owner step (file deleted) |
| C5 log line per change | P1 |
| C6 three owner-only routes, 409 while applying | P1 |
| C7 states, accessibility, layout | P2 (tests, sweep, axe, screenshots) |
| Done 1 (owner adjusts, presets at home and away, reset) | P3 steps 1–3 |
| Done 2 (record) | P3 |

## Acceptance

The owner does P3 on the live page. The record goes in `docs/operations.md` as "A18 accepted <date>". Until then the
status ladder applies: merged, deployed, runtime verified. A matching commit on the Pi is a deploy, not acceptance.

## Out of scope (noted, not gated)

- **Changing settings without a restart (Picamera2).** A18 C3's named follow-up. It needs an amendment if the restart
  gap proves annoying in P3.
- **CMA headroom generally.** The pool is mostly in use with no capture running. If decision 10 shows the higher
  presets don't fit, the follow-up is an amendment for the presets (C2), possibly with a `/boot/firmware/config.txt`
  change. That would be a reboot, which is owner-confirmed.
- **The printer's own camera, and schedules** (A18 out of scope).
