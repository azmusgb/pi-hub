# Step 17, Made as one: the print slice. A finished print leads to Clear the plate, and that to the verdict — Plan

Date: 2026-11-14 · Status: **proposed** · Covers: baseline §11 step 17, amendment A25 brief 17
(`docs/superpowers/specs/2026-11-13-amendment-a25-made-as-one.md`, merged in #247 as 31a9b5e; recorded in the baseline
by #258 as 0859d7a).

**Goal:** when a print finishes, the phone's notification opens Workshop; Clear the plate shows its progress on its own
button, stays put when done, and offers the verdict right under it. The same button behaves the same on Home. Nothing
else about the pages changes.

## Spec

- Baseline §11 step 17: "**Made as one: the print slice (amendment A25, brief 17).** The kit's action button and Next
  line, `refs` on the printer's and the lab's Needs-you items, Clear the plate reporting through them, and the
  finished-print push given an address. Depends on nothing in 13-16. Accepted by the owner's walk with a real print."
- A25 brief 17 ("What", "Done when", "If the walk hasn't happened", "Depends on").
- A25 section 1 (rules E4, E5, E6), 2.4 (`refs`, and the Bambuddy-down case), 3.1 (the table, and the two things this
  plan must decide), 3.5 (the Next line), 5.1 (the two kit parts for step 17), 5.4 (the printer's row of the verb table).
- A25 is under the baseline's `## Amendments` on `origin/main`, so it is approved. Its approval covers the design and
  step 17 only.
- **Waits on:** nothing. Brief 17: "**Depends on** nothing in steps 13 to 16." A25 section 8 adds one practical rule: a PR
  that needs a stylesheet step 13 is still converting "waits for that stylesheet's step-13 PR or is agreed with the
  session doing it".
- Steps 18 to 21 wait on this step's acceptance. Brief 17: "If the walk hasn't happened, step 17 is merged and live but
  not accepted, and steps 18 to 21 don't start."
- Design contract: appliance-ui `DESIGN.md`, read at the start of each PR here, not from this plan. Its rule "Actions
  have three steps: sent, accepted, done" (line 292) is the one E5 builds on.
- Of A25's open questions, this plan relies on none of Q2, Q3, Q4, Q6 or Q7: nothing here opens a thing in place, touches
  Alerts or History, keeps a mark, or starts step 21's clean-up.

## Done means

Brief 17's "Done when", numbered:

1. The owner prints something real and, on the phone, taps the notification and lands on Workshop.
2. He clears the plate watching the button.
3. He reaches the verdict from the Next line.
4. The walk takes fewer taps than the same walk takes today. Both counts, and which browser and sign-in state the tap
   arrived in, are recorded in `docs/operations.md`.
5. The same is seen once from Home's button.
6. Also recorded, from the tests' sample data unless the owner chooses to stop Bambuddy himself: Bambuddy not
   answering, and the Mac asleep ("Waiting for the Mac").

## What exists today (read on 14 Nov 2026)

Code read at `origin/main`: pi-hub 0859d7a, appliance-ui ec45b06 (kit 2.22.0).

**Live:** the session that deploys reported the Pi on 43866d0 since about 00:30 on 14 Nov. `main` is two docs commits
ahead (#247, #258). Not checked by this plan against the release record.

**The kit**

- No `ApplianceAction` and no `ui-next` (`src/` holds `backbar.js`, `confirm.js`, `motion.js`, `needs.js`,
  `palette.js`, `components.css`, `needs.css`, `palette.css`, `words.json`).
- No `needs.schema.json` anywhere in the repo, though baseline §4 names it as `needs-item.v1`.
- `needs.js` has no `refs`; an item carries `record` today.

**The push**

- A finished print is pushed by the rule path: `events.py:263-265` builds the message from `MESSAGES` and calls
  `push(...)` with no `click`. `push` already takes one (`events.py:149`, `:165`).
- The failed-print push has an address: `urgent.py:13`, a `CLICK` map holding the Workshop URL as a literal.

**Needs you**

- `needs.py:141`, `:145`: a record's item carries `record: <id>`. No `refs`.
- `needs.py:64-96`: the lab's items. No `refs`.
- The verdict gate, `needs.py:88`: a "Judge the print" item is held back unless its `due_at` is empty, or `due_at` has
  passed, or `printer_done` is true. `printer_done` (`needs.py:203`) is "the printer record is fresh and `finished` or
  `failed`". It is true for any finished print, lab or not, and turns false the moment the plate is cleared.
- A lab need in the index has `id`, `urgency`, `action`, `why`, `due_at`, `command` (and `staged`): no run or build.
  The experiment beside it has `run`, `shown_build` and `due_at` (`tests/fixtures/lab-index.json`).

**Bambuddy's print log in Pi Hub**

- `bambuddy.prints()` is cached for 60 s (`bambuddy.py:132`). Each print has `id`, `status`, `started`, `ended` and
  `lab: {project, exp, build}` when its name matches `LAB_NAME` (`bambuddy.py:16`, `:121`).
- The cache can name the previous print for a minute after a finish; `recorder.py:26-29` drops it once, 20 s after.
- `sources.peek(key, ttl)` reads a cache without fetching (`sources.py:46`), and only while the entry is younger than
  `ttl`. Nothing keeps the print log warm: it is read when a page asks for `/api/workshop`, and once 20 s after a finish.
- A record's `since` is the time the hub first saw the new state (`records.py:153`). The sampler runs every 60 s
  (`recorder.py:104`), so a print's `ended` in Bambuddy's log is normally **earlier** than the printer record's `since`.
- The printer record keeps `detail.job` and `detail.started` (the hub's time when it first saw the print live) through
  `finished` and `failed` (`things/printer.py:153-171`). `detail.lab` is set only while the print is live (`:191-192`).
- A print's `status` is Bambuddy's word passed through: `completed`, `failed`, `cancelled`, `printing` are the ones the
  hub names (`bambuddy.py:17`).

**Workshop**

- Reads `/api/workshop` (`workshop.js:2124`), never `/api/needs`.
- "Needs you here" (`workshop.js:1785-1798`): the Clear row, for the owner, then up to three lab rows from
  `d.lab.needs`. Those come from `lab.workshop_summary()` (`lab.py:222-263`), which applies no gate: a verdict not yet
  due shows on Workshop and not in Needs you.
- A viewer who isn't the owner gets the row with no button, and one line under the list: "Only the owner can act on
  these. Sign in" (`workshop.js:1863-1864`).

**Clear the plate**

- One helper, `runPrinterAction` (`printer-actions.js:23-41`): asks inline, disables the buttons, posts
  `/api/printer/<action>`, toasts the server's sentence, re-enables, then calls `onDone`, which reloads the page. The
  row is gone on that reload.
- The helper serves Clear, Pause and Resume alike. A failure toasts and still calls `onDone`.
- Call sites, seven where brief 17 says six: `workshop.js:1870`, `control-room.js:243`, `printer-actions.js:65`
  (`printerButtons`, used by Home's dashboard and Workshop's band), `now.js:330` and `:917` (the wall), `quick.js:550`
  and `command-palette.js:86`.
- The route, `app.py:524-549`, is owner-only, re-reads the printer first and answers 503 when Bambuddy can't see it
  and 409 when the state changed. This plan does not touch it.

## One thing to settle before M2

A25 2.4 says the printer's item names the newest cached print "only if it isn't still printing and didn't end before
the record's `since`". Read to the letter, that drops the very print it means to name: `since` is when the hub noticed,
up to a minute after Bambuddy logged the end. The sentence gives its own reason ("the cache can name the previous print
for a minute"), so its intent is to keep out the **previous** print. Decision 3 implements that intent. Plans don't
edit the spec, so if the owner agrees, the sentence in 2.4 is corrected in a one-line docs PR of its own before M2
merges. K7 and M1 don't wait for it.

## Decisions this plan makes (for the owner's review)

Apart from the reading above, none changes the spec. If the owner disagrees with one, it changes here.

1. **How the verdict gate learns the print is over.** A25 3.1 leaves this to the plan. Today the gate opens on
   `printer_done`, which closes again when the plate is cleared, so a print that ends early loses its verdict item at
   the very moment the Next line needs it. **Choice:** the gate also opens when both hold:
   - the last print log the hub read shows the newest print for that experiment ended, with a status the hub knows as
     over (`completed`, `failed`, `cancelled`; any other word leaves the gate as today);
   - the printer record is not printing or paused on that same experiment now (its live `detail.lab`), which keeps a
     reprint that started after the log was read from opening the gate.

   The log is read from the hub's memory with `sources.peek`, so `/api/needs` never waits on Bambuddy (A25 2.4). An
   ended print stays ended, so for this one question the log may be old: M2 peeks it with a long limit (a day) where
   the pages keep their 60 s. The finish already refreshes it 20 s later (`recorder.py:26-29`), so it holds the
   finished print from then on. `printer_done` and `due_at` stay as they are. A failed or cancelled print opens the
   gate too, as `printer_done` does today.
   *Rejected:* remembering "the plate was cleared for this print" (a stored value; A25 adds none in this step),
   reading Bambuddy from `/api/needs` (A25 forbids the wait), and dropping the gate.
   *What it doesn't cover, said plainly:*
   - The hub restarts between the finish and the clear: the log isn't in memory, so the gate is today's, and the Next
     line is missing until a page loads `/api/workshop`.
   - Bambuddy starts a queued reprint of the same experiment right after the clear: the verdict waits for that print.
   - An earlier run of the same experiment ended and a reprint is queued but not started: the gate opens early. A need
     names no run or build. M2 closes this if print-lab's index names the build being printed (`shown_build` is the
     candidate; M2 reads print-lab's code to confirm, and then also carries that field through `lab.stored_needs`).
     If it can't be joined, M2's PR says so and the case stays, as the looser `printer_done` case does today.
2. **Workshop's lab rows and Needs you agree.** A25 3.1 leaves this to the plan too. **Choice:** the gate becomes one
   function, used by `needs.py` and by `lab.workshop_summary()`. "Needs you here" keeps every row it has today,
   except a verdict that isn't due, which now waits there as it does in Needs you. Separately, `/api/workshop` gains
   `needs`: the Needs-you items whose `refs` name the printer record or the newest print, built after the route's own
   print-log read and with `fetch=False`, so Workshop never waits on Local AI. Only the Next line reads it. It is a
   field on an existing open route; A25 section 7 lists new routes and names none here, and the field shows nothing
   `lab` doesn't already. *Rejected:* drawing "Needs you here" from `needs` alone, which would drop the rows about
   other experiments and every lab row while Bambuddy is down; and Workshop calling `/api/needs`, which can wait on
   the PC.
3. **What `refs` holds, and which print is "this print".** A record's item: `["record:<id>"]`. The printer's item,
   only while `finished` or `failed`: also `"print:<id>"`, for the newest print in the log the hub last read, used only
   if its status is over and it did not end before the record's print began (`detail.started`; where the record has
   none, before `since` less one sampler interval). That keeps the previous print out and the finished one in. A lab
   item: `"lab:<project>:<experiment>"`, and `"print:<id>"` for the newest print carrying that experiment. One build
   reads the log once and uses it for every item, so the printer's and the lab's items can't name different prints.
   The item keeps `record` beside `refs` until step 18's readers move.
4. **When the hub has no print log, there is no Next line, and the page says why.** The printer's item is
   `["record:printer"]` and the lab item `["lab:…"]`; nothing joins them, and A25 says nothing is guessed in the
   browser. The lab's rows still show under "Needs you here" (decision 2) and in Needs you. Where the page already
   says Bambuddy isn't answering, that stands; this is the tested state A25 2.4 asks for.
5. **The done row lives in the page, not the server.** A25: "The row stays, done, until the owner leaves the page."
   Each page that has a Clear row keeps what was done (the action, the `refs` it was about, the time) in its own
   state, redraws the row as done after its reload, and drops it in `leave()`. Workshop reads the Next line from
   `/api/workshop`'s `needs`; Home reads it from the `/api/needs` it already loads. Nothing is stored.
6. **Steps on the button, and what a failure does.** Clear: "Clearing…", then "Cleared". Pause: "Pausing…", "Paused".
   Resume: "Resuming…", "Resumed". The toast stays and is the server's sentence, as A25 5.4 has it. The button's
   change is announced once through a polite status region the kit part owns, so the result isn't silent and isn't
   said twice to a screen reader.
   - **503, Bambuddy can't see the printer:** the server's sentence beside the button, and "Try again".
   - **409, the state changed, nothing sent:** the server's sentence, then the page reloads as it does today; no "Try
     again", since trying again would be refused again.
   - **Sign-in declined:** the button goes back to rest. Nothing reads as done.
   The done row and the Next line are for Clear only in this step; Pause and Resume leave their row as the reload
   draws it. E6 for every action is step 19.
7. **The verdict's Send button moves in step 19, not here.** A25 3.1's row "The Mac is asleep" says the words go on the
   button; brief 17's "What" lists no change to the verdict sheet, and brief 19 has "every action in the audit on
   `ApplianceAction`". Two readings: (a) step 17 moves Send onto `ApplianceAction`; (b) step 17 proves the three-step
   form in the kit's demo and records the sheet's existing "Waiting for the Mac" line. **Choice: (b).** *Cost:* 3.1's
   "on the button" for the verdict is not delivered until step 19, and until then the two actions in this walk report
   in two places (the button, then a line in the sheet). Done-means 6's "Mac asleep" is recorded from the sheet as it
   is today, with M3's PR carrying a screenshot of it from sample data.
8. **A viewer who isn't signed in,** on Workshop and on Home alike: the Clear button is drawn disabled with "Sign in to
   clear the plate" beside it, and that line's link opens the existing owner sign-in. This is `DESIGN.md`'s "an
   unavailable action stays visible but disabled, with the reason beside it". On Workshop it replaces the line under
   the list for this row only.
9. **The call sites that aren't a row.** All seven send through the one helper. Where there is a button it carries the
   steps: Workshop, Home's two, the wall's two, Quick print's sheet. The palette has no button, so it says the same
   words in its own status line. The wall and the palette show no Next line (A25: the wall opens nothing).
10. **The push's address.** One constant for the Workshop URL, read by both `urgent.py` and a new map by kind in
    `events.py`; `print_finished` is the only kind that gains an address here. The address is the plain page. `?open=`
    is step 18.
11. **"Fewer taps than today" needs today's count first, and a rule for counting.** A tap is every touch from the
    notification, counting it, until the verdict sheet is open, with the same sign-in state in both walks. M2 changes
    when the verdict shows and M4 changes where the notification lands, so the owner walks today's flow with a real
    print **before M2 is live**, and the count goes into `docs/operations.md` then. K7 and M1 don't wait. A count from
    sample data would not be the walk brief 17 asks for.
12. **Names.** The kit PR is K7 (kit 2.23.0). Pi Hub's are M1 to M5.

## PRs, one at a time

Each PR names A25 brief 17, says partial coverage, and carries the evidence listed. Order: K7, M1, then the owner's
count of today's walk, then M2, M3, M4 (M4 any time after M2), and M5 after the walk.

| PR | Repo | What | Evidence | Done-means |
|---|---|---|---|---|
| K7 | appliance-ui | `ApplianceAction.run(button, request, steps)` on `ui-btn`: steps in words and `data-state`, disabled while pending, a status region, a failure stays with "Try again", no spinner. `ui-next`. `needs.schema.json` with optional `refs`. A demo page showing two-step, three-step, failed and Next. `DESIGN.md` gains the button's states and the Next line. Release 2.23.0 | Kit tests; the demo at phone and desktop, light and dark; contrast from `docs/contrast.md` | — |
| M1 | pi-hub | Kit 2.23.0 synced, `SHELL` bumped. No behaviour change | Both suites, sprawl, literals; width sweep and axe unchanged | — |
| M2 | pi-hub | `refs` (decision 3); the gate as one function, in Needs you and the Workshop summary (decisions 1, 2); `/api/workshop`'s `needs`. Pages draw nothing new, but when a verdict shows changes at once, on Home and Workshop | Tests named below | 3, 6 |
| M3 | pi-hub | The helper on `ApplianceAction`; the done row and Next line on Workshop and Home; the signed-out line; all seven call sites (decisions 5 to 9). `SHELL` bumped | Tests below; width sweep, axe, screenshots at phone, tablet and desktop in light and dark; the sheet's "Waiting for the Mac" from sample data | 2, 3, 5, 6 |
| M4 | pi-hub | The finished-print push opens Workshop (decision 10) | Test: the push carries the address; the failed-print push is unchanged | 1 |
| M5 | pi-hub | `docs/operations.md`: the step 17 entry, written from the owner's walk | The entry itself | 4, and the record of 1, 2, 3, 5, 6 |

**Tests M2 adds, by name of what they prove**

- A record's item carries `refs` with its record; the printer's names the print only while finished or failed.
- The normal finish, with real timings: the print ended 40 s before the record's `since` and after its `started`: named.
- The log still names the previous print (it ended before this print began): not named.
- The newest print is still printing, or its status is a word the hub doesn't know: not named.
- No log in memory: `record:printer` only, and `/api/needs` made no call to Bambuddy.
- The gate: early finish, plate cleared, `due_at` still ahead → the verdict item is still there, from a log read
  ten minutes ago. The record is printing that experiment again → held back. No log → today's three cases unchanged
  (the existing `test_lab_judge_waits_for_due_at` is not edited).
- Two experiments with prints in the log: each lab item names its own print, not the newest overall.
- The printer's item and the lab's item in one build name the same print.
- Workshop's summary holds back a verdict that isn't due, and keeps every other row it had.
- `/api/workshop`'s `needs` is built after the print-log read, and has the printer's and this print's items only.

**Tests M3 adds**

- Held request: the button reads "Clearing…" and is disabled; then "Cleared"; the row is still there after the reload,
  on Workshop and on Home.
- A 503: "Try again" and the server's sentence; nothing reads as done. A 409: the sentence, a reload, no "Try again".
- Sign-in declined: the button is back at rest.
- The status region announces the result once.
- The Next line appears only when an item's `refs` name the same print or record; none, no line. Not a lab print: none.
- No print log: no Next line, the lab row still under "Needs you here", and the notice is there (Done-means 6).
- Not signed in: the button is disabled and "Sign in to clear the plate" is beside it before any tap, on both pages.
- Leaving the page and coming back: no done row.
- Pause and Resume show their own steps.
- Each of the seven call sites goes through the helper (one test that fails when a new caller posts by itself).

**Owner steps**

- Confirm the reading of A25 2.4 above (merging this plan does), and say whether the one-line fix to 2.4 is wanted.
- Before M2 is live: walk today's flow with a real print and count the taps (decision 11).
- After M4 is live: the walk in "Done means" 1 to 5.
- Stopping Bambuddy to see its state live is optional (brief 17) and, as a service stop, needs the owner's own go.

## Acceptance

Recorded in `docs/operations.md` under step 17 by M5, as "Accepted <date>" only when all of these are written there:

- Today's tap count and the new one, counted as decision 11 says, with the browser and sign-in state the
  notification's tap arrived in.
- That the owner cleared the plate watching the button and reached the verdict from the Next line, on the phone.
- The same seen once from Home's button.
- Bambuddy not answering and the Mac asleep, each marked "from sample data" or "seen live".

Until then the ladder is: merged, deployed, runtime verified, **not accepted**. No status doc calls step 17 done
before that entry, and steps 18 to 21 don't start. If the walk shows the idea is wrong, A25 is changed or withdrawn
before anything is built on it (brief 17).

## Out of scope (noted, not gated)

- **A verdict edited while the first send is still pending never reaches the hub** (`lab.py:658` answers the stored
  request). Found on 13 Nov during an audit; not confirmed. Owner: a `/fix` of its own.
- **`printer_done` opens the gate for any finished print, lab or not.** Existing behaviour; decision 1 doesn't widen
  it. Owner: step 19's plan, which moves Needs-you rows onto things.
- **Needs you can't say "the hub hasn't read Bambuddy's log yet".** Decision 4 shows no Next line in that case and
  leans on the page's existing Bambuddy notice; after a hub restart with Bambuddy up, nothing explains the missing
  line until Workshop is opened. Owner: step 18, where a print gets its own row and state.
- **The Workshop URL is a literal** in `urgent.py:13`. Decision 10 gives it one home but keeps the literal. Owner: the
  real-names work, which already owns the hub's host.
- **Seven call sites, not six.** Brief 17's count predates one of them. Nothing to decide: all go through the helper.
- **`?open=`, the open row, `things.json`, History, the verb table's test:** steps 18 to 20.
