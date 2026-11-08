# A17 Room view: the Pi's camera on Workshop › Printer — Plan

Date: 2026-11-07 · Status: **proposed** · Covers: amendment A17 (`docs/superpowers/specs/2026-11-07-amendment-a17-room-camera.md`,
merged in #173).

**Goal:** on Workshop › Printer, the owner can switch between the printer's camera and the Room view. When the printer's
camera is unavailable, the Room view stands in and says why. It shows a still every 2 seconds, and live video when the
owner asks. The camera is off whenever nobody is looking.

## Spec

- Amendment A17, decisions R1–R9 and its three steps. It waits on nothing: A17 states no dependency, and the camera
  works today.
- The baseline's Workshop rows, as amended by A17, and A7 P1 ("aside: camera, if any").
- Design contract: appliance-ui `DESIGN.md` after Pi Hub's baseline and amendments, with A10 (fluid) and A14 (text
  size).

## Done means

From A17's step 3, quoted and numbered:

1. "With Room view live on the owner's phone, both at home and away over Tailscale, measure the Pi's CPU,
   temperature and bandwidth through Pi Hub and Caddy for 5 minutes."
2. "Turn off the printer's LAN liveview and see the Room view stand in with its reason."
3. "Record it in `docs/operations.md` as 'A17 accepted <date>'."

The other decisions (R1–R9) are each evidenced by the PR that builds them; see Coverage.

## What exists today (read on 7 Nov 2026; pi-hub `origin/main` c52681b, live 47c47ca)

- **The camera:**
  - Arducam OV5647 on the ribbon connector. `/boot/firmware/config.txt` has `camera_auto_detect=0` and
    `dtoverlay=ov5647,vcm`.
  - `rpicam-hello --list-cameras` lists it. Stills taken at 18:00, about 18:12 and 18:57 came back as good pictures.
  - It is mounted a quarter turn off.
- **Nothing uses it.** No Pi Hub code mentions `rpicam`, `libcamera` or `/dev/video0`. No process holds the device.
  The two camera units (`x2d-camera-bridge`, `x2d-camera-failover`) serve the printer's camera.
- **Permissions:** the devices it needs (`/dev/video*`, `/dev/media*`, `/dev/v4l-subdev*`, `/dev/dma_heap/*`) are
  `root:video` with mode 0660. Pi Hub's process runs as user `pi-hub`, whose only group is `pi-hub`. Today Pi Hub
  can't open the camera.
- **The service** (`deploy/pi-hub.service`):
  - Hardening: `NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`.
  - `MemoryMax=200M`. Pi Hub used 63 MB, with a peak of 80 MB. A 640×480 capture (`rpicam-vid`) took 20 MB RSS, so a
    child capture fits.
  - The Pi's camera memory pool (CMA) had 39 MB free of 512 MB while capturing.
- **Measured** (A17's table): 640×480, 10 fps, quality 50 needs 1.4 Mbit/s and about 6% of one core.
- **The page** (`hub/static/js/workshop.js`):
  - `cameraAside(c)` (line 104) shows the printer camera, or "Camera unavailable" with the reason from
    `GET /api/camera` (`liveview_off`, `printer_unreachable`, and the Pi and MacBook sources).
  - Every 2 seconds it swaps `img.src` to `/api/camera.jpg` while the page is visible (line 72).
  - `localStorage` is already read safely (line 27).
- **Routes:** `GET /api/camera.jpg` and `GET /api/camera` (`hub/app.py:618,628`) proxy the failover service.
- **Caddy** (2.11.7):
  - Every Pi Hub path goes through the `gated` snippet (`forward_auth` to `/api/gate`) and then
    `reverse_proxy 127.0.0.1:8100`, with no `flush_interval` set.
  - #172 changed the gate's headers for web sockets.
  - Whether a never-ending `multipart/x-mixed-replace` response streams through it without buffering isn't known yet.
- **Tests:** workshop page tests in `tests/test_workshop_*.mjs`. Python tests in `tests/test_*.py`.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Pi Hub's service joins the `video` group** (`SupplementaryGroups=video` in `deploy/pi-hub.service`). A17 R5 puts
   the capture process under `room_camera.py`, so Pi Hub has to open the camera itself.
   - Trade-off: the web process gains access to the camera and the GPU memory devices.
   - Rejected: a separate capture service with its own user. It's tighter, but it moves ownership away from
     `room_camera.py`, against R5's wording, and that would need an amendment.
   - The unit change is installed by the normal release, which already restarts `pi-hub`.
2. **The capture is a child process, read in frames.** `rpicam-vid --codec mjpeg` writes JPEGs to stdout.
   `room_camera.py` splits them at the JPEG start and end markers, and keeps only the newest frame in memory.
   - Each live viewer's response sends whatever the newest frame is, at most 10 per second.
   - No frame touches disk. `PrivateTmp` stays, and nothing is written to `/var/lib/pi-hub`.
3. **Stills with no stream running are shared and taken one at a time.**
   - R5 says a still is "a one-shot capture of about 1.5 s". Taken by itself, that would make two open tabs fight
     over the camera.
   - So one lock serialises the captures, and a still younger than 2 seconds is served to everyone.
   - While a capture runs, other requests wait for it, for up to 3 s, then get the previous still with its age.
   - Trade-off: with the page open, the camera opens and closes about every 2 s. Acceptance (P3) watches for this
     doing harm (dropped stills, errors). If it does, keeping the process running at 1 fps while stills are being
     viewed would change R5's wording, so it would be an amendment, not a quiet change here.
4. **"Live" is counted by open responses.** A viewer is one open `/api/camera/room/live` response.
   - The fifth gets HTTP 429 with `{"reason": "busy"}`, and the page falls back to the still with "Live is busy".
   - A disconnect frees its place at once.
   - Each response ends itself after 5 minutes (R4), so a forgotten tab can't hold live open. The page shows
     "Live paused after 5 minutes" when its stream ends on that limit.
5. **Streaming through Caddy is proven, not assumed.** P1 adds a test through the real Caddyfile (`caddy run` with a
   stub upstream) that the first frame arrives within 2 s.
   - If it doesn't, P1 adds `flush_interval -1`, scoped to `handle /api/camera/room/live`, rather than to the whole
     site.
   - Nothing else in the gate changes.
6. **The rotation setting lives in `/etc/pi-hub/room-camera.env`** (`ROOM_CAMERA_ROTATE=0|90|180|270`). The unit reads
   it with `EnvironmentFile=-` and the state route returns it.
   - Writing that file on the Pi is a config step. The owner chooses whether to set 90 there or remount the camera.
   - A missing file or bad value means 0, and the state route says `rotate: 0`.

## PRs, one at a time

### P1. Backend: capture, routes and state (`hub/room_camera.py`)

- **Covers:** R1 (name), R5 (lifecycle, no storage, at most 4 live viewers, restart once), R6 (three routes behind
  sign-in), R7 (states and reasons), R8 (the setting), plus decisions 1–6. Full for the backend.
- **States** (R7), and how each is decided:

| State | When |
|---|---|
| `not_checked` | Pi Hub started and no still or live request has run yet |
| `ready` | The last capture produced a frame, and no stream is running |
| `live` | A stream is running, with `viewers` set |
| `unavailable: not_detected` | `rpicam-vid --list-cameras` (run once at the first request, then after each failure) lists no camera |
| `unavailable: capture_failed` | The capture exited with no frame, twice in a row (once, plus the one restart R5 allows) |
| `unavailable: busy` | A live request when 4 are open (shown only to that request) |

  The state carries `frame_at` (the newest frame's time), so the page can say a still's age. A failed read never
  returns an old frame as if it were new: `/api/camera/room.jpg` sends `X-Frame-At`, and returns 503 with the reason
  when no frame younger than 30 s exists.
- **Lifecycle:**
  - One `asyncio` task owns the process, guarded by an exception boundary.
  - The process starts on the first viewer, and stops 10 s after the last viewer leaves.
  - Pi Hub's shutdown kills it.
  - It never runs twice. The lock from decision 3 also guards the start.
- **Tests first** (`tests/test_room_camera.py`, with a fake `rpicam-vid` script writing fixture JPEGs):
  - The first viewer starts the process. The last viewer leaving stops it after 10 s (on a fake clock).
  - A fifth live viewer gets 429 and `busy`. A disconnect frees the place.
  - A capture that dies is restarted once. A second death gives `capture_failed`.
  - "No camera listed" gives `not_detected`.
  - Two concurrent still requests run one capture. A still younger than 2 s is shared.
  - No file is created anywhere during capture: the test watches the working directory and the system temporary
    directory.
  - Each of the three routes refuses a request without a session, the same as other private routes.
  - A live response ends after 5 minutes (fake clock).
  - A bad `ROOM_CAMERA_ROTATE` gives 0.
- **Caddy:** decision 5's streaming test, and `flush_interval -1` only if that test needs it.
- **Unit:** `SupplementaryGroups=video` and `EnvironmentFile=-/etc/pi-hub/room-camera.env` in `deploy/pi-hub.service`.
- **Evidence:**
  - Test output.
  - After deploy, on the Pi: `curl` the three routes with a session cookie, which should give a JPEG, a stream with
    frames, and the state.
  - `id pi-hub` shows `video`.
  - `ps` shows no `rpicam` process 10 s after the curls end.

### P2. Page: the view switch, stand-in, still and live (`hub/static/js/workshop.js`, its CSS)

- **Covers:** R2 (Workshop › Printer only, two buttons with `aria-pressed`), R3 (stand-in with the printer camera's
  reason, the choice kept per device and reset when the printer camera returns), R4 (still every 2 s by default, "Watch
  live", stopping on hide, leave or the 5-minute limit), R8 (CSS rotation for 90 and 270, reserving the turned space),
  R9 (every state). Full for the page.
- **What the aside shows, by case:**
  - The printer camera is up: "Printer camera" is pressed by default. "Room view" switches.
  - The printer camera is unavailable and the Room view is available: the Room view, with "Room view. The printer's
    camera is unavailable: <reason>".
  - Both are unavailable: "No camera", with both reasons in words.
  - Live: a "Stop live" button.
  - Live paused: "Live paused after 5 minutes", with "Watch live" again.
  - Live busy: "Live is busy", and stills continue.
  - A still older than 10 s says its age.
  - Captions never call the Room view "the camera".
- **Tests first:**
  - Pure render tests in `tests/test_workshop_render.mjs`, for every case above, including the stand-in reason
    text and the preference reset.
  - Browser checks for the switch and live buttons: keyboard use, `aria-pressed`, visible focus, and no motion under
    `prefers-reduced-motion`.
  - The repo's width sweep and axe.
  - Screenshots at phone, tablet and desktop widths in light and dark, including a 90° rotated still on a phone.
- **SHELL** bumps in `sw.js` (every change under `hub/static`).
- **Evidence:** test output and the screenshots.

### P3. Acceptance (owner)

- **Covers:** Done means 1–3.
- **Steps:**
  1. With the owner present, open Workshop › Printer on the owner's phone on home Wi-Fi. Switch to the Room view and
     tap "Watch live". For 5 minutes, record:
     - the Pi's CPU (`top`) and temperature (`vcgencmd`), with throttling;
     - bandwidth on the Pi's interface (`/proc/net/dev` deltas).
  2. Repeat away from home over Tailscale (mobile data). The owner does this.
  3. The owner turns off LAN Only Liveview on the printer's screen. The aside shows the Room view with "The printer's
     camera is unavailable: …". Turn liveview back on, and the choice resets to the printer camera.
  4. Leave the page open with stills for 5 minutes. Count still failures in Pi Hub's log, which tests decision 3's
     trade-off.
- **Record:** "A17 accepted <date>" in `docs/operations.md`, with the measurements.

### Owner steps outside the PRs

- **Rotation:** remount the camera a quarter turn, or ask for `ROOM_CAMERA_ROTATE=90` to be written to
  `/etc/pi-hub/room-camera.env`. Either can happen at any time, and P2's rotated layout covers the second.
- **Releases:** the deploy that installs P1 restarts `pi-hub` and `caddy` (as every release does). Releases need no
  confirmation, but get the preflight.

## Coverage

| Requirement | Evidenced by |
|---|---|
| R1 name "Room view" | P1 (route and state names), P2 (captions test) |
| R2 Printer page only, two buttons | P2 |
| R3 stand-in with reason, preference reset | P2 (render tests), P3 step 3 |
| R4 still by default, live on request, 5-minute stop | P1 (5-minute end), P2 (hide, leave, paused), P3 step 1 |
| R5 on demand, shared, never stored, ≤ 4 live, restart once | P1 tests, P1 evidence (`ps`) |
| R6 three routes, sign-in, no new port | P1 tests, decision 5 |
| R7 states in words, never an old frame as current | P1 (states, `X-Frame-At`, 503), P2 (age line) |
| R8 rotation | Decision 6, P1 (setting), P2 (CSS layout), owner step |
| R9 design contract and states | P2 (sweep, axe, screenshots) |
| Done 1 (measure at home and away) | P3 steps 1–2 |
| Done 2 (stand-in seen) | P3 step 3 |
| Done 3 (record) | P3 |

## Acceptance

The owner sees P3's steps on the live page. The record goes in `docs/operations.md` as "A17 accepted <date>". Until
then, the status ladder applies: merged, deployed, runtime verified. A matching commit on the Pi is a deploy, not
acceptance.

## Out of scope (noted, not gated)

- **The display's and Local AI's fallback to the Room view.** A17 R3 names a display amendment as the follow-up.
- **Print-lab evidence stills.** A lab amendment (A17, out of scope).
- **A capture service of its own** (decision 1, rejected). If the `video` group on the web process ever becomes a
  concern, that would be an amendment to R5.
- **A Health row for the camera.** A17 R7 decides there is none.
