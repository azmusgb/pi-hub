# C1: off-site backup to Backblaze B2 — Plan

**Goal:** a copy of the Pi's and the Mac's backups that survives losing the USB drive, the Pi and the PC, with an alarm
that fires when that copy silently stops.

**Spec:** `docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`, §12 C1 (approved 1 Nov 2026),
§12 D2 (the `offsite-backup` check) and §10 ("The Pi lost"). C1 is outside the §11 sequence and blocks nothing in it.

**Done means all of** (C1, quoted): 1. the repository initialises; 2. a scheduled backup completes; 3. the repository is
visible independently of the USB and PC copies; 4. selected files are restored from B2 and verified, as the CA restore
was; 5. a failed off-site backup produces an actionable alert, the `offsite-backup` heartbeat (D2). "Backup completed"
alone is not done.

## What is backed up today (read on the Pi, 3 November 2026)

- Backrest 1.14.1 (restic 0.19.1), image `garethgeorge/backrest:latest`, config `/opt/backrest/config/config.json`.
- Repo `pi-usb` (`/repos/pi` = `/mnt/usb1/backups/restic/pi`, 1.8 GB). Plan `pi-nightly` runs at 03:30 over
  `/sources/{bambuddy,etc,homebox,netmon,opt,paperless,pi-hub-backups}`. It keeps 14 daily, 8 weekly and 12 monthly,
  prunes Sundays at 05:00 and has no hooks.
- Repo `mac` (`/repos/mac` = `/mnt/usb1/backups/restic/mac`, 5.6 GB). The Mac writes it at 01:30 over SFTP. Backrest
  only checks it and doesn't prune it.
- Together that is 7.4 GB, the "about 7 GB" in C1. Everything sits on `/mnt/usb1`, so one drive failure loses it all
  (Report C1).

## Decisions this plan makes (for the owner's review)

These fill in what C1 leaves open. None of them changes the spec. If the owner disagrees with one, it changes here.

1. **One new restic repository in B2, written by a new Backrest plan from the live sources, not copied from the USB
   repos.** Plan `pi-offsite` backs up the same paths and excludes as `pi-nightly`, plus `/repos/mac` (the Mac's repo,
   already encrypted with its own password). The off-site copy then never inherits a damaged USB repo, and there is one
   bucket, one repo and one heartbeat. The alternative, `restic copy` from `pi-usb` and `mac`, needs a hook script that
   holds the key outside Backrest, so it is rejected.
2. **The S3-compatible endpoint, not restic's native `b2:` backend.** restic's documentation recommends the S3 API for
   B2. Repo `b2-offsite` gets URI `s3:https://s3.<region>.backblazeb2.com/<bucket>/pi`. Its env holds
   `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, entered in Backrest's UI, so the key lives only on the Pi in Backrest
   (C1). It is never written to a repo, a script or `/etc/pi-hub`.
3. **Bucket:** private and used only for this repository. Its name is random, with no personal information (C1). Object
   Lock is off, because restic must delete lock files and prune. The lifecycle rule keeps hidden versions for 30 days,
   so a deletion through the key, by mistake or by an attacker on the Pi, can be undone for a month.
4. **Key:** one application key restricted to that bucket, with read and write (list, read, write and delete files).
   restic needs delete for locks and prune, so it can't be write-only. Never the master key (C1).
5. **Schedule and retention:** daily at 04:30. That is after `pi-nightly` (03:30) and the Mac (01:30), so the Mac's repo
   is not mid-write. Retention matches `pi-nightly` (14 daily, 8 weekly, 12 monthly), with a prune on Sundays at 06:00 and
   a monthly check that reads a 5% data subset, the B2 side's equivalent of the USB check.
6. **The heartbeat is a Backrest Healthchecks hook on `CONDITION_SNAPSHOT_SUCCESS` only.** The new Healthchecks.io
   check `offsite-backup` has a period of 1 day and a grace of 6 h, and its ping URL is held in the Backrest hook (on the
   Pi). It is pinged only after a successful B2 backup. A failed or missing backup withholds the ping, so the check goes
   Late and then Down, and that is the alert. No failure hook pings `/fail`. C1.2 records whether Backrest 1.14.1
   counts a snapshot with warnings as a success. If it does, unreadable files would not alert, and the owner decides
   whether that is acceptable.
7. **Passwords held off the Pi (escrow).** If the Pi is lost, B2 is readable only with the `b2-offsite` repo password
   and, for what is inside it, the `restic_pi` and `restic_mac` passwords. Today those exist only on the Pi (and the Mac
   Keychain for `restic_mac`). All three go into the owner's password manager. The B2 application key does **not**: after
   losing the Pi, the owner makes a new key from the Backblaze account and revokes the old one. That keeps "one key,
   stored only on the Pi" true in normal operation.

## Steps, one at a time

Each step names C1, states full or partial coverage, and carries its acceptance evidence. Steps marked *owner* need the
owner's accounts and can't be done by an agent.

- **C1.0 pi-hub: this plan** (docs only).
- **C1.1 *owner*: accounts and escrow** (outside the repos).
  - Backblaze: create the bucket (decision 3) and the key (decision 4). Note the region endpoint.
  - Healthchecks.io: create `offsite-backup` (period 1 day, grace 6 h) on the same notification channel as
    `home-platform-alive`.
  - Password manager: the three passwords (decision 7). The `b2-offsite` password is generated now, for C1.2.
  - Evidence: the bucket's settings page (private, lifecycle) and the key's bucket restriction, as screenshots or a
    written note. Nothing secret is recorded.
- **C1.2 *owner*, with agent verification: Backrest on the Pi.** This is config only: no restart and no compose change.
  - Add repo `b2-offsite` (decision 2) with the escrowed password. Backrest initialises it. *(Criterion 1.)*
  - Add plan `pi-offsite` (decisions 1, 5) and its hook (decision 6).
  - First run: "Backup now", during the day. If the upload slows the house, add `--limit-upload` to the plan's backup
    flags for the first run only, then remove it.
  - Agent check (read-only): config structure with secrets omitted, the plan and hook as specified, and the first
    snapshot's size and file count compared with `pi-usb`'s latest.
  - Evidence: the snapshot listed in Backrest under `b2-offsite`, and the check showing a first ping.
- **C1.3 the first scheduled run** *(criterion 2)*. The 04:30 run completes on its own, and `offsite-backup` pings
  after it. Evidence: Backrest's operation log time and the check's last ping.
- **C1.4 restore drill from B2** *(criteria 3 and 4)*, with the owner present.
  - Independent visibility: the Backblaze bucket browser shows the repo's objects at about the expected size, and
    Backrest lists `b2-offsite` snapshots. Neither reads the USB repos or the PC copy.
  - Restore the latest `b2-offsite` snapshot's selected paths to `/repos/_restore-test-<date>`:
    - the newest pi-hub nightly archive: its sha256 matches the file in `/var/backups/pi-hub`;
    - Caddy's CA root from that archive: its fingerprint matches the one in `operations.md` ("Restore Caddy's local CA");
    - `hub.db` from that archive: `PRAGMA integrity_check` returns `ok`;
    - the Mac's repo (`/repos/mac`): `restic -r <restored dir> check` passes with `restic_mac`, and one named file
      restored from it matches the Mac's copy by sha256.
  - Then inspect and remove `/repos/_restore-test-<date>`.
- **C1.5 alarm acceptance** *(criterion 5)*. This is owner-approved, the same way as D2's test.
  - It changes only the `pi-offsite` schedule. B2, the network, Backrest and Pi Hub are left alone.
  - Set the check to period 1 h and grace 30 min for the test. Confirm it is Up.
  - Disable `pi-offsite`'s schedule. Watch Late, then Down, and confirm that the email arrives.
  - Re-enable the schedule and run "Backup now". Confirm Up and the recovery email.
  - Restore period 1 day and grace 6 h.
- **C1.6 pi-hub `docs/operations.md`.** The Backrest section's "Still to do" becomes the off-site copy: repo, plan,
  schedule, hook, where each secret lives (by location only), the disaster restore (a new key from the account, the
  escrowed passwords, the restore commands), and "Accepted <date>" with C1.2–C1.5's evidence. Coverage: full. C1 is
  done when this merges with all five criteria evidenced.

## Out of scope (noted, not gated)

- **Pinning the Backrest image** (`:latest` today) to `1.14.1`. This is worth doing before relying on it, because an
  unattended pull could change hook behaviour. It is a compose change plus a restart, so it needs the owner's
  confirmation, and it doesn't gate C1.
- **Off-site age on System › Health.** The `backups` record shows Pi and Mac ages from the USB. Showing B2's age is a
  later Pi Hub PR. The Healthchecks.io check is the required alert.
- **Backrest's config and compose in a repo** (Report M8). They stay unversioned for now, and the key must never be
  committed.
- **`localai.db` and the PC.** These aren't in any Pi source. The Report's §20.6 "one plan" covers them, but C1 doesn't,
  and adding them is a separate decision.
- **The `mac` repo is pruned by the Mac, not Backrest.** `~/.config/restic/mac-backup.sh:18` runs `forget --prune`
  (14/8/12), so the copy inside B2 stays bounded. A prune that runs during the 04:30 upload is not expected (the Mac
  runs at 01:30), but C1.4's `check` of the restored repo is what proves consistency.
