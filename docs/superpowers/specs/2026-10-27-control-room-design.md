# Control room: one source of truth, a live shell, and the hub as every tool's front end (design)

Date: 2026-10-27 · Status: design approved in conversation, spec for review
Type: architectural. It follows [One home](2026-10-24-one-home-design.md) (steps 1–5 live, step 6 planned) and
changes how every page gets its data. Each piece below gets its own spec or plan, and its own releases.

## Intent

**Who it is for:** the owner alone, on phone and desktop equally. One Home's decision stands; the household, kids and
guests are not users.

**What the first screen answers, in order:**
1. What's happening right now (live state).
2. Getting to anything fast (search and actions).
3. What's wrong and what to do about it.
4. What happened since I last looked.

**How much the hub does:** it becomes the front end for the house's tools (Bambuddy, Paperless, Backrest, AdGuard,
NETMON, Plex, Homebridge). Those tools stay the backend and the record of their own data.

**Problem (screen-by-screen critique, 27 Oct 2026, 02:01–02:03):** the hub shows a lot and can't be trusted:

| Fact | What the pages said at the same moment |
|---|---|
| The printer | Home "Printing, 11%"; Help "3D printer: No status"; Workshop history listed the running job as "Stopped, 3 min" |
| Windows PC | Wall "Local AI isn't answering. The PC may be off"; the same wall's internet panel "Windows PC 3.6 ms" |
| Needs you | Desktop Home 1 item; wall 2 items a minute later; phone Home no Needs you card at all |
| Ad blocking | Home & network "AdGuard isn't answering"; Home "Internet OK", nothing in Needs you |
| Overnight | v72 stopped early at 1:31; the alert was held for quiet hours and no page except Automations › What the hub noticed showed it |

Other findings:
- Every Home card has the same weight. A print at 11% and "Search Paperless" look alike.
- About 12 "Open X ↗" links hand the owner off to other tools.
- Media is 5,500 px tall on desktop and 9.5 phone screens; the movies drive's reliability warning is near its bottom.
- `/more` is blank on desktop; Weather highlights Home in the menu; "2 setup steps remaining" sits permanently on Home.
- Devices shows the dishwasher as 9 separate switches.
- Help takes 2.9 s to load; Media took about 6 s on first load.

**Cause:** status is worked out separately in `now.py` (Home, wall), `needs.py` (Needs you), `events.py` (alerts,
What the hub noticed) and `freshness.py` (Source responses), from different sources: the printer from both pi-status
and Bambuddy, the PC from both NETMON probes and Local AI.

**Success:** re-walking the night of 26–27 Oct (a print stops and restarts overnight, the camera link expires, the PC
comes and goes, AdGuard is down) gives one consistent story on phone and desktop, and each problem shows its cause
and an action.

**Not goals:** a multi-user model; replacing the tools' backends; a frontend framework or build step; changing the
workshop display's firmware.

## Decisions

| # | Decision |
|---|---|
| C1 | One **record** per thing; every page, the wall, alerts and search read records and never fetch on their own. |
| C2 | Each field of a record has **one designated source**. Where two sources truly disagree, the record says so. |
| C3 | Quiet hours hold back the **phone alert** only; the event is always recorded and shown. |
| C4 | A thing whose source stops answering keeps its last record, marked **stale**; it never turns "off" or "OK" by itself. |
| C5 | The shell is ordered **Now → Problems → Since you last looked**, with a **⌘K command bar** on top. |
| C6 | **Now** shows only what is active or unusual; everything else is one "All else OK" line. |
| C7 | Pages update in place over **server-sent events**. |
| C8 | Each area page takes over its tool's front end through that tool's API, keeping one small "Open in …" link. |
| C9 | Stack stays FastAPI, SQLite and plain browser modules, with the existing release gate and rollback. |
| C10 | Order: records → shell → Workshop → Network → Backups → Documents → Media → Devices. |

## Piece 1: records (specified in full here)

### The things

| Thing | Designated source | Notes |
|---|---|---|
| `printer` (X2D) | Bambuddy API | pi-status's X2D field is no longer read for state |
| `camera` | the Pi's camera failover `/x2d/health.json` | reports which bridge is serving, and why not when none is |
| `workshop_display` | pi-status | |
| `pc` | NETMON probe for the PC | "on" means it answers on the network |
| `local_ai` | Local AI's own status | a problem *on* the PC, not a reason to call the PC off |
| `pi` | pi-status and `/proc` | temperature, disk, services |
| `movies_drive` | pi-status, drive checks | includes the reliability history now shown on Media |
| `movie_copy` | the copy job's state | |
| `internet` | NETMON probes and Orbi reader | router, line, wider internet, name lookups |
| `adguard` | AdGuard API | |
| `backups` | Backrest, per machine (Pi, Mac) | age of last good backup |
| `plex` | Plex | what's playing |
| `devices` | Homebridge | one thing per device, not per switch (see Devices) |
| `paper_printer` | CUPS | |
| `weather` | Open-Meteo and NWS | |

### The record

| Field | Meaning | Example (printer, 02:03) |
|---|---|---|
| `id` | the thing | `printer` |
| `state` | one word from that kind's fixed list | `printing` |
| `headline` | one line in plain words | "Printing HEX_TILE_v72, 12%" |
| `cause` | for attention or problem: why, in words; else empty | "Stopped at 1:31 after 10 min; the printer gave no reason" |
| `severity` | `ok` · `info` · `attention` · `problem` | `ok` |
| `since` | when `state` last changed | 01:36 |
| `as_of` | when the source last answered | 02:03:12 |
| `source` | where it came from | `bambuddy` |
| `stale` | `as_of` older than that source's limit | false |
| `actions` | what can be done now, each with a name, a label and whether it needs confirming | pause, stop |
| `detail` | kind-specific fields | job name, progress, time left, nozzle and bed (actual and target), lab experiment if any |

Each kind of thing has a fixed list of states, defined in one place with the words used for them. `severity` is
derived from state and age by that kind's rules, not set by each page.

### Disagreements

When two sources answer differently about the same fact, the designated source wins for `state`, and the record
gets `cause` "pi-status reports no status; Bambuddy reports printing". A disagreement lasting more than 5 minutes is
an `attention` on the `hub` thing itself, so the owner sees that a source is wrong.

### Events

A change in `state` or `severity` writes one row to the existing `events` table, with the thing, the old and new
state, the cause and the time. A job that stops and restarts within 15 minutes with the same job name is recorded as
attempt 2 of the same job, not a new print.

Rules, phone alerts and quiet hours keep working from these events. Quiet hours change only whether a phone alert is
sent now.

### The loop

`events.run` (every 30 s) refreshes every thing once from `sources.py`, builds its record, compares it with the
previous one, and writes events. Records are kept in memory and in a `records` table, so a restart shows the last
known state, marked stale until the first refresh.

Existing debounce stays: a change must last two checks; the PC must be down 5 minutes.

### What reads records

| View | Today | After |
|---|---|---|
| Home / Now, wall | `now.build` from its own fetches | records |
| Needs you / Problems | `needs.build` | records with severity attention or problem |
| Help › Source responses | `freshness.snapshot` | records' `source`, `as_of`, `stale` |
| Alerts, What the hub noticed | `events` | events written from records |
| Search (later) | none | records, their actions, pages |

`GET /api/records` returns all records; `GET /api/records/stream` sends each change as a server-sent event.

## Piece 2: the shell (own spec)

Sketch (desktop on the left, phone on the right):

```
┌──────────┬───────────────────────────────┐   ┌──────────────────────┐
│ Pi Hub   │ [⌘K  Search or do anything ] │   │ [ Search or do… ]    │
│ Now      │ NOW                           │   │ NOW                  │
│ Workshop │ X2D v72 12% [camera] ⏸        │   │ X2D v72 12% [cam] ⏸  │
│ Documents│ Light on 100% [turn off]      │   │ Light on [off]       │
│ Media    │ PROBLEMS (2)                  │   │ PROBLEMS (2)         │
│ Network  │ ● Display offline · since …   │   │ ● Display offline    │
│ System   │ ● AdGuard not answering [fix] │   │ ● AdGuard down [fix] │
│          │ SINCE YOU LAST LOOKED (8)     │   │ SINCE 12:00 AM ▸     │
│          │ 1:36 v72 restarted …          │   │                      │
└──────────┴───────────────────────────────┘   └──────────────────────┘
```

- **Now:** records that are active (printing, playing, copying) or unusual (a light on at night). One line for the
  rest: "All else OK: internet, backups, drives, PC".
- **⌘K:** searches records, actions, pages and documents. A result either acts (confirming risky actions) or opens a
  page. "Ask…" hands off to the Assistant, which leaves the rail.
- **Problems:** records with severity attention or problem: cause, duration and action. No setup nags.
- **Since you last looked:** events since this browser's last visit.
- **Menu:** Now, Workshop, Documents, Media, Network, System. Phone: bottom bar with More.

## Pieces 3–8: area takeovers (each its own spec)

| Area | Tool (stays the backend) | The hub's page does |
|---|---|---|
| Workshop | Bambuddy, print lab | current job with lab experiment and build; camera; nozzle and bed against target; pause, resume, stop, clear plate; queue; history with stop reasons and attempt chains; spool weights and AMS; a shortfall warning before a job; "Record verdict / failure" running the `lab exp` steps |
| Network | AdGuard, NETMON, Orbi | ad blocking on, off, pause; clients; latency charts from Prometheus |
| Backups | Backrest | snapshots for the Pi and the Mac; restore a file or folder, confirmed |
| Documents | Paperless | search with previews; open, download, tag; scan into the inbox |
| Media | Plex | library; play on a chosen client; movie night on its own sub-page; drive warnings as problems, not at the bottom |
| Devices | Homebridge | one card per device; the dishwasher as one card with a program picker |

Each keeps a small "Open in …" link.

## Errors

- A source that stops answering is itself a problem with a cause ("Bambuddy not answering since 2:10"). Things that
  rely on it show their last record, stale, with its age.
- A failed action shows the tool's error in words on the card and offers retry. Stop print, restore and restart always
  confirm first.

## Testing

- **Record tests (pytest):** recorded source replies in, expected records out. They include the night of 26–27 Oct:
  - Bambuddy printing while pi-status has no status gives `printing`, plus a disagreement cause.
  - The PC answering while Local AI doesn't gives `pc` on and `local_ai` problem.
  - A stop at 1:31 and a restart at 1:36 of the same job give attempt 2, and two events.
  - A stop during quiet hours gives an event and a held phone alert.
  - A source silent past its limit gives a stale record, unchanged state.
- **No contradictions:** for each case, Now, Problems, the wall, the timeline and the area page are built and checked
  to agree.
- **Browser:** the existing wall check extended to the shell at 390 px, tablet and desktop: no sideways scrolling,
  ⌘K by keyboard, a live update arriving without reload.
- The release gate (pytest and node tests before install, rollback on failure) is unchanged.

## Rollout

1. **Records** ship behind today's pages; the pages switch to them one at a time. No visible redesign; the
   contradictions stop.
2. **The shell** ships at `/next`. The owner uses it for some days; the wall can switch to it.
3. When `/next` covers what the owner uses, it becomes `/`. The old pages are removed in a later release, so that
   step rolls back on its own.
4. Each area takeover ships at `/next/<area>`, then swaps in the same way.

## Open questions for the piece specs

- Bambuddy: whether its API exposes the printer's stop reason or error code (needed for history with reasons).
- Plex: which clients accept remote "play on" from the Pi.
- Backrest: whether its API restores to the original path or only to a download.
- Whether the print lab's `lab exp` steps run on the Pi or must call the Mac.
