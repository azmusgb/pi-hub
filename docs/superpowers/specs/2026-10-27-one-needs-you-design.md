# One Needs you: every printing signal in one list, drawn one way (design)

Written 27 Oct 2026. Suite step 2 of the consistency critique, built on `2026-10-27-one-print-design.md` (prints have
one identity) and `2026-10-24-one-home-design.md` (D7: Needs you lives on Home; D8: read, never copy; D9: Pi Hub and
Local AI share the appliance-ui kit). It also starts suite step 4 narrowly: the first kit component both apps render.

## Intent

**Owner's words:** the list holds everything; push only what's urgent ("proceed as recommended", option 2); tapping a
lab item opens Print lab's verdict form for that exact run (option 1); one look and behaviour across the suite ("all
under a solution umbrella re design/layout/css").

**Success:**
- A failure Obico detects, a printer error or HMS fault, and the PC going off while a print runs each reach the phone
  within a minute, past quiet hours, once.
- Judge the print, approve or drop, send to the printer, AMS warnings and Obico warnings appear in Needs you on Pi Hub
  (desk, iPad wall, phone) and on Local AI's Home, without a push.
- An item looks and behaves the same wherever it appears, because both apps render it with one kit component from one
  item shape, using one set of phrases.

**Not in scope:** filing outside-the-lab prints; Local AI's wider move to the kit (suite step 4 proper); Pi Hub
pages other than Needs you.

## Facts this design rests on (checked 27 Oct 2026)

- Pi Hub's Needs you (`hub/needs.py`) = the hub's own record problems + Local AI's cards from
  `https://10.0.0.21/api/display/feed` (`sources.localai_feed`, cached 30 s). Cards carry `id`, `kind`, `tone`,
  `title`, `text`; there is no action field yet.
- Pi Hub pushes through ntfy (`events.push(title, body, tags, priority, urgent)`; quiet hours hold back non-urgent).
- Bambuddy `GET /api/v1/obico/printer-status` → `{enabled, per_printer: {<id>: {class: "safe"|"warning"|"failure"|
  "error"|"unknown", score, frame_count, error}}, last_error}`. Today `last_error` is "Failed to capture snapshot for
  printer 1": detection can't run until the X2D's external camera is set.
- Bambuddy printer status carries `hms_errors: [{code, module, severity, actions, …}]`; severity 1 = error (stopped),
  2 = warning (paused), 3 = notification.
- print-lab's `page.json` (synced to Local AI) carries `needs: [{id, urgency, action, why, command, due_at}]`, built by
  `lab/page_index._needs`, and each experiment's `runs[]`.
- Print lab opens an experiment from `#printLab?e=E-022`; it has no link that opens the verdict form directly.
- The kit (`~/dev/appliance-ui`) ships `tokens.css`, `components.css` and `appliance-header(.lite).js`, synced into
  `hub/static/ui` and `app/public/ui` by `scripts/sync.mjs` with a `VERSION` pin; an edited copy fails its tests. Kit
  1.2.1 is unsynced, waiting on Pi Hub's lock step; this work ships as 1.3.0 and includes it.

## Decisions

| # | Decision |
|---|---|
| N1 | Each signal is read by the app that already owns it: printer-side signals by **Pi Hub** (always on, owns the printer record and push); lab signals by **Local AI** (holds the synced lab index and the verdict form). Nothing is copied. |
| N2 | One **item shape** for every Needs you item in the suite, defined in the kit (`needs.schema.json`). |
| N3 | One **kit component** draws it: `.ui-need` / `.ui-needs` CSS plus `renderNeed(item)` in `needs.js` (ES module) and `needs.lite.js` (plain script). Both apps render every Needs you item with it. |
| N4 | One **phrase table** in the kit for action labels and "can't reach" wording. |
| N5 | **Urgent** = pushed now, past quiet hours: Obico `failure`; HMS severity 1 or 2, or the printer's error state; the PC off while the printer is printing. Everything else is list-only. `urgent` never changes how an item looks. |
| N6 | One push per item **occurrence**: pushed when it appears, not when it clears, not again while it stays; the same id may push again only after it has cleared for 10 minutes. |
| N7 | A lab item's action opens Print lab's verdict form for that run: `#printLab?e=<exp>&run=<run>&do=judge`. |

## The item shape (N2)

| Field | Rule |
|---|---|
| `id` | stable per cause: `pi:printer`, `pi:obico:1`, `pi:hms:1:<code>`, `pi:pc-off-printing`, `lab:<exp>:<action-key>` |
| `source` | `Pi Hub` · `Local AI` · `Print lab` · `Bambuddy` (the owner of the fact, not the app showing it) |
| `tone` | `bad` · `attention` · `warn` |
| `title` | what's wrong, ≤ 80 characters |
| `detail` | one sentence, ≤ 200 characters |
| `action` | `{label, link}` or null; at most one; `label` from the phrase table |
| `urgent` | bool |
| `opens_elsewhere` | computed by the renderer: the link's origin differs from the page's (never sent) |

## The kit component (N3, N4)

- Layout: a 4 px tone stripe; title (one line on wide layouts, wraps on phone; never ellipsis-cut mid-word on the wall);
  detail below in `--ui-fs-2` muted; source in `--ui-fs-1`; one action button at the right that wraps under the text
  below 600 px. 44 px minimum targets. "↗" after the label when `opens_elsewhere`.
- Tones use the kit's `--ui-bad`, `--ui-warn` (attention), and a neutral warn; light and dark pass the kit's
  existing contrast gate, extended to `.ui-need`.
- `renderNeed(item, {here})` returns one element; text set with `textContent`, links only `https:`, `http:` on the LAN
  addresses in `suite.json`, or same-origin `#…`; anything else renders without an action. `.ui-needs` lays out a list
  with an empty state ("Nothing needs you.").
- Phrase table: `judge` "Judge the print", `approve` "Approve or drop", `send` "Send it to the printer",
  `fix_plan` "Fix the plan", `look` "Look at the printer", `open_bambuddy` "Open Bambuddy", `power_pc` "Check the PC",
  and `not_answering(name)` "<name> isn't answering".

## Pi Hub: printer-side signals (N1, N5, N6)

New hub records, read by the existing record loop and turned into Needs you items like the others:
- **`obico`** from `bambuddy.obico_status()` (`/api/v1/obico/printer-status`, hub key, 30 s):
  `failure` → bad, urgent, "Failure detected on the X2D", action `look` → Bambuddy; `warning` → attention, list,
  "Possible print problem"; `error` while printing → attention, list, "Failure detection can't see the printer"
  (detail names Bambuddy's `error`); `safe`/`unknown`/not printing → no item.
- **`hms`** from the printer status `hms_errors`: severity 1–2 → bad, urgent, title from Bambuddy's message or "Printer
  needs attention (<code>)", action `open_bambuddy`; severity 3 → warn, list. One item per code.
- **PC off while printing**, derived: printer record printing and Local AI's record down for 2 minutes → bad, urgent,
  "The PC is off during a print", detail "Failure detection has stopped until it's back.", action `power_pc` → none
  (no link).
- One row per printer cause: the existing `_one_row` rule keeps the printer record first; Obico and HMS items keep
  their own ids because they name different causes, but a single push covers a failure reported by several of them
  within 2 minutes (the printer's error state plus Obico `failure` is one event).
- Push: `events.push(title, detail, urgent=True)` with ntfy's `Click` set to the action link (the gate address), so
  tapping the notification opens the right page. N6's occurrence rule is kept in the hub's database (id, first seen,
  cleared at), so a restart doesn't re-push.
- Bambuddy silent: one item "Bambuddy isn't answering" (attention, list) replaces stale printer-side items; never
  pushes.

## Local AI: lab signals (N1, N7)

- `/api/display/feed` gains a card per entry of the stored lab index's `needs`, in the item shape:
  `id` `lab:<exp>:<action-key>`, `source` "Print lab", tone by urgency (0 judge → attention, 1 send → warn,
  2 approve → attention, fix the plan → warn), `title` "<exp>: <action>", `detail` = the need's `why`, `action` from the
  phrase table linking to `#printLab?e=<exp>&run=<last run>&do=judge` (judge) or `#printLab?e=<exp>` (others),
  `urgent` false. The lab's index being older than a day adds nothing new; its `generated_at` is kept as the item's
  time.
- Print lab honours `&do=judge`: opens that run's verdict form if it's open for a verdict, else just the experiment.
- Existing cards gain `action` where they have one; cards without it still render (action null).
- Pi Hub maps feed cards straight through (they're already in the item shape); its link resolution
  (`resolveLink`/`toolUrl`) turns `#…` links into the assistant tool's address.

## Rendering (N3)

- Pi Hub: Home's Needs you, the iPad wall and desk layouts render with `renderNeed`; the old per-page markup goes.
- Local AI: Home's Needs you (which already lists Pi Hub's items) and Print lab's own needs card render with
  `renderNeed` (lite build).
- Both apps load `ui/components.css` for `.ui-need` (Local AI's first use of a kit component).

## Errors

- A source that doesn't answer shows one "<name> isn't answering" item; its last items are not kept.
- An item whose link fails validation renders without an action, never as a broken link.
- Push failures are logged and retried by the next occurrence only; never a loop.

## Testing

- Kit: `renderNeed` markup per tone; "↗" only for another origin; escaping (`<script>` in title); link allow-list;
  empty state; contrast gate covers `.ui-need` light and dark; schema validates sample items from both apps.
- Pi Hub: Obico classes → items and urgency; HMS severities; PC-off-while-printing after 2 minutes only; one push per
  occurrence across restarts; several reports of one failure → one push; quiet hours bypass for urgent only; ntfy
  `Click` header; Bambuddy silent → one item, no push.
- Local AI: lab needs → feed cards in the item shape; `&do=judge` opens the verdict form (browser test); an old
  feed card without `action` still renders.
- Cross-app: the same sample item renders identical markup in both apps (shared fixture).

## Rollout (one plan, four parts, each usable alone)

1. Kit 1.3.0: schema, component, render helper, phrases; synced into both apps (no visible change yet).
2. Pi Hub: Obico, HMS and PC-off records with push. Useful alone; depends on the external camera for Obico.
3. Local AI: lab needs as feed cards and `&do=judge`. Pi Hub shows them through the existing feed.
4. Both apps render Needs you with the kit component.
