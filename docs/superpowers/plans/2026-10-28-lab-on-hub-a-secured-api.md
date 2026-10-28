# Print lab on Pi Hub, Plan A: secured lab API and storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pi Hub's `/api/lab/*` (from the saved branch) becomes safe to deploy: no anonymous or cross-site writes, a
separate hashed Mac key, streamed and capped bodies, Local AI's request validation, bounded disk use and backups.

**Architecture:** Work on Pi Hub branch `feat/lab-on-hub` (8aa6c8b, the other session's code). Add one small module
`hub/lab_guard.py` for the key check and capped body reading, fix `hub/lab.py`'s routes against it, narrow
`hub/app.py`'s guard, add a `deploy/` key setup step, a Caddy body limit and the lab folder to backups. The `/lab` page
stays reachable only by URL (household sign-in); the Workshop link keeps pointing at Local AI until Plan C.

**Tech Stack:** Python 3 / FastAPI / Starlette / SQLite, pytest; Caddy; bash.

**Spec:** `/Users/billrahe/dev/pi-hub/docs/superpowers/specs/2026-10-28-print-lab-on-hub-design.md` (L1–L3, L5–L7).

## Global Constraints

- Phone/browser routes: `GET /api/lab/projects`, `GET /{project}`, `GET /{project}/photos`, `GET /{project}/photo/…`,
  `GET /{project}/record/…`, `POST /{project}/requests`, `PUT /{project}/incoming/…`, and `GET /{project}/requests`
  without a valid Mac key → `need(request, "household")`; same-origin guard applies.
- Mac routes: `POST /{project}/sync`, `PUT /{project}/photos/…`, `GET /{project}/requests` (with key),
  `POST /{project}/requests/{id}/result`, `GET /{project}/incoming/…` → valid `X-Hub-Mac-Key` only; else 401.
- Guard exemption (`hub/app.py`): only when `X-Hub-Mac-Key` is present **and** verifies; no path-wide exemption.
- Key: Pi stores SHA-256 hex in `/etc/pi-hub/secrets/lab_mac_key.sha256` (env `HUB_LAB_KEY_HASH_FILE`), `root:pi-hub`
  0640; compare with `hmac.compare_digest` on SHA-256 of the presented key; only header `X-Hub-Mac-Key`; no fallback;
  missing/empty file → every Mac route 401.
- Caps (bytes): photo 8 MiB, index 4 MiB, request JSON 64 KiB, observation text 16 KiB; enforced while streaming
  (`request.stream()`), reply 413; Caddy `request_body { max_size 9MB }` for `/api/lab/*`.
- Request kinds: `verdict`, `photos`, `start`, `approve`, `abandon`, `observation`; photos 1–50, names
  `^[0-9a-f]{64}$`, tab ≤ 40 chars; validation ported from Local AI `app/print-lab.js` (`photosProblem`, `actProblem`,
  observation rules, `OBS_KINDS`, `ACT_KINDS`) in `/Users/billrahe/dev/ai-harness/LocalAI-needskit`.
- Disk: incoming ≤ 200 files and ≤ 500 MiB per project, pruned after 7 days; uploads refused (507) when free disk
  < 1 GiB (`sources.disk_free_gb`).
- Pi deploys are the owner's; stop before `git push pi main`. Commits end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests`, `node --test tests/*.mjs`.

## Review Focus

1. A household member's browser on another site posts a verdict as `text/plain` with `no-cors` → 403 (Task 1).
2. A kid PIN session posts a verdict → refused (Task 1).
3. The Mac presents Local AI's key, or the key in `X-LocalAI-Mac-Key` → 401 (Task 1).
4. A 9 MiB photo arrives in 64 KiB chunks → 413 after reading at most cap + one chunk (Task 2).
5. A photos request whose entry is `../photos/<sha>` or an absolute path → refused at creation; result handling never
   unlinks outside `incoming/` (Task 3).

---

### Task 1: Access — household for people, the hub key for the Mac, narrow guard

**Files:** Create `hub/lab_guard.py`. Modify `hub/lab.py` (every route), `hub/app.py` (`guard` ~L44–52). Test
`tests/test_lab_access.py` (new); adjust `tests/test_lab.py` to sign in / send the key.

**Interfaces:**
- Produces: `lab_guard.KEY_HASH_FILE`; `lab_guard.mac_key_ok(request) -> bool` (reads only `x-hub-mac-key`);
  `lab_guard.require_mac(request) -> None` (raises 401 "The Mac's lab key is missing or wrong."); for people the
  routes call `need(request, "household")` from `hub/app.py`'s existing helper (import path as other routers do — if
  `need` lives in `app.py`, move it to `hub/auth.py` and re-export, keeping `app.need` working).
- `guard`: exempt only when `lab_guard.mac_key_ok(request)`.

- [ ] **Step 1: Failing tests:** `test_anonymous_cannot_read_or_write_the_lab` (each phone route → 401);
  `test_kid_cannot_post_a_verdict`; `test_household_can_read_and_post`; `test_cross_origin_text_plain_verdict_is_refused`
  (403 with `Origin: https://evil.example`, `Content-Type: text/plain`); `test_mac_routes_need_the_hub_key` (none,
  wrong, Local AI's key, key in `X-LocalAI-Mac-Key` → 401; right key → 200);
  `test_no_key_file_refuses_every_mac_route`; `test_the_key_exempts_the_guard_only_when_it_verifies`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both suites — PASS.
- [ ] **Step 5: Commit** — "lab: household sign-in for people, the hub's own key for the Mac".

### Task 2: Streamed, capped bodies and the Caddy limit

**Files:** Modify `hub/lab_guard.py` (`read_capped`), `hub/lab.py` (every `await request.body()`), `deploy/caddy/Caddyfile`
(`home.home.arpa` block: `request_body` matcher for `/api/lab/*`). Test `tests/test_lab_limits.py`.

**Interfaces:** Produces `async lab_guard.read_capped(request, cap: int) -> bytes` — iterates `request.stream()`,
raises `HTTPException(413, "That's too big for the lab (limit N MB).")` as soon as total > cap.

- [ ] **Step 1: Failing tests:** `test_photo_over_8mib_streamed_is_refused_early` (generator body of 64 KiB chunks;
  assert 413 and that the generator was not drained past cap + 1 chunk); same for index (4 MiB) and request (64 KiB);
  `test_caddyfile_caps_lab_bodies` (text check of the Caddyfile block).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — "lab: stream uploads and stop at the cap; Caddy limits lab bodies".

### Task 3: Request validation matches Local AI

**Files:** Modify `hub/lab.py` (`create_request`, `list_requests`, `post_request_result`). Test
`tests/test_lab_requests.py`.

**Interfaces:** Produces `lab.request_problem(kind: str, payload: dict, runs_seen: set[str]) -> str | None` (port of
Local AI's `actProblem`/`photosProblem`/observation checks); requests store `by` = `need()`'s person/device label.

- [ ] **Step 1: Failing tests:** each of the six kinds accepted with a valid payload; unknown kind 400; photos: 0 and
  51 entries, `../x`, absolute path, uppercase/short SHA, 41-char tab → 400; observation text > 16 KiB → 413/400;
  `post_request_result` with a list body → 400; result handling unlinks only `incoming/<sha>.jpg` for validated SHAs
  (create a decoy `photos/<sha>.jpg` and assert it survives a crafted result); `by` is the household label, not a UA.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — "lab: request kinds and checks as Local AI has them".

### Task 4: Disk limits, backups, the key setup step, no premature link

**Files:** Modify `hub/lab.py` (incoming caps, prune, low-disk 507), `deploy/pi-hub-backup.sh` (include
`/var/lib/pi-hub/lab`), `hub/static/js/workshop.js` and `hub/static/js/sections.js` (Print lab links stay on the
assistant tool until Plan C — revert the branch's switch to `/lab`), `hub/static/sw.js` (bump). Create
`deploy/lab-key.sh` (run as root on the Pi: makes a 32-byte random key, writes its SHA-256 to
`/etc/pi-hub/secrets/lab_mac_key.sha256` `root:pi-hub` 0640, prints the key once with the line to save it on the Mac
at `~/.config/print-lab/hub.key` 0600; refuses to overwrite without `--rotate`). Test `tests/test_lab_disk.py`,
`tests/test_deploy_lab_key.py` (script syntax and behaviour in a temp root via env overrides).

- [ ] **Step 1: Failing tests:** 201st incoming file or > 500 MiB → 507/413 with a clear message; files older than 7
  days pruned on the next upload; free disk < 1 GiB (monkeypatched) → 507; backup script lists the lab folder;
  `lab-key.sh` writes only the hash with the right mode and refuses to overwrite; Workshop's Print lab link still the
  assistant tool.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** both suites — PASS.
- [ ] **Step 5: Commit** — "lab: bounded incoming, backed up, a key setup step; links wait for parity".
- [ ] **Step 6: Stop.** The owner merges and deploys (`git push pi main`), then runs `sudo bash
  /opt/pi-hub/current/deploy/lab-key.sh` on the Pi and saves the printed key on the Mac.
