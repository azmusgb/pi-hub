# One home: a single front door for the house's apps (design)

Date: 2026-10-24 · Status: design approved in conversation, spec for review
Type: architectural (it changes Pi Hub, Local AI, the shared UI kit and how every tool is reached).
Each rollout step below gets its own plan and PRs.

## Intent

**Who it is for:** the owner alone, on phone and desktop. The household and the kids are not users for now.

**Problem (critique, 24 Oct 2026):** the house's tools feel like a pile, not one system.

- **Addresses and logins:** 15 front doors, mostly an IP and a port, in a mix of http and https, with different
  addresses at home and over Tailscale. There are 11 different sign-in screens.
- **Two homes:** Pi Hub's Home and Local AI's Home both open on a greeting, the printer and a feed, under different
  menus (Home/Movies/Devices/Lists/More against Home/Work/Projects/Improve/System). Local AI adds a third bar
  (Hub/Terminal/Materials).
- **The printer:** shown in four places (Pi Hub, Local AI, the workshop display, Bambuddy) but actionable only on
  the display or in Bambuddy.
- **Look:** every app has a different palette.
- **Words:** labels describe plumbing ("3D Command Plane", "Grafana NOC", "Port 8000"), Local AI's Recent list shows
  raw prompt text, and the hub calls the X2D a "P1S".

**Outcome:** one place to start, one main sign-in, names instead of ports, the printer seen and acted on in one place,
one look across the owner's own apps, and words that describe tasks.

**Success:** the five critique tasks take fewer steps and logins, re-walked after the rollout. Today:

| Task | Today |
|---|---|
| Find a bill | 4 steps and a login, nothing in Local AI |
| Check and clear the print | Shown in 4 places, actionable in 1 |
| Why is the internet slow | 3 places |
| Restore a file | Hard to find, technical |
| Start a movie | Two systems |

**Not goals:** restyling third-party tools; a multi-user model; replacing Plex's own account; changing the workshop
display's touchscreen layout (it adopts the names and the shared printer actions only).

## Decisions

| # | Decision |
|---|---|
| D1 | The front door is **Pi Hub** on the always-on Pi (`home.home.arpa`), not Local AI (the PC loses power). |
| D2 | One menu by task: **Home · Workshop · Documents · Media · Home & network · System**, plus an **Assistant** button. Paper printing sits under Documents, 3D printing under Workshop. |
| D3 | Names under `home.arpa`, answered by AdGuard on the Pi; away from home through Tailscale split DNS to the same AdGuard. |
| D4 | **Caddy on the Pi** fronts every name with HTTPS from its own CA, trusted once on the iPhone and the Mac. |
| D5 | One sign-in: Caddy `forward_auth` asks **Pi Hub** (existing owner password and sessions); the session cookie is scoped to `.home.arpa`. No new identity service. *Note: browsers refuse a `Domain=.home.arpa` cookie (home.arpa is a public suffix); since 27 Oct 2026 each tool gets its own host-only cookie via a one-time code, see docs/superpowers/plans/2026-10-27-gate-per-tool-cookie.md.* |
| D6 | Tools that accept a trusted front-gate login use it (Grafana auth proxy, Paperless remote user). The rest keep their own login behind the gate, once per browser. |
| D7 | "Needs you" lives on Home, with a count badge on the Home tab (not on the Assistant button). |
| D8 | The hub reads other apps through their APIs and never copies their data; each app stays its own record. |
| D9 | Pi Hub and Local AI share the appliance-ui kit's look. The kit gets its contrast and notch fixes first. |
| D10 | Old IP:port addresses keep working until the last step, then answer only the gate. |

## Names and the gate

| Name | Goes to |
|---|---|
| `home.home.arpa` | Pi Hub (Pi :80) |
| `assistant.home.arpa` | Local AI (PC, its own Caddy at https://10.0.0.21) |
| `bambuddy.home.arpa` | Bambuddy (Pi :8000) |
| `paperless.home.arpa` | Paperless (PC :8010) |
| `homebox.home.arpa` | Homebox (Pi :7745) |
| `backups.home.arpa` | Backrest (Pi :9898) |
| `network.home.arpa` | Grafana (Pi :3000) |
| `status.home.arpa` | Uptime Kuma (Pi :3001) |
| `adguard.home.arpa` | AdGuard (Pi :3002) |
| `devices.home.arpa` | Homebridge (Pi :8581) |
| `pi.home.arpa` | Cockpit (Pi :9090) |
| `scan.home.arpa` | scanservjs (Pi 127.0.0.1:8095), replacing the hub's `/scan/` proxy |

**Resolution:**
- AdGuard has a rewrite `*.home.arpa → 10.0.0.30`.
- Tailscale's admin console gets split DNS for `home.arpa` to the Pi's Tailscale address. The owner does this once,
  in the admin console.

**Caddy:**
- Caddy runs on the Pi, on ports 80/443. Pi Hub moves off :80 to `127.0.0.1:8100`.
- **Machine callers keep working.** Caddy keeps answering `http://10.0.0.30` and `http://pi` by passing everything
  to the hub unchanged, with no redirect and no gate, until step 6. These callers use their own keys or tokens:
  - Local AI's `GET /api/now`;
  - Bambuddy's webhook `/api/webhook/bambuddy`;
  - Siri Shortcuts `/api/shortcut/*`;
  - the PC's backup pull.

  Browsers get a "Use https://home.home.arpa" banner from the hub instead. At step 6 these callers move to the gate
  names, or keep plain http on `/api/*` only.
- **TLS:** Caddy's internal CA. The root is installed once on the iPhone (profile) and the Mac (Keychain). Keep the
  CA's data volume; recreating it means re-trusting on every device (lesson from Local AI).
- **Sign-in check:** each site except `home.` runs `forward_auth` against Pi Hub `GET /api/gate` (new). The answer
  is:
  - 200 with `X-Remote-User: bill` for a signed-in owner;
  - 302 to `https://home.home.arpa/signin?next=<url>` otherwise.
- **Sessions:** Pi Hub sets its session cookie with `Domain=.home.arpa; Secure; HttpOnly; SameSite=Lax`, alongside
  the current cookie, so `http://pi` keeps working during the move. Sign-out clears both.
  *Note: browsers refuse a `Domain=.home.arpa` cookie (home.arpa is a public suffix); since 27 Oct 2026 each tool gets its own host-only cookie via a one-time code, see docs/superpowers/plans/2026-10-27-gate-per-tool-cookie.md.*

**Trusted-header logins** (only on the gate's side; the gate strips any client-sent `X-Remote-User`):
- Grafana: `auth.proxy` with header `X-WEBAUTH-USER`.
- Paperless: `PAPERLESS_ENABLE_HTTP_REMOTE_USER`. Its gate route runs through the Pi to the PC; Paperless trusts the
  header only from the Pi's address.

**Hub sign-in:** stays as today, with the owner password (and the household PIN, which is unused for now).

## The hub's structure

**Menu:**
- On the phone, a bottom bar: Home, Workshop, Documents, Media, More (Home & network, System).
- On the desktop, a left rail with all six.
- The Assistant button is always visible: the top bar on the phone, and the rail's foot on the desktop.

**Home cards**, each with its status line and one main action:
- **Needs you:** only when non-empty. It merges Local AI's house card (problem tones), hub alerts and Bambuddy
  events.
- **Workshop:** X2D state and done time, camera thumbnail, **Clear plate** when finished or failed.
- **Documents:** a search box (Paperless API, through the gate) and **Scan**.
- **Media:** now playing and the latest movie added.
- **Home & network:** internet OK or slow, devices on.
- **System:** backup age and Pi temperature.

**Sections:**
- **Workshop:** printer (status, camera, Clear plate, Pause), filament and projects (Bambuddy, read), Print lab
  (link), workshop display (state).
- **Documents:** search and recent (Paperless), Scan (embedded), Print (today's Print page).
- **Media:** today's Movies.
- **Home & network:** today's Devices, plus internet and network (Prometheus summary, links to Grafana and Kuma),
  plus AdGuard (blocked today, link).
- **System:** Alerts, Automations, Backups (Backrest snapshot ages via its API, link), Help & system, Settings.

**Words:**
- Labels name tasks ("Find a document", "Clear the plate", "Restore a file").
- Product names and links go in a small "Open Paperless ↗" line.
- The App Suite page and the `/apps` routes are removed; each tool appears in its section.

**Printer actions:**
- New hub endpoints `POST /api/printer/clear` and `/api/printer/pause` (owner only) call Bambuddy with a
  **control** key (a new key; the hub's read key stays read-only).
- Local AI's `/api/display/printer/clear` and the display keep working through Local AI. Both paths end at
  Bambuddy, so they agree.

**Assistant hand-off:**
- The button opens `https://assistant.home.arpa/#ask?context=<page and key facts>`.
- Local AI fills the composer's context line from that parameter (escaped, at most 300 characters).
- When Local AI doesn't answer, the button reads "The PC is off" and is disabled.

## Local AI changes

- It opens on the Assistant (composer and recent work), not a house dashboard. Its house cards move to the hub.
- Its Hub/Terminal/Materials bar is replaced by "← Home" (to `home.home.arpa`).
- The Recent list shows a readable title per run (a summary field or the run kind's name), never raw prompt text.
- Its System section covers Local AI itself (models, PC). House-wide System is on the hub.
- It adopts the appliance-ui kit (the existing `feat/appliance-ui` branch, finished after the kit's fixes).

## Look

**Kit first:** the appliance-ui kit's two fixes from the 24 Oct review:
- Light-mode chip, danger-button, badge and field-border contrast, with the contrast gate extended to cover them.
- `--ui-header-total`, including the notch.

**Then:** Pi Hub moves to the kit's tokens and components; its printer band keeps one accent.

**Bug fixes on the way:** the X2D named correctly, and a styled signed-out page for scan.

## Rollout (each step usable on its own; one plan per step)

1. **Gate:** AdGuard rewrites, Tailscale split DNS (owner), Caddy with the internal CA, trust on the iPhone and Mac
   (owner), `/api/gate` and the `.home.arpa` cookie, trusted-header login for Grafana and Paperless. The hub moves to
   127.0.0.1:8100. Old addresses still work.
2. **Hub structure:** new menu, Home cards, Needs you, sections, words. App Suite removed. X2D name fixed.
3. **One printer:** hub Clear plate and Pause through Bambuddy with a control key.
4. **Assistant:** the hand-off, Local AI opening on the Assistant, readable run titles, its dashboard and bar removed.
5. **One look:** kit fixes, then Pi Hub and Local AI on the kit.
6. **Lock:** every tool's port bound to 127.0.0.1 or firewalled to the gate; old addresses retired; docs updated.

## Errors

- **Gate down** (Caddy stopped): the old addresses still work until step 6. After step 6, Caddy runs as a systemd
  service with restart, and the self-check gains "the gate answers".
- **Hub down:** `forward_auth` fails closed. Tools refuse rather than open, and the page explains "Pi Hub isn't
  answering".
- **PC off:** Assistant, Paperless and the Documents card show "The PC is off" instead of errors.
- **Certificate not trusted** on a new device: the hub's sign-in page links to the root certificate download with
  steps.

## Testing

- **Pi Hub tests:**
  - `/api/gate` signed in, signed out and expired;
  - cookie scope;
  - the printer endpoints (owner only, Bambuddy errors shown);
  - Home card contents with each source down;
  - the Assistant context encoding.
- **Browser:** each step at 390 and 1440 px, light and dark, with axe and visual baselines.
- **Gate check** (a script in `deploy/`): every name answers through the gate; refused signed out; let in signed in;
  sign-out covers all names; a client-sent `X-Remote-User` is stripped.
- **Local AI:** its local CI for step 4 and step 5 PRs.
- **Acceptance:** the five critique tasks re-walked and recorded in `docs/status.md` with step and login counts.

## Open items for the owner

- ~~Install the gate's root certificate on the iPhone and the Mac (step 1).~~ Done by 31 Oct 2026.
- ~~Turn on Tailscale split DNS for `home.arpa` (step 1).~~ Done by 31 Oct 2026, with the Pi's `10.0.0.30/32` route approved.
- ~~Set the Orbi's DNS to the Pi.~~ Decided against on 31 Oct 2026: it would put every household device's DNS (and
  ad blocking) on the Pi for no benefit to them. The owner's devices get the names through Tailscale.
