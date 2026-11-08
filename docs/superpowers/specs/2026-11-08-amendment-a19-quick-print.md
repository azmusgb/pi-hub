# Amendment A19: Quick Print, an ordinary STL goes from the page to the X2D

Date: 2026-11-08 · Status: **proposed** (approved when the owner merges this PR) · Amends: A12 D1 (the two named
writes to Bambuddy), D2 and D3 (one new start action, and what it may start), and A16 P3 and P10 (no 3D library, for the
Quick Print page only). Does not amend A12b; its hold applies unchanged (Q9).

## Why

1. **Printing an ordinary file still means leaving Pi Hub.** The owner slices in Bambu Studio and sends through Bambu
   Connect or Bambuddy's own screen. A12 gave Pi Hub a Start, but only for a build the lab checked and staged for an
   experiment (A12 D3: "It starts only a staged lab build").
2. **Experiment rules are the wrong gate for an ordinary print.** A hypothesis, a budget and an approval make sense
   for a test and none for a bracket.
3. **Quick Print needs authority the baseline doesn't grant.** Pi Hub may not stage a file in Bambuddy (A12 D1 allows
   that only for the lab's Mac), may not start anything but a lab build (D3), and the lab page is where the owner looks
   at and approves an *experiment* (A16). Starting a physical print is the most consequential action in the house, so it
   is decided here, not in a plan.

What must not change: the printer gets exactly the file that was checked, only the owner starts a print, nothing
starts on a plate the owner hasn't said is clear, and Pi Hub's path stays the only one that commands the printer.

## What exists today (read on 8 Nov 2026)

- Pi Hub `e693e6e` and print-lab `90b6a33` are live (`home` releases). The printer reads idle, Bambuddy connected.
- The start path is `hub/lab_start.py`: `refusals` (line 60: printer connected and idle, no HMS error, bed below 35 °C,
  a staged build in the mirror), `start` (line 96: check Bambuddy's version, download the library file and compare its
  sha256, add a queue item with `manual_start`, start it, delete the item if the start fails). Bambuddy is pinned to
  1.3.0 (line 22). One printer command at a time is `printer_control.BUSY` (`hub/printer_control.py:19`).
- Starts are per experiment: `/api/printer/start/{project}/{experiment}` (`hub/app.py:445`, 460, 507). Requests to the
  Mac are `lab_requests` rows keyed by project (`hub/lab.py:77`), which the Mac asks for every 60 s (`hub/mac_lab.py:2`).
  The Pi never slices (A16 P1, P11).
- The lab slices headless with Bambu Studio, pinned at 02.09.01.70 (print-lab `lab/adapters/bambu.py:9`). A CLI slice
  from an STL and loose presets has no X2D start sequence (no AMS load `M620`, no purge) and air-printed for ~30
  minutes on 27 Oct 2026.
- Bambuddy can't yet send to the X2D's internal storage, so a USB stick must stay in the printer or every upload fails
  `553` (print-lab one-tap spec, "Facts"; maziggy/bambuddy#2762). Lab prints are recognised by the name
  `<project>_<E-nnn>_<BLD-nnn-nn>` (`lab/pull.py:109`).

## Decisions

**Q1 Quick Print is its own record, owned by Pi Hub.** A Quick Print job is not an experiment, a run or a qualification.
Pi Hub owns its record and its state, and the sliced file it will dispatch, kept by its sha256. Two models were weighed:
(a) the Mac owns the record, as it does for experiments (A16 P1), or (b) Pi Hub owns it. (b) is recommended. The Mac
sleeps, and the hub's start must check the file against the sha256 *from a copy it holds*, as S3 does today; with (a) a
sleeping Mac would also block a start of a file Pi Hub could have checked itself. The cost of (b) is large files on the
Pi's disk, with their size limits and cleanup left to the plan. The Mac never holds the authority to start (A12 S1).

**Q2 Pi Hub stages the file; the Mac only slices.** A12 D1 lets the Mac upload and Pi Hub queue and start. Quick Print adds
two writes by Pi Hub's own printer-control path, and nothing else: it may upload a Quick Print file into a Bambuddy
folder named `quick-print`, and delete one it uploaded that failed the sha256 check. It never writes to the
`print-lab` folder, and the lab's Mac never uploads to `quick-print`.

**Q3 One start action more, same path, same confirmation.** Pi Hub's printer-control path (one lock, `BUSY`) gains
**Start a staged quick print**: owner only, confirms through its sheet (the two ticks, "The plate is clear and dry" and
"The filament matches", and the freshness checks of A12 S5), logs the device, and is never a palette action, a
notification button or a scheduled start. Quick Print and experiment starts take the same lock, so two starts can never
run at once. Pause, resume and stop are the existing actions and do not change.

**Q4 It starts only a file Pi Hub has proven.** The action takes a Quick Print job, not a file or a path. Pi Hub starts
only when: the stored artifact's sha256 equals the one recorded at the end of slicing; Bambuddy's copy, downloaded back,
has the same sha256 (A12 S3); and the artifact passed the start-sequence check (Q5). Any other library file stays in
Bambuddy's own UI.

**Q5 A slice that lacks the printer's start sequence is refused, whatever the slicer's exit code.** A slice counts as
usable only if it came from a complete X2D project (printer, nozzle, filament, plate and process settings embedded in the
3MF), and the resulting G-code carries the X2D start sequence (the AMS load `M620` and the lab's known-good start block).
A missing marker makes the job "Needs attention" and it can't be staged. A zero exit status is not evidence of a valid
slice. This turns the 27 Oct air-print into a refusal the page can show, and it is a safety rule, so it is stated here.

**Q6 The Mac is the slicing worker, asked through the existing request queue.** Pi Hub queues a `slice` request (owner role,
the existing `lab_requests` path); the Mac takes it on its next ask (60 s), slices with the pinned Bambu Studio, and returns
the file and the slicer's own estimate. A worker that hasn't asked recently shows as "Mac asleep, last seen …", never
idle. The slicer is the lab's pinned version; a different engine, such as OrcaSlicer or Bambuddy's own slicing, needs
evidence and its own amendment. A second worker (the PC) is not excluded: the request names what it needs (a
slicer and version), not a machine, but it is not built here.

**Q7 Start states say what is known.** A Quick Print job is Draft, Ready to slice, Queued, Slicing, Validating, Sliced,
Needs attention, Failed, Canceled or Stale; a start adds Staged, Queued in Bambuddy, Start requested, Start accepted,
Printing confirmed, Failed and **Outcome uncertain**. "Start accepted" is Bambuddy's answer; "Printing confirmed" is
the printer reporting a running job with that file. A changed model, transform or setting makes a slice **Stale**, and a
stale or failed job can't be staged or started. A canceled job never publishes a later result.

**Q8 An uncertain start is never retried by itself.** If a start's answer is lost, times out or contradicts the printer,
the job is Outcome uncertain. Pi Hub reads the printer and the queue item, and only when they show nothing running and
the item gone (or removed) may the owner start again. If the queue item can't be confirmed removed, it is shown and the
owner must resolve it first, as the one-tap sheet does today.

**Q9 A12b's hold applies, unchanged.** "Start when the bed is cool" works for a Quick Print on the same terms (bed the only
refusal, both ticks sent, everything checked again every 10 s, one hold in all, 45 minutes, dropped by a restart).
There is at most one hold across experiments and Quick Print together.

**Q10 Quick Print is never experimental evidence.** Its files are named `quick_<job id>`, never the lab's
`<project>_<E-nnn>_<BLD>` pattern, so `lab pull` makes no run from them. It has no budget, no guard codes and no verdict.
Its history is its own list ("Print history"), and nothing in it counts toward a question or a qualification.

**Q11 A reprint reuses a stored file only after the same checks.** Reprint offers the stored file after Q4 and the freshness
checks pass again, and says plainly when it needs a new slice instead. A new Bambuddy version (not 1.3.0) disables Start
with the reason, as A12 D4 does, until its probe passes.

**Q12 Where it sits and what it may load.** Quick Print is its own page in Workshop, beside Print lab, following A7's anatomy
and A10, A14 and the design contract (appliance-ui `DESIGN.md`), with its own states: loading, empty, slicing, stale, worker
asleep, blocked, uncertain. The layer view of a slice is drawn by the page's own code. The 3D view of the model and of the
toolpaths is the open question below.

## Open question

**Q13 A 3D library for Quick Print's viewer?** A16 P3 and P10 say no WebGL and no library, because the experiment preview
only needed outlines. Quick Print asks for a rotatable view and a 3D toolpath view. Two models: (a) own code only,
as A16 P10, a rotatable software-drawn view and a 2D layer inspector, no dependency but slower on large slices and
no real 3D toolpaths; (b) a pinned, vendored Three.js loaded only on this page, with the 2D layer inspector as the
fallback and nothing that approval or Start depends on. Recommend **(b)**: orbit, section planes and toolpaths on a phone is
what the library is for, the dependency is confined to one lazily loaded page, and Start never waits for it. It is a new
dependency, so it is yours to confirm; if you choose (a), the plan keeps the 2D inspector and defers 3D.

## Baseline changes

- Print row (records): "read-only except A12's staged lab prints" adds "and A19's staged quick prints".
- Printer control row: "including Start a staged lab print (A12)" adds "and Start a staged quick print (A19)".
- Actions that confirm: "Start a staged lab print confirms through its sheet, never from the palette (A12)" adds the
  same for Start a staged quick print (A19).
- Amendments list: A19 added. A12 D1 and D3 now read "except as A19 allows"; A16 P3 and P10 apply to the lab page only.

## Acceptance

One small Quick Print on the real X2D, started with the owner present: an STL uploaded on the phone, sliced by the Mac, the
layers looked at, the sheet's two ticks, Start, and the printer reporting that file. The job's record shows the sha256 at
slicing, at staging and at the tap, and `action_log` the start. Recorded in `docs/operations.md` as "Accepted <date>". A
matching deploy is not acceptance.

## Out of scope

STEP and other CAD formats; OrcaSlicer, Bambuddy's own slicing and a PC worker (each needs its own evidence and amendment);
queues of several prints; scheduled or unattended starts; other printers; changing any experiment guard, budget or
approval. The plan (steps, PRs, limits, storage, the width sweep) follows this spec's merge, per the platform-plan rule.
