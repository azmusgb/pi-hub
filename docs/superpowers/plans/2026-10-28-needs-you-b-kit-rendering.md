# One Needs you, Plan B: one kit renderer for Needs you — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Needs you item looks and behaves the same in Pi Hub (Home card, wall, desk) and Local AI (Home), because
both draw it with one appliance-ui kit renderer and one stylesheet, from one item shape, with one phrase table.

**Architecture:** Kit 1.3.0 adds `src/needs.js` (classic IIFE → `window.ApplianceNeeds`, plus `module.exports` for
Node) and `src/needs.css` (`.ui-needs`/`.ui-need`, kit tokens only), built into `dist/` and synced into both apps.
Pi Hub (ES modules, already loads kit CSS) loads `ui/needs.css` and `ui/needs.js` and swaps its two Needs you list
renderers for `ApplianceNeeds.renderList`. Local AI (classic scripts, one stylesheet, near its size budget) loads only
`ui/needs.css` + `ui/needs.js`, maps `--ui-*` to its existing `--ds-*` in a short alias block, and renders Home's Needs
you rows with the same renderer.

**Tech Stack:** Node (kit build, `node:test`, Playwright for DOM tests), Python/pytest + ES modules (Pi Hub), Node
classic scripts + Playwright (Local AI).

**Spec:** `/Users/billrahe/dev/pi-hub/docs/superpowers/specs/2026-10-27-one-needs-you-design.md` (N2, N3, N4;
"The item shape", "The kit renderer", "Rendering").

## Global Constraints

- Item shape: `{id, source, tone: "bad"|"attention"|"warn", title (≤80), detail (≤200), link?, action?: {key, link},
  urgent?, as_of?}`. `action.key` is a phrase key; the renderer supplies the words.
- Phrase table (in `needs.js`, exported as `PHRASES`): `judge` "Judge the print", `approve` "Approve or drop", `send`
  "Send it to the printer", `fix_plan` "Fix the plan", `look` "Look at the printer", `open_bambuddy` "Open Bambuddy",
  `check_pc` "Check the PC", `not_answering` "{name} isn't answering"; empty state "Nothing needs you right now."
- Tokens: tone stripe `bad` → `--ui-bad`, `attention` → `--ui-warn`, `warn` → `--ui-muted`; text `--ui-text`, detail
  `--ui-muted`, card `--ui-surface`. These pairs are already in the kit's contrast gate at 4.5:1 (build.mjs `PAIRS`);
  `needs.css` may use no other colour and no literal hex.
- Renderer link rule: `opts.resolve(link)` (the app's resolver) runs first; the result is kept only if it is a
  same-origin path, a `#…` hash, or an `https:`/`http:` URL the resolver produced; anything else renders without a
  link. "↗" (and `target="_blank" rel="noopener"`) when the resolved origin differs from the page's.
- Text only via `textContent`; never `innerHTML` with item data.
- Kit version 1.3.0 (minor: a new component), set in `tokens.json` and `package.json`; it includes 1.2.1's `suite.json`
  change. Sync into Pi Hub (`hub/static/ui`) and Local AI (`app/public/ui`) only.
- **Ruling (Local AI budget/one-stylesheet):** Local AI does not load the kit's `tokens.css`/`components.css`; it loads
  `ui/needs.css` and `ui/needs.js` only, and `app.css` gains `--ui-bad/warn/muted/text/surface/line/fs-1/fs-2` aliases
  onto its `--ds-*` values (already equal to the kit's dark values). `tests/budgets.test.cjs` `TOTAL` rises by the
  measured gzip size of the two files (rounded up to the next KB) with a dated comment; `tests/design-system-ui.mjs`'s
  "one stylesheet" check allows exactly `/ui/needs.css` as a second sheet.
- Pi Hub deploys are the owner's (`git push pi main`); Local AI ships by PR + `npm run ship` (the owner runs it);
  never push `main`/`release` directly.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A title or detail with `<script>` or markup → shown as text, nothing executes (Task 1 test).
2. A link the resolver can't place (`javascript:`, `data:`, another host) → the item renders without a link (Task 1).
3. More items than fit (wall shows 5, Home card 4, Local AI 3 + "See all") → the same caps and "more" link as today
   (Tasks 2 and 3 tests).
4. Zero items → "Nothing needs you right now." in both apps (Tasks 2 and 3).
5. Light and dark themes in Pi Hub and Local AI's dark theme → stripe and text readable; no new colours (Task 1
   test that `needs.css` uses only gated tokens; browser screenshots in Tasks 2–3).

---

### Task 1: Kit 1.3.0 — `needs.js`, `needs.css`, build, tests

**Repo:** `/Users/billrahe/dev/appliance-ui` (branch `feat/needs`).

**Files:** Create `src/needs.js`, `src/needs.css`, `tests/needs.test.mjs` (Node: `PHRASES`, link rule as pure
functions), `tests/needs-dom.test.mjs` (Playwright, like `tests/header.test.mjs`, with
`tests/fixtures/needs.html`). Modify `scripts/build.mjs` (write `dist/needs.js` and `dist/needs.css` after
`components.css`, ~line 79), `tokens.json` and `package.json` (1.3.0), `README.md` (one paragraph on the component),
`tests/components.test.mjs` (extend the "no literal hex" check to `needs.css`).

**Interfaces (Produces):**
- `window.ApplianceNeeds = {render, renderList, PHRASES, safeLink}` and the same object as `module.exports` when
  `module` exists.
- `safeLink(link: string|null, {resolve, here: URL}) -> {href, external: bool} | null` (pure; Node-testable).
- `render(item, {resolve, here, doc = document}) -> HTMLElement`: `<li class="ui-need" data-tone>` containing an
  `<a class="ui-need__link">` (when a safe link exists) or a `<div>`, with `<strong class="ui-need__title">`,
  `<span class="ui-need__detail">`, optional `<span class="ui-need__action">` (phrase for `action.key`, "↗" when
  external), and `<span class="ui-need__meta">` with the source when `source` isn't the page's own app (`opts.self`).
- `renderList(items, {resolve, here, self, max, more: {href, label} | null, empty, doc}) -> HTMLElement`:
  `<ul class="ui-needs">`; at most `max` items, then a `<li class="ui-needs__more"><a>` when `more` is given and items
  remain; zero items → `<p class="ui-needs__empty">` with `empty` or the default phrase.
- `needs.css`: `.ui-needs`, `.ui-need` (4 px left stripe by `data-tone`, 44 px min height, title wraps, detail muted
  `--ui-fs-2`, meta `--ui-fs-1`, action right on ≥ 600 px and below text under 600 px), `.ui-needs__more`,
  `.ui-needs__empty`. Tokens per Global Constraints only.

- [ ] **Step 1: Failing tests:** Node — `PHRASES` has the eight keys and texts; `safeLink` keeps `/workshop`,
  `#printLab?e=E-1`, a resolver-produced `https://bambuddy.home.arpa/` (external true), and drops `javascript:x`,
  `data:x`, `//evil.com`, `https://evil.com` when the resolver didn't produce it. DOM (Playwright) — title with
  `<script>` renders as text; tone sets `data-tone`; external link gets "↗", `target=_blank`, `rel=noopener`;
  `renderList` caps at `max` and adds the more link; empty list shows "Nothing needs you right now."; build writes
  `dist/needs.js` and `dist/needs.css`; `needs.css` has no literal hex and only `var(--ui-…)` colours from the gated set.
- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement** the files and build lines; bump to 1.3.0.
- [ ] **Step 4: Run** `npm test` — PASS (build + contrast gate + all tests).
- [ ] **Step 5: Commit** — "1.3.0: Needs you renderer and styles (needs.js, needs.css)". Stop; the controller syncs.

### Task 2: Pi Hub renders Needs you with the kit

**Repo:** `/Users/billrahe/dev/pi-hub` (branch `feat/needs-kit`).

**Files:** Sync: `node ~/dev/appliance-ui/scripts/sync.mjs ~/dev/pi-hub --dir hub/static/ui`. Modify
`hub/static/index.html` (after `ui/components.css` line ~87: `<link rel="stylesheet" href="/static/ui/needs.css">`;
before the module scripts ~498: `<script src="/static/ui/needs.js"></script>`), `hub/static/sw.js` (precache the two
files), `hub/static/js/now.js` (`homeCard`'s needs list ~360–370 and `renderWallNeeds` ~303/387 use
`ApplianceNeeds.renderList` with `resolve: resolveLink`, `self: "Pi Hub"`, Home `max: 4`, wall `max: 5`, the existing
"N more on Home" link as `more`), `hub/static/home.css` (remove the now-unused `.home-card-items`/`.wall-needs-list`
item rules only where `.ui-need` replaces them), `tests/test_appliance_ui.py` (page loads `tokens.css` <
`components.css` < `needs.css` < `app.css`), `tests/browser/wall.mjs` (selectors `.ui-need`).

**Interfaces:** Consumes Task 1's `window.ApplianceNeeds.renderList`. Item fields from `/api/needs` stay as today
(`link` is used; `action` is absent until Plan C — the renderer handles both).

- [ ] **Step 1: Failing tests:** `test_the_page_loads_the_kit_before_its_own_styles` extended to `needs.css`;
  `test_needs_js_is_a_classic_script_before_the_modules`; kit copy verify passes at 1.3.0; browser `wall.mjs` asserts
  `.wall-needs .ui-need` count ≤ 5 with the more link, an empty state, and a `tool:` link resolving to the gate address.
- [ ] **Step 2: Run** pytest and `node --test tests/*.mjs` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** pytest, `node --test tests/*.mjs`, and `cd tests/browser && node wall.mjs http://127.0.0.1:8765 --stub`
  against a local hub (README) — PASS; view `tests/browser/out/after-ipad-land.png` and one dark screenshot.
- [ ] **Step 5: Commit** — "Needs you drawn by the kit renderer (Home card, wall, desk)".

### Task 3: Local AI renders Home's Needs you with the kit

**Repo:** worktree `/Users/billrahe/dev/ai-harness/LocalAI-needs` from `origin/main` (branch `feat/needs-kit`).

**Files:** Sync: `node ~/dev/appliance-ui/scripts/sync.mjs <worktree> --dir app/public/ui`. Modify
`app/public/index.html` (`<link rel="stylesheet" href="/ui/needs.css">` after `/app.css`; `<script src="/ui/needs.js">`
before `needs-you.js`), `app/public/app.css` (the `--ui-*` alias block per Global Constraints, next to the `--ds-*`
`:root` at ~761), `app/public/home.js` (`paintNeeds` ~154: build items for every row — hub items as they come; Local
AI's own attention rows and failed runs mapped to `{id, source: "Local AI", tone, title, detail, link: "#…"}` — and
render with `ApplianceNeeds.renderList({max: 3, more: {href: "#work?kind=needs", label: "See all N"}, self: "Local
AI", resolve})`, where `resolve` keeps `#…` and maps hub paths through the existing `homeUrl`), `tests/budgets.test.cjs`
(TOTAL per the ruling), `tests/design-system-ui.mjs` (allow `/ui/needs.css`), `tests/home-ui.mjs` (selectors).
Confirm `/ui/…` is served (check `app/server.js` static routing; add the path if not).

**Interfaces:** Consumes Task 1's renderer; `needs-you.js` (`pick`, `group`, `hubRows`) keeps choosing *which* rows;
only drawing changes.

- [ ] **Step 1: Failing tests:** `home-ui.mjs` — Needs you rows are `.ui-need`; hub item navigates to
  `http://10.0.0.30/workshop` as today; "See all N" appears past 3; empty state text; the "Pi Hub"/"Print lab" source
  label shows. `appliance-ui.test.cjs` — kit copy at 1.3.0 verifies; `--ui-*` aliases equal the kit's dark values.
  `design-system-ui.mjs` — exactly `/app.css` and `/ui/needs.css`. Budgets — pass with the dated increase.
- [ ] **Step 2: Run** `npm test` and the throwaway-server browser run (CLAUDE.md) — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — PASS.
- [ ] **Step 5: Commit** — "Home: Needs you drawn by the kit renderer"; push the branch and open a PR titled "Home:
  Needs you looks the same as Pi Hub's". Stop for the owner's `npm run ship -- <PR>`.
