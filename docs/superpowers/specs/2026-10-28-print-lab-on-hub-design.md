# Print lab on Pi Hub, secured (design)

Written 28 Oct 2026. Takes over another session's unreviewed "phases 1–3" (saved as Pi Hub `feat/lab-on-hub` 8aa6c8b
and print-lab `feat/lab-on-hub` 9ab8168) and its "phase 4", after a security review found them not ready. Builds on
`2026-10-27-one-print-design.md` (run lines, outside the lab) and `2026-10-27-one-needs-you-design.md` (item shape, kit
renderer); replaces that spec's Plan C (lab needs via Local AI) with Pi Hub's own copy.

## Intent

**Owner's words:** "You" (this session owns Pi Hub and print-lab); "Yes" to the design below.

**Success:**
- Print lab's pages, phone verdicts, photos and Needs you items work when the Windows PC is off.
- It is at least as safe as Local AI's version: no anonymous writes, no path tricks, no memory blow-up, no shared or
  cleartext keys.
- It shows everything Local AI's Print lab shows (run lines, outside the lab, spool colours, every request kind).
- Local AI keeps its copy until the owner has seen both agree; retiring it (old "phase 6") and moving the workshop
  display's feed (old "phase 5") are separate, later decisions.

## Facts (from the 28 Oct review of the saved branches)

- Pi Hub `hub/app.py:50` exempts all `/api/lab/*` from the same-origin guard; `create_request` and
  `upload_incoming_photo` call no `need()`; Local AI required a paired device (`app/print-lab.js` `deviceFor`).
- `post_request_result` unlinks `incoming_dir(project) / f"{p['sha256']}.jpg"` with an unvalidated `sha256`; Local AI's
  `photosProblem` (1–50 photos, `SHA_RE`, short tabs) was not carried over.
- Every upload uses `await request.body()` before its size check; the service has `MemoryMax=200M`; Caddy has no body
  limit.
- `_expected_key_hash` accepts either header name and falls back to Local AI's `~/.claude/localai-chat/mac.key`;
  the compare itself (`hmac.compare_digest` of SHA-256) and fail-closed default are sound.
- print-lab's change sends Local AI's Mac key to `http://10.0.0.30` under both header names; `pull()` swallows
  per-target errors; the active-print check now asks the hub, which has no `/api/workshop/status`.
- `lab.js` escapes all record text (`esc()`), but lacks `runs[].print`, `entered_on_mac`, `outside` and spool colours;
  start/approve/abandon/observation requests are missing.
- Pi Hub sessions: `hub/auth.py` (roles none/kid/household/owner, `need(request, role)`), the front gate on
  `*.home.arpa`, and `shortcut_keys` (hashed, owner-managed) exist.

## Decisions

| # | Decision |
|---|---|
| L1 | **Phone and browser routes** (`GET` lab data and photos, `POST /requests`, `PUT /incoming`) require `need(request, "household")` and keep the same-origin guard. Nothing under `/api/lab` is anonymous. |
| L2 | **Mac routes** (sync the index and photos, list/claim/resolve requests, fetch incoming photos) require the Pi's lab key in `X-Hub-Mac-Key` only. The same-origin exemption applies only to a request that presents that header *and* passes the key check. |
| L3 | **The Pi's lab key** is separate from Local AI's: the Mac keeps it in `~/.config/print-lab/hub.key` (0600); the Pi keeps only its SHA-256 in `/etc/pi-hub/secrets/lab_mac_key.sha256` (`root:pi-hub` 0640), created by a `deploy/` setup step that prints the key once. No fallback to any other key; missing secret = Mac routes refused. |
| L4 | **Transport:** print-lab talks to `https://home.home.arpa`, verified against the house CA saved at `~/.config/print-lab/home-ca.crt` (from `https://home.home.arpa/home-ca.crt`). Non-https hub targets are refused. Each target gets only its own header (`X-Hub-Mac-Key` to the hub, `X-LocalAI-Mac-Key` to Local AI). |
| L5 | **Bodies are streamed** and cut at the cap: photo 8 MB, index 4 MB, request JSON 64 KB, observation text 16 KB. Caddy adds `request_body { max_size 9MB }` for `/api/lab/*`. |
| L6 | **Request validation** matches Local AI: kinds `verdict`, `photos`, `start`, `approve`, `abandon`, `observation`; photos 1–50 with `^[0-9a-f]{64}$` names and short tabs; every path built from a validated name; the SHA is re-checked before any unlink. Each request records who sent it (`need()`'s person/device label, not the user agent). |
| L7 | **Disk:** incoming capped at 200 files / 500 MB, pruned after 7 days; uploads refused when free disk < 1 GB; `/var/lib/pi-hub/lab` added to `pi-hub-backup.sh`. |
| L8 | **print-lab sync:** per-target results in `.sync.json`; overall ok only when every target succeeded; no silent excepts; downloaded photos verified against their SHA-256; printer telemetry stays on Local AI. Dual-target (Local AI + Pi) until the owner retires Local AI's copy. |
| L9 | **Page parity:** `/lab` renders `runs[].print`, `entered_on_mac`, `outside`, spool colours and every request kind, matching Local AI. The Workshop link moves to `/lab` only after the owner confirms both show the same data. |
| L10 | **Lab items in Needs you (old phase 4):** Pi Hub builds them from its own `lab_projects` copy: `source` "Print lab", id `pi:lab:<project>:<exp>`, `action.key` from the kit phrases (`judge`, `approve`, `send`, `fix_plan`), "Judge the print" only when due (`due_at` passed or the printer reports finished), `as_of` = the index's `generated_at`; urgency 3 except "Fix the plan" excluded; Local AI's feed duplicates dropped by their `judge-*`/`lab-*` ids. List-only, never pushed. |

## Testing

- Pi Hub: anonymous and cross-origin (`text/plain`, `no-cors`) verdicts refused; household allowed; kid refused; wrong
  or missing hub key refused, Local AI's key refused; photo payload with `../`, absolute path, non-hex or 51 entries
  refused; streamed 9 MB photo refused without buffering (assert peak read bytes); incoming cap and prune; low-disk
  refusal; every request kind round-trips; `post_request_result` with a non-object body → 400.
- print-lab: hub target must be https with the CA; headers per target; one target failing → `ok: False` with that
  target's error; photo bytes not matching their SHA rejected.
- Page: run lines, outside, colours and request kinds render from a page.json fixture (escaping kept).
- Needs you: lab items in the shape; judge not before due; stale `as_of` shown; duplicates dropped; works with
  Local AI's feed `None`.

## Rollout: four plans, each usable alone

- **A — secured lab API and storage on Pi Hub** (from the saved branch): L1–L3, L5–L7, Caddy limit, setup step,
  backup. Deployed by the owner; Local AI unchanged.
- **B — secured print-lab sync:** L4, L8. Dual-target against the deployed hub.
- **C — `/lab` page parity:** L9.
- **D — lab items in Needs you:** L10.
