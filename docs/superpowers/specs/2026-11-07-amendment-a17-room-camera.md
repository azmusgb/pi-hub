# Amendment A17: the Pi's camera is a second view of the printer, "Room view"

Date: 2026-11-07 · Status: **proposed** (approved when the owner merges this PR) · Amends: the baseline's Workshop
rows (§3 Fabrication, the `/workshop` row, the Workshop › Printer source row and "Mac asleep"). Those know only one
camera, the printer's own, through the camera bridge.

## Why

The Pi now has its own camera: an Arducam OV5647 on the ribbon connector, which the Pi detects and has taken good stills
with on 7 Nov 2026. It looks at the X2D from outside, through the door. Nothing uses it: no Pi Hub code mentions it, no
process reads it, and the two camera services on the Pi (`x2d-camera-bridge`, `x2d-camera-failover`) serve the
printer's camera. The printer's camera goes stale often (the url.txt and LAN liveview cases), and then the Workshop
page has no picture of the printer at all. The owner asked where this second camera should show and whether it can
be live.

## Measured (Pi 4, 7 Nov 2026, dark room, `rpicam-vid` MJPEG to a byte counter)

| Stream | Bandwidth | Camera process | Pi temperature |
|---|---|---|---|
| 1280×720, 15 fps (5 min) | 6.5 Mbit/s | about 21% of one core | 62.8 → 65.7 °C, no throttling |
| 640×480, 10 fps, quality 50 (1 min) | 1.4 Mbit/s | about 6% of one core | 62.3 °C |
| 640×480, 10 fps, quality 70 (1 min) | 1.9 Mbit/s | about 6% of one core | 62.3 °C |

The Pi's heat and CPU aren't the limit. Bandwidth is, on a phone away from home. A lit room makes larger frames than
these dark ones. Serving through Pi Hub adds a little CPU that wasn't measured; R8's acceptance measures it.

## Decisions

**R1 What it is and what it's called.** A fixed camera on the Pi that looks at the printer from outside. On every
screen it is called "Room view", and it is never presented as "the camera" or "the printer's camera". Pi Hub owns it,
because it is part of the Pi. Rejected: feeding it into the camera bridge as if it were the printer's camera. The
picture and its angle are different, and a viewer would misread it.

**R2 Where it shows: Workshop › Printer only.** It goes in the camera aside of the Now band (A7 P1, `cameraAside` in
`workshop.js`), as a second view the owner can switch to: "Printer camera" and "Room view", two buttons with
`aria-pressed`. The printer camera stays first. It doesn't go on Home, Assistant or the display's main screen: it's
printer detail, and the owner sees it where the printer is.

**R3 It stands in when the printer camera is unavailable.** When `GET /api/camera` says the printer camera is
unavailable (its existing reasons: liveview off, printer not answering, bridge stale), the aside shows the Room view in
its place, with the line "Room view. The printer's camera is unavailable: <its reason>". The faceplate keeps saying
what the printer is doing. The owner's choice of view is kept per device (localStorage, as a convenience) and resets to
"Printer camera" when that camera comes back. Rejected for now: adding it to `x2d-camera-failover`, so the display and
Local AI fall back to it too. Those surfaces would need their own "Room view" label first, and the display belongs to
`display-on-hub`. Named follow-up: a display amendment, if the owner wants it.

**R4 A still by default, live on request.**
- **By default:** a still, refreshed every 2 seconds while the page is open and visible. The printer camera works the
  same way today (`workshop.js:72`).
- **Live:** a "Watch live" button switches to an MJPEG stream at 640×480, 10 fps, quality 50 (about 1.4 Mbit/s,
  measured).
- **Live stops** when the page is hidden, when the owner leaves the page, or after 5 minutes. It then goes back to the
  still, saying so ("Live paused after 5 minutes"). One tap restarts it.
- **Why:** this keeps a phone away from home on about 0.2 Mbit/s of stills unless the owner chooses live.
- **Rejected:** live by default (1.4 Mbit/s or more for anyone who leaves the page open). Also rejected: H.264 over
  WebRTC, which needs a streaming server (mediamtx) as a new dependency and service, for a quarter of the bandwidth.
  That can be revisited if live away from home becomes common.

**R5 The camera runs only while someone is looking.**
- **One capture process,** owned by Pi Hub's new `room_camera.py`. It starts with the first viewer, is shared by every
  viewer, and stops 10 seconds after the last one leaves.
- **A still with no stream running** is a one-shot capture of about 1.5 s. While a stream runs, the still is its
  newest frame.
- **Frames are never stored.** They are never written to disk or logged, and they never leave the Pi except to a
  signed-in viewer.
- **Limits:** at most 4 live viewers at once, and a fifth gets the still with "Live is busy". A capture that dies is
  restarted once, then reported as unavailable (R7).

**R6 Routes, behind sign-in.**
- `GET /api/camera/room.jpg` serves the still. `GET /api/camera/room/live` serves the MJPEG stream, as
  `multipart/x-mixed-replace`. `GET /api/camera/room` gives the state for the page.
- All three sit behind Pi Hub's existing sign-in gate in Caddy. Live streaming through it is checked in R8. The Caddy
  gate changed in #172 (web sockets), so streaming must be confirmed rather than assumed.
- No new port, no new public hostname, no machine path for other systems.

**R7 Its state, shown in words.** `GET /api/camera/room` answers one of:
- `ready`;
- `live` (with the viewer count);
- `unavailable`, with a reason: `not_detected` (nothing on the camera bus), `capture_failed`, or `busy`;
- `not_checked` (Pi Hub has just started).

The aside says the reason in plain words, for example "The Pi's camera isn't detected. Check its ribbon cable", and
never shows a blank or an old frame as current. A still older than 10 seconds says its age. The camera isn't a Record
and raises no Needs-you item or alert: a second view being unavailable doesn't need the owner. Rejected: a
`room_camera` record on the Pi host in `hub/systems.py`. It would put an alarm-free accessory on Health, beside things
that do matter.

**R8 Rotation.** The camera is mounted a quarter turn off. The Pi's camera software turns pictures only by 180°, not
90°. The owner fixes the mount (an owner step). Until then, a setting in `/etc/pi-hub/`, `ROOM_CAMERA_ROTATE`
(0, 90, 180 or 270), is applied by the page with CSS for 90 and 270, and at capture for 180. The page then reserves the
turned picture's space, so nothing jumps.

**R9 Design contract.** Appliance-ui `DESIGN.md` after Pi Hub's baseline and amendments: phone first and fluid (A10),
text size (A14), keyboard reachable view and live buttons with visible focus, `prefers-reduced-motion` (no fade between
frames), and every state designed:
- printer camera only;
- Room view only;
- both unavailable;
- live;
- live paused;
- live busy;
- a still that is getting old;
- a turned picture on a phone.

## Steps (each its own PR after this merges)

1. **Backend:** `hub/room_camera.py` (the capture process with its lifecycle, R5), the three routes (R6) and the state
   (R7).
   - Tests use a fake capture command:
     - the first viewer starts it, and the last leaving stops it after 10 s;
     - a fifth viewer is refused;
     - a death is restarted once, then reported unavailable;
     - no frame is written to disk;
     - every reason produces a state;
     - all three routes refuse a viewer who isn't signed in.
2. **Page:** the view switch, the stand-in when the printer camera is out (R3), still and live (R4), rotation (R8) and
   every state (R9).
   - Checks:
     - browser checks for the buttons and keyboard use;
     - the repo's width sweep and axe;
     - screenshots at phone, tablet and desktop widths, in light and dark.
3. **Acceptance (owner):** with Room view live on the owner's phone, both at home and away over Tailscale, measure the
   Pi's CPU, temperature and bandwidth through Pi Hub and Caddy for 5 minutes. Turn off the printer's LAN liveview and
   see the Room view stand in with its reason. Record it in `docs/operations.md` as "A17 accepted <date>".

The camera mount (R8) is an owner step, and can happen at any time.

## Out of scope

- **The display and Local AI fall back to the Room view.** That needs a display amendment (R3).
- **Print-lab evidence stills** (a frame at a print's start and end). This needs a framing that shows the plate, and a
  lab amendment, because evidence changes what the lab records.
- **Recording, motion detection and spaghetti detection.** Obico already watches the printer's camera.
- **H.264 or WebRTC** (R4).
