# One Home, Step 5: One Look — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi Hub and Local AI share the appliance-ui kit's colours, type and components, after the kit's contrast and notch fixes, so the two front doors look like one product.

**Architecture:** Three repos. **appliance-ui** (`~/dev/appliance-ui`) gets 1.1.0: a wider contrast gate (tinted chips, the danger button and the badge at 4.5:1; field borders at 3:1), darker light-mode status colours, a `fieldLine` token, and `--ui-header-total`. Each app takes a synced copy of `dist/` (its tests fail if the copy is edited) and maps its own colour variables onto `--ui-*`, so existing CSS keeps working while the values come from the kit. **Pi Hub** moves off its amber/paper palette (only the printer band keeps amber) and gets a styled signed-out Scan page. **Local AI** (dark only) maps `--ds-*` onto `--ui-*`.

**Tech Stack:** appliance-ui: Node build + `node --test`. Pi Hub: FastAPI, CSS, pytest, `node --test`, Playwright structure check (axe incl. colour contrast). Local AI: `npm test`, browser suites incl. `visual` and `axe`, local CI, `npm run ship` (the owner runs ship; the classifier blocks it for Claude).

**Spec:** `docs/superpowers/specs/2026-10-24-one-home-design.md` ("Look"; D9; rollout item 5).

## Global Constraints

- Kit first: "Light-mode chip, danger-button, badge and field-border contrast, with the contrast gate extended to cover them" and "`--ui-header-total`, including the notch."
- "Then: Pi Hub moves to the kit's tokens and components; its printer band keeps one accent." Local AI "adopts the appliance-ui kit."
- Bug fixes on the way: "the X2D named correctly" (done in step 2) and "a styled signed-out page for scan".
- Change a colour only in `appliance-ui/tokens.json`, never in an app's copy; bump the kit version (minor: new variables) and sync.
- WCAG AA: text 4.5:1 (normal size), non-text UI boundaries 3:1.
- Pi Hub releases by `git push pi main`; Local AI by PR → local CI → owner's `npm run ship -- <PR>`.

## Rulings in this plan (for the owner's review)

- **No `<appliance-header>` in Pi Hub or Local AI.** The kit's shared top bar links the four apps; one home made Pi Hub's menu the front door and replaced Local AI's bar with "← Home" (step 4). Both apps take the kit's tokens and components only. The header stays in the kit for the Workshop display and others; the shared-look plan's header tasks for these two apps are marked superseded.
- **Local AI stays dark.** It has no light theme; its page sets `data-theme="dark"` so the kit's light values never apply there.
- **Exact light values** (each passes the wider gate on both backgrounds): ok `#126a45`, warn `#815300`, bad `#b02a20`, unknown `#505c6b`; `fieldLine` light `#7f8b9b`, dark `#5b6c82`. Dark values stay.
- **The old uncommitted kit work** in `~/dev/ai-harness/LocalAI-ui` (header-based, on a 10-day-old main) is left untouched as a reference; Task 4 starts from current `origin/main`.
- **appliance-ui commits go to its `main` and are pushed** (as 1.0.0 and 1.0.1 were).

## Review Focus

1. **Light mode on the phone:** every Pi Hub page at 390 px in light mode passes axe colour contrast — the hub's chips, pills and status dots now draw from darker status colours. → Task 2 (browser structure check, light).
2. **The printer band in both themes:** amber stays readable (4.5:1 for its text) on the band's own background after the page background changes. → Task 2.
3. **An app that edits its kit copy:** `verify.py` / `verify.mjs` fails, and so does the app's test suite. → Tasks 2 and 4.
4. **Local AI on a phone set to light mode:** stays dark (no white text on white). → Task 4.
5. **Signed-out Scan inside the Documents page's frame:** the styled page fits a 390 px iframe without sideways scroll, and its link opens the hub at the top (`target="_top"`). → Task 3.

---

### Task 1: appliance-ui 1.1.0 — wider contrast gate, darker light status colours, `fieldLine`, `--ui-header-total`

**Files:** Modify `scripts/build.mjs`, `tokens.json`, `src/components.css` (`.ui-field` border), `src/appliance-header.js` (no change expected; its badge is a warn chip), `README.md` (values table); Test `tests/build.test.mjs`, `tests/components.test.mjs`.

**Interfaces:**
- Produces: tokens `--ui-field-line`; `--ui-header-total: calc(var(--ui-header-h) + env(safe-area-inset-top, 0px))` on `:root`; kit version `1.1.0`.
- Gate: for each mode, `ok|warn|bad|unknown` on `mix(c, bg|surface, 18%)` ≥ 4.5 (chips and the header badge); `bad` on `mix(bad, bg|surface, 16%)` ≥ 4.5 (danger button); `fieldLine` against `bg` and `surface` ≥ 3.0. `mix` is sRGB-linear interpolation of the hex channels, like CSS `color-mix(in srgb, …)` over an opaque background.

- [ ] **Step 1: Failing tests** (`tests/build.test.mjs`): building with today's light values exits non-zero and names `light bad chip on bg` (3.69) and `light fieldLine on bg`; building with the plan's values exits 0; `dist/tokens.css` contains `--ui-field-line:` in both modes and `--ui-header-total:calc(var(--ui-header-h) + env(safe-area-inset-top, 0px))`. (`tests/components.test.mjs`): `.ui-field{…border:1px solid var(--ui-field-line)`.
- [ ] **Step 2: Run** `npm test` → FAIL.
- [ ] **Step 3: Implement**; set the values in Rulings; version `1.1.0`; README table lists the four light changes and `fieldLine`.
- [ ] **Step 4: Run** `npm test` → PASS; regenerate `demo/screens/` if the repo's test or README says so.
- [ ] **Step 5: Commit** `1.1.0: chips, danger button, badge and field borders pass contrast in light mode; --ui-header-total`; push `main`.

### Task 2: Pi Hub on the kit

**Files:** Create `hub/static/ui/*` (via `node ~/dev/appliance-ui/scripts/sync.mjs ~/dev/pi-hub --dir hub/static/ui`), `tests/test_appliance_ui.py`. Modify `hub/static/index.html` (load `/static/ui/tokens.css` and `/static/ui/components.css` before `app.css`), `hub/static/app.css` (the `:root`, dark and `[data-theme]` colour blocks alias the kit: `--bg: var(--ui-bg)`, `--bg-elev: var(--ui-bg)`, `--surface: var(--ui-surface)`, `--surface-2: var(--ui-surface)`, `--surface-3: var(--ui-surface-2)`, `--line: var(--ui-line)`, `--line-strong: var(--ui-line-2)`, `--text: var(--ui-text)`, `--text-2: var(--ui-muted)`, `--text-3: var(--ui-muted)`, `--accent: var(--ui-accent)`, `--accent-strong: var(--ui-accent-text)`, `--accent-soft: var(--ui-accent-soft)`, `--on-accent: var(--ui-on-accent)`, `--ok: var(--ui-ok)`, `--warn: var(--ui-warn)`, `--danger: var(--ui-bad)`, `--font-sans: var(--ui-font)`; `--glow` built from `--accent-soft`), every other amber literal in `hub/static/*.css` replaced by a variable, the printer band (`.band`) uses `--band-accent` (light `#b26a00`, dark `#f5b04a`) — the one place amber stays — and `hub/static/sw.js` (SHELL lists the four `/static/ui/` files; `pi-hub-shell-v87` → `v88`).

- [ ] **Step 1: Failing test** `tests/test_appliance_ui.py`: `verify.py hub/static/ui` exits 0; `index.html` links `/static/ui/tokens.css` and `/static/ui/components.css` before `/static/app.css`; outside the `--band-accent` declarations, no `hub/static/*.css` contains `#b26a00`, `#8f5300`, `#f5b04a`, `#ffc670`, `178,106,0` or `245,176,74` (spaces ignored); `sw.js` contains `/static/ui/tokens.css` and `pi-hub-shell-v88`; editing a byte of `hub/static/ui/tokens.css` in a temp copy makes `verify.py` exit non-zero.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_appliance_ui.py -q` → FAIL.
- [ ] **Step 3: Sync and implement.**
- [ ] **Step 4: Run** `node --test tests/*.mjs` and `.venv/bin/python -m pytest -q` → PASS. Release to the Pi (`git push pi main`), then `node tests/browser/structure.mjs http://10.0.0.30` → all 24 views pass (390/1440, light/dark, axe). Screenshot Home and Workshop at 390 light and 1440 dark for the owner; check the band's amber text by eye and by axe.
- [ ] **Step 5: Commit** `hub: the appliance-ui look (kit 1.1.0); amber only on the printer band`.

### Task 3: Pi Hub — a styled signed-out Scan page

**Files:** Modify `hub/app.py` (`scan_proxy`'s signed-out response, ~line 1075). Test `tests/test_documents.py`.

**Interfaces:** Produces: signed out, `GET /scan/` → 401 HTML: `<!doctype html>`, `lang="en"`, viewport meta, `<link rel="stylesheet" href="/static/ui/tokens.css">` and `components.css`, `<h1>Scan needs the household PIN</h1>`, a `ui-btn ui-btn--primary` link "Sign in to Pi Hub" to `/settings` with `target="_top"`, and the body on `var(--ui-bg)` with 16 px gutters.

- [ ] **Step 1: Failing test** `test_scan_signed_out_page_is_styled`: status 401, `text/html`, the `<h1>` text, both stylesheet links, `target="_top"`, and no `Open Pi Hub` (the old wording).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** the suite → PASS; after release, load `/scan/` signed out at 390 px: no sideways scroll, axe clean.
- [ ] **Step 5: Commit** `hub: a styled signed-out page for Scan`.

### Task 4: Local AI on the kit (dark)

**Files (branch `feat/kit-look` from `origin/main` in `~/dev/ai-harness/LocalAI`):** Create `app/public/ui/*` (sync `--dir app/public/ui`), `tests/appliance-ui.test.cjs`. Modify `app/public/index.html` (`<html … data-theme="dark">`; load `/ui/tokens.css` and `/ui/components.css` before `/app.css`), `app/public/app.css` (in the `--ds-*` block: `--ds-bg: var(--ui-bg)`, `--ds-surface: var(--ui-surface)`, `--ds-surface-2: var(--ui-surface-2)`, `--ds-line: var(--ui-line)`, `--ds-line-2: var(--ui-line-2)`, `--ds-line-input: var(--ui-field-line)`, `--ds-text: var(--ui-text)`, `--ds-muted: var(--ui-muted)`, `--ds-accent: var(--ui-accent)`, `--ds-accent-text: var(--ui-accent-text)`, `--ds-accent-ink: var(--ui-on-accent)`, `--ds-accent-soft: var(--ui-accent-soft)`, `--ds-good: var(--ui-ok)`, `--ds-bad: var(--ui-bad)`, `--ds-attention: var(--ui-warn)`, `--ds-font: var(--ui-font)`; other `--ds-*` keep their values), `app/public/sw.js` (SHELL lists `/ui/*`; cache name suffix `-kit1`), `tests/budgets.test.cjs` (new total = measured, dated comment), visual baselines.

- [ ] **Step 1: Failing test** `tests/appliance-ui.test.cjs`: `node app/public/ui/verify.mjs app/public/ui` exits 0; `index.html` has `data-theme="dark"` on `<html>` and loads `/ui/tokens.css` before `/app.css`; `sw.js` SHELL includes `/ui/tokens.css`; `app.css` sets `--ds-bg:var(--ui-bg)`.
- [ ] **Step 2: Run** `npm test` → FAIL. **Step 3: Sync and implement.**
- [ ] **Step 4: Run** `npm test`; throwaway server; `node tests/run-browser.mjs axe a11y-sweep mobile layout home` → PASS; with `colorScheme: 'light'` emulated, Home's background is the dark `--ui-bg` (Review Focus 4); refresh visual baselines (`LOCALAI_VISUAL_UPDATE=1`, keep only the ones that changed, look at home-phone and work-desktop by eye) → `visual` PASS; then all suites.
- [ ] **Step 5: Commit**, open the PR with before/after screenshots, run `npm run ci -- <PR>`; when green, hand the owner `npm run ship -- <PR>`.

### Task 5: Close out

- [ ] **Step 1:** In `~/dev/appliance-ui`: `node scripts/sync.mjs --status ~/dev/pi-hub:hub/static/ui ~/dev/ai-harness/LocalAI:app/public/ui` → both `1.1.0`. Mark the shared-look plan's Tasks 5 and 7 "superseded by Pi Hub one-home step 5 (no header)" with one line each.
- [ ] **Step 2:** After the owner ships Local AI: `curl -s https://10.0.0.21/healthz` → `releaseCommit` = the merge; screenshot both Homes side by side (phone, dark).
- [ ] **Step 3:** `docs/status.md` Step 5 section; commit `docs: step 5 (one look) live`.
