# A19 Quick Print: an ordinary STL from the phone to the X2D — Plan

Date: 2026-11-08 · Status: **proposed. Merge order is fixed: #183 (A19), then this plan (#184), then P0.** Do not merge
this plan before A19 merges, and re-check its wording against A19 as merged · Baseline:
`2026-11-01-platform-product-architecture-design.md` plus amendment A19 (`2026-11-08-amendment-a19-quick-print.md`,
#183, **proposed**), which amends A12 D1/D2/D3 and makes one exception to A16 P3/P10 for the Quick Print page.

**Size:** twelve units, **twelve PRs, none combined**: P0, P1, P2, P3a, P3b, P4, P5, P6, P7, P8, P9, and P10 (a docs PR
that records the owner-attended acceptance). P7 (the 3D view) is decided, but it never blocks P10: acceptance can be
recorded before it lands.

**Goal:** the owner opens Quick Print in Pi Hub, drops an STL, sees its size and the real X2D slice (time, grams, every
layer), ticks that the plate is clear and the filament matches, and starts the print from the same page. The printer gets
exactly the file that was checked, and the page follows the print to its end and keeps the record.

## Spec

- **A19 Q1–Q13.** Q1 record owned by Pi Hub; Q2 Pi Hub stages into a `quick-print` folder; Q3 Start a staged quick print,
  same path and lock; Q4 sha256 proven at the tap; Q5 slices without the X2D start sequence are refused; Q6 the Mac
  slices through the request queue; Q7 states and attempt fencing; Q8 uncertain starts; Q9 A12b's hold applies; Q10
  never experimental evidence; Q11 reprint and retention; Q12 the page; Q13 a pinned Three.js on this page only
  (settled by the owner, 8 Nov 2026).
- **Waits on:** A19 merged. A12, A12b and A16 are merged and live (they are in the baseline's Amendments on
  `origin/main`). P7 waits on nothing but the operational slice (P4 to P6) existing, and nothing waits on P7.
- **Not a dependency:** A12's start for experiments. This plan changes none of it.

## Done means

A19 gives one acceptance paragraph and no numbered criteria. Decision 1 proposes these, one per A19 decision:

1. **Q1/Q10:** a job exists with no experiment, run, budget or verdict; a file named `quick_<job>` never makes a run in
   `lab pull`.
2. **Q2:** only Pi Hub's Bambuddy adapter uploads into `quick-print`, and it can delete only a file it recorded uploading.
3. **Q3:** Start is owner-only, confirms on the sheet with the two ticks, is never in the palette or a notification,
   takes `printer_control.BUSY`, and writes the device to `action_log`.
4. **Q4:** the sliced file's sha256 is recorded at slice end, after staging (read back from Bambuddy) and at the tap;
   any difference starts nothing.
5. **Q5:** a slice without the X2D start sequence becomes Needs attention and cannot be staged, with a zero exit status.
6. **Q6/Q7:** a slice runs on the Mac from a request, under one fenced attempt (decision 6); a Mac that has not asked
   recently shows "asleep, last seen …", never idle; a killed worker is shown Failed.
7. **Q7:** the states of A19 Q7 exist and only the allowed transitions happen; a changed model, transform or setting
   makes the slice Stale; a failed, stale or canceled job cannot be staged or started; a canceled job never publishes;
   a late result from an old attempt is refused even if its file is valid.
8. **Q8:** a lost, timed-out or contradicted start is Outcome uncertain and is never retried by the system.
9. **Q9:** a Quick Print can wait for the bed ("Start when the bed is cool") under A12b's rules, one hold in all.
10. **Q11:** Reprint offers the stored file only after Q4 and the freshness checks pass again, says when it needs a new
    slice, and never offers a file retention removed.
11. **Q12:** the page shows every state and passes the width sweep and axe at three text sizes.
12. **Q13:** the 3D view loads lazily on `/quick` only, and Slice, Review, Prepare, Start and Monitor work with it
    blocked or WebGL absent; the 2D inspector is complete without it.
13. **Acceptance (A19):** one small real print, started with the owner present, with its sha256 chain and `action_log` row.
14. **Q1/Q4 storage:** no artifact of an active job is evicted; uploads and slices are refused with a reason when space
    is short; temporary files count against the quota; the Pi's operating-system reserve is never used.
15. **Q2 credentials:** staging and control use the least-privileged credentials Bambuddy can actually separate, as
    P0 finds, and no key reaches the browser, a log or Git.

## What exists today (read on 8 Nov 2026, references re-checked at 02:30)

Pi Hub `origin/main` e693e6e is live; print-lab 90b6a33 is live (`home` releases, 01:38). print-lab `origin/main` has since
moved to ca0e79d (#55 lab records, #56 a G-code parser fix); the references below were re-checked against it. The printer is idle, Bambuddy
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
  is called silent after 180 s (`hub/mac_lab.py:9`). The hub already takes files from the Mac under caps (photos 8 MiB,
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
- **A G-code parser already exists:** `lab/analysis/gcode.py` reads Bambu Studio's `; CHANGE_LAYER` and `; FEATURE:`
  comments into per-layer facts (`read_layers`, `feature_bands`), and #56 just made it more truthful. Its layer time is
  "the sum of move lengths over feed rates, ignoring acceleration", an estimate, with Bambu Studio's own figure the
  authority. The layer inspector extends this module rather than adding a second parser.
- **Bambuddy writes today:** the Mac uploads into `print-lab` (`lab/bambuddy.py:153`); Pi Hub queues and starts with the
  control key and downloads with the read key (`lab_start.py:96`). Pi Hub keeps them in two files,
  `/etc/pi-hub/secrets/bambuddy_api_key` (`hub/bambuddy.py:12`) and `bambuddy_control_key` (`hub/printer_control.py:13`).
  A12's scope script is merged (`deploy/bambuddy-key-scopes.py`, #141). Per A12's plan the control key held Control and
  Queue, and the read key Read only (6 Nov); **the keys' live scopes and whether Bambuddy can limit Library rights to a
  folder were not read for this plan**, which is why P0 reads them before decision 9 is final.
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
4. **The slicer's input is only a complete X2D project, and version one has one preset.** P1 builds the project from a
   **Studio-saved base 3MF** (`presets/quick/<name>.3mf`, with the printer, nozzle, plate, material, process and
   machine settings embedded) plus the model's meshes, transform and a patch of allowed keys (`write_print_3mf`). It never
   slices an STL with loose presets, and never writes printer initialization from assumptions. The one preset is
   **"Standard 0.20 mm PLA, X2D 0.4 mm nozzle"**, saved in Studio from the known-good build's settings and proven by a
   real Studio slice. A setting is offered in the UI only when P0 shows, by slicing, its real slicer key, its accepted
   range and a test showing its effect. Layer height, wall count, top and bottom layers, infill percent and pattern,
   supports and brim are candidates, none approved until P0. Fine, Draft, Strong and the advanced section stay future
   work, each needing verified X2D compatibility, a complete source project, exact versions, a proof slice, the Q5
   check and regression tests, in small PRs after acceptance. The page lists only what exists.
5. **Q5's check is pinned to real files, and reads the whole initialization.** P0 extracts the start block of a known-good
   build (`hex-tile_E-022_BLD-022-01`) and of a deliberately loose slice, and records the exact differences (the AMS
   load `M620`, `gcode_claim_action`, filament ids, the purge, the air-print detect and whatever else differs), not one
   string. P1's validator checks that start block as a whole against the known-good one, and a test shows it
   rejects the loose file and accepts the good one. The check runs on the Mac after slicing and again on the Pi when
   the artifact arrives (a zip read, no slicing), so a Mac bug alone can't publish a bad file.
6. **A slice runs in a detached worker, one at a time, under a fenced attempt.** `lab pull` starts `lab quick worker`
   (a lock file stops a second local copy), which claims one job, slices with `slice_with_job`, sends a heartbeat every
   15 s with its phase, and posts the artifact. *Rejected:* slicing inside the pull (up to 1800 s against a 60 s loop and
   a 10 s timeout). The durable ownership record, not a lock in memory, is the authority:
   - **Record.** A table `quick_attempts` in `hub.db`: job id, **attempt id**, worker id, claimed at, **lease
     generation** and lease end, last heartbeat, phase, slicer version, cancel requested, terminal state. A job has at
     most one non-terminal attempt (a unique index).
   - **Claim.** One transaction (`BEGIN IMMEDIATE`) moves the job Queued to Preparing and inserts the attempt; two
     claimers cannot both succeed, and the loser gets a refusal.
   - **Every message names its attempt.** Heartbeat, progress, artifact and completion each carry job id, attempt id and
     generation. The hub accepts one only through a single conditional update that requires the attempt to be the current
     non-terminal one, the lease unexpired, the job unchanged since the claim (`request_hash`) and cancel not
     requested. A heartbeat extends the lease; nothing else does.
   - **Completion is one transaction.** The artifact is verified in a temporary file first (size, sha256, the Q5 check);
     then, inside one transaction that re-checks the rules above, the job becomes Sliced and the file is renamed into
     place. If cancel won, or the attempt expired, or a newer attempt began, the temporary file is deleted and the
     result refused (409), however valid the file is. A second completion for the same attempt is refused.
   - **Failure causes are kept apart and shown:** worker unavailable (no heartbeat for 180 s, the hub's existing "Mac
     asleep" line, `mac_lab.py:9`), heartbeat stale (no beat for 90 s during a slice), worker process ended (the worker
     reports it, or the lease lapses), slice timed out (the lab's 1800 s), canceled, attempt expired, and failed. A stale
     heartbeat or an expired attempt ends the attempt as Failed with its cause; re-slicing is the owner's tap and a new
     attempt id. Nothing is retried by the system.
   - **Restart.** At hub start, before any claim is accepted, durable state is reconciled: every non-terminal attempt
     whose lease has lapsed becomes Failed (attempt expired). A worker that returns later finds its attempt refused.
   The 15 s heartbeat and 90 s detection stay provisional. They follow `lab pull`'s 60 s period and the hub's existing
   180 s line (`mac_lab.py:9`); six missed beats is this plan's choice, and P0 or load testing may change it.
7. **Worker capability is a small fact record in the heartbeat,** not a registry: worker id, OS, Bambu Studio version,
   the preset names it can build, and its phase. The hub accepts a slice artifact only from a version it lists as
   allowed (today 02.09.01.70). Because the request names a needed slicer and version rather than "the Mac", a second
   worker can be added later without changing the contract; none is built. No heartbeat for 180 s shows "Mac asleep,
   last seen …".
8. **Files live on the SD card under `/var/lib/pi-hub/quick`, with caps and protection.** The location stays; the
   Movies USB drive is not used, silently or otherwise, unless evidence shows the SD card can't meet these rules.
   - **Limits (this plan's choice, provisional):** a model 50 MiB; a 3MF may expand to 200 MiB, 200 entries, no absolute
     or `..` paths, no symlinks, no external part references; a sliced file 200 MiB; 4 GiB for the application in all.
   - **Quota counts everything:** finished files, partial uploads and slice scratch. A slice reserves its 200 MiB
     ceiling when claimed. Several uploads at once reserve their declared sizes, so two together can't pass the cap.
   - **A free-space reserve for the OS:** a new upload or slice is refused, with the reason on screen, if it would leave
     less than **3 GiB free on `/`** (today 10 GB; P0 re-measures and may change the figure). The 4 GiB cap never
     overrides it. Capacity is never made by deleting something in flight.
   - **Protected files:** retention never removes the artifact or model of a job that is slicing, validating, being
     prepared, staged, queued in Bambuddy, start requested, start accepted, printing, outcome uncertain, or awaiting
     cleanup or reconciliation. Protection is read from the references (a queue item, a library file id, a hold, an open
     attempt), not only from the job's visible state, so an old-looking job with a live reference is still protected.
   - **Eviction order, only among inactive jobs:** abandoned drafts, then canceled or failed jobs with no operational
     reference, then old completed jobs with none, then other explicitly eligible inactive jobs. The record, hashes,
     original filename and outcome always stay; the page says "file removed, needs a new slice", and never offers an
     exact reprint of a removed file.
   - **Writes:** temp file, fsync, atomic rename; abandoned temporary files are removed after an hour.
   *Rejected:* the USB drive, because it is the Movies drive and may be absent. Cost: SD wear and 10 GB free, which is
   why the cap, the reserve and the retention order are stated.
9. **Credentials follow least privilege, and P0 decides what is possible before any key changes.** The preferred model:
   a **read** key (status and telemetry, library read where needed, no control), a **Quick Print staging** key (only
   what uploading into `quick-print`, reading it back and deleting Pi Hub's own failed upload need), and the
   **control** key (queue and printer control, no unrelated Library management). P0 reads the live Bambuddy version,
   its permission model and OpenAPI to find out whether that separation exists and whether Library rights can be
   limited to one folder or operation; **folder-level scope is not assumed.** If Bambuddy has only broad Library
   permission, P0 records the limit, compares one combined key with a separate staging key, and the plan picks the
   least-privileged workable design, then enforces the rest in Pi Hub's adapter: the Quick Print folder only, an
   allow-list of operations, and a cleanup that deletes only files Pi Hub recorded uploading. Keys stay under
   `/etc/pi-hub/secrets/` (root:pi-hub 640, like the existing two), never in browser code, logs, Git or unprotected
   files, with rotation written in P9's docs; experiment credentials and `print-lab`'s are not widened. No admin
   permission is granted to make the flow work. The script change, if any, is written after P0, and running it is an
   owner step. A test fails if Pi Hub's Quick Print code names any Bambuddy folder but `quick-print`.
10. **Prepare, then Start, as two taps on one page.** Two models: one button that does both, or two. Two is
    recommended, because an upload to Bambuddy takes seconds to minutes, the two ticks belong next to Start, and a
    staged file lets the owner start later. The cost is one more tap.
    - **Prepare** never starts the printer. It validates the finished slice, checks the stored artifact's sha256, confirms
      it is the approved X2D-compatible output (Q5), uploads it into `quick-print`, downloads it back, compares the
      bytes' sha256, records the Bambuddy library id, and marks the job Prepared only then. If the upload or the
      comparison fails, Pi Hub deletes its own upload and records the result; if the deletion can't be confirmed, the
      unresolved file stays shown on the job and in the page until the owner resolves it.
    - **Start** is its own physical action. Before it: owner authorisation; the job still Prepared; the stored artifact
      re-hashed; the Bambuddy copy downloaded and re-hashed; the printer connected and its reading fresh (within 2
      minutes); no blocking printer error; material compatible; the two ticks ("The plate is clear and dry", "The
      filament matches"); the shared lock `BUSY` taken. Then it follows `lab_start.start`'s order through the one gateway.
      The sheet names the print and what will happen.
11. **The printer-side rules are extracted, not copied.** P6 first moves the printer-only part of `refusals` (connected,
    idle, no HMS, bed below 35 °C) into `printer_refusals(printer, ignore_bed)` in its own commit, with the existing
    experiment tests untouched and passing; the experiment function calls it. Quick Print calls the same function. The
    Bambuddy calls stay behind the one adapter (`lab_start._call`), version-checked. A12b's hold is not copied:
    `lab_hold` gains a second kind of held item, so there is one hold scheduler and one hold in all.
12. **What "Printing confirmed" means:** the printer reads RUNNING (or PREPARE) with a job whose name is
    `quick_<job id>`, from the printer reading Pi Hub already keeps (`sources.bambuddy_printer`). Quick Print's files are
    named so, which also keeps `lab pull` from making a run (Q10; its build pattern is `BLD-nnn-nn`,
    `lab/pull.py:109`, and a test proves a `quick_` name never matches an experiment). A job that is "Start accepted" and
    not seen printing after **5 minutes** (this plan's choice, since A19 names no figure) becomes Outcome uncertain; so
    does one found in "Start requested" or "Start accepted" when Pi Hub restarts (fail closed, never resumed).
    Reconciling runs every 10 s only while such a job exists, one pass at a time inside an exception boundary, and its
    death shows as the job staying "Start accepted" past the 5 minutes, which is already Uncertain.
13. **Idempotency, durably:** a Start carries `job id` and a **start attempt id**, recorded in `hub.db` before any Bambuddy
    call. A second tap while `BUSY` is held or the job is past "Prepared" returns the current state (409 with it), never a
    second command. Retry after Outcome uncertain needs the reconcile read to show nothing running and the queue item
    absent (or its removal confirmed), and always a fresh attempt id and two fresh ticks. Nothing retries a possibly
    successful start by itself.
14. **Identity:** a job is keyed by its own generated id. Bambuddy things are linked by id, never by name: library file
    id, queue item id, and the print-log entry id (one-print P1), found by the file's `quick_<id>` name. Two print-log
    entries with that name, or two queue items for one job, fail closed (Uncertain, with both shown).
15. **The page:** `/quick`, in the Workshop strip beside Print lab, five sections (Model, Settings, Slice, Print,
    History), following A7, A10, A14 and appliance-ui `DESIGN.md`. The slice summary is the P4 default view, and the 2D
    layer inspector (the page's own code, from layer geometry the Mac precomputes with `lab/analysis/gcode.py`
    extended) is P5; neither needs a library. A feature the parser can't classify is shown "unavailable", never drawn
    from the model. If a design-exploration tool such as Superdesign is available while building P4, it may be used
    for layout exploration from the real design-system context; a concept is never evidence that something works, and
    exploration stays separate from the functional and acceptance checks.
16. **The 3D view is Three.js, decided, and an enhancement only.** P7 adds a pinned, vendored Three.js at an exact
    release whose version, source and licence the PR names and whose file hash it records, loaded lazily on `/quick`
    only (a test shows no other page loads it). It draws the real model and the real toolpaths read from the sliced file,
    simplified and capped where needed (a reduced mode on phones, said on screen). Orbit, pan, zoom, perspective and
    orthographic, the six views, build plate and volume, a section plane, keyboard controls with visible focus,
    reduced motion respected, and a plain message with the 2D views intact on WebGL failure or context loss. P7 comes
    after P4 to P6, never blocks P10, and Slice, Review, Prepare, Start and Monitor work with the module blocked.

## When this reads Bambuddy, the printer and the worker

1. **Observed versus can observe.** Worker: never heard → "no worker yet"; heard recently → idle or its phase;
   silent 180 s → "asleep, last seen X"; silent mid-slice 90 s → Failed. Printer: connected and fresh within 2 minutes
   (A12 S5) or "can't see the printer"; a stale reading is shown as such, never as the last value. A Bambuddy that
   answered then stops answering leaves a Start accepted job "not confirmed", then Uncertain, never "Printing".
2. **Identity:** decision 14. A queue item or library file absent from a successful response is "gone"; an unreadable
   response is "unavailable", which are different states and different tests.
3. **Parser contract:** the layer parser (`lab/analysis/gcode.py`, extended) and `slice_info.config` reader require the fields they use, validate numbers,
   tolerate extra fields, keep values whole, return `{present | absent | unavailable}`, and never store raw G-code in
   a log. The artifact itself is the only place G-code lives.
4. **Latency, worst case:** Slice tap → next Mac ask ≤ 60 s → slice (minutes; hex tile class jobs measured in P2) →
   artifact post → hub verify. Worker dies mid-slice: ≤ 90 s + the page's 10 s poll to see it. Start tap →
   Bambuddy accepts → printer starts; not seen printing by 5 minutes → Uncertain.
5. **One owner:** the job and its file are Pi Hub's; the sliced bytes are made by the Mac; the printer's state is the
   printer's, read through Bambuddy; the lab's experiment record is untouched. Shared appliance-ui parts are used from
   `hub/static/ui`; a new component is proposed there first.

## PRs, one at a time

Twelve PRs, none combined, in this order. P0 is read-only and first; P1 to P6 are the operational slice (a real file
sliced, inspected and dispatched); P7 enhances it and P8 to P10 finish it. Every PR is based on `main`, never stacked.
Pi Hub deploys by the owner's Claude session after the preflight; print-lab reaches the Mac by `lab pull`.

### P0. print-lab: read-only runtime probe and fixtures (Done 5, 14, 15 in part)

No behaviour changes, no write to Bambuddy, the Pi or the printer, and no print. One reproducible report,
`docs/superpowers/specs/<date>-quick-print-p0-report.md`, with each command, its output, the version it ran against and
a conclusion; nothing is called verified because documentation says so.

- **Bambu Studio:** the executable and installed version against 02.09.01.70; CLI behaviour; the Studio-saved X2D
  base project; output format; slice estimate metadata; one real slice of an STL through that base; which candidate
  settings (decision 4) change under `patch_settings`, with their real keys and accepted ranges.
- **G-code regression:** the start block of `hex-tile_E-022_BLD-022-01` against an intentionally loose-preset slice, the
  exact initialization differences (decision 5), and proof that the chosen validation rejects the bad file. Both
  start blocks become fixtures.
- **Bambuddy:** deployed version; `openapi.json` for upload, library read-back, queue and start; the permission model
  and each key's scopes (names and scopes only, never values); whether Library rights can be limited to a folder or an
  operation (decision 9); USB-storage limits; error and timeout behaviour as far as GET calls and its source show.
- **Pi Hub:** the printer-command gateway, the experiment start path, `BUSY`, the A12b hold, owner authorisation, the
  request channel, free space on `/` (to settle the reserve), and the active design contracts.

A "no" changes decision 4, 5, 8 or 9 before anything else is built.

### P1. print-lab: the quick slicing engine (Done 5, 6 in part)

`lab/quick/`: project build from the Studio-saved base, slice, the Q5 validator, metadata extraction (estimate, layers,
sizes, hashes, tool and profile hashes), and layer geometry (extending `lab/analysis/gcode.py`); a `lab quick slice`
CLI with no network. Tests: the validator passes the known-good start and fails the loose one; wrong Studio version;
missing binary; timeout; crash; output missing; corrupt zip; wrong output type; modified source (hash); transform kept in
the project; every exposed setting shown to change the output; a real-Studio test skipped when Studio is absent.
Independent of every Pi Hub PR.

### P2. pi-hub: jobs, uploads, storage (Done 1, 7 in part, 14)

`hub/quick.py`: tables, a cancelable chunked upload (as `hub/uploads.py`), STL framing and 3MF safety limits (decision
8), sha256 and duplicate detection, generated ids, the Q7 transitions in one function, Stale by a `request_hash` of
model, transform and settings, quota with reservations, the free-space reserve, protected-file retention, owner-only
routes, `quick` reserved. **Tests:** each rejection (empty, truncated, oversized, zip bomb, `..` path, symlink entry,
external reference, wrong magic with a `.stl` name); duplicate upload; every legal and illegal transition; stale after
each of model, transform and setting changing; failed, canceled and stale can't advance; quota under several
simultaneous uploads; a large temporary slice; an interrupted transfer; cleanup after failure; a process restart; low
free space (refused with a reason, nothing in flight deleted); eviction order; and that each protected state (slicing,
validating, preparing, staged, queued, start requested, start accepted, printing, outcome uncertain, awaiting
cleanup) keeps its files, including an old-looking job with a live queue-item reference. An experiment route refusing
`quick`. No page yet.

### P3a. pi-hub: the worker channel (Done 6, 7)

The `quick` request kinds, `quick_attempts` and the claim, heartbeat, progress, artifact and completion routes of
decision 6, cancel, restart reconciliation, the worker record and the "asleep" line. **Tests:** two workers claim one
job; worker crash during slicing; heartbeat loss; a late heartbeat after cancel; a late artifact after timeout; an old
artifact after a replacement attempt began; restart while slicing; duplicate completion; cancel during artifact
publication; a valid completion from the active attempt; wrong sha refused; a bad start sequence refused on the Pi;
a worker never heard from reads "no worker yet"; the allowed-version list; every failure cause shown separately.

### P3b. print-lab: the detached Mac worker (Done 6)

`lab quick worker`: lock file, claim, heartbeat, slice, post, cancel, and a clean exit on a refused attempt. Tests with a
fake hub and a fake slicer, including the worker being killed mid-slice and a result refused as stale. Merge order with
P3a is free: an unknown request kind is ignored by today's Mac.

### P4. pi-hub: the Quick Print page (Done 11 in part, 7)

Upload (drag and drop, picker, progress, cancel), model facts (decision 3's two labels), the one preset's verified
settings, Slice, the slice summary, warnings, history list, and every state. Works with no 3D library. **Evidence:**
screenshots at 390, 820 and 1440 px, light and dark, text sizes Standard, Large and Larger; the width sweep,
`structure.mjs` with axe, `tabbar.mjs`; long filename, empty, error, stale, worker asleep, and a large model.

### P5. pi-hub: the 2D layer inspector (Done 11)

Layer slider and number, range, categories toggled separately, top-down 2D canvas from the actual G-code: extrusion and
travel, seam and speed where parsed, per-layer figures from the file, "unavailable" for the rest. It is complete without
Three.js. Layer data loads progressively and the page stays responsive on a large slice. No owner step. Evidence: the
same screenshot set and a large-slice timing.

### P6. pi-hub: Prepare, Start and the sheet (Done 2, 3, 4, 7, 8, 9, 15)

`hub/quick_start.py`, `printer_refusals` extraction (own commit), the Prepare and Start routes of decision 10 with the
durable start attempt of decision 13, the sheet, Q7's start states, reconcile, the second hold kind in `lab_hold`,
`action_log` rows, folder `quick-print`, version check, and the credential design P0 fixed (decision 9). **Tests:** printer
ready; offline; busy; HMS error; stale telemetry; no material mapping and a filament mismatch block; wrong artifact hash
at Prepare and at the tap; unauthorized 401; duplicate tap; Prepare upload failure with cleanup, and with cleanup
unconfirmed (the file stays shown); queue-add failure; start 409; response timeout; lost response → Uncertain; start
accepted but not printing in 5 minutes; restart during Start; two concurrent starts (one wins); a quick start and an
experiment start together; the queue item always `manual_start`; no start without both ticks; never a palette or
notification action; a `quick_` file never creates an experiment run; the experiment tests unchanged; no key in any
response, log or the browser. **Owner step before live use:** any Bambuddy key change P0 calls for, run by the owner on
the Pi (decision 9); this plan does not name the script change until P0 reports.

### P7. pi-hub: the Three.js 3D view (Done 12)

Decision 16. **Evidence:** the exact release, source URL and licence, and the vendored file's hash, in the PR; a test that
no other page loads the module; Start, Prepare and Slice working with the module blocked; a simulated WebGL failure and
context loss leaving the 2D views intact with a plain message; keyboard operation and reduced motion; the reduced mode
on a phone-width browser; timings on a large model and slice. P7 may land after P10.

### P8. pi-hub: monitoring, history, reprint (Done 7, 10, 1)

After Start the page shows connection, state, progress, layer, remaining time and temperatures **only as the printer
reports them**: missing is "unknown", never zero or invented; stale and disconnected are shown. Pause, resume and stop
are the existing actions, shown here without a second path. Outcome from the print-log entry (decision 14), the history
list and comparison, Reprint with its revalidation. Tests: missing temperature is not 0; stale shows stale; completed
only after the printer says so; reprint after retention removed the file asks for a new slice; Quick Print never
appears in the lab's runs.

### P9. Hardening and docs (Done 11, 14, 15)

Operations docs: architecture, data flow, worker setup, keys and their rotation, failure messages with the next action,
backup (job records are in `hub.db`; artifacts are rebuildable by re-slicing and aren't backed up), rollback (the
`quick` routes can be disabled without touching experiment routes), version compatibility. Recovery check: the Pi lost,
what's needed is the model files the owner keeps; nothing here is a secret. Width sweep and axe at three text sizes,
a restart test, and the failure messages read in the UI.

### P10. Acceptance record (owner present) (Done 13)

The owner-attended print in Acceptance, then one docs PR that records "Accepted <date>" with the evidence in
`docs/operations.md`. It doesn't wait for P7.

### Coverage

| Done | Steps |
|---|---|
| 1 | P2, P8 |
| 2 | P0, P6 |
| 3 | P6 |
| 4 | P1, P3a, P6 |
| 5 | P0, P1, P3a |
| 6 | P1, P3a, P3b |
| 7 | P2, P3a, P4, P6 |
| 8, 9 | P6 |
| 10 | P8 |
| 11 | P4, P5, P9 |
| 12 | P7 |
| 13 | P10 |
| 14 | P0, P2, P9 |
| 15 | P0, P6, P9 |

## Validation

- **Every PR:** pi-hub runs `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests` and
  `node --test tests/*.mjs`; print-lab runs its own suite; the PR pastes the exact commands and counts. A change under
  `hub/static` bumps `SHELL` in `hub/static/sw.js`; UI PRs run the browser checks in AGENTS.md from the Mac.
- **No automated test starts a physical print.** Tests use a fake Bambuddy and printer; a real-hardware check happens
  only in P10 with the owner present, and a mocked printer is never reported as the X2D.
- **Documentation PRs (#183, #184):** they change no runtime behaviour, so passing suites prove nothing about the
  workflow. Their checks are a read of every changed file, the references and decision numbers, the dependency order,
  and the PR descriptions against the content.
- **Evidence ladder for each unit:** merged, deployed, runtime verified, accepted. Only P10 makes anything "accepted".

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
