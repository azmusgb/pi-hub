# A19 Quick Print: an ordinary STL from the phone to the X2D — Plan

Date: 2026-11-08 · Status: **proposed. Do not merge before A19 (#183) merges**; until then this plan describes work
that may not start · Baseline: `2026-11-01-platform-product-architecture-design.md` plus amendment A19
(`2026-11-08-amendment-a19-quick-print.md`, #183, **proposed**), which amends A12 D1/D2/D3 and A16 P3/P10.

**Goal:** the owner opens Quick Print in Pi Hub, drops an STL, sees its size and the real X2D slice (time, grams, every
layer), ticks that the plate is clear and the filament matches, and starts the print from the same page. The printer gets
exactly the file that was checked, and the page follows the print to its end and keeps the record.

## Spec

- **A19 Q1–Q13.** Q1 record owned by Pi Hub; Q2 Pi Hub stages into a `quick-print` folder; Q3 Start a staged quick print,
  same path and lock; Q4 sha256 proven at the tap; Q5 slices without the X2D start sequence are refused; Q6 the Mac
  slices through the request queue; Q7 states; Q8 uncertain starts; Q9 A12b's hold applies; Q10 never experimental
  evidence; Q11 reprint; Q12 the page; Q13 (open) a 3D library.
- **Waits on:** A19 merged, and the owner's answer to Q13 for P7 only. Everything else is independent of Q13. A12, A12b
  and A16 are merged and live (they are in the baseline's Amendments on `origin/main`).
- **Not a dependency:** A12's start for experiments. This plan changes none of it.

## Done means

A19 gives one acceptance paragraph and no numbered criteria. Decision 1 proposes these, one per A19 decision:

1. **Q1/Q10:** a job exists with no experiment, run, budget or verdict; a file named `quick_<job>` never makes a run in
   `lab pull`.
2. **Q2:** only Pi Hub's control path uploads into `quick-print`, and it can delete only its own failed upload.
3. **Q3:** Start is owner-only, confirms on the sheet with the two ticks, is never in the palette or a notification,
   takes `printer_control.BUSY`, and writes the device to `action_log`.
4. **Q4:** the sliced file's sha256 is recorded at slice end, after staging (read back from Bambuddy) and at the tap;
   any difference starts nothing.
5. **Q5:** a slice without the X2D start sequence becomes Needs attention and cannot be staged, with a zero exit status.
6. **Q6:** a slice runs on the Mac from a request; a Mac that has not asked recently shows "asleep, last seen …", never
   idle; a killed worker is shown Failed.
7. **Q7:** the states of A19 Q7 exist and only the allowed transitions happen; a changed model, transform or setting
   makes the slice Stale; a failed, stale or canceled job cannot be staged or started; a canceled job never publishes.
8. **Q8:** a lost, timed-out or contradicted start is Outcome uncertain and is never retried by the system.
9. **Q9:** a Quick Print can wait for the bed ("Start when the bed is cool") under A12b's rules, one hold in all.
10. **Q11:** Reprint offers the stored file only after Q4 and the freshness checks pass again, and says when it needs a
    new slice.
11. **Q12:** the page shows every state and passes the width sweep and axe at three text sizes.
12. **Q13 (only if (b)):** the 3D view loads lazily and Start never waits for it.
13. **Acceptance (A19):** one small real print, started with the owner present, with its sha256 chain and `action_log` row.

## What exists today (read on 8 Nov 2026)

Pi Hub `origin/main` e693e6e is live; print-lab 90b6a33 is live (`home` releases, 01:38). The printer is idle, Bambuddy
connected (`printer_status`). Not re-read for this plan, and read first in P0: Bambuddy's live version, its key
scopes, and the installed Bambu Studio version.

- **Start path to extend, not copy:** `hub/lab_start.py`. `refusals` (:60) mixes the printer's state with an
  *experiment's* staging, so Quick Print can't call it as is. `start` (:96) already does version check → download →
  sha256 → queue with `manual_start` → start → delete the item on failure. Bambuddy is pinned to 1.3.0 (:22), the bed
  limit is 35 °C (:25). One command at a time is `printer_control.BUSY` (`hub/printer_control.py:19`, `hold()` :24).
  The hold of A12b is `hub/lab_hold.py` (`place` :32, `step` :73), keyed by project and experiment.
- **Routes are per experiment:** `/api/printer/start/{project}/{experiment}` (`hub/app.py:445`, 460, 507); other actions
  `POST /api/printer/{action}` (:515).
- **Mac channel:** the Mac asks `GET /api/lab/{project}/requests` every 60 s with its own key (`hub/lab.py:700`,
  `hub/mac_lab.py:2`), refused without `X-Hub-Mac-Key` (`hub/lab_guard.py`). Requests are `lab_requests` rows keyed by
  project (`hub/lab.py:77`); limits 4 KiB per request, 20 pending per project, 100 in all (`hub/lab.py:32-36`). The Mac
  is called silent after 180 s (`hub/mac_lab.py:11`). The hub already takes files from the Mac under caps (photos 8 MiB,
  `hub/lab.py:30`, `read_capped`; 500 MiB incoming in all, :40).
- **Mac side:** `lab pull` runs every 60 s, applies requests and links prints (`lab/pull.py:214`, 607); it holds a
  per-project file lock (`.pull.lock`, :216), and its HTTP timeout is 10 s (:607). A slice can run up to 1800 s
  (`lab/jobs.py:48`), so **a slice can't run inside a pull**.
- **Slicing:** Bambu Studio is pinned at 02.09.01.70 (`lab/adapters/bambu.py:9`); `slice_with_job` refuses another
  version (:121-150) and returns the estimate from the slice's own `slice_info.config` (:158). A print project is made
  from a base 3MF's complete settings plus meshes: `write_print_3mf(base_3mf, meshes, out, meta, settings_patch, …)`
  (`lab/adapters/threemf.py:192`). Mesh facts: `lab/geometry/mesh.py:48`. X2D presets are in `presets/`, and the
  lab's own known-good builds sit in `projects/hex-tile/prints/`.
- **The regression to prevent:** a CLI slice from an STL and loose presets has a generic start, no AMS load `M620`, no
  purge; v73 air-printed ~30 min on 27 Oct 2026 (memory `cli-slice-start-gcode`). Nothing in the lab checks for it
  today (`git grep M620` over `lab/` finds no check).
- **Bambuddy writes today:** the Mac uploads into `print-lab` (`lab/bambuddy.py:153`); Pi Hub queues and starts with the
  control key and downloads with the read key (`lab_start.py:96`). Per A12's plan the control key held Control and
  Queue, and the read key Read only (6 Nov); Pi Hub holds no Library-write scope today.
- **Pi:** `/` is a 29 GB SD card with 10 GB free; `/mnt/usb1` has 133 GB free but is the Movies drive; Python 3.13.5;
  the lab's data is 27 MB (`/var/lib/pi-hub/lab`). `hub.db` is 1.4 MB. Quick Print's files would be the first large ones
  on the SD card.
- **Limit that stays:** Bambuddy can't send to the X2D's internal storage, so a USB stick must stay in it
  (bambuddy#2762). The owner says one is in now (8 Nov, 01:40); the plan can't see it.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Done means** is the list above.
2. **Slicing is a request in the existing queue, under a reserved project name `quick`,** with kinds `inspect`, `slice` and
   `cancel`, as A19 Q6 says. The rows share `lab_requests` and its 100-pending cap, so `quick` can't be a real project:
   P2 refuses it as a project name, and a test shows `/api/lab/projects` and every experiment route never list or
   accept it. *Rejected:* a second queue table, which would be cleaner to isolate but is a new store and a second
   thing the Mac must ask. Cost: one reserved word, and the experiment routes gain one guard.
3. **Where the work happens, by property:** the Pi checks structure only (STL framing, 3MF archive limits, sha256,
   sizes). The browser measures what it already holds (bounding box and triangle count of the mesh it drew,
   labelled "measured here"). The Mac, in an `inspect` request, adds what needs a mesh library: watertight, components,
   non-manifold, degenerate triangles, normals (`mesh_facts`), labelled "measured by the lab, `<time>`". Measured
   facts and heuristics (overhang, thin walls, small features) are separate lists, and a heuristic is "likely", never a
   defect. *Rejected:* trimesh on the Pi (CPU and memory on a Pi that also runs the house), and waiting for the Mac
   just to show a bounding box.
4. **The slicer's input is only a complete X2D project:** P1 builds it from a **Studio-saved base 3MF per preset**
   (`presets/quick/<name>.3mf`, settings embedded) with the model's meshes, transform and the patch of allowed keys
   (`write_print_3mf`). It never slices an STL with loose presets. **Version one ships one preset**, "Standard 0.20 mm
   PLA, X2D 0.4", made by saving a project in Studio from the known-good build's settings, and exposes only settings
   whose keys P0 proved by slicing: layer height, walls, top and bottom layers, infill percent and pattern, supports
   on or off, brim. The spec asks for Fine, Draft and Strong presets and an advanced section; each is added only
   with its own proof slice and its key mapping, in small PRs after acceptance, because "do not fabricate settings"
   is stricter than "ship many". The page lists only what exists.
5. **Q5's check is pinned to a real file, not to my memory of markers.** P0 extracts the start block of a known-good
   build (`hex-tile_E-022_BLD-022-01`) and of a deliberately loose slice, records which lines differ (`M620`,
   `gcode_claim_action`, filament ids), and P1 tests the check against both files. The check runs on the Mac
   after slicing and again on the Pi when the artifact arrives (a zip read, no slicing), so a Mac bug alone can't
   publish a bad file.
6. **A slice runs in a detached worker, one at a time.** `lab pull` starts `lab quick worker` (lock file, so two
   can't run), which takes one request, slices with `slice_with_job`, posts a heartbeat every 15 s with its phase,
   and posts the artifact. The hub marks a Slicing job **Failed ("the Mac stopped answering")** after 90 s without a
   heartbeat. The intervals: 60 s is `lab pull`'s own period, 180 s the hub's existing "Mac asleep" line
   (`mac_lab.py:11`), 15 s and 90 s are this plan's choice (six missed beats). *Rejected:* slicing inside the pull
   (up to 1800 s against a 60 s loop and a 10 s timeout).
7. **Worker capability is a small fact record in the heartbeat,** not a registry: worker id, OS, Bambu Studio version,
   the preset names it can build, and its phase. The hub accepts a slice artifact only from a version it lists as
   allowed (today 02.09.01.70). Because the request names a needed slicer and version rather than "the Mac", a second
   worker can be added later without changing the contract; none is built. No heartbeat for 180 s shows "Mac asleep,
   last seen …".
8. **Files live on the SD card under `/var/lib/pi-hub/quick`, with caps:** model 50 MiB; a 3MF may expand to at most
   200 MiB, 200 entries, no absolute or `..` paths, no symlinks, no external part references; sliced file 200 MiB;
   4 GiB in all. Names are generated; the client's filename is data and is shown, never a path. Writes are temp file,
   fsync, rename. When the total passes the cap, the oldest never-printed jobs go first, then the oldest printed ones
   (the record stays, marked "file removed, needs a new slice"). These numbers are this plan's choice. *Rejected:*
   the USB drive, because it is the Movies drive and may be absent, and a missing drive must not stop a print that
   never touched it. Cost: SD wear and 10 GB free, which is why the cap is 4 GiB and retention is stated.
9. **Bambuddy scopes:** Pi Hub's staging upload needs Library-manage, which no Pi Hub key has. The control key gets
   Control, Queue and Library; the read key stays Read. This is one more run of A12's `deploy/bambuddy-key-scopes.py`
   (owner step, P5). A12's `print-lab` folder is untouched, and a test fails if Pi Hub's Quick Print code names any other
   folder.
10. **Prepare, then Start, as two taps on one page.** *Prepare* uploads the file into `quick-print`, downloads it back and
    compares the sha256 (Q4); it changes nothing on the printer and a failure deletes the upload. *Start* re-reads the
    printer, re-downloads and re-hashes (Q4's third check), then follows `lab_start.start`'s order. Two models: one
    button that does both, or two. Two is recommended, because an upload to Bambuddy takes seconds to minutes, the
    owner's two ticks belong next to Start, and a staged file lets the owner start later. The cost is one more tap.
11. **The printer-side rules are extracted, not copied.** P6 first moves the printer-only part of `refusals` (connected,
    idle, no HMS, bed below 35 °C) into `printer_refusals(printer, ignore_bed)` in its own commit, with the existing
    experiment tests untouched and passing; the experiment function calls it. Quick Print calls the same function. The
    Bambuddy calls stay behind the one adapter (`lab_start._call`), version-checked.
12. **What "Printing confirmed" means:** the printer reads RUNNING (or PREPARE) with a job whose name is
    `quick_<job id>`, from the printer reading Pi Hub already keeps (`sources.bambuddy_printer`). Quick Print's files are
    named so, which also keeps `lab pull` from making a run (Q10). A job that is "Start accepted" and not seen printing
    after **5 minutes** (this plan's choice, since A19 names no figure) becomes Outcome uncertain; so does one found in
    "Start requested" or "Start accepted" when Pi Hub restarts (fail closed, never resumed). Reconciling runs every
    10 s only while such a job exists, one pass at a time inside an exception boundary, and its death shows as the
    job staying "Start accepted" past the 5 minutes, which is already Uncertain.
13. **Idempotency:** a Start carries `job id` and `attempt`; a second tap while `BUSY` is held or the job is past
    "Prepared" returns the current state (409 with it), never a second command. Retry after Outcome uncertain needs the
    reconcile read to show nothing running and the queue item absent, and always a fresh attempt number and two ticks.
14. **Identity:** a job is keyed by its own generated id. Bambuddy things are linked by id, never by name: library file
    id, queue item id, and the print-log entry id (one-print P1), found by the file's `quick_<id>` name. Two print-log
    entries with that name, or two queue items for one job, fail closed (Uncertain, with both shown).
15. **The page:** `/quick`, in the Workshop strip beside Print lab, five sections (Model, Settings, Slice, Print,
    History), following A7, A10, A14 and appliance-ui `DESIGN.md`. The slice summary is the P4 default view, and the
    layer inspector (2D, the page's own code, from layer geometry the Mac precomputes) is P5; neither needs a library.
    The layer file is parsed from the actual file by a parser written against the real P2 slice; a feature it can't
    classify is shown "unavailable", never drawn from the model.
16. **The 3D view waits for Q13.** If the owner chooses (b), P7 adds a pinned, vendored Three.js loaded only on `/quick`
    (version and licence named in the PR), with the 2D views as the fallback. If (a), P7 is dropped and the 2D
    inspector stays the viewer. Nothing before P7 depends on the answer.

## When this reads Bambuddy, the printer and the worker

1. **Observed versus can observe.** Worker: never heard → "no worker yet"; heard recently → idle or its phase;
   silent 180 s → "asleep, last seen X"; silent mid-slice 90 s → Failed. Printer: connected and fresh within 2 minutes
   (A12 S5) or "can't see the printer"; a stale reading is shown as such, never as the last value. A Bambuddy that
   answered then stops answering leaves a Start accepted job "not confirmed", then Uncertain, never "Printing".
2. **Identity:** decision 14. A queue item or library file absent from a successful response is "gone"; an unreadable
   response is "unavailable", which are different states and different tests.
3. **Parser contract:** the layer parser and `slice_info.config` reader require the fields they use, validate numbers,
   tolerate extra fields, keep values whole, return `{present | absent | unavailable}`, and never store raw G-code in
   a log. The artifact itself is the only place G-code lives.
4. **Latency, worst case:** Slice tap → next Mac ask ≤ 60 s → slice (minutes; hex tile class jobs measured in P2) →
   artifact post → hub verify. Worker dies mid-slice: ≤ 90 s + the page's 10 s poll to see it. Start tap →
   Bambuddy accepts → printer starts; not seen printing by 5 minutes → Uncertain.
5. **One owner:** the job and its file are Pi Hub's; the sliced bytes are made by the Mac; the printer's state is the
   printer's, read through Bambuddy; the lab's experiment record is untouched. Shared appliance-ui parts are used from
   `hub/static/ui`; a new component is proposed there first.

## PRs, one at a time

Every PR is based on `main`, never stacked. Each runs `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests` and
`node --test tests/*.mjs` (pi-hub) or print-lab's suite, and pastes the counts. A `hub/static` change bumps `SHELL`.
Pi Hub deploys by the owner's Claude session after the preflight; print-lab reaches the Mac by `lab pull`.

### P0. print-lab: probe and fixtures, no behaviour (covers: Done 5 partly, 4)

Read-only on hosts. Records in a probe note: the installed Bambu Studio version and whether it equals
02.09.01.70; the start block of `hex-tile_E-022_BLD-022-01` against a loose-preset slice (decision 5); a slice of an
STL through a Studio-saved base project, showing `M620` present; which setting keys actually change under
`patch_settings` (decision 4); Bambuddy's live version and `openapi.json` entries for `/library/files`, `/queue`; Pi Hub
key scopes. **Evidence:** the note, with commands and outputs, plus the two fixture G-code start blocks. A "no" changes
decision 4, 5 or 9 before anything is built.

### P1. print-lab: the quick slicing engine (Done 5, 6 partly)

`lab/quick/`: project build, slice, Q5 check, metadata extraction (estimate, layers, sizes, hashes, tool and profile
hashes), layer geometry file; a `lab quick slice` CLI with no network. Sanitised job record from `run_tool`. Tests:
the check passes the known-good start and fails the loose one; wrong Studio version; missing binary; timeout; crash;
output missing; corrupt zip; wrong output type; modified source (hash); transform preserved (position and rotation in
the project); a real-Studio test skipped when Studio is absent. Independent of every Pi Hub PR.

### P2. pi-hub: jobs, uploads, state machine (Done 1, 4 partly, 7)

`hub/quick.py`: tables, upload route with a cancelable chunked upload (as `hub/uploads.py`), STL framing and 3MF safety
limits (decision 8), sha256 and duplicate detection, generated ids, the Q7 transitions in one function, Stale by
a `request_hash` of model, transform and settings, retention, owner-only routes, `quick` reserved. **Tests:** each
rejection (empty, truncated, oversized, zip bomb, `..` path, symlink entry, external reference, wrong magic with a
`.stl` name); duplicate upload; every legal and illegal transition; stale after each of model, transform and setting
changing; failed/canceled/stale can't advance; canceled never publishes; quota eviction order; an experiment route
refusing `quick`. No UI yet. Full coverage of Q7's transitions, partial of the page.

### P3a. pi-hub: the worker channel / P3b. print-lab: the worker (Done 6)

P3a: `quick` request kinds, claim (one worker per job, atomic), heartbeat, progress, artifact post with sha256 header
(temp file, verify, rename, then Q5 check on the Pi), cancel, recovery on restart (a Slicing job without a heartbeat for
90 s is Failed), worker record and "asleep" line. P3b: `lab quick worker` (lock, heartbeat, claim, slice, post,
cancel). Tests: two workers claim one job; heartbeat gap; cancel then late artifact refused; wrong sha refused; bad
start sequence refused on the Pi; restart mid-slice; worker never asked → "no worker yet"; allowed-version list.
Merge order is free: an unknown request kind is ignored by today's Mac.

### P4. pi-hub: the Quick Print page (Done 11 partly, 7)

Upload (drag and drop, picker, progress, cancel), model facts (decision 3's two labels), the single preset's settings,
Slice, the slice summary (decision 15), warnings, history list, all states. **Evidence:** screenshots at 390, 820 and
1440 px, light and dark, text sizes Standard, Large, Larger; the width sweep, `structure.mjs` with axe, `tabbar.mjs`;
long filename, empty, error, stale, worker asleep, and a large model.

### P5. pi-hub: the layer inspector (Done 11)

Layer slider and number, range, categories toggled separately, top-down 2D canvas, travel versus extrusion, seam where
parsed, speed where parsed, per-layer figures from the file, "unavailable" for the rest. Layer data loads progressively
and the page stays responsive on a large slice. No owner step (the key-scope run is P6's). Evidence: the same
screenshot set and a large-slice timing.

### P6. pi-hub: Prepare, Start and the sheet (Done 2, 3, 4, 7, 8, 9)

`hub/quick_start.py`, `printer_refusals` extraction (own commit), the routes, the sheet, Q7's start states, reconcile,
A12b's hold for a quick job (a second kind in `lab_hold`, one hold in all), `action_log` rows, Bambuddy folder
`quick-print`, version check. Tests: printer ready; offline; busy; HMS error; stale telemetry; no material
mapping or filament mismatch blocks; wrong artifact hash at staging and at the tap; unauthorized (non-owner) 401;
duplicate tap; queue-add failure; start 409; response timeout; lost response → Uncertain; start accepted but
not printing in 5 minutes; restart during Start; failed cleanup shows the queue item and blocks; two concurrent
starts (one wins); a quick start and an experiment start together; the queue item always has `manual_start`;
no start without both ticks; never a palette or notification action; experiment tests unchanged. **Owner step before
live use:** run `deploy/bambuddy-key-scopes.py` on the Pi to add Library to the control key (decision 9).

### P7. pi-hub: the 3D view, only if Q13 is (b) (Done 12)

Pinned, vendored Three.js loaded on `/quick` only: orbit, pan, zoom, fit, orthographic and the six views, build plate and
volume, section plane, 3D toolpath. Static fallback when WebGL is unavailable. **Evidence:** the dependency's version
and licence in the PR, a test that no other page loads it, and Start working with the module blocked.

### P8. pi-hub: monitoring, history, reprint (Done 7, 10, 1)

After Start the page shows connection, state, progress, layer, remaining time and temperatures **only as the printer
reports them**: missing is "unknown", never zero or invented; stale and disconnected are shown. Pause, resume and stop
are the existing actions, shown here without a second path. Outcome from the print-log entry (decision 14), the
history list and comparison, Reprint with its revalidation. Tests: missing temperature is not 0; stale shows stale;
completed only after the printer says so; reprint after the file is removed asks for a new slice; Quick Print never
appears in the lab's runs.

### P9. Hardening and docs (Done 11)

Operations docs: architecture, data flow, worker setup, keys, failure messages with the next action, backup (the
job records are in `hub.db`; the artifacts are rebuildable by re-slicing and aren't backed up), rollback (`quick`
routes can be disabled without touching experiment routes), version compatibility. Recovery check: the Pi lost,
what's needed is the model files the owner keeps themselves; nothing here is a secret. Width sweep and axe at three text
sizes, a restart test and the failure messages read in the UI.

### P10. Acceptance (owner present) (Done 13)

See Acceptance.

### Coverage

| Done | Steps |
|---|---|
| 1 | P2, P8 |
| 2 | P6 (and the key run) |
| 3 | P6 |
| 4 | P1, P3a, P6 |
| 5 | P0, P1, P3a |
| 6 | P1, P3a, P3b |
| 7 | P2, P6 |
| 8, 9 | P6 |
| 10 | P8 |
| 11 | P4, P5, P9 |
| 12 | P7 (or dropped on Q13 (a)) |
| 13 | P10 |

## Acceptance

Ladder: merged, deployed, runtime verified, accepted. A matching SHA is a deploy. Runtime verified means, on the live
hub, one refused Start per reason from P6's tests and one real slice from the Mac. **Accepted** needs, with the owner
present and a small, low-cost print: the USB stick seen in the X2D, the correct plate and filament, an STL uploaded
on the phone, the layers looked at, both ticks, Start, the printer reporting the file, and the page showing
Printing confirmed; then the job's record with the sha256 at slicing, at Prepare and at the tap, and the
`action_log` row. A second check: an experiment start still works and a `quick_` print made no run. Recorded in
`docs/operations.md` as "Accepted <date>". No step marks the item implemented before then.

## Out of scope (noted, not gated)

- **A Windows or Local AI slicing worker, OrcaSlicer, and Bambuddy's own slicing:** each needs its own evidence and
  an amendment (A19). Follow-up after acceptance.
- **More presets and the advanced settings:** each is a small PR with its proof slice (decision 4); owner picks the order
  after acceptance.
- **STEP and other CAD formats, several printers, queues, scheduled starts:** A19's out of scope.
- **Plate detection and a USB-free Bambuddy send:** the owner's choice and bambuddy#2762; the page shows the waiting
  reason (A12) and does not hide it.
- **Backups of artifacts:** they are rebuildable by slicing again, so they are not backed up; recorded in P9's docs.
