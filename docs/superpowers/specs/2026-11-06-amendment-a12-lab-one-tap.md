# Amendment A12: Pi Hub may start a print the lab staged

Date: 2026-11-06 · Status: **proposed** (approved when the owner merges this PR) · Amends: the baseline's Print record
row (Bambuddy "read-only"), its printer-control row (one server path) and its rule for actions that confirm; and
one-print ("Bambuddy is third-party: … never change it or write to it") for lab prints only.

Spec: print-lab `docs/superpowers/specs/2026-11-06-one-tap-print-design.md` (merged in print-lab #48), decisions S1–S8.

## Why

1. **Starting a lab print takes five hand steps on the Mac.** `lab exp send`, Bambu Connect, pick the printer, Print,
   then `lab exp start`. The owner is often not at the Mac when the plate is free.
2. **The printer can now take a start from Bambuddy.** Since 6 Nov 2026 the X2D is in LAN-only and Developer Mode, and
   Bambuddy 1.2.5.7 can upload a file, queue it and start it.
3. **The baseline forbids it.** Bambuddy is read-only (Print row), and the only printer-control path is Pi Hub's
   `POST /api/printer/{action}`, whose actions don't include starting. One-print says never write to Bambuddy.

The lab spec keeps what matters: the printer gets exactly the file the lab checked, only the owner starts a print, and
nothing starts on a plate the owner hasn't said is clear.

## Decisions

**D1 Bambuddy stays read-only, with two named writes for lab prints.** Bambuddy stays the system of record for prints
and read-only for everything else, except:

- the lab's Mac agent may upload a library file into Bambuddy's `print-lab` folder (staging; it never queues or starts
  anything), and may delete a file it uploaded that failed the lab's sha256 check;
- Pi Hub's printer-control path may queue and start a library file the lab staged.

Nothing else writes to Bambuddy: no settings, keys, other folders, or other files. One-print's "never write to it"
holds for everything outside these two.

**D2 One printer-control path, one new action.** Pi Hub's `POST /api/printer/{action}` stays the only server path that
commands the printer. It gains **Start a staged lab print**: owner-only, confirms through its sheet (the lab spec's two
ticks and freshness checks), logs the device, and is never a one-key palette action or a notification button. Stop,
pause and resume are unchanged.

**D3 It starts only a staged lab build.** The action takes a staged build, not a file: Pi Hub refuses any library file
the lab mirror doesn't name as staged with a matching sha256. Starting anything else stays in Bambuddy's own UI ("Open
in …"), as today.

**D4 Behind one adapter, version-checked.** Pi Hub's Bambuddy writes go through one adapter that checks Bambuddy's
version (1.2.5.7 today); on any other version the Start action is disabled with the reason until the lab spec's probe
(its PR 2) passes again.

## Baseline changes

- Print row (§ records): "Bambuddy (third party, read-only)" becomes "Bambuddy (third party, read-only except A12's
  staged lab prints)".
- Printer control row: "1 server path: Pi Hub `POST /api/printer/{action}`" adds "including Start a staged lab print
  (A12)".
- Actions that confirm: "Stop print, restore, and restart always confirm" adds "and Start a staged lab print confirms
  through its sheet, never from the palette (A12)".
- Amendments list: A12 added.

## Out of scope

Starting files that aren't lab builds, queues of several prints, scheduled or unattended starts, and any Bambuddy
setting. The Pi Hub sheet itself is the lab spec's PR 4, planned and reviewed there.
