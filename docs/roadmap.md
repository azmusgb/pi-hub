# Pi Hub: evolution roadmap (20 Oct 2026)

Where the hub goes after the seven pages: from *showing* the house, to *fixing* it, to *running* it.

## Stage 1: Self-service (next, about 3 sessions)
Anyone in the house can fix the usual problems without asking.
- **PIN and Fix-it:**
  - household PIN, 30-day device sessions;
  - one-tap restart of Plex or Homebridge, remount the drive, install updates, restart the Pi, rescan Plex;
  - an action log showing who did what.
- **Settings (owner only):** the Homebridge login, Wi-Fi for the QR code, the alert topic, quiet hours, the PIN.
- **Home control:** Homebridge lights, plugs and scenes; favourites on Now.
- **Guest Wi-Fi QR** on Now and in wall mode.
- **Nightly backup** of hub data and Pi settings to the PC, keeping 14 days.
- **Away access** through Tailscale.

## Stage 2: The house reacts (about 3 sessions)
The hub notices and acts, not just reports.
- **Rules** written as "when … then …", chosen from a list rather than code:
  - print finished → a phone alert, plus a light scene in the workshop;
  - movie drive dropped → try a remount, then alert if it's still missing;
  - PC down for 5 minutes → alert "check the breaker";
  - Pi above 75 °C → alert, and pause Plex scans.
- **Morning digest:** one phone message at 8 am covering overnight prints, dropouts, updates, and anything still wrong.
- **Wall mode 2:** clock, weather, the next calendar item, the print band, today's list. It dims at night.
- **Ask Local AI** on the hub: "What's printing?" or "Why did Plex stop last night?". The answer comes from the hub's own history plus Local AI on the PC.

## Stage 3: Media you can trust (about 2 sessions, once a new drive arrives)
- **Drive move helper:** copies the movies from the failing drive, checks every file, lists unreadable ones, points Plex at the new drive and retires the old one.
- **Drive health** on the new drive (SMART), with a "replace soon" alert well before it fails.
- **Movie requests:** family members add titles they want; you see the list.
- **Watch stats:** what's watched, by whom, and what's never been opened (good to delete).

## Stage 4: Workshop control room (about 2 sessions)
- **X2D camera on the hub:** move the camera bridge from the MacBook to the Pi, so it works with the Mac asleep. A snapshot on the band, plus a live view.
- **Filament shelf:** spools by colour and material, grams left, low-stock alerts. Cost per print from grams used.
- **Print log 2:** a thumbnail of each print, its duration and filament; failures with the printer's error code and a link to Bambu's help page.
- **Workshop display tie-in:** the touchscreen shows hub alerts and the shopping list.

## Stage 5: A platform for the house (ongoing)
- **People:** an account per person with roles (adult, kid, guest). Kids can tick lists but can't restart things.
- **Power:** a UPS for the PC with status on the hub, smart-plug power use, and a breaker-trip history from the PC's outages.
- **Cards you can add:** each device is a small module (status, page, actions, rules), so new things drop in without touching the rest.
- **Self-updating:** the Pi pulls hub updates from git, runs the tests, and switches over only if they pass, with one-tap roll-back.
- **Guarding itself:** a nightly self-check of every page and API, which alerts you if something broke.

## Order and why
1. **Stage 1 first:** it turns the hub from a screen into a tool, and the household PIN is the base for everything else that acts.
2. **Stage 2 next:** most of the value of a hub is not having to look at it.
3. **Stage 3** waits on a new drive, but should come soon, because the current drive is failing.
4. **Stages 4 and 5** build on the history and rules from Stages 1–2.

## What I'd need from you, by stage
- **Stage 1:** pick the PIN; OK the admin helper; type in your Homebridge login, Wi-Fi details and Tailscale approval.
- **Stage 2:** your city for the weather; a calendar link (read-only), if you want it on the wall.
- **Stage 3:** a new drive (1–2 TB SSD).
- **Stage 4:** an OK to move the camera bridge to the Pi.
- **Stage 5:** a UPS for the PC (recommended anyway, given the breaker trips); smart plugs if you want power use.

## Status
- 20 Oct 2026, Stage 1 shipped: setup code, owner password and household PIN (scrypt, 30-day device sessions, lockout after 5 wrong tries); Fix-it buttons through a root helper on a Unix socket with a fixed action list; one-tap fixes in Needs a look; Control page and favourites on Now (needs the Homebridge login); guest Wi-Fi QR; nightly backup on the Pi at 03:30, 14 kept; Tailscale installed, waiting for the owner to approve the Pi.
- Not yet: copying backups off the Pi (to the PC) — needs a decision on where and how.
- 20 Oct 2026, Stage 2 shipped: event watcher (changes must hold a minute; PC down 5 min) and Rules page (10 triggers, 6 actions, default "drive back → rescan Plex"); morning digest (default 08:00, test button); quiet hours for rule alerts; weather by town (Open-Meteo, °F) and calendar by iCal link on Now and the wall; wall display 2 (big clock, agenda, Wi-Fi QR, dims 22:00–06:00); Ask Local AI on Now through Local AI's /api/chat with the hub's facts. Ask will need a Local AI key once its sign-in is enforced.
- 20 Oct 2026, Stage 3 built ahead of the new drive: Drives page (USB drives with SMART health where the enclosure allows), move helper (wipe and format the new drive after typing ERASE, rsync copy with progress and unreadable-file list, resumable, verify, then switch fstab so /mnt/usb1 is the new drive and Plex paths don't change), movie requests, watch stats (watched vs never watched, delete candidates), Plex watch history. The movies drive is now found by its fstab UUID, not by the name sda. Untested end to end until a new drive is plugged in.
- 20 Oct 2026, Stage 4 (most of it): camera failover (Pi bridge first, MacBook backup) with the camera on the Workshop page; filament shelf (spools, grams left, low at 150 g with a default phone-alert rule and a digest line); print log 2 (filament used and cost per print, the printer's error code with Bambu's lookup link). Not done: showing hub alerts and the shopping list on the workshop touchscreen, which needs display firmware work; the display's camera address change (also firmware).
- 20 Oct 2026, Stage 5 (part): people with their own PINs (adult or kid; kids can switch lights and plugs and tick lists only; the activity log names the person); nightly self-check at 04:15 (12 pages, 13 APIs, 7 services, space, backup age, temperature; alert only on failure; "Run a self-check" on the Pi page). First run: 35 of 35 passed. Not yet: self-updating with roll-back, UPS/power, add-on cards.
- 20 Oct 2026, Stage 5: releases. `deploy/install.sh` pushes main to a repo on the Pi; its hook runs `pi-hub-release`, which runs the tests on the Pi, switches /opt/pi-hub/current to the new release, checks every page and API, and switches back if any fail. Settings → Versions lists them with "Go back to this".
- 20 Oct 2026, weather upgrade: Weather page (now with icon, feels like, wind and gusts, humidity, UV, air quality, sunset; next 24 hours; 7 days with temperature ranges), US National Weather Service warnings, plain-words rain timing ("Rain likely from around 6 PM"), frost tonight, °F/°C. New rule triggers: weather warning (on by default, sent even in quiet hours), rain on the way, freezing tonight. Weather on Now and the wall display links to the page.
- 20 Oct 2026: backups leave the Pi. The Windows PC's task "Pi Hub backup copy" (daily 05:00, runs when the PC comes back if it was off) fetches the newest backup with a key that can only run `pi-backup-serve` on the Pi (forced command, from 10.0.0.21 or the PC's Tailscale address only), checks its SHA-256 and keeps 14 in C:\LocalAI\pi-backups. Settings shows the last copy; the self-check fails if it's over 50 hours old. Script: deploy/windows-pull-backups.ps1.
- 20 Oct 2026: weather town set from Local AI's saved home (Lake Wylie, SC); quiet hours on, 22:00–07:00.
