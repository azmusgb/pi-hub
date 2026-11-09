# Amendment A20: richer Room view controls (live adjust, quick looks, capture, viewing tools)

Date: 2026-11-08 · Status: **approved** 8 November 2026 (pi-hub #191) · Amends: A17 R5 (frames are never stored) and A18 C3 (Apply restarts the
camera). Everything else in A17 and A18 stands. A plan follows only after the owner merges this.

## Why

The owner asked for "richer controls" on the Room view. A18 already exposes every `rpicam` option, so the gap is not
more options. It is how they are used: every change needs Apply and a restart gap of about 2 s, the owner has to
remember good combinations, nothing can be kept from the picture, and the picture can't be inspected. The owner chose
all four: live adjust, quick looks, capture, viewing tools.

## Read on the Pi, 8 Nov 2026

- `picamera2` is already installed system-wide (Debian 13 trixie). Live adjust needs no new package.
- Pi 4, 3.8 GB RAM (about 1.9 GB used), root filesystem 29 GB with 9.9 GB free (65% used).

## Decisions

**D1 Live adjust replaces restart-on-Apply for the controls that allow it.** The capture process becomes an
in-process Picamera2 pipeline owned by `room_camera.py`. Light, colour and detail controls (EV, brightness, contrast,
saturation, sharpness, white balance, metering, exposure mode, manual shutter and gain) change on the running camera
through `set_controls`, sent while a slider moves (at most 5 per second per viewer). Orientation, zoom and the live
preset change the stream's shape, so they still apply once, with a restart, as A18 C3. This supersedes A18 C3's
"Apply" for the live-changeable group only. Settings still persist only when the owner taps **Save**, so dragging
never writes the database. A18's rejection of Picamera2 ("a larger change than the owner asked for") is withdrawn
because the owner has now asked for it. Fallback: if Picamera2 fails to start, the hub uses A18's `rpicam` path
unchanged, and the form reverts to Apply.

**D2 Quick looks.** Three built-in looks (Night, Bright, Bed close-up) and up to 8 looks the owner saves by name from
the current settings. A look is a validated settings object (A18 C2's table), applied in one tap and shown as chips
above the picture. Built-ins are in code, saved looks in the `settings` table, owner-only. A look never contains
Turn, so applying one doesn't rotate the picture.

**D3 Capture: a snapshot, kept only when the owner asks.** A "Save snapshot" button stores one JPEG. This amends A17
R5 for this one case: frames are still never written or logged by Pi Hub on their own; a snapshot exists only
because the owner tapped. Stored under `/var/lib/pi-hub/room-snapshots/`, at most 200 (oldest removed first), listed
newest first, each with time and the settings in force. Deleting one is one tap. They never leave the Pi except to a
signed-in owner. Attaching a snapshot to an experiment or run is a separate step that belongs to print-lab's record
(its own spec) and is not part of this amendment. Rejected: timelapse. It is a separate feature with its own storage
and encoding cost, and it needs a decision on which print it belongs to. Named follow-up: an amendment if the owner
wants it.

**D4 Viewing tools, in the browser only.** Fullscreen (with Escape to leave), pinch-zoom and drag-pan on the picture,
and an optional grid overlay and histogram. All are drawn client-side from the picture already received, so the Pi
does the same work as today. Pinch-zoom is a view of the stream and is separate from the camera's own Zoom control,
and the page says which one is in use.

**D5 Where it lives.** The same disclosure and the same owner-only rule as A18 C1. Layout, top to bottom: the picture
with its viewing tools; quick looks; the live sliders grouped as A18 C2; Save, Reset (A18's inline confirm kept) and
Save snapshot. On a phone the picture stays pinned at the top while the controls scroll under it, so a slider can be
judged against the picture. Native inputs, visible labels and keyboard operation as A18.

**D6 Safety.** Every value is validated on the hub against A18 C2's table before it reaches the camera; the live
channel accepts only known keys and in-range numbers. The live channel is signed-in owner only. One Save writes one
action-log line (A18 C5); drags are not logged.

## Not decided here

- Where snapshots end up in the lab record (print-lab spec).
- Timelapse.
- Showing Room view on the display or Home (A17 R3's named follow-up).

## Done means (proposed, for the plan)

1. A slider changes the picture within about 0.5 s on the owner's phone, with no restart gap.
2. A saved look applies in one tap and survives a Pi Hub restart.
3. A snapshot is saved, listed, and deleted, and the 200 limit is shown to hold.
4. Pinch, pan and fullscreen work on a phone, and the controls pass axe and the width sweep.
5. With Picamera2 forced to fail, the Room view still works through A18's path.
