# Replacement audit: what Pi Hub, LocalAI and Print Lab could hand to existing products

Date: 2026-11-16. Status: **proposed**, for the owner's decisions. Read-only audit: nothing was installed or changed.

Input: a pasted market comparison (Open WebUI, Bambuddy, Homarr, Home Assistant, n8n, Uptime Kuma and others) that
recommended "replace the commodity features, keep the specialised workflows" and asked for a screen-by-screen audit.
This is that audit. Inventories were read from `origin/main` of each repo (LocalAI `3c5bf18`, Pi Hub `e2b3d04`,
print-lab `77205ba`), not from the running systems.

## What the comparison got wrong or left out

- The printer is a Bambu X2D, not a P1S.
- Bambuddy is already adopted (24 Oct 2026): it is the record for spools, projects, queue and archive, and Pi Hub reads it
  (`hub/bambuddy.py`). The Print Lab recommendation is mostly done. What is left is listed under Print Lab below.
- Its product scores were not benchmarked and its feature claims are from vendor documentation. This audit does not
  verify them. Anything that depends on a claim (for example Open WebUI's scheduled tasks or Bambuddy's slicing) is
  marked "verify in a spike" before any code is retired.
- It does not mention the one-site rules (A22): one sign-in, owner-only, no second password, Needs you as the one
  list, records as the one source per fact, the appliance-ui kit as the one look. Any product that brings its own login
  or look breaks those unless it sits behind the Caddy gate.

## Result in one paragraph

Little is worth replacing. Three small deletions are clear. Printer operation in Pi Hub and chat/RAG in LocalAI overlap
products, but each is tied to the gate, the records and the kit, so a swap costs more than the code it removes. Homarr
and Home Assistant would add a second front end and a second device model for no capability the owner lacks. Everything
distinctive (records, Needs you, releases, missions, Changes, Atlas, the Claude board, the experiment record, deploy
and rollback) stays.

## Pi Hub (about 12k lines of Python plus the static shell)

| Area | Lines (approx) | Verdict | Why |
|---|---|---|---|
| Workshop > Printer (`workshop.js` 2229; `bambuddy.py`, `printer_control.py`, `printer_telemetry.py`, `things/printer.py`, `room_camera*.py` ~1.5k) | ~4k | **Keep, evaluate later** | Overlaps Bambuddy's UI, but it is the owner's only X2D page inside the one site, and the camera and display feed depend on it. Replacing it with a link to Bambuddy `:8000` (open to the LAN allow-list, no login) breaks A22. |
| Workshop > Quick Print (`quick*.py` ~2.7k, `quick.js` 595, vendored three.js, 6 tables) | ~3.5k | **Evaluate (spike)** | The one place a real overlap might retire thousands of lines: Bambuddy documents server-side slicing and a library. Unknown: whether it handles the X2D start sequence, A26's model-before-slice rule and the Mac slicer worker. Verify in a spike before deciding. |
| Workshop > Print lab (`lab*.py`, `lab*.js` ~5k) | ~5k | **Keep** | Distinctive: it shows Print Lab's records and carries the one-tap start and verdict. |
| Home, Wall, Site map, Assistant tiles, Weather | ~2k | **Keep** | Generic tiles, but they are fed by records and Needs you and drawn in the kit. Homarr would show links and widgets, not records. |
| Household: Movies, Papers, Scan, Print, Lists, Drives | ~3.5k | **Keep; Lists is the one candidate** | Movies and Papers front Plex and Paperless, which already are the products. Lists (`items`, 134 lines) is generic but tiny. |
| Network and Lights (Homebridge, netmon) | ~1k | **Keep** | Already thin readers of existing products. |
| System: Health, Backups, Versions, Alerts, Automations, Settings | ~5k | **Keep** | Versions, Alerts and Health are the platform's own evidence. Uptime Kuma is already being retired (A22 O4); do not add it back. |
| Records, Needs you, systems, display feed, release records, release/rollback/firewall lock | ~6k | **Keep** | Distinctive. Nothing in the comparison covers them. |

Not recommended: Homarr as the front end (second look, second sign-in, cannot read records), Home Assistant (replaces
Homebridge plus Pi Hub rules; large migration, no new capability today), n8n (LocalAI already links an n8n; cross-app
events are already the records and release inbox).

## LocalAI

Server lines from the inventory; the page code is mostly inside `app/public/ui.js` (4458 lines) and `app.js`, which
cannot be split by page.

| Page | Server lines (approx) | Class | Verdict |
|---|---|---|---|
| Chat, Models, Sources (RAG), Memory, Library, Projects, Images, Assistant automations, Audit log | ~3k plus a large share of `ui.js` | Commodity | **Candidate: spike Open WebUI beside it** (see below) |
| Decisions and push (`notifications.js`, `push.js`, `notify.js`) | ~430 | Commodity, but it feeds Needs you | **Keep** |
| Work (unified run ledger) | ~630 | Leaning distinctive | **Keep** |
| Agent World, missions and evidence | ~1.85k | Distinctive | **Keep** |
| Changes, Shipped, Signals | ~1.3k | Distinctive | **Keep** |
| Claude Code board, priorities, hand-over | ~490 plus host scripts | Distinctive | **Keep** |
| Atlas and contracts | ~920 plus Python | Distinctive | **Keep** |
| Status, Settings, Developer tools, GridCraft | ~1.4k | Glue and host bridges | **Keep** |
| Workshop display, Print lab and Bambuddy links, Pi Hub link | ~2.6k | Glue | **Keep** |
| Deploy and rollback (`deploy/*.ps1`, Safe Deploy task) | not in the web app | Distinctive | **Keep** |

Why only a spike for the commodity group: those pages share the device-pairing sign-in, the GUARDED route list, the
`settings` ledger and the Needs-you feed, and `ui.js` is a hand-edited bundle, so removing a page is surgery, not
deletion. Open WebUI has its own accounts, so it must sit behind the Caddy gate (one sign-in) or the choice fails A22.
Its licence has branding conditions (verify). The spike question: do Chat + RAG + Models in Open WebUI over the
existing Ollama beat today's pages for the owner's daily use? If yes, retire those pages one by one behind the registry
(`ALIASES`), keeping the data export (`localai.db` JSON export plus `Backup-LocalAI-Data.ps1`).

## Print Lab

Print Lab is the experiment record, not a printer UI. Of about 30 commands and pages, one is a duplicate.

| Item | Verdict |
|---|---|
| `filaments.json` (4.4 KB; no code reads it) | **Delete**, after copying notes, flow ratio and pressure-advance values into the matching Bambuddy spool notes |
| `lab setup log` (drying, nozzle, calibration) | **Keep**; it feeds run records. Bambuddy maintenance overlaps only in part |
| `lab watch` / `lab status` print progress | **Keep** (terminal); small |
| `lab/printer/mqtt.py` (direct printer link) | **Question**: if live, it competes with Bambuddy's connection. Check use; delete if unused |
| Slicing wrappers, `exp stage/send/link`, `sync`, `pull`, `page*` (~3.5k lines of glue) | **Keep**; they are the integration with Bambuddy and Pi Hub |
| Questions, experiments, variants, guards, verify, runs, photos, observations, verdicts, cases, design gate, qualification | **Keep**; this is the domain logic the comparison itself says to keep |

The comparison's suggested model (Experiment → Variants → Print Jobs → Measurements → Evidence → Verdict, with
Bambuddy owning print records and print-lab referencing them) is already how print-lab works through `exp link` and the
`RUN-*.json` records. No new "experiment service" is needed.

## Cross-cutting findings

1. **Duplicate sources of truth that do exist today:** `filaments.json` vs Bambuddy spools; Pi Hub `prints`, `spools`
   and `samples` tables vs Bambuddy's archive and inventory (Pi Hub removed its shelf and board on 24 Oct; check
   whether `spools` and `prints` are now dead); the Pi Hub `lab_*` tables and the Mac's `projects/` are a deliberate
   copy (Mac writes, hub shows).
2. **A27 (15 Nov, flatter Assistant navigation)** already covers the LocalAI "many pages, many tabs" complaint; the
   earlier nav restructure proposal should be reconciled with it, not run separately.
3. **`docs/status.md` in Pi Hub is stale** (newest entry 2 Nov, specs run to A27); the "what is live" picture should
   come from `platform-roadmap`, not that file.
4. **Backup restore is unproven** (outstanding in `docs/status.md`); any migration should wait for one restore drill.

## Decisions for the owner

1. Delete `filaments.json` after the Bambuddy notes copy? (recommended: yes)
2. Check and remove Pi Hub's dead `spools`/`prints`/`samples` code and `lab/printer/mqtt.py` if unused? (recommended: yes,
   as one small audited PR each, via `/sprawl-audit`)
3. Spike Quick Print against Bambuddy's slicing? Installs nothing on the Pi if run on the Mac; needs the owner's OK to
   touch Bambuddy settings. (recommended: yes, bounded to one day)
4. Spike Open WebUI beside LocalAI for Chat, RAG and Models only, behind the Caddy gate? This is a new service on the
   PC or Pi, so it needs the owner's OK for the install and the gate route. (recommended: yes, two weeks, then decide)
5. Homarr, Home Assistant, n8n: not now. (recommended: close)

Nothing in 1 to 5 starts until the owner says so.

## Unknowns

- Pi Hub's live state (enabled units, whether A22 O4 retired Uptime Kuma, which per-app logins are gone).
- Which print-lab commands the owner actually uses (no usage data).
- Per-page `ui.js` size in LocalAI.
- Product claims in the pasted comparison (not verified here).
