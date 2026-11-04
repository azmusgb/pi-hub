# Platform step 7: one navigation, one palette, one set of names — Plan

**Goal:** Pi Hub and the Assistant each have one navigation per level and use the same words for the same things. System
opens on Health, with a page strip. Retired routes redirect, and an unknown address gets a real 404. One ⌘K palette
component serves both apps, and every link to a tool comes from one registry instead of four copies.

**Spec:** `docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`, §11 step 7: "The System strip,
`/pi` into Health, the `/control` and `/next` retirements, the real 404 page, the ⌘K palette component, the
registry-generated tool list replacing the shared header, and the renames on Pi Hub and LocalAI. Only the strip's
Versions entry waits for 3." Also §5 (the three levels; the 5.6 route mapping for Pi Hub and LocalAI), §8 (search and
command model), §9 (terminology and the phrase-table additions), §12 D3 (the shared header retires as navigation) and
D6 (the renames, with "Health" narrowed).

**Depends on:** nothing still open. Step 7 is "independent of 2-6". The Versions entry waited for step 3, which is
complete (every target publishes; pi-hub #56). No approved amendment touches step 7. Proposed amendment A4 (an
Assistant inside Pi Hub's shell) is a separate owner decision. This plan neither includes nor depends on it (see "Out
of scope").

## Done means

The spec gives step 7's contents but no numbered criteria. These are derived from §11, §5.6, §8, §9, D3 and D6; Decision
1 proposes them as the criteria.

1. **Strip:** System has one page strip with Health, Backups, Versions, Alerts, Automations and Settings (§5.6 `/system`).
2. **`/pi` into Health:** `/pi`'s content lives on System › Health, and `/pi` is a redirect (§5.6 `/pi`).
3. **Retirements:**
   - `/control`, `/movies` and `/next` are redirects only. Their `PAGES` entries are gone, and `next.js` is deleted.
   - `/drives` is Media › Storage.
   - The `/scan/*` proxy is retired.
   - `/more` isn't blank on desktop.
   
   (§5.6.)
4. **404:** any other path gets a real 404 page, not the shell (§5.6 "Any other path").
5. **Palette:** one kit palette component with per-app providers, used by both apps (§8.1, §8.2, §13's "a palette
   component (new)").
6. **Tool list:** one registry of tools, names and hostnames, including the display and OTA exception, generated per
   language. It feeds the rail, the "Open in …↗" rows and the Assistant's door. The shared header no longer ships as
   navigation (D3, §5.2, §4 Tool, §13).
7. **Renames:** D6 and §9 are applied on Pi Hub and LocalAI, and the phrase keys `pc_off`, `assistant_down`,
   `source_down` and `unknown_release` exist (§9). The display's tab rename rides a firmware candidate (D6), so it
   belongs to step 8.

## What exists today (read on 3 November 2026: pi-hub `630151c`, LocalAI `1bc1ffd`, appliance-ui `3e8a009`)

- **System has no strip.** `hub/static/js/system.js:14-30` shows Backups, then "Services on the Pi", then a list of
  links that includes `/pi` "Help & system" (`:25`) and `/drives` "Movie storage" (`:26`). Settings still carries a
  Versions card (`hub/static/js/settings.js:67-72, 193`).
- **`/pi` is a 1,701-line page** (`hub/static/js/pi.js`) with these cards:
  - help guidance by topic (`:67`, opened with `?help=`)
  - Self-check (`:292`)
  - Health charts (`:393`)
  - Fix it (`:616`)
  - Outages (`:812`)
  - Services (`:934`)
  - Storage (`:1049`)
  - Updates (`:1149`)
  - Network (`:1245`)

  It reads `/api/pi?hours=` and `/api/actions` (`:1352-1355`). "Services" appears on both `/pi` and `/system`.
  `hub/now.py:52,107` tells the owner to "Open Help & system".
- **The retired routes still have page entries.** `/control` (`main.js:61`) and `/movies` (`main.js:54`) are in
  `PAGES`, although `REDIRECTS` already sends both away (`sections.js:18-21`).
- **`next.js` is not dead code.** It holds Home's control room (`now.js:9` imports `mountControlRoom` and others) and
  one of two command palettes (`main.js:331`, `initCommandPalette`, `next.js:725`). Tests import it
  (`tests/test_home_control.mjs`, `tests/test_next.mjs`).
- **Pi Hub has two palettes on one dialog.**
  - `enhance.js:71-130` builds a list from the rail.
  - `next.js:725-830` builds one from records and needs, and overrides the first with capture-phase listeners
    (`next.js:809`).

  Its list still offers "Control room (Now / Problems / Recent)" pointing at `/next` (`next.js:240`).
- **Every unknown path returns the shell with HTTP 200.** `hub/app.py:1231-1236` serves `index.html` for any non-API
  path, and the client falls back to Home (`main.js:218`).
- **The `/scan/*` proxy is live** (`hub/app.py:1167-1225`). The `scan.` host also exists (`toolUrl("scan")`).
- **Tool addresses live in four places:**
  - `sections.js:45-50` (`toolUrl`)
  - appliance-ui `suite.json`, which is stale: it still lists "Materials" and `https://10.0.0.21/`
  - LocalAI's `homeUrl` (`app/public/ask-context.js:20`)
  - LocalAI's `ui.js:1004` "← Pi Hub" link, hard-coded to `http://10.0.0.30/`

  The firmware installer nav is the fourth copy the spec names (Report l.260); it belongs to step 8.
- **The shared header ships but isn't used.** `appliance-header.js` and `appliance-header.lite.js` are in the kit's dist,
  copied into `hub/static/ui/` (kit 1.4.0, `VERSION`) and into LocalAI's `app/public/ui/`. No page in either app loads
  them.
- **LocalAI's palette** is `app/public/app.js:850-885`: registry pages plus "Search your work", with combobox roles.
- **Renames outstanding:**

  | App | Old | New | Where |
  | --- | --- | --- | --- |
  | Pi Hub | "Problems" | Needs you | `alerts.js:56`, `next.js:240` |
  | Pi Hub | "Help & system" | Health | `main.js:59`, `system.js:25`, `now.py:52,107` |
  | Pi Hub | "Print" | Print a document | `main.js:57` |
  | Pi Hub | "Movie storage" | Storage, under Media | `main.js:65`, `drives.js:55`, `movies.js:1602` |
  | Pi Hub | "The PC is off" whenever Local AI is down | Two phrases: `pc_off` when the PC is off, `assistant_down` when the PC is on but Local AI isn't answering | `sections.js:77-79` |
  | LocalAI | `integrations` "Services" | Connections | `view-registry.js:35` |
  | LocalAI | Composer mode "Change Local AI" | Change the assistant | `home.js:6` |
  | LocalAI | "Everything you kept" | Library | `index.html:107`, `view-registry.js:31` |
  | LocalAI | Section name "Health" | Status (Decision 8) | `view-registry.js:33,35` |
  | LocalAI | "← Pi Hub" | ← Home | `ui.js:1004` |

  Already done in LocalAI: Assistant status, Assistant automations, and Deployments as a link to Versions (#462).
  Assistant status has no "Health ↗" link to Pi Hub yet.
- **The phrase table** lives in the kit's `src/needs.js`. None of `pc_off`, `assistant_down`, `source_down` or
  `unknown_release` exists there.

### What the reverted commits tried (pi-hub #77)

Seven commits pushed straight to `main` on 3 November were reverted in #77. Three of them attempted parts of this step:

- **`c3b6e7e`** added a System strip, a `/pi` redirect and a client-side 404. The strip:
  - had no Backups entry;
  - added "Architecture" (an A4 item);
  - used inline styles.

  The redirect dropped `/pi`'s content rather than moving it. The 404 used inline styles and kept HTTP 200.
- **`40dd3d7` and `76e49eb`** belong to A4, not here.

Kept from them: the strip's `aria-current` approach, and the idea of a not-found view for client-side navigation
(Decision 5 adds a server-side 404).

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **The "Done means" list above is step 7's completion criteria.** The spec lists step 7's contents but gives no
   criteria. Each line maps to the spec's own words. The rejected alternative was to accept on "the routes in §5.6
   match", which leaves the palette and the registry unaccepted.

2. **`/system` is Health, and Backups gets its own page `/backups`.** The strip's first entry, Health, is where System
   opens: §9 makes Health "the whole platform's operational health". The current `/system` holds Backups plus links.
   - Backups becomes `/backups` (System › Backups).
   - The links list goes, because the strip replaces it.
   - Pi-side tools stay as the page's "Open in …↗" row (§5.3).

   Rejected: `/system/health` under a `/system` index page. That adds a page whose only job is what the strip already
   does.

3. **`/pi` moves card by card, and nothing is dropped silently.** Health gets these, in this order:
   - Self-check
   - Outages
   - Services, merged with System's "Services on the Pi" into one card
   - Fix it
   - Storage
   - Updates
   - Network
   - the Health charts
   - help guidance (`?help=` keeps working, so `/pi?help=x` redirects to `/system?help=x`)

   The PR lists every card and where it went. `pi.js` is renamed `health.js` in the same PR, and a test checks that
   `/pi` renders nothing of its own. Rejected: keeping `/pi` as a sub-page, which the spec rules out ("Merge … Keep `/pi`
   as a redirect").

4. **`next.js` is split before it is deleted.**
   - The control room moves to `control-room.js`.
   - The palette code goes into the kit component (7.2).

   Then `next.js` and its tests are deleted, and a test checks that no module imports it. The spec's "delete
   `next.js`" assumed it was only the `/next` page. It isn't (see "today"), so deleting it on faith would break Home.

5. **"A real 404 page, not the shell" means an HTTP 404 from the server.** Two readings are possible:
   - **A:** the server knows the page paths and answers others with status 404 and a small standalone page.
   - **B:** the shell renders a not-found view with status 200.

   Recommend A. The spec says "not the shell", and B is still the shell. Under A:
   - The server's list of known paths comes from one file, `hub/static/js/routes.json` (page paths and redirects).
     `main.js` and `sections.js` import it, and `app.py` reads it at start-up, so the list is not copied.
   - The client keeps a not-found view only for in-app navigation to an unknown path.
   - Both offer Home and System. They use kit tokens, with no inline styles.

6. **The tool registry lives in appliance-ui and replaces `suite.json`.** `tools.json` holds, per tool:
   - `id`, `name`, `host` (`<id>.rahe-home.duckdns.org`), `area` and a short `purpose`;
   - the D4 exception as data: `display` and `ota` on `home.arpa`, marked `boundary: "D4"`.

   `build.mjs` generates `tools.js` (ESM) for Pi Hub and LocalAI, and a C header for the firmware, as with
   `tokens.h`; step 8 consumes the header. `sync.mjs` copies the files with hashes in `VERSION`, as it does for the
   kit today.
   - The kit is the one owner. Pi Hub and LocalAI never edit their copy, and `verify.py`/`verify.mjs` fail on drift.
   - Rejected: the registry in pi-hub. LocalAI must work with the Pi down (§10), and a synced static file gives that
     without a runtime call. The kit is already how both apps share files.
   - The kit drops `appliance-header*.js` from dist, and the next sync deletes both apps' copies. This is a breaking
     change for the kit, so it becomes **2.0.0**.

7. **One palette component, providers per app, delivered kit-first.** `palette.js` in the kit implements §8.1:
   - a native `<dialog>`, combobox/listbox roles and focus return;
   - ⌘K, Ctrl+K, and "/" when not typing;
   - reduced motion;
   - the result shape `{kind, label, hint, area, href | run, confirm}` and the order rule;
   - the one-line "source down" row.

   Providers:
   - **Pi Hub:**
     - Go: pages, plus the Assistant's pages as door links.
     - Do: each record's `actions`, confirming per §8.2.
     - Find: records, Needs-you items, lab experiments, lists, movies and alerts, plus documents through the
       Documents page's existing `/api/documents` search.
     - Ask: the hand-off.
     - Cross-search.
   - **LocalAI:**
     - Go: the registry.
     - Find: its existing full-text search.
     - Ask, and cross-search.

   Approving a run is never a palette action (§8.2). Both of Pi Hub's current palettes are deleted in the adoption PR.
   Rejected: adapting `next.js`'s palette into the kit, because it hard-codes Pi Hub's records and `/next`.

8. **LocalAI's registry section "Health" becomes "Status".** D6 narrows "Health" to Pi Hub's System › Health only.
   LocalAI's section heading groups Assistant status and Connections. "Status" says what it is without reusing the word.
   Assistant status gains a "Health ↗" link to Pi Hub `/system`, resolved from the registry (§5.6 `status` row).

9. **The Assistant button uses the phrase keys.**
   - `pc_off` when the `pc` record is off.
   - `assistant_down` when the PC is on and `local_ai` has a problem.
   - Otherwise "Assistant".

   "Unknown" stays enabled, as today (`sections.js:76`). Only `pc_off` and `assistant_down` disable the button.
   `mac_waiting` stays deferred, as step 6 decided.

10. **`/scan/*` redirects to `https://scan.rahe-home.duckdns.org/` (308), keeping the path.** "Retire" in §5.6 doesn't
    say whether the route redirects or returns 404. A redirect keeps old bookmarks and phone shortcuts working, as the
    other retirements do. The proxy code (`app.py:1167-1225`) and its tests are removed.

## PRs, one at a time

Each PR body names its requirement, states full or partial coverage and pastes both suites' counts (`AGENTS.md`).

| PR | Repo | Delivers | Requirement and coverage | Acceptance evidence |
| --- | --- | --- | --- | --- |
| 7.1 | appliance-ui | `tools.json` registry and generators (Decision 6); phrase keys `pc_off`, `assistant_down`, `source_down`, `unknown_release`; header removed from dist; kit 2.0.0 | Criterion 6 (source): full. Criterion 7 (phrase keys): full | Kit tests: generated `tools.js` equals `tools.json`; a duplicate `id` fails the build; D4 entries are marked; `verify` fails on an edited copy |
| 7.2 | appliance-ui | `palette.js` component (Decision 7); kit 2.1.0 | Criterion 5 (component): full | Browser test in the kit demo: open with ⌘K, Ctrl+K and "/"; arrows/Enter/Esc; focus returns; reduced motion; a provider that throws shows its one line |
| 7.3 | pi-hub | System strip; `/system` = Health with `/pi`'s cards (Decisions 2-3); `/backups`; Settings' Versions card removed; strip in CSS | Criteria 1, 2: full | `node --test` for the strip's six entries and `aria-current`; a card-by-card list in the PR; `/pi?help=x` → `/system?help=x`; screenshots at phone and desktop width |
| 7.4 | pi-hub | Retirements: `PAGES` entries for `/control` and `/movies` removed; `next.js` split and deleted (Decision 4); `/drives` → Media › Storage; `/scan/*` → 308 (Decision 10); `/more` on desktop; `routes.json` and the server 404 (Decision 5) | Criteria 3, 4: full | pytest: an unknown path gets 404 and the 404 page, `/api/*` unchanged, every `routes.json` path gets 200, `/scan/x` gets 308; `node --test`: no import of `next.js`, redirects resolve |
| 7.5 | pi-hub | Renames (table above); Assistant button phrases (Decision 9) | Criterion 7 (Pi Hub): full | `git grep` for the old strings is empty in UI code; `node --test` for `pc_off`/`assistant_down`/unknown |
| 7.6 | pi-hub | Sync kit 2.1: tool links from `tools.js` (`toolUrl`, `section-links`, "Open in …↗" rows); palette adopted with Pi Hub's providers; `enhance.js`'s palette and `next.js`'s palette code deleted | Criteria 5, 6 (Pi Hub): full | `node --test`: every tool link resolves from the registry; one `#palette` handler; providers return the shared shape; with the `pc` record off, Ask reads `pc_off` |
| 7.7 | LocalAI | Sync kit 2.1: "← Home" and `homeUrl` from the registry; renames (table above, Decision 8); "Health ↗" link; header copies removed | Criteria 6, 7 (LocalAI): full | LocalAI tests; `git grep` for the old strings is empty; shipped with `npm run ship -- <PR>` |
| 7.8 | LocalAI | Palette adopted with LocalAI's providers; `app.js`'s palette code removed | Criterion 5 (LocalAI): full | Browser test: ⌘K opens the kit palette; "Search the house for …" opens Pi Hub's palette with the query; with Pi Hub down, its one line shows |
| 7.9 | *owner* | Looks at both apps on the phone and desktop and records acceptance | All: acceptance | See below |

**Order:** 7.3, 7.4 and 7.5 need nothing and can merge in any order. 7.1 comes before 7.6 and 7.7, and 7.2 before 7.6 and
7.8. 7.6 needs 7.4, because both touch `next.js`.

**Deploys:** Pi Hub ships with `git push pi main` after `deploy_state` preflight. LocalAI ships with
`npm run ship -- <PR>`, one PR at a time. The kit doesn't deploy on its own; it reaches a device only through 7.6 and
7.7.

## Acceptance for step 7

Recorded in `docs/operations.md` as "Step 7 accepted <date>". The owner looks at both apps on the phone and the desktop,
with these checks:

- **System:**
  - Its strip shows exactly Health, Backups, Versions, Alerts, Automations and Settings.
  - Health shows the cards from Decision 3 and nothing called "Help & system".
  - `/pi` lands on Health.
- **Retired routes:** `/control`, `/next`, `/movies` and `/drives` land on their new homes, and `/scan/` opens the
  `scan.` host.
- **404:** `https://hub.rahe-home.duckdns.org/nope` shows the 404 page, and `curl -o /dev/null -w '%{http_code}'`
  prints 404.
- **⌘K in both apps:** it opens the same-looking palette.
  - "pause" offers the print action, with a confirmation where §8.2 requires one.
  - A document title finds the document.
  - With the PC off, Ask reads "The PC is off or asleep".
- **Assistant:**
  - "← Home" returns to the hub.
  - Status's "Health ↗" opens System › Health.
  - The menu says Connections and Library.
- **Tool links:** "Open in …↗" on Workshop, Documents, Home & network and System opens each tool on its real name.

A matching SHA is a deploy, not acceptance. No status doc calls step 7 done before that line exists.

## Out of scope (noted, not gated)

- **Proposed amendment A4: an Assistant inside Pi Hub's shell** (and an in-shell Architecture page). The baseline's door
  model (§5.1 level 0) keeps the Assistant on its own origin. A4 is drafted separately for the owner's decision. If it
  is approved, its own plan builds on 7.6's registry and palette.
- **The display's renames, phrase keys and installer nav** (D6, §5.6 Display). They ride a firmware candidate under
  step 8. 7.1's C header is ready for them.
- **Level-2 strips in other areas** (Workshop: Printer | Print lab, and so on). §5.1 calls for "one underlined page
  strip" per area. This step builds the component and the System strip; other areas adopt it when their pages next
  change. Follow-up issue: "level-2 strips per area", filed with 7.3.
- **`/settings` restructure beyond removing the Versions card.** Not in step 7's list.
