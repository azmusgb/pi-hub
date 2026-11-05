# Workshop page flow — Plan

Date: 2026-11-04 · Status: approved; all four decisions as recommended (owner, "do these", 4 Nov 2026) · Baseline: `2026-11-01-platform-product-architecture-design.md`

**Goal:** `/workshop` answers "what is the printer doing, and does anything need me?" in the first screen, on the
phone and on the desktop. Everything else on the page is reachable but secondary.

**Fit with the baseline: no amendment needed.** §5.6 already says `/workshop` is "Workshop › Printer, with camera,
filament and history as sections of the page", and §5.1 gives the area a level-2 strip "Printer | Lab". §3 moves the
display out of the Fabrication domain (its pairing and state are System › Settings, §5.6 `/settings`, §7). Local AI's
state belongs to System › Health and the Assistant button (step 7.5's `pc_off` / `assistant_down`). This plan only
orders and trims the page to match those sections. If a decision below goes another way, that one becomes an
amendment.

## What the page is today (`hub/static/js/workshop.js`, pi-hub `cd9cc76`)

One column on the phone, in this order:

1. Printer band.
2. Camera.
3. Print lab & queue, which also restates where spools live.
4. Workshop display, which links to `http://10.0.0.124`, a raw address outside the registry.
5. Local AI.
6. Print history.
7. Filament.
8. Projects.

At the foot is "Open in Bambuddy ↗". On a 390 px phone the lab's judge item, the one thing that needs a person, sits
below two screens of status. The display and Local AI cards repeat facts owned elsewhere. When Bambuddy is down, four
cards say so separately.

A sibling PR, the 4 Nov UX fixes, already handles three things, and this plan builds on it rather than redoing it:

- unknown is shown as "No answer", never "Offline";
- one `source_down` line replaces the per-card repeats;
- one "Open in Bambuddy ↗" row replaces the duplicate links.

## Proposed layout

**Level 2 strip:** Printer | Print lab, per §5.1. It is the same strip component as System's (7.3), so `/workshop`
and `/lab` say where you are and switch with one tap.

**Printer page (`/workshop`), top to bottom:**

1. **Now:** the printer band (state, job, progress, time left) and the camera. Side by side on a desktop of 1024 px or
   more; stacked on the phone, with the camera at 16:9 and capped at about 40% of the viewport height so the next item
   stays in view.
2. **Needs you here:** only when something is waiting. It shows Clear the plate (when finished) and the lab's judge
   items, at most two lines each, with their action buttons (`/lab?p=…&e=…&do=judge`). It is hidden when empty, never
   an empty card.
3. **Materials:** the AMS trays and any spool running low, as one compact row. The full spool list is under
   "Filament" (5).
4. **This week:** a one-line print history summary (`weekPill`). It opens the full history section.
5. **More in the workshop:** native `<details>` sections, collapsed by default, holding Filament (full list),
   Print history (full), Projects, and the lab queue summary. Their open state is remembered per viewer in
   `localStorage`, with try/catch around it.
6. **"Open in Bambuddy ↗":** the registry's one row (7.6).

**Removed from Workshop:**

- **Local AI card:** Health and the Assistant button already carry it.
- **Workshop display card:** System › Settings › Workshop display owns it, and Health shows its status. The raw-IP
  link goes with it.

**Print lab page (`/lab`):** unchanged apart from the strip.

## States, each designed

| State | Now (1) | Needs you (2) | Below |
|---|---|---|---|
| Loading | Band skeleton, camera placeholder of the same size (no layout jump) | Hidden | Skeleton rows |
| Bambuddy down | One `source_down` line on the band ("Bambuddy isn't answering · last seen 12:40"); camera still live if its bridge is | Lab items still show (they come from Pi Hub's lab store) | Materials and This week say "No answer" once, as a single line; sections stay openable with last-known data marked by its age |
| Printing | Progress, layer, time left; camera first on the phone | Lab items only | Normal |
| Finished | "Done: clear the plate" with the owner-only Clear button (one control path, §6.2) | Clear the plate first | Normal |
| Idle | "Idle", last print and time | Hidden unless lab items | Normal |
| Camera off | The tile says the camera is unavailable and why (`liveview_off`), never that the printer is off (§10) | — | — |
| Signed out | Read-only band; no Clear button; lab items show without actions | — | — |

## Not touched

- **The 480×320 display (Workshop OS):** its own surface and firmware cycle (step 8).
- **The printer-control path** (`POST /api/printer/{action}`) and its guards.
- **Print lab's data and requests:** step 6 owns them.

## PRs

| PR | Delivers | Acceptance evidence |
|---|---|---|
| W.1 | Workshop strip (Printer \| Print lab) on both pages; the Local AI and Workshop display cards removed (with a test that Health and Settings still show them) | `node --test`: strip entries and `aria-current`; no `Local AI` or `10.0.0.124` in `workshop.js` |
| W.2 | The new order: Now, Needs you here, Materials, This week, More in the workshop (`<details>`); every state in the table above | `node --test` per state with stubbed records (loading, Bambuddy down, printing, finished, idle, camera off, signed out); Playwright screenshots at 390 and 1366 px for printing, finished and Bambuddy down; keyboard: Tab reaches the band's action, each `<details>` summary and the strip, with visible focus; `prefers-reduced-motion` turns off the progress animation; no horizontal scroll |
| W.3 | Owner check | The owner opens `/workshop` on the phone during a real print and after one finishes, and records "Workshop flow accepted" in `docs/operations.md` |

W.1 can merge first and on its own. W.2 depends on the sibling UX-fix PR.

## Decisions for the owner (recommendation first)

1. **Remove the Local AI card from Workshop.** Recommended. Health and the Assistant button carry its state, and §7
   gives Local AI's status to System. The alternative is to keep a one-line "Assistant: Ready" chip in the band.
2. **Move the Workshop display card off Workshop.** Recommended. §3 moves the display to Operations, and Settings owns
   pairing. The alternative is to keep a single line linking to Settings › Workshop display.
3. **Collapse Filament, history, Projects and the lab queue under "More in the workshop".** Recommended, with the open
   state remembered per viewer. The alternative is to leave them open on the desktop only.
4. **Projects stays on Workshop.** It holds the Bambuddy projects, the "Workshop project" sense of §9. Recommended to
   keep it in the collapsed group, not drop it.
