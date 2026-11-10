# Amendment A24: the print twin, a live 3D view of what the printer is printing

Date: 2026-11-10 · Status: **draft** for owner review · Amends: A16 P10 (the model viewer becomes a live view as well as a
planning one), A17/A20/A23 (the room camera sits beside it, unchanged).

## Why

The owner opens Workshop › Printer during a print and gets a percentage, a time left and "Layer 140 / 653". That says
how far along the print is. It does not show what exists on the plate yet, which part of a multi-part plate is being
laid down, or whether the picture on the Pi camera matches what the slice says should be there. The owner wants to
glance at the phone, from the sofa or the desk, and see the part growing, layer by layer, in the model's own shape.

## Direction

One new view on Workshop › Printer, shown only while a print is running or paused and for the last finished print.
It is the existing telemetry plus geometry the Mac already holds. Pi Hub never slices, renders or analyses.

## Decisions

**D1 Works for every print the X2D runs, with an honest fallback.** The Mac holds the sliced 3MF for every print it sent
(lab, quick print, Fusion-to-lab). For those it sends the twin a geometry file. For a print started elsewhere (Studio
direct, the touchscreen) there is no geometry: the view shows the progress readout and the room camera only, headed "No
model for this print", never a made-up shape.

**D2 Matching a print to its geometry.** The hub matches the printer's `job_name` to a twin record the Mac has mirrored,
by exact name and a start time inside the record's window. No match, or more than one, is "No model for this print".
The page says which of the two it is, and never picks the nearest name.

**D3 What the Mac sends (same route as lab records, hash-addressed, capped).** For one print:
- `mesh`: the plate's objects as a decimated triangle mesh, one group per object, with its plain name ("tilt gauge",
  "pivot bolt 2 of 4"). Cap 1 MiB, content-addressed by sha256, as A16 P10.
- `layers`: the slice's layer table, one row per layer: top z in millimetres and, per object, whether it has material on
  that layer. This is what lets the page paint "layer 140" onto the right parts.
- `built_from`: the 3MF's sha256 and the slicer's own total layer count.
The Mac derives all of it from the sliced file, not the source model, so the twin shows what was sliced.

**D4 The page draws; no library.** As A16 P10: the page's own code draws the mesh (no WebGL dependency; a 2D canvas with
depth-sorted triangles is enough at this size and is the fallback where WebGL is missing). Below the printed height the
part is solid in the filament's colour (the telemetry reports it, e.g. `AF7933FF`); above it, a quiet outline in `line2`
and nothing else. The current layer is a thin band in `accent`. Drag turns the view, pinch or the +/- buttons zoom,
double tap resets; a "Follow the print" toggle keeps the camera on the current layer.

**D5 Progress is the printer's, never ours.** The painted height comes from the printer's `layer_num`, mapped through
`layers`. If `total_layers` from the printer differs from the record's, the view says "The printer and the slice
disagree (653 vs 650 layers)" and stops painting, rather than guessing. Percent and time left stay exactly as the
telemetry gives them.

**D6 What's printing now.** On a multi-object plate the object with material on the current layer is highlighted and
named in a line under the view ("Printing: pivot bolt 2 of 4"). Objects already finished (their last layer is below the
current one) get a tick and "done", objects not yet started "waiting".

**D7 Going wrong.** The twin does not detect failures. It surfaces what the printer and Hub already say: a paused or
error state replaces the progress line with the printer's own words and the existing Needs-you item. The room camera
stays next to the view so the owner compares them by eye. A learned "this looks wrong" alarm is a separate amendment (the
defect-radar idea), not this one.

**D8 Scrubbing the finished print.** For the last finished print, a slider scrubs layers 1…N with the readout in
layer number and height in mm and inches. The same view serves "what did that print contain" without a second page.

**D9 Honest states, each designed.** Live (updating, with the age of the last reading), paused, error, stale telemetry
("last update 3 min ago"), Mac asleep (geometry older than the sync window but the print is running: shows the view
from the geometry already held, labelled with its age), no model (D1), mismatch (D5), loading the mesh, mesh too big
or the device can't draw it (falls back to the progress readout). Nothing demonstration-only ships as live.

**D10 Design contract.** Appliance-ui `DESIGN.md` after Pi Hub's baseline and amendments: phone first and fluid (A10), text
size (A14), tokens only (no colour set on the page, the filament colour excepted because it is data, drawn with a text
label of its name so it is never the only signal), every control keyboard reachable with a visible focus,
`prefers-reduced-motion` turns the follow-camera and the layer band's glide into steps, tabular numerals for layer and
height, sentence case, lamp words with dots for state. No panel inside a panel: the view, one status line and the
controls are one block under the printer's headline.

**D11 Where it lives and how it's built.** A section on Workshop › Printer above the room camera; the geometry loads only
when the section is opened or scrolled into view (A16 P10's lazy rule), so the printer readout never waits on it.

## Parts (each its own PR after this merges)

- **P1 Mac side (print-lab):** write the twin record (mesh, layers, built_from) when a print is sent; sync it with lab
  records; tests with a fixture 3MF, including a multi-object plate and a size over the cap.
- **P2 Hub side:** accept, store (hash-addressed) and serve the record; match to `job_name` (D2); owner role to read as
  for the lab.
- **P3 The view:** canvas drawing, orbit/zoom, follow, layer band, per-object status (D4–D6), all states (D9).
- **P4 Finished-print scrub (D8) and acceptance** on a live print.

## Builder-check rulings (my calls, change any)

**R1 Transport.** The lab sync already takes 4 MiB per sync (`MAX_SYNC` in `hub/lab.py`), so one record of at most 1 MiB
plus its layer table fits. The twin rides that route as a new record kind and adds no endpoint. The "window" in D2 is
the sync interval plus 15 minutes (A16 P6's stale line).
**R2 Order.** The Mac writes the twin record before it sends the file to the printer and syncs on the next pass. A late
sync never blocks a send: the print runs and the view shows "No model for this print" until the record arrives, then
switches on its own.
**R3 Matching by id, not by name.** Names repeat (a reprint, two sends in one window), so D2's exact-name rule is
replaced: the Mac gives each print a `twin_id` and puts it in the job name it sends (`<name> ·<twin_id>` or the id in
the 3MF's metadata, whichever the X2D reports back in `job_name`, settled in P0 against one real print). Until P0 proves
the id comes back, matching stays by exact name and start window, and an ambiguous match is "No model".
**R4 Layer numbering is measured in P0, not assumed.** P0 slices a fixture, prints or replays a real one, and records
whether the printer's `layer_num` is 1-based and indexes the slicer's table directly (prime-tower and variable-height
layers included). D5's totals check stays as the safety net. If the two differ by a fixed offset the Mac writes the
offset into `layers`.
**R5 Plates with different layer heights or sequential printing.** The layer table is per object (each object's own
top z per layer index), and "done" / "waiting" (D6) compare z, not the index. By-object sequential printing is out of
scope and shown as "No model: sequential plate".
**R6 Decimation.** A budget per object (the cap divided by object count, weighted by size), so a thin part such as the
tilt gauge keeps its outline. The Mac checks that each object's decimated bounding box matches the original within
0.2 mm and refuses to send otherwise.
**R7 Retention.** The last 5 finished prints plus the running one, on the hub, oldest first out.
**R8 Open questions.** Q1 and Q2 are taken as recommended; Q3 is out of scope here.

## Not in this amendment

Failure detection from the camera; painting the real measured temperature or speed on the model; cloud viewing outside
the tailnet; editing anything from the view; other printers than the X2D.

## Open questions

**Q1 Keep the finished print's geometry how long?** Recommend the last 5 prints, then delete, since each is up to 1 MiB.
**Q2 Colour: filament colour or a neutral?** Recommend the filament's own colour with its name in text, falling back to a
neutral token when the printer reports none.
**Q3 Should a print started from Studio on the Mac be picked up?** Recommend yes later: the Mac can watch Studio's output
folder, but that is its own plan.
