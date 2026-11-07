# Amendment A16: the lab page shows an experiment's plan before the owner approves it

Date: 2026-11-07 · Status: **proposed** (approved when the owner merges this PR) · Amends: A7 (one page) for the lab
page, and the print-lab design's rule that the Mac is the record and Pi Hub only mirrors it.

## Why

On 7 November the owner had to ask, one question at a time in chat, what a planned test would print, how big it was,
what it cost, why the lab blocked it and which settings differed. The answers came from the terminal: a strip's
height range, a slice estimate, guard codes such as `undeclared_difference`, and a budget that read "211.4 / 180 min"
(a question's running total that the owner took for the test's own time). The owner wants the settings, views,
renderings and the slice and AI feedback on the lab page, before approving, not in a chat afterwards.

## Decisions

**P1 The Mac builds the preview; the hub shows it.** When `lab exp build` or `lab exp check` runs, the Mac writes a
`preview` block into the experiment's mirrored record and the next sync carries it. Pi Hub never slices, renders or
analyses, and never writes a preview back. The hub stores and serves what it is sent, as it does for every lab record.

**P2 What the preview holds.** For one build: its id and sha256; the source model and which part of it prints (a
height range, in millimetres and inches); the settings that differ between the pieces on the plate, in the lab's own
words with from and to values; the slice's estimate (minutes, grams, layers); the budget; every guard result as a
sentence; a rendered outline; and the analysis (P5).

**P3 The render is an outline, not a 3D view.** The Mac draws the tile's front and side outlines from true cross
sections and shades the printed part, as an SVG of a few kilobytes inside the record. The page draws it with the page's
own colour tokens, so it follows light and dark and the text size (A14). No image file, no new viewer, no WebGL.
Rejected: a 3D viewer (a new dependency and weight for what two outlines show) and a PNG (fixed colours, no theme).

**P4 Budget shows two numbers, never one.** "This test: 95.5 min, 44.1 g" and "Question Q-007: 115.9 + 95.5 = 211.4 of
180 min", each against its own limit. A guard that blocks says which limit, by how much, and whether raising it is the
owner's decision (it always is) or the Mac's to fix (a mismatch in the plan).

**P5 Slice analysis and AI reading are two labelled blocks.** Measured facts from the sliced file (layer time, outer wall
speed, where sparse infill starts, what differs between the pieces) are one block, dated and tied to the build's sha256.
An AI reading is a separate block headed "AI reading, not measured", with its source and date, and is never shown as the
owner's words. The Mac generates both when the build is checked; the page does not ask for them (a button that asks for
a fresh one is deferred, see Q2). Spec rule kept: say "likely" until a single-factor test confirms it.

**P6 Stale is shown, never hidden.** If the build's sha256 no longer matches the record's current build, the preview is
marked "out of date, rebuild on the Mac" and its guards and budget are greyed. If the sync is older than 15 minutes the
page says when it was last updated. A preview that was never built shows "Not built yet" and the command that builds it.

**P7 Approval stays on the Mac in this amendment.** The page shows the exact `lab exp approve` line with a copy button
and says which limits the approval waives. A page that approves is a write path into the lab with its own ticks and
record, so it is a later amendment (Q1), after the preview has been used.

**P8 Where it sits.** On the experiment's card on `/lab`, above Verdict, reached from the Needs-you item "E-0nn is
planned" that the Mac raises when a build exists and no approval does. Names follow the owner's rule: plain words first
("the 3-wall strip"), the E-number in brackets.

**P9 Design contract.** Appliance-ui `DESIGN.md` after Pi Hub's baseline and amendments: phone first and fluid (A10),
text size (A14), every control keyboard reachable with a visible focus, `prefers-reduced-motion`, and every state
designed: not built, building, built, stale, blocked, approved, long content, sync late.

## Open questions

**Q1 Approve from the page?** Recommend a later amendment with the A12 shape: two ticks, a record, owner only.
**Q2 Ask for a fresh analysis from the page?** It needs the Mac to be listening. Recommend deferring until P1–P8 are used.
**Q3 Plan a strip from the page** (pick the height, the walls) so the owner no longer needs `lab exp plan`? Recommend
after Q1, because it is a write path of its own.

## Acceptance

The owner opens a planned, built experiment on the phone and can say, without the terminal: what prints and how tall in
inches, what differs, what it costs against each limit, why it is blocked if it is, and what the slice measured. Then the
owner approves it on the Mac with the line shown. Recorded in `docs/operations.md` as "Accepted <date>".

## Not in this amendment

The plan (steps and PRs) follows this spec's merge, per the platform-plan rule. Changing the lab's guards or budgets is
not part of it.
