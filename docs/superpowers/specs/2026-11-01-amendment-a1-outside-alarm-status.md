# Amendment A1: Outside alarm status on System › Health

Date: 2026-11-01 · Status: proposed, for the owner's review · Amends: the platform baseline
(`2026-11-01-platform-product-architecture-design.md`, merged `2355701`). Documentation only.

## Why

D2's outside alarm is the one path that must work when Pi Hub is down. It can also stop working without anyone
noticing. On 1 Nov 2026, during setup and acceptance:
- The first check kept Healthchecks.io's default schedule. It would never have alerted within the hour.
- A stray email to the check's email address counted as a ping and reset the clock.

Other ways it fails silently:
- the heartbeat timer is stopped or failing;
- the ping URL on the Pi is wrong or rotated;
- the check is paused or deleted;
- the Pi cannot reach the internet.

The baseline shows none of this. A broken alarm is found only when a real outage goes unreported. Option A (owner, 1
Nov 2026) is to show what Healthchecks.io itself sees, not what the Pi believes it sent.

## Change

1. **A new record kind, `outside_alarm`** (section 4). There is one record for each check in the Healthchecks.io
   project: `home-platform-alive` now, and C1's `offsite-backup` when it exists.
   - **Owns the fact:** Healthchecks.io, the check's status and last ping.
   - **Owns the record:** Pi Hub.
   - **Shape:** `record.v1`. State is `up`, `late`, `down`, `paused` or `unknown`, plus the time of the last ping,
     `as_of` and source "Healthchecks.io".
   - **Mapping:** Healthchecks.io's statuses `new`, `up`, `grace`, `down` and `paused` map to `unknown`, `up`,
     `late`, `down` and `paused`.
2. **How Pi Hub reads it.** Every 5 minutes, Pi Hub calls `GET https://healthchecks.io/api/v3/checks/` with the
   project's **read-only** API key in the `X-Api-Key` header.
   - A read-only key can only list and read checks. It cannot ping, pause, change or delete anything.
   - Its responses leave out `ping_url`, `uuid` and the other action URLs. Pi Hub never receives a ping URL this
     way, and it identifies checks by `unique_key`.
   - The key lives in `/etc/pi-hub/secrets/healthchecks_ro.env` (`root:pi-hub`, 0640), never in the repo or logs.
     Without the file, the records are `unknown` with the cause "not set up".
3. **Where it shows.**
   - A row on **System › Health** named **Outside alarm**, with one line per check, for example "Up · last
     check-in 2 min ago".
   - It does not appear on Home unless it needs the owner.
4. **When it needs the owner.**
   - An `outside_alarm` record that is `late`, `down` or `paused` while Pi Hub itself is up raises a Needs-you item,
     severity warn: "The outside alarm isn't hearing from the Pi". The item opens System › Health.
   - It follows the normal push rules (D2). This works because Pi Hub, and so its ntfy, is up in exactly this case.
   - `unknown` (Healthchecks.io not answering, or not set up) shows on Health only. It is not a Needs-you item,
     because the outside alarm keeps working without Pi Hub reading it.
5. **New phrase-table key** (section 9): `outside_alarm_quiet`, "The outside alarm isn't hearing from the Pi".

## Fit with the baseline

- **Ownership (section 4):** this is the same split as Release. The outside service owns the fact and Pi Hub owns
  the record.
- **Pages (section 7):** System › Health gains the Healthchecks.io API as a source. Pi Hub renders it.
- **D2 is unchanged.** The alarm itself still depends on nothing on the Pi. This amendment only reads its state; it
  never sends through it or changes it.
- **Failure boundaries (section 10):**
  - Pi Hub down: the row can't show, and D2's email covers that case, as before.
  - The internet down while Pi Hub is up: the read fails, so the row shows `unknown`. Healthchecks.io will email
    "down", because it can no longer hear the Pi. That is acceptable, because the outside path can't tell the two
    cases apart.
- **Contracts (section 13):** `record.v1` gains the kind `outside_alarm`. Healthchecks.io's v3 API is an external
  read and needs no contract of our own.
- **Migration (section 11):** a new step **2a**. It comes after step 2 (done 1 Nov 2026) and is independent of
  steps 3-10.

## Acceptance (for the implementation PR)

- With the read-only key in place, System › Health shows `home-platform-alive` as Up, with a last check-in matching
  the dashboard.
- Stopping only the heartbeat timer shows Late, then Down, on the row, and raises the Needs-you item. Restarting the
  timer clears both.
- With the key file absent, the row shows `unknown` ("not set up"), with no Needs-you item and no errors in the log.
- No response, log line or page ever contains a ping URL or the API key.

## Owner action before implementation

In Healthchecks.io, open Settings › API Access and create the project's **read-only** API key. Then put it on the
Pi without pasting it into chat, as was done for the ping URL.
