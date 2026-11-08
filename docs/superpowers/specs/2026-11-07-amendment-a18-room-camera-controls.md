# Amendment A18: the owner sets the Room view's camera from the page

Date: 2026-11-07 · Status: **proposed** (approved when the owner merges this PR) · Amends: A17 (Room view), its R8
(rotation from a file in `/etc/pi-hub/`) and its R4 (one fixed live quality). Everything else in A17 stands.

## Why

A17 shipped (Pi Hub 7be0478, owner-only at the owner's request). The picture works, but every adjustment means editing
`/etc/pi-hub/room-camera.env` over SSH and restarting Pi Hub. That is how the quarter turn was fixed on 7 Nov 2026. The
room is dark, so the picture is mostly black around the lit chamber, and nothing on the page can change that. The owner
asked to "allow all camera controls".

## What the camera can do (read on the Pi, 7 Nov 2026)

- **Sensor:** OV5647, 2592×1944, fixed focus, no HDR. Modes: 640×480 (62 fps), 1296×972 (46 fps), 1920×1080 (33 fps),
  2592×1944 (15.6 fps).
- **`rpicam-vid` / `rpicam-still` options** that change the picture: `--rotation` (0 or 180 only), `--hflip`,
  `--vflip`, `--roi` (digital zoom), `--ev`, `--brightness`, `--contrast`, `--saturation`, `--sharpness`, `--awb`,
  `--awbgains`, `--metering`, `--exposure`, `--shutter`, `--gain`, `--denoise`, plus size, frame rate and JPEG quality.
- These are set when the capture starts. Changing one means restarting the capture process, not Pi Hub.

## Decisions

**C1 Who and where.** The owner only, like the Room view itself. A "Camera settings" disclosure under the Room view on
Workshop › Printer, closed by default, shown only while the Room view is the chosen view. Rejected: a separate settings
page. The owner adjusts while looking at the picture.

**C2 The controls.** Every option above that does something on this sensor, grouped by what the owner is trying to do.
Each group has a short label, plain words, and the camera's own default.

| Group | Controls | Range or choices | Default |
|---|---|---|---|
| Orientation | Turn | 0°, 90°, 180°, 270° | 0° (the stored value from A17's file, below) |
| | Mirror, flip | on or off each | off |
| Framing | Zoom | 1× to 4×, in 0.5 steps | 1× |
| | Centre (while zoomed) | across and down, 0–100% | 50%, 50% |
| Light | Exposure compensation | −2 to +2 EV, in 0.5 steps | 0 |
| | Brightness | −0.5 to +0.5 | 0 |
| | Contrast | 0.5 to 2 | 1 |
| | Metering | centre, spot, average | centre |
| | Exposure mode | normal, sport | normal |
| | Manual exposure | off, or shutter (1/1000 s to 1 s) and gain (1 to 16) | off |
| Colour | White balance | auto, incandescent, tungsten, fluorescent, indoor, daylight, cloudy | auto |
| | Saturation | 0 (black and white) to 2 | 1 |
| Detail | Sharpness | 0 to 2 | 1 |
| | Noise reduction | auto, off, fast, high quality | auto |
| Live quality | Preset | Data saver (640×480, 10 fps, q50, about 1.4 Mbit/s); Clear (1296×972, 10 fps, q60); Sharp (1920×1080, 15 fps, q70, about 6.5 Mbit/s at 720p measured, more at 1080p) | Data saver |

- Each preset shows its measured or estimated bandwidth next to its name. The bandwidth matters on a phone away from
  home; the Pi's heat and CPU don't (A17's table).
- Stills use the same light, colour, detail, orientation and framing settings, at the preset's size.
- Rejected: explicit red and blue gains (`--awbgains`). The white-balance choices cover the owner's case. Raw gains are
  a calibration tool, not something the owner adjusts by eye.
- Rejected: free size and frame-rate fields. Three presets are the useful points. Free fields let a value through that
  the sensor runs badly at.

**C3 Apply, don't stream every change.** The controls are a form with "Apply" and "Reset to defaults".
- **Apply** validates on the hub, saves, restarts the capture once and shows a fresh still. Viewers watching live see a
  gap of about 2 seconds, then the new picture.
- **A slider never restarts the camera while it moves.** One restart per Apply.
- **Reset to defaults** asks first (the kit's inline confirm), then applies the defaults.
- Rejected: changing controls on a running capture without a restart. `rpicam-vid` can't. Picamera2 can, but it means
  replacing the capture process with an in-process camera, a new dependency, and a larger change than the owner asked
  for. It is named as a follow-up if the restart gap proves annoying.

**C4 Where the settings live.** In Pi Hub's own database (the existing `settings` table, one key holding the JSON),
not in `/etc/pi-hub/`.
- On first start after this ships, `ROOM_CAMERA_ROTATE` from A17's file seeds "Turn", so the 90° set on 7 Nov carries
  over. After that, the file is ignored and the page is the only place to change it. The file and its systemd line are
  removed in the step that ships this.
- The hub validates every value against C2's table and refuses anything else (unknown keys, values out of range,
  choices not listed) with a plain reason. Nothing from the form reaches the command line except a validated number or a
  listed word.
- Rotation 90° and 270° stay in CSS, as A17 R8; 180° and the flips are applied at capture.
- Rejected: per-device settings. There is one camera and everyone watching sees the same picture.

**C5 Every change is logged.** Each Apply and Reset writes one line to the action log (`room-camera:settings`), with the
device and the fields that changed. No frames, as A17 R5.

**C6 Routes.**
- `GET /api/camera/room/settings`: the current settings, the defaults, and C2's ranges, so the page draws the form
  from the hub's own table rather than a copy.
- `POST /api/camera/room/settings`: apply. `POST /api/camera/room/settings/reset`: reset.
- All three need the owner, like the other Room view routes. A write that arrives while a previous one is still
  restarting the capture answers 409, "The camera is still applying the last change."

**C7 States and design.** Appliance-ui `DESIGN.md` after Pi Hub's baseline and amendments, A10 and A14.
- **States:**
  - closed;
  - open with defaults;
  - edited but not applied ("Not applied yet");
  - applying;
  - applied, with a fresh still;
  - refused, with the reason beside the field;
  - camera unavailable (controls disabled, with the camera's reason);
  - the hub didn't answer.
- **Accessibility:** every control is a native input, select or button with a visible label; keyboard reachable with
  visible focus; no motion.
- **Layout:** groups stack on a phone and sit in two columns where there is room.

## Steps (each its own PR after this merges)

1. **Backend:** the settings model and validation (C2, C4), the capture arguments built from it, restart on apply
   (C3), the log line (C5), and the three routes (C6).
   - Tests:
     - every control's range and choices, including refusals;
     - the seed from `ROOM_CAMERA_ROTATE`, once;
     - the command line built for each setting;
     - one restart per apply;
     - 409 while applying;
     - owner-only;
     - the log line.
2. **Page:** the disclosure, the form, Apply and Reset, and every state (C7).
   - Checks:
     - the node page tests;
     - the width sweep and axe;
     - screenshots at phone, tablet and desktop widths, in light and dark.
3. **Acceptance (owner):** change exposure and white balance until the dark room reads well, turn and zoom, try each
   live preset at home and away, and reset. Record it in `docs/operations.md` as "A18 accepted <date>".

## Out of scope

- **Adjusting the printer's own camera.** It belongs to the printer and the camera bridge.
- **Changing settings without a restart (Picamera2).** Named follow-up in C3.
- **Schedules,** such as night settings. Revisit if the owner ends up switching by hand.
