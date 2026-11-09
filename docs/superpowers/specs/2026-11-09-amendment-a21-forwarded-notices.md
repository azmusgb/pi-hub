# Amendment A21: forwarded notices close and don't repeat

Date: 2026-11-09 · Status: **proposed** · Amends: A7's "grouped repeats" and the one-page plan's decision 5 (an alert and
its recovery share a cause key) for notices that other systems post through `/api/notify/{source}` (migration step 5,
D2). Does not change D1, D2 or D7, and does not change how a Pi Hub alert (heat, drive, Plex and so on) opens or closes.
A plan follows only after the owner merges this.

## Why

The Alerts page shows an open cause until a recovery arrives. A notice forwarded from another system has no recovery,
and its key changes whenever its words change. On 9 Nov 2026, live `/api/alerts` showed 11 open causes, and 6 of them can
never close:

- Five are Local AI's "N commits on main not deployed yet" (N = 2, 4, 7, 11, 13 and 14). Each count is a new cause, so
  the page shows six of them and nothing ever matches a recovery.
- One is print lab's "Test: step 5.1 route works" from 3 Nov. It was a test post of the route, and it still counts as
  something that needs the owner.

Two things are wrong, and they are separate:

1. **The key is the message.** `hub/notify_routes.py` (`history`, the `cause` line) builds `source:kind:title` for every
   notice except the Mac watchdog's outage and back. A title with a number in it is a different cause every time.
2. **Nothing says what "over" means for a notice.** The page treats any notice that is not a green check as an open
   problem (`hub/static/js/alerts.js`, `groupAlerts`: `problem` is true unless the tone is "ok"). So a plain
   information notice, like the test post, stays open forever.

A third thing sits under both. Local AI deploys only when the owner ships it (`npm run ship`). "Merged but not deployed"
is its normal resting state, not a fault. Pi Hub already knows the real answer: `release:localai` is the deployment
truth (D1, D7), and System › Versions shows it.

What must not change: every notice is still kept as one entry in the Alerts history (decision 5's "the evidence"), the
phone still gets what it gets today, and a real failure still stays open until it is over.

## What exists today (read on 9 Nov 2026)

- Notices arrive at `POST /api/notify/{source}` for `localai`, `mac-watch` and `print-lab`, each with a fixed list of kinds
  (`hub/notify_routes.py`: `SOURCES`). Every post is stored in `inbound_pushes` and kept 30 days (`KEEP_DAYS`).
- `history()` gives each stored notice a `cause` and a `side`. The Mac watchdog's `outage` and `back` share
  `mac-watch:outage`. Anything else is `source:kind:title`. `side` is `recovery` for `back`, `problem` for a warning or alarm
  tag, otherwise `event`.
- The Alerts page groups by that cause, per local day (`groupAlerts`). A cause is over only when its newest alert is a
  recovery.
- Local AI posts "N commits on main not deployed yet" from its auto-deploy script
  (`deploy/Run-LocalAI-AutoDeploy.ps1`, once per main commit that is ahead of `release`). It posts it as kind `failed`,
  which is urgent: it passes quiet hours and shows as a warning.
- The release record carries a `head` the sender reports. When the head is not what runs, the state is `behind` and the
  headline says "X is live; Y is not deployed". `behind` is severity `info`, so it is not a Needs-you item
  (`hub/releases.py`: `SEVERITY`, `_state`). Today `release:localai` reads `live`.

## Decisions

**D1 A forwarded notice's cause is its source, its kind and a topic the sender names. It is never its words.**

- *Option A: source and kind only.* Simple, but it joins unlike things: two different failed jobs from Local AI would be
  one cause, and a success for one would close the other.
- *Option B: source, kind and a topic word chosen by the sender* (for example `localai:deploy`, `localai:unreleased`).
  The sender says what the notice is about, in a short fixed word that never holds a number or a name that changes.
  A sender that sends no topic keeps today's key, so nothing already posting changes.
- *Option C: work the topic out on the hub by stripping numbers from the title.* No sender change, but it guesses, and
  "3 jobs failed" and "failed job 3" would not agree.

Recommended: **B.** The notice gains an optional `topic` (1 to 40 characters of `a-z`, `0-9` and `-`), and the cause
becomes `source:topic`. The topic belongs to the problem, not to its success or failure: a failed update and the update
that fixes it share one topic, so they can be one cause. The 10-minute duplicate check is unchanged. It still works on
`dedupe`, which senders already control.

**D2 A forwarded notice closes by the sender's own recovery, or by a stated expiry. A plain information notice never opens a cause.**

Three ways to close were weighed.

- *A recovery from the sender.* The sender knows when its trouble ended, and the Mac watchdog's `back` already works
  this way. It needs the sender to post it, so it can't be the only way: a sender that crashes or is retired never
  posts it.
- *A matching release record.* Pi Hub could close a deploy notice when `release:localai` reaches `live` at a newer
  commit. It is exact, but it ties every notice to a release record, and only deploy notices have one.
- *An expiry the spec states.* A problem with no recovery closes itself after a set time. It is a guess about the
  sender, but it can never leave the page stuck.

Recommended: **a sender recovery as the normal way, with a 7-day expiry as the backstop, and no cause at all for plain
information.**

1. **Recovery.** Each source names its closing kinds. A notice of a closing kind with the same topic closes the cause:
   `back` for `mac-watch`, and `finished` for `localai` (an update that worked closes the failed update, topic `deploy`).
   The page already draws this as "then back" or "then fixed".
2. **Information is history, not a problem.** A notice whose kind carries no warning or alarm tag is an event. It shows
   in the history and on the phone, and it is never an open cause and never counts toward Needs you. This is what
   settles the print lab "Test: step 5.1" notice, and it will settle any future `verdict` or `answer` the same way.
3. **Expiry.** A problem with no recovery for 7 days closes. The page shows it as over, and says "No update for 7
   days" in place of "Back now." A new post with the same topic opens it again. The hub works the expiry out when it
   reads the history, and writes nothing. Seven days is a stated, changeable number, not a rule of nature.

The page and the faceplate count open causes the same way (pi-hub #210 made the faceplate count each cause once), so the
two numbers can't disagree.

**D3 "Commits merged, not deployed" for a ship-gated target raises no alert.**

- *Option A: keep the notice, give it a stable key (D1) and close it when the shipped release catches up.* The owner
  keeps the reminder, but it still reads as a warning on the Alerts page and still passes quiet hours as `failed`, for
  something that is the normal state.
- *Option B: keep it as a quiet information notice* (D2 point 2): on the phone, not on the page as a problem. Less
  noise, but it still buzzes the phone about something that is not wrong, once per main commit.
- *Option C: no notice.* The fact is already shown, once, by the record that owns it: System › Versions, where
  `behind` reads "X is live; Y is not deployed" and is not a Needs-you item (D7).

Recommended: **C.** A target the owner ships by hand is allowed to have commits waiting. Waiting is not failing. The
single place that says what is live and what is not is the release record (D1, D7), and the commit count was a second,
worse copy of it. This also removes what made it repeat. Two consequences the plan must check first, because they decide
whether C loses information:

- The record can only say `behind` if Local AI reports the main commit as its `head`. Today it reads `live`, so the
  plan starts by finding out what Local AI sends as `head`, and if it is the shipped release, changes the sender to send
  main's tip. That is a one-line sender change, and it is not part of this amendment.
- The notice existed so waiting commits "aren't forgotten". If the owner wants a nudge, it is a Versions row that says
  how long it has been waiting, never an alert. That is named here and left for the plan.

The rule generalises: a notice that restates something a release record already shows belongs on Versions, not in
Alerts. A deploy that *fails*, or a deploy that is rolled back, is a fault, and still alerts (kind `failed`, topic
`deploy`).

**D4 The notices already stored are left alone, and the hub reads them with the new rules.**

- *Option A: do nothing.* They would still show as open until they age out at 30 days (about 3 Dec for the oldest of
  the Local AI ones).
- *Option B: one-time close.* Write a closing entry for each. It clears the page now, but it writes a recovery the sender
  never sent, and the history is the evidence, one entry per event.
- *Option C: delete the stored rows.* Cleanest page, but it destroys evidence for a display problem.
- *Option D: read them with the new rules.* The hub reads each stored notice through the same cause and side rules,
  plus one named legacy rule: a stored `localai:failed:<N> commit(s) on main not deployed yet` is treated as the
  information it was (D3). Nothing in the database changes.

Recommended: **D.** It clears the five Local AI notices and the print lab test on the next page load, with no write,
no fake recovery and no lost row. The legacy rule is written down by its exact pattern and deleted from the code when
the 30-day keep has aged the last of them out. If the owner would rather close them with a visible mark, B is the
second choice, and it needs the owner's say because it writes history.

## Not decided here

- Whether other forwarded kinds (`needs-you`, `service`, `answer`) should also get topics. Each source picks its topics in
  the plan; this amendment gives the rule.
- The 10-minute duplicate window, the 10-per-10-minutes cap and the 30-day keep.
- Local AI's sender, print lab's sender and what `head` Local AI reports. They are separate PRs in their own repos,
  listed in the plan.
- A "waiting for how long" row on Versions (D3).

## Done means (proposed, for the plan)

1. On the live `/api/alerts`, the five Local AI "not deployed yet" notices and the print lab test notice are no longer
   open causes, and all six are still in the history.
2. A forwarded problem with a topic and a later closing notice of the same topic shows as one cause that is over.
3. A forwarded problem with no recovery shows as over after 7 days, and a new post with its topic opens it again.
4. Two different failed jobs from one source stay two causes.
5. Local AI no longer posts a not-deployed notice, and System › Versions still shows what is live and what is waiting.
6. A senders that sends no `topic` behaves as it does today, and the existing notify tests still pass.
