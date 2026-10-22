# Pi Hub status — 22 October 2026

This is the current checklist. See the [README](../README.md) for local checks and the [operations guide](operations.md) for deployment and rollback. [The original plan](plan.md) and [roadmap](roadmap.md) preserve delivery history; neither is a live equipment inventory.

## Built

Home, Movies, Devices, Lists, Print, Workshop, Weather, symptom guides, alerts, automations, owner/household/child access, backups and off-Pi copy reporting, Siri Shortcuts, release checks and owner-requested rollback.

Commit `bfd3468` adds contextual help links and breadcrumbs, favourites on Devices and Home, device-local alert badges, compact issue summaries, and expandable movie/print details. Fix actions ask for confirmation and show a persistent outcome on Help. Expanded movie details remain open across refreshes.

## Freshness and recovery follow-up — 22 October

- Source-response panels on Home, Movies, Devices, Workshop, Print, Weather and Help show successful response ages, unavailable checks, expired readings and missing setup separately.
- Seven sources are tracked: house status, Plex playback, Local AI, smart-home controls, document printer, weather and calendar. Only selected display summaries are retained after failures, in memory until app restart. No raw credentials are retained by the freshness tracker.
- Missing telemetry no longer implies that Plex/Homebridge has stopped or Local AI is down. Unknown device state is presented separately from a confirmed failure.
- Plex restart and movie-drive remount are checked against a real filesystem mount and a direct Plex response. Homebridge restart is checked through its accessories API; an empty device list does not count as recovered controls.
- Verification retries are bounded to three read-only checks. Help distinguishes command completion from recovery, offers a check-only retry, and stops follow-up checks when the user leaves the page. Updates, Pi reboot, scans and self-checks retain their action-specific completion messages without a generic recovery claim.
- The full self-check/release gate includes the new freshness endpoint; the offline shell is v62.

## Release behaviour in `bfd3468`

- Python tests and JavaScript tests run before installing a release. JavaScript modules declare their module type so the tests do not depend on Node's automatic detection.
- One release can run at a time. Releasing the active SHA is a no-op.
- The app, helper scripts, service units, status script and camera port configuration are recovered after an installation or health-check failure. File modes are preserved; newly introduced files are removed.
- Recovery waits for the previous app's health endpoint. If recovery fails, its filesystem snapshot is retained and the release log says it needs attention.
- Owner-requested rollback schedules a separate systemd job and uses the same release gate. It survives restarting the helper.
- The installer verifies the actual running SHA, because a post-receive hook failure does not reject a Git push.

This is file/service recovery, not a database downgrade or a guarantee across power loss. Future schema changes need a migration/restore strategy. Selecting an older release also selects its older helper and release code.

## Verified locally

- 82 Python tests and 8 JavaScript tests pass.
- Release simulations cover failed JavaScript tests, partial installation, failed post-install checks, successful installation and repeat installation. Separate tests check manual rollback scheduling and refusal of invalid targets.
- Browser checks use a temporary local database. Contextual movie help opens correctly; phone (390px), tablet (1024px) and desktop (1440px) layouts were inspected. Phone and tablet checks found no horizontal overflow. The Devices empty state and movie-details refresh were checked with mocked device responses.
- New tests cover stale-data retention, unchanged cache confirmation times, restored source responses, absent setup, access control, direct recovery probes, bounded retries and cancelled checks. Browser checks with mocked integrations cover confirmed/unconfirmed recovery, read-only rechecking, and phone/tablet/desktop overflow.
- The local Mac cannot supply Pi system diagnostics; the Help guides remain available when that API fails.

Application commit `0dbc712a85` was deployed to the Pi on 22 October 2026. The Pi ran all 82 Python tests and all 8 JavaScript tests before activation; the release gate passed, and the subsequent full operational self-check passed **37 of 37** checks. The installed app, helper and camera failover services are active.

Live browser checks at `http://10.0.0.30` confirmed that source-response readings render, there is no horizontal overflow at 390px/1024px/1440px, and recovery verification requires authentication. No browser console errors were reported. The test browser could not resolve `pi.local`; the Mac's HTTP client could reach it.

All six configured sources reported current responses during verification. Calendar is not configured. No live restart/remount, document print, movie playback or physical device-control test was performed as part of deployment.

## Needs live verification or household input

1. Monitor the deployed release using the [operations guide](operations.md); deployment and its initial self-check are complete.
2. Run a household acceptance session: shopping item, movie, document print and a symptom guide; include keyboard and screen-reader use.
3. Restore an off-Pi backup into an isolated environment and verify the household data.
4. Submit one real print and confirm camera operation with the Mac asleep.
5. Confirm current Homebridge, Wi-Fi, calendar, Tailscale and Local AI setup in Settings; historical notes do not establish current connectivity.
6. Test drive migration with the replacement drive. The roadmap records that the complete migration was unverified.
7. Consider workshop display firmware integration, UPS/power reporting and device modules only after the above checks.
