# Quick Print: operating it (A19)

Quick Print takes an ordinary STL or 3MF from the owner's phone to the Bambu X2D: upload, slice on the Mac with Bambu
Studio, inspect the sliced file, Prepare, Start, monitor, history, reprint. It never weakens the experiment safeguards:
a Quick Print job is never a lab run, never evidence, and nothing in its history counts toward a question or a
qualification. The design is in `docs/superpowers/specs/2026-11-08-amendment-a19-quick-print.md` and the plan in
`docs/superpowers/plans/2026-11-08-a19-quick-print.md`. This page is what the owner needs to run and recover it.

Status words follow the plan's ladder: *merged* and *deployed* are not *accepted*. Quick Print is accepted only when
the owner-attended print (P10) is recorded in `docs/operations.md` as "Accepted <date>". Until then every statement below
that depends on Bambuddy's real behaviour is marked **unverified**.

## Architecture and data flow

```
phone ──► Pi Hub /quick ──► hub.db (job record) + /var/lib/pi-hub/quick (model, slice)
                │                         ▲
                │ claim / heartbeat /     │ the slice, uploaded in 8 MiB pieces
                ▼ artifact (Mac key)      │
          the Mac: `lab quick worker` ──► Bambu Studio (CLI) ──► sliced .gcode.3mf
                │
Pi Hub ─ staging key ─► Bambuddy `quick-print` folder ─► queue item ─► the X2D
        (Prepare)          (Start: manual start, one command, once)
Pi Hub ◄─ read key ─── printer state, print log (monitor, outcome)
Pi Hub ─ control key ─► pause / resume (the existing printer actions)
```

1. **Upload** (`/api/quick/uploads`, owner only): chunked, hashed, structure-checked. The Pi never measures a mesh.
2. **Slice**: the job is queued; the Mac's worker claims it under a fenced attempt (a generation number), slices in a
   killable child with a heartbeat every 15 s, uploads the artifact and reports. Any refusal from the hub stops it.
   The hub re-checks the start block (command sequence, line count, printer start G-code hash, filament ids) against
   `hub/quick_start_reference.json` before the job becomes `sliced`.
3. **Review**: the layer reader (`hub/quick_layers.py`) reads the toolpath from the sliced file; the optional 3D view
   (`hub/static/js/quick-3d.js`, Three.js 0.187.0, vendored) draws it. Neither takes part in authorising a print.
4. **Prepare**: the staging key uploads the slice to Bambuddy's `quick-print` folder, downloads it and compares the
   sha256. It does not start the printer.
5. **Start**: owner only, both ticks, the printer's own state re-read, the hub's start lock held, the stored file and
   Bambuddy's copy re-hashed, an attempt row written *before* any Bambuddy call, then one `POST /queue/` with
   `manual_start` and one start. An answer the hub can't read is **Outcome uncertain** and is never retried by itself.
6. **Monitor and outcome** (`hub/quick_monitor.py`): figures only as the printer reports them. `finished` only when
   Bambuddy's print-log entry named `quick_<job id>` says completed.
7. **History and Reprint**: each job keeps its outcome; Reprint copies the stored files into a new `sliced` job after
   the same checks, and needs Prepare and Start again.

States: `draft`, `ready_to_slice`, `queued`, `preparing`, `slicing`, `validating`, `sliced`, `needs_attention`, `failed`,
`canceled`, `stale`, `staging`, `staged`, `queued_in_bambuddy`, `start_requested`, `start_accepted`,
`printing_confirmed`, `outcome_uncertain`, `finished`. Every change goes through `quick.transition`, which only allows
the moves in `quick.ALLOWED`.

## Worker setup (the Mac)

- The worker is print-lab's `lab quick worker`: one pass that claims at most one job, slices it and exits. An empty
  claim is also the idle contact that feeds "Mac asleep, last seen" on the page.
- It needs the lab's Mac key (the hub stores only its SHA-256, `lab_mac_key.sha256`; `deploy/lab-key.sh --rotate` makes a
  new one), Bambu Studio **02.09.01.70** (the only version the hub allows: `quick_worker.ALLOWED_STUDIO`), and the base
  project saved in Studio as "Standard 0.20 mm PLA, X2D 0.4" (the preset the page's settings are checked against).
- **Unverified / owner step:** how the worker is scheduled. This plan doesn't install a launchd agent; until one is set
  up the Mac must run `lab quick worker` (or the owner's own schedule) for a queued slice to be claimed. A slice not
  claimed waits; it doesn't fail.
- The Mac reaches only `/api/lab/*` through Caddy; the worker's routes are `/api/lab/quick/worker/*`.

## Keys and their rotation

| Key | Where | Rights | Rotate |
|---|---|---|---|
| Mac worker key | Mac `~/.config/print-lab/hub.key` (print-lab's `LAB_HUB_KEY_FILE`), hash in `/etc/pi-hub/secrets/lab_mac_key.sha256` | claim, heartbeat and artifact routes only | `sudo bash /opt/pi-hub/current/deploy/lab-key.sh --rotate`, then put the new key on the Mac |
| Staging key | `/etc/pi-hub/secrets/bambuddy_staging_key` (root:pi-hub 640) | **Read status** and **Manage library**, printer 1; no Queue or Control right | delete the key in Bambuddy's API keys page and the file, then `sudo python3 /opt/pi-hub/current/deploy/bambuddy-staging-key.py` (the script does nothing if the file exists) |
| Control key | `/etc/pi-hub/secrets/bambuddy_control_key` | **Control printer** only | the same way with `deploy/bambuddy-control-key.py` |
| Read key | `/etc/pi-hub/secrets/bambuddy_api_key` | **Read status** | as in `docs/operations.md` |

Bambuddy has no folder-level scope, so the hub itself keeps the staging key to the `quick-print` folder, to an
allow-list of calls (`quick_start.CALLS`) and to deleting only files it recorded uploading. **Unverified:** a rotation of
each key hasn't been drilled; the rows above are the scripts' own behaviour. Without the staging key, Prepare says so and
sends nothing. Nothing on this page is a secret; no key value is ever printed, logged or stored in a job.

## What the page says when something is wrong, and what to do

| Message (or its cause) | Where it appears | Next action |
|---|---|---|
| `heartbeat_stale`: the Mac stopped reporting during the slice | job reason, Slice | wake the Mac and run the worker; Slice again |
| `slice_timeout`: the slice ran longer than 30 minutes | job reason | simplify the model or settings; Slice again |
| `attempt_expired`: the hub restarted while this was slicing and the lease had lapsed | job reason | Slice again |
| `stale`: the model, transform or settings changed while this was slicing | job reason | Slice again with the current settings |
| `slice_failed`: Bambu Studio couldn't slice this model | job reason | check the model is a solid, printable mesh; try the settings |
| `studio_version`: the Mac's Bambu Studio isn't a version the hub allows | job reason | install 02.09.01.70 on the Mac, or change the allow-list in a reviewed PR |
| `missing_binary`: Bambu Studio isn't installed on the Mac | job reason | install it |
| `output_invalid`: the output wasn't a usable sliced file | job reason | Slice again; if it repeats, keep the Mac's worker log |
| `worker_ended`: the worker ended before it finished | job reason | Slice again |
| `start_sequence`: this slice doesn't have the X2D start sequence | job reason, Needs attention | the Studio base project is wrong; re-save "Standard 0.20 mm PLA, X2D 0.4" |
| `storage`: there wasn't room | job reason | finish or cancel a print, or delete old jobs; storage is 4 GiB with a 3 GiB reserve left to the Pi |
| `canceled` | job reason | none |
| The hub can't stage files yet: its Bambuddy staging key isn't set up | Prepare | run `deploy/bambuddy-staging-key.py` on the Pi |
| Bambuddy is not 1.3.0 | Prepare, Start sheet | Start is proven on 1.3.0 only; don't use Quick Print on another version until it's re-proven |
| Bambuddy's copy isn't the file that was prepared. Nothing was sent | Start | Prepare again |
| The hub restarted while this was starting. Look at the printer | Outcome uncertain | look at the printer; if it isn't printing, "It isn't printing: go back", then tick both again |
| Bambuddy accepted the start but the printer wasn't seen printing it | Outcome uncertain | the same |
| Two print-log entries for this job, or no entry 10 minutes after the printer stopped | Outcome uncertain | look at the printer and Bambuddy's log; the hub won't guess |
| The hub couldn't read the printer's status just now | Monitor | nothing is shown as current; it keeps trying every 10 s |
| Its files were removed to make room, so a reprint needs a new slice | Reprint | upload the model again |
| The stored files no longer match their recorded hashes | Reprint | upload the model again; the files are never printed |

## Backup and recovery

- **Backed up:** job records live in `hub.db`, which the nightly Pi backup already copies (`deploy/pi-hub-backup.sh`).
- **Not backed up, on purpose:** the model and slice files in `/var/lib/pi-hub/quick`. A slice is rebuilt by slicing the
  model again; a lost file shows as "file removed" and a reprint asks for a new slice.
- **Recovery check, if the Pi is lost:** what is needed is the model files the owner keeps (the phone's or the PC's
  originals). Nothing in Quick Print is a secret: the keys above are re-made by their scripts and the Mac key by
  `lab-key.sh`. Job history comes back with `hub.db`; without it history is empty and nothing else is affected.
- **Retention** (`quick.evict`, only when space is needed, in this order): the files of drafts untouched for a day,
  then of canceled, failed, needs-attention and stale jobs, then of finished jobs (any age), then of slices untouched for
  seven days. The record, hashes, name and outcome stay. A job that is slicing, being prepared, staged, queued, starting,
  printing or uncertain is never touched, and neither is one Bambuddy still refers to.

## Rollback

`HUB_QUICK=0` in the hub's environment (the service's `Environment=` line or a drop-in, then the hub is restarted by the
owner) removes every Quick Print route, the worker routes and the reconcile loop, and leaves the experiment routes,
the lab, and the printer actions untouched (`tests/test_quick_rollback.py` starts the app both ways and checks that). The page `/quick` then says
the hub isn't answering for Quick Print. **Don't switch it off while a Quick Print is starting or printing:** nothing
would be watching it. Switching it back on makes a start that was in flight Outcome uncertain, never resumed.

## Versions

| Part | Proven on | What happens elsewhere |
|---|---|---|
| Bambuddy | 1.3.0 | Prepare and Start refuse with the version in the message |
| Bambu Studio (Mac) | 02.09.01.70 | the worker's slice is refused (`studio_version`) |
| Pi Hub | the release that shipped the step | rollback is the usual `pi-hub-release` rollback; the job tables are additive |
| Three.js (3D view) | 0.187.0, MIT, hashes in `hub/static/vendor/three-0.187.0/README.md` | the view is optional |

`hub/quick_start_reference.json` must equal print-lab's `presets/quick/x2d-start-reference.json`.
From the Mac: `python3 tools/sync_quick_reference.py --check` (and `--write` to copy it, then ship it).

## Not yet proven

- Anything that depends on Bambuddy's real behaviour: that a print started this way names its job `quick_<id>` in the
  printer's state and in the print log, the status words of the log, and the queue and library calls. P10 is that check.
- The A14 text sizes (the page was checked at its one size), and the width sweep with a real sliced job.
- Key rotation, and the Mac worker's schedule.
