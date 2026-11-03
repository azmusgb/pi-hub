# Platform step 6: the print lab lives only on Pi Hub — Plan

**Goal:** Pi Hub's `/lab` is the print lab's one home (D5, K1). It opens a given project and the verdict sheet from a
link, and a `mac_lab` record makes the Mac's silent wait visible. LocalAI's Print lab tab redirects to it, and LocalAI's
`/api/lab/*` goes once its own logs show no remaining caller.

**Spec:** `docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`, §11 step 6: "`/lab` takes `?p=`
and `do=judge`, and the `mac_lab` record exists. Then redirect the tab. Then build the caller inventory and gather the
log evidence. Then remove `/api/lab/*`." §12 D5 (the three stages and their gate), §4's `mac_lab` ("when the Mac last
synced, and how many requests wait for it. It is a problem only when requests are waiting and the Mac has been
silent"), the `mac_waiting` phrase (§9) and the `printLab` row in §5's retirement table ("Remove the dead render code,
five scripts and `/api/lab/*` once LocalAI's logs show no remaining caller").

**Depends on:** nothing. Step 6 is "independent of 2-5". No amendment touches it.

## Done means

From D5, in order:

1. `/lab` takes `?p=` and `do=judge`, and the `mac_lab` record exists (§11 step 6).
2. LocalAI's Print lab tab redirects to Pi Hub `/lab` (D5.1).
3. A caller inventory: "LocalAI's own front end, print-lab, scripts and agents, each retired or repointed" (D5.3).
4. "LocalAI access logs, retained over at least one period in which the PC was up and the Mac was awake and syncing,
   with no request to `/api/lab/*`" (D5.3). "The gate is that coverage, not elapsed time."
5. `/api/lab/*` and the dead render code are removed from LocalAI.

## What exists today (read on 3 November 2026, `origin/main` of each repo)

- **`do=judge` exists.** `hub/static/js/lab.js:242` opens the verdict sheet when the experiment has a due "Judge the
  print" need; print-lab's verdict push links `/lab?e=<exp>&do=judge` (print-lab `lab/pull.py:328`).
- **`?p=` does not.** The page reads `?e=` (experiment) and `#lab-<id>` (`lab.js:1191`), from `main.js:238`'s
  `context`. There is one project today (`hex-tile`), so nothing has needed `?p=` yet.
- **`mac_lab` does not exist.** `git grep mac_lab origin/main -- hub` finds nothing. The facts it needs are there:
  `lab_projects.synced_at` per project (`hub/lab.py:61`), `lab_requests` with `status` and `created_at`
  (`hub/lab.py:73-85`), and the Mac's key on every pull. The Mac's `lab pull` runs every 60 s
  (`lab/pull.py:634`, `StartInterval: 60`) and asks `GET /api/lab/<project>/requests?status=pending` with its key
  (`lab/pull.py:172`, `hub/lab.py:677`). Nothing records when the Mac last asked. The 21st waiting request is refused
  with "The Mac hasn't picked up the last 20 requests" (`hub/lab.py:652`). Live: 0 pending, last resolved
  31 Oct; `hex-tile` synced 3 Nov 12:56 UTC.
- **The tab is a card, not a redirect.** LocalAI's `printLab` view is unlisted (`app/public/view-registry.js:45-46`)
  and renders "Print lab is on Pi Hub" with a button (`app/public/print-lab.js:244-252`). The button points at
  `https://home.home.arpa` or `http://10.0.0.30`, not the real name, and carries only `?e=`. LocalAI's Needs you lab
  items "still open this copy" (`view-registry.js:45`).
- **LocalAI's lab copy is stale.** `lab sync` writes only to Pi Hub (D5 premise). LocalAI's `/api/lab/projects` last
  synced 28 Oct 15:30 UTC (read through Pi Hub's key on 3 Nov).
- **Callers of LocalAI's `/api/lab/*` found so far:**

  | Caller | Where | Calls | Step 6 |
  | --- | --- | --- | --- |
  | LocalAI front end | `app/public/print-lab.js:209`, `print-lab-observe.js:170,186,203`, `print-lab-photos.js:13` | project, requests, photos | Retired with the redirect (6.4), deleted in 6.7 |
  | Pi Hub | `hub/sources.py:234-268`, `_localai_lab_projects()`, used only when Pi Hub's own store shows no printing experiment, via `hub/things/__init__.py:27` | `GET /api/lab/projects` (hub key, `app/server.js:184`) | Fallback removed (6.3) |
  | print-lab | `lab/page.py:112` links `<LocalAI>/#/printLab` | the tab, not the API | Repointed to Pi Hub `/lab` (6.5) |
  | LocalAI display routes | `app/display-lab.js` uses the `printLab` store in-process, not over HTTP (`app/server.js:164`) | `/api/display/lab/*` | Not a `/api/lab/*` caller; see Decision 5 |
  | Tests | `tests/print-lab*.cjs`, `display-lab`, `hub-ai-cards`, `signin-report` | the routes | Deleted or narrowed with 6.7 |

  print-lab's `lab sync` and `lab pull` target Pi Hub only (`lab/sync.py:25,79`). Its one LocalAI read is
  `/api/workshop/status` (`lab/sync.py:274`), which is not `/api/lab/*`. The spec's "five scripts" are not named
  anywhere I could find: `git grep /api/lab origin/main -- scripts host` in LocalAI finds none. 6.4 names them or
  records that they no longer exist.
- **LocalAI keeps no access log.** Requests aren't logged (`app/server.js` has no access logging), and its Docker log
  is replaced on every container recreate, which every deploy does. So D5's "retained" evidence doesn't exist yet.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **`?p=` selects the project; `?e=` keeps selecting the experiment.** `?p=hex-tile&e=E-025&do=judge` opens that
   project, that experiment and its verdict sheet. A `?p=` that names no project shows "No project called <p>" with the
   project list, instead of silently opening the first one. Rejected: renaming `?e=` to fit `?p=`, which would break the
   links print-lab already sends.

2. **"When the Mac last synced" is the newest `lab_projects.synced_at`; "silent" is measured from the Mac's last
   contact.** The spec's two facts come from different signals. `synced_at` only moves when `lab sync` runs, which
   follows record changes, so it can be days old on an awake Mac. The Mac's pull, every 60 s, is what picks up requests.
   So the record shows `last_synced` (the spec's words) and also stores `last_contact`: the last request carrying a
   valid Mac key (pending poll, result post or sync), and silence is judged on that. Kept in the DB (`lab_state`, written
   at most once a minute), so a Pi Hub restart doesn't reset it. Rejected: judging silence on `synced_at`, which would
   call an awake Mac silent.

3. **"Silent" means no Mac contact since the oldest waiting request was queued, once that request is older than
   3 minutes.** The spec says silent without a number. 3 minutes is three pull periods: an awake Mac picks a request up
   within about 60 s, so this never fires on an awake Mac, and it fires within minutes for a sleeping one. This is my
   choice from the 60 s `StartInterval`, not the spec's. It trades fast notice against one false notice if a pull stalls
   for two cycles. Rejected: a longer threshold such as 15 minutes, which keeps the wait silent for longer than the spec
   intends.

4. **The record's states.** `idle` (nothing waiting; ok), `waiting` (requests waiting, the Mac in contact; ok, with the
   count), `mac_silent` (requests waiting and the Mac silent, per Decision 3; problem, so it joins Needs you with the
   `mac_waiting` phrase), and `unknown` (no Mac contact ever stored, or the lab tables can't be read; shown on Print lab,
   never a problem). A failed read never becomes `mac_silent` and never repeats the last value as current: it is
   `unknown` with "lab state unreadable". The record is computed in `records.refresh()` like the others, so it adds no
   thread.

5. **6.7 removes the HTTP surface, not the `printLab` store.** `app/display-lab.js` (the display's Judge it, on
   `/api/display/lab/*`) still uses the store in-process. Those routes retire with step 8 ("LocalAI's display routes
   and Services card retire"). Removing the store here would break them before step 8 replaces them. So 6.7 deletes
   `/api/lab/*`, the render code and the hub-key route entry, and leaves the store with display-lab as its only user,
   with a test that it serves no HTTP route. Rejected: folding step 8's display retirement into step 6.

6. **The log evidence is a persisted caller ledger in LocalAI, not Docker logs.** Each `/api/lab/*` request updates one
   row per (method, route shape, caller class) in LocalAI's DB: first seen, last seen, count. Caller class is
   `hub-key`, `device`, `mac`, `host` or `anonymous`; no key, cookie, IP or query string is stored. The first time a row
   appears, one log line names it. Readable signed-in at `GET /api/lab-callers`. It survives deploys, which Docker
   logs don't. Rejected: Docker logs (lost on every recreate) and a raw access log (stores more than the gate needs).

7. **The redirect is a real redirect to the real name.** Opening `#/printLab` in LocalAI replaces the page with
   `https://hub.rahe-home.duckdns.org/lab`, carrying `p`, `e` and `do`. LocalAI's Needs you lab items link there
   directly. `home.home.arpa` is not used: D4 keeps it only for the display and OTA.

## PRs, one at a time

| PR | Repo | Delivers | Requirement and coverage | Acceptance evidence |
| --- | --- | --- | --- | --- |
| 6.1 | pi-hub | `/lab?p=` (Decision 1) | §11 step 6, `?p=`: full | `node --test` for `?p=` + `?e=` + `do=judge`, an unknown `?p=`, and no `?p=`; the live link opens E-025's sheet |
| 6.2 | pi-hub | `mac_lab` record (Decisions 2-4), `lab_state` contact store, Print lab line, Needs you item | §4 `mac_lab`, §11 step 6: full | pytest for each state, the 3-minute edge, a failed read, a restart, and two projects; live: Versions/Print lab shows `idle` with a recent contact |
| 6.3 | pi-hub | Remove the LocalAI fallback in `sources._localai_lab` | D5.3, caller "Pi Hub": full | Test that `display_ai.call` is never asked for `/api/lab/*`; `git grep "/api/lab/projects" -- hub/sources.py` empty |
| 6.4 | LocalAI | Tab and Needs you redirect (Decision 7); caller ledger (Decision 6); names or retires the "five scripts" | D5.1: full; D5.3 inventory: partial (LocalAI's callers) | Browser test: `#/printLab?e=E-025` lands on Pi Hub's URL with `e`; ledger unit tests; shipped with `npm run ship` |
| 6.5 | print-lab | `lab/page.py:112` links Pi Hub `/lab` | D5.3, caller "print-lab": full | Test of the link; `release:print-lab` shows the commit |
| 6.6 | *owner* | The evidence window | D5.3 log evidence: full | See below |
| 6.7 | LocalAI | Remove `/api/lab/*`, the render code, its tests and the hub-key entry (Decision 5) | D5.3 removal, `printLab` retirement row: full | Tests: every `/api/lab/*` path is 404; display-lab tests still pass; the ledger stays readable |

6.1, 6.3 and 6.5 can merge independently. 6.2 is independent too. 6.4 needs 6.1 (it passes `p`). 6.7 needs 6.6.

**6.6, the evidence window (owner step).** After 6.3, 6.4 and 6.5 are live, the window must cover a period in which
the PC was up (LocalAI's `/healthz` answered; Pi Hub's `local_ai` record shows it), and the Mac was awake and syncing
(`mac_lab.last_contact` moving through the window, and at least one `lab sync`). In that window, the ledger must show no
`/api/lab/*` request after 6.4's deploy. The owner reads the ledger and `mac_lab` and declares the window met. It is not
scheduled by time.

## Acceptance for step 6

Recorded in `docs/operations.md` as "Step 6 accepted <date>", with:

- the `?p=…&e=…&do=judge` link opening the sheet on the live hub;
- `mac_lab` seen as `waiting` while the Mac is awake with a request queued, and `mac_silent` in Needs you after the
  Mac sleeps with one queued (a real request, then the lid closed: only the Mac's own pull is withheld);
- LocalAI's tab landing on Pi Hub;
- the ledger reading from 6.6;
- after 6.7, `/api/lab/projects` on LocalAI answering 404.

A matching SHA is a deploy, not acceptance. No status doc calls step 6 done before that line exists.

## Out of scope (noted, not gated)

- **LocalAI's stale lab store** feeds `app/display-lab.js` from 28 Oct data. The display's Judge it now runs on Pi Hub,
  so the live path doesn't use it. It retires with step 8; that plan owns it.
- **print-lab's `/api/workshop/status` read** from LocalAI (`lab/sync.py:274`) is telemetry, not the lab API. Moving
  it onto Pi Hub belongs to step 8's display/printer facts work.
- **D8, authoring on Pi Hub**, stays out ("not on Pi Hub's roadmap").
