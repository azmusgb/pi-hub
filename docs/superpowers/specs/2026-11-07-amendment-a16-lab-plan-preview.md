# Amendment A16: the lab page is where the owner looks at, plans and approves an experiment

Date: 2026-11-07 · Status: **approved** 7 November 2026 (pi-hub #167) · Amends: A7 (one page) for the lab
page, and the print-lab design's rule that the Mac is the record and Pi Hub only mirrors it.

## Why

On 7 November the owner had to ask, one question at a time in chat, what a planned test would print, how big it was,
what it cost, why the lab blocked it and which settings differed. The answers came from the terminal: a strip's
height range, a slice estimate, guard codes such as `undeclared_difference`, and a budget that read "211.4 / 180 min"
(a question's running total that the owner took for the test's own time). The owner wants the settings, views,
renderings and the slice and AI feedback on the lab page, before approving, not in a chat afterwards.

## Direction

The owner wants to work in the print lab interactively, with visuals, not read terminal output. This amendment is the
whole direction in four steps, each usable alone and each its own PR after this spec merges:

1. **Preview:** a planned build's outlines, differing settings, estimate, two budgets, guards and measured analysis (P1–P9).
2. **Model viewer:** the same model as a rotatable view with a section plane and the printed span highlighted (P10).
3. **Plan from the page:** pick the strip's height and walls, see the preview of what the Mac builds (P11).
4. **Result view:** after a print, the slice facts by height beside your photos and verdict (a later amendment).

## Decisions

**P1 The Mac builds the preview; the hub shows it.** When `lab exp build` or `lab exp check` runs, the Mac writes a
`preview` block into the experiment's mirrored record and the next sync carries it. Pi Hub never slices, renders or
analyses, and never writes a preview back. The hub stores and serves what it is sent, as it does for every lab record.

**P2 What the preview holds.** For one build: its id and sha256; the source model and which part of it prints (a
height range, in millimetres and inches); the settings that differ between the pieces on the plate, in the lab's own
words with from and to values; the slice's estimate (minutes, grams, layers); the budget; every guard result as a
sentence; a rendered outline; and the analysis (P5).

**P3 The first render is an outline; 3D is deferred, not banned.** The Mac draws the tile's front, side and top outlines
from true cross sections and shades the printed part, as an SVG of a few kilobytes inside the record. The page draws it
with its own colour tokens, so it follows light and dark and the text size (A14). No image file, no new viewer, no
WebGL. A 3D view may come later as an optional lazy-loaded enhancement, and never as something approval depends on.
Rejected for now: a 3D viewer (a new dependency and weight for what three outlines show) and a PNG (fixed colours, no
theme). The page also shows the model's measured bounds in millimetres and inches, from the source mesh.

**P4 Budget shows two numbers, never one.** "This test: 95.5 min, 44.1 g", each against its own limit and by how much
it is over or under it ("13.7 min over the 45 min test limit"), and separately "Question Q-007: 115.9 + 95.5 = 211.4 of
180 min". A guard that blocks says which limit, by how much, and whether raising it is the owner's decision (it always
is) or the Mac's to fix (a mismatch in the plan).

**P5 Slice analysis and AI reading are two labelled blocks.** Measured facts from the sliced file (layer time, outer wall
speed, where sparse infill starts, what differs between the pieces) are one block, dated and tied to the build's sha256.
An AI reading is a separate block headed "AI reading, not measured", with its source and date, and is never shown as the
owner's words. The Mac generates both when the build is checked; the page does not ask for them (a button that asks for
a fresh one is deferred, see Q2). Spec rule kept: say "likely" until a single-factor test confirms it.

**P6 Stale is shown, never hidden, and its kinds are kept apart.** Three things can be old, and each has its own
line: the build (its sha256 no longer matches the record's current build: "out of date, rebuild on the Mac"), the sync
(older than 15 minutes: "last updated 40 minutes ago, the Mac may be asleep"), and the printer's reading. A preview
that was never built shows "Not built yet" and the command that builds it. Old evidence stays readable and never
authorises an action; guards and budget of a stale build are marked, with their text still readable.

**P7 Approval is the page's existing one, shown with its numbers.** The lab page already queues an approval
(`approveRequest` in `lab.js`: it sends `build_seen` and the guard codes, and the Mac rechecks both before applying,
`lab/pull.py`). This amendment adds nothing to that route except what the owner sees before tapping: the two budget
numbers (P4), the limits the approval waives, and what the plan changes. Queueing an approval needs the owner role
(pi-hub #168). A first version of this amendment said approval stayed on the Mac; that was wrong.

**P8 Where it sits.** On the experiment's card on `/lab`, above Verdict, reached from the Needs-you item "E-0nn is
planned" that the Mac raises when a build exists and no approval does. Names follow the owner's rule: plain words first
("the 3-wall strip"), the E-number in brackets.

**P9 Design contract.** Appliance-ui `DESIGN.md` after Pi Hub's baseline and amendments: phone first and fluid (A10),
text size (A14), every control keyboard reachable with a visible focus, `prefers-reduced-motion`, and every state
designed: not built, building, built, stale, blocked, approved, long content, sync late.

**P10 Model viewer, optional and lazy (step 2).** A rotatable view of the source mesh, drawn with the page's own code (no
library), with a section plane (drag to cut at a height, shown in millimetres and inches) and the printed span
highlighted. The Mac sends the decimated mesh as a hash-addressed file (capped at 1 MiB; the RIFT tile is 646 triangles,
about 50 KB). It loads only when opened, so the preview and approval never wait for it, and it falls back to the
outlines if the mesh is missing, too big or the device can't draw it. It reads the model, not the slice, and says so.

**P11 Planning from the page is a request to the Mac (step 3).** The owner picks a height and a wall count; the page
sends a `plan` request (the existing request queue, owner role); the Mac plans, builds and checks it with the lab's own
code and its answer arrives as a new preview. The page shows "waiting for the Mac" and never invents an estimate: the
number comes from the Mac's slice, which takes a minute or two. Only settings the lab already supports are offered, one
factor at a time, so the one-factor and budget guards still apply. Rejected: slicing or estimating on the Pi.

## Open questions

**Q1 Approve with ticks, like Start?** Today the page's Approve takes a reason only. Recommend leaving it.
**Q2 Ask for a fresh analysis from the page?** It needs the Mac to be listening. Recommend deferring until P1–P8 are used.
**Q3 Which settings can the page offer in step 3?** Recommend only strip height and wall count at first, the two the
owner has actually been choosing.

## Acceptance

The owner opens a planned, built experiment on the phone and can say, without the terminal: what prints and how tall in
inches, what differs, what it costs against each limit, why it is blocked if it is, and what the slice measured. Then the
owner approves it on the page with those numbers in view. Recorded in `docs/operations.md` as "Accepted <date>".

## Not in this amendment

The plan (steps and PRs) follows this spec's merge, per the platform-plan rule. Changing the lab's guards or budgets is
not part of it.
