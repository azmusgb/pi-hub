# Platform step 3: the `release:` write path and System › Versions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every deploy target writes a `release:<target>` record to Pi Hub when a deploy finishes, and System ›
Versions shows what is live where from those records alone. Pi Hub publishes its own record first, then LocalAI, the
firmware OTA host, netmon and the Mac agents, one PR at a time.

**Architecture:** A new record kind in `hub/records.py`, written outside the 30-second `refresh()` by one function,
`releases.put()`. Two ways in, chosen by where the deploy runs:
- **On the Pi** (pi-hub, the firmware OTA host, netmon): the deploy drops a JSON file in a spool folder,
  `/var/lib/pi-hub-releases/inbox/`, which Pi Hub reads every loop pass. No network and no key. The file stays until it is
  read, so a deploy that runs while Pi Hub restarts is not lost.
- **Off the Pi** (LocalAI on the PC, the Mac agents): `POST /api/releases/{target}` over HTTPS with a per-target deploy
  key. The writer keeps an outbox file and retries it from a job that already runs every 5 minutes (Safe Deploy, mac-watch).

Runtime probes only verify. They set `drifted`, never the commit.

**Tech Stack:** Pi Hub: Python 3 / FastAPI / SQLite, bash (`deploy/`), pytest, node:test. LocalAI: Windows PowerShell 5.1
(`deploy/*.ps1`). netmon: bash. Mac agents: bash and Python.

**Spec:** `docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`: §4 "New record kinds"
(`release:<target>`), §7 (System › Versions), §10 (a deploy that cannot write its record), §11 step 3, and §12 D1, D7 and
the D1 + D7 amendment.

## Decisions this plan makes (for the owner's review)

These fill in details the spec leaves open. None changes the spec. If the owner disagrees with one, it changes here, not by
amendment.

1. **Two ways in** (Architecture above): a local spool on the Pi, and HTTPS with a deploy key from the PC and the Mac.
   Pi-hosted deploys need no secret, and the spool is the retry the spec asks for in §10.
2. **One deploy key per off-Pi target** (`localai`, `mac`). Pi Hub stores only its SHA-256, under
   `/etc/pi-hub/secrets/deploy_keys/<key>.sha256`. The key is sent as `X-Hub-Deploy-Key` and is accepted only on
   `POST /api/releases/<target>` for its own targets: `localai` for the `localai` key; `mac-watch` and `x2d-bridge-mac`
   for the `mac` key. It follows the lab key's pattern (`deploy/lab-key.sh`,
   `hub/lab_guard.py`).
3. **The targets:** `pi-hub`, `localai`, `firmware`, `netmon`, `mac-watch` and `x2d-bridge-mac`. print-lab's `lab pull`
   runs straight from the checkout and has no deploy step, so it is not a target. Each target starts `unknown`, with
   "Not publishing yet".
4. **Severity:** the spec's "severity warn" is Pi Hub's `attention` (shown with tone `warn`, `hub/now.py:130`). A failed or
   rolled-back last deploy, or `drifted`, is `attention` and raises a Needs-you item. `live` is `ok`. `behind`, `ahead` and
   `unknown` are `info`, which shows on Versions only.
5. **Release records are never marked stale.** They are facts about the last deploy, not readings. After a restart they load
   as they were, and Versions shows each one's time.

## Global Constraints

- **Record shape** (`record.v1`, built with `records.make`):
  - id: `release:<target>`;
  - state: `live | behind | ahead | unknown | drifted`;
  - source: the mechanism, for example `pi-hub-release`, `safe-deploy`, `ota-hook`, `netmon-deploy` or `mac-install`;
  - `detail`:
    `{target, label, commit, previous, deployed_at, mechanism, last: {commit, result, at, message}, head, verified: {commit, at, by}}`.
  - `commit` is what runs now. `last` is the most recent attempt, so a failure keeps the old `commit` and puts the failed
    commit in `last`.
- **Write body** (spool file or POST):
  - `commit`: 7 to 40 hex characters. `result`: `deployed | failed | rolled-back`.
  - `at`: ISO 8601, at most 5 minutes in the future. `mechanism`: one of the five above.
  - Optional: `previous`, `head` and `message` (at most 200 characters).
  - Anything else is refused with `error.v1` "That release report isn't valid."
  - The same `(target, commit, result, at)` written twice is a no-op.
- **`behind` and `ahead`** come only from a `head` the writer reports: the head of its deploy branch at deploy time. With
  no `head`, the state stays `live` (spec §4).
- **Copy**:
  - unknown: "Not publishing yet";
  - a failed deploy's Needs-you item: "<Label> deploy failed: <short> is still running";
  - drifted: "<Label> is running <short>, not the recorded <short>".
- **Read-only (D7):** Versions has rollback only for pi-hub, and it moves from the Settings card. Other targets link to
  their own mechanism's docs.
- **Out of scope here:** home-mcp reading the records, LocalAI's Deployments page becoming a link (both step 4), and Atlas
  on release records (step 10).
- **Test commands:**
  - `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests`
  - `node --test tests/*.mjs`
  - LocalAI: its local CI, through `npm run ship`.
- Every page or JS change bumps `hub/static/sw.js` `SHELL` and its file list (`tests/test_appliance_ui.py:63-65`).
- **Migration-PR rule:** each PR body names the requirement it implements (§4 `release:<target>`, D1 + D7 amendment,
  §11 step 3, and for that target which part), states full or partial coverage, and includes the acceptance evidence listed in
  its last task.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The owner deploys, or approves each deploy.

## Review Focus

1. **A deploy during a Pi Hub restart:** the spool file is read when Pi Hub comes back, and the record updates. Covered by
   PR 3.1 Task 2, `test_spool_written_while_down_is_read_on_start`.
2. **Pi Hub's own rollback:** the record's `commit` is the restored commit, and `last` is the failed one. Today's
   `releases.json` `rolled-back` entry carries only the failed commit. Covered by PR 3.1 Task 3,
   `test_rollback_records_the_restored_commit`.
3. **A replayed or forged POST:**
   - a key for `localai` cannot write `release:mac-watch`;
   - plain http is refused;
   - a duplicate is a no-op.

   Covered by PR 3.3 Task 1, `test_key_writes_only_its_own_target`, `test_http_is_refused` and `test_duplicate_is_noop`.
4. **Drift without a deploy:** `/opt/pi-hub/current` switched by hand makes the record `drifted` and raises a Needs-you
   item. The next real deploy clears it. Covered by PR 3.1 Task 4, `test_symlink_change_is_drift`.
5. **Unknown ids in old code paths:** `_severity`, `records_body`, `freshness` and `ask` all key on exact `KINDS` names
   today (`hub/records.py:104`, `hub/app.py:129-131`, `hub/freshness.py:82`, `hub/ask.py:39`). Release records reach
   `/api/records` with the right severity. Covered by PR 3.1 Task 1, `test_release_records_are_in_api_records`.

---

## PR 3.1 (pi-hub): the record kind, the spool, and Pi Hub's own record

### Task 1: the `release:` kind in records

**Files:**
- Create: `hub/releases.py`.
- Modify:
  - `hub/records.py`: kind lookup by prefix, `id.split(":")[0]`, in `_severity` and wherever `KINDS.get(id)` is used;
    release records skip `stale`.
  - `hub/app.py:129-131`: `records_body` includes `release:*`.
  - `hub/freshness.py`, `hub/ask.py`: skip `release:*`, since these are not live readings.
- Test: `tests/test_releases.py`.

**Interfaces:**
- `releases.TARGETS`: an ordered dict, target → label: Pi Hub, Local AI, Display firmware, netmon, Mac watchdog, Mac
  camera bridge.
- `releases.valid(target, body) -> dict | None`: a normalised write, or None.
- `releases.put(target, body, now) -> dict`: under the records lock, `merge` + `store`. It returns the record, logs a
  `record_events` row when state or severity changes, and is idempotent per `(target, commit, result, at)`.
- `releases.seed(now)`: writes an `unknown` record for any target with none.

- [ ] **Step 1: Write the failing tests:**
  - `test_unknown_targets_are_seeded`;
  - `test_deployed_sets_live_and_commit`;
  - `test_failed_keeps_commit_and_sets_last` (severity `attention`);
  - `test_rolled_back_keeps_restored_commit`;
  - `test_head_ahead_of_commit_is_behind`;
  - `test_no_head_stays_live`;
  - `test_invalid_body_is_refused` (bad hex, bad result, `at` 10 minutes ahead, unknown target);
  - `test_duplicate_is_noop`;
  - `test_release_records_are_in_api_records`;
  - `test_release_records_load_without_stale`;
  - `test_failed_deploy_raises_one_needs_item` (via `needs.build`; id `pi:release:<target>`, link `/versions`).
- [ ] **Step 2: Run** `tests/test_releases.py`. Expect failures.
- [ ] **Step 3: Implement.** Add `HREF["release:*"] = "/versions"` by prefix in `now.py`.
- [ ] **Step 4: Run** the file, then both full suites.
- [ ] **Step 5: Commit** `releases: the release:<target> record kind (spec §4)`.

### Task 2: the spool on the Pi

**Files:**
- Modify:
  - `hub/releases.py`: `read_spool(path, now)`;
  - `hub/events.py`: `loop_pass` calls it;
  - `deploy/install.sh`: creates `/var/lib/pi-hub-releases/inbox`, 0755 root, readable by the `pi-hub` user, and adds an
    inbox-writable group for the hook;
  - `deploy/pi-hub-release`: nothing in this task.
- Test: `tests/test_releases.py`.

**Interfaces:**
- Spool file: `<target>-<epoch>-<rand>.json`, written to a `.tmp` name and renamed.
- `read_spool` applies files oldest first. It renames each applied file to `done/`, keeping the newest 20 per target, and
  each refused file to `bad/`, logged once.
- Pi Hub needs only read access plus rename inside the inbox. Ownership is set in `install.sh`, so the hub never writes
  outside it.

- [ ] **Step 1: Write the failing tests:**
  - `test_spool_file_is_applied_and_moved`;
  - `test_spool_written_while_down_is_read_on_start`;
  - `test_bad_spool_file_goes_to_bad_once`;
  - `test_spool_order_is_by_time`.
- [ ] **Steps 2-5:** run (expect FAIL), implement, run all, then commit `releases: read deploy reports from the Pi's spool`.

### Task 3: Pi Hub's runner writes its record

**Files:**
- Modify: `deploy/pi-hub-release`. A `report()` next to `record()` (`:20-34`) writes a spool file:
  - `deployed` after `record live` (`:204-206`), with `head` = the pushed `main`;
  - `failed` at the test failures (`:70`, `:77`);
  - `rolled-back` in `recover` (`:143`, `:145`), with `commit` = the restored release and `last.commit` = the failed one;
  - `rolled-back` entries in `releases.json` gain `restored`.
- Test: `tests/test_release.py`, using the existing stubbed harness (`:16-100`).

- [ ] **Step 1: Write the failing tests:**
  - `test_live_release_writes_a_deployed_report`;
  - `test_test_failure_writes_a_failed_report`;
  - `test_rollback_records_the_restored_commit`;
  - `test_report_never_fails_the_release` (the inbox is unwritable, and the release still goes live).
- [ ] **Steps 2-5:** run, implement, run all, then commit `pi-hub-release: report each release to release:pi-hub`.

### Task 4: drift for Pi Hub

**Files:**
- Modify: `hub/releases.py`, `verify_pi_hub(now)`, called from `loop_pass`. It compares `realpath(/opt/pi-hub/current)`'s
  name (as `system.releases()` reads it, `hub/system.py:162-173`) with the record's `commit[:10]`.
  - A mismatch sets `drifted`.
  - A match after drift sets `live`.
  - It fills `verified: {commit, at, by: "pi-hub symlink"}`.
- Test: `tests/test_releases.py`.

- [ ] **Step 1: Write the failing tests:**
  - `test_symlink_change_is_drift` (with its Needs-you item);
  - `test_drift_clears_on_match`;
  - `test_no_record_no_drift`.
- [ ] **Steps 2-5:** run, implement, run all, then commit `releases: Pi Hub's own drift check`.

### Task 5: release, and acceptance evidence

- [ ] Run `install.sh` from the Mac (it creates the inbox). That restarts nothing beyond what the installer already does,
  and needs the owner's go-ahead.
- [ ] Run the deploy preflight, then `git push pi main`.
- [ ] **Evidence for the PR:**
  - `GET /api/records` shows `release:pi-hub` `live` at the pushed commit, with `mechanism: pi-hub-release`;
  - the other five targets show `unknown`;
  - after a no-op re-push, the duplicate leaves one `record_events` row.
- [ ] Update `docs/status.md` and `docs/operations.md` (the spool, and what each state means). Commit.

---

## PR 3.2 (pi-hub): System › Versions

### Task 1: the page

**Files:**
- Create: `hub/static/js/versions.js`, using the `mount` / `load` / `every` pattern.
- Modify:
  - `hub/static/js/main.js`: `PAGES` and the subtitles, `:50-91`;
  - `hub/static/js/sections.js`: `SECTIONS.system.pages`, `:12`;
  - `hub/static/js/system.js`: a "Versions" link;
  - `hub/static/js/settings.js:67-85`: the Versions card becomes one line, "Versions moved to System › Versions", with a
    link;
  - `hub/static/sw.js`;
  - `deploy/pi-hub-selfcheck.py:14` (`PAGES`);
  - `tests/test_sections.mjs:13-20`.
- Test: `tests/test_versions_ui.mjs`; browser `tests/browser/structure.mjs`.

**Behaviour:**
- One row per target, in `TARGETS` order. Each row has:
  - the label;
  - a state chip;
  - the short commit, linked to its GitHub commit for repo targets;
  - "deployed <relative time>";
  - the mechanism;
  - when `last.result` is not `deployed`, a second line, for example "Last deploy failed: <short>, <time>".
- `unknown` rows read "Not publishing yet".
- The pi-hub row keeps the history and "Go back to this" (the same `POST /api/settings/rollback`) and is the only row with
  an action (D7).
- **States:** a loading skeleton. If `/api/records` fails: "Couldn't read the release records", plus the last list this
  page drew. Empty can't happen once the targets are seeded.

- [ ] **Step 1: Write the failing tests:**
  - `test_rows_follow_target_order`;
  - `test_unknown_reads_not_publishing_yet`;
  - `test_failed_last_shows_second_line`;
  - `test_only_pi_hub_has_go_back`;
  - `test_fetch_error_keeps_last_list`;
  - `test_settings_card_links_to_versions`.
- [ ] **Steps 2-5:** run, implement, run all (including the browser structure check), then commit
  `System › Versions from the release records (D1, D7)`.

### Task 2: release, and acceptance evidence

- [ ] Run the preflight, then release.
- [ ] **Evidence:**
  - `/versions` shows Pi Hub `live` at the live commit and five rows reading "Not publishing yet", on a phone and on a
    desktop (screenshots);
  - the Settings card links there;
  - a rollback from Versions still works. Check it on the test harness only, never on the live Pi.

---

## PR 3.3 (pi-hub, then LocalAI): the HTTPS way in, and `release:localai`

### Task 1 (pi-hub): `POST /api/releases/{target}` and deploy keys

**Files:**
- Create: `deploy/deploy-key.sh <localai|mac>`, run by the owner from the Mac. It copies `lab-key.sh` for the Pi side.
  - It makes the key in memory and sends only its SHA-256 to the Pi.
  - It installs the key where it is used: for `localai`, over SSH stdin into `C:\LocalAI\stack\pi-hub-deploy.key`, with an
    ACL for the Safe Deploy task's account; for `mac`, into the login Keychain through `security`'s stdin prompt.
  - The key never appears in terminal output, process arguments, logs, a repo or a PR.
  - Test: `test_deploy_key_never_printed`. Run the script with stubbed `ssh` and `security`, then assert the key is absent
    from stdout, stderr and every stub's argv.
- Modify:
  - `hub/app.py`: the route, and the `guard` exemption for `X-Hub-Deploy-Key` on `/api/releases/*` only;
  - `hub/releases.py`: `key_ok(request, target)`, refusing `X-Forwarded-Proto: http` as the lab key does.
- Test: `tests/test_releases_api.py`.

- [ ] **Step 1: Write the failing tests:**
  - `test_key_writes_only_its_own_target`;
  - `test_wrong_key_is_401`;
  - `test_http_is_refused`;
  - `test_owner_session_cannot_post` (deploys only);
  - `test_duplicate_is_noop`;
  - `test_body_limits`.
- [ ] **Steps 2-5:** run, implement, run all, then commit `releases: HTTPS reports with a per-target deploy key`.

### Task 2 (LocalAI): Safe Deploy reports

**Files:**
- Create: `deploy/Send-LocalAI-ReleaseReport.ps1`. It appends to the outbox `C:\LocalAI\.deploy\release-outbox.json` and
  sends every entry with `Invoke-RestMethod` to `https://hub.rahe-home.duckdns.org/api/releases/localai`, dropping each one
  that is accepted. It never fails the run.
- Modify: `deploy/Run-LocalAI-AutoDeploy.ps1`.
  - After the deploy result (`:188-216`), it queues a report:
    - `deployed` with `head` = `origin/release`;
    - `failed` or `rolled-back`, read from `.deploy/state.json` `status` (`ROLLED_BACK`, `DEPLOY_FAILED_UNCHANGED`);
  - every run, it flushes the outbox, including runs with nothing to deploy. That is the retry.
- **Key:** read from `C:\LocalAI\stack\pi-hub-deploy.key`, placed by `deploy-key.sh localai` (PR 3.3 Task 1), with an ACL for the task's
  account. It is never logged or put in process arguments. The owner places the key.
- Test: the LocalAI PowerShell tests used by local CI. Cover the outbox kept on failure, the outbox emptied on success,
  and `ROLLED_BACK` mapped to `rolled-back`.

### Task 3 (pi-hub): LocalAI drift

- Modify `deploy/pi-status.py`, which already calls LocalAI with its key (`:229-237`): also read `/healthz`
  `releaseCommit`. `releases.verify_localai` sets `drifted` on a mismatch with `release:localai.commit`, with
  `verified.by: "localai healthz"`.
- Tests: `test_localai_drift`, and `test_pc_asleep_is_not_drift`. With no answer, the state is unchanged; that is the PC
  being off, not drift.

### Task 4: release and evidence

- [ ] Ship the pi-hub PR first (preflight, then `git push pi main`). Then `npm run ship -- <PR>` for LocalAI.
- [ ] **Evidence:**
  - the next Safe Deploy run makes `release:localai` `live` at the live SHA (compare with `deploy_state localai`);
  - Versions shows it;
  - with Pi Hub's HTTPS refused for one run (a test key, not by stopping anything), the outbox holds the report, and the
    following run delivers it.

---

## PR 3.4 (pi-hub): the firmware OTA host

The OTA hook runs on the Pi from `pi:/srv/bambuhelper-smart-display.git` and is in no repository today. It publishes
`releases/` + `firmware/` into `/srv/bambuhelper-updates/publish-<sha>` and swaps `current`.

- **Task 1:** move the hook into pi-hub as `deploy/bambuhelper-post-receive`, installed by `install.sh` with no change in
  behaviour. Test it with the stubbed-git harness of `tests/test_release.py`. Commit
  `deploy: the OTA publish hook is in the repo`.
- **Task 2:** after the `current` swap, the hook writes a spool report for `firmware`: `deployed`, `commit` = the Stable
  channel's `sourceCommit` in the published `releases/device-update.json`, mechanism `ota-hook`. *Corrected in PR 3.4:*
  this said "the pushed sha", but the display's `sourceSha` is the image's source commit, which is never the commit that
  publishes it, so the two would never match.
  - Firmware is the one target whose record is `live` only when the display runs it (spec §4). `releases.verify_firmware`
    compares the display heartbeat's `sourceSha` (`hub/display_routes.py` `clean_heartbeat`) with the published commit.
  - Until they match, the state is `behind`, headline "Published <short>; the display runs <short>"; `ahead` when the
    display runs a newer version than the published one.
  - A heartbeat older than the display's own staleness rule leaves the state unchanged.
  - Tests: `test_published_not_running_is_behind`, `test_heartbeat_match_is_live`, `test_no_heartbeat_keeps_state`.
- **Task 3: evidence.** The next firmware publish (`git push pi main` in bambuhelper) shows `firmware` `behind`, then `live`
  after the display updates.

## PR 3.5 (netmon): netmon reports

netmon's `deploy.sh` rsyncs the working tree from the Mac and records no commit anywhere.

- **Task 1:** `deploy.sh` passes `git rev-parse HEAD` and a dirty flag into the heredoc. At its end, it writes a spool
  report for `netmon`:
  - `deployed`, or `failed` if `docker-compose up -d` or the Prometheus reload fails;
  - mechanism `netmon-deploy`;
  - with a dirty tree, the message "deployed from uncommitted changes".
- Versions shows a dirty deploy's commit with "+ local changes".
- Tests: a shellcheck-clean script, and a dry-run mode that prints the report instead of writing it. That mode is
  asserted by a small bats-free shell test in `tests/`.
- **Evidence:** the next netmon deploy makes `release:netmon` `live` at its commit.

## PR 3.6 (LocalAI, bambuhelper): the Mac agents

- **Task 1:** `host/mac-watch/install.sh` (LocalAI) and `tools/install_x2d_bridge_agent.sh` (bambuhelper) queue an outbox
  report, `~/.claude/localai-chat/release-outbox.json`, after a successful install:
  - for `mac-watch` or `x2d-bridge-mac`;
  - with `commit` = the checkout's HEAD, mechanism `mac-install`, and a dirty flag in `message`.
- **Task 2:** `watch.py` flushes that outbox on every 5-minute run with the `mac` deploy key, which is read from the
  Keychain and never from a file in a repo. That is the retry. Tests: `test_outbox_flush_keeps_on_error` and
  `test_outbox_flush_drops_on_201`.
- **Evidence:** reinstall each agent once. Both records are `live`, and Versions has no `unknown` row left.

---

## Done for step 3 when

Every target's row on System › Versions comes from its own deploy's report, and a failed deploy or drift raises a
Needs-you item. Each PR carries its acceptance evidence. Then step 4 (home-mcp reads the records; LocalAI's Deployments
page becomes a link), step 5 (after step 2 accepted and step 3, per A2) and step 10 can start.
