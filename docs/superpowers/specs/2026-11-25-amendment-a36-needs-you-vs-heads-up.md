# Amendment A36: Needs you lists only what the owner can act on; conditions that clear themselves are Heads up

Date: 2026-11-25 · Status: **proposed** (approved when the owner merges this PR) · Amends: one-needs-you (N2 item shape,
the `count`), baseline section 6 (Needs you is built from records) · Builds on: A7 (one page), A21 (forwarded
notices), A25 (every action reports the same way), A33 (decisions are their own group and stay out of the count).

Read on 25 Nov 2026: pi-hub at `29d633d`. The owner, looking at Home's "Needs you (3)" (a wind advisory, "Pi 72 °C",
and "E-028: Fix the plan"), asked how to acknowledge or act on them, then: "so there should be a differentiation of
needs me vs current advisory/alert or something?", and "y" to drafting this. Under the frozen baseline that is a
proposal until this PR merges; nothing here is built by being said.

## Why

"Needs you (3)" said three things wait on the owner. One did (E-028's plan check); the other two clear by themselves
and have nothing to press. The list mixes **asks** (a decision or step only the owner can take) with **conditions**
(true about the house right now, worth knowing, not the owner's move). The count then overstates what is waiting, the
owner looks for a button that isn't there, and a real ask sits among weather.

The data already half-knows: lab items carry an `action`, HMS alerts carry `ack`, decisions (A33) are answered by a
tap. Hub records like weather and Pi heat carry neither; `PAGE_VERB` gives some of them an "Open …" button that only
navigates, which reads as an action but is not one.

## Goals, non-goals, anti-goals

Goals: Needs you and its count hold only asks; every ask has the one control that moves it on; conditions show in a
quieter Heads up group, with when they started and, when known, when they end; a condition that goes on too long or
gets worse becomes an ask with a real step.

Non-goals: snoozing or muting conditions; notification changes (N5/N6 urgency and pushes are unchanged); new sources.

Anti-goals (a failure even if it works): a fault hidden because it was called a condition (a failed print, an HMS stop,
the PC off mid-print are asks); a Heads up group that can't be read shown as "all clear" (unread stays its own state,
as today's `unread`); an "Open …" link counted as acting on something.

## Constraints

- Every source keeps owning its facts; the split is decided where the item is built (Pi Hub `hub/needs.py`, Local AI's
  `/api/needs` for lab items), never guessed by a page from the title.
- One shape for both groups, so the kit, Home, Local AI's Home and the Workshop display read one list.
- Kit-only UI: the Heads up row is a kit variant (appliance-ui PR first, then sync). Keyboard and 44 px targets as N3.
- Unknown is its own state: an item whose class can't be told is an ask (fail loud, not quiet).

## Approaches

A. **One list, a `kind` field per item (recommended).** `kind: "ask" | "heads_up"`; `count` counts asks; the page draws
   asks under Needs you and the rest under Heads up. One route, small change to each reader, old readers keep working
   (they ignore `kind` and see the same items).
B. Two routes (`/api/needs` asks only, `/api/heads-up`). Rejected: two reads, two failure states on every page, and the
   Workshop display would need both.
C. Rank by tone only (keep one list, sort `warn` last). Rejected: tone is how bad, not whose move; a `bad` condition
   (internet down) still has no owner step, and a `warn` ask (fix the plan) does.

## Design (approach A)

**D1. The field.** Every item gains `kind`: `ask` or `heads_up`. `count` becomes the number of asks; a new
`heads_up_count` counts the rest. `unread` is unchanged.

**D2. What is an ask.** An item is an ask when the owner has a step that changes it:
- lab items (judge, approve, send, fix the plan), A33 decisions, HMS alerts (`ack`), the owner-fixable hub states
  already given an `action` (Obico blind → Open Bambuddy, Mac disk full → See usage), and urgent items (N5: printer
  `failed`, Obico `failure`, HMS 1–2, PC off while printing);
- a Local AI card whose kind has an Assistant page to act on (approvals); its other cards are heads up.
Everything else from records is heads up: weather alerts, Pi temperature and throttling, a slow or late backup within
its allowed age, release and freshness notes, "isn't answering" for a source that is not printing-critical.

**D3. Navigation is not an action.** `PAGE_VERB` links stay on heads-up rows as the row's link ("Open the network"),
not as an action button, and never make an item an ask.

**D4. Escalation.** A heads-up condition becomes an ask when it has lasted past its record's limit or reached a worse
state, with a step named: Pi throttled > 60 min, or ≥ 80 °C → ask, action "See what's running" (Local AI's ask
hand-off, as `_whats_using_it`); a backup past its allowed age → ask, action "Open Backups". The limits live beside
`STALE_AFTER` in `hub/records.py`. Weather never escalates (nothing to do).

**D5. Heads up rows.** Title and detail as now, plus "since HH:MM" and, when the source says, "until …" (NWS alerts
carry an end time). No button; the whole row may link to its page. Muted stripe (`--ui-text-2`), no badge.

**D6. Where it shows.** Pi Hub Home and the phone: Needs you (asks, with the count) first, Heads up collapsed to one
line ("2 heads up: Wind advisory, Pi warm") that opens on tap. Local AI's Home: same, from the same list. The Workshop
display shows asks only. The nav badge counts asks only. A33's Decisions group is unchanged (its own count, not in the
badge).

**D7. Empty states.** No asks: "Nothing needs you" even with heads up present. No asks and Local AI unread: "Nothing
needs you here; Local AI not read" (as today's unread line).

## Evidence required (completion criteria)

1. `tests/` unit: each D2 source builds with the stated `kind`; `count` counts asks only; an item of unknown class is an
   ask; D4 escalation at the limits (59/61 min, 79/80 °C).
2. Browser: Home with today's three items shows "Needs you (1)" (E-028) and one Heads up line with two items, at phone,
   tablet and desktop, light and dark; axe clean; keyboard opens Heads up.
3. Local AI's Home and the Workshop display read the new list (screenshots).
4. The live page after release shows the split for whatever is current (the PR lists what was seen).

## Calls made while writing (the owner can overrule any)

1. Heads up is **collapsed** by default on Home. Reason: the point is a short Needs you; conditions are one tap away.
2. Weather **never** escalates. Reason: no step the owner can take changes it.
3. Pi heat escalates at **60 min throttled or 80 °C**. Reason: 72 °C with past throttling (today) is worth seeing, not
   acting on; sustained throttling slows the hub's own work.
4. "Open …" navigation stays as a row link, never a button (D3).

## Left to the builder

The kit variant's markup, the exact limit constants per record, and the order of the readers' PRs.

## Migration

One PR per part, each naming this amendment and stating full or partial coverage: P1 appliance-ui (Heads up row variant,
phrases "Heads up", "since", "until"), P2 Pi Hub (`kind`, counts, escalation, Home), P3 Local AI (Home and display
readers; lab items set `kind: "ask"`). Readers that ignore `kind` keep working through P2, seeing every item as before.
