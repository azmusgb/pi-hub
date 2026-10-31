# The workshop display joins the front door: Pi Hub as its only connection (design)

Date: 31 Oct 2026 · Status: design approved in conversation, section by section; spec for review
Type: architectural. It changes the Workshop OS firmware's backend, adds display routes to Pi Hub, and narrows what
Local AI serves the display. Each rollout step below gets its own plan and PRs.
Follows: [One home](2026-10-24-one-home-design.md) (Pi Hub is the front door), [Control room](2026-10-27-control-room-design.md)
(records), [Print lab on Pi Hub](2026-10-28-print-lab-on-hub-design.md) (the lab request queue).

## Intent

**Owner's words:** household essentials stay fully usable while the PC sleeps, without adding another AI host; Pi Hub
owns pairing and the display feed; Local AI supplies AI cards and handles AI requests through Pi Hub; existing systems
remain authoritative for their facts.

**Problem:** the WS350 gets everything from Local AI on the Windows PC (feed v2, long poll, Clear plate, Judge it,
approvals, pairing, heartbeat; `LocalAI/docs/WORKSHOP-DISPLAY.md`). Its household cards (Needs you, printer, now
playing, spools, the Pi's issues, the lab run to judge) only pass through Local AI from Pi Hub and Bambuddy, so when the
PC sleeps they disappear with the AI cards.

**Success:**

- With the PC asleep, the display shows printer state, Needs you, now playing and spools, and Clear plate and Judge it
  work. AI cards are hidden behind one quiet line, "AI unavailable — PC asleep".
- When the PC wakes, AI cards return without pairing again.
- One key, one connection, one place to look when the display misbehaves.

**Not goals:** inference on the Pi; changing the display's screens beyond the one "AI unavailable" line and the
connection setting; moving AI features (Ask, approvals, pictures) off Local AI.

## Decisions

| # | Decision |
|---|---|
| D1 | Pi Hub is the display's only connection (option A). Not two connections (B), not Local AI with a Pi fallback (C). |
| D2 | Household facts come from their owners through Pi Hub: Bambuddy (printer, spools), Plex (now playing), Pi Hub's records and Needs you, the lab queue (Judge it). |
| D3 | AI cards come from Local AI to Pi Hub server to server; the display never reaches the PC. |
| D4 | No queued or replayed AI actions: approvals are fetched live and decided once, only while Local AI answers. |
| D5 | The feed keeps feed v2's shape, so the firmware change is the connection, not the parser. |

## 1. Pairing and connection

- **Pairing:** Pi Hub, System › Workshop display, shows a 6-digit code for 10 minutes (as Local AI does today). On the
  display, the connection setting takes the code. The display fetches the Pi's CA over plain HTTP
  (`http://10.0.0.30/home-ca.crt`), then posts the code over HTTPS to `home.home.arpa`, pinned to that CA and name.
  Pi Hub answers with a display key and keeps only its SHA-256. Five wrong codes end the attempt; one code is open at a
  time; starting pairing needs the owner.
- **One key, kept:** stored on the display, surviving reboots and reflashes (as today's key does). Reconnecting after
  the Pi or Wi-Fi drops needs no pairing: retries with back-off.
- **Scope:** the key signs in only `/api/display/*` (feed, events, Clear plate, Judge it, heartbeat, the approvals
  pass-through), sent as `X-Hub-Display-Key`; it never opens owner pages. These are machine paths through Caddy, like
  `/api/needs`.
- **Migration:** firmware with a "Pi Hub connection" ships alongside the Local AI connection. Once paired and working,
  Local AI's display routes answer "this display now uses Pi Hub". Rollback is pairing with Local AI again.

## 2. The feed

- **Same shape, new owner:** Pi Hub serves `GET /api/display/feed` as feed v2 (`{v: 2, at, cards, images, messages}`)
  plus `ai: {available, checkedAt}`.
- **Household cards from their owners:** `needs` (the Problems list: Needs you plus problem records), `printer`
  (Bambuddy's record, stale readings marked), `playing` (Plex), `materials` (Bambuddy spools), `judge` (the lab run
  waiting for a verdict), `home` (the house's top issue).
- **AI cards from Local AI:** Pi Hub fetches Local AI's AI-only cards (finished runs, disk, Local AI cards, approvals
  summary, latest pictures) with its own service key, at most every 15 s, 3 s limit. On failure `ai.available` is
  false, AI cards are absent and the display shows "AI unavailable — PC asleep". Household cards never wait on it.
- **Pictures:** through Pi Hub (`/api/display/images/<id>`).
- **Live updates:** `GET /api/display/events?since=` answers when the cards change (Pi Hub's record stream plus the AI
  cache), else after 25 s; changes show within about 2 s.
- **Banners:** Pi Hub's message channel becomes the one place (`POST /api/display/notify`, same rate limit and quiet
  hours as today); Local AI, n8n and the Mac post there.
- **Size:** within the display's current memory budget (same card count and text caps), guarded by a test.

## 3. Actions and failures

Household actions (work with the PC asleep):

- **Clear plate:** display → Pi Hub → Bambuddy, with the control key and step logic Pi Hub's own Clear plate uses
  (confirm the plate, then clear errors only if that worked). Result banner: "Plate confirmed", "Check printer errors"
  or "Plate not confirmed". A timeout never repeats a physical command.
- **Judge it:** display → Pi Hub's lab request queue, with today's checks (every strip graded or a reason given; a
  changed run gets "This print has changed. Open it again."). A request ID makes a retry record one verdict. Judge it
  is a person's judgment, not AI output, so it needs no PC.
- **Heartbeat:** display → Pi Hub, updating the `workshop_display` record directly.

AI actions (only while the PC answers):

- **Ask:** forwarded to Local AI; with the PC asleep, "AI unavailable — PC asleep", nothing queued.
- **Approvals:** fetched live from Local AI each time they are opened, never cached; a decision is forwarded once,
  never queued or replayed on wake; a stale or changed approval is refused with "Open it again".

Failures:

- **Pi Hub unreachable:** the display keeps its last cards, each marked with its age, retries with back-off, and
  disables actions with the reason.
- **A source down** (Bambuddy, Plex): only its card says so ("Printer: no answer since 14:02").
- **Logged:** every action in Pi Hub's action log, "on the Workshop display".

## 4. Testing and rollout

Testing:

- **Pi Hub (pytest):** feed shape against a frozen sample of today's Local AI feed (the firmware's contract) and size
  caps; each household card with its source down; PC asleep: AI cards absent, household cards on time; Clear plate step
  logic and no resend on timeout; one verdict per request ID; approvals live, stale refused, nothing queued; pairing
  expiry, five-try lockout, key scope, hash-only storage.
- **Local AI (node tests):** the AI-only cards route needs Pi Hub's service key; the old display routes answer "this
  display uses Pi Hub" once moved.
- **Firmware:** the feed parser against Pi Hub's sample; the "AI unavailable" line; the key kept across reconnects
  (native test build in CI).
- **Physical acceptance (WS350):** pair; put the PC to sleep and check printer state, Needs you, Clear plate, Judge it
  and now playing, with AI cards hidden behind the line; wake the PC and see AI cards return without pairing; reboot the
  Pi and see the display recover alone.

Rollout (each step usable on its own):

1. **Pi Hub:** display routes, feed and pairing; Local AI's AI-only cards route. Nothing uses them yet.
2. **Firmware candidate:** "Pi Hub connection" beside the Local AI connection, chosen in the display's settings;
   through the normal candidate, CI and physical-acceptance process.
3. **Switch:** pair the display with Pi Hub and run the PC-asleep acceptance. Rollback: pair with Local AI again.
4. **Retire** Local AI's display feed routes after a week on Pi Hub.

## Open items for the plans

- The firmware's current key storage and size limits (NVS is nearly full; see the WS350 notes): where the Pi Hub key
  and CA live (LittleFS like the Local AI cards, 12.3.12).
- Local AI's AI-only cards route: carve it from `app/display-feed.js` so the PC still serves its own pages' feed.
- Pi Hub's Bambuddy control key is already used by its Clear plate; confirm the display path uses the same one.
