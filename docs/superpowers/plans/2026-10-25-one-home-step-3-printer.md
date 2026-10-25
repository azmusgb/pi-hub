# One Home, Step 3: One Printer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner clears the plate, pauses and resumes the X2D from the hub (Home and Workshop), through Bambuddy, with a control key of its own.

**Architecture:** A small backend module `hub/printer_control.py` posts to Bambuddy's printer endpoints with a new "Control printer"-only API key read from `/etc/pi-hub/secrets/bambuddy_control_key`. Owner-only endpoints `POST /api/printer/{clear,pause,resume}` wrap it and return Bambuddy's answer in plain words. The printer status the hub already reads from Bambuddy gains an `actions` list (which buttons make sense now), and one front-end module draws those buttons on the Workshop page and on Home's Workshop card.

**Tech Stack:** FastAPI + urllib (backend), vanilla ES modules with `h()` (front end), pytest, `node --test`, Playwright structure check.

**Spec:** `docs/superpowers/specs/2026-10-24-one-home-design.md` (sections "Printer actions", "Home cards", "Sections", "Testing"; rollout item 3).

## Global Constraints

- Endpoints: `POST /api/printer/clear` and `POST /api/printer/pause` are **owner only**; they call Bambuddy with a **control** key — "a new key; the hub's read key stays read-only" (`/etc/pi-hub/secrets/bambuddy_api_key` is untouched).
- Local AI's `/api/display/printer/clear` keeps working unchanged; the hub's Clear plate does the same two Bambuddy calls in the same order (`/api/v1/printers/1/clear-plate`, then `/api/v1/printers/1/hms/clear`), "so they agree".
- Bambuddy errors are shown to the person, in plain words (spec Testing: "the printer endpoints (owner only, Bambuddy errors shown)").
- Labels name tasks: "Clear the plate", "Pause the print", "Resume the print". Home's Workshop card shows **Clear plate** "when finished or failed".
- Secrets: the control key lives in `/etc/pi-hub/secrets/bambuddy_control_key`, root:pi-hub 640, never printed, never returned by an API, never in git. Creating it is an owner step (the classifier sends credential creation to the owner).
- Bambuddy: v1.2.5.7, printer id 1, header `X-API-Key`. Its status has `state` (`RUNNING`, `PAUSE`, `FINISH`, `FAILED`, `IDLE`…) and `awaiting_plate_clear` (bool).
- Releases: `./deploy/install.sh` → `git push pi main` → `pi-hub-release` (tests + health through Caddy, rollback on failure). Bump `sw.js` SHELL (now `pi-hub-shell-v84`) when static files change.

## Review Focus

1. **Double tap or slow Bambuddy:** a second tap while the first is in flight must not send a second request; the button is disabled until the answer, and Bambuddy gets 5 s per call.
2. **No control key yet** (the owner hasn't run the key step): the button still appears, and pressing it says "The hub can't control the printer yet: its Bambuddy control key isn't set up." — never a stack trace or "HTTP 500".
3. **Clear plate starts the next queued print:** Bambuddy may start the queue once the plate is marked clear, so the hub asks "Is the plate empty? Bambuddy may start the next print in the queue." before clearing.
4. **Household or kid sign-in:** the buttons ask for the owner sign-in (`ensure("owner")`); the endpoints answer 401/403 with the hub's usual words.
5. **Stale status after an action:** after a successful action the hub drops its 3 s Bambuddy status cache so the next refresh shows the new state, not the old buttons.

Each line has its test in the owning task (1 → Task 4, 2 → Task 1, 3 → Task 4, 4 → Task 1, 5 → Task 1).

---

### Task 1: Printer control module and owner endpoints

**Files:**
- Create: `hub/printer_control.py`
- Modify: `hub/app.py` (new endpoint near the Workshop routes, ~line 262)
- Test: `tests/test_printer_control.py`

**Interfaces:**
- Produces:
  - `printer_control.KEY_FILE` (env `HUB_BAMBUDDY_CONTROL_KEY_FILE`, default `/etc/pi-hub/secrets/bambuddy_control_key`), `printer_control.PRINTER = 1`, `printer_control.TIMEOUT = 5`.
  - `printer_control.STEPS = {"clear": ("clear-plate", "hms/clear"), "pause": ("print/pause",), "resume": ("print/resume",)}`
  - `printer_control.run(action: str, post=None) -> dict` → `{"ok": bool, "say": str, "steps": {path: result}}`, where each result is `"ok" | "refused" | "no answer" | "no key" | "HTTP <n>"` (Local AI's words plus "no key"). `post(path: str, key: str) -> str` is injectable for tests; the default posts to `bambuddy.URL + f"/api/v1/printers/{PRINTER}/{path}"` with `X-API-Key`. Stops at the first failed step. Never raises.
  - `POST /api/printer/{action}`: owner only; unknown action → 404; ok → 200 `{"ok": true, "say": ...}`; "no key" → 503 with `say` as `detail`; any other failure → 502 with `say` as `detail`. On ok, removes `"bambuddy_printer"` from `sources._cache`.

- [ ] **Step 1: Write the failing tests** in `tests/test_printer_control.py` (fixture as in `tests/test_gate.py`: setup code, owner password, `Origin` header on POSTs; point `HUB_BAMBUDDY_CONTROL_KEY_FILE` at a temp file):

```python
def test_clear_posts_plate_then_errors_with_the_control_key(tmp_key):
    calls = []
    r = printer_control.run("clear", post=lambda path, key: calls.append((path, key)) or "ok")
    assert calls == [("clear-plate", "ctl-key"), ("hms/clear", "ctl-key")]
    assert r == {"ok": True, "say": "Plate cleared. Ready for the next print.", "steps": {"clear-plate": "ok", "hms/clear": "ok"}}

def test_pause_and_resume_words(tmp_key):
    assert printer_control.run("pause", post=lambda p, k: "ok")["say"] == "Paused. Resume it here or on the printer."
    assert printer_control.run("resume", post=lambda p, k: "ok")["say"] == "Resumed."

@pytest.mark.parametrize("result,say", [
    ("refused", "Bambuddy refused the hub's control key. Make a new one (docs/operations.md)."),
    ("no answer", "Bambuddy isn't answering. Check the Pi, or use the printer's screen."),
    ("HTTP 409", "Bambuddy couldn't do that (HTTP 409)."),
])
def test_bambuddy_errors_are_shown_and_stop_the_steps(tmp_key, result, say):
    calls = []
    r = printer_control.run("clear", post=lambda p, k: calls.append(p) or result)
    assert r["ok"] is False and r["say"] == say and calls == ["clear-plate"]

def test_missing_key_says_so_without_calling_bambuddy(no_key):
    r = printer_control.run("pause", post=lambda p, k: pytest.fail("called Bambuddy"))
    assert r == {"ok": False, "say": "The hub can't control the printer yet: its Bambuddy control key isn't set up.", "steps": {"print/pause": "no key"}}

def test_endpoint_is_owner_only(client):                      # signed out → 401; household PIN → 401 "Sign in as the owner first."
def test_endpoint_unknown_action_is_404(owner):
def test_endpoint_shows_bambuddy_errors(owner, monkeypatch):  # run → refused: 502, detail == the "refused" sentence
def test_endpoint_no_key_is_503(owner):
def test_endpoint_ok_drops_the_status_cache(owner, monkeypatch):
    sources._cache["bambuddy_printer"] = (time.time(), {"state": "RUNNING"})
    monkeypatch.setattr(printer_control, "run", lambda a: {"ok": True, "say": "Resumed.", "steps": {}})
    r = owner.post("/api/printer/resume", headers=ORIGIN)
    assert r.status_code == 200 and r.json() == {"ok": True, "say": "Resumed."}
    assert "bambuddy_printer" not in sources._cache
def test_endpoint_never_returns_the_key(owner, monkeypatch):  # "ctl-key" not in any response body above
```

- [ ] **Step 2: Run:** `.venv/bin/pytest tests/test_printer_control.py -q` — Expected: FAIL (`ModuleNotFoundError: hub.printer_control`).

- [ ] **Step 3: Implement** `hub/printer_control.py` (module docstring like `hub/bambuddy.py`'s: why a separate control key, where it lives) and the endpoint in `hub/app.py`. The default `post` maps responses like Local AI's `bambuddy-control.js`: 2xx → ok, 401/403 → refused, other status → `HTTP <n>`, connection error or timeout → no answer. Read the key on every call (so a newly created key works without a restart), stripped; empty or missing → "no key".

- [ ] **Step 4: Run:** `.venv/bin/pytest tests/test_printer_control.py -q` — Expected: all pass. Then the full suite `.venv/bin/pytest -q` — Expected: no new failures.

- [ ] **Step 5: Commit** `hub: Clear plate, Pause and Resume through Bambuddy with a control key (owner only)`.

### Task 2: The printer status says which actions fit now

**Files:**
- Modify: `hub/sources.py` (`_bambuddy`, ~line 121), `hub/now.py` (`printer`, ~line 12)
- Test: `tests/test_now.py`

**Interfaces:**
- Consumes: Bambuddy status fields `state`, `awaiting_plate_clear`, `connected`.
- Produces:
  - `sources._bambuddy()` also returns `"bambuddy_state": data.get("state")` and `"awaiting_plate_clear": bool(data.get("awaiting_plate_clear"))`.
  - `now.printer_actions(b: dict | None) -> list[str]`: `[]` unless `b` and `b["connected"]`; `"clear"` when `awaiting_plate_clear`; `"pause"` when `bambuddy_state == "RUNNING"`; `"resume"` when `bambuddy_state == "PAUSE"`. Order: clear, pause, resume.
  - `now.printer(...)` result gains `"actions": printer_actions(b)` (always present, possibly empty). When `"resume"` is in it, the paused detail reads "Resume it here or on the printer." instead of "…from the printer or Bambu Handy.". When `"clear"` is in it and the state isn't printing or paused, the headline is "Print done — clear the plate" (finished) or "Print failed — clear the plate" (`bambuddy_state == "FAILED"`).

- [ ] **Step 1: Write the failing tests** in `tests/test_now.py`:

```python
B = {"connected": True, "bambuddy_state": "FINISH", "awaiting_plate_clear": True}

def test_actions_follow_bambuddy():
    assert now.printer_actions(None) == []
    assert now.printer_actions({**B, "connected": False}) == []
    assert now.printer_actions(B) == ["clear"]
    assert now.printer_actions({**B, "bambuddy_state": "RUNNING", "awaiting_plate_clear": False}) == ["pause"]
    assert now.printer_actions({**B, "bambuddy_state": "PAUSE", "awaiting_plate_clear": False}) == ["resume"]

def test_finished_and_failed_headlines_ask_to_clear():
    assert now.printer({"x2d_state": "Idle"}, B)["headline"] == "Print done — clear the plate"
    assert now.printer({"x2d_state": "Idle"}, {**B, "bambuddy_state": "FAILED"})["headline"] == "Print failed — clear the plate"

def test_paused_detail_points_here_when_resume_is_possible():
    p = now.printer({"x2d_state": "Paused", "x2d_progress": 40}, {**B, "bambuddy_state": "PAUSE", "awaiting_plate_clear": False})
    assert p["actions"] == ["resume"] and p["detail"] == "Resume it here or on the printer."

def test_no_bambuddy_means_no_actions():
    assert now.printer({"x2d_state": "Printing", "x2d_progress": 5}, None)["actions"] == []
```

- [ ] **Step 2: Run:** `.venv/bin/pytest tests/test_now.py -q` — Expected: FAIL (`printer_actions` missing).
- [ ] **Step 3: Implement** as in Interfaces.
- [ ] **Step 4: Run:** `.venv/bin/pytest -q` — Expected: all pass.
- [ ] **Step 5: Commit** `hub: printer status lists the actions that fit (clear, pause, resume)`.

### Task 3: The owner's one-time control key

**Files:**
- Create: `deploy/bambuddy-control-key.py`
- Test: `tests/test_control_key.py`

**Interfaces:**
- Produces: `make_key(url: str, user: str, password: str, call) -> str` — logs in (`POST /api/v1/auth/login` `{"username", "password"}` → `access_token`), then `POST /api/v1/api-keys/` with Bearer auth and body `{"name": "Pi Hub control", "can_control_printer": True, "printer_ids": [1]}` plus **every other `can_*` flag False** (`can_queue`, `can_read_status`, `can_manage_library`, `can_manage_inventory`, `can_manage_maintenance`, `can_manage_archives`, `can_manage_projects`, `can_access_cloud`, `can_update_energy_cost`), and returns the response's `key`. `call(method, url, body, headers) -> dict` is injectable. Raises `SystemExit` with a plain sentence on any failure (wrong password, `requires_2fa`, no `key`), never including the password or key.
- `main()`: run as root on the Pi (`sudo python3 /opt/pi-hub/current/deploy/bambuddy-control-key.py`). Reads the password from `/etc/pi-hub/secrets/bambuddy_admin`, user `bill`, URL `http://127.0.0.1:8000`. If `/etc/pi-hub/secrets/bambuddy_control_key` already has content, prints "The hub's control key is already set up." and exits 0. Otherwise writes the key with umask 077, then `chown root:pi-hub` and `chmod 640`, and prints only "Made the hub's control key (Bambuddy › Settings › API keys › Pi Hub control)."

- [ ] **Step 1: Write the failing tests:** `make_key` sends the login then the key request with exactly the flags above (assert the body dict); returns the key; a 2FA login raises `SystemExit` whose message doesn't contain the password; a response without `key` raises `SystemExit`. Load the script with `importlib.util.spec_from_file_location` (its name has dashes).
- [ ] **Step 2: Run:** `.venv/bin/pytest tests/test_control_key.py -q` — Expected: FAIL (file missing).
- [ ] **Step 3: Implement** with `urllib.request` only (no new dependencies), 10 s timeout.
- [ ] **Step 4: Run:** `.venv/bin/pytest -q` — Expected: all pass.
- [ ] **Step 5: Commit** `deploy: one-time script that makes the hub's Bambuddy control key (printer 1, control only)`.

### Task 4: Buttons on Workshop and Home

**Files:**
- Create: `hub/static/js/printer-actions.js`
- Modify: `hub/static/js/workshop.js` (`load`, after `state.band`), `hub/static/js/home-cards.js` (`workshopCard`), `hub/static/js/now.js` (`homeCard` renders a button action), `hub/static/sw.js` (SHELL → `pi-hub-shell-v85`, add the new module to the shell list if modules are listed)
- Test: `tests/test_printer_actions.mjs`, `tests/test_home_cards.mjs`

**Interfaces:**
- Consumes: `printer.actions` from Task 2; `POST /api/printer/{action}` from Task 1; `ensure`, `post`, `toast`, `h` from `core.js`.
- Produces:
  - `PRINTER_ACTIONS = { clear: { label: "Clear the plate", ask: "Is the plate empty? Bambuddy may start the next print in the queue." }, pause: { label: "Pause the print", ask: "Pause the print? It waits on the plate until you resume it." }, resume: { label: "Resume the print", ask: null } }`
  - `printerActionList(p) -> Array<{action, label, ask}>` — pure; unknown names dropped; `[]` for a missing `p` or `p.actions`.
  - `printerButtons(p, onDone) -> HTMLElement | null` — a `.printer-actions` row of `button.btn` (first one primary, rest `ghost`); click: `ask` → `confirm`, then `ensure("owner")`, disable **all** buttons in the row, `post`, `toast(say or error message)`, re-enable, `onDone()`. `null` when the list is empty.
  - `workshopCard` (home-cards.js): when `p.actions` includes `"clear"`, `status` = `p.headline`, tone `"warn"`, `action = { label: "Clear the plate", do: "clear" }`; otherwise unchanged. `homeCard` (now.js) renders an `action.do` as a `button.btn.home-card-action` that runs the same flow as `printerButtons` (reuse an exported `runPrinterAction(action, buttons, onDone)`), then refreshes Home.

- [ ] **Step 1: Write the failing tests:**

```js
test("printerActionList follows the status", () => {
  assert.deepEqual(printerActionList({ actions: ["clear"] }).map((a) => a.label), ["Clear the plate"]);
  assert.deepEqual(printerActionList({ actions: ["pause", "nope"] }).map((a) => a.action), ["pause"]);
  assert.deepEqual(printerActionList(null), []);
  assert.equal(PRINTER_ACTIONS.clear.ask, "Is the plate empty? Bambuddy may start the next print in the queue.");
});
test("runPrinterAction sends once and disables while in flight", async () => {
  // fake buttons [{disabled:false},{disabled:false}], fake post that resolves later, confirm → true, ensure → true:
  // two calls before it resolves → post called once; both buttons disabled during; enabled after; onDone called once.
});
test("runPrinterAction does nothing when the plate question is declined", async () => { /* confirm → false: post not called */ });
// test_home_cards.mjs:
test("Workshop card offers Clear plate when the print is done", () => {
  const c = homeCards({ now: { printer: { state: "idle", headline: "Print done — clear the plate", actions: ["clear"] } }, at: new Date(), host: "home.home.arpa" })
    .find((x) => x.key === "workshop");
  assert.deepEqual(c.action, { label: "Clear the plate", do: "clear" });
  assert.equal(c.status, "Print done — clear the plate");
  assert.equal(c.tone, "warn");
});
```

`runPrinterAction(action, buttons, onDone, deps = { confirm, ensure, post, toast })` takes its browser calls as a parameter so node can test it.

- [ ] **Step 2: Run:** `node --test tests/*.mjs` — Expected: FAIL (module missing; workshop card has the Bambuddy link).
- [ ] **Step 3: Implement.** On Workshop the row goes directly under the band (`state.actions`, replaced on each load). Style `.printer-actions` in `components.css` as a wrapping flex row with `gap: .5rem; margin-top: .5rem`.
- [ ] **Step 4: Run:** `node --test tests/*.mjs` and `.venv/bin/pytest -q` — Expected: all pass.
- [ ] **Step 5: Commit** `hub: Clear the plate, Pause and Resume buttons on Workshop and Home`.

### Task 5: Ship and check on the Pi

**Files:**
- Modify: `deploy/gate-check.sh` (one check), `docs/operations.md` (Bambuddy sign-in table), `docs/status.md` (Step 3 section)

- [ ] **Step 1:** In `gate-check.sh` add: signed-out `POST https://home.home.arpa/api/printer/pause` (with Origin) answers 401. Docs: add a table row "Pi Hub: Clear plate, Pause, Resume | printer control | **Control printer** only, printer 1, `/etc/pi-hub/secrets/bambuddy_control_key` (root:pi-hub 640), made by `deploy/bambuddy-control-key.py` | Done/To do" and a Step 3 section in `docs/status.md`.
- [ ] **Step 2: Release:** `./deploy/install.sh` (if it's the documented pre-push step), `git push pi main`. Expected: `pi-hub-release` passes tests and both health checks.
- [ ] **Step 3: Owner step** (credential creation): the owner runs `! ssh -t pi sudo python3 /opt/pi-hub/current/deploy/bambuddy-control-key.py`. Expected output: "Made the hub's control key …". Then check `ssh pi 'sudo stat -c "%U:%G %a" /etc/pi-hub/secrets/bambuddy_control_key'` → `root:pi-hub 640`.
- [ ] **Step 4: Live checks:** `ssh pi 'sudo bash /opt/pi-hub/current/deploy/gate-check.sh'` → all pass (40 checks). `/api/now` printer has `actions` matching Bambuddy (today `awaiting_plate_clear` is true → `["clear"]`). Browser structure check → all views pass. The actual Clear plate press is the owner's (the plate must really be empty); ask the owner to press it once and confirm Bambuddy shows the plate cleared.
- [ ] **Step 5: Commit** docs and gate check: `docs: step 3 (one printer) live`.
