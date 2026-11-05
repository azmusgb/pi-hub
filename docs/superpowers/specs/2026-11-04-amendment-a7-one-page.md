# Amendment A7: One page

Date: 2026-11-04 · Status: **approved by the owner on 4 Nov 2026 ("Yes")**, from the prototype
https://claude.ai/artifact/9iRwv9Pe7zMabRZFKtec9V · Amends: the platform baseline
(`2026-11-01-platform-product-architecture-design.md`, sections 5.1 to 5.5 (how pages are drawn), 9 (terminology, as
applied to page text) and 10 (what a page shows when a source is down)).

## Why

The look (Faceplate, kit 2.5), the areas, the strips (A6) and the words (section 9) are settled. The pages still don't
read as one product. A walk through every Pi Hub page and the Assistant on 4 Nov 2026, at 1440 and 390 px, found:

1. **The Assistant is still a separate app.** `/assistant` answers "Page not found"; A4 (step 7a) has no plan yet. The
   Assistant draws its own rail, a "← Home" link, a "Needs you 5" pill and its own search.
2. **Pages invent their own layout.** Print lab opens on a "Control room" dashboard with all-caps labels and a READY
   badge; Automations opens with a marketing hero ("A house that explains itself / Try the idea. Trust the result.");
   Settings opens on a checklist; Health ends in a grid of 14 restart buttons.
3. **Needs you is drawn three ways.** Home: lamps inside a panel, with "Open" as an underlined link inside a button box.
   Assistant Home: edge cards with ↗. Workshop's "Needs you here": a third layout. The kit's `.ui-needs` (2.5) is used
   by none of them as designed. Titles are vendor text ("X2D: MQTT Command verification failed. Please update Studio…").
4. **Pages contradict each other.** Workshop shows "No answer" beside readings marked "checked now". Print lab says E-025
   is Printing while the printer is idle and Home asks the owner to judge it (the mirror is 12 h old; the page doesn't
   say why).
5. **Plumbing shows.** "mac_lab" in Home's Now; "/data/Metadata/plate 1" as the job; "27°C / 0°C" (target 0); versions
   named "Merge pull request #109 from azmusgb/docs/c1-accepted"; Workshop's "Materials" (retired, section 9: Filament);
   the Assistant's "System" page (section 9: Assistant status) and "Doing" tab (section 9: In progress).
6. **Two strip styles.** Pi Hub's strip is a segmented pill; the Assistant's is underlined; Settings' six groups are a
   sidebar.
7. **Repeats aren't grouped.** Alerts lists ten hot/cooled pairs one by one; Assistant Work lists the hourly health check
   24 times; Health's "Recent fixes" says "Sent." five times.
8. **Risky actions sit beside harmless ones.** "Restart the Pi" is one tile in the restart grid, styled like "Rescan
   the Plex library".
9. **States vary.** Some pages go blank while loading; a missing source can look like an empty list.
10. **The site map disagrees with A4.** It says the Assistant "opens in a new tab".

## Decisions

**P1 One page anatomy.** Every page, in Pi Hub and in the Assistant, is drawn in this order and nothing else:

```
 Title                                   Search ⌘K
 One-line purpose
 ─ strip (A6) ───────────────────────────────────
 [notice: only when a source is stale or down]
 ┌ Faceplate ─────────────────────────────────────┐
 │ nameplate · lamp                               │
 │ READOUT unit          (aside: camera, if any)  │
 │ caption                                        │
 │ readings: label / value …                      │
 │ actions                                        │
 └────────────────────────────────────────────────┘
 Needs you here      (this area's items; hidden when none)
 Sections            (at most six; the rest fold into More, A6 decision 7)
 Open in  Tool ↗ …   (A6 decision 12)
 Sources: name: state …                Site map
```

The faceplate is the only panel on the page (Faceplate F7): one per page, holding its one readout (F5). Sections are
headings and rows on the page, with no card. A page that is a form (Print, Make an automation) keeps the form as a
section.

**P2 One Needs-you list.** Home, each area's "Needs you here", the Assistant's Home and the wall draw the list with the
kit's `.ui-needs` (dense on the Assistant's Home). Each item: a plain title (section 9 and the phrase table), the
detail, `since … · area` as meta, and an action named by its verb: Judge it, Open printer, Open Network, See what's using
it. Never "Open" alone, never ↗ for a page in the shell. Vendor text (HMS, error codes) goes in the detail.

**P3 Rows put the lamp on the right.** A row is title and detail on the left, then lamp (dot and word), value and one
action on the right, so titles line up down a list.

**P4 One strip style.** Pages are an underlined strip (section 5.1), the same in both apps. Filters and Settings' six
groups (A6 decision 6) are chips.

**P5 Words.** No ids, paths, raw targets or merge titles in page text. Versions are named by the change, with the PR
number after (`Off-site backup accepted #109`). A temperature without a target shows one number. Section 9 names apply
on every page, including the Assistant's (Assistant status, In progress, Filament).

**P6 Repeats group.** The same alert, run or fix in one day is one row with a count and a time range ("The Pi ran hot,
then cooled down · 6 times · 4:29 AM–12:08 PM").

**P7 Risky actions ask first.** Health's fixes fold into a closed "Fixes" section. Each fix says what will happen and
asks inline before it runs; the confirm button repeats the verb, and the toast uses its past tense (Restart Plex →
"Restarted Plex"). Restart the Pi and Sign out use the danger button.

**P8 Every state is designed.** Loading: the faceplate and lists show kit skeletons, never a blank page. Stale mirror:
a warn notice above the faceplate saying how old and why (`mac_waiting`). Source down: the faceplate's lamp and the
sources line say which one, in the phrase-table wording (`pc_off`, `assistant_down`, `source_down`); a list from a down
source is never shown as empty. The Assistant's pages with the PC off show section 10's down state, with Pi Hub's
Needs-you list as of the PC's last answer.

**P9 The site map is drawn from the same list as the rail** and shows the Assistant's pages as pages in the shell.

## Not changed

The kit's look and tokens (Faceplate, 2.5), the areas, routes and strips (A6), A4's frame, origin and hand-off rules,
the display's screens. No page loses a feature; Agent World stays the Assistant's own.

## Delivery

A4's step 7a is a precondition for P1 to P8 on the Assistant's pages. Order, each its own PR through its repo's process:

1. **appliance-ui** minor: `.ui-page` anatomy classes (head, strip, faceplate, sources), the right-hand-lamp row (P3),
   the inline confirm (P7). Synced to Pi Hub and Local AI.
2. **Pi Hub, pages in place:** Home, Workshop, Print lab, then Documents, Media, Home & network, then System (Health's
   Fixes, Alerts' grouping, Versions' names, Automations without the hero, Settings' chips, Site map).
3. **Pi Hub, step 7a** (A4): `/assistant` in the shell.
4. **Local AI:** its five pages on P1 to P6 inside the frame; its own rail and "← Home" only when opened on its own (A4).

Plan: to be written with `platform-plan` as `docs/superpowers/plans/2026-11-04-one-page.md`.

Each Pi Hub PR is checked in the browser at 390, 1024 and 1440 px, dark and light, with axe over the pages it touches.
