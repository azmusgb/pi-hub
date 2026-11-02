# Operating Pi Hub

## Deploy from the Mac

Prerequisites: a clean, committed checkout; an SSH host named `pi`; access to the configured Pi account and its required sudo commands; and the Pi's existing Python runtime and integrations. The installer is tailored to this household's Pi, including the `bjrmc` account and existing Plex/Homebridge/status setup. It is not a generic fresh-system installer.

From the repository root:

```sh
deploy/install.sh
```

The installer ships **local `main`**, regardless of the checked-out branch. Ensure the intended commit is on `main`. It provisions supporting packages, including Node.js for JavaScript tests, installs the incoming release runner, configures the Git hook and pushes `main` to the Pi repository at `/srv/pi-hub.git`.

The release runner:

1. Takes a lock so another release cannot install concurrently. The active SHA is a no-op.
2. Unpacks the commit into a staging directory and runs Python tests with a temporary database. If the target contains JavaScript tests, it runs those too. Test failure leaves the running installation unchanged.
3. Generates icons and snapshots installed helper scripts, service units, the status script and the camera port drop-in.
4. Installs the supporting files, switches `/opt/pi-hub/current`, and restarts the relevant services.
5. Waits for `/healthz`, then runs the page/API release gate.
6. Records success and retains the five newest release directories plus the running release. On installation or gate failure it attempts to restore the previous app and supporting files, including permissions, and removes newly introduced files.

A failed post-receive hook does not reject the Git push. The installer therefore checks that `/opt/pi-hub/current` names the requested commit before reporting success. Read the release output and Settings → Versions if this check fails.

## Verify after deployment

On the Mac:

```sh
ssh pi 'readlink -f /opt/pi-hub/current'
ssh pi 'curl -fs http://127.0.0.1/healthz'
ssh pi 'sudo systemctl status pi-hub pi-hub-helper x2d-camera-failover --no-pager'
```

`/healthz` reads the hub's database on every call: 200 `{"ok": true}` when it can, 503 `{"ok": false, "error": "database"}`
when it can't. The release gate and the outside heartbeat (platform baseline, section 11 step 2) rely on that.

In the app, check Home, a contextual help link, Devices, Movies and Print. Confirm phone navigation and fresh data. Opening a page is separate from proving that a light switches, a movie plays, or a document prints.

For the full operational check, use Help & system → System checks & advanced fixes → Run a self-check. The equivalent on the Pi is:

```sh
sudo systemctl start pi-hub-selfcheck.service
cat /var/lib/pi-hub-selfcheck/last.json
```

The full self-check checks services, storage, backup age and temperature in addition to pages/APIs. It can send a failure alert. The release gate (`pi-hub-selfcheck.py --gate`) checks pages/APIs only and does not save the nightly result or send an alert.

## Source responses and recovery checks

The **Source responses** section on Home and integration pages shows response ages and selected last-known summaries. A recent HTTP page response does not make every integration current: the page footer and source-response ages measure different things. An earlier reading is explicitly marked as unconfirmed. These response histories are process-local and reset on app restart; they are not a durable monitoring log or proof of the device's own measurement time.

`GET /api/freshness` returns the existing response history without polling hardware. Unconfigured integrations do not expose an old summary. Failed source reads continue to return missing live data to rules and other backend consumers.

After a Plex/Homebridge restart or movie-drive remount, Help makes up to three direct read-only recovery checks. **Check recovery again** runs these checks without repeating the fix. The protected endpoint is `GET /api/actions/{name}/verification` and requires household or owner access. It does not run helper actions.

A passing movie recovery check means Plex responds and a filesystem other than autofs is mounted at `/mnt/usb1`; it does not test TV playback or every movie file. A passing Homebridge check means the accessories API returns controllable devices; it does not operate a light or plug. Follow the displayed next step and try the original task. Pi reboot, updates and scans do not have this generic recovery check.

## Roll back

Use Settings → Versions → Go back to this with owner access. The helper schedules a separate systemd job that runs the selected commit through the release checks before switching. Its initial response confirms scheduling, not successful activation; check Versions and the running SHA afterward.

For an operator on the Pi, the same checked path is:

```sh
sudo /usr/local/lib/pi-hub/pi-hub-release <commit>
```

Use a retained, known commit. Selecting an old release installs its historical helper and release code as well, which may predate the current recovery improvements.

If a release fails, the runner attempts recovery and waits for the previous app's health endpoint. If recovery needs attention, it retains the supporting-file snapshot and records its path in `/var/lib/pi-hub-releases/releases.json`. Inspect the log and service journal before making further changes:

```sh
cat /var/lib/pi-hub-releases/releases.json
sudo journalctl -u pi-hub -u pi-hub-helper -n 100 --no-pager
```

For an owner-scheduled rollback, also inspect `journalctl -u pi-hub-rollback.service`. Retained recovery snapshots contain installed supporting files; they are not database backups.

## Data and recovery boundaries

| Item | Pi location |
|---|---|
| Running release link | `/opt/pi-hub/current` |
| Retained application releases | `/opt/pi-hub/releases` |
| Release results | `/var/lib/pi-hub-releases/releases.json` |
| Household database | `/var/lib/pi-hub/hub.db` |
| Plex secret directory | `/etc/pi-hub/secrets` |
| Installed helpers | `/usr/local/lib/pi-hub` |
| Project model files | `/var/lib/pi-hub/project-files` |
| Nightly backup archives | `/var/backups/pi-hub` |
| Last full self-check | `/var/lib/pi-hub-selfcheck/last.json` |
| Movies Plex plays | `/mnt/usb1/Movies` (copy of the PC's `//10.0.0.21/Movies`) |
| Films removed on the PC, kept 30 days | `/mnt/usb1/.movies-removed` |
| Last movie copy result | `/var/lib/pi-hub-mirror/state.json` |
| Paperless backups (14 daily snapshots) | `/mnt/usb1/backups/paperless` |
| Last Paperless backup result | `/var/lib/pi-paperless-backup/state.json` |
| Scanner page (scanservjs, behind the hub at `/scan/`) | `/opt/scanservjs` |

The nightly backup script takes a consistent SQLite copy plus its referenced project model files, then archives selected Pi settings and Caddy's local CA (`/var/lib/caddy/.local/share/caddy/pki`). The Workshop display pins that CA, so restoring it is what saves a USB re-flash after rebuilding the Pi. A SQLite writer lock protects the database/file snapshot; mutations may briefly wait during this step. See the [household feature guide](household-features.md) for attachment limits and restore expectations. The Windows pull script is `deploy/windows-pull-backups.ps1`; historical deployment notes record copies in `C:\LocalAI\pi-backups`. Confirm freshness in Settings and the self-check rather than assuming that scheduled copies succeeded.

### Restore Caddy's local CA (the display's trust anchor)

The Workshop display pins this CA's root certificate (`home.home.arpa` for the feed, `updates.home.arpa` for updates). This is a temporary compatibility boundary: every other client uses `*.rahe-home.duckdns.org` with a public certificate. It ends when the firmware can use the production names and trust without a risky field migration. Until then, a rebuilt Pi must get **the same CA back**. If Caddy creates a new one, the display stops trusting the Pi until it is re-flashed over USB.

The root to expect has SHA-256 fingerprint `C1:B4:0C:93:3F:4D:F2:5E:F7:04:DE:D4:11:65:AD:31:7B:3D:5C:B4:C9:D0:B4:03:75:B2:E8:77:9D:09:12:45`.

Copies, newest first:
- `/var/backups/pi-hub/pi-*.tgz` on the Pi (14 days).
- The `pi` restic repository in Backrest (USB drive).
- `C:\LocalAI\pi-backups\pi-*.tgz` on the PC.

Restore before Caddy serves the house names, or with Caddy stopped:

```sh
sudo systemctl stop caddy
sudo tar -xzf /path/to/pi-YYYYMMDD-HHMM.tgz -C / var/lib/caddy/.local/share/caddy/pki
sudo chown -R caddy:caddy /var/lib/caddy/.local/share/caddy/pki
sudo chmod -R go-rwx /var/lib/caddy/.local/share/caddy/pki
# Certificates issued by any other CA in the meantime must go, or Caddy keeps serving them:
sudo rm -rf /var/lib/caddy/.local/share/caddy/certificates/local
sudo systemctl start caddy
curl -s http://10.0.0.30/home-ca.crt | openssl x509 -noout -fingerprint -sha256   # must match the fingerprint above
```

Then check the display still reaches Pi Hub (the Workshop display card on `/system`).

To test a backup without touching the running Pi, extract the `pki` folder into a temporary directory and compare `sha256sum` of `authorities/local/root.crt` and `root.key` with the live files. On 1 Nov 2026 this matched for the Pi archive and the PC copy, and the restored key matched the restored certificate.

Application rollback does not restore SQLite data or undo schema migrations. The release mechanism does not guarantee recovery across power loss. A database restore drill and a schema migration strategy remain outstanding; use [the status checklist](status.md) to track them.

## Movie copy from the PC

The Windows PC holds the master copy of the films; add and remove them there. `pi-hub-movies-mirror.timer` copies films and subtitles one way to the Pi's drive each night at 02:30, and **Drives → Copy new movies now** starts a run. Plex on the Pi plays only the local copy, so movies work while the PC is off.

A run copies and removes nothing when the share isn't mounted, lists no films, or lists fewer than 90% of the films the last good run saw. After deliberately removing many films on the PC, run once by hand: `sudo /usr/local/lib/pi-hub/pi-hub-movies-mirror.py --accept-drop`. A run also stops before the drive would pass 90% full. Removed and replaced films go to `/mnt/usb1/.movies-removed/<date>` and are deleted after 30 days; to restore one, move it back into `/mnt/usb1/Movies` and also put it back on the PC, or the next run sets it aside again. Results: Drives page, `journalctl -u pi-hub-movies-mirror`, the self-check ("Movies copied from the PC", under 50 hours) and the default two-days-stale phone alert.

If the Pi's drive fails, fit a new one at `/mnt/usb1` (fstab UUID) and run the copy; everything comes back from the PC. The Bambuddy and NETMON Docker data also live on that drive under `/mnt/usb1/bambuddy` and `/mnt/usb1/netmon` and are not part of the copy.

Do not unpack a backup over the running system as a verification step. Validate it in an isolated environment first, and plan any production restore separately.

## Paperless and scanning

Paperless-ngx runs on the Windows PC (`http://10.0.0.21:8010`, files in `C:\Paperless`), not on the Pi. The PC exports it every night at 03:15 to `C:\Paperless\export`, which is shared read-only as `PaperlessExport$` with the account the Pi already uses for the movie share. The Pi automounts that share at `/mnt/paperless-export` (fstab, `x-systemd.automount`). At 04:00, `pi-paperless-backup.timer` copies it into a dated snapshot under `/mnt/usb1/backups/paperless`. Unchanged files are hard-linked, so each snapshot costs only what changed, and the last 14 are kept. A failed run (PC off) leaves earlier snapshots alone. Results: `journalctl -u pi-paperless-backup`, the self-check ("Paperless backed up from the PC", under 50 hours) and the default two-days-stale phone alert. The snapshots hold tax and medical papers, so only root can read them.

Scanning runs on the Pi in Docker (scanservjs, listening on `127.0.0.1:8095` only). The hub serves it at `/scan/` (**App Suite → Scan**, linked from Print and More), and only for the owner (one of your devices, or the owner password). It reaches the HP DeskJet 4200 (glass and feeder) and the Epson ET-2760 (glass) through sane-airscan. The container needs `/var/run/dbus` mounted, or it finds no scanners. `config.local.js` sends every finished PDF to Paperless as the upload-only user `scanner`, tags it "Scanned", then deletes the Pi's copy. Image formats stay in `/mnt/usb1/scans`. The token is in `/opt/scanservjs/paperless.env` (root 600).

## Bambuddy's sign-in (on since 24 October 2026)

Bambuddy (Pi, port 8000) requires sign-in since 24 October 2026. The admin account is `bill`; its password is in `/etc/pi-hub/secrets/bambuddy_admin` (root only). Three callers use scoped API keys:

| Caller | Needs | Key | State |
|---|---|---|---|
| Pi Hub: printer status, spools, projects | read | API key with **Read status** only, in `/etc/pi-hub/secrets/bambuddy_api_key` (root:pi-hub 640) | Done |
| Local AI: the display's Materials card | read | another **Read status** key, as `LOCALAI_MATERIALS_KEY` in `C:\LocalAI\stack\stack.env` | Key in `stack.env`; the container must be recreated to read it |
| Pi Hub: Clear the plate, Pause, Resume (Workshop and Home) | printer control | API key with **Control printer** only, printer 1 ("Pi Hub control"), in `/etc/pi-hub/secrets/bambuddy_control_key` (root:pi-hub 640). Made once by `sudo python3 /opt/pi-hub/current/deploy/bambuddy-control-key.py`, which signs in as `bill` and never prints the key | To do (owner runs the script) |
| Workshop display: Clear plate | printer control | goes through Local AI (`POST /api/display/printer/clear`), which uses `LOCALAI_BAMBUDDY_CONTROL_KEY` ("Control printer", printer 1 only) | Key in `stack.env`; firmware `e2af9bf` installed |

Bambuddy's webhook to the hub goes the other way and isn't affected. The Bambuddy page in the App Suite asks for a sign-in once per browser.

The Local AI keys are also kept in `/etc/pi-hub/secrets/bambuddy_localai_keys.env` (root only), for re-installing them. To turn sign-in off again: Bambuddy › Settings › Authentication.

### The hub's view of Paperless (since 25 October 2026)

The hub's Documents section searches Paperless as the user `hub`. That user can only view documents, correspondents, tags and document types, and has no password. Its API token is in `/etc/pi-hub/secrets/paperless_token` (root:pi-hub 640) and is never shown. Paperless shows a document only to its owner and the users it is shared with. So that `hub` sees new ones, add a workflow in Paperless › Workflows: trigger "Document Added", action "Assignment", "Grant view permissions" to user `hub`. To turn the hub's view off, delete the token in Paperless › Settings › Users › `hub`.

## Phone alerts (ntfy)

Alerts go to the household topic in `/etc/pi-status/ntfy_topic`, on every server listed in `/etc/pi-status/ntfy_servers` (one URL per line; ntfy.sh when the file is missing). Pi Hub, pi-status and Bambuddy all publish there.

A self-hosted ntfy is installed at `/opt/ntfy` (Docker, port 8093, cache on the USB drive) and runs behind Caddy at `https://ntfy.home.arpa` as well as direct LAN `http://10.0.0.30:8093`. It is configured with `upstream-base-url: "https://ntfy.sh"` so iOS lock-screen banners wake properly via APNs while keeping message bodies private. Household alerts in `/etc/pi-status/ntfy_servers` route 100% to the local instance (`http://127.0.0.1:8093`).

## Outside heartbeat (Healthchecks.io)

The one alarm that does not depend on Pi Hub (platform baseline D2). Every 5 minutes `pi-hub-heartbeat.timer` fetches
`https://hub.rahe-home.duckdns.org/healthz` through Caddy on the Pi, with the real certificate. `/healthz` reads the
database. Only a `{"ok":true}` answer sends a ping to the Healthchecks.io check `home-platform-alive` (period 5 min,
grace 5 min). A failed check sends nothing, so Healthchecks.io alerts after about 10 minutes of silence and again
when pings resume.

- **Secret:** `/etc/pi-hub/healthchecks.env`, owned by root, mode `0600`, one line `HC_PING_URL=<the check's ping URL>`.
  It is never in the repo. Like the other `/etc/pi-hub` secrets it is in the nightly backup, so a restored Pi keeps
  its heartbeat. Until the file exists, the service skips itself.
- **Started by:** each live release (`systemctl enable --now pi-hub-heartbeat.timer`) and `deploy/install.sh`.
- **Check it:** `ssh pi 'systemctl list-timers pi-hub-heartbeat.timer; journalctl -u pi-hub-heartbeat -n 5 --no-pager'`.
  A healthy run logs nothing. A failure names its cause and never the URL.
- **Acceptance test (outage path):**
  1. Stop the pings with `ssh pi 'sudo systemctl stop pi-hub-heartbeat.timer'`. Pi Hub itself stays up.
  2. Watch the check go Late (about 5 min), then Down (about 10 min), and confirm the alert arrives.
  3. Restart with `ssh pi 'sudo systemctl start pi-hub-heartbeat.timer'` and confirm the "up" notice.
- **Accepted 2 Nov 2026** (platform baseline step 2, D2):
  - Before: the dashboard showed Up, with the last ping at 02:31:17, the last successful heartbeat run.
  - 02:31:36: only `pi-hub-heartbeat.timer` was stopped. `pi-hub` and Caddy stayed active, and `/healthz` answered 200.
  - 02:41:17: Healthchecks.io changed the check to Down and emailed "home-platform-alive is DOWN". That is 10 min after
    the last ping (period 5 + grace 5). Late was not watched separately; Down after the grace period implies it.
  - 02:49:32: the timer restarted, and one heartbeat ran straight away. At 02:49:33 the check was Up and the "is UP"
    email arrived (downtime 8 min 15 s).

## Homebox (home inventory)

Homebox runs in Docker on the Pi (`/opt/homebox`, port 7745, data on the USB drive at `/mnt/usb1/homebox`), linked from App Suite and More. It is for tools, parts, appliances, manuals and warranties; filament stays in Bambuddy. Sign-up is off; it was open only while the owner made their account. The API-key pepper is in `/opt/homebox/homebox.env` (root only); changing it invalidates Homebox API keys. To let another person sign up: `cd /opt/homebox && sudo HBOX_ALLOW_REGISTRATION=true docker compose up -d`, then run `sudo docker compose up -d` again afterwards.

## AdGuard Home (ad and tracker blocking)

AdGuard Home runs in Docker on the Pi (`/opt/adguard`, host networking, DNS on port 53, web UI on port 3002; Grafana has 3000). Its work data is on the USB drive. Upstream DNS is Quad9 and Cloudflare over HTTPS. The default AdGuard DNS filter is on. The admin is `bill`; the password is in `/etc/pi-hub/secrets/adguard_admin` (root only). Devices use it only when DNS points at `10.0.0.30`: set it per device, or in the Orbi (Advanced › Setup › Internet Setup › Domain Name Server: primary `10.0.0.30`, secondary `9.9.9.9`, which keeps the internet working if the Pi is down). If a site breaks, allow it under Filters › Custom filtering rules or in the Query log.

## Backrest (backups)

- **The Pi:** Backrest (`/opt/backrest`, port 9898, a web UI for restic) backs it up every night at 03:30 into `/mnt/usb1/backups/restic/pi`: hub backups, `/etc`, `/opt`, and Bambuddy, Homebox, Paperless snapshots and NETMON data. Encrypted; it keeps 14 daily, 8 weekly and 12 monthly snapshots, and prunes on Sundays.
- **The Mac:** backs up at 01:30 (launchd `com.billrahe.restic-mac`, script `~/.config/restic/mac-backup.sh`, log `~/Library/Logs/restic-mac.log`) over SFTP into `/mnt/usb1/backups/restic/mac`. That covers `~/dev`, `~/PycharmProjects`, `~/HealthData`, `~/.ssh` and Claude's memory, without build output or dependencies.
- **Passwords and login:** the repository passwords are in `/etc/pi-hub/secrets/restic_pi` and `restic_mac` (root only). The Mac's is also in its login Keychain as `restic-mac`. **Without them the backups can't be read.** Backrest's login is `bill`; the password is in `/etc/pi-hub/secrets/backrest_admin`.
- **Still to do:** both repositories sit on the same USB drive as the Movies and Bambuddy data. An off-site copy (another drive, or a cloud bucket, still encrypted) is the next step.

## The hub's menu (since 25 October 2026)

One menu by task (design: one home, step 2). The phone shows Home, Workshop, Documents, Media and More; More holds Home & network and System. The Assistant button opens Local AI and never carries a badge. The Home tab's badge is the count of Needs you.

| Section | Path | Inside |
|---|---|---|
| Home | `/` | Needs you (`/api/needs`: the hub's own live issues, Local AI's warnings, the printer) and one card per section |
| Workshop | `/workshop` | The X2D, camera, filament and projects (Bambuddy), Print lab, the workshop display |
| Documents | `/documents` | Find a document (owner only, Paperless user `hub`), Scan, `/print`, `/lists` |
| Media | `/media` | Movies (`/movies` redirects here), `/drives` |
| Home & network | `/network` | Devices (`/control` redirects here), Internet, Ad blocking (AdGuard via the root helper), Guest Wi-Fi |
| System | `/system` | Backup ages (restic snapshots via the root helper), `/alerts`, `/rules`, `/pi`, `/settings`, Cockpit |

Old App Suite addresses (`/apps/...`, `/bambuddy`, `/grafana`, `/status`) redirect to the section that now holds the tool. Links to tools use the `*.home.arpa` names when the hub is opened by one, and the old `IP:port` otherwise. Browser check from the Mac: `cd tests/browser && npm install && node structure.mjs http://10.0.0.30`.

## The front gate (since 24 October 2026)

Every house tool has a name under `home.arpa`, behind one sign-in (design: `docs/superpowers/specs/2026-10-24-one-home-design.md`).

| Name | Goes to |
|---|---|
| `home.home.arpa` | Pi Hub (no gate; it is where you sign in) |
| `assistant.home.arpa` | Local AI (PC, https://10.0.0.21) |
| `bambuddy.home.arpa` | Bambuddy (Pi :8000) |
| `paperless.home.arpa` | Paperless (PC :8010) |
| `homebox.home.arpa` | Homebox (Pi :7745) |
| `backups.home.arpa` | Backrest (Pi :9898) |
| `network.home.arpa` | Grafana (Pi :3000), signed in as `bill` automatically |
| `status.home.arpa` | Uptime Kuma (Pi :3001) |
| `adguard.home.arpa` | AdGuard (Pi :3002) |
| `devices.home.arpa` | Homebridge (Pi :8581) |
| `pi.home.arpa` | Cockpit (Pi :9090) |
| `scan.home.arpa` | scanservjs (Pi 127.0.0.1:8095) |

- **Break-glass access if Pi Hub is down:**
  If Pi Hub (`127.0.0.1:8100`) or Caddy fails, or if locked down to loopback under step 6, access Cockpit or Backrest directly via an SSH local port-forward:
  ```sh
  ssh -L 9090:127.0.0.1:9090 -L 9898:127.0.0.1:9898 pi
  ```
  Then open `https://localhost:9090` (Cockpit) or `http://localhost:9898` (Backrest) in your browser.

- **Names:** AdGuard rewrites `*.home.arpa` and `home.arpa` to `10.0.0.30`. A device uses them when its DNS is the Pi (the Orbi setting above), or, away from home, through Tailscale's split DNS for `home.arpa` (admin console › DNS).
- **Real names (from 1 Nov 2026; the home.arpa names are retired):** every tool answers at `<tool>.rahe-home.duckdns.org`, the hub at `hub.rahe-home.duckdns.org` (`docs/superpowers/specs/2026-11-01-real-names-design.md`). Public DNS (DuckDNS) points the name at the Pi's Tailscale address `100.92.174.18`, so it works on any device with Tailscale on; AdGuard rewrites `*.rahe-home.duckdns.org` to `10.0.0.30` for the house. One Let's Encrypt wildcard certificate covers them, renewed by Caddy through DuckDNS with the token in `/etc/pi-hub/secrets/duckdns.env` (root 600): no device needs to trust anything. Old `https://<tool>.home.arpa` addresses redirect to the same page on the real name. `home.home.arpa` stays only for the Workshop display (`/api/display/*`, pinned to Caddy's CA in its firmware), the Mac's Print lab sync (`/api/lab/*`) and `/home-ca.crt`; `updates.home.arpa` stays for the display's updates. Moving those needs a firmware release and a print-lab change.
- **The gate:** Caddy on the Pi (`/etc/caddy/Caddyfile`, installed by each release from `deploy/caddy/Caddyfile`) holds ports 80 and 443. Pi Hub now listens on `127.0.0.1:8100`. Each name except `home.` asks the hub's `GET /api/gate` first: the owner goes through, anyone else goes to the hub's sign-in and comes back after it.
- **Sign-in:** signing in as the owner at `https://home.home.arpa` lets each tool get its own `hub_gate` cookie on first visit through a one-time code (30 s, single use, that tool only), because `home.arpa` is a public suffix and browsers refuse a cookie shared across it. The cookie is a gate-only token (it ends with the sign-in that made it; it never works as a hub session, and Caddy empties it before any tool sees it). Signing out removes the sign-in and every gate token it made. If a tool keeps sending you back, the hub renews the gate token once, then says the browser is refusing the cookie. Tools with their own login (Bambuddy, Homebox, Backrest, AdGuard, Homebridge, Cockpit, Paperless, Local AI) still ask once per browser.
- **Grafana:** signs in whoever the gate names, but only from 127.0.0.1 and only under a secret header name shared by Caddy and Grafana (`/etc/pi-hub/secrets/grafana_gate.env`, made by `install.sh`; netmon reads it with `env_file`; Caddy refuses to start without it, and its admin API is a private socket, `/run/caddy/admin.sock`, so the name can't be read from it). Other services on the Pi, such as Uptime Kuma, can send any header from 127.0.0.1, so the name is what proves the gate sent it. The gate also removes any client-sent `X-Remote-User`, `X-Webauth-User` or secret-named header. User `bill` is an org Admin (not a server admin) with an unknown password; the `admin` login still works with `/etc/pi-hub/secrets/grafana_admin`. To change the secret, delete the file, run `deploy/install.sh`, then `cd /opt/netmon && sudo docker compose up -d grafana`.
- **Certificates:** Caddy's own CA. Its root is at `https://home.home.arpa/home-ca.crt`; trust it once on each device (iPhone: download, then Settings › General › VPN & Device Management, then Settings › General › About › Certificate Trust Settings; Mac: open it in Keychain Access, set to Always Trust). The CA lives in `/var/lib/caddy`; **never delete it**, or every device must trust a new one.
- **Check it:** `ssh pi 'sudo bash /opt/pi-hub/current/deploy/gate-check.sh'` prints one line per check. The nightly self-check includes "The front gate answers".
- **Old addresses (locked 31 Oct 2026, step 6):** the Pi's tools listen on 127.0.0.1 only (`deploy/pi-lock.py`). Plain `http://10.0.0.30` answers only the machine paths (`/api/now*`, `/api/needs`, `/api/records` (Local AI's printer reading), `/api/webhook/bambuddy`, `/api/shortcut/*`, `/healthz`) and `/home-ca.crt`; everything else is redirected to `https://home.home.arpa`. What stays open, and why:
  - Bambuddy `:8000`, for an allow-list only (nftables table `inet pi_lock`, `/etc/pi-lock/firewall.nft`): the Pi and its containers, the PC (`10.0.0.21`, Tailscale `100.78.96.97`: Local AI), the Mac (`10.0.0.16`, Tailscale `100.109.178.34`: print-lab) and the Workshop display (`10.0.0.124`). The Mac and the PC reach the Pi through Tailscale even at home (the Pi advertises `10.0.0.30/32`), so their tailnet addresses are what arrive.
  - Paperless `:8010` on the PC, for the Pi only (Windows firewall rule `PiLock-Paperless-8010`, `deploy/windows-lock-paperless.ps1`). Known gap: the PC advertises its own `10.0.0.21/32` on Tailscale, and tailnet traffic delivered that way is not filtered by the rule, so tailnet devices (all the owner's) still reach it.
  - Uptime Kuma's Pi Hub, Grafana and Bambuddy monitors use `127.0.0.1` addresses.
  - **Undo:** `ssh -t pi sudo python3 /opt/pi-hub/current/deploy/pi-lock.py undo`; on the PC, as admin, `powershell -NoProfile -File windows-lock-paperless.ps1 -Undo`; then release a commit with the pre-step-6 Caddyfile. `pi-lock.py status` shows each item. A netmon deploy re-applies the lock.
- **Rollback:** a release from before the gate runs its hub on :80, so a release (or rollback) without `deploy/caddy/Caddyfile` stops Caddy.
- **Paperless** keeps its own login. Its port is limited to the Pi since step 6 (see the gap above); turning on its trusted login is still to do.

## Workshop display on Pi Hub

Step 1 of moving the workshop display's household side onto Pi Hub. Built, not yet in use: the display still pairs with Local AI until you pair it here.

**Pairing.** System, "Workshop display", Pair display. The page shows a 6-digit code with the minutes left (it re-checks every 5 seconds while open). Type it on the display. Afterwards the card says "Paired <date>"; "Pair again" makes a new code. Owner only.

**The hub key and Local AI's CA.** `deploy/install.sh` (run from the Mac) does two things on the Pi, each only if missing and never overwriting:
- Creates `/etc/pi-hub/secrets/localai_hub_key` (random, no trailing newline, mode 0640 root:pi-hub) and prints `LOCALAI_HUB_KEY_SHA256=<hash>`. Only the hash is printed. Put that line in Local AI's `C:\LocalAI\stack\stack.env`, then recreate the appliance so it loads it (this restarts Local AI, so ask first): `docker compose --env-file C:\LocalAI\stack\stack.env -f C:\LocalAI\repo\deploy\stack\compose.yml up -d appliance`.
- Reads Local AI's CA from the PC over ssh (`ssh windows`, `C:\LocalAI\https\localai-ca.crt`; never plain HTTP), checks it parses as a certificate, installs it as `/etc/pi-hub/secrets/localai-ca.crt` (0644), and prints its SHA-256 fingerprint. Confirm it matches the CA you expect; if the PC is off or ssh fails, that step is skipped and the release continues; rerun later.

**Check.** Pair a display, then `curl -s -H "X-Hub-Display-Key: <display key>" https://home.home.arpa/api/display/feed`: it should show the household cards, and `ai.available: true` once Local AI has the hash.

**Rollback.** Pair the display with Local AI again (its own pairing screen); the display then ignores Pi Hub. Nothing on the Pi needs undoing.
