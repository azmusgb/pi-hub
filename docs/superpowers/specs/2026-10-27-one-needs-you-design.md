# One Needs you: every printing signal in one list, drawn one way (design)

Written 27 Oct 2026; revised the same day after an independent review against the code (11 findings, all folded in).
Suite step 2 of the consistency critique, built on `2026-10-27-one-print-design.md` (prints have one identity) and
`2026-10-24-one-home-design.md` (D3: home.arpa names resolve away from home through Tailscale; D7: Needs you lives on
Home; D8: read, never copy; D9: Pi Hub and Local AI share the appliance-ui kit). It starts suite step 4 narrowly: the
first kit component both apps render.

## Intent

**Owner's words:** the list holds everything; push only what's urgent ("proceed as recommended", option 2); tapping a
lab item opens Print lab's verdict form for that experiment (option 1); one look and behaviour across the suite ("all
under a solution umbrella re design/layout/css").

**Success:**
- A failure Obico detects, a failed print or HMS stop/pause, and the PC going off while a print runs each reach the
  phone within a minute, past quiet hours, **once**, from **one** sender, and tapping the notification opens the right
  page at home or away.
- Judge the print, approve or drop, send to the printer, fix the plan, AMS notices and Obico warnings appear in Needs
  you on Pi Hub (Home, iPad wall, desk) and Local AI's Home, without a push, each exactly once.
- A Needs you item looks and behaves the same in both apps: one item shape, one kit renderer, one phrase table.

**Not in scope:** filing outside-the-lab prints; Local AI's wider move to the kit (suite step 4 proper); Print lab's
own multi-action needs card (it keeps its Approve/Drop, Judge/Add photos and command box); the Workshop display.

## Facts this design rests on (checked 27 Oct 2026; file:line from the review)

- **Pi Hub Needs you** (`hub/needs.py`): hub record problems with ids `"pi:" + key` for `source:` keys else
  `"pi:" + what` (`:33`); Local AI cards from `https://10.0.0.21/api/display/feed` prefixed `localai:`, `warning`→`warn`,
  `kind=="home"` dropped, every link forced to `tool:assistant` (`:40-46`); `_one_row` folds non-hub items naming
  printer/x2d/bambu into the hub's printer row (`:17-23`). Quiet hours already let `urgent` through (`events.py:136`);
  `events.push` has no click link and uses priority `default` (`:134-155`). Automation rules already fire on
  `print_failed` and `pc_down` (`events.py:324-353`). Printer record states: printing, paused, finished, failed, idle,
  offline, unknown (`records.py:25`). Pi Hub already loads `ui/components.css` (`index.html:87`).
- **Local AI:** `/api/display/feed` is the Workshop display's feed: titles cut to 24 and text to 90 characters, tones
  `warning|busy|info|ok` (`app/display-feed.js:5-8`). It already carries a lab judge card `judge-<run>` (tone attention,
  24 h expiry; `app/print-lab.js:78-90`), which Pi Hub lists. Local AI's Home shows Pi Hub's items via
  `app/pi-hub.js` (`hubPath` keeps only hub paths, `:45-51`), and `needs-you.js:60-62` routes `localai:(judge|lab)-`
  ids to Print lab. Local AI loads no kit file (`index.html` links only `/app.css`).
- **print-lab** `page.json` `needs` (`lab/page_index._needs`): one per experiment, `{id, urgency, action, why, command,
  due_at}`; the page shows urgency < 3 plus "Fix the plan". Print lab hides "Judge" until `due_at` or the printer
  reports finished (`print-lab.js` `needView`). Print lab opens `#printLab?e=<exp>`; no project parameter, no link to
  the verdict form; the verdict sheet works on the experiment's current run (`exp.run`).
- **Bambuddy:** `GET /api/v1/obico/printer-status` → `per_printer: {<id>: {class: safe|warning|failure|error|unknown,
  score, frame_count, error}}`; printer status `hms_errors: [{code, module, severity 1 stop|2 pause|3 notice, ...}]`.
  Today Obico reports "Failed to capture snapshot" until the X2D's external camera is set (printer settings; the
  print-lab key can't change it, 403).
- **Kit** (`~/dev/appliance-ui`): `build.mjs` writes a fixed file list; `appliance-header.js` is a classic IIFE, and
  `.lite` means links-only for the Workshop display's flash portal; the contrast gate checks **token pairs**
  (`build.mjs:17-45`); `tokens.css` sets `color-scheme` and the font on `:root`; four apps consume the kit
  (`sync.mjs --status`); 1.2.1 is unsynced pending Pi Hub's lock step.

## Decisions

| # | Decision |
|---|---|
| N1 | Printer-side signals are **Pi Hub records** (source Pi Hub, detail names Bambuddy). Lab signals come from **Local AI's new `GET /api/needs`**, not the display feed. Nothing is copied. |
| N2 | One **item shape** for every Needs you item, defined in the kit (`needs.schema.json`). |
| N3 | One **kit renderer** for Home-style Needs you lists in both apps: `.ui-need`/`.ui-needs` CSS and one classic `needs.js` (sets `window.ApplianceNeeds`, `module.exports` for Node tests). No lite build. |
| N4 | One **phrase table** in the kit for action labels and "isn't answering". |
| N5 | **Urgent** (pushed now, past quiet hours, priority high): Obico `failure`; printer record `failed`; HMS severity 1 or 2; PC (Local AI record) down ≥ 2 min while the printer record is `printing` or `paused`. Everything else is list-only. `urgent` never changes how an item looks. |
| N6 | **Pi Hub is the only sender** for printing pushes. One push per occurrence of an item id: on appearing, never on clearing, again only after it has been clear for 10 min; kept in the hub DB (survives restarts). Reports of one failure within 2 min (printer `failed` + Obico `failure`) are one push. Existing rules on `print_failed`/`pc_down` keep their non-push actions; their push is skipped while an N6 occurrence for the same cause is open. Bambuddy's own notifiers stay off for print and Obico events (the owner keeps "Household ntfy (Pi)" disabled). |
| N7 | A lab item opens `#printLab?p=<project>&e=<exp>&do=judge` (judge) or `#printLab?p=<project>&e=<exp>` (others). `do=judge` opens the verdict sheet on the experiment's current run when a verdict is due, else just the experiment. |
| N8 | Lab items appear **once**: Pi Hub replaces the display feed's `judge-*` card with `/api/needs`; Local AI's Home shows its own lab items and drops Pi Hub's copies (source "Print lab"). |

## The item shape (N2)

| Field | Rule |
|---|---|
| `id` | Pi Hub records: the existing rule (`"pi:" + key` / `"pi:" + what`), HMS per code `pi:source:hms:<code>`; lab: `lab:<project>:<exp>` |
| `source` | owner of the fact: `Pi Hub` · `Print lab` |
| `tone` | `bad` · `attention` · `warn` |
| `title` | ≤ 80 characters |
| `detail` | one sentence, ≤ 200 characters |
| `action` | `{label, link}` or null; at most one; `label` from the phrase table; `link` is a same-origin path, `#…`, or `tool:<name>[/path]` |
| `urgent` | bool |
| `as_of` | ISO time the fact was read (lab: the index's `generated_at`) |

## The kit renderer (N3, N4)

- `ApplianceNeeds.render(item, {resolve})` → one element; `renderList(items, {resolve, empty})`. Text via
  `textContent`. `resolve(link)` is the app's own resolver (Pi Hub `resolveLink`/`toolUrl`, Local AI's equivalent);
  the renderer accepts the resolved link only if it is same-origin, `#…`, or the origin the resolver produced for a
  `tool:` link; otherwise the item renders without an action. "↗" when the resolved origin differs from the page's.
- Look: 4 px tone stripe; title, then detail (muted, `--ui-fs-2`), source and "as of" when older than 24 h
  (`--ui-fs-1`); one action button, right on wide layouts, below the text under 600 px; 44 px targets; titles wrap,
  never cut mid-word.
- Tokens: `bad` `--ui-bad`, `attention` `--ui-warn`, `warn` `--ui-text-2`. Contrast gate gains pairs: each stripe vs
  `--ui-surface` ≥ 3:1, title and detail vs `--ui-surface` ≥ 4.5:1, light and dark.
- `build.mjs` learns to emit `needs.js`, `needs.schema.json` and `phrases.json`; tests cover them.
- Phrase table: `judge` "Judge the print", `approve` "Approve or drop", `send` "Send it to the printer", `fix_plan`
  "Fix the plan", `look` "Look at the printer", `open_bambuddy` "Open Bambuddy", `check_pc` "Check the PC",
  `not_answering` "{name} isn't answering".
- Kit 1.3.0 includes 1.2.1; it syncs into Pi Hub and Local AI only (Materials and Workshop OS stay on their version).

## Pi Hub: printer-side signals (N1, N5, N6)

- **Records**, added to `KINDS`/`SOURCE`/`STALE_AFTER`:
  - `obico` from `bambuddy.obico_status()` (hub key, 30 s): `failure` → bad, urgent, "Failure detected on the X2D",
    action `look` → `/workshop`; `warning` → attention, "Possible print problem"; `error` while printing → attention,
    "Failure detection can't see the printer" (detail: Bambuddy's error); otherwise no problem.
  - `hms` from the printer status `hms_errors`: the record holds the list; `needs.py` emits one item per code
    (severity 1–2 → bad, urgent, action `open_bambuddy`; 3 → warn).
  - `pc_printing`: derived from the printer and Local AI records as N5 says; bad, urgent, "The PC is off during a
    print", detail "Failure detection has stopped until it's back.", action none.
  - The existing printer record's `failed` state becomes urgent.
- These are hub records, so `_one_row` leaves them alone (it folds only non-hub items).
- **Push:** `events.push` gains `click=` (the resolved gate address; home.arpa names work away from home per D3) and
  `priority="high"` for urgent. N6's occurrence table: `push_occurrences(id, first_seen, pushed_at, cleared_at)`.
- Bambuddy silent: the existing "Bambuddy isn't answering" problem replaces printer-side items; never pushes.

## Local AI: lab signals (N1, N7, N8)

- New `GET /api/needs` (same auth as the feed): items in the shape for every project's stored lab index:
  - from each index's `needs`, keeping the page's rule (urgency < 3, or "Fix the plan"); Run the check/build excluded;
  - tone: judge → attention, approve → attention, send → warn, fix the plan → warn;
  - "Judge the print" only once due (the page's `needView` rule: `due_at` passed or the printer reports finished);
  - `title` "<exp>: <phrase>", `detail` the need's `why`, `as_of` the index's `generated_at`, `urgent` false.
- Print lab reads `p=` (project) and `do=judge` (N7).
- The display feed and its `judge-*` card are unchanged (the Workshop display keeps them).
- Local AI's Home renders its own `/api/needs` items and drops Pi Hub items whose source is "Print lab"; its
  `needs-you.js` routing uses each item's `action.link` instead of id patterns.

## Pi Hub: showing lab items (N8)

- `needs.py` reads `/api/needs` (cached 30 s, alongside the feed), passes items through in the shape (ids and links
  kept; links as `tool:assistant/#printLab?...`), and drops the feed's `judge-*` cards.
- `sections.js` `resolveLink` keeps the path and hash after `tool:<name>/`.
- Local AI down: lab items are absent and "Local AI isn't answering" shows (with `pc_printing` urgent if a print is
  running). This is expected: lab needs come from the Mac via the PC.

## Rendering (N3)

- Pi Hub: Home's Needs you, the iPad wall and desk layouts render with `ApplianceNeeds`.
- Local AI: Home's Needs you renders with `ApplianceNeeds`. It loads `ui/tokens.css` and `ui/components.css` **before**
  `/app.css`, so Local AI's own `:root` settings still win; a browser check confirms no visual change outside Needs you.
- Print lab's own needs card keeps its multi-action layout (not in scope).

## Errors

- A silent source shows one "<name> isn't answering" item; its last items are not kept.
- An item whose link fails the renderer's check shows without an action.
- A failed push is logged; the next occurrence tries again; never a retry loop.
- Lab items older than 24 h show "as of <date>" so an unsynced Mac is visible.

## Testing

- Kit: render per tone; "↗" only for another origin; escaping; link check (same-origin, `#`, resolver origin; others
  dropped); empty state; contrast pairs; schema validates sample items from both apps; build emits the new files.
- Pi Hub: Obico classes; HMS per code and severity; `pc_printing` after 2 min only, while printing or paused;
  printer `failed` urgent; one push per occurrence across restarts; one push for printer `failed` + Obico `failure`
  within 2 min; rule pushes skipped while an occurrence is open; `click` and priority high; lab items passed through
  once; `judge-*` feed card dropped; `resolveLink` keeps `/#printLab?...`.
- Local AI: `/api/needs` from two projects; judge not before due; Run the check/build excluded; `p=`/`do=judge`
  opens the verdict sheet (browser); Home shows lab items once; kit CSS loaded before `app.css` with no visual change
  elsewhere (browser).

## Rollout: three plans, in this order

- **Plan A, Pi Hub urgent push:** the `obico`, `hms` and `pc_printing` records; printer `failed` urgent; `events.push`
  `click`/priority; the occurrence table; rule-push suppression. Independent and highest value. Obico items wait on
  the external camera.
- **Plan B, kit 1.3.0 and rendering:** schema, renderer, phrases, contrast pairs, build; sync into Pi Hub and Local
  AI; both Homes (and Pi Hub's wall and desk) render with it.
- **Plan C, Local AI lab needs:** `/api/needs`, `p=`/`do=judge`, Pi Hub reading `/api/needs` and dropping `judge-*`,
  Local AI's Home de-duplication and link routing.
