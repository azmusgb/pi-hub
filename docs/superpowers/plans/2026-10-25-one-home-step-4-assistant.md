# One Home, Step 4: Assistant — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The hub's Assistant button hands the current page and its key facts to Local AI, which opens on its Assistant (composer and recent work) with that context, shows readable titles in Recent, and links back to the hub.

**Architecture:** Two repos. **Pi Hub** (`~/dev/pi-hub`, main, released by `git push pi main`) builds the hand-off link at click time from the open page's facts, and greys the button out when its status service says Local AI is down. **Local AI** (`~/dev/ai-harness/LocalAI`, branch `feat/assistant-handoff` off `origin/main`, PR, live only via `npm run ship -- <PR>`) reads `context` from `#ask?context=…` (the router already rewrites `#ask` to `#home?mode=ask`), shows it as a context line over the composer and sends it with the next request; Home drops its printer line and the Hub/Terminal/Materials bar becomes "← Home"; run cards get readable titles.

**Tech Stack:** Pi Hub: FastAPI, vanilla ES modules, pytest (`.venv/bin/python -m pytest`), `node --test tests/*.mjs`. Local AI: Node, UMD browser scripts (`(function(root){…})(window)` + `module.exports`), `npm test` (`tests/*.test.cjs`), browser suites `tests/*-ui.mjs` via Playwright against a fresh server.

**Spec:** `docs/superpowers/specs/2026-10-24-one-home-design.md` (sections "Assistant hand-off", "Local AI changes", "Testing"; rollout item 4).

## Global Constraints

- Hand-off URL: `https://assistant.home.arpa/#ask?context=<page and key facts>`; off the `home.arpa` names, the hub's existing `toolUrl("assistant")` base (`https://10.0.0.21/`) with the same `#ask?context=…`.
- Local AI fills the composer's context line from that parameter, **escaped, at most 300 characters**.
- When Local AI doesn't answer, the button reads **"The PC is off"** and is disabled.
- Local AI opens on the Assistant (composer and recent work), not a house dashboard; its house cards move to the hub (the hub already shows the printer).
- Its Hub/Terminal/Materials bar is replaced by **"← Home"** (to `home.home.arpa`).
- Recent shows a readable title per run (a summary field or the run kind's name), never raw prompt text.
- Its System section covers Local AI itself (models, PC).
- Local AI workflow: PR → local tests and browser suites on a fresh server (empty `DATA_DIR`) → `npm run ship -- <PR>` (local CI, merge, move `release`). GitHub Actions don't run. Keep `index.html`'s script list, `sw.js` SHELL and `tests/frontend-scripts.test.cjs` in step. Never push to `main` or `release` directly.
- Pi Hub: bump `sw.js` SHELL (`pi-hub-shell-v85` → `v86`) when static files change.

## Rulings in this plan (for the owner's review)

- **Readable titles:** a run's card title is, in order: a label the caller gave (`meta.label`; new `title` field on `/api/chat`), else the run's own title when it reads like a title (one line, at most 60 characters: "Plan the garden", "Hourly Stack & ComfyUI Health Check"), else the kind's name ("Chat", "Research", "Image", "Mission", "Spreadsheet", "Change", "Automation"). The owner's own short questions stay as their titles; long prompts like the hub's "You are the voice of a family's home hub…" (74 of the last 200 runs) become "Chat", and the hub labels its new ones "House question". `run.title` itself is unchanged, so grouping in Needs you is unaffected.
- **System section:** it already covers Local AI itself (Health, Models, Services, Tools, Audit log). Services lists what Local AI connects to, including the Workshop display it is paired with, so it stays. No task beyond removing Home's link into it.
- **Out of scope:** Recent showing eight runs of the hourly health check is a grouping question, not a title one; it is listed for later.

## Review Focus

1. **Hostile or huge context:** `context=<img src=x onerror=alert(1)>` or 5 000 characters shows as plain text, cut to 300 (ending "…"), never as markup. → Task 4.
2. **Context goes once:** after sending (or tapping ×), the line disappears, `context` leaves the address, and a reload doesn't bring it back; the person's question is the run's title, not the context. → Task 4.
3. **"Unknown" isn't "off":** when the Pi's status service can't tell (state "Unknown" or no answer), the button stays usable; only "Down" disables it. → Task 2.
4. **Facts from a page that failed to load:** the button still works and sends the page name alone, never "undefined" or a stale page's facts. → Task 1.
5. **"← Home" off the home.arpa names:** at `https://10.0.0.21` (the iPhone's paired address) it goes to `http://10.0.0.30/`, which works without the new DNS. → Task 5.

---

### Task 1: Pi Hub — the hand-off link carries the page and its facts

**Files:**
- Modify: `hub/static/js/sections.js`, `hub/static/js/main.js` (Assistant links, ~line 23), `hub/static/js/now.js`, `hub/static/js/workshop.js`, `hub/static/js/network.js`, `hub/static/js/system.js` (each sets `state.facts` in `load`)
- Test: `tests/test_sections.mjs`

**Interfaces:**
- Produces: `assistantHref(host: string, title: string, facts?: string) -> string` in `sections.js`: `toolUrl("assistant", host) + "#ask?context=" + encodeURIComponent(text)` where `text = "Pi Hub › " + title + (facts ? ": " + facts : "")`, whitespace collapsed, cut to 300 characters (last character "…" when cut). Pages set `state.facts` (string) at the end of a successful `load`: Home → the summary line's text; Workshop → `d.printer.headline`; Home & network → the internet headline (`plainInternet(...)`); System → the backups line. `main.js` sets each Assistant link's `href` on `pointerdown`/`focus`/`click` from the current page's title and `state.facts` (cleared to `""` when a load fails or the page changes).

- [ ] **Step 1: Write the failing tests** (`tests/test_sections.mjs`):

```js
test('assistantHref carries the page and its facts', () => {
  assert.equal(assistantHref('home.home.arpa', 'Workshop', 'Printing, 40% · done 3:10 PM'),
    'https://assistant.home.arpa/#ask?context=' + encodeURIComponent('Pi Hub › Workshop: Printing, 40% · done 3:10 PM'));
  assert.equal(assistantHref('10.0.0.30', 'Home'), 'https://10.0.0.21/#ask?context=' + encodeURIComponent('Pi Hub › Home'));
});
test('assistantHref keeps the context to 300 characters', () => {
  const ctx = decodeURIComponent(assistantHref('home.home.arpa', 'System', 'x'.repeat(1000)).split('context=')[1]);
  assert.equal(ctx.length, 300);
  assert.ok(ctx.endsWith('…'));
});
test('assistantHref never sends "undefined"', () => {
  assert.ok(!assistantHref('home.home.arpa', 'Media', undefined).includes('undefined'));
});
```

- [ ] **Step 2: Run** `node --test tests/*.mjs` — Expected: FAIL (`assistantHref` is not exported).
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run** `node --test tests/*.mjs` and `.venv/bin/python -m pytest -q` — Expected: all pass.
- [ ] **Step 5: Commit** `hub: the Assistant button hands Local AI the page and its key facts`.

### Task 2: Pi Hub — "The PC is off"

**Files:**
- Modify: `hub/app.py` (new `GET /api/assistant`), `hub/static/js/sections.js`, `hub/static/js/main.js`, `hub/static/sw.js` (SHELL `v86`)
- Test: `tests/test_now.py`, `tests/test_sections.mjs`

**Interfaces:**
- Produces:
  - `GET /api/assistant` → `{"state": "Ready" | "Busy" | "Down" | "Unknown"}` from `sources.pi_status()["ai_state"]` ("Unknown" when the status service doesn't answer). No sign-in needed (it's the same fact `/api/now` shows).
  - `assistantButton(state: string) -> {label: string, disabled: boolean}` in `sections.js`: `"Down"` → `{label: "The PC is off", disabled: true}`; anything else → `{label: "Assistant", disabled: false}`.
  - `main.js` checks on start and every 60 s; a disabled link gets `aria-disabled="true"`, loses its `href`, and its visible label and `aria-label` read "The PC is off".

- [ ] **Step 1: Write the failing tests:** pytest `test_assistant_state_follows_the_status_service` (monkeypatch `sources.pi_status` → `{"ai_state": "Down"}` → `{"state": "Down"}`; → `None` → `{"state": "Unknown"}`); node `assistantButton('Down')` → `{label: 'The PC is off', disabled: true}`, `assistantButton('Unknown')` and `assistantButton('Ready')` → enabled "Assistant".
- [ ] **Step 2: Run** both suites — Expected: FAIL (404; not exported).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both suites — Expected: all pass.
- [ ] **Step 5: Commit** `hub: the Assistant button says "The PC is off" when Local AI is down`.

### Task 3: Pi Hub — its questions to Local AI carry a title

**Files:** Modify `hub/ask.py` (`ask`, the JSON body); Test `tests/test_now.py` or a new `tests/test_ask.py`.

**Interfaces:** Produces: the `/api/chat` body gains `"title": "House question"`.

- [ ] **Step 1: Write the failing test** `test_ask_labels_its_chat`: monkeypatch `urllib.request.urlopen` to capture the request; assert `json.loads(req.data)["title"] == "House question"` and the reply text comes back.
- [ ] **Step 2: Run** — Expected: FAIL (`KeyError: 'title'`).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `.venv/bin/python -m pytest -q` — Expected: all pass.
- [ ] **Step 5: Commit** `hub: label the hub's questions to Local AI "House question"`.

### Task 4: Local AI — the context line

**Files:**
- Create: `app/public/ask-context.js` (UMD: `window.LocalAIAskContext`, `module.exports`)
- Modify: `app/public/home.js` (`fromHash`, `send`), `app/public/index.html` (a `#homeContext` line inside `#homeComposer` above `.home-composer__box`, and the script tag before `home.js`), `app/public/sw.js` (SHELL), `app/public/app.css` (`.home-context`)
- Test: `tests/ask-context.test.cjs`, `tests/home-ui.mjs`

**Interfaces:**
- Produces:
  - `clean(raw: unknown) -> string`: control characters removed, whitespace collapsed, trimmed, at most 300 characters (cut ones end with "…"); `""` for anything empty.
  - `withContext(text: string, ctx: string) -> string`: `text` when `ctx` is empty, else `` `${text}\n\nContext: ${ctx}` ``.
  - Home: on activate, `clean(query.get('context'))`; non-empty → `#homeContext` shows "Context: <ctx>" (set with `textContent`) and a × button ("Remove the context"); `send()` passes `withContext(text, ctx)` to `dispatch` but keeps the title from `text` alone; once a send starts, or on ×, the line hides and `context` is removed from the hash with `history.replaceState` (other query keys kept).

- [ ] **Step 1: Write the failing tests:**

```js
// tests/ask-context.test.cjs
test('clean keeps plain text, at most 300 characters', () => {
  assert.equal(clean('  Pi Hub ›  Workshop:\nPrinting\u0007 40% '), 'Pi Hub › Workshop: Printing 40%');
  const long = clean('x'.repeat(5000)); assert.equal(long.length, 300); assert.ok(long.endsWith('…'));
  assert.equal(clean(null), ''); assert.equal(clean('   '), '');
});
test('withContext adds the context after the question', () => {
  assert.equal(withContext('Why is it slow?', ''), 'Why is it slow?');
  assert.equal(withContext('Why is it slow?', 'Pi Hub › Home & network: Internet slow'), 'Why is it slow?\n\nContext: Pi Hub › Home & network: Internet slow');
});
```

In `tests/home-ui.mjs` add checks: opening `/#ask?context=<img src=x onerror=window.__x=1>` shows `#homeContext` whose text contains `<img` literally, no `img` element inside it, and `window.__x` undefined; the mode chip reads Chat; sending "Why?" posts a body whose prompt ends with `Context: <img …>` (intercept the starter request), the pending run's title is "Why?", the line hides and `location.hash` no longer contains `context`; × hides it without sending.

- [ ] **Step 2: Run** `npm test -- --test-name-pattern=context` (or `node --test tests/ask-context.test.cjs`) and the Home browser suite — Expected: FAIL.
- [ ] **Step 3: Implement.** Add `/ask-context.js` to `index.html` (before `/home.js`) and `sw.js` SHELL in the same order `tests/frontend-scripts.test.cjs` checks.
- [ ] **Step 4: Run** `npm test` and the Home browser suite on a fresh server — Expected: all pass.
- [ ] **Step 5: Commit** `home: Pi Hub's context line over the composer, sent once with the next request`.

### Task 5: Local AI — opens on the Assistant, "← Home"

**Files:**
- Modify: `app/public/home.js` (remove `paintPrinter`/`loadPrinter`/`printerWords` and its call in `refresh`), `app/public/index.html` (remove `#homePrinter`; replace `<appliance-nav current="hub">` with `<a class="home-back" id="homeBack" href="http://10.0.0.30/">← Home</a>` in the same place), `app/public/app.js` or a tiny addition in `home.js` (set `#homeBack` href), `app/public/app.css` (`.home-back`; drop the "Suite bar" rules only if no other page uses `appliance-nav` — `gridcraft.html` does, so keep `appliance-nav.js` and its CSS), `app/public/ui.js` (the comment at `showCard` no longer mentions Home's printer line)
- Test: `tests/home-ui.mjs`, `tests/frontend-scripts.test.cjs` if the script list changes

**Interfaces:**
- Produces: `homeUrl(hostname: string) -> string` exported on `window.LocalAIAskContext` (same module as Task 4): `"https://home.home.arpa/"` when `hostname` is `home.arpa` or ends with `.home.arpa`, else `"http://10.0.0.30/"`.

- [ ] **Step 1: Write the failing tests:** cjs `homeUrl('assistant.home.arpa') === 'https://home.home.arpa/'`, `homeUrl('10.0.0.21') === 'http://10.0.0.30/'`; Home browser suite: no `appliance-nav` and no `#homePrinter` on `index.html`; `#homeBack` text "← Home" with `href` `http://10.0.0.30/` on the test server; the Home page still shows the composer and Recent; no request to `/api/workshop/status?part=printer` is made by Home.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Check every browser suite that looked for `appliance-nav` or `#homePrinter` (`grep -l "appliance-nav\|homePrinter" tests/`) and update them to the new page.
- [ ] **Step 4: Run** `npm test` and the touched browser suites — Expected: all pass.
- [ ] **Step 5: Commit** `home: open on the Assistant; "← Home" to Pi Hub replaces the suite bar; the printer lives on the hub`.

### Task 6: Local AI — readable titles

**Files:**
- Modify: `app/run-cards.js` (`runCard`), `app/server/chat.js` (accept `title`)
- Test: `tests/run-cards.test.cjs` (create if absent), `tests/chat-run-ui.mjs` or an API test that starts a chat with `title`

**Interfaces:**
- Produces:
  - `readableTitle(run) -> string` exported from `run-cards.js`, used for `card.title`: `run.meta.label` (trimmed, ≤ 80) → else `run.title` when it has no newline and is at most 60 characters → else `KIND_NAMES[kind]` with `KIND_NAMES = {chat:'Chat', research:'Research', image:'Image', agent:'Mission', spreadsheet:'Spreadsheet', engineering:'Change', automation:'Automation', other:'Run'}`.
  - `/api/chat` body `title` (string): cleaned (control characters out, ≤ 80) and stored as the run's `meta.label`. `run.title` is unchanged.

- [ ] **Step 1: Write the failing tests:**

```js
test('readableTitle never shows a long prompt', () => {
  assert.equal(readableTitle({ type: 'chat', title: "You are the voice of a family's home hub on a Raspberry Pi. Answer th…" }), 'Chat');
  assert.equal(readableTitle({ type: 'chat', title: 'Plan the garden' }), 'Plan the garden');
  assert.equal(readableTitle({ type: 'chat', title: 'line one\nline two' }), 'Chat');
  assert.equal(readableTitle({ type: 'chat', title: 'x'.repeat(200), meta: { label: 'House question' } }), 'House question');
  assert.equal(readableTitle({ type: 'automation', title: 'Hourly Stack & ComfyUI Health Check' }), 'Hourly Stack & ComfyUI Health Check');
  assert.equal(readableTitle({ type: 'mission', title: 'y'.repeat(61) }), 'Mission');
  assert.equal(runCard({ type: 'image', title: 'z'.repeat(90) }).title, 'Image');
});
```

API: a chat started with `{"messages":[…], "title":"House question"}` lists with `card.title === 'House question'` (use the existing chat API test's fake model setup).

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test` and the Home and Work browser suites — Expected: all pass (update fixtures whose card titles were long prompts only if a test asserted them).
- [ ] **Step 5: Commit** `runs: readable card titles (a caller's label, a short title, or the kind's name)`.

### Task 7: Ship both and check end to end

- [ ] **Step 1: Local AI:** run `npm test` and every browser suite (`npm run test:browser`) on a fresh server with an empty `DATA_DIR`; compare any failure with clean `origin/main` before blaming the branch. Open the PR (base `main`) with the summary and the plan link. Ship with `npm run ship -- <PR>`; if the classifier refuses the merge, hand the owner that one command. Confirm `GET https://10.0.0.21/healthz` → `releaseCommit` equals the merge commit.
- [ ] **Step 2: Pi Hub:** `git push pi main`. Expected: `pi-hub-release` passes and "<sha> is live".
- [ ] **Step 3: Checks:** gate check (all ok); hub browser check (24 views); on the Mac, open the hub's Workshop, press Assistant: Local AI opens on Home in Chat mode with "Context: Pi Hub › Workshop: …"; Recent shows "Chat"/"House question" instead of "You are the voice of…"; "← Home" opens the hub. Record in `docs/status.md` (Step 4 section) and Local AI's PR description.
- [ ] **Step 4: Commit** `docs: step 4 (Assistant) live`.
