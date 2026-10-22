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

The nightly backup script takes a consistent SQLite copy plus its referenced project model files, then archives selected Pi settings. A SQLite writer lock protects the database/file snapshot; mutations may briefly wait during this step. See the [household feature guide](household-features.md) for attachment limits and restore expectations. The Windows pull script is `deploy/windows-pull-backups.ps1`; historical deployment notes record copies in `C:\LocalAI\pi-backups`. Confirm freshness in Settings and the self-check rather than assuming that scheduled copies succeeded.

Application rollback does not restore SQLite data or undo schema migrations. The release mechanism does not guarantee recovery across power loss. A database restore drill and a schema migration strategy remain outstanding; use [the status checklist](status.md) to track them.

Do not unpack a backup over the running system as a verification step. Validate it in an isolated environment first, and plan any production restore separately.
