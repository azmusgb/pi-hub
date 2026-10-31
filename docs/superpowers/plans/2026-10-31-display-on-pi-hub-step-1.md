# Display on Pi Hub, step 1: Pi Hub's display routes and Local AI's AI-only cards — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi Hub can pair a workshop display and serve it a feed v2 (household cards from their owners, AI cards from
Local AI when the PC answers) plus Clear plate, Judge it, heartbeat, banners and the AI pass-throughs; nothing uses it
yet (the display stays on Local AI until the step 2 firmware).

**Architecture:** New Pi Hub modules under `hub/` (`display_pairing`, `display_ai`, `display_feed`, `display_messages`)
and one router, `hub/display_routes.py` (`APIRouter(prefix="/api/display")`, mounted in `app.py`), which every task adds its routes to; one new Local AI route (`GET /api/display/ai-cards`) plus a service key
Pi Hub uses for it and the AI pass-throughs. The feed keeps feed v2's shape so the firmware change in step 2 is the
connection only.

**Tech Stack:** Pi Hub: Python 3 / FastAPI / SQLite, pytest, node:test for static JS. Local AI: Node.js, node:test.

**Spec:** `docs/superpowers/specs/2026-10-31-display-on-pi-hub-design.md` (sections 1–3, and section 4 rollout step 1).

## Global Constraints

- Pairing code: 6 digits, valid 10 minutes, one open at a time, five wrong codes end the attempt; starting it needs the owner.
- The display key is sent as `X-Hub-Display-Key`; Pi Hub stores only its SHA-256; it signs in `/api/display/*` and nothing else.
- AI cards: Local AI fetched at most every 15 s with a 3 s limit; household cards never wait on it.
- With Local AI unavailable: `ai: {available: false, checkedAt}`, no AI cards, and the line "AI unavailable — PC asleep".
- Clear plate result banners, exact copy: "Plate confirmed", "Check printer errors", "Plate not confirmed". A timeout never repeats a physical command.
- Judge it changed-run refusal, exact copy: "This print has changed. Open it again."
- Approvals: fetched live each time, never cached; a decision forwarded once, never queued or replayed; stale → "Open it again".
- Feed size: no more than today's Local AI feed allows (same card count and text caps; reuse `cut()` limits from `LocalAI/app/display-feed.js`).
- Every display action is logged in Pi Hub's action log with device "Workshop display".

## Review Focus

1. **PC half-awake** (Local AI accepts the connection but answers after 3 s): the feed still answers on household time, AI marked unavailable — Task 3 test `test_slow_localai_never_delays_household`.
2. **Two Clear plate taps** (a double tap or a retry while the first is in flight): the second is refused, never a second command to Bambuddy — Task 6 test `test_clear_plate_refuses_while_one_is_running`.
3. **Malformed AI answer** (Local AI returns `[]`, HTML or missing fields): treated as unavailable, never a 500 — Task 3 test `test_malformed_ai_cards_are_unavailable`.
4. **Pi restart**: the paired key survives (it is in the hub's database, not memory) — Task 1 test `test_key_survives_restart`.
5. **A stale `since` signature** after a hub restart: events answers `changed: true` at once rather than holding 25 s — Task 4 test `test_unknown_signature_answers_at_once`.

---

### Task 1: Pairing and the display key (Pi Hub)

**Files:**
- Create: `hub/display_pairing.py`
- Modify: `hub/app.py` (the `guard` middleware: a valid `X-Hub-Display-Key` on `/api/display/*` passes the same-origin check, as the Mac's lab key does; a wrong one is 401)
- Test: `tests/test_display_pairing.py`

**Interfaces:**
- Produces:
  - `display_pairing.start(now: float) -> dict` → `{"code": "123456", "expires": int}` (replaces any open code)
  - `display_pairing.status() -> dict` → `{"paired": bool, "paired_at": int|None, "code_open": bool}`
  - `display_pairing.redeem(code: str, now: float) -> str|None` → a new key (`hubd_` + 32 url-safe chars) or None; five wrong codes close the code
  - `display_pairing.key_ok(request) -> bool`; `display_pairing.require(request) -> None` (401 "Pair the display first.")
  - Routes: `POST /api/display/pair/start` (owner), `GET /api/display/pair/status` (owner), `POST /api/display/pair {code}` (open) → `{key, tlsName: "home.home.arpa"}`
  - Table `display_keys(key_hash TEXT PRIMARY KEY, created INT)`; a new pairing replaces the old key.

- [ ] **Step 1: Write the failing tests** — `test_code_is_six_digits_and_expires_in_ten_minutes`, `test_redeem_gives_a_key_and_stores_only_its_hash` (assert the raw key is not in the table), `test_five_wrong_codes_close_the_attempt`, `test_new_pairing_replaces_the_old_key`, `test_key_opens_display_routes_only` (key on `/api/display/feed` passes; on `/api/settings` it is ignored and the owner check still applies), `test_key_survives_restart` (re-import with the same `HUB_DB`), `test_start_needs_the_owner`.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_display_pairing.py -q` — expect failures (module missing).
- [ ] **Step 3: Implement** `hub/display_pairing.py` and the `guard` change; codes compared with `hmac.compare_digest`; key hash SHA-256 like `auth`'s sessions.
- [ ] **Step 4: Run** the test file, then the full suite `.venv/bin/python -m pytest -q` — all pass.
- [ ] **Step 5: Commit** `display: pairing and a display key (hash only)`.

### Task 2: Local AI's AI-only cards and the hub service key

**Files (in `~/dev/ai-harness/LocalAI`, its own branch and PR, shipped with `npm run ship`):**
- Create: `app/hub-key.js`
- Modify: `app/display-feed.js` (export `aiCards(feed)`), `app/server.js` (route + auth), `deploy/stack/compose.yml` (`LOCALAI_HUB_KEY_SHA256: ${LOCALAI_HUB_KEY_SHA256:-}`), `docs/WORKSHOP-DISPLAY.md` (a "Pi Hub" section)
- Test: `tests/hub-ai-cards.test.cjs`

**Interfaces:**
- Produces:
  - `hubKey.authorized(req) -> boolean`: `X-LocalAI-Hub-Key` whose SHA-256 equals `LOCALAI_HUB_KEY_SHA256` (empty env → always false)
  - `aiCards(feed) -> {v: 2, at, cards, approvals: {count, speech}, images, messages}`: the cards of kinds `watch`, `running`, `done`, `image`, `disk` from `buildFeed`'s output; the `needs` card becomes `approvals`; `lab`, `home`, `playing`, `materials`, `weather` and the feed's `needs` list are dropped (Pi Hub owns them)
  - `GET /api/display/ai-cards` (hub key only) → `aiCards(...)` built from the same inputs as `/api/display/feed`
  - The hub key is also accepted wherever the display key is on: `/api/display/approvals`, `/api/display/approvals/decide`, `/api/display/ask`, `/api/images/view`

- [ ] **Step 1: Write the failing tests** — `aiCards keeps only AI kinds and turns needs into approvals`, `ai-cards refuses without the hub key and with a wrong one (401)`, `ai-cards answers with the hub key`, `the hub key opens approvals, decide, ask and images/view and nothing else` (e.g. `/api/changes` still refuses it).
- [ ] **Step 2: Run** `node --test tests/hub-ai-cards.test.cjs` — expect failures.
- [ ] **Step 3: Implement** `app/hub-key.js`, `aiCards` in `display-feed.js`, the route and the auth list entries in `server.js`; add the compose variable.
- [ ] **Step 4: Run** `npm test` — all pass (the three pre-existing failures on main were fixed by #429; expect 0).
- [ ] **Step 5: Commit**, open the PR, ship with `npm run ship -- <PR>`.

### Task 3: Pi Hub's Local AI client

**Files:**
- Create: `hub/display_ai.py`
- Test: `tests/test_display_ai.py`

**Interfaces:**
- Consumes: Task 2's route and header.
- Produces:
  - `display_ai.cards(now: float, fetch=None) -> dict` → `{"available": bool, "checkedAt": int, "cards": list, "approvals": {"count": int, "speech": str}, "images": list, "messages": list}`; cached 15 s; a 3 s limit; any failure (timeout, refused, non-200, non-JSON, wrong shape) → `available: False` and empty lists
  - `display_ai.forward(method: str, path: str, *, query: str = "", body: bytes|None = None, timeout: float = 10) -> tuple[int, bytes, str]` → status, body, content type; refuses any path not in `{"/api/display/approvals", "/api/display/approvals/decide", "/api/display/ask"}` or starting `/api/images/view`
  - Settings: `HUB_LOCALAI_URL` (default `https://10.0.0.21`), key from `/etc/pi-hub/secrets/localai_hub_key` (read each call), Local AI's CA from `/etc/pi-hub/secrets/localai-ca.crt` when present

- [ ] **Step 1: Write the failing tests** — `test_answer_is_cached_for_15_seconds`, `test_slow_localai_never_delays_household` (a fake that sleeps 5 s: `cards()` returns within 3.5 s, `available` False), `test_malformed_ai_cards_are_unavailable` (parametrized over `[]`, `"<html>"`, `{"cards": "x"}`, 500), `test_no_key_file_means_unavailable_without_calling`, `test_forward_refuses_other_paths`.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_display_ai.py -q` — expect failures.
- [ ] **Step 3: Implement** with `urllib.request` like `printer_control`; the cache is a module-level `(at, value)`.
- [ ] **Step 4: Run** the file and the full suite — pass.
- [ ] **Step 5: Commit** `display: Local AI client (cached, bounded, unavailable on any failure)`.

### Task 4: The feed and the long poll

**Files:**
- Create: `hub/display_feed.py`, `tests/fixtures/display_feed_v2.json` (a real `/api/display/feed` answer captured from Local AI, keys and addresses removed)
- Create: `hub/display_routes.py` (the router; `app.include_router(display_routes.router)` in `hub/app.py`); Task 1's pairing routes move into it
- Test: `tests/test_display_feed.py`

**Interfaces:**
- Consumes: `records.all()`, `records.problems()`, `needs.build(...)` as `/api/needs` calls it, Pi Hub's lab judge item (`needs._lab_items`), `display_ai.cards()`, `display_messages.pending()` (Task 5).
- Produces:
  - `display_feed.build(now: float, ai: dict, recs: list, needs_list: dict, lab: list, messages: list) -> dict` → feed v2 plus `ai: {available, checkedAt}`; household cards `needs` (Problems count plus `ai.approvals.count`, first problem as text), `printer`, `playing`, `materials`, `lab` (`ask: "lab-judge"` when a run waits), `home`; then the AI cards; the feed's `needs` list and `needsCount` from Pi Hub's own list; when `ai.available` is false the card `{"kind": "ai", "id": "ai-off", "title": "AI unavailable — PC asleep", "tone": "info"}`
  - `display_feed.signature(feed) -> str` (times and "ago" words excluded, as Local AI's `signature`)
  - `GET /api/display/feed`, `GET /api/display/events?since=<sig>` → `{sig, changed}`: at once when different or unknown, else on change, else after 25 s

- [ ] **Step 1: Write the failing tests** — `test_shape_matches_local_ais_feed_v2` (every key and card field the fixture has, with the same types), `test_pc_asleep_hides_ai_cards_and_says_so`, `test_each_source_down_affects_only_its_card` (parametrized: printer record stale, Plex missing, lab empty), `test_needs_count_adds_approvals`, `test_size_within_local_ais_caps`, `test_signature_ignores_times`, `test_unknown_signature_answers_at_once`, `test_feed_needs_the_display_key`.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_display_feed.py -q` — expect failures.
- [ ] **Step 3: Implement** `display_feed.py` and the two routes; the long poll subscribes to `records.subscribe()` and re-checks the AI cache.
- [ ] **Step 4: Run** the file and the full suite — pass.
- [ ] **Step 5: Commit** `display: feed v2 from Pi Hub, with AI cards when the PC answers`.

### Task 5: Banners and the heartbeat

**Files:**
- Create: `hub/display_messages.py`
- Modify: `hub/records.py` (the `workshop_display` record prefers a heartbeat newer than 10 minutes)
- Test: `tests/test_display_messages.py`

**Interfaces:**
- Produces:
  - `display_messages.post(title: str, text: str = "", tone: str = "info", chime: bool = False, action: dict|None = None, now=None) -> int` (seq); at most 6 a minute (429 beyond); kept 15 minutes; quiet hours 22:00–07:00 keep the banner but chime only a failure
  - `display_messages.pending(now=None) -> list` (merged into the feed with Task 3's AI messages, ordered by time)
  - `display_messages.store_heartbeat(body: dict, now)` and `display_messages.last_heartbeat(max_age=600) -> dict|None`
  - Routes (in `display_routes.py`): `POST /api/display/notify` (owner, or the display key, or the Mac's lab key), `POST /api/display/heartbeat` (display key; `{version, sourceSha, uptimeS, rssi, heapFree, psramFree, camera}`)

- [ ] **Step 1: Write the failing tests** — `test_notify_rate_limit`, `test_messages_expire_after_15_minutes`, `test_quiet_hours_chime_only_failures`, `test_heartbeat_updates_the_display_record`, `test_heartbeat_needs_the_display_key`.
- [ ] **Step 2: Run** — expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the full suite — pass.
- [ ] **Step 5: Commit** `display: banners and heartbeat on Pi Hub`.

### Task 6: Clear plate and Judge it

**Files:**
- Modify: `hub/lab.py` (extract `queue_request(project: str, data: dict, by: str) -> dict` from `create_request`, which keeps its route and checks and now calls it), `hub/display_routes.py` (the two routes)
- Test: `tests/test_display_actions.py`

**Interfaces:**
- Consumes: `printer_control.run("clear")`, `display_messages.post(...)`, `lab.queue_request(...)`.
- Produces:
  - `POST /api/display/printer/clear` (display key) → `printer_control.run("clear")`'s `{ok, say, steps}`, plus one banner: "Plate confirmed" (all steps ok), "Check printer errors" (plate ok, errors step not), "Plate not confirmed" (first step failed); a lock refuses a second call while one runs (409 "Clear plate is already running.")
  - `POST /api/display/lab/verdict {run, requestId, grades, inconclusive, replace}` (display key) → queues the `verdict` request (`lighting: "diagnostic"`, `note: null`) for the run on the judge card; a different run → 409 "This print has changed. Open it again."; the same `requestId` twice → the stored answer, one request

- [ ] **Step 1: Write the failing tests** — `test_clear_plate_banners` (parametrized over the three outcomes), `test_clear_plate_refuses_while_one_is_running`, `test_clear_plate_timeout_is_not_retried` (the fake post counts calls: 1), `test_verdict_queues_one_request_per_id`, `test_verdict_for_a_changed_run_is_refused`, `test_verdict_needs_every_strip_or_a_reason`.
- [ ] **Step 2: Run** — expect failures.
- [ ] **Step 3: Implement**, keeping `create_request`'s existing tests green.
- [ ] **Step 4: Run** the file and the full suite — pass.
- [ ] **Step 5: Commit** `display: Clear plate and Judge it through Pi Hub (no PC needed)`.

### Task 7: AI pass-throughs

**Files:**
- Modify: `hub/display_routes.py`
- Test: `tests/test_display_passthrough.py`

**Interfaces:**
- Consumes: `display_ai.forward(...)`.
- Produces: `GET /api/display/approvals`, `POST /api/display/approvals/decide`, `GET /api/display/ask`, `GET /api/display/images/{n}` (display key) forwarded live to Local AI; Local AI unreachable → 503 `{"error": "AI unavailable — PC asleep"}`; nothing cached, queued or retried.

- [ ] **Step 1: Write the failing tests** — `test_approvals_are_fetched_live_each_time` (two calls → two forwards), `test_decide_is_forwarded_once_and_not_retried`, `test_pc_asleep_says_ai_unavailable`, `test_images_proxy_streams_the_jpeg`.
- [ ] **Step 2: Run** — expect failures.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the full suite — pass.
- [ ] **Step 5: Commit** `display: approvals, ask and pictures through Pi Hub while the PC answers`.

### Task 8: Owner page, keys on the Pi, docs, release

**Files:**
- Create: `hub/static/js/display-pair.js`
- Modify: `hub/static/js/system.js` (a "Workshop display" card: Pair display → shows the code and its countdown; paired since), `hub/static/sw.js` (cache list and version), `deploy/install.sh` (create `/etc/pi-hub/secrets/localai_hub_key` once if missing, 0640 root:pi-hub, and print its SHA-256 for Local AI's `stack.env`), `docs/operations.md` (pairing, the hub key, rollback), `docs/status.md`
- Test: `tests/test_display_pair_ui.mjs` (countdown text, error copy), browser `tests/browser/structure.mjs` still 28/28

- [ ] **Step 1: Write the failing JS test** for the card's states (not paired / code showing with minutes left / paired since).
- [ ] **Step 2: Run** `node --test tests/test_display_pair_ui.mjs` — expect failure.
- [ ] **Step 3: Implement** the card and the install step.
- [ ] **Step 4: Run** all suites; deploy preflight; release (`git push pi main`); set `LOCALAI_HUB_KEY_SHA256` in Local AI's `stack.env` and recreate the appliance (`docker compose --env-file C:\LocalAI\stack\stack.env -f C:\LocalAI\repo\deploy\stack\compose.yml up -d appliance`; ask the owner first, it restarts Local AI); pair a test key and check `GET https://home.home.arpa/api/display/feed` shows household cards and `ai.available: true`. The PC-asleep path is checked by Task 3's and Task 4's tests, not by stopping Local AI.
- [ ] **Step 5: Commit** and update `docs/status.md` with what was checked live.
