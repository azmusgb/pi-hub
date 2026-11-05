# C1: off-site backup to Google Drive — Plan

**Goal:** a copy of the Pi's and the Mac's backups that survives losing the USB drive, the Pi and the PC, with an alarm
that fires when that copy silently stops.

**Spec:** `docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`:
- §12 C1, approved 1 Nov 2026 and **as amended by A5** (`2026-11-04-amendment-a5-c1-google-drive.md`, pi-hub #92);
- §12 D2, the `offsite-backup` check;
- §10, "The Pi lost".

C1 is outside the §11 sequence and blocks nothing in it.

**Depends on A5.** This plan targets Google Drive and can't be approved before A5 merges. If A5 is rejected, C1 stays
on B2 and this plan reverts to its B2 version (commit e8a2397).

**Done means all of** (C1, quoted, with A5's wording):
1. the repository initialises;
2. a scheduled backup completes;
3. the repository is visible independently of the USB and PC copies;
4. selected files are restored from Google Drive and verified, as the CA restore was;
5. a failed off-site backup produces an actionable alert, the `offsite-backup` heartbeat (D2).

"Backup completed" alone is not done.

## What is backed up today (read on the Pi, 3–4 November 2026)

- **Backrest:** 1.14.1 (restic 0.19.1, rclone 1.74.4 in the same image), image `garethgeorge/backrest:latest`, config
  `/opt/backrest/config/config.json`.
- **Repo `pi-usb`** (`/repos/pi` = `/mnt/usb1/backups/restic/pi`, 1.9 GB). Plan `pi-nightly` runs at 03:30 over
  `/sources/{bambuddy,etc,homebox,netmon,opt,paperless,pi-hub-backups}`. It keeps 14 daily, 8 weekly and 12 monthly,
  prunes Sundays at 05:00 and has no hooks.
- **Repo `mac`** (`/repos/mac` = `/mnt/usb1/backups/restic/mac`, 5.7 GB). The Mac writes it at 01:30 over SFTP. Backrest
  only checks it and doesn't prune it. It holds `~/dev`, `~/PycharmProjects`, `~/HealthData`, `~/.ssh` and
  `~/.claude/projects` (`~/.config/restic/mac-backup.sh:16`).
- **Total:** about 7.6 GB. Everything sits on `/mnt/usb1`, so one drive failure loses it all (Report C1).
- **Destination:** the owner's Google One plan on wjrahe@gmail.com has 5 TB, with 280.5 GB used (4 November).

## Decisions this plan makes (for the owner's review)

These fill in what C1 and A5 leave open. None of them changes the spec. If the owner disagrees with one, it changes
here.

1. **One new restic repository in Google Drive, written by a new Backrest plan from the live sources, not copied from
   the USB repos.**
   - Plan `pi-offsite` backs up the same paths and excludes as `pi-nightly`, plus `/repos/mac` (the Mac's repo, already
     encrypted with its own password).
   - This way the off-site copy never inherits a damaged USB repo, and there is one folder, one repo and one heartbeat.
   - The alternative, `restic copy` from `pi-usb` and `mac`, needs a hook script that holds the credentials outside
     Backrest, so it is rejected.
2. **The rclone remote is defined in the repo's env, so the change is config only.**
   - Repo `gdrive-offsite` gets URI `rclone:gdrive:pi-offsite`. Its env, entered in Backrest's UI, defines the remote
     with rclone's environment-variable config:
     - `RCLONE_CONFIG_GDRIVE_TYPE=drive`
     - `RCLONE_CONFIG_GDRIVE_SCOPE=drive.file`
     - `RCLONE_CONFIG_GDRIVE_TOKEN=<token JSON>`
   - The token lives only on the Pi, inside Backrest's root-only config (A5). It is never written to a repo, a script,
     `/etc/pi-hub` or the Mac.
   - There's no rclone.conf to mount, so neither the compose file nor a restart changes.
   - rclone refreshes the short-lived access token from the stored refresh token on each run. Nothing needs writing back.
3. **rclone's built-in Google client, not a client ID of the owner's own.**
   - A personal OAuth client left in Google's "Testing" status expires its refresh token after 7 days. That would break
     the backup every week; the heartbeat would catch it, but it would be noise.
   - rclone's shared client has no such expiry. Its shared API quota is ample for one daily incremental run of about
     7.6 GB.
   - If throttling ever shows up (decision 6's alarm, or 403 `rateLimitExceeded` in Backrest's log), switch to an own
     client ID published to "In production".
4. **Folder and scope.**
   - `pi-offsite` sits at the root of My Drive and is used only for this repository (A5).
   - With `drive.file`, rclone creates it and sees nothing else. Files the owner uploads into it through the web would
     be invisible to restic, so nothing else goes there.
   - Drive keeps deleted files in Trash for 30 days. restic's deletes during prune go there, which gives about a month to
     undo an accidental or hostile deletion through the token. This is the equivalent of the B2 lifecycle rule.
   - Trash counts against the quota, which is negligible at this size.
5. **Schedule and retention.**
   - Daily at 04:30. That is after `pi-nightly` (03:30) and the Mac (01:30), so the Mac's repo is not mid-write.
   - Retention matches `pi-nightly` (14 daily, 8 weekly, 12 monthly), with a prune on Sundays at 06:00.
   - A monthly check reads a 5% data subset: the Drive side's equivalent of the USB check.
6. **The heartbeat is a Backrest Healthchecks hook on `CONDITION_SNAPSHOT_SUCCESS` only.**
   - The new Healthchecks.io check `offsite-backup` has a period of 1 day and a grace of 6 h. Its ping URL is held in the
     Backrest hook, on the Pi.
   - The check is pinged only after a successful off-site backup. A failed or missing backup withholds the ping, so the
     check goes Late and then Down, and that is the alert. No failure hook pings `/fail`.
   - An expired or revoked token fails the upload, so it is caught the same way (A5).
   - C1.2 records whether Backrest 1.14.1 counts a snapshot with warnings as a success. If it does, unreadable files would
     not alert, and the owner decides whether that is acceptable.
7. **Passwords held off the Pi (escrow), and not in the same Google account.**
   - If the Pi is lost, Drive is readable only with the `gdrive-offsite` repo password and, for what is inside it, the
     `restic_pi` and `restic_mac` passwords.
   - Today those exist only on the Pi (and the Mac Keychain for `restic_mac`).
   - All three, plus `restic_mac_health` from C1.1b (its repo is USB-only, but losing its password loses it), go into the owner's password manager, or onto a printed sheet kept somewhere other than the house's usual
     papers. They are never stored in Google Drive or Google Password Manager under wjrahe@gmail.com: one account
     lockout must not take both the data and its keys.
   - The rclone token is **not** escrowed. After losing the Pi, the owner runs `rclone authorize "drive"` again on any
     computer and revokes the old grant on the Google account's "Third-party apps & services" page. That keeps "the token
     only on the Pi" true in normal operation.
8. **HealthData stays in the house (the owner's decision, 4 Nov 2026, recorded in A5).**
   - `~/HealthData` moves to its own USB-only Mac repo, `mac-health`.
   - Every older `mac` snapshot is rewritten without it.
   - `~/.ssh` and everything else stay in `mac` and go off site.
   - Step C1.1b does this, and its check gates C1.2's first upload.

## Steps, one at a time

Each step names C1, states full or partial coverage, and carries its acceptance evidence. Steps marked *owner* need the
owner's accounts and can't be done by an agent.

- **C1.0 pi-hub: this plan and A5** (docs only).
- **C1.1 *owner*: accounts and escrow** (outside the repos).
  - **Google:**
    - On the Mac, run `rclone authorize "drive" --drive-scope drive.file` (rclone installed with Homebrew if needed).
    - Sign in as wjrahe@gmail.com in the browser it opens and approve.
    - Keep the printed token JSON for C1.2. Don't save it to a file in a synced folder.
  - **Healthchecks.io:** create `offsite-backup` (period 1 day, grace 6 h) on the same notification channel as
    `home-platform-alive`.
  - **Password manager or printed sheet:** the three passwords, plus `restic_mac_health` after C1.1b (decision 7). The `gdrive-offsite` password is generated
    now, for C1.2.
  - **Evidence:** the Google account's third-party access page shows rclone with "See, edit, create and delete only the
    specific Google Drive files you use with this app". Record it as a screenshot or a written note. Nothing secret is
    recorded.
- **C1.1b agent, owner-approved: split HealthData out of the Mac repo** (owner's decision 8). Done on the Mac, plus one
  directory on the USB. Backrest and the Pi's services are unchanged.
  1. **New local-only repo first, so nothing is ever without a copy.**
     - `restic -r sftp:pi:/mnt/usb1/backups/restic/mac-health init`, with a new password stored in the Mac Keychain
       (`restic_mac_health`) and escrowed with the others (decision 7).
     - Back up `~/HealthData` into it.
     - Restore one named file and compare its sha256 with the original.
     - HealthData is a static export (2025-08-26), so its current copy is its whole history. Nothing older needs carrying
       over.
  2. **Script.** In `~/.config/restic/mac-backup.sh`:
     - drop `"$HOME/HealthData"` from the `mac` backup;
     - add a second `restic backup "$HOME/HealthData"` to `mac-health`, with the same retention and prune.
     - Keep a copy of the old script beside it until C1.4 passes.
  3. **Remove HealthData from the old `mac` snapshots: `restic rewrite`, not `restic forget`.**
     - Every `mac` snapshot contains HealthData together with `~/dev`, `~/.ssh` and the rest. `forget` works on whole
       snapshots, so dropping "the HealthData snapshots" would delete the entire Mac history, which is the opposite of
       the goal.
     - `rewrite --exclude` writes a copy of each snapshot without that path and keeps everything else.
     - Run `restic -r <mac> rewrite --exclude "$HOME/HealthData" --dry-run` and read the summary.
     - Then run the same with `--forget`, so the originals are removed only after their rewritten copies exist.
     - Then `restic forget --prune` with the existing 14/8/12 policy, so the HealthData blobs are actually deleted.
     - Then `restic check`.
     - Run it between Mac backups, not at 01:30.
  4. **Gate check: `restic ls` on every snapshot.** With `R=sftp:pi:/mnt/usb1/backups/restic/mac`:
     ```sh
     for id in $(restic -r "$R" snapshots --json | jq -r '.[].id'); do
       restic -r "$R" ls --json "$id" | jq -r 'select(.struct_type == "node") | .path' | grep -c '/HealthData' ; done
     ```
     Count file entries only. A plain `restic ls | grep` also matches the snapshot header line, which lists the
     snapshot's original paths, so it reports 1 for a clean snapshot (corrected 4 Nov 2026). Every count must be `0`. One non-zero count, or a failed `ls`, means stop: no off-site upload.
  - **Pi:** `pi-offsite` backs up `/repos/mac` only. `/repos/mac-health` is never in an off-site plan, and C1.2's agent
    check confirms that from the plan's paths.
  - **Evidence:**
    - the loop's output (all zeros) and `restic check` exit 0;
    - `restic -r <mac-health> snapshots` lists the snapshot;
    - the sha256 match;
    - the next 01:30 run writes both repos, from the Mac's log.
  - **Gate:** C1.2's first upload does not start until this evidence is recorded.
- **C1.2 *owner*, with agent verification: Backrest on the Pi.** Config only: no restart and no compose change.
  Starts only after C1.1b's gate check passes.
  - Add repo `gdrive-offsite` (decision 2) with the escrowed password and the token from C1.1. Backrest initialises it
    *(criterion 1)*.
  - Add plan `pi-offsite` (decisions 1 and 5) and its hook (decision 6).
  - **First run:** "Backup now", during the day. If the upload slows the house, add `--limit-upload` to the plan's backup
    flags for the first run only, then remove it.
  - **Agent check (read-only):**
    - the config structure, with secrets omitted;
    - the plan and hook as specified, and the env holding `SCOPE=drive.file`;
    - the first snapshot's size and file count compared with `pi-usb`'s latest.
  - **Evidence:** the snapshot listed in Backrest under `gdrive-offsite`, and the check showing a first ping.
- **C1.3 the first scheduled run** *(criterion 2)*. The 04:30 run completes on its own, and `offsite-backup` pings
  after it. Evidence: the time in Backrest's operation log, and the check's last ping.
- **C1.4 restore drill from Google Drive** *(criteria 3 and 4)*, with the owner present.
  - **Independent visibility:** drive.google.com, signed in as the owner, shows `pi-offsite` with restic's `config`,
    `data/`, `index/`, `keys/` and `snapshots/` at about the expected size. Backrest lists `gdrive-offsite` snapshots.
    Neither reads the USB repos or the PC copy.
  - **Restore** the latest `gdrive-offsite` snapshot's selected paths to `/repos/_restore-test-<date>`:
    - the newest pi-hub nightly archive: its sha256 matches the file in `/var/backups/pi-hub`;
    - Caddy's CA root from that archive: its fingerprint matches the one in `operations.md` ("Restore Caddy's local CA");
    - `hub.db` from that archive: `PRAGMA integrity_check` returns `ok`;
    - the Mac's repo (`/repos/mac`): `restic -r <restored dir> check` passes with `restic_mac`, and one named file
      restored from it matches the Mac's copy by sha256. A `restic ls` of the restored repo's latest snapshot has no
      `HealthData` path.
  - Then inspect and remove `/repos/_restore-test-<date>`.
- **C1.5 alarm acceptance** *(criterion 5)*. This is owner-approved, the same way as D2's test.
  - It changes only the `pi-offsite` schedule. Google, the network, Backrest and Pi Hub are left alone.
  - Set the check to period 1 h and grace 30 min for the test. Confirm it is Up.
  - Disable `pi-offsite`'s schedule. Watch Late, then Down, and confirm that the email arrives.
  - Re-enable the schedule and run "Backup now". Confirm Up and the recovery email.
  - Restore period 1 day and grace 6 h.
- **C1.6 pi-hub `docs/operations.md`.** Coverage: full. C1 is done when this merges with all five criteria evidenced.
  - The Backrest section's "Still to do" becomes the off-site copy: repo, plan, schedule, hook, and where each secret
    lives (by location only).
  - **The disaster restore:**
    1. On any computer, `rclone authorize "drive"`.
    2. `restic -r rclone:gdrive:pi-offsite` with the escrowed password.
    3. The restore commands.
    4. Revoke the old grant.
  - The HealthData split and the `mac-health` repo, and "Accepted <date>" with the evidence from C1.2–C1.5.

## Out of scope (noted, not gated)

- **Pinning the Backrest image** (`:latest` today) to `1.14.1`.
  - Worth doing before relying on it: an unattended pull could change hook behaviour, or drop rclone from the image (A5's
    risk).
  - It is a compose change plus a restart, so it needs the owner's confirmation, and it doesn't gate C1.
- **Off-site age on System › Health.** The `backups` record shows the Pi and Mac ages from the USB. Showing the Drive
  copy's age is a later Pi Hub PR. The Healthchecks.io check is the required alert.
- **Backrest's config and compose in a repo** (Report M8). They stay unversioned for now, and the token must never be
  committed.
- **`localai.db` and the PC.** These aren't in any Pi source. The Report's §20.6 "one plan" covers them, but C1 doesn't,
  and adding them is a separate decision.
- **The `mac` repo is pruned by the Mac, not Backrest.**
  - `~/.config/restic/mac-backup.sh:18` runs `forget --prune` (14/8/12), so the copy inside Drive stays bounded.
  - A prune that runs during the 04:30 upload is not expected (the Mac runs at 01:30), but C1.4's `check` of the restored
    repo is what proves consistency.
