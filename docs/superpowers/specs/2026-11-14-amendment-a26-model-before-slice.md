# Amendment A26: see the model on the phone before it is sliced

Date: 2026-11-14 · Status: **proposed** (approved when the owner merges this PR) · Amends: A19 P7 (Quick Print's 3D view
is offered once a slice exists) · Builds on: A19 (Quick Print), A16 P10 (the hub stores and serves, the browser draws).

## Why

The owner designs parts on the Mac (CAD, build123d) and wants to look at one on the phone as a normal web page, from the
Pi, without a tailnet-only viewer or a hosted copy. Quick Print already takes an STL or 3MF from the phone, stores it
on the Pi and serves it to the 3D view (`GET /api/quick/jobs/{id}/model`). The view is only offered after a slice, so a
model that has been uploaded cannot be looked at until the Mac has sliced it.

## Decisions

**D1 Reuse Quick Print; no new page, route, store or library.** The model route, the vendored Three.js and the viewer
(`quick-3d.js`) already exist and already follow A19 P7's rules: loaded only on a click, never part of authorising a
print, one plain line on any failure.

**D2 A job with a stored model and no slice offers the same "Open 3D view" button.** Canceled jobs and jobs whose file
was removed do not. The 2D layer inspector still appears only for a sliced job.

**D3 Before a slice the view shows the model alone.** It is drawn solid on a plate sized to the model, moved so it sits
on the plate; the status line says "Not sliced yet, so this is the stored model alone" with its width, depth and
height in millimetres. The section slider and the Model/Toolpaths toggles are not shown, because there are no layers.
Views, orthographic/perspective, keyboard and the reduced-mode caps are unchanged.

**D4 Nothing to draw is said plainly.** No slice and no readable STL (a 3MF, a removed file, a bad file) shows "This
job has no STL to draw and no sliced file yet, so there is nothing to show in 3D." and hides the stage. A 3MF model
before slicing is not drawn here; the hub does not read meshes (A16 P1).

## Non-goals

Sending a model from the Mac to the hub without the phone's file picker; browsing designs; a 3MF reader; any change to
slice, review, prepare, start or monitor.

## Evidence required

`tests/browser/quick3d.mjs` checks an unsliced job draws the model with its size, shows no section slider or toolpath
toggle, has no page errors, and says "nothing to show in 3D" when there is no STL; every earlier check still passes.
Python and JS suites unchanged. After the PR ships, the owner uploads an STL on the phone and opens the view.
