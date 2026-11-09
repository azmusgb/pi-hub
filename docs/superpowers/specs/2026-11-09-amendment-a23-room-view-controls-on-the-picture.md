# Amendment A23: Room view controls on the picture

Date: 2026-11-09 · Status: **approved** 9 November 2026 (pi-hub #218) · Amends: A20 D5 (where the controls live and their order). Everything else
in A17, A18 and A20 stands: the same controls and ranges (A18 C2), live adjust (A20 D1), looks (A20 D2), snapshots
(A20 D3), viewing tools (A20 D4) and validation (A20 D6). A plan follows only after the owner merges this.

Mockup the owner approved on 9 Nov 2026 ("amazing"): https://claude.ai/artifact/XiUEMgxCFfLPmWrKFypg8w

## Why

The owner, asked how the controls get in the way: "long list - having to scroll". Asked what they want: "cluster,
group, add controls to the actual video pane". Today the Camera settings panel lists all 19 settings in six groups,
one under another (`workshop.js` `makeSettings`, groups from `room_camera.py` `CONTROLS`), so every change starts by
scrolling past controls that are almost never used. The three things the owner does nearly every time (turn or flip
the picture, frame the printer, make the picture look right) get the same weight as shutter, gain and metering.

## Read in the code, 9 Nov 2026

- Every control already changes on the running camera (`room_camera.py:124-128`, `LIVE_KEYS` is all of them). The
  helper rebuilds its stream itself for Turn, Mirror, Flip and the live preset, so these show a short gap but no
  restart of the capture process.
- Live changes are rate-limited to 10 per device per second (`LIVE_RATE`).
- Looks never contain Turn, Mirror, Flip or the preset (`FORBIDDEN_LOOK_KEYS`).
- The settings panel opens the picture live while it is open (A20 plan decision 6).

## Decisions

**D1 Two states: watching and adjusting.** Watching is the Room view as today, minus the camera controls: the picture,
Watch live, Full screen, and A20 D4's view tools (View zoom by pinch, Grid, Histogram) in their small toolbar, which
change only what the viewer sees. **Adjust** (the owner's existing Camera settings disclosure, renamed) switches to adjusting:
the picture goes live (as now), its controls appear on it, and the panel below opens. Leaving adjusting removes the
controls from the picture. The household never sees adjusting; the owner-only rule of A18 C1 is unchanged.

**D2 Controls on the picture, in three bars over the image.** Each bar sits on a dark scrim so it reads over any
picture, in both themes.
- **Top:** a live badge ("Live · 10 fps"), then **Turn** (one button; each press adds a quarter turn and its label
  shows the current turn), **Flip** and **Mirror** (pressed or not).
- **Side:** **Zoom in**, **Zoom out** and **Fit**. These are the camera's Zoom control (1×–4×, step 0.5); Fit is 1×
  with the centre at 50/50.
- **Bottom:** a line saying what is in use ("Camera zoom 1.5× · drag to frame"), then **Grid**, **Histogram**,
  **Snapshot** and **Full screen**. The watching toolbar is hidden while adjusting, so no tool shows twice.
- **Full screen** carries the same three bars while adjusting (the bars are built once and mounted in whichever
  container shows the picture).
- **States (builder's call, recorded):** until the first live frame arrives, or when the camera drops out, the bars
  stay in place but every camera button is disabled and the badge says why ("Starting…", "No picture: <A17 reason>").
  Snapshot needs a live frame. Nothing on the bars claims a value the camera hasn't confirmed.
- **Rapid taps (builder's call, recorded):** taps and drags share A20's live channel and its rate. Repeated taps on
  one control coalesce into one send of the final value; a refused or failed send puts the button back to the
  camera's last confirmed value and says so in the existing status line.

**D3 Drag the picture to frame it.** While adjusting and zoomed in past 1×, dragging the picture moves the camera's
centre (Centre across and Centre down). The two centre sliders are removed from the panel. The picture follows the finger, like
moving a map: dragging left shows more of the right side, so the centre moves opposite to the drag. While a drag
moves, the page shifts the received frame at once (the edges it doesn't have yet show the frame's background until the
camera's next frame arrives) and sends the new centre at most the live rate allows; the last position
is always sent when the drag ends, so the camera ends where the finger stopped. Arrow keys move the centre in 1% steps
when the picture has focus, so framing works without a pointer. At 1× a drag does nothing (there is nothing to move).

**D4 Pinch stays a view, not the camera.** A20 D4's pinch-zoom and drag-pan inspect the picture already received
and never change the camera. To keep one meaning per gesture: while adjusting, one-finger drag frames the camera
(D3) and the on-picture +/− set camera zoom; pinch-zoom and its pan work only while watching. The bottom line says
which zoom is in use, as A20 D4 requires.

**D5 Looks are one row of chips, Auto first.** **Auto** returns Light, Colour and Detail to the camera's defaults.
It never changes Turn, Mirror, Flip, Zoom, the centre or the preset, so it can't undo a framing (builder's call,
recorded). A look may still set framing when it is the point of the look (Bed close-up sets Zoom 2×, as today). Then the built-in looks (Night, Bright, Bed
close-up), then saved looks, then **Save this look**. The chip for the look in force is pressed; any later change
un-presses it. Looks still never change Turn, Mirror, Flip or the preset (A20 D2).

**D6 Adjust shows one group at a time.** A row of three tabs: **Light**, **Colour**, **Detail**. Each shows only its
own controls. Colour: White balance, Saturation. Detail: Sharpness, Noise reduction, and Live quality (the preset;
a tab of its own would hold one control, builder's call, recorded). Light shows Exposure
compensation, Brightness and Contrast; Shutter, Gain, Metering, Exposure mode and Manual exposure are in a folded
**Manual exposure** inside Light, closed by default; Shutter and Gain stay disabled until Manual exposure is on, as
today. Orientation and Framing are no longer groups in the panel: they
are on the picture (D2, D3). The last tab opened is remembered per device.

**D7 Leaving Adjust keeps what is running.** Closing Adjust without Save leaves the camera on the changes made, as
today: they run until the next restart of the hub or the camera, and only Save makes them permanent. The owner chose
this on 9 Nov 2026 over reverting to the saved settings or asking on the way out. Cost, accepted: the household can
see an unsaved look until the next restart, so the Adjust disclosure's summary says "Unsaved changes" while any are
running.

**D8 What stays below.** Save and Reset (A18's inline confirm kept; Reset returns every setting to the defaults,
Turn, Mirror, Flip, framing and the preset included, as today), with a line saying "Changes apply live. Save
keeps them." Snapshots' list stays where A20 put it, below the panel.

**D9 Phone and keyboard.** On a phone the picture stays pinned at the top while the panel scrolls under it (A20 D5,
already built by #206's container query). Every control on the picture is a real button with a visible label or an
accessible name, at least 44 × 44 px (DESIGN.md targets), reachable by Tab in reading order (top bar, side bar,
bottom bar), with a visible focus ring. The bars don't animate in when reduced motion is set.

## Done means (proposed, for the plan)

1. While watching, the picture carries no camera controls.
2. While adjusting, turn, flip, mirror, zoom in/out, fit, grid, snapshot and full screen work from the picture, and
   the panel has no Turn, Mirror, Flip, Zoom or centre controls.
3. Dragging the zoomed picture moves the camera's framing, and the camera ends where the drag ended; arrow keys do the
   same in 1% steps.
4. One tap on a look chip applies it; Auto returns the look-able settings to the defaults.
5. The panel shows one of Light, Colour or Detail at a time; Manual exposure is folded.
6. At 320 px wide every control on the picture is fully visible, a 44 px target, and doesn't cover more of the
   picture than the three bars; the width sweep and axe pass; screenshots at phone, tablet and desktop, light and
   dark, are reviewed.
7. Owner acceptance on the real camera, recorded in `docs/operations.md`.

## Not decided here

- The icons and exact copy on the bars (the plan settles them under DESIGN.md's rules).
- Whether the household gets a read-only Full screen on the Room view (A17 R3's follow-up).
- Timelapse (A20's named follow-up).
