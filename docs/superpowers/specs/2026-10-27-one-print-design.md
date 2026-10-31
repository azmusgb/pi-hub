# One print: Bambuddy's print log is the record of every print (design)

Written 27 Oct 2026. Suite step 1 of the consistency critique (same day): Pi Hub, print-lab and Local AI refer to a
print by Bambuddy's id and use one set of status words. Builds on `2026-10-24-one-home-design.md` (D8: the hub reads
other apps through their APIs and never copies their data).

## Intent

Today four places keep their own idea of a print: Pi Hub's `prints` table (its recorder and webhook), Bambuddy's
archive, Local AI's printer status, and print-lab's `print_runs`. They disagree (the same print reads Finished,
Stopped or cancelled), and recording a failed lab print means reading numbers in one tool and typing them into the
Mac CLI.

**Success:**
- A lab print that ends fills in its own run: outcome, failure point, minutes, grams, a link to the print. The owner
  only adds the verdict.
- Pi Hub's Workshop history, weekly counts, digest, Assistant context and monthly filament totals come from
  Bambuddy and match it.
- Prints that aren't lab builds are visible as "Outside the lab" in Pi Hub and in Local AI's Print lab view.

**Constraints:** Bambuddy is third-party: read it through its API with the existing keys, never change it or write to
it. print-lab runs on the Mac and must never block on the network. Verdicts stay in print-lab (not Bambuddy's
`user_verdict`).

**Out of scope (later steps):** one Needs you across the suite; filing outside prints into experiments; Local AI's live
printer-status words; tagging prints in Bambuddy; switching the finish photo to Bambuddy's own.

## Facts this design rests on (checked 27 Oct 2026 against the live Bambuddy 1.2.5.7)

- A Bambuddy **archive** is a file; each attempt to print it is a **print-log entry**
  (`GET /api/v1/archives/{id}/runs` → `PrintLogEntrySchema`: `id`, `archive_id`, `print_name`, `status`,
  `started_at`, `completed_at`, `duration_seconds`, `filament_used_grams`, `cost`, `failure_reason`,
  `user_verdict`, …). The archive carries the planned `print_time_seconds`. All entries across archives come from
  `GET /api/v1/print-log/` (`limit`, `offset`, `sort_by`, `sort_dir`, `status`, `date_from`, `date_to`), which the
  print-lab key reads (200 in the 27 Oct probe); the hub's key is checked in the plan's first Pi Hub task.
- Content hashes never match: 0 of 26 lab build `artifact_sha256` values equal any archive `content_hash`
  (Bambuddy hashes the file the printer received).
- Names do survive: archive #15's `print_name` is `hex-tile_E-023_BLD-023-01`, the lab artifact's name.
- 9 of the last 12 prints (archives #17–26, e.g. `HEX_TILE_v73_textured`) are not lab builds.
- `lab pull` already runs every 60 s on the Mac (launchd `com.printlab.pull`).

## Decisions

| # | Decision |
|---|---|
| P1 | The unit of "a print" is a Bambuddy **print-log entry**; its id is the print's identity everywhere. |
| P2 | Lab prints are recognised by name: `print_name` matching `^(?P<project>[a-z0-9-]+)_(?P<exp>E-\d{3,})_(?P<build>BLD-\d{3,}-\d{2,})$`. Anything else is "outside the lab". Pi Hub and print-lab apply the same pattern independently. |
| P3 | print-lab links runs to prints (in `lab pull`); Pi Hub reads the print log directly. No app asks another app for this. |
| P4 | print-lab keeps a small **evidence snapshot** when an attempt ends — the one deliberate copy, so evidence survives an archive purge. Each fact is marked with its source. |
| P5 | Status words, everywhere: `completed` → Finished, `failed` → Failed, `cancelled` → Cancelled, `printing` → Printing. |
| P6 | Pi Hub's `prints` table and its outcome logic are retired; the finish photo stays, keyed by print id. |

## print-lab

**Link field.** Each `print_runs[]` item gains:

```json
"bambuddy": {"print": 25, "archive": 15, "linked": "auto" | "hand", "at": "<iso>"}
```

**Matching, in `lab pull`.** Read print-log entries with id greater than the last seen (state kept beside the pull's
existing state, not in records). For each entry whose name matches P2 and whose experiment and build exist:
- attach it to that build's newest run without a `bambuddy` link;
- if the build has no such run, create one (`started_at` from the entry) — a print started without telling the lab is
  still caught;
- two candidate runs → the newest wins, and `lab pull` prints which.
Names that match P2 but name an unknown experiment or build are treated as outside the lab.

**Evidence snapshot.** When the linked entry's status is `completed`, `failed` or `cancelled`, write once:

| Run field | From | Marked |
|---|---|---|
| outcome | `status` (P5 word) | `bambuddy print #N` |
| started / ended | `started_at` / `completed_at` | `bambuddy print #N` |
| minutes | `duration_seconds` / 60 | `bambuddy print #N` |
| grams | `filament_used_grams` | `bambuddy print #N` |
| failure reason | `failure_reason` | `bambuddy print #N` |
| failure point | `duration_seconds / archive.print_time_seconds`, failed only, clamped 0–1 | `estimate, bambuddy print #N` |

A value the owner already entered is kept; the snapshot records the Bambuddy value beside it rather than replacing it.

**Hand link.** `lab exp link E-023 BLD-023-01 --print 25` attaches any print (renamed or outside); `lab exp unlink E-023
<run id>` removes the link and the snapshot facts marked from it.

**Outside the lab.** `page.json` gains `outside: [{print, archive, name, status, started, ended}]` — the 20 most recent
print-log entries not linked to any run. Read-only.

**The owner's prompt.** A run that gains an outcome and has no verdict joins the lab's existing needs list
("E-023 run failed at ~40 % — judge it").

## Pi Hub

- `bambuddy.prints(since=None, limit=20) -> list[dict] | None` reads the print log with the hub's key (newest first;
  `None` when Bambuddy doesn't answer). Every former reader of the `prints` table uses it: Workshop history (last 20),
  the week's finished count and hours, the digest, the Assistant context (last 3), `filament.summary` (grams and cost
  for the last 30 days).
- One status mapping (P5) in one place; the `Stopped` word and the 97 % heuristic go.
- A row whose name matches P2 shows "E-023 · BLD-023-01" linked to Print lab; others show "Outside the lab".
- The recorder keeps only the finish photo: when Bambuddy reports an attempt ended, take one camera frame and save it
  as the photo for that print id; `/api/prints/{print id}/photo.jpg` serves it.
- The `prints` table is no longer written or read; it stays in the database untouched (removed in a later clean-up).
  Old rows aren't migrated: Bambuddy's log already holds those prints.
- Bambuddy not answering: history and counts show "Bambuddy isn't answering" (the spool card's wording); no fallback
  to local numbers.

## Local AI (Print lab view)

Renders the new sync fields only; it never calls Bambuddy for them.
- A run with a link: "Failed at ~40 % (estimate) · 1 h 12 min · 31 g · from Bambuddy print #25 ↗", linking to
  `https://bambuddy.home.arpa/` for that print. A hand-entered run says "entered on the Mac".
- "Outside the lab": name, status word, when, Bambuddy link; hidden when empty.
- Run labels use P5's words. Older page.json without the fields renders as today.

## Errors

- Bambuddy down: print-lab skips linking and catches up next pull from the last-seen id; Pi Hub says "Bambuddy isn't
  answering". No app invents a status.
- A linked entry later deleted in Bambuddy: the snapshot stays; the link reads "no longer in Bambuddy".
- An entry still `printing` when pulled: linked now, snapshot written when it ends.

## Testing

Recorded Bambuddy responses (print-log shapes from archives #15–26, personal fields trimmed); no live Bambuddy in
tests.
- print-lab: P2 parsing (match, near-miss, unknown experiment); attach to open run; create a run; newest-wins; catch-up
  from last-seen id; snapshot written once at end; owner's value kept; failure-point estimate and clamp; hand link and
  unlink; `outside` list.
- Pi Hub: each former reader uses `bambuddy.prints`; P5 mapping; lab-name detection; "isn't answering" state; photo
  keyed by print id.
- Local AI: run line and outside list from the new fields; an old page.json still renders.

## Rollout

One plan, three parts, each usable alone: (1) print-lab linking and snapshot; (2) Pi Hub on the print log; (3) Local AI
renders the new fields. (1) and (2) are independent; (3) needs (1).
