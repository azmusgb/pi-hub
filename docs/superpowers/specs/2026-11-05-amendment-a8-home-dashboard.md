# Amendment A8: Home is a dashboard

Date: 2026-11-05 · Status: **approved by the owner on 5 Nov 2026 ("lets go with it!")**, from the prototype
https://claude.ai/artifact/2YFCdUfzb7ajwRMoWRe25M · Amends: the platform baseline
(`2026-11-01-platform-product-architecture-design.md`, section 5.5 (Home's order) and section 9 (the term "Home")) and
A7 (`2026-11-04-amendment-a7-one-page.md`), decisions P1 (page anatomy) and P3 (lamp on the right), for Home only.

## Why

Home on A7's anatomy (Now faceplate with the camera, Needs you, Since you last looked) was reviewed at 1440 and 390 px on
5 Nov 2026. The owner: "not digging the layout, content, all". Found:

1. **Nothing says the state of the house at a glance.** Weather, a faceplate, a list and a caption have equal weight.
2. **Plumbing shows.** E-027's detail is the checker's output ("58.7 / 45 min per test … (reference_not_printed)").
3. **Every Needs-you item looks the same,** whether it's a hardware risk (the Pi's low voltage) or a setting left off
   for four days (AdGuard paused).
4. **The camera repeats Workshop** ("I don't need a camera view there — I already have the full printer page").
5. **"All else OK" and "Since you last looked" are closed `<details>` that don't look openable.**
6. **Desktop leaves the right half empty;** there's no layout for an iPad on its side or a TV.

The owner asked for "more of a cooler dashboard", then "right direction, push further", then for it to work on phone,
iPad, desktop and TV.

## Decisions

**D1 Today is the hero.** A band across the top draws the house's day from midnight to midnight, one row per system:
X2D (each print as a bar: finished, failed, running with its remaining time dashed to the finish), Workshop display
(offline spans), Raspberry Pi (self-check, power events), Backups (each run) and Updates (each release that went live).
A "Now" line marks the time; the hours still to come are hatched. Above it, four counts in the readout face: prints
finished, failed, power dips, updates shipped. Pointing at, tapping or tabbing to a mark says what it was and when, in
one line under the band. On first load the Now line sweeps from midnight to now once (skipped with reduced motion).

The band replaces "Since you last looked": what changed is drawn on the day it happened instead of listed since a
remembered visit. Anything older than today is on Alerts.

**D2 Needs you sits beside the rack,** on the left on wide screens and first on narrow ones, still drawn by the kit's
`renderList` (A7 P2 unchanged: titles in plain words, verb actions, `since … · area`). Items are ordered by tone, `bad`
first. An item that names a time today lights its mark on the band on hover, focus or tap. A setting left off on
purpose (AdGuard paused) is not a Need: it shows in its system's row with the action to undo it.

**D3 Systems is a rack.** One full-width row per system, read across like the front of a server rack: a lamp on the
left (this amends P3 for Home: the lamp leads, so a warning row is found by scanning one edge), the name with its state
in words, its readings, and a link to its page on the right. A row with a warning gets a faint warn wash. Rows: X2D
(progress ring, done time, layer, nozzle, bed, filament with its spool colour, AMS humidity), Raspberry Pi (temperature
on a scale marking where it slows down, memory, self-check, uptime, updates waiting), Network (internet, ad blocking,
Windows PC, Local AI), Storage (SD card and Movies drive fill, last backups) and This week (prints finished, hours, the
last 8 prints by length, failed in the bad colour).

**D4 Readouts look like meters.** Numbers that are the point of a row (81%, 62°, 21/24, the clock) use Archivo at its
narrowest width (kit `--ui-stretch-readout`), tabular. Everything else stays in the kit's text styles. No camera on
Home; Workshop keeps it.

**D5 One page, every screen.**

| Width | Layout |
|---|---|
| Phone (< 600 px) | One column. The band fits the width: row names sit above each track, hours read "6a", counts in one row of four. Rack rows stack their readings. |
| iPad portrait, small laptop (600–1000) | One column, full-width band, Needs you then Systems. |
| iPad landscape, desktop (1000–1800) | Band on top; Needs you left (4 of 12), Systems right (8 of 12). |
| TV, landscape ≥ 1800 | Two columns: Today and Needs you left, Systems right, fitting one 1080p screen; the page scales up (1.2× at 1920, 1.6× at 2560, 2.4× at 3840) to read from across the room. |

The band is drawn at its own pixel width and redrawn on resize or rotation, so its text is the same size everywhere.
Every mark has a target at least 24 × 40 px. Rows and Needs you lay out by their container's width, not the screen's.

**D6 States** (A7 P8 applies). Loading: kit skeletons in the band and the rack. A source that doesn't answer leaves its
lane or row in place with the phrase-table words (`source_down`), never an empty track. A quiet day: the band shows the
empty tracks and the Now line, and the counts read 0. The page refreshes on Home's existing cadence (every 15 s and on becoming
visible); the band redraws without moving focus.

**D7 One endpoint for the day.** `GET /api/today` returns the lanes and their marks for the hub's local day, each lane
with its source and whether it answered. Built only from what Pi Hub already keeps:

| Lane | Source | Limit, said in the mark's words |
|---|---|---|
| X2D | Bambuddy's print log (`bambuddy.prints()`): `started`, `ended`, `word`; a print that started yesterday is drawn from midnight | none |
| Workshop display | `record_events`, `thing = workshop_display`, offline → online | none |
| Raspberry Pi | the self-check (`last.json`); `record_events`, `thing = pi`, `new = power` | the Pi reports low voltage as a flag, not a time: the mark is when the hub first saw it ("Seen at 5:17 AM") |
| Backups | `/api/system/backups` `last` per repo | the latest run only (backups run once a night) |
| Updates | each `release:<target>` record's `deployed_at` | the latest release per system only; a second release of the same system in a day isn't drawn |

The rack reads the existing routes (`/api/now`, `/api/pi`, `/api/workshop`, `/api/records`, `/api/network/adguard`,
`/api/system/backups`). "Paused since" for ad blocking is the `adguard` record's `since`.

## Not changed

A7 for every other page. The wall display (`/wall`) keeps its own board. The kit's look and tokens. The strip, rail,
search and the Assistant button.

## Delivery

One Pi Hub PR: `/api/today` with tests, Home's new layout replacing the control room on `/`, checked in the browser at
390, 820, 1180, 1440, 1920 and 3840 px, dark and light, with axe over Home.
