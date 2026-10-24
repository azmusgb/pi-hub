# Pi Hub status — 24 October 2026

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

## Household features follow-up — 22 October

- Movie night now has a persistent shortlist, named-person/session votes, time and ratings filters, explained suggestions and a shared pick.
- Workshop has a four-stage planning board with notes, reference links, downloadable model files, estimates and spool shortage/overcommit warnings. Existing live printer status remains first.
- Automations have safe previews against recent events, durable run outcomes and a Needs a look filter. Missing telemetry is excluded from event transitions.
- Backups include a consistent snapshot of both the database and referenced project files. Parallel first-request column initialization is serialized.
- See the [feature guide](household-features.md) for exact behaviour, permissions and limits. These additions are deployed in application release `2be5dcc9eb`, including search-to-shortlist nomination and offline shell v64.

## 23 October additions

Deployed through release `5d968f2aaf` (the Pi was running it on 24 October):

- **Movies from the Windows PC.** The Pi mounts `//10.0.0.21/Movies` at `/mnt/windows-movies`; the Plex section shown is the Windows library (148 films indexed). Movies can switch between Plex libraries, has a catalogue browser, genre filter and poster badges, and results are de-duplicated across libraries. Movie night voting is on the Movies page.
- **Network.** Home and the Pi page show NETMON probe latencies (Prometheus on port 9091, Grafana on 3000, Uptime Kuma on 3001, all on this Pi in Docker) and Orbi RBR750 router uptime, public IP and throughput from the UPnP reader on port 9120. A missing probe is reported as unknown, not healthy.
- **Rules.** New triggers for WAN packet loss and WAN down (from NETMON's firing alerts), and new default phone alerts for a finished print, the PC down for 5 minutes and WAN packet loss. A flash-the-workshop-light action is available. The morning digest adds overnight network and backup lines.
- **Printer and Bambuddy.** Bambuddy runs in Docker on the Pi (port 8000) and is probed for live printer state at 10.0.0.136. Its "Pi Hub Automation Bridge" webhook posts print start/finish/failure and filament-low events to `/api/webhook/bambuddy`, which records prints, saves the completion photo and grams used, and fires rules. **The webhook needs the shared token** (`webhook_token` setting or `HUB_WEBHOOK_TOKEN`) as `?token=`, `X-Hub-Token` or a Bearer header; other requests get 401. Payloads over 8 MB are refused.
- **Navigation and wall.** An App Suite launchpad embeds the Pi's other services, with short paths `/bambuddy`, `/grafana` and `/status`. `/wall` is a kiosk mode with the live nozzle camera, print telemetry and a one-tap shop light.

### Follow-up — 24 October

- **Windows movie share.** It is mounted once at boot (`nofail`, no retry); on 23 October at 22:09 that failed with "host unreachable" and Home showed movie status as unavailable until it was mounted by hand. `pi-hub-movies-mount.timer` now retries every 5 minutes (2 minutes after boot) when the share is in fstab but not mounted. It does not recover a share that is mounted but hung because the PC went away.
- **One alert per print.** Bambuddy's webhook and the printer status both reported each print; they are now de-duplicated (the second report of the same start/finish/failure within 10 minutes is dropped), and a print already under way when the hub restarts no longer counts as a new one. Bambuddy's own ntfy notifier used the household topic too, so its print complete/failed/stopped alerts were turned off; the hub sends those, respecting quiet hours, through the print-finished rule and a new default print-failed rule. Bambuddy still sends its other alerts (plate not empty, queue, AMS drying) directly, with a photo where it has one. The hub's print alerts carry no photo.
- **Still open:** Bambuddy's own API and web UI on port 8000 are reachable from the LAN without signing in, including printer control. Turning on Bambuddy sign-in needs an owner-chosen password, and the hub's status probe (`HUB_BAMBUDDY_PRINTER_URL`) would then need a Bambuddy API token.

## Release and backup behaviour

- Python tests and JavaScript tests run before installing a release. JavaScript modules declare their module type so the tests do not depend on Node's automatic detection.
- One release can run at a time. Releasing the active SHA is a no-op.
- The app, helper scripts, service units, status script and camera port configuration are recovered after an installation or health-check failure. File modes are preserved; newly introduced files are removed.
- Recovery waits for the previous app's health endpoint. If recovery fails, its filesystem snapshot is retained and the release log says it needs attention.
- Owner-requested rollback schedules a separate systemd job and uses the same release gate. It survives restarting the helper.
- The installer verifies the actual running SHA, because a post-receive hook failure does not reject a Git push.

This is file/service recovery, not a database downgrade or a guarantee across power loss. Future schema changes need a migration/restore strategy. Selecting an older release also selects its older helper and release code.

## Verified locally

- 119 Python tests and 8 JavaScript tests pass (24 October).
- Release simulations cover failed JavaScript tests, partial installation, failed post-install checks, successful installation and repeat installation. Separate tests check manual rollback scheduling and refusal of invalid targets.
- Browser checks use a temporary local database. Contextual movie help opens correctly; phone (390px), tablet (1024px) and desktop (1440px) layouts were inspected. Phone and tablet checks found no horizontal overflow. The Devices empty state and movie-details refresh were checked with mocked device responses.
- New tests cover stale-data retention, unchanged cache confirmation times, restored source responses, absent setup, access control, direct recovery probes, bounded retries and cancelled checks. Browser checks with mocked integrations cover confirmed/unconfirmed recovery, read-only rechecking, and phone/tablet/desktop overflow.
- The local Mac cannot supply Pi system diagnostics; the Help guides remain available when that API fails.

Application commit `2be5dcc9eb` was deployed to the Pi on 22 October 2026. The Pi ran all **104 Python tests and 8 JavaScript tests** before activation. The page/API release gate passed and the subsequent full self-check passed **39 of 39** checks.

Live browser verification covered Movies/Movie night, Workshop projects and Automations at 390px, 1024px and 1440px with no horizontal overflow or console errors. Local flow tests additionally covered votes, a chosen film, search nomination, project/file changes, draft retention and nonexecuting previews. Demo data stayed in an isolated local database; installation seeds no demo projects, votes or run outcomes.

A fresh live backup completed successfully (`pi-20261022-1331.tgz`) and its archive was verified to contain `hub.db` and `var/lib/pi-hub/project-files`. The automated isolated restore test confirms a referenced model's bytes are included with its project row. A full restore drill of the household's off-Pi backup is still outstanding.

### Movie catalogue needs attention

Plex reports one movie section, configured at `/mnt/usb1/Movies`, with **zero indexed movies**. A direct folder metadata check stalled in kernel filesystem I/O and was terminated. This is separate from the feature release; the API/service self-check does not prove individual movie-folder access or playback. Movie night suggestions and library search need a readable, indexed Plex catalogue. The new search nomination path supports previously watched films once they are searchable.

No live recovery action or physical printing/playback/device-control test was performed during this feature deployment.

## Needs live verification or household input

1. Investigate movie-folder access and restore the Plex catalogue before relying on Movie night suggestions or playback. Deployment, live page checks and the initial operational self-check are complete.
2. Run a household acceptance session: shopping item, movie, document print and a symptom guide; include keyboard and screen-reader use.
3. Restore an off-Pi backup into an isolated environment and verify the household data.
4. Submit one real print and confirm camera operation with the Mac asleep.
5. Confirm current Homebridge, Wi-Fi, calendar, Tailscale and Local AI setup in Settings; historical notes do not establish current connectivity.
6. Test drive migration with the replacement drive. The roadmap records that the complete migration was unverified.
7. Consider workshop display firmware integration, UPS/power reporting and device modules only after the above checks.
