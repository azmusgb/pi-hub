# A26, the model before it is sliced — Plan

Date: 2026-11-14 · Status: **proposed** · Covers: `docs/superpowers/specs/2026-11-14-amendment-a26-model-before-slice.md`.

**Goal:** an uploaded STL can be opened in Quick Print's 3D view before any slice exists.

**Waits on:** the A26 spec merging. The code is one PR, based on `main`, and is not merged before the spec.

## Steps

1. `hub/static/js/quick.js`: when a job has no slice, is not canceled and its file is not removed, put the "Open 3D view"
   button in the 3D box (the layer inspector stays sliced-only). Reword the button's line to "the model, and the
   toolpaths once it is sliced".
2. `hub/static/js/quick-3d.js`: when `/layers` answers state `none`, fetch the model first, centre it on its own plate,
   draw it solid, hide the section slider and Model/Toolpaths toggles, and write the status line from D3. Any other empty
   `/layers` answer fails as before. No STL: the D4 line and a hidden stage.
3. `hub/static/sw.js`: bump `SHELL`.
4. `tests/browser/quick3d.mjs`: the unsliced and no-STL cases from the spec.

## Done means

The spec's "Evidence required", plus the width sweep and axe on the Quick Print page at phone, tablet and desktop widths in
light and dark, seen and recorded.
