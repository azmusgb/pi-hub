# Pi Hub status — 22 October 2026

This is the current checklist. See the [README](../README.md) for local checks and the [operations guide](operations.md) for deployment and rollback. [The original plan](plan.md) and [roadmap](roadmap.md) preserve delivery history; neither is a live equipment inventory.

## Built

Home, Movies, Devices, Lists, Print, Workshop, Weather, symptom guides, alerts, automations, owner/household/child access, backups and off-Pi copy reporting, Siri Shortcuts, release checks and owner-requested rollback.

Commit `bfd3468` adds contextual help links and breadcrumbs, favourites on Devices and Home, device-local alert badges, compact issue summaries, and expandable movie/print details. Fix actions ask for confirmation and show a persistent outcome on Help. Expanded movie details remain open across refreshes.

## Release behaviour in `bfd3468`

- Python tests and JavaScript tests run before installing a release. JavaScript modules declare their module type so the tests do not depend on Node's automatic detection.
- One release can run at a time. Releasing the active SHA is a no-op.
- The app, helper scripts, service units, status script and camera port configuration are recovered after an installation or health-check failure. File modes are preserved; newly introduced files are removed.
- Recovery waits for the previous app's health endpoint. If recovery fails, its filesystem snapshot is retained and the release log says it needs attention.
- Owner-requested rollback schedules a separate systemd job and uses the same release gate. It survives restarting the helper.
- The installer verifies the actual running SHA, because a post-receive hook failure does not reject a Git push.

This is file/service recovery, not a database downgrade or a guarantee across power loss. Future schema changes need a migration/restore strategy. Selecting an older release also selects its older helper and release code.

## Verified locally

- 73 Python tests and 3 JavaScript tests pass.
- Release simulations cover failed JavaScript tests, partial installation, failed post-install checks, successful installation and repeat installation. Separate tests check manual rollback scheduling and refusal of invalid targets.
- Browser checks use a temporary local database. Contextual movie help opens correctly; phone (390px), tablet (1024px) and desktop (1440px) layouts were inspected. Phone and tablet checks found no horizontal overflow. The Devices empty state and movie-details refresh were checked with mocked device responses.
- The local Mac cannot supply Pi system diagnostics; the Help guides remain available when that API fails.

Deployment of `bfd3468` has not been performed or verified during the 22 October work recorded here. Earlier live-verification notes apply to their earlier releases.

## Needs live verification or household input

1. Deploy the committed release using the [operations guide](operations.md), verify its running SHA and run the full self-check.
2. Run a household acceptance session: shopping item, movie, document print and a symptom guide; include keyboard and screen-reader use.
3. Restore an off-Pi backup into an isolated environment and verify the household data.
4. Submit one real print and confirm camera operation with the Mac asleep.
5. Confirm current Homebridge, Wi-Fi, calendar, Tailscale and Local AI setup in Settings; historical notes do not establish current connectivity.
6. Test drive migration with the replacement drive. The roadmap records that the complete migration was unverified.
7. Consider workshop display firmware integration, UPS/power reporting and device modules only after the above checks.
