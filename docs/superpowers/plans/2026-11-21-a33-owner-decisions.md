# A33 owner decisions: one list in Needs you, answered by a tap — Plan

Date: 2026-11-21. Status: **proposed** (approved when the owner merges this PR); nothing built.

## Goal

Questions that wait on the owner stop living in chat. Each one is a row in Pi Hub's Needs you, the owner answers it with
a tap on the phone, and any session reads the answer back before it asks again.

## Spec

- Amendment A33, `docs/superpowers/specs/2026-11-21-amendment-a33-owner-decisions.md`, approved by the owner's merge of
  pi-hub #294 and listed under the baseline's `## Amendments` in #295. It amends baseline §6 (Needs you is built from
  records) by adding one source whose rows are questions, not conditions.
- Builds on A7 (one page), A25 (every action reports the same way), A28 D5 (text from elsewhere is quoted, untrusted
  data), and the notify key model (step 5, `hub/notify_routes.py`).
- **Waits on:** nothing the spec names. A33 gives no "after N"; this plan adds no dependency. The order P1 → P2 → P3 is
  A33's own Migration section ("P1 appliance-ui …, P2 Pi Hub …, P3 home-mcp").

## Done means (A33 "Evidence required", quoted)

1. A decision added by key shows in Needs you on the phone; an unreadable table shows its own Needs item.
2. Tapping an option records the answer and time once (a double tap records once) and the row leaves the open list; a
   failed write keeps the row and says so.
3. home-mcp `decisions` returns the answer within one call of the tap.
4. A household-role session cannot answer; a request without a key cannot add.
5. Decision text appears in `decisions` output marked as untrusted.
6. Browser check at 390 and 1366 px, light and dark, axe clean, keyboard-only answer works.

## What exists today (read on 21 Nov 2026, `origin/main`: pi-hub `b5656e5`, appliance-ui `814ed40`, home-mcp `0112b6d`)

- **Needs you** is built by `hub/needs.py` `build()` (`:123`) and `current()` (`:193`), served at `GET /api/needs`
  (`hub/app.py:223`) with no sign-in check, so anyone on the home network can read it. It returns
  `{count, items, unread}` (`needs.py:190`); there are no groups. The printer folding (`PRINTER_THINGS`, `needs.py:31`,
  `:182`) runs over every item.
- **Who reads `/api/needs`:** the nav badge (`hub/static/js/navigation.js:190`, which keeps the last good value when a
  read fails), Home (`now.js:1234`, `:1262`, handing it to the badge through `setNeeds`), the wall and desk tiles
  (`now.js:909`, kit `ApplianceNeeds.renderList`), per-page notes (`page-parts.js:82`), the command palette
  (`command-palette.js:169`), and the display feed (`display_routes.py:87`, `needs.current(fetch=False)`).
- **Kit:** Needs rows come from appliance-ui `src/needs.js` (`render`, `renderList`, `PHRASES`, `WORDS`; `:85`, `:108`,
  `:127`). Pi Hub's synced copy is kit **2.25.0** (`hub/static/ui/VERSION`); appliance-ui `main` is already at **2.26.0**
  (#47, A27 D1–D3), not yet synced to Pi Hub.
- **Roles:** `hub/auth.py:19` `RANK = {none, kid, household, owner}`. Only the owner signs in now (`:17`); `who()`
  (`:225`) also treats the owner's own Tailscale devices as owner; `need(request, "owner")` (`:234`) is the owner gate.
  `auth.log()` (`:241`) writes `action_log` (90-day retention) with an optional `source_run`.
- **Machine keys:** two exist on the Mac, and A33 names them inconsistently (see decision 1):
  - the **`mac` deploy key**, header `X-Hub-Deploy-Key`, checked by `releases.host_key_ok(request, "mac")`
    (`hub/releases.py:67`); it is mac-watch's key for `/api/notify/mac-watch` (`notify_routes.py:25`). The Mac keeps it
    in the login Keychain, service `pi-hub-deploy-key` (`docs/operations.md:109`); the Pi keeps only its SHA-256 in
    `/etc/pi-hub/secrets/deploy_keys/mac.sha256`.
  - the **lab key**, header `X-Hub-Mac-Key`, checked by `lab_guard.mac_key_ok` (`hub/lab_guard.py:24`), print-lab's key.
- **Input checks to reuse:** `notify_routes._line()` (one-line text, `:65`) and `_click()` (https on a known host, `:71`).
- **home-mcp** sends no credentials today (`src/home_mcp/hub.py:27-39`, only `Accept`). Every tool returns `ok:false` with
  the failing source rather than guessing.
- **Nothing of A33 exists:** no `decisions` table, route, kit component or home-mcp tool (`git grep -i decision` on
  `origin/main -- hub` finds only unrelated text).

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Which key adds a decision: the `mac` deploy key.** A33 Call 2 says "the existing `mac-watch` key
   (`X-Hub-Mac-Key`)", but those are two different keys: mac-watch uses the `mac` deploy key in `X-Hub-Deploy-Key`;
   `X-Hub-Mac-Key` is print-lab's lab key. Two readings:
   - (a) the `mac` deploy key, `host_key_ok(request, "mac")`: matches "mac-watch key" and Call 2's intent ("the sessions
     that ask run on the Mac", "no new key file"). It is already a host key for reporting to Pi Hub.
   - (b) the lab key: matches the header name, but widens print-lab's key, whose scope is the lab, to decisions.
   **Chosen: (a).** The words "mac-watch key" and the reason given (the Mac, no new key) point to it; the header name reads
   as a slip. A33's wording is left as it is (it is frozen); this decision is the record.
2. **The same key reads decisions.** A33 owner call 1 says the read route needs a key and home-mcp gains one key setting.
   home-mcp runs on the Mac, so it reads the `mac` deploy key from the Keychain (`security find-generic-password -s
   pi-hub-deploy-key -w`), or from `HOME_MCP_HUB_KEY` when set. Trade-off: one key now both reports releases and reads and
   adds decisions; a separate decisions key would limit a leak's reach but adds a key file, which Call 2 rules out.
3. **Where the page gets decisions: inside `/api/needs`, for the owner only.** `/api/needs` stays open (the wall and the
   display read it unsigned). When `who()` is owner, the response gains `decisions: {open: [...], answered: [...last 5]}`;
   for any other caller the key is absent, not empty, so nothing hints that decisions exist. The machine read is
   `GET /api/decisions` (key only). Rejected: a second page request from Home, which would add a second failure case to
   every Needs render.
4. **Counts and the badge.** As owner call 2 settled: decisions never enter `count`, `items`, the wall, the display feed
   or the printer folding. `needs.build()` is not touched; decisions are attached in `app.py` after `needs.current()`.
5. **Reads that fail are visible, not empty.**
   - The table can't be read for an owner caller: `decisions: null` and one `bad` item `pi:decisions:unreadable`
     ("Decisions can't be read") added to `items` (A33 Call 7). That item is a fault, so it counts like other faults.
   - `GET /api/decisions` failing: 503 with a reason; home-mcp reports `ok:false, source:"pi-hub decisions"`, never an
     empty list.
   - The page: if `/api/needs` fails, the Decisions group keeps its last shown rows marked "Not current", the same as
     the badge (`navigation.js` keeps the previous value).
6. **The write, once.** `POST /api/decisions/{id}/answer` (owner) runs
   `UPDATE … SET answer=?, answered_at=? WHERE id=? AND answered_at IS NULL`. If no row changed, it reads the row: the
   same answer returns 200 with the stored one (a double tap); a different answer returns 409; an unknown id returns
   404. The answer must be one of `options` (choice) or 1–500 characters (text). It is logged as `decision:<id>` in
   `action_log`, result `answered`.
7. **Adding and asking again.** `POST /api/decisions/{source}` (key) with a slug `id` (`^[a-z0-9][a-z0-9-]{2,63}$`).
   - The same id while it's open updates the question, options and link in place (A33 Design).
   - The same id after it's answered returns 409, and the answer is returned in the body so the session reads it rather
     than asking again.
   - A new id may name `supersedes` (an answered id); the old row stays as it is.
   - `source` is a fixed list for now: `claude` (sessions on the Mac). An unknown source is 404.
8. **Limits** (A33 Call 6): two to four options of 1–60 characters each, no duplicates; question 1–280; `recommended`
   one of the options or absent; `link` through `notify_routes._click()`; text answer 1–500. A body that breaks any
   limit is 400 and nothing is stored. Text is one line (`_line`) except the text answer, which keeps newlines.
9. **Retention.** Open rows are kept until answered; answered rows are cut to the newest 50 on each write (Call 8).
   `CREATE TABLE IF NOT EXISTS` on first use (Call 9), with columns as A33 Design lists them plus `supersedes`.
10. **Untrusted text in home-mcp.** The `decisions` tool returns the question and options inside
   `<<<UNTRUSTED_DECISION … UNTRUSTED_DECISION>>>` markers, with any marker inside them defused, and a fixed note that the
   text is data. The answer is the owner's own and is returned plainly.
11. **Kit release order.** P1 is a kit minor release (2.27.0) that adds the decision row on top of 2.26.0. Syncing it
   into Pi Hub also brings 2.26.0 (A27's Developer-tools cards). P2's sync step therefore checks with whoever owns A27's
   Pi Hub half that 2.26.0 can go to Pi Hub, and stops and asks if not.

## PRs, one at a time

Each names A33 and the criteria it covers, says whether coverage is full or partial, and carries its evidence.

### P1 — appliance-ui: the decision row (kit 2.27.0)

- `ApplianceNeeds.renderDecisions(group, { onAnswer, stale })` in `src/needs.js`, plus styles in `src/needs.css`:
  - a heading "Decisions (n)";
  - one row per open decision: the question, two to four option buttons with the recommended one marked
    "Recommended", and a "Read the plan" link;
  - a text decision gets a labelled box and one "Send" button;
  - while saving, the buttons are disabled and the row reads "Saving…";
  - when an answer fails, the row reads "Not recorded, try again" and stays open;
  - when it's recorded, the row reads "Recorded: <answer>";
  - a group passed `stale` reads "Not current".
- Native `<button>` and `<label>`, visible focus, no motion beyond the kit's `motion.js` (reduced motion respected).
  Phrases go in `PHRASES`/`WORDS`.
- Tests in the kit: the render states above, keyboard order, a long question and a 60-character option at 320 px, and
  `onAnswer` called once per tap even with a double click.
- Covers: criterion 6, partially (the component; the page check is in P2). Evidence: kit tests, the demo screenshot at
  390 and 1366 px in light and dark, axe on the demo.

### P2 — Pi Hub: table, routes, the Decisions group (needs P1's release synced)

- `hub/decisions.py`: the table, `add()`, `answer()`, `open_and_recent()`, and the input checks (decisions 6–9).
- Routes in `hub/app.py`:
  - `POST /api/decisions/{source}`, which needs the key;
  - `GET /api/decisions`, which needs the key;
  - `POST /api/decisions/{id}/answer`, which needs `need(request, "owner")` and `same_origin`, like the other owner
    writes;
  - `/api/needs` gains `decisions` for an owner caller only (decisions 3–5).
- Home's Needs you card draws `ApplianceNeeds.renderDecisions` under the condition rows. A tap posts the answer, and the
  row changes to "Recorded" from the response, not from a guess.
- Sync step: kit 2.27.0 into `hub/static/ui/` (decision 11).
- Tests (`tests/test_decisions.py`, and a browser suite):
  - adding with the right key, with no key or another host's key (401), and with print-lab's lab key (401);
  - a double tap stores one answer; a different answer is 409; an unknown id is 404;
  - asking again while open updates the row; asking again after it's answered is 409 with the answer in the body;
  - a household or kid role is refused; a non-owner `/api/needs` call has no `decisions` key;
  - `count` and the wall and display feeds don't change when decisions are added;
  - an unreadable table gives one `bad` item and `decisions: null`, and never an empty list;
  - two open decisions keep their order, and answering one leaves the other;
  - retention keeps 50 answered rows;
  - each limit in decision 8;
  - a failed answer POST (network error, then 500) keeps the row and says so.
- Covers criteria 1, 2, 4 and 6 in full on staging data. Evidence: test output, a browser check at 390 and 1366 px in
  light and dark, axe, a keyboard-only answer, and the commands with their exit codes.

### P3 — home-mcp: the `decisions` tool

- `decisions()` calls `GET /api/decisions` with the key from decision 2. It returns `open` and `recently_answered` with
  `asked_at`, `answered_at`, `answer` and `supersedes`, and wraps the question and options as in decision 10.
- Missing key: `ok:false`, "no key: set HOME_MCP_HUB_KEY or the Keychain item". A 401, 503 or timeout is `ok:false` with
  the source. It never returns an empty list in place of a failure.
- The server description tells sessions to read `decisions` before asking the owner anything, and when they resume work.
- Tests: the markers (including a question that contains a marker), each failure case, a key that's present but wrong,
  and two decisions where one is answered.
- Covers criteria 3 and 5 in full. Evidence: tests, and after deploy one live call that returns a decision answered on
  the phone.

### P4 — load the first decisions, then live acceptance (owner step at the end)

- A session adds the four open questions A33 names, each with a link to its spec:
  - A27 Activity shape;
  - A27 Developer-tools depth;
  - A30 listing in the baseline;
  - A28 print route.
  If one has been answered in the meantime, it is left out.
- **Owner:** on the phone, open Home, check the four rows, and answer one by tapping. A session then reads it with
  `decisions`.

## Criteria → where they are evidenced

| Criterion | Step | Evidence |
|---|---|---|
| 1 added by key shows; unreadable has its own item | P2, P4 | tests; owner sees the rows on the phone |
| 2 one answer per tap; failed write keeps the row | P1, P2 | double-tap and failed-POST tests; owner's tap in P4 |
| 3 home-mcp returns the answer within one call | P3, P4 | live call after the owner's tap |
| 4 household can't answer; no key can't add | P2 | role and key tests |
| 5 text marked untrusted | P3 | marker tests |
| 6 390/1366, light/dark, axe, keyboard | P1, P2 | screenshots, axe output, keyboard run |

## Acceptance

The ladder is merged, deployed, runtime verified, then accepted. A matching SHA on the Pi is a deploy, not acceptance.
A33 is accepted when P4's owner step has been seen and the six criteria are recorded with their evidence in
`docs/operations.md` under "Owner decisions (A33)" as "Accepted <date>". No step marks A33 implemented before then.

## Owner steps

- Merge this plan (approves decisions 1–11).
- Approve the kit sync in P2 if it carries 2.26.0 before A27's Pi Hub half is ready (decision 11).
- Deploys of P2 follow the usual preflight; no service restart is needed (the table is created on first use).
- P4: answer one decision on the phone.

## Out of scope (noted, not gated)

- **Push on a new decision, a history view, expiry, more than one owner:** out of the first version by A33. A follow-up
  amendment if wanted.
- **`page-parts.js:82` treats a failed `/api/needs` read as no items** (`catch { items = [] }`), so a page's Needs note
  disappears on a failed read. That is the failed-read-shown-as-empty pattern A33 forbids for decisions; it predates A33
  and belongs to a separate Pi Hub fix (to be filed as an issue when P2 opens).
- **The mismatch in A33 Call 2's wording** is settled by decision 1 here. If the owner wants the spec text corrected, that
  is a one-line amendment note, not an edit to the approved file.
