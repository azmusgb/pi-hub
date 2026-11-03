# Platform step 5: pushes onto Pi Hub — Plan

**Goal:** Pi Hub's ntfy is the one phone channel (D2). LocalAI, print-lab and mac-watch post their pushable events to
Pi Hub instead of sending their own, and quiet hours and de-duplication live in Pi Hub alone. LocalAI's Web Push stays
until ntfy is seen delivering the Assistant's events, then it retires.

**Spec:** `docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`, §11 step 5 (as amended by A2) and
§12 D2: "LocalAI posts its pushable events to Pi Hub, as the display does with `/api/display/notify`. Print-lab and
mac-watch post to Pi Hub, not to macOS. Quiet hours and de-duplication live in one place."

**Gate (A2):** step 2 accepted (`docs/operations.md`, "Accepted 2 Nov 2026", #44) and step 3 complete: `release:localai`,
`release:mac-watch` and `release:print-lab` are written by their own deploys (A3; pi-hub #58, LocalAI #463, print-lab
#15). Both hold as of 2 November 2026.

## What sends today (origin/main, 2 November 2026)

| Sender | Transport | Events | Step 5 |
| --- | --- | --- | --- |
| Pi Hub `hub/events.py:149` `push()`, called by the rules, `urgent.py`, `digest.py`, `reminders.py` | ntfy | print, weather, filament, PC/WAN, mirrors, digest, reminders | Already the channel. Gains the inbound route |
| LocalAI `app/push.js:67`, routed by `app/notify.js:24` | Web Push | Assistant runs (approval, failed, finished), approvals and host notices, Claude findings, service down/up, watchdog (disk, camera bridge, display, print finished) | Posts to Pi Hub (5.4), then Web Push retires (5.5) |
| mac-watch `host/mac-watch/watch.py:72` | macOS banner | Local AI not answering (~15 min), and back | Posts to Pi Hub (5.2) |
| print-lab `lab/pull.py:306` `notify_desktop()` | macOS banner | Print finished, ready for a verdict; Pi Hub not answering, and back | Verdict notice posts to Pi Hub (5.3) |
| `deploy/pi-status.py:291`, `deploy/pi-hub-selfcheck.py:105` | ntfy, outside `push()` | Pi services, display, X2D finished/attention; self-check | Out of scope (see the end) |
| Healthchecks.io (`pi-hub-heartbeat`) | its own email | Pi Hub unreachable | Stays separate by design (D2 amendment) |

Pi Hub has no route today that lets another system ask for a phone push. `/api/display/notify` reaches only the
display.

## Decisions this plan makes (for the owner's review)

These fill in what the spec leaves open. None changes the spec. If the owner disagrees with one, it changes here.

1. **One route: `POST /api/notify/{source}`**, sources `localai`, `mac-watch` and `print-lab`. It is shaped like
   `/api/display/notify`, and the hub sends what it takes through `events.push()`. Body: `kind` (from the source's
   fixed list), `title`, `body`, optional `click` (an https URL on a known host), optional `dedupe` (a sender's id
   for the occurrence). Answers: 200 `{sent | held | duplicate}`, 400 invalid, 401 wrong key, 429 over the cap.
2. **Keys: the hosts' existing keys, no new secret.** LocalAI uses its `localai` deploy key and mac-watch the `mac`
   deploy key (`X-Hub-Deploy-Key`). print-lab uses the lab key it already sends to `/api/lab` (`X-Hub-Mac-Key`).
   Each key may post only for its own source, as with releases (`KEY_FOR`).
3. **Quiet hours, de-duplication and a cap live in Pi Hub.** Quiet hours are the existing `quiet_hours` setting.
   Only kinds marked urgent in the source's list go through at night: LocalAI `failed`, `service` and `answer`
   (today's Web Push rule), and mac-watch's outage. A repeat of (source, dedupe) within 10 minutes is a duplicate.
   The cap is 10 per source per 10 minutes, then one "N more from <source>" push.
4. **Every inbound push lands in the Alerts history** with its source, so "did the sender post?" has an answer on Pi
   Hub. Together with Versions (A2's reason), a silent sender no longer looks like a quiet one.
5. **Senders don't fall back to their own channel, with one exception.** mac-watch and print-lab keep an unsent
   notice for their next run (5 minutes, 60 seconds) and drop it after an hour. LocalAI posts to Pi Hub first and
   uses Web Push only for an event Pi Hub didn't take, until 5.5 retires Web Push. That way the owner never gets the
   same event twice during the overlap.
6. **Banners that report Pi Hub itself stay on the Mac.** print-lab's "Pi Hub not answering" can't go through Pi
   Hub. The outside alarm (D2 amendment) is the phone path for that, so the banner stays as a local diagnostic only.
7. **Duplicates removed at the source.** LocalAI's watchdog "print finished" is dropped, because Pi Hub's
   `print_finished` rule already sends it. print-lab's notice becomes "ready for a verdict" (kind `verdict`, with a
   link to `/lab?p=…&do=judge`), not a second "print finished".

## PRs, one at a time

Each PR names this step and D2, states full or partial coverage, and carries its acceptance evidence.

- **5.1 pi-hub: the route.**
  - `hub/notify_routes.py`: the route, source kind lists, keys, quiet hours, de-duplication, the cap and Alerts history.
  - Tests: one per answer; a key good only for its source; quiet hours hold a non-urgent kind and pass an urgent one;
    a duplicate; the cap and its summary; the history entry.
  - `docs/operations.md`.
  - Evidence: a test post with each key, seen on the phone through ntfy.
- **5.2 LocalAI (mac-watch): the outage notice posts to Pi Hub.**
  - The macOS banner goes. The notice waits in an outbox for the next run when Pi Hub is unreachable.
  - Tests in `tests/mac-watch.test.cjs`.
  - Evidence: a simulated outage (`LOCALAI_URL` pointed at a closed port for 3 runs) seen on the phone, then the
    recovery. `release:mac-watch` moves.
- **5.3 print-lab: the verdict notice posts to Pi Hub.**
  - The local banner remains only for "Pi Hub not answering" (decision 6).
  - Evidence: a real or fixture print reaching "ready for a verdict", seen on the phone; the tap opens `/lab`'s
    judge view. `release:print-lab` moves.
- **5.4 LocalAI: the notifier posts to Pi Hub first.**
  - `app/notify.js` gains a Pi Hub channel ahead of Web Push (decision 5). LocalAI's own rules for which events push
    stay; its quiet hours and rate cap give way to Pi Hub's.
  - The watchdog's "print finished" is dropped.
  - Evidence: an Assistant run waiting for approval, one failed and one finished (30 s or longer), each seen on the
    phone through ntfy with Web Push not firing. `release:localai` moves.
- **5.5 LocalAI: Web Push retires**, only after the owner has seen ntfy deliver the Assistant's events (5.4's
  evidence, over at least a few days of normal use; the owner says when).
  - Removes `app/push.js`, the push subscription UI and the `push:*` settings, with a migration note.

## Acceptance for step 5

- Each of the three sources has posted through `/api/notify` and been seen on the phone, with its Alerts history
  entry.
- Quiet hours held a non-urgent post and passed an urgent one, on the live hub.
- Versions shows each sender's release after its PR.
- Web Push is gone (5.5), after the owner's observation.

## Out of scope (noted, not gated)

- **`pi-status.py` and `pi-hub-selfcheck.py` send to ntfy outside `push()`.** They skip quiet hours and
  de-duplication, and self-check ignores `ntfy_servers`. They also duplicate events:
  - PC down: `pi-status`, the `pc_down` rule and `urgent.py`.
  - X2D finished: `pi-status` and the `print_finished` rule.
  - X2D attention: `pi-status` and `urgent.py`.

  These are Pi Hub's own senders, so D2's "one channel" already holds. Folding them into `push()` is a separate
  Pi Hub cleanup, worth doing, but it doesn't gate step 5.
- **Bambuddy publishing straight to the ntfy topic** (`docs/operations.md:219`) is the same: it's a third party on
  Pi Hub's channel. It's noted for that cleanup.
- **Pi Hub's own `push()` sends don't reach the Alerts history.** Decision 4 covers only inbound posts; the same
  cleanup can add the rest.
