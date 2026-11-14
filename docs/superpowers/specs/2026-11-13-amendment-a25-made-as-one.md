# Amendment A25: Made as one

Date: 2026-11-13 · Status: **merged by the owner on 14 Nov 2026** (pi-hub #247). That approves the design and step 17
only; steps 18 to 21 are confirmed, changed or dropped after the owner's walk ("Approval record", below) · Amends:
the platform baseline (`2026-11-01-platform-product-architecture-design.md`) sections 4 (two derived fields, no
new object), 5.6 and A22 §2.2, §3.3 and §10 (History takes Alerts' place), 9 (three terms), 11 (steps 17 to 21) and
decision D7's note on a human log view; A7 P1 (a row that opens); A8 D1 (where "older than today" goes, and one line
on Home). Proposes kit changes that are made in appliance-ui, never here. Draft 3, after two rounds of review
("Review record", at the end).

## Summary, in plain words

A22 gives the house one menu, one page list, one set of colours and sizes, and one sign-in. That makes the sites look
like one site. It does not yet make them behave like one product: the same print is drawn five ways and can't be
linked to, every action reports back differently, and "what changed while I was away" has no screen.

This amendment adds that layer. It is built one real moment at a time, starting with the one the owner meets most:
**a print finishes**.

- **A thing can be opened.** A print, a system, a release, an experiment: each kind is named once, with one address
  and one row. Every mention of it is a link that lands on its page with that thing open.
- **An action reports the same way everywhere.** Its own button shows it was sent, then that it is done (and, where
  a device picks the request up later, that it is waiting for that device). Then it says what happened. If something
  about the same thing still needs the owner, that next step is offered right there.
- **One history.** One page answers "what changed", for the house or for one thing. Home gets one line that leads to
  it.
- **The shared parts, afterwards.** What the first steps prove (the opening row, the action button, the Next line)
  lives in the kit from the start. The open row comes with step 18. The wider clean-up (one toast, one sheet, one way
  to say a time, one icon set, and
  a check that keeps hand-built copies going down) comes last, and can be cut.

Nothing about the look changes. No new object, no new service, no new table. One stored value is added (when the
owner last read History). The Assistant stays on its own origin. The wall display opens nothing new; its Clear the
plate chip reports like every other.

**What is asked for now:** approval of the design, and of step 17 only (the print slice: one kit PR and four in Pi
Hub). Steps 18
to 21 are confirmed, changed or dropped after the owner has walked step 17 with a real print.

## What this is based on

Read on 13 Nov 2026: pi-hub at `98ac99c`, LocalAI at `00e0373` (through git only), the kit at `260e5f6` (2.21.0).
Paths are pi-hub's `hub/` unless they say otherwise. A count marked "about" was made by search and judgement; the
plan for each step recounts what it changes, file by file, before it starts.

### Prior designs this builds on, and does not restate

| Design | What it already decides |
|---|---|
| Baseline §2 | The four questions: what is happening, what needs me, what changed, what can I do |
| Baseline §4 | The objects, their owners and identities. A25 adds no object |
| Baseline §6 | The seven cross-system workflows and their targets |
| Baseline §8 | One palette, two providers; the result kinds; which actions confirm |
| `one-print`, `one-needs-you`, `control-room` | Bambuddy's log is the record of a print; one Needs-you list; records, actions and events |
| A7 | One page anatomy, one row style, repeats group, every state designed |
| A8 | Home is a dashboard; the Today band |
| A12, A13, A19 | Start a staged print, Ship and Merge, Quick print: each confirms in its own sheet, never from a notification |
| A22 | The frame, the page list, the values, the names |
| A24 (draft, not approved) | A live view and a last-print scrub on Workshop. If it is approved, a print's open row links to it; neither depends on the other |
| appliance-ui `DESIGN.md` | The look, the components, honest states; "a new shared pattern is added to this kit, never to one app" |

### Audit: one thing, many drawings, no address

| Thing | Separate drawings in Pi Hub | Can one be linked to? |
|---|---|---|
| A system (a Record: printer, backups, Plex, a release…) | 7 (`home-dashboard.js:381,713`, `control-room.js:183`, `health.js:693,778`, `versions.js:82`, `command-palette.js:96`) | No. `recordPath` gives a page, not the record (`control-room.js:69-74`) |
| A print | 5 (`workshop.js:1719,1809`, `home-dashboard.js:477`, the Today band, `lab.js:201`) | No. "Bambuddy print #id" links to Bambuddy's front page (`lab.js:199`) |
| A lab experiment | about 8 (`lab.js:369,403,417`, `lab-v2.js:137,209,336`, `lab-evidence.js:255`, `workshop.js:1928`) | Yes: `/lab?p=&e=` (`lab.js:1471,1541`) |
| A Needs-you item | 3 row markups (the kit's, `lab.js:369`, the palette's) | No |
| A quick print job | 1 | Yes: `/quick?j=` (`quick.js:355`) |

A Needs-you item's link goes to the thing's page, not to the thing (`now.py:104-107,134`). An item built from a
record says which record (`record`, `needs.py:141,145`). A lab item names no thing at all (`needs.py:64-96`), and no
item names a print.

### Audit: every action reports differently

| Action | Asks first | While it runs | Afterwards |
|---|---|---|---|
| Clear the plate (`printer-actions.js:22-41`, six callers) | Inline | Buttons disabled, label unchanged | Toast; the list refreshes and the row is gone |
| Lab verdict (`lab.js:875-914`) | Sheet | "Waiting for the Mac" in the sheet | "Recorded" in the sheet; the sheet stays open |
| Restart, from Health's row (`health.js:719-741`) | Inline | Button reads "Restarting…" | "Restarted" for 2 s, toast, no reload |
| Restart, from Health's Fixes (`health.js:1298,1412`) | Inline | A result panel: "Checking recovery…" | The panel, and a reload |
| Cancel a paper print (`print.js:80-87`) | **No** | Nothing | Toast, reload |

`DESIGN.md` already says an action has three steps (sent, accepted, done) shown on its control. Only the verdict
shows two of them. No action offers a next step.

Notifications lead nowhere useful. The "print finished" push is a rule push with no address (`events.py:65,94,190`);
so are reminders and the digest (`reminders.py:19`, `digest.py:79`). Only a failed print and a PC outage carry one,
to `/workshop` or `/` (`urgent.py:13`). The only link that opens a thing with an action ready is `do=judge` and
`do=start` on `/lab` (`lab.js:1544-1547`).

### Audit: "what changed" has no screen

- "Since you last looked" is not built. A8 D1 replaced it with the Today band and said "Anything older than today is
  on Alerts" (A8, line 36; `control-room.js:2-3`). Alerts lists pushes, not changes.
- `/api/records` returns the change events (`app.py:167`). No script reads them.
- History is shown in six partial places: Alerts, Health's Outages, Health's "Recent fixes", Settings' "Activity",
  Automations' two lists, Versions' "Pi Hub versions". No page shows one thing over time.

### Audit: patterns built by hand, twice

| Pattern | Pi Hub | The Assistant | The kit |
|---|---|---|---|
| A sheet or dialog | about 14 built by hand, no shared helper (`lab.js:542-639`, `core.js:932`, `now.js:578,994`, …) | `showSheet`, `ask`, `approvalSheet`, static dialogs | None (only the palette's own) |
| A toast | One, 4 s (`core.js:425`) | One, 6 s, pauses on hover (`components.js:199`) | None |
| A confirm | `ApplianceConfirm` | Its own `ask`; the kit's `confirm.js` is synced but not loaded | `ui-confirm` |
| A button | `ui-btn`, and hand-built `btn` beside it | No `ui-btn`; `btn-primary/outline/danger` 268 times | `ui-btn` |
| Saying a time | About 20 helpers. A duration reads "1 h 05 min" (`core.js:570`), "1 h 5 min" (`lab.js:95`) or "1h 5m" (`lab-v2.js:31`) | About 15 | One, inside `needs.js` |
| Icons | Inline SVGs, two small sets, emoji | One sprite of 45 symbols | None for the web |
| The page anatomy (A7 P1) | Every page | 4 of 27 views carry `ui-page` | `ui-page` |

Step 13 moves both apps onto the kit's values. No spec or plan says when the Assistant adopts the kit's components.

### Already decided, not finished (needs no amendment)

Owed under what is already approved. A25 depends on none of them and lists them so they aren't lost.

| Owed | Under | State |
|---|---|---|
| The Assistant's pages on the page anatomy, which is also what gives the two apps one type and spacing rhythm | A7 "Delivery"; plan `2026-11-04-one-page.md` L2 | 4 of 27 views |
| Find returns lab questions and experiments, lists, movies, alerts | Baseline §8.2 | Records, Needs-you items and documents only (`command-palette.js:96-123`) |
| "Search Papers for …" and "Search Movies for …" open the search | Baseline §8.2 | The links carry `?q=` (`command-palette.js:122,145`); no page script reads it. A defect |
| Ship and Merge a pull request from Needs you | A13 | Not built |
| The Needs-you schema file | Baseline §4 (`needs.schema.json`) | The kit has no such file; the shape is a comment (`src/needs.js:3`) |
| Steps 13 to 16 | A22 | 13 in progress (H9 and L5 open); 14 to 16 have no plan |

## 1. The rules

| # | Rule | Checked by |
|---|---|---|
| E1 | A thing is drawn by one function per kind. Every list of that kind uses it | A test fails when a kind in `things.json` has no row function, or two |
| E2 | A thing has one address (2.1). Every mention of it in Pi Hub is a link to that address | A browser test walks each kind on sample data: the address opens it, and each drawing carries it |
| E3 | Reading happens on the page; a sheet is only for a task. A thing opens in place, in one order: state, what needs you, what you can do, what it is connected to, what happened | A structure test on the open row |
| E4 | A link may open a thing with an action's ask showing. A link never runs an action, and a notification never carries one | A browser test per `do`: the ask shows, nothing is sent before the owner confirms, an action not on offer shows why |
| E5 | An action shows its steps on its own button, then says what happened in the past tense. The steps are the ones that action really has: sent and done for one the server answers at once (Clear the plate); sent, accepted and done where a device picks it up later (a verdict waiting for the Mac). `DESIGN.md` defines them so | A browser test per action with a held request, naming that action's steps; a failed one leaves "Try again" |
| E6 | After an action is done, if an item about the same thing still needs the owner, it is offered there. Otherwise nothing is added | The print walk (step 17) |
| E7 | An action has one verb: on the button, in the ask, in the toast and in History | A test compares the four strings to the verb table |

These apply to Pi Hub's pages. The Assistant takes E5 and E7 when its sections adopt the kit's parts (step 21). The
display is out of scope.

## 2. Things

### 2.1 The list

`things.json` in the kit, beside `pages.json` and proposed there the same way. It adds no object: it lists the
baseline §4 objects that are drawn in more than one place, and says for each who owns it, where it opens and what its
row shows.

| Kind | Baseline §4 object | Id | Opens on |
|---|---|---|---|
| `record` | Record, including `release:<target>` (a Release is a kind of Record) | The record's id as it is today (`printer`, `release:pi-hub`, `source:hms:123`) | Its page, from `recordPath` |
| `print` | Print | Bambuddy's print-log id. Not the unused `prints` table (`db.py:12`) | Workshop |
| `lab` | Lab experiment | `<project>:<experiment>`, so the whole reads `lab:<project>:<experiment>`, the id baseline §4 gives it | `/lab?p=&e=`, unchanged |
| `quick` | A19's quick print job | Its job id | `/quick?j=`, unchanged |
| `run` | Assistant run | Its run id | `/assistant/run/<id>`, as A22 §3.3 has it |

A pull request joins the list when A13 is built. Movies, documents, list items, paper jobs and spools are not kinds:
baseline §4 leaves them out because no workflow crosses systems on them. A Needs-you item is not a kind: it is about a
thing, and opens that thing.

### 2.2 The address: `?open=`

A `record` and a `print` open with `<page>?open=<kind>:<id>`. A `lab`, a `quick` and a `run` keep the addresses they
have; `?open=` with one of those kinds is accepted on any page and rewritten to that address, so a link can always
be written one way. The kind is everything before the first colon; the id is the rest, at most 120 characters
of letters, digits and `. _ : -`. Anything else is ignored. The id is only ever compared and shown as text.

It lands on the page that owns the kind, with that thing **open in place**:

- If the thing is the page's subject (the printer on Workshop, backups on Backups), the page opens at its top: its
  state and what it needs. That is the thing, open.
- Otherwise its row is scrolled to, opened and given focus. The rest of the list stays where it is.
- A thing that isn't in the list as drawn (an older print) is read by id and shown as the first row, marked as
  older.
- A thing that no longer exists gets one line in the same place ("This print is no longer in Bambuddy's log").
- Opening and closing a row, or following a "Connected to" link to another thing on the same page, replaces the
  address; it doesn't add a Back step. Back goes to the page you came from. Today a link that changes only the query
  adds a step and scrolls to the top (`main.js:300-306`); step 18's plan adds the router call that doesn't.
- In wall mode (`?wall`, on any path) `open=` is ignored. The wall is a board and opens nothing.

The address is a parameter and not a path (`/thing/print/123`): a path would add pages that compete with the ones A22
just counted, and a new route. The detail is in place and not in a sheet: `DESIGN.md` keeps sheets for a focused
task, a full-screen sheet on a phone is a page with a close button, a notification that opens a sheet leaves Back
with nowhere to go, and a task opened from a thing would be a sheet on a sheet.

### 2.3 The open row

One layout for every kind (kit: `ui-row` gains an open state with a `ui-thing` body), in E3's order:

```
 Hex tile v3                         Finished ●  2 h 14 min  ▴
   Today, 3:42 PM · [photo]
   Needs you       Judge the print                 [Judge it]
   You can         [Print again]    Open in Bambuddy ↗
   Connected to    Experiment E-025 · The printer
   What happened   3:42 PM  Finished
                   1:28 PM  Started
                   All history →
```

- A part with nothing in it isn't drawn. A source that is down says so in the phrase table's words, in place, and
  never shows as empty.
- "Connected to" holds links to other things (E2).
- "What happened" is this thing's last five rows of History (section 4), then a link to the rest. A print has no
  rows of its own: it shows its start and end from Bambuddy, and the printer's rows between them, and says so.
- It opens with the kit's `--ui-dur-2` and `--ui-ease`, and instantly under `prefers-reduced-motion`. It reflows by
  its own width (A10): no window breakpoint.
- A task started from it (Judge it) is a sheet over the page, as today. Never a sheet over a sheet.

### 2.4 What the server adds

No table, no store. Two fields, both built from joins that exist today.

| Field | On | Built from |
|---|---|---|
| `refs: ["<kind>:<id>", …]` | A Needs-you item | Where the item is built (`needs.py`). A record's item: `record:<id>`, which it carries today as `record`. The printer's item also names the print it is about, only while the record is `finished` or `failed`: the newest log entry already in Pi Hub's cache, used only if it isn't still printing and didn't end before the record's `since` (the cache can name the previous print for a minute, `recorder.py:26-29`). `/api/needs` never waits on Bambuddy for it. A lab item: its experiment, and the print when the print's name carries the experiment (`bambuddy.py:121`). The kit's item shape gains `refs` as optional, and the schema file the baseline names gets written |
| `related: ["<kind>:<id>", …]` | A record, a print | Printer → experiment (`things/printer.py:192`), print → experiment (`bambuddy.py:121`), run → print (`lab.js:203`). A release → its pull request only when A13 exists |

- When Bambuddy can't be read, the printer's item names `record:printer` only, and the print's part of the page says
  Bambuddy isn't answering. That is the likely state after a failed print, so step 17 tests it.
- A thing's "Needs you" and its Next line are the items whose `refs` contain it. Nothing is guessed in the browser.
- A print older than the twenty Workshop loads needs one new read, `GET /api/prints/<id>` (step 18), open on the
  home network as `/api/workshop` is today. Records need none. What a viewer who isn't signed in can see doesn't
  change: records and prints as today, lab
  things only for `household` and up (`lab.py:302`).

## 3. Flows

A25 designs no new workflow: baseline §6 has them. It makes three continuous, in this order.

### 3.1 A print finishes (step 17)

| Moment | Today | With A25 |
|---|---|---|
| The print finishes | A push with no address | The push opens Workshop. It carries no action (E4) |
| On arrival | Home, or wherever the app was | Workshop. "Needs you here" is first, as today (`workshop.js:1787`): "Done: clear the plate" |
| Not signed in on that browser | A password sheet appears when the button is tapped | "Sign in to clear the plate" beside the button, before the tap |
| Clear the plate | Inline ask, toast, the list refreshes and the row is gone | The same ask, with its consequence ("Bambuddy may start the next print in the queue"). The button shows "Clearing…", then "Cleared". The row stays, done, until the owner leaves the page |
| Bambuddy doesn't answer | A bad toast | The button says so and offers "Try again"; a notice stays beside it |
| A verdict is due | Find the experiment on `/lab`, or a separate Needs-you row | Under the done row: "Next: Judge the print", from the Needs-you item whose `refs` name this print or its experiment. It opens the verdict sheet |
| The Mac is asleep | "Waiting for the Mac" inside the sheet | The same words on the button (this action has an accepted step) |
| From Home | Home's own Clear buttons (`control-room.js:243`, `home-dashboard.js:540`) behave as Workshop's does today | The same button, steps and Next line: step 17 changes the one helper all six callers use, the wall's chip included |

Two things the plan for step 17 decides before code, because the Next line depends on them. The verdict item is held
back until the print is done or its expected end has passed (`needs.py:88`), so a print that ends early loses its
item the moment the plate is cleared; the gate exists so a verdict waits for the print, and the plan says how it
learns the print is over. And Workshop draws its lab rows from its own summary (`lab.py:222-262`), not from the
Needs-you list; the Next line reads the Needs-you list, and the plan makes the two agree.

### 3.2 Something needs the owner (step 19)

| Moment | Today | With A25 |
|---|---|---|
| A Needs-you row, anywhere | Opens the thing's page | Opens the thing (`open=`), with the ask showing when the item has one action (`&do=`) |
| A push about a thing | Opens `/workshop`, `/`, or nothing | Opens the thing. Never an action |
| A link from yesterday | — | Opens the thing with one line: "The plate is already clear" |
| Act | Five behaviours | One (E5) |
| Done | The row disappears on reload | The button says done; the row leaves the list; Next, if any |

### 3.3 A change goes live (step 18, as far as the pieces exist)

A release's open row shows the change's name, its commit, the previous release and its link to the Assistant's
Shipped entry where baseline 6.3 has one. Ship and Merge join when A13 is built. A25 doesn't wait for A13 or build it.

### 3.4 `do=`

`?open=<kind>:<id>&do=<action>` shows the ask or the sheet that action's button would show, and nothing more. It is
`/lab`'s `do=judge`, generalised,
with its rule kept (`lab.js:249-252`):

- The shell accepts `do` only if it names an action the thing offers **now**. Otherwise the thing opens with one
  line saying why ("The plate is already clear").
- It never sends anything.
- It is not accepted for Start a staged print, Quick print, Ship or Merge: those keep their own sheets and their own
  rules (A12, A13, A19, baseline §8.2). `/lab`'s existing `do=judge` and `do=start` stay as they are.
- Pi Hub's own pushes never carry `do`. A forwarded notice's address has `do` removed when it is stored
  (`notify_routes.py:71-85` allows any query on a hub host today).

### 3.5 The Next line

One line under the row once its action is done: "Next: Judge the print", a link. It comes only from the Needs-you
list, limited to items whose `refs` name the same print, experiment or record. No such item, no line. Nothing moves by
itself; leaving the page loses nothing; it is gone on the next load if the item is.

## 4. History

### 4.1 The page

**System › History** takes Alerts' place in the strip. `/alerts` redirects to `/history`; the Alerts badge moves to
it, counting as it does today.

- **It opens on "Needs a look":** a thing going to a problem or to attention and its recovery, which includes a
  failed or drifted deploy, and failed automations; grouped by day and then by thing. Everything else that day is
  folded under "Routine (12)". It is built from `record_events` and failed `rule_runs` only, so one overheating Pi is
  one row, not a change, a push and a rule run. The pushes are under Alerts.
- **Chips:** Needs a look · Alerts (the phone pushes, as the Alerts page lists them today) · Actions · Automations ·
  Everything. With `?open=` it shows one thing, and says which.
- **Rows:** time, the thing (a link, E2), what happened in E7's verb, and for an action, the device that did it.
  Repeats group as A7 P6 says; a problem and its recovery are one row, as Alerts does today (`alerts.js:30-58`).
- **It is a table** (`ui-table--stack`) per `DESIGN.md`: many rows with the same columns.
- **Sources,** merged at read time by one read route, `GET /api/history`: `record_events`, the Pi's alert log and
  `inbound_pushes`, `action_log`, `rule_runs` and `events`. No row is copied.
- **An action's row** says what was done and what the server answered. `action_log` has no outcome column
  (`auth.py:28`), so a failed action can't be picked out and isn't counted under "Needs a look"; adding the column is
  a schema change A25 doesn't make. The verb comes from a map of action names (`printer:clear`) kept beside the verb
  table (5.4).
- **How far back:** 30 days for changes, automations and forwarded notices, because that is what the tables keep
  (`records.py:182`, `events.py:310`); actions, 90 (`auth.py:241`); the Pi's alerts, the last 200 (`system.py:127`).
  The page says so at its foot.
- **A release** shows its state changes. A routine deploy, live to live, writes no change (`records.py:167`); its
  open row shows the current deploy and the previous one (`releases.py:219-226`). A full deploy history would need a
  store, and A25 doesn't add one.
- **Who sees what:** each source is gated as its own route is today. State changes, alerts and automation runs are
  readable on the home network as `/api/records`, `/api/alerts` and `/api/rules` are; actions and devices need
  `household` (`app.py:1097`);
  anything from Settings needs the owner. A viewer without the rank sees the page without those rows and one line
  saying sign-in shows more.
- **States:** nothing yet ("Nothing has changed in the last 30 days"); a source that can't be read is named in the
  sources line and its rows are missing, not the page.
- The pages that show a slice keep it where it is a diagnosis (Health's Outages) and link to the same rows in
  History. "Recent fixes" and Settings' "Activity" become that link.

### 4.2 The line on Home

One line under the Today band: "3 things needed a look since Tuesday, 6:10 PM", a link to History. It counts the
rows "Needs a look" would show and nothing else. Hidden at zero.

"Since" is **one mark for the owner, kept by Pi Hub**, moved when the owner opens History. Phone and laptop agree. A
mark in each browser, as the baseline's glossary describes and the Alerts badge uses today (`navigation.js:6`), would
say 40 on the laptop and 2 on the phone, and would start at "nothing" on a new phone. The History badge uses the same
mark. With no mark yet, the line counts the last 24 hours and says so.

This is the one stored value A25 adds: a timestamp in Pi Hub's settings table, written by one new route
(`POST /api/history/seen`), owner only. A viewer who isn't the owner sees the line and can't move the mark. The wall
never shows the line.

### 4.3 What it is not

- Not the human log view that D7 and baseline 6.6 defer: it shows events and actions the platform already records,
  and no log lines.
- Not the Assistant's Inbox or Audit log: baseline 6.5 keeps two histories with different scopes.

## 5. The shared parts

### 5.1 With the first steps (in the kit from the start)

`DESIGN.md` says a shared pattern goes into the kit, never into one app, so these are kit parts from their first PR,
each with a demo page.

| Part | What it is | Step |
|---|---|---|
| `ApplianceAction.run(button, request, steps)` on `ui-btn` | The action's steps on the button, in words and `data-state`; disabled while pending; a failure stays with "Try again". No spinner: the words change | 17 |
| `ui-next` | The Next line | 17 |
| `ui-row`, open state, and `ui-thing` | The open row (2.3) | 18 |
| `things.json`, `ApplianceThings` | The list and its reader | 18 |

### 5.2 Afterwards (step 21, and the part to cut if anything is cut)

| Part | What it is | Replaces |
|---|---|---|
| `ApplianceSheet` | A native modal `<dialog>` for a task: focus held, Escape closes, focus returns | About 14 hand-built in Pi Hub; the Assistant's own |
| `ApplianceToast` | One live region. It stays for as long as its words take to read, at least 4 s, and pauses on hover and focus | Two, with two timings |
| `ApplianceTime` | `ago`, `when`, `clock`, `duration`, with a table of inputs and exact outputs that each app's tests run. A page that needs seconds asks for them; the form is the same | About 35 helpers |
| Icons | A one-page spec first (grid, stroke, names, the label an icon-only control needs, what the wall's weather glyphs do), then one sprite | Three ways of making an icon |

The Assistant's buttons, fields and confirm move to the kit's where a step-21 PR already rewrites that section, after
step 14 has moved it.

### 5.3 The check

`check/patterns.mjs` in the kit, a text scan on the same terms as step 13's `literals.mjs` (a baseline of counts, a
count may only go down). It counts four things, each by a rule a text scan can apply:

1. `showModal(` or `createElement("dialog")` outside the kit.
2. The classes `btn`, `btn-*`, `empty-state`, `modal*`, `toast*` in app CSS and markup.
3. A `recordPath(` call whose link carries no `open=`.
4. A time helper defined in a file that doesn't import `ApplianceTime`, by the names in a list the kit ships.

Fields, emoji and inline drawings are not counted: a text scan can't tell a field from a slider, or an icon from a
chart. They are replaced where a PR already touches the file, and checked by looking.

### 5.4 One verb

`DESIGN.md` and A7 P7 set specific verbs for buttons. E7 extends each to four places. The plan for step 19 writes the
table from each record's `actions`; the ask keeps the consequence the code states today, and the toast is the
server's sentence, which the table also fixes.

| Kind | Button | Ask | Toast and History |
|---|---|---|---|
| The printer | Clear the plate | "Is the plate empty? Bambuddy may start the next print in the queue." | "Cleared the plate" |
| A service | Restart Plex | "Restart Plex? Anyone watching is cut off." | "Restarted Plex" |
| A paper job | Cancel this job | "Cancel this job?" (new: it doesn't ask today) | "Cancelled the job" |

Terms for baseline §9: **History** (the page; an Alert stays a phone push, listed under History's Alerts chip;
Health's own "Health history" keeps its qualified name), **Next** (the line in 3.5). "Thing" is a word for documents
and code. The UI calls a thing by its kind.

## 6. What the owner notices, step by step

| Step | On the day it ships |
|---|---|
| 17 The print slice | The finished-print notification opens Workshop. Clear the plate, there and on Home, shows its progress on the button, stays put when done, and offers the verdict |
| 18 Things | Rows open in place. Tapping any system, print or release, from Home, ⌘K or a list, lands on it, open. ⌘K finds prints and experiments |
| 19 Actions and Needs you | Every action behaves like Clear the plate. A Needs-you row opens with its ask ready. Paper jobs ask before cancelling |
| 20 History | One page for "what happened"; one line on Home after being away; each open thing shows its own past |
| 21 The shared parts | Little to see: toasts and times read the same in both apps, icons match. The value is that the next page built doesn't drift |

## 7. Fit with the baseline

| Text | From | To |
|---|---|---|
| §4, Needs-you item | Fields as `one-needs-you` lists them | Plus optional `refs` |
| §4, Record and Print | — | Plus `related`, derived, never stored |
| §4, "Deliberately left out" | — | Unchanged. `things.json` lists kinds that exist |
| §5.6 and A22 §2.2, the System strip | Alerts | History |
| A22 §3.3, §10 | `/alerts` is a page | `/history` is the page; `/alerts` is an alias to it (a path, as §3.5's redirect test expects). The change is proposed in the kit's `pages.json` first (A22 §3.1) |
| §8.2, Find | Records, Needs-you items, lab items, lists, movies, alerts, documents | The same, and prints; a result that is a thing opens its address |
| §9, "Since you last looked" | "Events since this browser last visited" | The line on Home; since the owner last opened History, one mark kept by Pi Hub |
| §9, Alert | "The System › Alerts page lists them" | "History's Alerts chip lists them" |
| D7 and §6.6, human log view | Deferred until the owner asks | Still deferred. History is not it (4.3) |
| A7 P1 | Rows | A row may open in place (2.3) |
| A8 D1 | "Anything older than today is on Alerts" | "…is on History" |
| A21's click check (`notify_routes.py:71-85`) | Any path and query on a hub host | The same, with `do` removed |
| A7 P7, the paper job | Cancels at once | Asks first |
| A8, Home | The dashboard | Plus one line under the Today band, hidden at zero |
| `DESIGN.md` (kit) | — | The open row, the action button's states, the Next line; later the sheet, toast, time and icons. No sentence is reversed |

Unchanged, and relied on: baseline §11's order for steps 13 to 16 (13's remaining PRs run beside 14 to 16; 14 after
12 and LocalAI's first step-13 PR; 15 after 12; 16 after 15); the separate-origin rule; A10; A12, A13 and A19; every
confirm in baseline §8.2; D2 (Pi Hub is the one sender).

No change to `deploy/`, the Caddyfile, `hub/auth.py`, `hub/gate.py` or the printer control routes. New routes, all
inside Pi Hub's app
behind the existing gate: `GET /api/history` (per-source ranks, 4.1), `POST /api/history/seen` (owner) and
`GET /api/prints/<id>` (open, as `/api/workshop` is).

## 8. Build briefs

One brief per migration step. AGENTS.md's rules apply to each. Nothing starts until this amendment is approved and
merged; then only step 17 starts.

```
 13 (H9…H18, L5…L10, P1) runs beside 14, 15, 16        (unchanged)
 17 the print slice ──► the owner's walk ──► 18 ──► 19 ──► 20
                                                └──► 21 (per app, after that app's step-13 PRs; in the
                                                         Assistant, per section after step 14 moved it)
```

A25's Pi Hub PRs touch scripts; step 13's touch stylesheets. Where one needs both (the open row's styles), it waits
for that stylesheet's step-13 PR or is agreed with the session doing it.

### Brief 17: The print slice

**What.** One kit PR: `ApplianceAction` and `ui-next`, with a demo page, and its release. Four in Pi Hub: the kit
synced (with the `SHELL` bump); `refs` on the printer's and the lab's items, with the cache rule in 2.4 and the
Bambuddy-down case; `runPrinterAction` on `ApplianceAction`, with the done row and the Next line, for all six callers;
the finished-print push given an address (a map by kind in `events.py`; the failed-print push already has one in
`urgent.py:13`, and the two share one constant).

**Done when.** The owner prints something real and, on the phone: taps the notification, lands on Workshop, clears
the plate watching the button, and reaches the verdict from the Next line, in fewer taps than the same walk takes
today. Both counts, and which browser and sign-in state the tap arrived in, are recorded in `docs/operations.md`. The
same is seen once from Home's button. Also recorded, from the tests' sample data unless the owner chooses to stop
Bambuddy himself: Bambuddy not answering, and the Mac asleep ("Waiting for the Mac").

**If the walk hasn't happened,** step 17 is merged and live but not accepted, and steps 18 to 21 don't start. If the
walk shows the idea is wrong, this amendment is changed or withdrawn before anything else is built on it.

**Depends on** nothing in steps 13 to 16.

### Brief 18: Things

`things.json` and its tests, and the open row (proposed in the kit); one row function per kind, with each drawing in
the audit moved
onto it; `?open=` for every kind; `related`; `GET /api/prints/<id>`; a release's open row; the router call for opening
in place; Find opens things and gains prints (the rest of
§8.2's Find, and the `?q=` defect, need no amendment and may go sooner under step 7). **Done when** the owner opens a
print, a release and a system from Home, from ⌘K and from a list, and each lands on its page with that thing open,
in two taps or fewer on the phone. **Depends on** 17 accepted. About nine PRs.

### Brief 19: Actions and Needs you

Every action in the audit on `ApplianceAction`; `do=` with its allow rule; Needs-you rows and pushes opening things;
`do` removed from forwarded notices' addresses; the verb table and its test; the paper job's confirm. **Done when**
the owner has used a restart, a cancel and one Needs-you item from a push on the live site and each behaved as Clear
the plate does; a `do=` for an action not on offer has been seen to show its reason. **Depends on** 18. About five
PRs.

### Brief 20: History

`GET /api/history` with its per-source ranks; `POST /api/history/seen`; the page; the alias and the page-list change;
the mark and the line on
Home; the links from Health, Settings, Automations and Versions. **Done when** every row on today's Alerts page is
under History's Alerts chip (compared on the same day's data); one thing's history opens from its row; the Home line
appears on the phone after a change made while away and reads the same on the laptop; signed out, the page shows no
action or device; an empty History and one with a source down have been seen. **Depends on** 18. About five PRs.

### Brief 21: The shared parts

The sheet, the toast, time and the icon spec in the kit; the check; then one pattern per PR per app, each lowering
the check's baseline. **Done when** the four counts are zero or each remainder is in the allow file with its reason,
and both apps' time tests run the kit's table. **Depends on** 17; per app on that app's step-13 PRs; in the
Assistant, per section on step 14. The owner may stop this step at any PR: each one stands alone.

### Before approval: a small prototype

Step 17 is the real proof, on real code. What it can't show is shown first on sample data, labelled as such, at
390 px and desktop, light and dark: History (Needs a look, one thing, nothing yet, a source down), and Home with the
line under the Today band. The owner looks at those two before approving, since they reopen A8.

The prototype (13 Nov 2026, private to the owner): https://claude.ai/artifact/XBZdfGrCJKJhQN5hUgp8HR. Its Today band
is the simplified one from the A22 prototype, not the live band.

## Out of scope, with an owner

| Left out | Why | Where it goes |
|---|---|---|
| The workshop display | Firmware, with its own candidate and physical acceptance | The display-kit rollout; its strings follow 5.4 when they next change |
| The wall | A board: it opens nothing and shows no line | Unchanged |
| The linked apps | A22: nothing is restyled or shown inside Pi Hub | A22 step 15. Its pages use whichever kit parts exist when they are built |
| print-lab's own static pages | They get `ui-backbar` under A22 | A follow-up after 21, if wanted |
| The Assistant's Inbox and Audit log joining History | Baseline 6.5 keeps two histories | A later amendment, if wanted |
| A full deploy history per release | Needs a store | Its own amendment, if wanted |
| The unused `prints` table (`db.py:12`) | Dead code | The sprawl check |
| Asking the house in words ("when did the printer last fail?") | A feature, not cohesion. `/api/history` would make it cheap | Its own amendment |

## Questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | Approve the design and step 17 only, with 18 to 21 confirmed after the walk? | Yes |
| Q2 | A thing opens in place on its page (2.2), not in a sheet? | In place |
| Q3 | History takes Alerts' place in the System strip? | Yes; `/alerts` keeps working |
| Q4 | "Since you last looked" is one mark kept by Pi Hub, not one per browser? | Yes. It is the one new stored value |
| Q7 | Should a failed action be countable in History? It needs an outcome column on `action_log` | Not in A25; decide after step 20 is in use |
| Q5 | One line on Home (4.2), reopening A8? | Yes, after seeing it in the prototype |
| Q6 | Is step 21 wanted at all, or only as far as steps 17 to 20 need? | Do the sheet, toast and time; decide icons after their one-page spec |

### Approval record (14 Nov 2026)

- **Q1: yes.** The owner merged pi-hub #247 on 14 Nov 2026. As asked, that covers the design and step 17; nothing in
  steps 18 to 21 starts before the walk in brief 17.
- **Q2 to Q7: no answer in words.** Each stands at its recommendation as the working answer. Step 17's plan names
  every one it relies on, so the owner confirms or changes it there. Q3, Q4 and Q5 belong to step 20 and Q6 to step
  21, so they are settled when those steps are confirmed, not before.
- **The prototype.** Whether the owner looked at History and the Home line before merging is not recorded. Q5's
  recommendation depends on that look, so it stays open until the owner says.

## Acceptance (for this amendment)

Where this stands on 14 Nov 2026: the baseline's `## Amendments` list names A25 and section 11 has steps 17 to 21.
Still open: the owner's answers beyond Q1 (above); the pointers from sections 4, 5.6, 8.2 and 9, which describe steps
18 to 20 and are added when those steps are confirmed; section 5 and brief 21 have not been sent to the session that
owns the Assistant's navigation; the kit proposals in 5.1 are not yet opened in appliance-ui.


- The owner has looked at the prototype's History and Home and answered the questions; the answers are recorded here.
- The `## Amendments` list in the baseline names A25, and sections 4, 5.6, 8.2, 9 and 11 point to it.
- The session that owns the Assistant's navigation has been sent section 5 and brief 21. Its answer is recorded
  here; with no answer in a day, the owner decides, as O6 did for A22.
- The kit proposals in 5.1 are opened in appliance-ui as their own PRs. Approving A25 doesn't merge them.

## Review record

**Round 1 (13 Nov), two independent reviews of draft 1.**

| Finding | Change |
|---|---|
| Six steps and about 35 PRs before anything was felt; no slice on real code | Rebuilt around step 17, one real moment, with approval of the rest held until the owner's walk |
| The item-to-thing link didn't exist as described: the dropped field is a record id, lab items name nothing, and nothing names a print | `refs`, computed where items are built, with the Bambuddy-down case |
| A modal sheet for reading: wrong on a phone from a push, on the wall, and when a task opens from it | Things open in place on their page; sheets stay for tasks. No change to `DESIGN.md`'s rule |
| The finished-print push is a rule push with no address and no print id | The push opens the printer, and carries no action |
| "Owner-gated like the routes it reads" was false: those routes are open on the home network | The thing route was dropped; History is gated per source |
| History would have been a feed; a per-browser mark hides the line when it matters | Opens on "Needs a look", grouped; one mark kept by Pi Hub |
| A release has no deploy history to show | Current and previous only; a store is out of scope |
| A8 D1 and D7 were overturned or brushed without being listed | Both in "Fit" |
| `release` and `record` were two addresses for one object; ids contain colons | One kind; the id rule in 2.2 |
| `do=` could be pre-set by a forwarded notice, and clashed with A12, A13 and A19 | The allow rule in 3.4; no `do` in any notification |
| The check counted things a text scan can't see | Four countable rules; time checked by a table |
| Making step 15 wait changed baseline §11 without saying so | Dropped. Steps 13 to 16 keep their order |

**Round 2 (13 Nov), one review that tried to plan step 17 against the code.**

| Finding | Change |
|---|---|
| Clear the plate isn't on the faceplate, and its row vanishes when the clear succeeds, taking the done state and the Next line with it | The row stays, done, with the Next line, until the owner leaves the page |
| The clear is one answer from the server: there is no "accepted" to show | E5 names each action's real steps |
| The helper has six callers, Home's and the wall's among them | Step 17 changes the helper, so all six report alike |
| Step 17 asked for things it couldn't show (a print by id, a stale `do=` link) | Moved to steps 18 and 19; step 17 is one kit PR and four in Pi Hub |
| The verdict item can vanish when the plate is cleared; Workshop's lab rows come from another source | Named as the two decisions step 17's plan makes first |
| The cache can name the previous print for a minute | The rule in 2.4 |
| A tap from a notification can arrive signed out | "Sign in" beside the button; the walk records the state |
| History: a routine deploy writes no change; failed actions can't be told apart; one event made several rows; the alert log isn't 30 days; the badge and the line used two marks; the mark had no write route | 4.1 and 4.2 rewritten; Q7 |
| Four address forms against "one address"; the lab id differed from baseline §4 | 2.1 and 2.2 |
| A21's click check and A7 P7 were touched but not listed | Both in "Fit" |
