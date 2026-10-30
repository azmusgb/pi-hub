# Pi Hub status — 24 October 2026

This is the current checklist. See the [README](../README.md) for local checks and the [operations guide](operations.md) for deployment and rollback. [The original plan](plan.md) and [roadmap](roadmap.md) preserve delivery history; neither is a live equipment inventory.

## Built

Home, Movies, Devices, Lists, Print, Workshop, Weather, symptom guides, alerts, automations, owner/household/child access, backups and off-Pi copy reporting, Siri Shortcuts, release checks and owner-requested rollback.

Commit `bfd3468` adds contextual help links and breadcrumbs, favourites on Devices and Home, device-local alert badges, compact issue summaries, and expandable movie/print details. Fix actions ask for confirmation and show a persistent outcome on Help. Expanded movie details remain open across refreshes.

## Control room piece 1: records — 27 October

Release `b69c678` (spec `superpowers/specs/2026-10-27-control-room-design.md`, plan `superpowers/plans/2026-10-27-control-room-1-records.md`):

- **One record per thing.** 16 records (printer, camera, workshop display, PC, Local AI, Pi, movies drive, movie copy, internet, AdGuard, backups, Plex, devices, document printer, weather, and the hub itself), each from one designated source, kept in memory and in the `records` table. `GET /api/records` lists them; `GET /api/records/stream` sends changes as server-sent events (nothing uses the stream yet).
- **Home, the wall, Needs you, Help › Source responses and the Workshop printer card read records**, so they can no longer disagree. The printer's state comes from Bambuddy only; pi-status can only add a "two sources disagree" note.
- **Alerts come from record changes.** The PC is down only when it is off the network for 5 minutes (not when Local AI is down); the Pi-hot alert fires; a silent source is one "isn't answering" item; a stop and restart of the same job within 15 minutes is attempt 2; INIT without a job (power-on) is idle.
- Not yet: the morning digest and the Assistant still read pi-status; the pages do not grey out a stale record; Home can say "Everything's running" for under a minute after a restart.

Checked live on 27 October at 11:09–11:11: the Pi's gate passed 390 tests; `/api/records` listed 16 records 30 s after the restart, none stale at 11:11 (oldest 9 s); Home and Needs you both listed AdGuard (down) and the printer camera (no picture), and both said the printer was idle, as its record did; Help listed the same readings, all current except the unconfigured calendar; the wall browser check passed all 7 views. Not checked live: a print starting, failing or restarting (covered by replaying the night of 26–27 October in tests).

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

## Self-hosted app ideas — 24 October

These were reviewed from two nOvaxtech "self-hosted app spotlight" carousels (AI-generated mockups, so their screenshots and numbers aren't real). They're ranked by value to this household, given what's already running: the Pi 4 (4 GB) with Plex, Homebridge, Bambuddy, NETMON/Grafana, Uptime Kuma and Pi Hub, and the Windows PC (32 GB, Docker) with the LocalAI stack, which includes SearXNG.

**Value:** High · Medium · Low · None (overlaps something that already runs, or doesn't fit). **Status:** Done · Waiting on you (needs your answer or an action only you can take) · Proposed · Already running · Skip.

| Rank | Idea | Status | Value | Where | Review |
|---|---|---|---|---|---|
| 1 | **Paperless-ngx** (documents, OCR, search) | Done 24 Oct | High | PC, `http://10.0.0.21:8010` | Fills a real gap. Nightly export at 03:15, pulled to the Pi at 04:00 (14 daily snapshots), with a self-check line and a two-days-stale alert. See [operations](operations.md#paperless-and-scanning). |
| 2 | **Scan to Paperless** (scanservjs) | Done 24 Oct | High | Pi, `:8095`, App Suite → Scan | One tap from the HP (feeder or glass) or the Epson to Paperless. Every PDF is uploaded and the Pi's copy is deleted. Not yet tested end to end with a real document from the page. |
| 3 | **Immich** (photo library) | Waiting on you | High | PC (its machine learning is too heavy for the Pi) | The best replacement for iCloud/Google Photos. Needs a second drive in the PC and a UPS first: C: is the PC's only disk, and its power keeps getting cut by a problem outside the PC. |
| 4 | **Audiobookshelf** (audiobooks, podcasts) | Waiting on you | High if you have audiobooks, otherwise None | Pi, next to Plex | Good iPhone app that remembers your place. Plex handles audiobooks badly. Worth it only if there's a collection of audiobook files. |
| 5 | **Actual Budget** (household budget) | Waiting on you | Medium–High if you'll budget | Pi | Private, light and imports bank CSVs. Separate from the business's QuickBooks. Only worth it if someone will keep it up. |
| 6 | **Self-hosted ntfy** (alerts) | Done 30 Oct | Medium | Pi, `http://10.0.0.30:8093` / `https://ntfy.home.arpa` | Service running on port 8093 with APNs wake relay. Phone subscribed, iOS lock screen banners verified, public ntfy.sh dropped. All household alerts are 100% private. |
| 7 | **Sign-in for the scan page** | Proposed | Medium | Pi | The scan page has no login; anyone on the LAN or tailnet can scan into Paperless. A small proxy with the household PIN would close this. Bambuddy's open UI on :8000 has the same problem (see 24 October follow-up). |
| 8 | **Home Assistant** (smart home) | Proposed | Medium | Pi | Could replace Homebridge and much of Pi Hub's rules and controls. A migration rather than a gap, so it isn't urgent. |
| 9 | **Homebox** (home inventory) | Done 24 Oct | Low–Medium | Pi | Tools, parts, warranties and serial numbers. Overlaps a little with the filament shelf. |
| 10 | **Linkwarden** (saved links with page copies) | Proposed | Low–Medium | Pi or PC | Nice to have; nothing is broken without it. |
| 11 | **Calibre-Web** (ebooks) | Waiting on you | Low unless you have ebooks | Pi | Only useful with an existing EPUB library. |
| 12 | **SearXNG as the phone's search engine** | Already running | Low | PC (LocalAI stack) | It already exists for LocalAI but isn't published. Exposing it means changing the LocalAI stack, and Claude can't restart that stack over SSH. |
| 13 | **Grafana + Prometheus** (metrics) | Already running | None | Pi (NETMON, `:3000`) | Already in the App Suite. Nothing more to add. |
| 14 | **LibreNMS** (network monitoring) | Skip | None | — | Uptime Kuma, Grafana/NETMON and Pi Hub alerts already cover it, and it's heavy for the Pi. |
| 15 | **Syncthing** (file sync) | Skip | Low | — | The movie copy already uses rsync. Only worth it for phone↔PC folder sync. |
| 16 | **Gotify** (push alerts) | Skip | None | — | No iPhone app. Self-hosted ntfy (#6) does the same job better. |
| 17 | **Authentik** (single sign-on) | Skip | Low | — | Far too heavy for one household. #7 solves the actual gap. |
| 18 | **Headscale** (Tailscale control server) | Skip | None | — | Free Tailscale already works. Running it yourself puts remote access at risk if it breaks. |
| 19 | **MinIO** (S3 storage) | Skip | None | — | No use here, and its free edition has had features removed. |
| 20 | **TrueNAS SCALE** (NAS OS) | Skip | None | — | A whole operating system that needs its own box with several drives. |

**Prerequisites that make the top ideas safer:** a UPS for the PC, and BIOS "Restore on AC power loss = Power On" (both needed before #3); a second drive in the PC (#3).

## Bambuddy holds spools and projects — 24 October

Four places each had their own spool list: the hub's filament shelf, its project board, the Filament Inventory app and print-lab's `filaments.json`. Bambuddy is now the record for spools, projects, the queue and the archive. The hub's shelf and board (both empty) were removed, along with their write routes (`POST /api/filament…`, `/api/projects…`, `/api/prints/{id}/filament`, project files). Workshop reads Bambuddy instead, and `filament_low` now comes from Bambuddy's spools. See [household features](household-features.md#workshop-projects-and-filament-bambuddy-since-24-october-2026).

Still to do: the Workshop display's filament line comes from the Filament Inventory feed, which isn't configured. Point it at Bambuddy through Local AI's display feed, and change Workshop OS's "Filament Inventory is the sole authority" docs. The owner is checking whether the Filament Inventory app holds anything worth importing; if not, it will be retired.

## One home, step 1: the front gate — 24 October

Live on the Pi (design `docs/superpowers/specs/2026-10-24-one-home-design.md`, operations › "The front gate"). Caddy holds :80/:443 and fronts 12 names under `home.arpa`. Every name except `home.` needs the hub's owner sign-in, the hub listens on 127.0.0.1:8100, and Grafana signs the owner in by itself. AdGuard answers the names. `deploy/gate-check.sh` passes all 39 checks. The old addresses still work.

- **Fixed for the new names:** Local AI is reached by its own address behind the gate, and Paperless trusts `https://paperless.home.arpa` for its login form (`PAPERLESS_CSRF_TRUSTED_ORIGINS` in `C:\Paperless\compose.yml`, backup `compose.yml.bak-20261024`).
- **Waiting for the owner:**
  - set the Orbi's DNS to the Pi;
  - trust the CA on the iPhone and the Mac;
  - add Tailscale split DNS for `home.arpa`;
  - open `https://bambuddy.home.arpa` on the iPhone (Wi-Fi and cellular).

  Not yet seen in a real browser: the shared cookie across names, Cockpit's web socket, and the sign-in loop guard.

**Baseline for the acceptance re-walk** (from the 24 October critique, before the gate):

| Task | Steps and logins today |
|---|---|
| Find a bill | 4 steps and a login (Paperless), nothing in Local AI |
| Check and clear the print | shown in 4 places, actionable in 1 (the display) |
| Why is the internet slow | 3 places (hub, Grafana with its own login, Uptime Kuma) |
| Restore a file | hard to find (Backrest, own login, technical words) |
| Start a movie | two systems (hub Movies, Plex) |

After step 1, the logins for Grafana disappear and every tool is one name away. The other counts move in steps 2–4.

## One home, step 2: the hub's structure — 25 October

Live on the Pi (plan `docs/superpowers/plans/2026-10-24-one-home-step-2-structure.md`; operations › "The hub's menu").

- **Menu:** Home · Workshop · Documents · Media · Home & network · System, plus Assistant. The Home tab's badge counts Needs you.
- **Home:** six cards, Needs you first.
- **Removed:** the App Suite. Its old addresses redirect.
- **Words:** the X2D is named correctly in the hub. Bambuddy's own printer name is still "Bambu P1S", and it shows in print messages; rename it in Bambuddy › Printers.
- **Browser check:** all 24 views pass (390 and 1440 px, light and dark, axe).

**Waiting for the owner:**
- In Paperless, add the workflow that shares each new document with the user `hub` (operations › Paperless). Until then, Documents search finds only what is shared with `hub`. Paperless holds 0 documents today.
- Re-walk the five critique tasks on the iPhone for the step and login counts, once the step-1 DNS and certificate steps are done.

## One home, step 3: one printer — 25 October

Plan `docs/superpowers/plans/2026-10-25-one-home-step-3-printer.md`.

- **Buttons:** Workshop shows "Clear the plate" (after a finished or failed print), "Pause the print" (while printing) and "Resume the print" (while paused), from Bambuddy's own state and its `awaiting_plate_clear` flag. Home's Workshop card offers "Clear the plate" too.
- **Path:** `POST /api/printer/{clear,pause,resume}`, owner only, through Bambuddy with the hub's own control key (operations › Bambuddy's sign-in). Clear plate makes the same two calls as Local AI's display path (clear-plate, then hms/clear).
- **Questions first:** Clear plate asks whether the plate is empty, because Bambuddy may start the next queued print; Pause asks too.
- **Errors in plain words:** no key yet, Bambuddy refused the key, Bambuddy isn't answering.
- **Gate check:** signed-out pause is refused (401).


## One home, step 4: Assistant — 25 October

Plan `docs/superpowers/plans/2026-10-25-one-home-step-4-assistant.md`. Local AI PR #389 (merge 214e989, live as 2.0.933).

- **Hand-off:** the hub's Assistant button opens `#ask?context=Pi Hub › <page>: <facts>`; Local AI shows it as a plain-text line over the composer and sends it once, with a Chat or Research question only, marked as page facts. Checked live: Workshop → "Context: Pi Hub › Workshop: Printing, 80%", mode Chat.
- **PC off:** `GET /api/assistant`; the button reads "The PC is off" only when the status service says Local AI is Down.
- **Local AI:** opens on its Assistant; the printer line and the Hub/Terminal/Materials bar are gone; "← Home" goes to the hub. Card titles: a caller's label ("House question"), a whole title up to 72 characters, or the kind's name.
- **Later:** Recent still lists each hourly health check (grouping repeats is a separate change).

## One home, step 5: one look — 25 October

Plan `docs/superpowers/plans/2026-10-25-one-home-step-5-look.md`. Kit appliance-ui 1.1.1 (pushed).

- **Kit:** the contrast gate now covers status chips, the danger button and the header badge on their own tints (4.5:1), field borders (3:1) and accent text on its tint; four light status colours darker; new `--ui-field-line` and `--ui-header-total`.
- **Pi Hub (live):** colours, font and components from the kit (`hub/static/ui`, checked by `verify.py`); amber only on the printer band (`--band-accent`), which is a card again; the wall passes contrast in daylight; a styled signed-out Scan page. Browser check: 28 views (now including the wall) pass.
- **Local AI:** PR #390 (green in local CI: 824 unit tests, 52/52 browser suites) carries the kit's dark colours in its one stylesheet; waiting for the owner's `npm run ship -- 390`.
- **Later (from the review), done 25 Oct (hub 8f7144c, kit 1.2.0, Local AI #390):** the kit gate doesn't yet check the real `accentSoft` tint or the `surface-2` background; signed-out Scan follows the device theme; a few old navy/warm values remain in Local AI and the hub's shadows.
  Kit 1.2.0 checks every pair on the well and accent text on `accentSoft` (eight colours nudged). Hub shadows and the
  backdrop use the kit's ink; the kiosk light uses `--warn`; Scan reads `hub-theme` via `/static/js/saved-theme.js`.
  Found on the way: the hub's `--*-rgb` triples were comma-separated but used as `rgb(var(--x-rgb) / a)`, which is
  invalid, so 30 tints, borders and shadows never rendered; they are now `r g b` and a test keeps them so.


## Shared facts and LocalAI attention — source changes, 28 October

The Assistant now reads the same household records as Home, including source and reading age. Missing readings stay
unknown; stale telemetry is historical. Removed the hard-coded movie count, disk capacity/free space, connected-drive
and backup-success assertions. A failed Plex playback read is distinct from a confirmed empty playback list.

LocalAI attention now comes from `/api/attention`, containing LocalAI's own cards without a Pi Hub fetch. The hub owns
the aggregate `/api/needs`; the display consumes that list through LocalAI. Deploy the LocalAI endpoint before this
consumer. If that endpoint is unavailable, the hub reports LocalAI as unread. These are local source changes, not a
record of a Pi deployment or live equipment acceptance.

Local verification for these source changes: 654 Python tests passed, 8 skipped; 164 JavaScript tests passed;
installer/release shell syntax and whitespace checks passed. The skips remain unverified, and these results are not
live household acceptance.
