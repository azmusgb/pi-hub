# Print lab on Pi Hub, Plan C: `/lab` page parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi Hub's `/lab` shows everything Local AI's Print lab shows: real question and experiment data, run lines with
their Bambuddy print, "entered on the Mac", prints outside the lab, spool colours, photos, and every request kind the
page can send. Signing in, errors and refresh behave well on a phone.

**Architecture:** Work in the Pi Hub worktree `/Users/billrahe/dev/pi-hub-labc`, branch `feat/lab-parity`. Pi Hub's
`hub/static/js/lab.js` was written against a guessed index shape, so Task 1 replaces its renderers with ports of Local
AI's against a real `build_index` fixture. New modules stay small (`lab-net.js`, `lab-photos.js`, `lab-observe.js`).
**Read `docs/superpowers/plans/2026-10-28-lab-on-hub-c-gap.md` first** — the gap table: which Local AI function and line
to port for each feature, the real field names, payload differences, and Pi Hub's conventions.

**Tech Stack:** Vanilla ES modules (no build), `hub/static/lab.css` on `tokens.css`, FastAPI backend (unchanged except
tests), `node --test tests/*.mjs`, pytest.

**Spec:** `/Users/billrahe/dev/pi-hub/docs/superpowers/specs/2026-10-28-print-lab-on-hub-design.md` (L9). Reference
page: `/Users/billrahe/dev/ai-harness/LocalAI-needskit/app/public/print-lab*.js` and its `lab-`/`pl-` CSS in `app.css`.
Index producer: `/Users/billrahe/dev/print-lab/lab/page_index.py` (`build_index`) plus `colours`/`outside` from
`lab/sync.py`.

## Global Constraints

- Every dynamic value goes through `esc()` (text and attributes). Colours only if `^#[0-9a-fA-F]{6}$`, else `#8698b1`;
  photo URLs only from `sha256` matching `^[0-9a-f]{64}$`; no raw value in a selector or `style`.
- Fetches are relative, same-origin `/api/lab/...` only; never set `Origin`; read errors from `detail` (then `error`).
- Bambuddy links use the existing `toolUrl("bambuddy")` helper (as `home-cards.js`), `target="_blank" rel="noopener"`.
- Out of scope (rulings): the live printer/camera view (L8 keeps telemetry on Local AI); an observation-correction UI
  (Local AI has none); the "how the lab works" guide; moving the Workshop link to `/lab` (owner decides after comparing).
- Service worker: bump `SHELL` in `hub/static/sw.js` once per task that changes static files (v102, v103, …), add any new
  static file to `FILES`, and update `tests/test_appliance_ui.py`'s pinned string in the same commit.
- No hard-coded amber colours (a test checks); use `tokens.css` variables.
- Tests: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests` and `node --test tests/*.mjs`, both
  green before each commit. Pure functions are exported from their module and tested in node with
  `tests/fixtures/lab-index.json` (a real-shape index; build it from `build_index` field names, include one run with a
  `print`, one with only `entered_on_mac`, two `outside` entries, `colours`, an answered and a printing experiment).
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The owner deploys (`git push pi main`).

## Review Focus

1. A filament name or print name containing `<img onerror>` or `"` → rendered as text everywhere, including the
   `--spine` style and `title`/`alt` attributes (Task 1).
2. Session expired while the page is open → the 15 s refresh doesn't pop a PIN sheet; the next tap does, then retries
   once (Task 2).
3. The phone sleeps with a request pending → no tight loop on wake; status catches up (Task 2).
4. An index from an older print-lab missing `outside`, `colours`, `runs[].print` → page renders, nothing throws (Task 1).
5. The 15 s refresh while a sheet is open or a `<details>` is expanded → nothing closes, scroll kept (Task 5).

---

### Task 1: Real data on the page

**Files:** `hub/static/js/lab.js`, `hub/static/lab.css`, `tests/fixtures/lab-index.json`, `tests/test_lab_page.mjs`,
`hub/static/sw.js`, `tests/test_appliance_ui.py`.

**Interfaces — Produces (exported from `lab.js`):** `esc(s)`, `questionHtml(q, ix)`, `experimentHtml(x, ix)`,
`runLines(x)`, `outsideHtml(list)`, `spoolColour(filament, colours) -> "#rrggbb"`, `needView(need, now)`.

- [ ] **Step 1: Failing tests** (`tests/test_lab_page.mjs`, fixture-driven): question card shows `q.question`, Time and
  Material meters from `budget`/`spent`, the stop line from `stop{kind,text}`; no output contains `undefined` or the old
  guessed fields; experiment meta shows `test_kind`/`factor`; `runLines` gives `from Bambuddy print #<id> ↗` for a
  linked run and an "entered on the Mac" line for a run with only `entered_on_mac`; run id shown only when more than one
  run; `outsideHtml([])` and `outsideHtml(undefined)` → `""`, a nameless entry → `Print #<n>`; `spoolColour` picks the
  longest matching colour name and rejects `red;background:url(x)`; hostile strings in filament, print name, note,
  tab → escaped; Accepted / Not good enough badge; defects, finding, AI reading lines; usage-source words; answered
  within 3 days stays in the notebook, older moves to Earlier; jump chips link to `#lab-sec-*` anchors that exist.
- [ ] **Step 2: Run** `node --test tests/test_lab_page.mjs` — FAIL.
- [ ] **Step 3: Implement** by porting Local AI's renderers (gap file section 0–1) and their CSS restyled on tokens.
- [ ] **Step 4: Run** both suites — PASS.
- [ ] **Step 5: Commit** — "lab page: the real index — runs and their prints, outside the lab, spool colours".

### Task 2: Sign-in, errors and one gentle poller

**Files:** create `hub/static/js/lab-net.js`; modify `lab.js`, `sw.js` (`FILES` + bump), `tests/test_appliance_ui.py`;
test `tests/test_lab_net.mjs`.

**Interfaces — Produces (`lab-net.js`):**
- `labFetch(path, opts = {}, {prompt = true} = {}) -> Promise<any>` — relative fetch, JSON; on 401 and `prompt`, calls
  `ensure("household")` from `core.js` once and retries once; 403 → throws `Error("Kids can't use the lab.")`; other
  non-OK → throws `Error(detail || error || "HTTP <code>")`; 404 from `GET /api/lab/<project>` → resolves `null`.
- `watchRequests(project, ids, onUpdate) -> stop()` — one `setTimeout` chain for all pending request ids: 1 s, ×1.5 up to
  10 s, back to 1 s when anything changes, paused while `document.hidden`, stops when none pending or after 10 min.
- [ ] **Step 1: Failing tests** (fake `fetch`, fake timers, stub `ensure`): 401 → one `ensure` call → one retry; second
  401 throws; `{prompt:false}` (used by the 15 s `load`) never calls `ensure`; 403 message; `detail` text surfaced;
  404 → `null` → the page's empty state ("No lab data yet"); poll intervals 1000, 1500, 2250 … capped at 10000; reset on
  change; no tick while hidden; stop after applied/refused; `leave()` stops it.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; replace the 500 ms verdict loop; verdict form matches Local AI (a "–" chip sent as `null`,
  lighting has no default and is required); a pending item older than 120 s says "The Mac hasn't picked this up yet".
- [ ] **Step 4: Run** both suites — PASS.
- [ ] **Step 5: Commit** — "lab page: sign in when needed, plain errors, one poll that backs off".

### Task 3: Start, approve, drop

**Files:** `lab.js`, `lab.css`, `tests/test_lab_page.mjs`, `tests/fixtures/lab-requests/*.json`,
`tests/test_lab_requests.py`, `sw.js`, `tests/test_appliance_ui.py`.

**Interfaces:** Consumes `labFetch`, `watchRequests`. Produces exported payload builders
`startRequest(x, now)`, `approveRequest(x, record, reason)`, `dropRequest(x, reason)` → `{id, kind, experiment, run?, run_seen?, payload}`.

- [ ] **Step 1: Failing tests:** node — each builder's output for the fixture equals the golden JSON in
  `tests/fixtures/lab-requests/{start,approve,abandon}.json` (with `id` and time injected); pytest — each golden file
  posted as household is 200 and `request_problem` returns None; a whitespace-only reason is refused by both the page
  (button disabled) and the server; needs-you buttons per `action` ("Judge the print" → Judge it + Add photos; "Send it
  to the printer" → It's printing now; "Approve or drop" → Approve + Drop); drop needs a second tap; buttons disabled
  while that experiment has a pending request.
- [ ] **Step 2–4:** FAIL → implement (approve sheet lists the guards from `GET /record/<id>`'s last build) → PASS.
- [ ] **Step 5: Commit** — "lab page: start, approve and drop from the phone".

### Task 4: Photos — viewer, compare, wipe, checklist

**Files:** create `hub/static/js/lab-photos.js`; `lab.js`, `lab.css`, `sw.js` (`FILES` + bump),
`tests/test_appliance_ui.py`; test `tests/test_lab_photos.mjs`.

**Interfaces:** Produces `photosOf(x)`, `runsOf(x)`, `thumbsHtml(x)`, `wipeHtml(x, ix)`, `mountPhotos(root, ix)`.

- [ ] **Step 1: Failing tests:** `thumbsHtml` shows 6 then "+n", tab labels escaped, skips non-hex SHAs; `runsOf`
  pairs by tab for compare; `wipeHtml` empty without `reference_variants`; checklist ticks survive a throwing
  `localStorage`.
- [ ] **Step 2–4:** FAIL → port `print-lab-photos.js` and the wipe from `print-lab-evidence.js` (viewer in a `<dialog>`,
  swipe/arrows/pinch/double-tap) → PASS.
- [ ] **Step 5: Commit** — "lab page: look at the photos properly — viewer, compare, wipe".

### Task 5: Observations and a quiet refresh

**Files:** create `hub/static/js/lab-observe.js`, `hub/static/js/lab-refresh.js`; `lab.js`, `lab.css`, `sw.js`,
`tests/test_appliance_ui.py`; tests `tests/test_lab_observe.mjs`, `tests/fixtures/lab-requests/observation.json`,
`tests/test_lab_requests.py`.

**Interfaces:** Produces `snapshots(form, x) -> list`, `observationRequest(x, snaps, id)`, `snapshot(root)`/`restore(root, s)`.

- [ ] **Step 1: Failing tests:** golden observation payload accepted by the server (pytest) and produced by the
  builder (node); a retry re-sends the same id and snapshots; the draft survives a throwing `localStorage`; the page
  skips re-render when `GET /api/lab/projects`' `fingerprint` is unchanged or a `<dialog>` is open; `restore` keeps
  open `<details>` (Earlier included — give it an id), scroll position and focused element; changed cards get a
  `lab-changed` flash.
- [ ] **Step 2–4:** FAIL → port `print-lab-observe.js` and `print-lab-refresh.js` → PASS.
- [ ] **Step 5: Commit** — "lab page: record what happened; refresh without losing your place".
- [ ] **Step 6: Stop.** The owner deploys and compares `/lab` with Local AI's Print lab side by side.
