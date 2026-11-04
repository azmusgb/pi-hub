# Amendment A5: C1's off-site copy goes to Google Drive, not Backblaze B2

Date: 2026-11-04 · Status: **proposed** (approved when the owner merges this PR) · Amends: the platform baseline
(`2026-11-01-platform-product-architecture-design.md`, section 12 C1, D2's `offsite-backup` check and section 10's
"The Pi lost" row).

## Why

C1 chose Backblaze B2. That is a new paid account, billed monthly. The owner already pays for Google One Pro on
wjrahe@gmail.com: 5 TB, 280.5 GB used (4 November 2026). The off-site copy is about 7.6 GB today (`pi` 1.9 GB and `mac`
5.7 GB, read on the Pi on 4 November). It fits in that plan at no extra cost and with no new account.

What C1 protects against doesn't change: losing the USB drive, the Pi and the PC together. Nothing has been configured in
B2 or Backrest yet, so the switch costs only a plan rewrite (pi-hub #71).

restic, the tool behind Backrest, can write to Google Drive through its rclone backend. Backrest's container
already has rclone (v1.74.4, with restic 0.19.1, checked 4 November).

## Change

**C1. Off-site backup: Google Drive.** It replaces C1's first two bullets and the "Cost" bullet. The done criteria are
unchanged.

- **Destination:** the owner's personal Google Drive (wjrahe@gmail.com). restic's rclone backend writes the repository
  to `rclone:gdrive:pi-offsite`, from Backrest on the Pi. The `pi-offsite` folder is used only for this repository, and
  nothing else is stored in it.
- **The rclone remote:** `gdrive` uses `scope = drive.file`, so its token can see and change only the files rclone
  itself created. It can never read, list or delete anything else in the Drive. This takes the place of "one
  application key, restricted to that bucket".
- **The token:** the Pi holds an OAuth token, never the account password, and stores it only on the Pi. It lives in the
  rclone config that Backrest reads, a file readable only by root. That file lives on the Pi's own disk, not on the USB
  drive, and is never committed or copied to the Mac.
- **Authorising it:** the owner authorises the remote once. They run `rclone authorize "drive"` on the Mac, sign in to
  Google in the Mac's browser, and paste the resulting token into the Pi's rclone config. The Pi never sees the
  password. Revoking the token from the Google account's security page cuts the Pi off.
- **Encryption:** restic encrypts every repository client-side (AES-256) with passwords that never go to Google. Google
  holds only ciphertext.
- **Done means all of** (unchanged; "B2" now reads "Google Drive"):
  1. the repository initialises;
  2. a scheduled backup completes;
  3. the repository is visible independently of the USB and PC copies;
  4. selected files are restored from Google Drive and verified, as the CA restore was;
  5. a failed off-site backup produces an actionable alert, the `offsite-backup` heartbeat (D2).

  "Backup completed" alone is not done.
- **Heartbeat semantics (unchanged):** the `offsite-backup` check is pinged only after a successful off-site backup. A
  failed or missing backup withholds the ping, so Healthchecks.io goes Late and then Down, and that is the alert.
- **Cost:** none beyond the existing Google One plan. About 7.6 GB is under 0.2% of it.

**D2:** "pinged only after a backup to B2 completes successfully" reads "pinged only after an off-site backup to Google
Drive completes successfully". Nothing else in D2 changes.

**Section 10, "The Pi lost":** "The off-site copy is in Google Drive once C1 is live; until then there is none."

## Risks this brings, and how each is covered

- **Google account lockout or suspension.** The off-site copy becomes unreachable until the account is recovered. The
  USB and PC copies are unaffected, and losing all three at once is what C1 guards against.
  - **Mitigation:** keep the account's recovery options current. The restic passwords' escrow (plan C1.5) must not
    live in this Google account.
- **Token expiry or revocation.** Uploads fail and the ping is withheld, so `offsite-backup` goes Late and then Down.
  The heartbeat already catches this; nothing new is needed.
- **Drive API rate limits.** These are harmless at about 7.6 GB with a daily incremental run. A throttled run retries,
  and a run that doesn't finish withholds the ping.
- **Dependence on rclone inside Backrest's image.** The `garethgeorge/backrest` image ships rclone today. If a future
  image drops it, the backup fails loudly, the ping is withheld and the alarm fires. The plan records the versions in
  use.

## Decision for the owner: what the Mac repo sends off site

The Mac's restic repo (`mac`) includes `~/HealthData` and `~/.ssh` (`~/.config/restic/mac-backup.sh:16`). C1 copies
that repo off site. The owner's standing preference is that health data stays local only.

1. **Send the Mac repo as it is.** Google holds only ciphertext and the passwords stay off Google, so nothing readable
   leaves the house. It is the simplest option.
2. **Split HealthData into its own Mac repo that stays on the USB only (recommended).** The off-site `mac` repo then
   carries `~/dev`, `~/PycharmProjects`, `~/.ssh` and `~/.claude/projects`. `~/.ssh` stays in, because keys lost with
   the house are what an off-site copy is for. This matches the local-only ruling literally: health data never leaves
   the house, even encrypted. Cost: one more Mac repo and one more line in the Mac's nightly script.

## Not changed

C1 is still an independent track outside section 11's sequence, still in the backlog by the owner's 3 November ruling
until scheduled. The `offsite-backup` check, Healthchecks.io, the restore drill and the alarm test are unchanged, as are
the USB repos (`pi-nightly`, the Mac's 01:30 backup) and their retention.

## Acceptance (for this amendment)

- `## Amendments` in the baseline names A5. When this PR is merged, C1, D2 and section 10 read as above.
- The C1 plan (pi-hub #71) targets Google Drive, depends on A5, and carries the HealthData decision.
