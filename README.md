# Pi Hub

A household dashboard and self-service app for the Raspberry Pi: movies, smart-home controls, lists, document printing, workshop status, weather, alerts and guided recovery.

The app uses FastAPI, SQLite and browser JavaScript modules, with no frontend build step. On the Pi it runs at `http://pi.local`; privileged actions go through a separate helper with a fixed action list.

## Documentation

- [Current status and remaining checks](docs/status.md)
- [Deployment, verification and rollback](docs/operations.md)
- [Household interface changes](docs/ux-update.md)
- [Workshop camera setup](docs/camera.md)
- [Original plan](docs/plan.md) and [roadmap history](docs/roadmap.md)

The status checklist is the current source of truth. Historical delivery notes describe checks made at the time, rather than proving the equipment's present state.

## Local development

From the repository root, using the existing Python environment:

```sh
HUB_NO_SAMPLER=1 HUB_DB=/tmp/pi-hub-dev/hub.db \
  .venv/bin/python -m uvicorn hub.app:app --host 127.0.0.1 --port 8765 --no-access-log
```

Open `http://127.0.0.1:8765`. `HUB_NO_SAMPLER=1` disables background polling, recording, rules, digests and reminders. The separate database avoids using production household data. Page requests still call their configured integrations; use mocked responses when testing successful hardware flows on a Mac. Pi diagnostics and privileged fixes require the Pi environment.

This repository does not yet provide a Python dependency manifest; the command above assumes an already provisioned `.venv`.

## Checks

```sh
HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests
node --test tests/*.mjs
bash -n deploy/install.sh deploy/pi-hub-release
git diff --check
```

JavaScript tests use Node's built-in test runner. The browser modules declare `type: module` in `hub/static/js/package.json`. Release tests simulate the Pi filesystem and commands in temporary directories; they do not deploy to a real Pi.

For interface changes, also check phone, tablet and desktop layouts, keyboard navigation, unavailable-service feedback and refresh behaviour. The release gate checks HTTP responses; it does not replace browser or hardware acceptance checks.


## Freshness and recovery

Home and the integration pages show **Source responses**, including the age of the last successful response and an explicitly labelled earlier summary when a check fails or ages beyond its cache window. Times describe the hub's response from a source, whose own device readings may be cached. Display history is held in memory and resets when the app restarts; automation still receives missing data on failed reads.

After restarting Plex/Homebridge or remounting movie storage, Help checks the affected integration directly. It retries the read-only check up to three times, reports what it verified, and offers **Check recovery again** without repeating the command. Movie playback and physical device operation still require the household to try the original task.
