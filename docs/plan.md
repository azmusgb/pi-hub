# Pi Hub: home hub and self-service, round 1 plan (20 Oct 2026)

**Goal:** one place on the home network, on a phone, iPad or Mac, where anyone in the house can see what's going on and fix the usual problems themselves, without SSH or asking Claude.

**Today:** the Homepage dashboard (`:3000`) is display-only. The Pi also has:
- `pi-status.py` (`:8099`): status plus ntfy alerts;
- Glances (`:61208`);
- Cockpit (`:9090`);
- Plex, Homebridge and CUPS.

Homepage can't run actions, keep household data, or take uploads, so self-service needs its own app.

## Decisions (recommendation first)

| # | Decision | Recommendation | Alternative |
|---|---|---|---|
| D1 | Build | **A small custom Pi Hub app**, keeping today's look (graphite plate, Schibsted Grotesk, filament gold). Homepage is retired once the hub covers it. | Keep extending Homepage, which has no actions, uploads or household data. |
| D2 | Stack | **Python FastAPI plus plain HTML/JS, with no build step.** FastAPI is already on the Pi, it's light on memory, and `pi-status.py` folds straight in. | Node. |
| D3 | Address | **`http://pi.local` (port 80)**, installable as a phone app (PWA). `:3000` redirects. | Keep `:3000`. |
| D4 | Who can do what | **Viewing is open on the home network. Actions need a household PIN** (a 6-digit code, 30-day device sessions, 5 tries then a 10-minute wait). The admin page is owner only (the Pi password). | Everything open on the LAN; or a separate login per person. |
| D5 | Away from home | **Tailscale on the Pi.** You already use Tailscale, and nothing is opened to the internet. | Home network only. |
| D6 | Pi actions | **A fixed list of allowed actions run by a small root helper.** The web app itself never runs as root and never runs typed commands. | Run them through Cockpit. |
| D7 | Secrets | **Entered once in the hub's settings page and stored root-only on the Pi:** Homebridge login, Wi-Fi password for the QR, ntfy topic. Never shown again, never logged. | Hard-coded files. |

## Features

**1. Now (home screen)**
- The print band: X2D state, progress, finish time.
- Plex "now playing".
- Movie drive state.
- Pi health.
- Who's up and who's down.
- Live, refreshed every 15 seconds.
- Big, glanceable text that also works as a wall display (iPad, kiosk mode).

**2. Fix it (self-service, behind the PIN):** one-tap buttons. Each one confirms, shows progress, and says what happened.
- Restart Plex
- Restart Homebridge
- Remount the movie drive (with a check that tells you to replug it if it's missing)
- Check for updates / install updates
- Restart the Pi
- Rescan the Plex library

**3. Home control:** Homebridge accessories (lights, plugs, scenes), from the Homebridge UI API. On/off and brightness. Favourites go on the home screen.

**4. Print from your phone**
- Upload a PDF or photo and it prints on the HP DeskJet, with copies and colour/black-and-white options.
- See the queue and cancel a job.
- Scan from the DeskJet's glass to your phone, via HPLIP/SANE, if the scanner answers.

**5. Movies**
- Recently added.
- Search the library.
- "Continue watching", opening in Plex.
- A drive health page: dropouts over time, free space, and a "replace soon" note.

**6. Workshop**
- X2D: status, progress, print history (from the hub's own log), and a camera snapshot when the camera bridge is up.
- Workshop display: status and firmware.
- Local AI: up/down and models loaded.

**7. Household**
- A shared list (shopping or to-do), stored on the Pi.
- A guest Wi-Fi QR code: scan to join.
- Noticeboard notes.

**8. Alerts**
- What you already get today, plus a history page (last 30 days).
- Per-alert on/off switches.
- Quiet hours.

**9. Looking after itself**
- A nightly backup of the hub data and Pi settings to the Windows PC (`G:\PiBackups`), keeping 14 days.
- A "last backup" line on the admin page.

## How it's built
- **One service, `pi-hub`,** running as its own user.
  - It takes over pi-status's work: it polls on a cache and serves the API and the pages.
  - SQLite holds the lists, notes, print and alert history, and sessions.
- **Actions go through `pi-hub-helper`,** a root service on a Unix socket.
  - It accepts only named actions (`restart:plex`, `remount:movies`, ...).
  - Each action is logged with who ran it and when.
- **Pages are server-rendered HTML with a little JS:**
  - works without a framework;
  - keyboard and screen-reader friendly;
  - respects reduced motion;
  - phone-first layout.
- **Tests:** API unit tests (pytest), a helper allow-list test, and a Playwright check at phone, iPad and desktop sizes.

## Delivery, in small steps, each one shipped and checked on the Pi
1. App skeleton, look, Now screen (replaces Homepage), PWA, port 80.
2. PIN sign-in and the Fix-it buttons (helper and allow-list).
3. Print from phone and the print queue.
4. Movies pages and Plex now-playing.
5. Home control (Homebridge).
6. Household list, notes, Wi-Fi QR.
7. Alerts history and settings, nightly backup.
8. Tailscale for away access.

## Risks
- **The movie drive keeps dropping.** Every page treats the drive as "may be missing" and never hangs on it.
- **The auto-mode classifier** blocks some setup on the Pi: new network services, root helpers, sharing.
  - Those steps will need your approval, or you run one command.
- **Homebridge API changes:** the hub only reads accessories and toggles them, nothing more.
- **Pi load:** the target is under 120 MB of memory and under 3% average CPU. Glances is dropped once the hub draws its own charts.

## Roadmap

| Step | You get | Needs from you | Size |
|---|---|---|---|
| 1. Hub app and Now screen | `http://pi.local`: the Now screen in today's look; installable on your phone; replaces the `:3000` dashboard | OK for port 80 (a new web service) | 1 session |
| 2. Sign-in and Fix-it | Household PIN; buttons for restart Plex/Homebridge, remount drive, updates, restart Pi, Plex rescan; action log | Choose the PIN; OK for the admin helper | 1 session |
| 3. Print from phone | Upload PDF/photo to the HP; queue and cancel; scan to phone if supported | Load paper for a test page | ½ session |
| 4. Movies | Recently added, search, continue watching, now playing; drive health history | Nothing | ½ session |
| 5. Home control | Homebridge lights, plugs, scenes; favourites | Homebridge login, typed into settings | 1 session |
| 6. Household | Shared list, notes, guest Wi-Fi QR | Wi-Fi name and password, typed into settings | ½ session |
| 7. Alerts and backup | Alert history, per-alert switches, quiet hours; nightly backup to the PC | Nothing | ½ session |
| 8. Away access | The hub and Plex from anywhere through Tailscale | Approve the Pi in your Tailscale admin | ¼ session |

**After round 1 (ideas, not committed):**
- iPad wall mode with a clock, the print band and the next calendar item.
- Calendar (iCloud/Google read-only).
- Weather.
- "Ask Local AI" box on the hub.
- Move the X2D camera bridge from the MacBook to the Pi, so snapshots work when the Mac is asleep.
- Energy and UPS status once a UPS is added for the PC.
- New movie drive and a move-the-movies helper.
- Per-person accounts if the household PIN isn't enough.

## Status (20 Oct 2026)
- Shipped: Now, Movies (posters, continue watching, recently added, search, drive health), Workshop (print history, display, Local AI), Print (upload, copies, black and white, queue, cancel, ink levels), Lists (shopping, to do, notes), Pi (24 h/week charts, services, storage, updates, network), Alerts (history from pi-status). Phone bottom bar, desktop side rail, wall mode.
- Not yet: PIN and Fix-it buttons (step 2), home control (step 5), Wi-Fi QR (step 6), nightly backup (step 7), Tailscale (step 8). The first real print from the hub is untested.
