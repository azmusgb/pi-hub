# Platform step 2a: outside alarm status on System › Health — Plan

**Goal:** System › Health shows what Healthchecks.io itself sees of the outside alarm ("Up · last check-in 2 min ago"),
and a check that goes Late, Down or Paused while Pi Hub is up becomes a Needs-you item, so a silently broken alarm is
found before a real outage goes unreported.

**Spec:** `docs/superpowers/specs/2026-11-01-amendment-a1-outside-alarm-status.md` (amendment A1, approved in #37 on
1 Nov 2026, so it is part of the baseline), adding **§11 step 2a** to
`docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`. Touches §4 (new record kind
`outside_alarm`), §7 (Health gains the Healthchecks.io API as a source), §9 (phrase key `outside_alarm_quiet`) and §10
(failure boundaries). It waits on: "It comes after step 2 (done 1 Nov 2026) and is independent of steps 3-10." Step 2 is
accepted (operations.md "Accepted 2 Nov 2026"). Nothing waits on 2a, and 2a is not a gate for step 3, 5 or C1.
C1 only has to appear in this view when its `offsite-backup` check exists ("`home-platform-alive` now, and C1's
`offsite-backup` when it exists"). It exists since 4 Nov (C1 set up on Google Drive, A5), so 2a reads two checks from its
first day.

> **Refreshed 5 Nov 2026** against `main` `a44ef20`: Health is now `/system` on A7's page anatomy, so 2a.4 is
> rewritten for its "Other systems" section; C1's `offsite-backup` check is live, which makes decision 6's wording
> question real; kit 2.6's phrase table carries item wording, which settles decision 10. Marked **(changed)** below.

## Done means

A1's own acceptance list, quoted and numbered. Step 2a is accepted only when all four are seen and recorded.

1. "With the read-only key in place, System › Health shows `home-platform-alive` as Up, with a last check-in matching the
   dashboard."
2. "Stopping only the heartbeat timer shows Late, then Down, on the row, and raises the Needs-you item. Restarting the
   timer clears both."
3. "With the key file absent, the row shows `unknown` ('not set up'), with no Needs-you item and no errors in the log."
4. "No response, log line or page ever contains a ping URL or the API key."

## What exists today (read on 5 Nov 2026; first read 3 Nov)

Refreshed on 5 Nov against `origin/main` `a44ef20` (Pi Hub live at the same commit, `mcp__home__releases`). What changed
since the 3 Nov reading is marked **(changed)**.

- **Nothing of A1 is built.** `git grep outside_alarm origin/main -- hub deploy tests` matches nothing. The only open
  pi-hub PR is this plan (#74). No other plan for 2a in `docs/superpowers/plans/`.
- **Live records:** `mcp__home__hub_now` (5 Nov) lists the hub's records and 7 `release:*` records. No `outside_alarm`.
- **The alarm itself works.** `ssh pi`, 5 Nov 17:58: `pi-hub-heartbeat.timer` last ran 17:58:16 and next fires
  18:03:16. `/etc/pi-hub/healthchecks.env` exists. Pi Hub cannot read it, by design (`docs/operations.md`, "Outside
  heartbeat"). Check `home-platform-alive`: period 5 min, grace 5 min; step 2's acceptance saw Down 10 min after the
  last ping.
- **(changed) C1's check exists.** Backrest's `pi-offsite` plan pings `offsite-backup` on snapshot success (period 1 day,
  grace 6 h; operations write-up #101). C1 was accepted on 5 Nov (#109) after its alarm test. So the project holds two checks today, and decision 6's wording question is no longer
  hypothetical.
- **(changed) Healthchecks.io is a registry tool:** `hub/static/ui/tools.js:20`, id `healthchecks`, "Outside alarms: the
  house heartbeat and the off-site backup" (kit 2.4.0). Health's "Open in" can link it; that link is not the status.
- **The key file:** on 3 Nov, `/etc/pi-hub/secrets/` had no `healthchecks_ro.env`; the files the hub reads there are
  `root:pi-hub 0640`. On 5 Nov the folder (`root:pi-hub 750`) can't be listed without sudo from the SSH user, and no
  one has reported creating the key. The plan assumes it is still absent; 2a.6 step 2 confirms that on the live page
  before the owner creates it.
- **(changed) Where the row goes.** Step 7 is done: Health is `/system` (`hub/static/js/health.js`); `/pi` is only a
  redirect (`routes.js`). A7 H4 drew Health on the page anatomy, with a closed "Fixes" section
  (`health.js:585-614`). Its **"Other systems"** section (`health.js:838-870`, `otherSystemRows`) already reads
  records, in its own slot that stays when the Pi's diagnostics fail (`health.js:114`). Every Needs-you item about the
  hub now links `/system` (`now.py:55-111`).
- **(changed) The phrase table carries item wording.** The kit's `needs.js` PHRASES (Pi Hub synced at kit 2.6.0,
  `hub/static/ui/VERSION`; appliance-ui `main` is at 2.7.0) holds "the platform's terms (spec section 9)": `pc_off`,
  `assistant_down`, `source_down` (`hub/static/ui/needs.js:11-12`). That settles the 3 Nov open question in decision 10.
- **Record plumbing to follow** (`origin/main`):
  - `hub/releases.py` is the precedent for a record kind outside `KINDS`: its own `ids()`, severities, `put()` under the
    records lock (`merge` + `store`), labels and hrefs registered at import, and records exempt from the stale marking on
    load (`records.py:249`, `startswith("release:")`).
  - `records.py:142` `merge`; `records.py:109` `_not_answering` (raises an unreadable record to `attention`, wrong for this
    kind: `unknown` is Health-only); `records.py:263` `problems()` (attention and up feed Home and Needs you).
  - `needs.py:139` builds the item id and takes `key.startswith(("source:", "release:"))`; `now.py:130-133` `issue_from`
    titles an item `LABELS.get(rec["id"], rec["id"])`, which would print a raw id for a dynamic id.
  - `app.py:148-150` `records_body` lists `[*records.KINDS, *releases.ids()]`. `freshness.py:66` and `ask.py` iterate only
    `KINDS`. **(changed)** `today.py:59` (A8's Today, another session's work) iterates `releases.ids()` only, so a kind
    outside both stays out of it too.
  - `app.py:36-40` starts the loop threads; `events.run` is the 30 s loop and must not block on a slow outside call.
  - `bambuddy.py` reads a key file once per call with `OSError` tolerated; `sources.py` `_get_json`.
- **Python on the Pi:** 3.13. `pi-hub.service`: `User=pi-hub`, `ProtectSystem=strict`, writes only to
  `/var/lib/pi-hub`. Reading a 0640 `root:pi-hub` file and calling out over HTTPS (Open-Meteo already does) need no unit
  change and no firewall change.
- **The API contract is the amendment's**, not re-verified live (no key exists to call it with, and calling it is out of
  scope for planning): `GET https://healthchecks.io/api/v3/checks/` with `X-Api-Key`; a read-only key's responses omit
  `ping_url` and `uuid` and carry `unique_key`.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Record id is `outside_alarm:<unique_key>`; one placeholder `outside_alarm` stands in until a check has been read.**
   The spec identifies checks by `unique_key`, but with no key file or no successful read there is no `unique_key` to use,
   and the spec still wants an `unknown` "not set up" record. No configuration or spec names a check's `unique_key` in
   advance (A1 discovers checks from the project list), so an expected-check record isn't possible. The placeholder is
   therefore a **configuration/status record**, not a check record: it says "not set up" or "never read", and it is the
   only record of its shape. The first successful read replaces it with the per-check records in one `put()` under the
   records lock, so the two shapes never coexist. Lifecycle tests: it exists before the first success; the first success
   replaces it atomically; it never coexists with check records; a restart before the first success keeps exactly one;
   a failed read after discovery never brings it back. Rejected: keying by the check's name (a rename would orphan the
   record) or hard-coding `home-platform-alive`.
2. **Two facts in one record, using only the spec's states.** `state` is what Pi Hub can say now: the mapped status
   after a good read, `unknown` otherwise. `detail.last_seen = {state, last_ping, at}` keeps the last good reading. The
   headline then says "Unknown · last seen Up 4 min ago, Healthchecks.io not answering", never "Up". The cost: a failed
   read hides a real `down` behind `unknown`, which is Health-only by spec §4 of A1. That is accepted by the spec ("the
   outside path can't tell the two cases apart"); the Healthchecks.io email still covers it.
3. **`outside_alarm` unknown is severity `info`, not the default `attention`.** The spec says unknown "shows on Health
   only. It is not a Needs-you item". `KINDS` makes every `unknown` attention, and `_not_answering` also lifts a quiet
   record to attention, so this kind bypasses both, like `releases.py`. Late, down and paused are `attention`,
   shown as tone warn (A1 "severity warn"; same mapping as step 3 decision 4).
4. **A restart loads every `outside_alarm` record as `unknown`, carrying its prior state into `last_seen`,** until the
   first successful read. It is a reading, so it is never shown as current after a restart, and it cannot raise a
   Needs-you item from a stale `down`. Rejected: loading as it was (what step 3 does for release facts) because those are
   facts about a past deploy, not readings.
5. **A check missing from a successful list becomes `unknown`, "No longer listed by Healthchecks.io", and the row stays.**
   Absent is not unreachable, and the old Late/Down must not outlive the check, so it is replaced, not kept. A1 names
   "the check is deleted" as a silent failure, but its state set has no state that alarms for it, so this plan cannot make
   it a Needs-you item without adding a state. *That is a gap for the owner: if a deleted alarm should raise, it needs an
   amendment.* The cost of keeping the row: a check deleted on purpose leaves a row on Health until a later cleanup
   (see Out of scope).
6. **Every check the project lists gets a record** (A1 change 1: "one record for each check in the Healthchecks.io
   project: `home-platform-alive` now, and C1's `offsite-backup` when it exists"). This is the spec's rule, so the
   project's scope is part of the integration contract: the project holds only Pi Hub's outside alarms, and
   `docs/operations.md` (2a.5) says so beside the key. A check added later appears without a code change, which is how
   C1's `offsite-backup` arrived (4 Nov). Cost: an unrelated check someone adds to that project would show, and would
   raise the alarm wording if Late. *Open question for the owner, now live:* A1's phrase ("isn't hearing from the Pi")
   is right for `home-platform-alive` but wrong for `offsite-backup`, where silence means the off-site backup didn't
   finish. As written, a late backup would read "The outside alarm isn't hearing from the Pi", with "offsite-backup:
   Late, last check-in 31 h ago" as its detail. This plan uses the phrase as A1 says and names the check in the detail;
   giving `offsite-backup` its own wording needs an amendment to A1, which this plan doesn't assume. Rejected: an allow-list by name (breaks the rename rule). Display label is the check's `name`; two checks with the same name are told apart by their order of
   `unique_key`, shown as "name (2)".
7. **A separate daemon thread reads every 5 minutes (spec's interval), with a 5 s timeout,** started beside the others at
   `app.py:36-40`. The 30 s `events.run` loop reads the printer and must not wait on the internet, and the internet being
   down is the case this feature has to survive. The thread writes through `put()` under the records lock, like
   `releases.put`. A failed read is retried at the next 5-minute slot, not every 30 s. Lifecycle: one exception boundary
   around each pass, so a bad pass is logged by class and the loop continues; passes never overlap (one thread, the next
   slot is scheduled after the pass ends, on the monotonic clock); the first read runs 10 s after start; the thread
   stamps `last_pass_at`, and if that is older than two intervals, `now.build` shows the row as `unknown`, "the reader
   has stopped", so a dead thread can't look like a quiet, healthy alarm. Rejected: calling it from `loop_pass` like
   `releases.loop`, which would stall printer records for up to the timeout every 5 minutes.
8. **Key file format: one line `HC_API_KEY=<key>`** in `/etc/pi-hub/secrets/healthchecks_ro.env`, `root:pi-hub 0640`
   (the spec's path and mode). It matches the format of `/etc/pi-hub/healthchecks.env` (`HC_PING_URL=`). A missing,
   empty, malformed or unreadable file is "not set up". The value is never echoed in any message.
9. **A 401 or 403 is "Healthchecks.io did not accept the key", state `unknown`.** That is all the API tells us. The plan does
   not claim to detect whether a key is read-only: whether it is is shown by the owner creating it as read-only in the
   dashboard (acceptance step), and by the API leaving out `ping_url`. If a response does carry `ping_url`, the
   parser drops it and never stores or logs it; it does not change behaviour.
10. **The Needs-you title is the phrase, the detail names the check.** Item title: "The outside alarm isn't hearing from
    the Pi" (spec). Detail: "<check name>: Late, last check-in 12 min ago." One item per check, id
    `pi:outside_alarm:<unique_key>`, link `/system` (Health). **(Settled on 5 Nov.)** The 3 Nov question was whether the
    kit's phrase table labels actions only or also carries item wording. Since kit 2.6.0 it carries section 9's terms
    as item wording (`pc_off`, `assistant_down`, `source_down`, beside the action verbs), so `outside_alarm_quiet` joins
    them as a term: added in appliance-ui first, then synced, because the table has one owner. The item is built by
    the server (`now.py`, Python), which can't load the synced JS table at run time, so the hub keeps the title as a
    Python constant and a test asserts it equals the synced `hub/static/ui/needs.js` entry; a sync that changes the
    words fails that test until the constant follows. `sections.js:92` already keeps a local copy of `pc_off` and
    `assistant_down` with no such test; this plan doesn't repeat that gap (fixing that copy is out of scope).
    Rejected: parsing `needs.js` at start-up (a JS file as a runtime config).
11. **The rows live in Health's "Other systems" section** (`/system`, `health.js` `otherSystemRows`), one per check,
    beside Local AI, the Workshop display and the PC. **(Changed on 5 Nov:** the 3 Nov plan put them on `/pi`, before
    step 7 made it Health.) That section already reads records and survives the Pi's diagnostics failing, which is the
    situation this row has to report in. Rows follow A7's anatomy: text left, the lamp (dot and word) and the
    "last check-in" on the right (P3); no new section, no card, no control. Rejected: a new "Outside alarms" section
    (Health keeps at most six, A7 P1) and the faceplate (the faceplate is the Pi's own state).

## Read-from-another-system answers

1. **Observed vs can observe.** Cases, each a named test:
   | Case | state | headline |
   |---|---|---|
   | key file absent, empty or malformed | `unknown` | Outside alarm · not set up |
   | key present, never read yet | `unknown` | Not read yet |
   | read OK | mapped status | "Up · last check-in 2 min ago" |
   | read fails after a good read | `unknown` | last seen Up (or Late/Down) N min ago, Healthchecks.io not answering |
   | read fails after a bad read (late/down) | `unknown` | same; the Needs-you item clears, it is not current |
   | key refused (401/403) | `unknown` | Healthchecks.io did not accept the key |
   | restart while unreachable | `unknown` | last seen X (from before the restart) |
   A failed read never creates `late`, `down` or `paused` (no false alarm) and never leaves the old value as current.
2. **Identity.** `unique_key`. Renamed: same record, new label. Duplicate names: two records. Reordered: no change (sorted by
   label then key). Absent from a good response: decision 5. Never-listed things (other accounts' checks) never appear,
   because the key is project-scoped. A stored bad state does not outlive its check.
3. **Parser contract.** Needs a JSON object with a `checks` list. Per check, requires `unique_key` (string, 1-64
   chars), `name` (string, up to 200 chars, stored whole; clipped only on the page), `status` in `{new, up, grace, down, paused}`, and `last_ping` either null or
   an ISO 8601 timestamp. Present but malformed is not absent: a known `unique_key` with a bad field becomes `unknown`,
   "Healthchecks.io returned an unreadable check", never "No longer listed". An entry with no usable `unique_key` is
   skipped and counted. An unknown `status` value becomes `unknown` for that check only, never an exception. Added fields are ignored. Nothing raw is stored or logged: only the
   mapped state, `last_ping`, name and `unique_key` are kept; `ping_url`, `uuid`, `pause_url` and the like are never copied. Log
   lines carry the error class and HTTP status only, never the body or headers.
4. **Detection latency (worst case, from the last good ping P):**
   - P+5 min: Healthchecks.io's status becomes `grace` (period 5 min).
   - up to P+10 min: Pi Hub's next 5-minute read sees `late`; the record updates and the Needs-you item appears on the next
     `now.build`. About 10 min after the last ping plus the 5 s timeout.
   - P+10 min: Healthchecks.io emails "down" (step 2 saw this at exactly 10:00 after the last ping).
   - up to P+15 min: Pi Hub's read sees `down`.
   - The phone push follows the existing push rules after the item exists; this plan measures it, it does not set it.
   The 5-minute interval is the spec's: A1 change 2, "Every 5 minutes, Pi Hub calls `GET …/api/v3/checks/`". A shorter
   poll (60 s) would bring the item to about P+6 min, but it would change the spec, so it would need an amendment. This
   plan keeps 5 minutes and records the latency above.
5. **One owner per shared thing.** The phrase key is added in appliance-ui, then synced into `hub/static/ui/needs.js`;
   no local copy is left. The module is `hub/outside_alarm.py`. The heartbeat's ping URL stays in
   `/etc/pi-hub/healthchecks.env`, root only, never read by Pi Hub.

## PRs, one at a time

Coverage is per PR; each PR body names its requirement, full or partial coverage and the evidence below (the owner's
rule for migration PRs).

### PR 2a.1 (appliance-ui): the phrase key

- **Requirement:** A1 change 5 (`outside_alarm_quiet`, spec §9). **Partial:** the wording only.
- Add `outside_alarm_quiet: "The outside alarm isn't hearing from the Pi"` to PHRASES in `src/needs.js`, among the
  section 9 terms, and to the matching list in `tests/needs.test.mjs`; bump the kit to the next minor (2.8.0; `main` is
  2.7.0). Pi Hub's sync in 2a.3 then takes 2.6.0 → 2.8.0, which also brings 2.7's table and icon button: no Pi Hub
  page uses them yet, so the sync changes no page.
- **Evidence:** the appliance-ui test suite output with a new test for the key. Merges alone.
- Not an owner step.

### PR 2a.2 (pi-hub): the record, the reader and the loop; no UI

- **Requirement:** A1 changes 1 and 2, §4 `outside_alarm`. **Partial:** backend and records. Done-means 3 and 4 (the
  tests), and the machinery for 1 and 2.
- **Files:** create `hub/outside_alarm.py` and `tests/test_outside_alarm.py`; modify `hub/app.py` (start the thread beside
  lines 36-40; add `outside_alarm.ids()` to `records_body`, lines 148-150), `hub/records.py` (load, near line 249:
  convert `outside_alarm:*` to `unknown` with `last_seen`; leave `_not_answering` alone by never routing this kind
  through it). Not `today.py` (A8's Today lists releases, not outside alarms).
- **Interfaces:** `parse(body) -> list[dict] | None`; `read_key(path) -> str | None`; `fetch(key, timeout) -> body | error
  class`; `put(checks_or_failure, now)` under the lock; `poll_once(now, fetch=…)`; `run()`.
- **Named tests:**
  - parser: `test_maps_the_five_statuses`; `test_requires_unique_key_name_status`; `test_unknown_status_is_unknown_not_an_error`;
    `test_added_fields_are_tolerated`; `test_last_ping_null_and_bad_timestamp`; `test_ping_url_and_uuid_are_never_stored`;
    `test_not_a_checks_list_is_a_failed_read`.
  - observed vs can observe: `test_no_key_file_is_not_set_up`; `test_empty_and_malformed_key_file_are_not_set_up`;
    `test_never_read_yet`; `test_read_ok_up`; `test_failed_read_after_good_read_is_unknown_with_last_seen`;
    `test_failed_read_after_down_is_unknown_not_down`; `test_401_says_key_not_accepted`; `test_restart_while_unreachable_loads_unknown`;
    `test_failed_read_never_creates_late_or_down`.
  - identity and multiplicity: `test_record_is_keyed_by_unique_key`; `test_rename_keeps_the_record`;
    `test_two_checks_with_one_name_stay_two_records`; `test_reorder_changes_nothing`; `test_two_checks_one_late_one_up`;
    `test_check_absent_from_good_read_becomes_unknown_not_stale_down`; `test_placeholder_removed_after_first_read`; `test_placeholder_never_coexists_with_checks`; `test_restart_before_first_read_keeps_one_placeholder`; `test_failed_read_after_discovery_does_not_recreate_placeholder`; `test_known_check_malformed_is_unreadable_not_unlisted`; `test_long_name_stored_whole`.
  - secrets: `test_key_and_ping_url_never_in_api_records_logs_or_exceptions` (scans `/api/records`, captured stderr and
    the SQLite `records` table for the key string, `ping_url`, `uuid` and `healthchecks.io/ping`).
  - infrastructure: `test_slow_fetch_does_not_block_loop_pass`; `test_pass_exception_does_not_kill_the_thread`; `test_passes_never_overlap`; `test_stale_last_pass_shows_reader_stopped`; `test_outside_alarm_is_not_in_freshness_ask_or_today`.
- **Test commands:** `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests`; `node --test tests/*.mjs`.
- **Evidence:** pytest output with the file's tests named. Merges independently of 2a.1, 2a.3 and 2a.4. After deploy,
  `mcp__home__hub_now` (and `/api/records`) lists `outside_alarm` as `unknown`, "not set up", which is also live
  evidence for done-means 3.
- Backend-only: not an owner step except for the deploy approval.

### PR 2a.3 (pi-hub): the Needs-you item

- **Requirement:** A1 change 4 and 5. **Partial:** the alert path. Done-means 2 (the item half).
- **Depends on:** 2a.2 (records) and 2a.1 (phrase), merged first so the sync has no temporary copy.
- **Files:** sync the kit from appliance-ui (`node ~/dev/appliance-ui/scripts/sync.mjs`, not by hand);
  `hub/needs.py:139` (prefix `outside_alarm:` joins `source:` and `release:` for the item id); `hub/now.py`
  (`issue_from`, lines 130-133: for this kind the title is the phrase and the detail names the check, href `/system`);
  `hub/outside_alarm.py` (the title constant, decision 10); `tests/test_needs.py`.
- **Named tests:** `test_late_down_paused_raise_one_item_each`; `test_up_new_and_unknown_raise_nothing`;
  `test_unknown_after_down_clears_the_item`; `test_two_late_checks_two_items_with_distinct_ids`;
  `test_title_matches_the_synced_phrase`; `test_item_links_to_health`; `test_up_does_not_appear_on_home`;
  `test_item_detail_never_contains_a_url_or_key`.
- **Evidence:** pytest output; the sw.js `SHELL` bump (from `pi-hub-shell-v155`, `tests/test_appliance_ui.py`) because
  a static file changed.
  Merges after 2a.1 and 2a.2.

### PR 2a.4 (pi-hub): the outside alarm rows on Health

- **Requirement:** A1 change 3, §7. **Partial:** the page. Done-means 1 (display half).
- **Files:** `hub/static/js/health.js` (`otherSystemRows` gains one row per `outside_alarm` record, from the records it
  already reads; label "Outside alarm · <check name>"; right side "Up · last check-in 2 min ago"; unknown rows show last
  seen and the cause), drawn as A7's lamp-right row (decision 11); `hub/static/sw.js` (`SHELL` bump from
  `pi-hub-shell-v155`); `tests/test_health_other_systems.mjs`.
- **States designed:** loading, not set up, never read, up/late/down/paused, last seen while unreachable, no longer listed, two
  checks, a long check name (clipped on the page only, full name in `title`), records fetch failing (row says "couldn't read", not blank).
  Keyboard: the row is plain text, with no new controls. Late/down/paused use text, not colour alone.
- **Named tests:** `test_row_renders_each_state`; `test_unknown_row_never_says_up`; `test_two_checks_two_lines`;
  `test_long_name_is_clipped`; `test_row_survives_a_failed_records_fetch`; `test_time_ago_uses_last_ping_not_as_of`.
- **Evidence:** node test output, and screenshots of each state from the test fixtures at 390 and 1440 px, dark and
  light, with axe over Health (A7's check for a Pi Hub page). Merges independently of 2a.3.

### PR 2a.5 (pi-hub): operations doc

- **Requirement:** A1 "Owner action before implementation". **Partial:** docs.
- `docs/operations.md`, "Outside heartbeat": a subsection "Outside alarm status (A1)" with where the key lives and how to
  create it (Settings › API Access, read-only key, `HC_API_KEY=` in `/etc/pi-hub/secrets/healthchecks_ro.env`, `root:pi-hub
  0640`, put on the Pi without pasting into chat), the acceptance steps below, and an empty "Accepted" line to be filled
  in 2a.6. State the recovery: the key is in the nightly `/etc/pi-hub` backup like the other secrets, and it is
  replaceable: if the Pi is lost, create a new read-only key in Healthchecks.io. No part of recovery needs the lost host.
- **Evidence:** the diff. Merges independently, but should merge with or before the deploy so the owner has the steps.

### Step 2a.6: live acceptance (owner)

The sequence matters: criterion 3 needs the key absent, so it is observed before the key exists.

1. **Deploy** 2a.2-2a.4 to the Pi. (Deploy preflight first; deploys need no confirmation.) Record: deployed.
2. **Runtime check, key absent (done-means 3).** `mcp__home__hub_now` and Health's Other systems show the row `unknown`, "not set up";
   no Needs-you item; `ssh pi 'journalctl -u pi-hub --since "10 min ago" -p warning'` shows no new errors.
3. **Owner:** create the project's read-only key in Healthchecks.io and put it on the Pi at the path above, without
   pasting it in chat. (Owner's account; no service restart is needed because the thread re-reads the file every cycle.
   If the owner prefers a restart, that needs their confirmation.)
4. **Done-means 1:** within one 5-minute cycle, Health shows `home-platform-alive` Up; the "last check-in" matches the
   dashboard's last ping within the poll interval (record the two times).
5. **Owner, with confirmation (service action): done-means 2.** Stop **only** `pi-hub-heartbeat.timer`. Pi Hub, Caddy,
   the network and the database stay running. Do not stop Pi Hub, cut the network or break the check instead. Record the times:
   Late on the row (about 5-10 min after the last ping), the Needs-you item and its push, Down (about 10-15 min), and
   Healthchecks.io's own "down" email (this is the real D2 alarm firing, expected). Restart the timer
   (`systemctl start pi-hub-heartbeat.timer`, which pings straight away); record Up and that the item cleared and the "up"
   email arrived.
6. **Done-means 4:** after steps 3-5, scan `/api/records`, `journalctl -u pi-hub` for the window, and the Health page for
   the key text and any `healthchecks.io/ping`, by a `grep -c` against a value read from the key file on the Pi that
   prints only the count (never the value).

## Acceptance

Record in `docs/operations.md`, "Outside alarm status (A1)", as "Accepted <date>", with the times from steps 2-6 above, after
the owner has seen them. Until then every status doc says the ladder state reached: merged, deployed, runtime verified (steps 2 and 4), then accepted (steps 5-6 seen and recorded). A matching SHA is a deploy, not acceptance. No PR marks step 2a
"implemented" or "done" before that entry exists. The done-means list maps as follows: 1 to 2a.4 + step 4; 2 to 2a.3 + 2a.4 +
step 5; 3 to 2a.2 + step 2; 4 to the 2a.2 secrets test + step 6.

## Out of scope (noted, not gated)

- A deleted check cannot alarm without a new state (decision 5); a deleted-on-purpose check leaves an `unknown` row. A cleanup
  or an amendment is the owner's call.
- A read that is refused (401) or a rotated key also shows only on Health, by the spec's own rule that `unknown` is not a
  Needs-you item. A key silently revoked therefore reaches the owner only by looking at Health.
- Pi Hub does not watch the outside alarm's email delivery (an un-delivered "down" email is not visible to anyone); that is outside A1.
- Health's other "Other systems" rows (Local AI, Workshop display, PC) are still drawn as log rows; A7's lamp-right
  row applies to the new rows here, and converting the existing three belongs to A7's own follow-ups, not this plan.
- `offsite-backup`'s own wording (decision 6) needs an amendment to A1 if the owner wants it.
- `sections.js:92`'s local copy of the section 9 terms has no test against the synced table; a follow-up issue, not
  this plan.
- Additional Healthchecks.io notification channels beyond the email are not part of A1.
