# A12 One tap to print: approve and start a checked lab build from the phone — Plan

Date: 2026-11-06 · Status: **proposed** · Baseline: `2026-11-01-platform-product-architecture-design.md` plus amendment
A12 (`2026-11-06-amendment-a12-lab-one-tap.md`, #137, merged), which amends the Print row, the printer-control row and
"Actions that confirm".

**Goal:** when an approved lab build is waiting and the plate is free, the owner sees "E-0nn: Ready to print" on the
phone, ticks that the plate is clear and the filament matches, and presses **Start E-0nn**. The printer gets exactly
the file the lab checked, and the lab records who started it, from which device, without `lab exp start`.

## Spec

- **A12 D1-D4** (pi-hub) and print-lab's `2026-11-06-one-tap-print-design.md`, decisions **S1-S8**, "What the owner
  sees", the probe (its PR 2, print-lab #49, re-run on Bambuddy 1.3.0) and "PRs" items 4-5. Items 1-3 are done: the
  spec and A12 (print-lab #48, pi-hub #137), the probe (#49), and `lab exp stage` with the mirror's `staged` (#50).
- **Waits on:** nothing the spec names beyond A12, which is merged. Bambuddy 1.3.0 is live and the probe passed on it.

## Done means

The spec gives no numbered criteria. Decision 1 proposes these, one per spec decision this plan builds:

1. **S1/D1:** only Pi Hub's control key can queue or start; the print-lab key and Pi Hub's read key get 403 on
   `POST /queue/` (probe, after P1).
2. **S2:** a build reaches Bambuddy only through `lab exp stage` (or `lab pull` staging it, P2), which re-runs the
   check. Already true for `lab exp stage` (#50).
3. **S3:** at start, Pi Hub downloads the library file and its sha256 equals the mirror's `staged.sha256`; a mismatch
   starts nothing.
4. **S4:** the sheet has the two ticks; Start stays disabled until both are ticked; a filament mismatch blocks.
5. **S5:** Start is refused, with its reason shown, when any of: printer not idle, an HMS error, bed ≥ 35 °C, the build
   not staged/ready/approved in the mirror, or the library file gone. Each reason has a test.
6. **S6:** the run made by the start carries `started_by: "pi-hub one-tap"`, the device, the Bambuddy queue item and the
   tap time, from `lab pull`.
7. **D2:** Start is owner-only, logs the device in `action_log`, and is never in the palette or a notification.
8. **Acceptance (spec item 5):** one real lab print started this way with the owner present, and its run showing 6.

## What exists today (read on 6 Nov 2026, Pi Hub `origin/main` 3c600da, live; print-lab 75f7b5c, live)

- **Printer control:** `POST /api/printer/{action}` (`hub/app.py:425`) does clear, pause, resume with the control key
  (`hub/printer_control.py`, `STEPS` at :16, one command at a time via `BUSY`, key read per call at :45). It re-reads
  the printer before acting (`app.py:435`). **It does not write `action_log`**, although the baseline says every action
  logs the device; `auth.log()` exists (`hub/auth.py:237`).
- **Lab mirror:** `hub/lab.py` stores each project's index (`lab_projects.index_json`). The phone's lab page
  (`hub/static/js/lab.js`) already queues `start` ("It's printing now"), `approve` and `abandon` requests
  (`queue_request`, `lab.py:605`, with `by_device`), which `lab pull` applies on the Mac (`lab/pull.py` `_act`).
  Since #50 each experiment in the index carries `staged` (`library_file`, `folder`, `sha256`, `at`, `bambuddy`)
  while it is ready or approved.
- **Needs you:** `hub/needs.py` `_lab_items` (:64) turns the index's `needs` into items, verbs from `LAB_VERB`.
  "Send it to the printer" today links to the lab page.
- **Printer reading:** `sources.bambuddy_printer()` gives `state`, `bed_temp` and `hms` (`hub/sources.py:166-187`).
- **Bambuddy 1.3.0** (updated at the owner's request, 6 Nov ~08:20): start path `POST /queue/` with `manual_start: true`, then
  `POST /queue/{id}/start`; start returns 409 with the deficit when the assigned spool lacks the grams. The settings
  screen can only create and delete keys; `PATCH /api/v1/api-keys/{id}` (admin sign-in) edits scopes.
- **Keys** (Bambuddy's database, read-only, 6 Nov; values never read):

  | id | Key | Used by | Has | Needs |
  |---|---|---|---|---|
  | 6 | print-lab | Mac lab: print log, archives, staging | everything | Read, Library |
  | 1 | Pi Hub (read) | Pi Hub pages; P3's file check | Read, Queue, Library, Inventory, Maintenance, Archives, Projects | Read |
  | 4 | Pi Hub control | Pi Hub's printer actions | Control | Control, Queue |
  | 2 | Local AI Materials (read) | Local AI spools page (GET only) | as id 1 | Read |
  | 3 | Local AI Clear plate (control) | the display's Clear plate via Local AI (status, clear-plate, hms/clear) | Read, Queue, Control, Library, … | Read, Control |

  "Claude inventory" (id 5) was deleted by the owner, 6 Nov. Every read the apps make is covered by Read
  (`can_read_status` maps archives, library, queue, inventory and projects reads in Bambuddy's `core/auth.py`).
- **Key script:** `deploy/bambuddy-control-key.py` signs in as `bill` (password in `/etc/pi-hub/secrets/bambuddy_admin`,
  or asked) and creates "Pi Hub control" once.
- **Plate detection** is off and uncalibrated; it only pauses after a start (probe).

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Done means** is the list above, one item per spec decision built here.
2. **Keys are edited in place, by one script the owner runs on the Pi** (`deploy/bambuddy-key-scopes.py`): it signs in
   as the control-key script does, finds each key by **id and name** (both must match the table; a missing or
   duplicated name stops it before any change), PATCHes the scopes, and prints each key's scopes after. It never
   prints a key or the password. *Rejected:* creating new keys and swapping files on the Mac, the Pi and the PC (three
   hosts, a window where apps fail). Local AI's keys are included because A12's "nothing else writes" is only true if
   no other key can queue; their new scopes are exactly what their code calls (above).
3. **Freshness (S5) is read at the tap, not from a mirror's age.** Two readings: (a) the Mac must have synced the
   mirror within 2 minutes; (b) at the tap Pi Hub re-reads the printer and Bambuddy, and checks the mirror as it is.
   Recommend (b): (a) needs the Mac awake for every start, which defeats S1 ("the owner is often not at the Mac"); a
   rebuild that changes the build also syncs (the lab syncs after every record change), and S3's hash check at the tap
   catches a file that changed anyway. "Within 2 minutes" applies to the printer read, which is forced fresh.
4. **The budget part of S5 is the mirror's check status.** A staged build is only shown while its experiment is ready
   or approved, which is the check's verdict including the budget guards. Pi Hub doesn't recompute budgets.
5. **The start is one route: `POST /api/printer/start` with `{project, experiment}`**, under the existing path (A12 D2),
   sharing `BUSY`. Order: S5 checks → download the library file with the read key and hash it (S3) → `POST /queue/`
   with `manual_start: true` and the control key → `POST /queue/{id}/start` (no `skip_filament_check`; a 409 shows the
   deficit and cancels the queue item) → log → queue the S6 request. Any failure after the queue add cancels the item,
   so nothing waits in Bambuddy's queue to start later.
6. **S6 travels as a new lab request kind, `one_tap`** (Pi Hub only; Local AI doesn't send it), with `tapped_at`,
   `queue_item`, `library_file`, `build`; `by_device` is the signed-in device. `lab pull` applies it like `start`, with
   `started_by: "pi-hub one-tap"` and `started_from: "one-tap"`, and the print-log link (one-print P2) attaches the
   Bambuddy print to that run as it does today. *Rejected:* `lab pull` reading `action_log` (a second channel).
7. **Approving from the phone stages automatically.** The page's Approve already exists; `lab pull`, after applying an
   approval or when an experiment is ready, stages it (S2, `lab exp stage`'s own code) once the printer has been idle
   10 minutes, as the spec allows ("`lab pull` may stage an approved build"). So the owner's whole path is Approve,
   then Start, both on the phone. A staging failure is reported in the lab's notices, never retried in a loop.
8. **The filament tick (S4) compares the build's filament with the AMS tray Bambuddy reports for slot 1** (Pi Hub's
   `filament.spools()` reading): type and colour match → pre-ticked; a different type → blocked with both named;
   unknown → unticked, the owner decides.
9. **Existing printer actions log too.** Clear, pause and resume start writing `action_log` in P3, since the
   baseline already requires it; one line each.

## PRs, one at a time

### P1. Pi Hub: the key-scope script (owner runs it)

`deploy/bambuddy-key-scopes.py` per decision 2, with tests against a fake Bambuddy (wrong name, duplicate, refusal,
no secrets printed). Covers Done 1 (D1). **Owner step:** run `sudo python3 /opt/pi-hub/current/deploy/bambuddy-key-scopes.py`
on the Pi after deploy. Evidence: the script's after-table, and the probe re-run (403 for print-lab and Pi Hub read on
`POST /queue/`; 404 for the control key; Local AI's Materials and Clear plate still answering).

### P2. print-lab: stage on approval, and S6

`lab pull` stages ready/approved builds when the printer has been idle 10 minutes (decision 7) and applies `one_tap`
requests (decision 6). Tests with a fake Bambuddy and a fake Pi Hub request. Covers Done 2 (partial: the auto path)
and Done 6. Merges independently of P3 (an unknown kind is refused by today's hub, so nothing sends it yet).

### P3. Pi Hub: the start route

`POST /api/printer/start` (decision 5), `printer_control.start_staged()` with its Bambuddy calls behind one adapter that
checks the version (1.3.0), the `one_tap` request kind in `hub/lab.py`, and `action_log` for every printer action
(decision 9). Tests: each S5 refusal; S3 mismatch; queue-add failure; start 409 cancels the item; Bambuddy version
differs; busy; non-owner 401; no start without `manual_start`. Covers Done 3, 5, 7.

### P4. Pi Hub: Needs you and the sheet

Needs you: "E-0nn: Ready to print" (tone warn, verb `start_print`) while the mirror has `staged` and the printer is
idle; it replaces "Send it to the printer" for that experiment. The lab page's sheet (kit sheet, one faceplate, one
primary action): the design render when there is one, time, grams, the risk bands, the two ticks (decision 8), **Start
E-0nn** disabled with the reason, then *Sent*, *Accepted*, *Printing*. Checked in the browser at 390, 820 and 1440 px,
dark and light, with axe. Covers Done 4. On the page after: the existing "It's printing now" stays for prints sent from
Bambu Connect (S8).

### P5. Acceptance (owner present)

One real lab print approved and started from the phone. Evidence: the run in print-lab with `started_by`, device and
queue item; the print-log entry linked; `action_log` row. Recorded in `docs/operations.md` as "Accepted <date>".

### Coverage

| Done | Step |
|---|---|
| 1 | P1 |
| 2 | #50 (stage), P2 (auto) |
| 3, 5, 7 | P3 |
| 4 | P4 |
| 6 | P2 (apply), P3 (send) |
| 8 | P5 |

## Acceptance

Seen by the owner: Approve and Start on the phone, the print running, and the lab's run showing who started it. Ladder:
merged, deployed, runtime verified (P1's probe, a refused Start with each reason on the live hub), accepted (P5,
recorded in `docs/operations.md`). Nothing is called done before P5 is recorded.

## Out of scope (noted, not gated)

- **Plate detection:** calibrating it is the owner's choice; it only pauses after a start, so it is a backstop, not a
  gate (probe). Noted in operations, no follow-up.
- **The spec's `lab pull` staging stays within the Mac's schedule:** if the Mac is asleep, nothing is staged and the
  sheet doesn't appear. That is S8's fallback (Bambu Connect), not a gap.
- **Bambuddy updates:** each new version disables staging and Start until the probe passes again. A `release:`-style
  notice when that happens is a follow-up issue for the releases record, not built here.
