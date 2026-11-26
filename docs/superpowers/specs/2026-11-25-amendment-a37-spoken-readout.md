# Amendment A37: The page says its reading; Needs you and lists are rows on one grid

Date: 2026-11-25 · Status: **proposed** (approved when the owner merges this PR) · Amends:
- **A7** (`2026-11-04-amendment-a7-one-page.md`): **P1** (the page anatomy's title and one-line purpose, and the
  faceplate's readout), **P2** as drawn (a Needs-you item is a box), **P3** (a row's lamp on the right).
- **A8** (`2026-11-05-amendment-a8-home-dashboard.md`): **D3** (the rack's lamp on the left and its warn wash; each rack
  row's own layout).

Builds on: A10 (layouts flow), A22 (one name per page, from the page list), A33 (decisions are their own group), A36
(asks and Heads up; approved, merged at `a248214`, not yet built: `hub/needs.py` has no `kind`).

Leaves unchanged: the shell and the strips (A6, kit 2.29); the Today band (A8 D1, A9, A11); A8 D2 (Needs you first,
Systems beside it); A36 in full (where this and A36 differ, A36 wins); `/wall`; the Workshop display; the kit's colours,
typeface and tokens; the page's width cap (A10 D3).

The design is the kit's spec, `appliance-ui/docs/superpowers/specs/2026-11-25-spoken-readout-design.md`
(https://github.com/azmusgb/appliance-ui/pull/58, proposed). This amendment states what that design changes in the
baseline and what Pi Hub must do; it does not restate the design. If that spec changes before it merges, this text
follows it. Neither is approved by the other: both PRs must merge before step 2 below starts.

Read on 25 Nov 2026: pi-hub `61a824e`, live at 390, 1024 and 1440 px; appliance-ui `ed87d83` (kit 2.31.3). The owner,
that day: the design is for the owner alone on an iPhone, an iPad and a laptop; "go as far as you recommend"; "Yes,
write it up" to the mockup; then "draft pi hub amendment". Under the frozen baseline that is a proposal until this PR
merges; nothing here is built by being said.

## Why

Seen on the live hub on 25 Nov (the kit spec's "Why" has the detail):

1. **The answer comes late on a phone.** Home's first screen at 390 × 844 is three boxes of text; the printer, 45%
   through an 11-hour print, and its Pause button are below the fold.
2. **The page head reports nothing.** "Home / Your home at a glance" takes the top of every page and never changes.
3. **Everything has the same weight,** and each of Home's rack rows has its own columns (`home-dashboard.css`).
4. **The accent does five jobs,** against the contract's "nothing else": meters and the nav's count badges are teal.
5. **Raw detail is read first.** E-028's item shows the plan checker's output. A7 finding 5 and A8 finding 2 named it.

## Goals, non-goals, anti-goals

Goals: on each device the first screen says the state and offers the step; one loud element per page, and it carries
information; the accent means "you can act here".

Non-goals: new pages, sources, routes or stores; new colours or type; what counts as an ask (A36); the band's drawing.

Anti-goals (a failure even if it works): a sentence that states what the hub did not just read as if it had (a stale
reading in the present tense, a down source as fine, "Nothing needs you" over an unread list); wording that varies for
the same state; a page whose name assistive tech can no longer find; the same reading drawn twice on one page.

## Decisions

**R1. The head is the reading (amends A7 P1).** A page with a reading opens with one or two sentences that state it,
in the kit's readout face, as the page's `h1` (`ui-say`). The static title and the one-line purpose are no longer drawn
on that page. The page's name stays in `document.title`, in the strip's current entry and as a visually hidden label
inside the `h1`; its purpose stays in the palette and the Site map. A22 is unchanged: the name still comes only from
the page list. A page with no reading (Settings, Site map, Privacy, a form page, any page not yet moved) keeps
`ui-page__title`, without the purpose line. Search and the Assistant button sit in a row above the head.

**R2. The kit writes the sentence; Pi Hub supplies facts.** The words come from the kit's `say.js`, from a structured
reading (`live`, `stale`, `unavailable`, `unknown` or `loading`, with its age and source). Pi Hub maps its own data
into that shape (the Printer's from `/api/now`) and never writes sentence text in a page or on the server. Stale is
past tense with its age and names the source; unavailable and unknown use the phrase table; loading is a skeleton,
never text. The kit spec's S2 has the rules and Home's and Printer's sentences.

**R3. Home's sentence counts what Home draws.** Home passes the number of rows its Needs-you renderer drew, so the
sentence, the list and the badge cannot disagree. After A36 P2 that is the asks. Part unread and no asks: "Nothing
needs you here." and "Local AI wasn't read." (A36 D7). No asks and open decisions (A33): "{N} decisions are waiting."
The whole list unreadable: "Couldn't read what needs you."

**R4. The faceplate is the plate (amends A7 P1).** It stays the page's one panel. On a page with a sentence it drops
the big readout and caption and keeps the nameplate and lamp, the job and its age, the meter, the readings and the
actions. Home draws it only while something runs or is held; idle, the sentence says so. While Home's plate shows the
printer, the X2D's row in Systems drops its figure. The meter's fill is `text`, not `accent`.

**R5. Needs you is rows (amends A7 P2 as drawn).** An item loses its box: a tone bar, the title, one plain line, the
meta line and its action, separated by rules. Technical text moves behind a closed "Details" when the item carries
`more`. The first ask's action is the page's primary when there is no other. Heads up is A36's, drawn as the same row
with a muted bar and no button, collapsed on Home (A36 D6). Decisions, Acknowledge and the unread and error states
keep their behaviour.

**R6. Lists share one grid (amends A7 P3 and A8 D3).** Every lamp row is: name with its lamp · one line · an optional
figure, right-aligned. The lamp follows the name in every list, Home's included, and Home's warn wash goes. Names
still line up down a list, which was P3's reason. A row with no number shows no figure, never a dash or a zero. Home's
rack is drawn with the kit's row and `home-dashboard.css`'s rack rules are deleted.

**R7. The accent only acts.** The nav's count is a bare number in the `warn` colour, not a teal pill. What it counts is
A36 D6's rule (asks only), so System stops counting unread alerts. An ask with an `area` badges that area and Home; one
without badges Home (`navigation.js`). Links keep `accentText`.

## What Pi Hub changes

- `hub/static/js/page-parts.js` and each page's module: the head (R1), the plate (R4).
- `hub/static/js/home-dashboard.js`, `home-dashboard.css`: Home's sentence, the plate, the rack on the kit's row (R3,
  R4, R6).
- `hub/static/js/navigation.js`, `control-room.js` (`problemsBadge`): the badge per area (R7).
- `hub/needs.py`: pass an item's `more` through (R5). Local AI's `/api/needs` writes a plain `detail` and moves the
  checker's output to `more` for lab items, in its own PR.
- No new route, store, page or key. Nothing here touches Caddy, the release scripts or recovery.

## Migration

One PR per step, each naming this amendment and stating full or partial coverage.

1. **appliance-ui, kit release one (additive):** `say.js`, `ui-say`, the row figure, the faceplate without a readout.
   Pages that have not moved look the same after the sync.
2. **Pi Hub pilot: Printer** (`/workshop`), after the kit sync. It needs nothing from A36.
   **Gate:** the owner uses the live page on the phone, the iPad and the laptop, then says go or stop. Stop reverts one
   page and ends this amendment's rollout; R5 to R7 are then not built.
3. **appliance-ui, kit release two (the restyle):** Needs-you rows, the meter's fill, the badge, with measured contrast
   rows and `DESIGN.md` updated.
4. **Pi Hub: Home,** once A36 P2 (`kind`, asks-only `count`) is live; then the remaining pages in the rail's order, one
   PR each. `more` (R5) is one Pi Hub PR and one Local AI PR, any time after step 3.
5. **Local AI's own pages,** the same way.

## Evidence required (completion criteria)

1. `tests/`: the Printer's mapping from `/api/now` to the kit's reading for printing, paused, finished, failed and
   idle, and for a stale, a down and a never-read source; Home's count equals the rows drawn, with Local AI unread and
   with the whole list unread; `more` passes through and a missing `more` draws no disclosure.
2. Browser, per moved page: the width sweep from 320 to 2560 px in dark and light with no overflow, clipping or
   overlap; axe with no serious or critical finding; keyboard only, focus kept across a refresh; the `h1` holds the
   page's name for a screen reader.
3. First screen, asserted: at 390 × 844 the sentence and either the plate's action or the first ask's action; at
   1024 × 1366 and 1440 × 900 the sentence, the plate and the first ask.
4. The live page after each release, read at the three sizes, with what was seen in the PR.

## Calls made while writing (the owner can overrule any)

1. The design lives in the kit's spec and this amendment points at it. Reason: the parts are kit parts; two full
   copies would drift.
2. The lamp-by-the-name row applies to every list, so P3 is amended, not only A8 D3. Reason: one row, one grid.
3. Home shows the plate only while something runs or is held.
4. With no asks and open decisions, Home says "{N} decisions are waiting", not "Nothing needs you".
5. Printer is the pilot and Home waits. Reason: Home depends on A36 P2; Printer depends on nothing.
6. A stop at the gate ends the rollout rather than continuing with R5 to R7 alone. Reason: the restyle was approved as
   part of this composition, not by itself.

## Left to the builder

The sentences for pages other than Home and Printer, within the kit spec's rules and shown in each page's PR; the order
of the remaining pages within the rail's order; how the badge's area map is built in `navigation.js`.
