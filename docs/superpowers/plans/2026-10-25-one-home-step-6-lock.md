# One home, step 6: Lock — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every house tool answers only through the front gate (`https://<name>.home.arpa`); the old `IP:port`
addresses stop answering, and plain `http://10.0.0.30` keeps only the machine callers' paths.

**Architecture:** Tools on the Pi are rebound to 127.0.0.1 by one idempotent tool, `deploy/pi-lock.py`
(`apply` / `undo` / `status`), which backs up every file it edits. Bambuddy, which the PC's Local AI calls directly,
keeps :8000 for an allow-list only, through an nftables rule in Docker's `DOCKER-USER` chain. Caddy's `http://`
site passes the machine paths to the hub and sends everything else to `https://home.home.arpa`. Paperless on the PC
gets a Windows firewall scope (Pi only). A Mac-side `deploy/lock-check.sh` proves "ready to lock" before and
"locked" after.

**Tech Stack:** Python 3 (stdlib only) and pytest; Caddy 2.6 Caddyfile; nftables; Docker Compose; PowerShell 5.1 on
the PC; bash + curl for the check.

**Spec:** `docs/superpowers/specs/2026-10-24-one-home-design.md` (Rollout 6, D10, "Names and the gate", Errors).

## Global Constraints

- D10: "Old IP:port addresses keep working until the last step, then answer only the gate."
- Rollout 6: "every tool's port bound to 127.0.0.1 or firewalled to the gate; old addresses retired; docs updated."
- Machine callers: "At step 6 these callers move to the gate names, or keep plain http on `/api/*` only." They are
  Local AI's `GET /api/now`, Bambuddy's webhook `/api/webhook/bambuddy`, Siri Shortcuts `/api/shortcut/*`, and the
  PC's backup pull (ssh as `pi-backup`, port 22: unaffected).
- Errors: "After step 6, Caddy runs as a systemd service with restart, and the self-check gains 'the gate answers'"
  (the self-check already has it: `pi-hub-selfcheck.py`, "The front gate answers").
- Never delete `/var/lib/caddy`. Never print secrets. Every change on the Pi or the PC is undoable by one command.
- **Precondition (owner, from step 1):** the Orbi hands out the Pi (10.0.0.30) as DNS, the gate's root certificate
  is trusted on the iPhone and the Mac, and Tailscale split DNS sends `home.arpa` to 100.92.174.18. Task 6 does not
  start until `deploy/lock-check.sh ready` passes on the Mac and the owner has opened `https://home.home.arpa` on
  the iPhone without a warning. As of 25 Oct none of these are done (`dig home.home.arpa` → nothing on the Mac).

## What stays open, and why (rulings for the owner to confirm at review)

| Port | What | Ruling |
|---|---|---|
| 22 | ssh (PC backup pull, admin) | open |
| 53 | AdGuard DNS | open (the names depend on it) |
| 80, 443 | Caddy, the gate | open |
| 8000 | Bambuddy | allow-list: loopback, Docker bridges, 10.0.0.21 (Local AI calls it with an API key), the Mac (print-lab). The Mac needs a DHCP reservation on the Orbi for its address (owner); until then print-lab sets `LAB_BAMBUDDY_URL` itself |
| 8091 | X2D camera frames | open: the Workshop display (10.0.0.124) reads `http://10.0.0.30:8091/x2d/frame.jpg` (found during Task 3) |
| 32400 | Plex | open (players on the TV and phones need it; not a gated tool) |
| 51125, 45665 | Homebridge's HomeKit bridges | open (HomeKit needs them); only the UI, 8581, closes |
| 60000 | ipp-usb (AirPrint) | open |
| 5201 | iperf3 | open (owner's network tests) |
| PC 443 | Local AI (`https://10.0.0.21`) | open: it has its own Caddy; the Mac's board reports, the hub and the Workshop display call it; its lock is its own sign-in (Local AI #331) |

Everything else listening on the LAN today closes: 3000 Grafana, 3001 Uptime Kuma, 3002 AdGuard web, 7745 Homebox,
8099 pi-status, 8581 Homebridge UI, 9090 Cockpit, 9100 node_exporter, 9115 blackbox, 9120 Orbi
exporter, 9898 Backrest; and Paperless 8010 on the PC except from the Pi. (Every one of these is already read by its
users at 127.0.0.1: the hub, Prometheus and Caddy.)

## Review Focus

1. **Bambuddy's webhook and Siri Shortcuts over Tailscale** (`http://pi.tailfa018e.ts.net/api/shortcut/...`): the
   machine route must match any host, not only 10.0.0.30. Pinned in Task 2 (`test_machine_paths_match_any_host`).
2. **A re-run or a half-applied lock** (the tool stops midway, or `apply` runs twice): the second run must not
   prefix `127.0.0.1:` twice or lose the first backup. Pinned in Task 3 (`test_apply_twice_is_a_no_op`,
   `test_undo_restores_the_first_backup`).
3. **HomeKit and DNS keep working:** only Homebridge's UI host and AdGuard's web address change. Pinned in Task 3
   (`test_homebridge_bridge_port_untouched`, `test_adguard_dns_untouched`).
4. **Docker restarts or the Pi reboots:** the Bambuddy rule must come back after Docker rebuilds its chains. Pinned
   in Task 4 (the unit runs `After=docker.service` with `PartOf=docker.service`; `test_rule_survives_docker_restart`
   is the live step in Task 6).
5. **A browser on the old address with a path** (`http://10.0.0.30/workshop`): it lands on the same page on the
   gate, not on Home. Pinned in Task 2 (`test_browsers_keep_their_path`).

---

### Task 1: The lock check (Mac side)

**Files:**
- Create: `deploy/lock-check.sh`
- Test: run it (no unit test: it is the acceptance test itself)

**Interfaces:**
- Produces: `bash deploy/lock-check.sh ready|locked` — prints one line per check (`%-44s ok|<what it got>`), exits
  non-zero if any fails. Later tasks and the owner run it from the Mac.

- [ ] **Step 1: Write `deploy/lock-check.sh`** with these checks (curl `--max-time 5`, system trust and system DNS,
  never `--insecure`, never `--resolve`):
  - `ready` and `locked`: `dig +short home.home.arpa` is `10.0.0.30`; `https://home.home.arpa/healthz` → 200 with
    a trusted certificate; `http://10.0.0.30/api/now` is not a redirect (any of 200/401/403);
    `http://10.0.0.30/home-ca.crt` → 200.
  - `locked` only: each of `10.0.0.30:` 3000 3001 3002 7745 8091 8099 8581 9090 9100 9115 9120 9898 refuses or
    times out (curl code `000`); `10.0.0.21:8010` → `000`; `http://10.0.0.30/workshop` → 308 with
    `Location: https://home.home.arpa/workshop`; `http://10.0.0.30/api/shortcut/x` and
    `/api/webhook/bambuddy` (GET) → not 308; `10.0.0.30:8000` from the Mac → 200 only if this Mac's address is in
    the allow-list (print which).
- [ ] **Step 2: Run** `bash deploy/lock-check.sh ready`
  Expected today: FAIL on `dig` and the https line (the owner's DNS and CA steps are pending). That is the red.
- [ ] **Step 3: Commit** `git add deploy/lock-check.sh && git commit -m "deploy: lock check, run from the Mac before and after step 6"`

### Task 2: Caddy's plain-http site keeps only the machine paths

**Files:**
- Modify: `deploy/caddy/Caddyfile` (the `http://` site at the end), `deploy/install.sh:46` (gate.conf drop-in)
- Test: `tests/test_caddy_lock.py`

**Interfaces:**
- Produces: `MACHINE_PATHS = ["/api/now", "/api/webhook/bambuddy", "/api/shortcut/*", "/home-ca.crt", "/healthz"]`
  as the one list, in a comment at the top of the `http://` site and in the test.

- [ ] **Step 1: Write the failing tests.** They run `caddy adapt --config deploy/caddy/Caddyfile` (skip when `caddy`
  is not on PATH; the release runs them on the Pi, where it is) and walk the JSON for the server that listens on
  `:80`:
  - `test_machine_paths_reach_the_hub`: a route whose `path` matcher is exactly `MACHINE_PATHS` minus
    `/home-ca.crt` ends in `reverse_proxy` to `127.0.0.1:8100`.
  - `test_machine_paths_match_any_host`: that route has no `host` matcher.
  - `test_browsers_keep_their_path`: the last route is a `static_response` 308 with
    `Location: https://home.home.arpa{http.request.uri}`.
  - `test_ca_still_served_over_http`: `/home-ca.crt` is still a `file_server` route.
  - `test_caddy_restarts`: `deploy/install.sh` writes `Restart=always` into `caddy.service.d/gate.conf`.
- [ ] **Step 2: Run** `rsync -a --delete --exclude .venv --exclude .git ./ pi:/tmp/lockt/ &&
  ssh pi 'cd /tmp/lockt && python3 -m pytest -q -p no:cacheprovider tests/test_caddy_lock.py'`
  Expected: 4 FAIL (`test_ca_still_served_over_http` passes already).
- [ ] **Step 3: Change the `http://` site:** keep the `@named` redirect and the `/home-ca.crt` handle; add
  `@machine path <MACHINE_PATHS minus /home-ca.crt>` → `reverse_proxy 127.0.0.1:8100`; replace the final
  `handle { reverse_proxy … }` with `redir https://home.home.arpa{uri} 308`. Update the site's comment (old
  addresses are retired; these paths stay for the machine callers). Add `Restart=always\nRestartSec=2` to the
  gate.conf printf in `install.sh`.
- [ ] **Step 4: Run** the Step 2 command. Expected: 5 passed. Then `.venv/bin/python -m pytest -q` on the Mac:
  all pass (the new file skips).
- [ ] **Step 5: Commit** (do not release yet; Task 6 releases):
  `git commit -am "gate: plain http keeps only the machine paths; browsers go to https; Caddy restarts"`

### Task 3: `pi-lock.py` rebinds the Pi's tools to 127.0.0.1

**Files:**
- Create: `deploy/pi-lock.py`, `tests/test_pi_lock.py`, `tests/fixtures/pi-lock/` (copies of today's files with
  secrets removed: `opt/homebox/compose.yml`, `opt/backrest/compose.yml`, `opt/netmon/docker-compose.yml`,
  `opt/adguard/conf/AdGuardHome.yaml` (only its `http:` block and `dns:` bind lines),
  `var/lib/homebridge/config.json` (only `bridge` and the `config` platform's `port`)).
- Modify: `deploy/x2d-camera-failover.py:79` (`"0.0.0.0"` → `"127.0.0.1"`), `deploy/pi-status.py` (its bind
  address → 127.0.0.1), and the Orbi exporter's bind in `/opt/netmon/scripts/orbi_exporter.py` (outside the repo:
  `pi-lock.py` edits it like the other /opt files).

**Interfaces:**
- Produces: `python3 deploy/pi-lock.py [--root DIR] apply|undo|status`. `--root` defaults to `/`; tests pass a temp
  copy of the fixtures. `apply` writes the original of each file it changes to
  `<root>/var/backups/pi-lock/<file path>` only if no backup exists yet, then edits; `undo` copies the backups back
  and deletes them; `status` prints one line per edit: `locked` / `open` / `missing`. After editing, `apply` and
  `undo` (only when `--root` is `/`) run `docker compose -f <file> up -d` for each compose file they changed,
  `systemctl daemon-reload`, and restart `cockpit.socket`, `homebridge`, `pi-status`, `x2d-camera-failover`.
- The edits (each a pure function `str -> str`, idempotent):
  - `bind_ports(text, ports)`: `"N:N"` / `"N:M"` port lines for the listed host ports → `"127.0.0.1:N:M"`; homebox
    7745, backrest 9898.
  - `set_env(text, service, key, value)` in a compose file: netmon `grafana` `GF_SERVER_HTTP_ADDR=127.0.0.1`,
    `uptime-kuma` `UPTIME_KUMA_HOST=127.0.0.1`; `node-exporter` and `blackbox-exporter` get
    `--web.listen-address=127.0.0.1:9100` / `127.0.0.1:9115` in their `command`.
  - `adguard_web(text)`: under `http:`, `address: 0.0.0.0:3002` → `address: 127.0.0.1:3002`; nothing under `dns:`.
  - `homebridge_ui(json_text)`: the `config` platform gets `"host": "127.0.0.1"`; `bridge` untouched.
  - Cockpit: writes `/etc/systemd/system/cockpit.socket.d/listen.conf` with
    `[Socket]\nListenStream=\nListenStream=127.0.0.1:9090\n`; `undo` deletes it.

- [ ] **Step 1: Write the failing tests** in `tests/test_pi_lock.py` (copy the fixtures into `tmp_path`, run
  `main(["--root", str(tmp_path), "apply"])`, read files back):
  - `test_ports_bound_to_loopback`: homebox has `"127.0.0.1:7745:7745"`, backrest `"127.0.0.1:9898:9898"`.
  - `test_grafana_and_kuma_listen_on_loopback`, `test_exporters_listen_on_loopback`.
  - `test_adguard_dns_untouched`: the `dns:` block is byte-identical; `http.address` is `127.0.0.1:3002`.
  - `test_homebridge_bridge_port_untouched`: `bridge.port` still 51125; the config platform has `host`.
  - `test_cockpit_drop_in`: the drop-in exists with `ListenStream=127.0.0.1:9090`.
  - `test_apply_twice_is_a_no_op`: a second `apply` changes no file (compare bytes) and keeps the first backups.
  - `test_undo_restores_the_first_backup`: after `apply`, `apply`, `undo`, every file equals the fixture; the
    drop-in and `var/backups/pi-lock` are gone.
  - `test_status_reports_each_edit`: `open` before, `locked` after.
  - `test_failover_and_pi_status_bind_loopback`: the repo's two scripts no longer contain `"0.0.0.0"`.
- [ ] **Step 2: Run** `.venv/bin/python -m pytest -q tests/test_pi_lock.py` — Expected: FAIL (`deploy/pi-lock.py`
  missing; import it with `importlib.util.spec_from_file_location`, as `tests/` does for other `deploy/` scripts).
- [ ] **Step 3: Implement `deploy/pi-lock.py`** (stdlib only; edit YAML as text, line by line, never re-serialise:
  the Pi has no PyYAML). Make the two repo scripts bind 127.0.0.1.
- [ ] **Step 4: Run** the Step 2 command, then the whole suite. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "deploy: pi-lock rebinds the Pi's tools to 127.0.0.1 (apply/undo/status)"`

### Task 4: Bambuddy's allow-list

**Files:**
- Create: `deploy/pi-lock-firewall.nft`, `deploy/pi-lock-firewall.service`
- Modify: `deploy/pi-lock.py` (`apply` installs and enables the unit; `undo` disables it and deletes the table),
  `tests/test_pi_lock.py`

**Interfaces:**
- The rule file adds `table ip pi_lock` with a chain hooked at `forward` priority `filter - 1` (runs before
  Docker's own) that drops `ct original proto-dst 8000` unless `ip saddr` is in
  `{ 127.0.0.0/8, 172.16.0.0/12, 10.0.0.30, 10.0.0.21, 10.0.0.16 }` (10.0.0.30: Uptime Kuma, on host networking, checks `http://10.0.0.30:8000`). A separate table is used so Docker rebuilding
  `ip filter` never removes it. The unit is `Type=oneshot`, `RemainAfterExit=yes`,
  `After=docker.service`, `PartOf=docker.service`, `ExecStart=/usr/sbin/nft -f /etc/pi-lock/firewall.nft`,
  `ExecStop=/usr/sbin/nft delete table ip pi_lock`.

- [ ] **Step 1: Failing tests:** `test_bambuddy_allow_list` (the file names exactly those four sources and
  `ct original proto-dst 8000`, and the table is `ip pi_lock`, not `ip filter`);
  `test_apply_installs_the_firewall_unit` (with `--root`, the unit and the rule land under
  `etc/systemd/system/` and `etc/pi-lock/`); `test_undo_removes_it`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement**; on the real Pi only, `apply` runs `nft -c -f` (check) before enabling, and stops with
  the message if the check fails.
- [ ] **Step 4: Run** the suite. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "deploy: Bambuddy's :8000 only for Local AI, the Mac and the Pi itself"`

### Task 5: Links name the gate only; Paperless on the PC

**Files:**
- Modify (pi-hub): `hub/static/js/sections.js:59-64` (`toolUrl`), `tests/test_sections.mjs`
- Modify (appliance-ui): `suite.json` (`home.lan` → `https://home.home.arpa/`, `materials.lan` →
  `https://bambuddy.home.arpa/inventory`, `materials.tailnet` → the same), `tokens.json` version `1.2.1`; sync to
  pi-hub `hub/static/ui`, Local AI `app/public/ui` (its own PR), filamentinventory `ui`, bambuhelper `assets/ui`.
- Create: `deploy/windows-lock-paperless.ps1` (pi-hub repo; run on the PC by `ssh windows`).

**Interfaces:**
- `toolUrl(name, host)` returns `https://${name}.home.arpa/` for every gated tool whatever the host. `OLD` keeps only
  entries that are not gated (none expected; delete the map if empty).
- `windows-lock-paperless.ps1 -Apply|-Undo|-Status`: `-Status` lists every inbound rule whose port filter covers
  8010 (read-only, run first). `-Apply` sets `RemoteAddress` on those rules to `10.0.0.30,127.0.0.1,LocalSubnet`
  only if `LocalSubnet` is needed for Docker (decide from `-Status`: Docker Desktop's own rules are per program, not
  per port) and records the old values in `C:\ProgramData\pi-lock\paperless-rules.json`; `-Undo` restores them.

- [ ] **Step 1: Failing tests:** in `test_sections.mjs`, `toolUrl("bambuddy", "10.0.0.30")` →
  `https://bambuddy.home.arpa/`; `toolUrl("grafana" …)` unchanged in shape for `.home.arpa` hosts. In appliance-ui,
  `tests/build.test.mjs`: no `suite.json` `lan` link contains `10.0.0.30:`.
- [ ] **Step 2: Run** `node --test tests/test_sections.mjs` and appliance-ui `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement**; release appliance-ui 1.2.1, sync.
- [ ] **Step 4: Run** both suites. Expected: pass. Run `ssh windows powershell -NoProfile -File <script> -Status`
  and record the rules in the ledger (read-only).
- [ ] **Step 5: Commit** in each repo.

### Task 6: Lock (owner's go, after the precondition)

**Files:**
- Modify: `docs/operations.md` (Old addresses paragraph → what is open and why, the undo commands),
  `docs/status.md` (step 6 section with the lock-check output), the spec's "Open items for the owner" (mark done).

- [ ] **Step 1:** `bash deploy/lock-check.sh ready` on the Mac. Expected: all ok. If not, stop: the owner's DNS/CA
  steps are not done.
- [ ] **Step 1b:** Repoint Uptime Kuma's two monitors that use closing ports: "Pi Hub Web App" `http://10.0.0.30` →
  `http://127.0.0.1/healthz`, "Grafana Dashboards" `http://10.0.0.30:3000` → `http://127.0.0.1:3000/api/health`
  (in Kuma's UI, or its DB with Kuma stopped and a copy kept).
- [ ] **Step 2:** Ask the owner for the go (a network change on the Pi and the PC). Then release the hub
  (`git push pi main`) and run `ssh -t pi sudo python3 /opt/pi-hub/current/deploy/pi-lock.py apply`, then
  `ssh -t pi sudo bash /opt/pi-hub/current/deploy/install.sh` (Caddy drop-in), then the Paperless script with
  `-Apply`.
- [ ] **Step 3:** `bash deploy/lock-check.sh locked` (Expected: all ok), `ssh pi 'sudo bash
  /opt/pi-hub/current/deploy/gate-check.sh'` (Expected: all ok), `node tests/browser/structure.mjs
  https://home.home.arpa` (Expected: All 28 views pass), Local AI's Materials and Documents cards still show data
  (`curl -s https://10.0.0.21/healthz` plus its Paperless/Bambuddy status), `ssh pi 'sudo systemctl restart docker
  && sleep 20 && sudo nft list table ip pi_lock'` (Expected: the table is there:
  `test_rule_survives_docker_restart`).
- [ ] **Step 4:** If any check fails and the cause is not a one-line fix: `pi-lock.py undo`, Paperless `-Undo`, and
  `git revert` the Caddy change, release; record what failed.
- [ ] **Step 5:** Docs, commit, release; update memory (`one-home-gate.md`).
