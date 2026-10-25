# One home, step 2: the hub's structure (implementation plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi Hub is organised by task: one menu (Home · Workshop · Documents · Media · Home & network · System, plus Assistant), six Home cards led by "Needs you", each tool inside its section, plain words, and no App Suite.

**Architecture:**
- **Menu:** one data module (`sections.js`) defines the sections and maps every old path to its section. The rail, the phone bar and the router all read from it.
- **New read APIs:** `/api/needs`, `/api/documents`, `/api/system/backups` and `/api/network/adguard`. Each reads another app and never copies its data (D8).
- **Root-only credentials stay out of the hub.** The backup ages and the AdGuard stats come through the root helper's fixed actions.

**Tech Stack:** FastAPI, vanilla ES modules (no build), `node --test`, pytest, Playwright from the Mac for the browser check.

**Spec:** `docs/superpowers/specs/2026-10-24-one-home-design.md` (sections "The hub's structure", D2, D7, D8, "Words"; rollout step 2).

**Precondition:** step 1's owner checks are done (the names resolve and the CA is trusted on the iPhone and the Mac). Task 6 removes the hub's `/scan/` proxy in favour of `https://scan.home.arpa`.

## Global Constraints

- **Menu (D2):** Home · Workshop · Documents · Media · Home & network · System, plus an Assistant button. Paper printing sits under Documents, 3D printing under Workshop.
- **Layout:**
  - Phone: a bottom bar with Home, Workshop, Documents, Media, More (More holds Home & network and System).
  - Desktop: a left rail with all six.
  - The Assistant button: the top bar on the phone, the rail's foot on the desktop. It opens `https://assistant.home.arpa/`; the context hand-off and the "The PC is off" state are step 4.
- **Badge (D7):** "Needs you" lives on Home, and its count is the badge on the Home tab, never on Assistant.
- **Data (D8):** the hub reads other apps through their APIs and never copies their data.
- **Words:**
  - Labels name tasks ("Find a document", "Clear the plate", "Restore a file").
  - Product names and links go in a small line, "Open Paperless ↗", pointing at the tool's `https://<name>.home.arpa`.
  - The X2D is "Bambu X2D" everywhere.
- **No new runtime dependencies** in the hub. Every outside call has a timeout of 4 s or less and is cached through `sources.cached`, so a slow app never blocks the page.
- **Removals:** the App Suite page, every `/apps*` route, `/bambuddy`, `/grafana`, `/status` as hub pages, `station-apps.js`, and the hub's `/scan/` proxy.

## Decisions this plan makes (the spec is silent)

| Item | Decision |
|---|---|
| Section paths | `/`, `/workshop`, `/documents`, `/media`, `/network`, `/system` |
| Old paths | `/movies` → `/media`, `/control` → `/network`. `/print` and `/lists` stay as pages under Documents. `/pi`, `/alerts`, `/rules`, `/settings` and `/drives` stay as pages under System. `/weather` and `/wall` stay, with no menu entry. `/apps*`, `/bambuddy`, `/grafana`, `/status` redirect to the section where the tool now lives (Bambuddy → Workshop, Grafana and Status → Home & network, Scan → Documents). |
| Lists | Under Documents ("Shopping, to-dos and notes"). The spec's menu has no place for them. |
| "Needs you" sources | Local AI's feed cards whose tone isn't `ok` (from `https://10.0.0.21/api/display/feed`, unauthenticated). Pi alerts from the last 12 hours. A finished print until the next one starts ("Clear the plate"). A failed print from the last 24 hours. |
| Paperless | The hub calls `http://10.0.0.21:8010/api/` directly with a view-only token, because a machine caller can't pass the gate. The owner reads results in the hub; links open `https://paperless.home.arpa`. |
| Backups | Root helper action `backups:ages`: the newest file mtime under each restic repo's `snapshots/` (`/mnt/usb1/backups/restic/pi`, `…/mac`). No Backrest password reaches the hub. |
| AdGuard | Root helper action `adguard:stats`: `num_dns_queries` and `num_blocked_filtering` from AdGuard's `/control/stats`, using the root-only secret inside the helper. |
| Clear plate on Home | Step 3. Until then the Workshop card's action is "Open Bambuddy ↗". |

## Review Focus

1. **A source is down or slow** (PC off, Paperless stopped, AdGuard restarting). Home still renders every card within 5 s. The down card says which app isn't answering, and "Needs you" lists the sources it couldn't read. Tests: Task 2 `test_needs_lists_sources_it_could_not_read`; Task 5 `homeCards` with each source `null`.
2. **Old bookmarks and the iPhone home-screen icon** (`/movies`, `/control`, `/apps/grafana`, `/pi`) land in the right section, with the right tab marked. Test: Task 1 `sectionFor` and `redirectFor` tables.
3. **Paperless search input:** empty, quotes, `&`, 200+ characters, non-ASCII. The query is URL-encoded and capped at 100 characters, and empty returns recent documents. Test: Task 4 `test_search_encodes_and_caps_the_query`.
4. **The Home badge and the "Needs you" card disagree.** Both read `/api/needs` `count`. Test: Task 5 `badge equals needs card count`.
5. **Phone width 390 px with the notch:** the bottom bar must not cover the last card, and the Assistant button stays reachable. Test: Task 7 browser check (the last card's bottom ≤ the bar's top, at 390×844 light and dark).

---

### Task 1: Sections and the menu

**Files:**
- Create: `hub/static/js/sections.js`
- Modify: `hub/static/index.html` (the rail and the phone bar are rendered from `sections.js`, so the hand-written `<li>` links go), `hub/static/js/main.js` (`PAGES`, `subtitles`, redirects), `hub/static/js/navigation.js` (the badge moves to the `home` tab; see Task 5)
- Test: `tests/test_sections.mjs`

**Interfaces:**
- Produces:
  - `SECTIONS: Array<{key, title, path, icon, pages: string[]}>` in the D2 order;
  - `sectionFor(path) -> key`;
  - `redirectFor(path) -> string | null`;
  - `phoneTabs() -> keys` (`["home","workshop","documents","media","more"]`);
  - `railItems() -> keys` (all six);
  - `ASSISTANT_URL = "https://assistant.home.arpa/"`.

- [ ] **Step 1: Write the failing test** `tests/test_sections.mjs`:
  - `sectionFor`: `/`→home, `/wall`→home, `/weather`→home, `/workshop`→workshop, `/documents` `/print` `/lists`→documents, `/media` `/movies`→media, `/network` `/control`→network, `/system` `/pi` `/alerts` `/rules` `/settings` `/drives`→system, `/more`→more, unknown→home.
  - `redirectFor`: `/movies`→`/media`, `/control`→`/network`, `/apps`→`/`, `/apps/bambuddy` and `/bambuddy`→`/workshop`, `/apps/grafana` `/grafana` `/apps/status` `/status`→`/network`, `/apps/scan`→`/documents`, `/workshop`→null.
  - `phoneTabs()` and `railItems()` as above.
  - `SECTIONS.map(s => s.title)` deep-equals `["Home","Workshop","Documents","Media","Home & network","System"]`.
- [ ] **Step 2: Run** `node --test tests/test_sections.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `sections.js`**, then wire it in:
  - `main.js`'s `show()` calls `redirectFor` first and uses `history.replaceState` to the new path, then renders.
  - The rail and bar mark `aria-current` from `sectionFor`.
  - Add `/documents`, `/network` and `/system` to `PAGES`, backed by placeholder modules that Task 6 fills.
  - The Assistant button goes in the phone top bar and the rail's foot: an `<a href=ASSISTANT_URL>` labelled "Assistant", never badged.
- [ ] **Step 4: Run** `node --test tests/*.mjs` and `pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `structure: one menu by task (Home, Workshop, Documents, Media, Home & network, System)`.

### Task 2: "Needs you"

**Files:**
- Create: `hub/needs.py`
- Modify: `hub/app.py` (`GET /api/needs`), `hub/sources.py` (`localai_feed()`, cached for 30 s, timeout 4 s, TLS unverified to 10.0.0.21, the same as the step-1 Caddy route)
- Test: `tests/test_needs.py`

**Interfaces:**
- Consumes:
  - `system.alerts()`;
  - `events.recent()` (kinds `print_finished`, `print_failed`, `print_started` or the existing start kind; read `hub/events.py`);
  - `sources.localai_feed() -> dict | None`.
- Produces: `needs.build(alerts, events, feed, now) -> {"count": int, "items": [{"source", "tone", "title", "detail", "link"}], "unread": [source names]}`, served at `GET /api/needs`.

- [ ] **Step 1: Write the failing tests:**
  - `test_needs_merges_the_three_sources`:
    - feed cards with tone `attention` → items with source "Local AI" and link `https://assistant.home.arpa/`;
    - a 2-hour-old alert → source "Pi";
    - `print_finished` with no later start → title "Clear the plate", link `/workshop`;
    - `count == len(items)`.
  - `test_needs_ignores_ok_cards_old_alerts_and_cleared_prints`:
    - the feed's "All clear" card;
    - a 13-hour-old alert;
    - `print_finished` followed by a start.
  - `test_needs_lists_sources_it_could_not_read`: `feed=None` → `unread == ["Local AI"]`, and the other items still appear.
  - `test_api_needs_answers_when_local_ai_is_off` (monkeypatch `sources.localai_feed` to return None): 200 within the test client.
- [ ] **Step 2: Run** `pytest tests/test_needs.py -q`. Expected: FAIL (no module).
- [ ] **Step 3: Implement** `needs.build` (pure) and the endpoint. Items are ordered by tone (`bad`, `attention`, `warn`) and then newest first.
- [ ] **Step 4: Run** `pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `structure: Needs you merges Local AI, Pi alerts and the printer`.

### Task 3: Backup ages and AdGuard stats through the helper

**Files:**
- Modify: `deploy/pi-hub-helper.py` (actions `backups:ages` and `adguard:stats`, the same shape as `drives:report`), `hub/app.py` (`GET /api/system/backups`, `GET /api/network/adguard`, cached for 5 min), `hub/system.py` (a helper-call wrapper, if not already shared)
- Test: `tests/test_helper_reads.py`

**Interfaces:**
- Produces:
  - `backups_ages(roots={"Pi": "/mnt/usb1/backups/restic/pi", "Mac": "/mnt/usb1/backups/restic/mac"}) -> {"Pi": epoch | None, "Mac": epoch | None}`;
  - `adguard_stats(fetch) -> {"queries": int, "blocked": int} | None`;
  - `/api/system/backups` returns `{"repos": [{"name", "last", "hours"}], "open": "https://backups.home.arpa/"}`;
  - `/api/network/adguard` returns `{"queries", "blocked", "open": "https://adguard.home.arpa/"}` or `{"available": false}`.

- [ ] **Step 1: Write the failing tests:**
  - `backups_ages` over a tmp tree, with a newer snapshot file in one repo and none in the other → that epoch, and None.
  - `adguard_stats` with a fake fetch returning `{"num_dns_queries": 900, "num_blocked_filtering": 120}` → `{"queries": 900, "blocked": 120}`; a fetch that raises → None.
  - The helper refuses unknown action names (existing behaviour, re-asserted for the two new names' spelling).
- [ ] **Step 2: Run** `pytest tests/test_helper_reads.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** The helper reads `/etc/pi-hub/secrets/adguard_admin` itself; the user name comes from `/opt/adguard/conf/AdGuardHome.yaml` `users[0].name`. The password never leaves the helper.
- [ ] **Step 4: Run** `pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `structure: backup ages and AdGuard stats from the root helper`.

### Task 4: Documents from Paperless

**Files:**
- Create: `hub/paperless.py`
- Modify: `hub/app.py` (`GET /api/documents?q=`), `deploy/install.sh` (`/etc/pi-hub/secrets/paperless_token` is root:pi-hub 640, when present), `docs/operations.md` (Paperless › the hub's view-only user)
- Test: `tests/test_documents.py`

**Interfaces:**
- Produces:
  - `paperless.search(q: str) -> [{"id", "title", "created", "correspondent", "link"}] | None`, where `link = f"https://paperless.home.arpa/documents/{id}/details"`;
  - `paperless.recent(n=5)`;
  - `GET /api/documents?q=` returns `{"query", "results", "available", "open": "https://paperless.home.arpa/"}`.

- [ ] **Step 1: Write the failing tests** (monkeypatch the HTTP getter):
  - `test_search_encodes_and_caps_the_query`: `q='bill "AT&T" ' + "x"*200` → the requested URL contains `query=bill+%22AT%26T%22` and the query is ≤ 100 characters.
  - `test_empty_query_returns_recent`.
  - `test_documents_says_unavailable_when_paperless_is_off` (the getter raises) → `available: false`, 200.
  - `test_no_token_means_unavailable`.
- [ ] **Step 2: Run** `pytest tests/test_documents.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** with `Authorization: Token <token>` against `http://10.0.0.21:8010/api/documents/?query=…&page_size=8&ordering=-created`.
- [ ] **Step 4: Owner-side setup (run by the executor over ssh):**
  - On the PC, `docker exec paperless-webserver-1 python3 manage.py shell -c …` creates the user `hub` with only `view_document`, `view_correspondent` and `view_tag`, and a DRF token.
  - Write the token to the Pi at `/etc/pi-hub/secrets/paperless_token` (640 root:pi-hub) without printing it.
- [ ] **Step 5: Run** `pytest -q`. Expected: PASS. Then commit `structure: find documents from the hub (Paperless, view-only)`.

### Task 5: Home's six cards and the badge

**Files:**
- Create: `hub/static/js/home-cards.js` (pure: data → card models)
- Modify: `hub/static/js/now.js` (render the cards; the greeting and weather line stay), `hub/static/js/navigation.js` (the Home badge from `/api/needs`), `hub/static/home.css`
- Test: `tests/test_home_cards.mjs`

**Interfaces:**
- Consumes: `/api/now`, `/api/needs`, `/api/system/backups`, `/api/network/adguard` (not on Home), `/api/documents` (recent: not on Home).
- Produces: `homeCards({now, needs, backups}) -> [{key, title, status, tone, action: {label, href}, link: {label, href} | null}]`. The keys come in order: `needs` (only when `count > 0`), `workshop`, `documents`, `media`, `network`, `system`. Also `homeBadge(needs) -> string` (`""` for 0 or null; `"99+"` past 99).

- [ ] **Step 1: Write the failing tests:**
  - **Order and visibility:** the `needs` card appears only when `count > 0`.
  - **Workshop card:**
    - status `"Printing, 94% · done 14:20"`, with title "Bambu X2D";
    - action "Open Bambuddy ↗" → `https://bambuddy.home.arpa/`.
  - **Documents card:** action "Find a document" → `/documents`; link "Scan ↗" → `https://scan.home.arpa/`.
  - **Media card:** "Now playing: …" or "Nothing playing", plus the latest movie added. A 0-length `playing` array means "Nothing playing"; `null` means "Plex isn't answering".
  - **Network card:** "Internet OK" or "Internet slow", from `now.network.tone`, plus "N devices on".
  - **System card:** "Backed up 6 h ago · Pi 52 °C". A backup over 36 h old gets tone `warn`.
  - **Each source `null`:** the card still renders, with "<App> isn't answering".
  - **Badge equals the needs card count:** `homeBadge({count: 3}) === "3"` and equals the needs card's count text. `homeBadge({count: 120}) === "99+"`.
- [ ] **Step 2: Run** `node --test tests/test_home_cards.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement `home-cards.js`**, then render in `now.js`. Each card is one `card()` with a status line and one main action. The "Open … ↗" line is small, under the action.
- [ ] **Step 4: Run** `node --test tests/*.mjs && pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `structure: Home's six cards, Needs you first, badge on the Home tab`.

### Task 6: Sections, words, and the App Suite removed

**Files:**
- Create: `hub/static/js/documents.js`, `hub/static/js/network.js`, `hub/static/js/system.js`
- Modify:
  - `hub/static/js/workshop.js`, `hub/static/js/now.js`: "Bambu X2D" replaces "Bambu P1S";
  - `main.js`: the subtitles below;
  - `hub/app.py`: remove `/scan` and `/scan/{path}`;
  - `deploy/pi-hub-selfcheck.py`: `PAGES` gets `/documents`, `/media`, `/network`, `/system`;
  - `hub/static/js/more.js`: More lists Home & network and System.
- Delete: `hub/static/js/station-apps.js`
- Test: `tests/test_pages.py` (additions), `tests/test_sections.mjs` (additions)

**Interfaces:**
- Consumes: Tasks 1–4's endpoints; the existing `controlPage`, `printPage`, `listsPage` and `moviesPage` modules, rendered inside the sections (not copied).

- [ ] **Step 1: Write the failing tests:**
  - `test_scan_proxy_is_gone` (`/scan/` serves the SPA shell, not scanservjs);
  - `test_section_pages_serve_the_shell` (`/documents` `/network` `/system` `/media` → 200 with `js/main.js`);
  - `test_no_p1s_left` (grep `hub/static` for "P1S" → none);
  - `test_no_app_suite_left` (no "App Suite", "Command Plane", "NOC", or "Port 8000" in `hub/static`).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement the sections:**
  - **Workshop:**
    - printer status, camera, "Open Bambuddy ↗";
    - filament and projects (the existing Bambuddy reads);
    - "Print lab ↗" → `https://assistant.home.arpa/#projects`;
    - the workshop display's state.
  - **Documents:**
    - "Find a document": a search box and results from `/api/documents`;
    - recent documents;
    - "Scan a document ↗" → `https://scan.home.arpa/`;
    - "Print": today's Print page;
    - "Lists": today's Lists page.
  - **Media:** today's Movies page.
  - **Home & network:**
    - today's Devices;
    - "Internet": the network summary plus "Open Grafana ↗" and "Open Status ↗";
    - "Blocked today: N of M" plus "Open AdGuard ↗".
  - **System:** links to Alerts, Automations, "Restore a file" (backup ages plus "Open Backrest ↗"), Help & system, Settings, and Movie storage.
- [ ] **Step 4: Subtitles** (exact copy):

  | Path | Subtitle |
  |---|---|
  | `/` | Your home at a glance |
  | `/workshop` | The X2D, filament and projects |
  | `/documents` | Find, scan and print papers |
  | `/media` | Movies and what's playing |
  | `/network` | Devices, internet and blocking |
  | `/system` | Backups, alerts and settings |
- [ ] **Step 5: Run** `node --test tests/*.mjs && pytest -q`. Expected: PASS. Commit `structure: sections in plain words; App Suite and the scan proxy removed; X2D named`.

### Task 7: Browser check, release and acceptance

**Files:**
- Create: `tests/browser/structure.mjs` (Playwright and `@axe-core/playwright`, dev-only `tests/browser/package.json`, run from the Mac and not by the release)
- Modify: `docs/status.md`, `docs/operations.md` (the menu map)

- [ ] **Step 1: Write the browser check.** For `/`, `/workshop`, `/documents`, `/media`, `/network`, `/system` at 390×844 and 1440×900, light and dark, against `https://home.home.arpa` (signed in with a minted owner session, the gate-check way):
  - axe reports no serious or critical violations;
  - the active tab matches the section;
  - on the phone, the last card's bottom ≤ the bottom bar's top after scrolling to the end;
  - the Assistant link is visible and has no badge;
  - screenshots go to `tests/browser/out/` (git-ignored).
- [ ] **Step 2: Release** with `./deploy/install.sh`, then run the browser check and `gate-check.sh`. Expected: both pass, and the self-check covers the new pages.
- [ ] **Step 3: Re-walk the five critique tasks** on the iPhone with the owner and record the step and login counts against the step-1 baseline in `docs/status.md`. Commit `docs: one home step 2 done`.
