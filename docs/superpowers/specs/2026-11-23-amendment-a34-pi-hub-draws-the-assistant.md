# Amendment A34: Pi Hub draws the Assistant; Local AI answers

Date: 2026-11-23 · Status: **proposed** (this PR) · Amends:
- A4 requirement 1 (a4:61-62, "separate origin, always… never a path under Pi Hub's origin") and its test (a4:62), for
  the **browser** only: Pi Hub's server may call allow-listed Local AI routes; no browser request is proxied.
- Baseline l.521 and l.1044 (`/assistant` frames its own origin), l.708-711 (§7: the Assistant pages are rendered by
  Local AI), l.827 and l.829 (failure table: "Pi Hub down → the Assistant on its own"), l.67 (D1) where it names who
  draws the Assistant.
- A22 §2.1 (a22:258-260, the Assistant draws its own content in the frame) and §4.1's **Asleep** row (a22:601) and
  "the banner replaces the content" (a22:608): for pages Pi Hub draws, stored content is shown under the banner.
  a22:606-607 (no wake-on-LAN) stand unchanged.
- A25 l.33 ("The Assistant stays on its own origin"), for the pages Pi Hub draws.

Builds on: A22 (one site, one sign-in), A25 (one action model, History), A27 (two levels; its page list is the one this
amendment uses), A30 D1/D2 (Pi Hub executes; read-only tools), A33 (owner decisions), baseline D8 (l.74, mirrors are
labelled and never authoritative). Leaves unchanged: A28 (memory core stays in Local AI), A30 D5 (house data never goes
to a cloud model), the Siri/Watch glance routes, the Workshop display's feed.

Read on 23 Nov 2026: pi-hub at `4c3f457`, LocalAI at `72f84dcb` (`~/dev/ai-harness/LocalAI`; paths below are under
`app/`). The owner's direction the same day: "what in the localai site can/should be moved/integrated into pihub",
"regardless of whether they truly run on the Pi or the Windows PC", "so all/most are API calls to the Windows PC, all
UI in the Pi?", then asked for a full, complete path. An independent review of the first draft (same evening) found 3
blockers and 10 major issues; this text includes its fixes. Under the frozen baseline this is a proposal until this PR
merges; nothing below is built or approved by being said.

## Why

The house has one site in name (A22) but two UIs in fact. Pi Hub draws its pages with kit 2.27.1; Local AI draws 35
views (`VIEWS` in `public/view-registry.js`) with kit 2.25.0 inside an iframe from its own origin
(pi-hub `hub/static/js/assistant.js:91-101`), with its own ⌘K palette, sheets, device-pairing sign-in, Web Push,
notifications inbox, audit log, health monitors and release list. The cost:

- **Every Assistant page is dead when the PC sleeps**, even pages that need no model (Claude Code board, audit log,
  morning brief, Shipped, Library): the frame shows `pc_off` with nothing.
- **Duplicates that disagree**: Local AI's push devices, sign-in report, notifications, `activities`, health monitors
  and `deployments`, beside Pi Hub's notify (ntfy), sign-in, Needs, `action_log`, selfcheck and release records.
- **Two UI codebases**: Local AI's page logic is `public/ui.js` (4,470 lines) and `public/app.js` (1,045), its kit two
  versions behind.

## Goals, non-goals, anti-goals

**Goals.** Pi Hub draws every Assistant page that is a list, a state or a plain form. Local AI is the engine: models,
runs, agents, research, images, spreadsheets, tools, the Improve queue and the Claude board, and their data. Every page
Pi Hub draws opens while the PC sleeps with the last answer it may keep, marked with its age. Each duplicate has one
owner. The Assistant keeps a way to work when Pi Hub is down (D9).

**Non-goals.** Moving models, runs or Local AI's data to the Pi. Redrawing Agent World, the developer tools, Atlas,
Spreadsheets, Claude Code chat or code-running Improve actions (they stay framed, tier 3). Wake-on-LAN (D7).

**Anti-goals.** A browser proxy from Pi Hub's origin to Local AI. A stale or failed read shown as empty. Local AI output
rendered as HTML on Pi Hub's origin. Pi Hub's key able to run code on the PC. Private Assistant data kept on the Pi
without the owner's choice (D10). Releases over their test budget.

## Constraints found

| Constraint | Evidence | Consequence |
|---|---|---|
| A4/baseline: the browser never reaches Local AI through Pi Hub; a test asserts no `site_hub` route proxies to it | a4:61-62; baseline:1044 | Pi Hub's **server** calls allow-listed JSON routes (as the display relay does: pi-hub `hub/display_ai.py:18` `FORWARD_PATHS`, `:172-230` `forward`). A4's test is narrowed, not removed |
| Baseline: when Pi Hub is down the Assistant works on its own (Home, Work, Improve, status) | baseline:829, 827 | Local AI keeps a standalone fallback for those pages (D9) |
| Local AI refuses unknown `Host` (421), cross-site writes (403), and treats a request as "from the PC" only without `X-Forwarded-For` | `server.js:463`; `server.js:390-402, 464`; `server.js:166`; `server/http.js:101-112` | The adapter calls Local AI at `https://10.0.0.81` (display_ai.py:15) with its own key; it never forwards the browser's headers |
| `X-LocalAI-Hub-Key` is accepted on 9 routes only | `server.js:183-200`; `hub-key.js` | P1 extends it to contract routes, by an explicit list |
| Improve, the Claude board and Claude findings are one data set, guarded together; Agent World reads live Claude sessions | `signin.js:28-35`; `server.js:440` (`claudeLiveNow()` into `/api/world`) | The board stays in Local AI; Pi Hub draws it (tier 1), it is not moved |
| Code-running actions are guarded: changes approve/stage/apply, engineering, PowerShell, workbench, computer, repo | `signin.js:15-18` and GUARDED list | These are **never** reachable with Pi Hub's key; they stay framed actions (tier 3) |
| Pi Hub has no household browser session; only the owner signs in | pi-hub `hub/auth.py:17-19, 144` | Every `/api/ai/*` call requires `auth.need(request, "owner")` (owner device included) |
| On the LAN, 10.0.0.81 is reachable directly; without Local AI sign-in "anyone on the LAN or tailnet can still read conversations and projects"; Pi Caddy's `site_assistant` strips only `X-Remote-User`, `X-Webauth-User` | pi-hub `docs/SECURITY.md:241`; `deploy/caddy/Caddyfile:61-76` | An owner assertion header means nothing without the key; Caddy strips it from browsers; `LOCALAI_SIGN_IN=required` becomes a P1 exit (D11) |
| Pi Hub already stores the house's place (name, lat, lon, tz) | pi-hub `hub/app.py:1486-1495`, `hub/outside.py:25`, read by weather `app.py:1269` | Local AI's `voice-home` setting retires; it reads Pi Hub's `place` |
| Pi Hub's push channel is ntfy; it has no Web Push | pi-hub `hub/notify_routes.py:1`; no Web Push in `hub/` | Turning off Local AI's Web Push needs a device-by-device check (D12) |
| Push subscribe needs the subscribing origin's service worker | `public/ui.js:4414-4467` | Local AI's Web Push cannot be relayed |
| Several pages compute in the browser from several calls; most responses carry no "as of" | `public/home.js:239` (4 calls, Needs client-side); `public/improve.js:75-123` (stage filters); status cards (4+ calls, browser time stamps) | P1 adds one server-side read per page, each with `as_of` |
| A route contract file and checker already exist | `atlas/contracts.json` (540 lines), `server/atlas-contracts.js` | P1 extends it rather than adding a second file |
| A27 is approved but its Local AI half (step 2) is not built; the page list lives in the kit's `pages.json` | A27 D2, D5; appliance-ui `pages.json` (`system: "assistant"` rows; `/assistant/system` present, no `/assistant/research`) | A34 uses A27's page list; A27 step 2 lands before P4; flipping a page's owner is an appliance-ui change synced to both apps |
| Streams: chat is SSE over POST (`server/chat.js:265`; 180 s default, clamp 30-900 s); missions SSE (`server/agents.js:225`); the run viewer polls every 3 s | — | `display_ai.forward` reads whole bodies under a cap and cannot stream; P5 extends it |
| Images: request bodies up to 30 MB base64; results served by `/api/images/view` | `server/images.js:156, 268` | Generating with a source image stays framed until measured (D3) |
| The Pi is the bottleneck | release pytest 883 s of its 900 s limit (`deploy/pi-hub-release:110`) on 23 Nov; 1,518 py + 684 js tests | P0 restores headroom; every phase has a test ceiling |
| Pi Hub's shell-update rule (pi-hub #308, open): while the Assistant frame is open an out-of-date page never reloads on its own, and `/assistant` links hand off to the frame via `retarget()` in `main.js` | #308 (`hub/static/js/main.js`, `shell-update.js`) | P4 revisits both for pages Pi Hub draws: they are ordinary Pi Hub pages (auto-reload applies, links don't retarget); the rule stays only for tier-3 framed pages |
| No History route on main yet | A25 §4; not found in `hub/` | Audit rows land in `action_log`; the History page is A25 step 20's |

## Design

### The shape

```
Browser ─(Pi Hub origin, owner session)─► Pi Hub page (kit) ─► /api/ai/<name>   (Pi Hub, owner-only, allow-listed)
                                                                  │ server-side · https://10.0.0.81 · installed CA
                                                                  │ · no redirects · X-LocalAI-Hub-Key (+ owner flag)
                                                                  ▼
                                                        Local AI contract route (JSON)
                                     last-known store on the Pi: only reads marked cache: owner (D10)

Pi Hub down ─► https://assistant.… directly ─► Local AI's standalone fallback (Home, Work, Improve, Status) (D9)
```

- **Adapter.** `hub/assistant_api.py` maps each `/api/ai/<name>` to exactly one contract route with its method, timeout
  and size cap. It requires `auth.need(request, "owner")` on every call (GETs included) and Pi Hub's same-origin check
  (`hub/app.py:71-115`) on writes. It is built by extending `display_ai.forward` into a shared client (per-route caps;
  streaming added in P5), not by widening `FORWARD_PATHS`.
- **Key and owner flag.** Local AI accepts the hub key only on routes the contract lists for it, and reads the owner
  flag (`X-Hub-Owner: 1`) only alongside a valid key; without the key the flag is ignored. Pi Caddy's `site_assistant`
  adds `request_header -X-Hub-Owner -X-LocalAI-Hub-Key` so a browser cannot send either. Owner-only code in Local AI
  that today treats `route-key` as not-owner (`signin.js:104-107`) gains an explicit case for key + flag on contract
  routes only.
- **Never reachable with the key:** `/api/changes/*` writes, `/api/engineering/*`, `/api/powershell/*`,
  `/api/workbench/*`, `/api/computer/*`, `/api/repo/*`, `/api/models/pull|delete`, `/api/atlas/ask|goose|snapshot`,
  `/api/claude/chat/*`. The contract lists these as `key: never`, and a Local AI test fails if any is granted. Pages
  that offer these actions show them as "Open on the PC" into the framed Local AI view.
- **Contract.** `atlas/contracts.json` gains a `pi-hub` consumer: per route, method, request and response shape, `as_of`
  field, size bound, `key: read | write | never`, and `cache: none | owner`. Compatibility across separate deploys:
  additive changes need no bump; a breaking change bumps the contract version, Local AI ships first and serves the old
  and new version together, Pi Hub's adapter states the minimum version it needs and shows "Assistant out of date" (its
  own error state) below it. Pi Hub keeps a synced copy for its tests, as with the kit.
- **Sleeping PC.** The adapter reads Pi Hub's `pc` record first: while it says off, calls use a 1-2 s connect timeout
  and a breaker (one probe per 30 s), so pages draw from the store at once. Each route has an in-flight cap. The store
  is written only when the payload changed or at most once a minute per route, and is pruned by size per route.
- **Last known.** Only reads marked `cache: owner` are stored (D10). The default is `none` for memory, owner facts and
  suggestions, conversations, journal, knowledge text, library item bodies and run answers. Stored rows are labelled a
  mirror of Local AI (baseline D8), never authoritative, and excluded from the off-site backup unless D10 says
  otherwise. A page whose read is `cache: none` says "needs the PC" while it sleeps.
- **States per page.** Loading; live; stale with age (PC asleep); stale with age (Local AI erroring); never read;
  needs the PC (uncached read); empty (live and truly empty); out of date (contract); refused (adapter); actions
  disabled with the reason. Writes while the PC sleeps are refused with "needs the PC", not queued (D13).
- **Untrusted text.** Local AI text is set as text. Where a page needs Markdown (chat, run answers) it uses one
  sanitiser with no raw HTML, links limited to `https:` and Pi Hub/Assistant/github.com hosts, and images only from
  `/api/ai/image/<id>` (the adapter's image route). That is the rationale A4 recorded for separate origins (Local AI
  output running on Pi Hub's origin), now handled by the sanitiser and tests.
- **Standalone fallback (D9).** Local AI keeps its current Home, Work, Improve and Status views, frozen (bug fixes only),
  at its own origin for when Pi Hub is down. P6 deletes every other moved view.

### Every page, where it goes

Page list: A27's (D2 two levels; D5 Activity folds Decisions, Signals and the audit log). Tier 1 = Pi Hub draws from
contract reads (P4). Tier 2 = Pi Hub draws, needs streaming or large bodies (P5). Tier 3 = stays a Local AI page in
the frame. F = also kept in the standalone fallback (D9).

| Local AI view(s) | Tier | Contract read(s) · `cache` | Gap to close in P1 | Phase |
|---|---|---|---|---|
| home (Needs, Pinned, Recent) · F | 1 | `home` (new: needs from `/api/runs?threads=1&kind=needs`, pins, approvals count, new signals) · owner | 4 calls merged in the browser, Needs worked out client-side; drop `/api/home/hub-needs` (Pi Hub's Needs echoed back) | P4e |
| work · F | 1 | `/api/runs?threads=1&limit&kind&before` · owner (titles and status only) | thread folding → server; `as_of` | P4d |
| automationStudio | 1 | `automations` (new: automations + runs + monitors) · owner | 2-3 calls merged | P4d |
| projects | 1 | `project?id` (new, replaces 3-call fan-out) · owner (names, counts) | fan-out | P4c |
| knowledge (Sources) | 1 | `/api/knowledge` list · owner (titles only); search/import live only | import size bound | P4c |
| memory, owner facts | 1 | `/api/memory`, `/api/facts/suggestions` · **none** | unbounded → paging | P4c |
| library | 1 | `/api/library` · owner (titles, kinds), bodies none | capped 250 → paging | P4c |
| Improve: backlog, inProgress, shipped, signals · F | 1 (read) + 3 (code-running actions) | `improve?stage=` (new), `/api/quality`, `/api/claude/priorities` · owner | stage filters → server; paging; Shipped's evidence rows built in the browser (5 hard-coded "unconnected") → read Pi Hub release records | P4b |
| claude (board) | 1 (read) | `/api/claude/board` · owner (sessions, findings titles) | stays Local AI's data (board = Improve queue, feeds `/api/world`) | P4b |
| claude chat (`/api/claude/chat/*`) | 3 | — | pairing and the Mac relay | framed |
| research | 1 | `/api/research/state` · owner | shape not fully known: pin it in the contract | P4b |
| status · F | 1 | `status` (new: status + gridcraft/artcraft/workshop health + watch + capabilities) · owner | 4+ calls with browser time stamps → one read with `checkedAt` | P4a |
| models, routing | 1 (read; pull/delete tier 3) | `/api/models`, `/api/models/pulls`, `/api/models/routing`, feedback summary · owner | `/api/ps` (ui.js:786): confirm the route or drop it | P4a |
| settings | split | pins, opens, access, releases → P4a reads; push, sign-in report, home location → P3 | — | P3, P4a |
| Activity (A27: Decisions history, Signals list, audit log) | 1 | audit via Pi Hub `action_log`; decisions history `/api/approvals` · owner | A27 step 2 builds Activity first | P4b |
| chat (`home?mode=ask`), run viewer | 2 | `/api/chat/stream` (SSE), `/api/runs?id`, `/api/runs/answers`, cancel, retry · none | stream relay; keep 3 s polling | P5 |
| create (Images) | 2 / 3 (D3) | `/api/images/models`; `/api/images/view` via `/api/ai/image/<id>` · none | 30 MB generate bodies | P5 or framed |
| spreadsheets | 3 | — | drives Excel on the PC; 15 MB uploads; 360 s runs | framed |
| agents (Agent World), Main Street | 3 | — | ~190 KB of art code; missions SSE | framed |
| tools: workbench, repoTools, powershell, actions, n8n | 3 | — | code-running; PowerShell is localhost-only (`server/powershell.js:24`) | framed |
| architecture (Atlas) | 3 | — | its own service on the PC (127.0.0.1:8765) | framed |

### Not pages: every other route group, job and store

| Item | Disposition |
|---|---|
| `/api/glance*` (Siri/Watch), `/api/display/*` (Workshop display feed, pairing), `/api/world`, `/api/attention` | unchanged; already used by their callers (Pi Hub reads `world` and `attention` with its key) |
| `/api/lab/*` (Mac print-lab mirror: `print-lab.js`, `lab-callers.js`, `display-lab.js`) | unchanged in A34; it serves the display and Agent World. A later clean-up may read Pi Hub's lab instead |
| `/api/workshop/camera`, `/api/workshop/status`, `/api/workshop/portal-code` | camera and status feed the Status read (P1) and Agent World; unchanged |
| `/api/quality/client-event` (browser errors from Local AI pages) | Pi Hub pages report their own errors to Pi Hub; Local AI's Signals gains a `pi-hub` source from the adapter's refusals and contract errors (P2), so Signals doesn't go quiet |
| `/api/quality/scan`, `/api/issues/*` | Local AI keeps them; Signals read via `improve` |
| `/api/runs/seen`, `/api/items/delete|restore`, `/api/nav/*`, `/api/projects/intelligence` | contract writes/reads for the pages that use them (`key: write` for seen, items; nav pins move to Pi Hub's ⌘K pins in P4a) |
| `/api/journal/*` | behind chat; tier 2 |
| Background jobs: automation (30 s) and monitor (60 s) schedulers, quality scan (5 min), research intake and reader (30 s), health transitions (60 s), watchdog, trash purge, Atlas release poller, fact-suggestions, improve reconcile | all stay in Local AI; only the health-transition **alerts** change owner (P3) |
| PWA shell: `manifest`, `public/sw.js`, `public/offline-copy.js` | stay for the fallback and tier 3; `sw.js` stops precaching moved views in P6 |
| Data stores (`localai.db`, JSON files) | stay in Local AI; Pi Hub holds only labelled `cache: owner` copies |

### The duplicates and their one owner (P3)

| Today in Local AI | Owner after A34 | How | Needs first |
|---|---|---|---|
| Web Push (`/api/push/*`, VAPID, devices) | Pi Hub notify (ntfy) | every Local AI event kind already goes to `POST /api/notify/localai` (`hub-notify.js:22-35`; kinds in pi-hub `notify_routes.py:19-34`); Local AI's Web Push turns off only after D12's device check | D12 |
| Notifications inbox (`notifications`) | Pi Hub Needs + notify | the inbox view retires with A27's Activity | A27 step 2 |
| Sign-in report and pairing | Pi Hub sign-in for Pi Hub-drawn pages | pairing stays for the fallback, tier 3 and Shortcuts | P1 |
| Home location (`voice-home`) | Pi Hub `place` (exists) | Local AI reads Pi Hub's place (A30 D2's read list gains it); its setting retires | — |
| Audit log (`activities`) | Pi Hub `action_log` (`hub/auth.py:28-44`) | new `POST /api/records/localai/activity` with Local AI's deploy key (the notify key model); shown in History when A25 step 20 builds it | — |
| Shipped › Running now (`deployments`) | Pi Hub release records | `POST /api/releases/localai` exists (`hub/releases.py:34-72`); Shipped reads `/api/records` | — |
| Health alerts (monitor and status transitions) | Pi Hub Needs and notify, with Local AI's `status` as a source | Local AI still probes its own services; Pi Hub decides what needs the owner and alerts once | P1 `status` read |
| Morning brief (`/api/brief`, no model) | drawn on Pi Hub Home | read through the adapter, `cache: owner` | P2 |

The Claude board is **not** a duplicate: it is Local AI's Improve queue and stays there (drawn by Pi Hub in P4b).
`/api/claude/events` already needs a device or the Mac key (`signin.js:33`); that any paired device, not only the Mac,
may post events is a narrower follow-up for `/fix`, outside A34.

## Phased roadmap

Each phase is its own plan (platform-plan) and PRs, gated by the repo's engineer agent, ui-ux-reviewer and qa-release.
A phase starts when the previous one is deployed and runtime-verified, except where "needs" says otherwise. Every phase
states its added test time and must keep Pi Hub's release tests under the P0 ceiling.

| Phase | Repo(s) | What | Needs | Done when |
|---|---|---|---|---|
| **P0 Headroom** | pi-hub, LocalAI | Pi Hub release tests under 600 s on the Pi (find and fix the slow tests; raising the 900 s limit only with D8). LocalAI kit sync 2.25.0 → current | — | three releases in a row under 600 s; LocalAI on the current kit |
| **P1 Contract and auth** | LocalAI, pi-hub (Caddy) | `atlas/contracts.json` `pi-hub` consumer v1; hub key + owner flag on contract routes only, `key: never` test; merged reads (`home`, `improve?stage`, `status`, `automations`, `project?id`); paging for memory, library, improve; `as_of` everywhere; Caddy strips the owner and key headers; `LOCALAI_SIGN_IN=required` (D11) | P0 | contract tests green in both repos; each read checked live from the Pi with the key; a browser request with the flag and no key is refused |
| **P2 Adapter and last known** | pi-hub | `hub/assistant_api.py` (owner-only, allow-list, caps, breaker on the `pc` record, in-flight caps); last-known store with `cache` flags and pruning; one probe page (`/assistant/status`) with every state; A4's test narrowed to "no browser route proxies to Local AI; only `/api/ai/*` allow-listed server calls" | P1 | status page live; stale state seen live with the PC off; adapter refuses an unlisted path and a `key: never` path |
| **P3 One owner each** | pi-hub, LocalAI | the rows above, one PR per row, in the order their "needs" allow | per row | each duplicate's Local AI copy is off, nothing still reads it (fallback and tier 3 checked), and its Pi Hub owner shows the same data live |
| **A27 step 2** | LocalAI | already approved; Activity, Ask, two levels | — | before P4 |
| **P4 Tier 1 pages** | pi-hub, appliance-ui, LocalAI | one area per PR: **a** System (Status, Models, Settings), **b** Improve (Changes and tabs, Claude board read, Research, Activity), **c** Projects (Projects, Sources, Memory, Library), **d** Work (Work, Automations), **e** Assistant Home (last; reads every other area). Each flips its rows' `system` in the kit's `pages.json` (appliance-ui PR, then sync) and points Local AI's view at the Pi Hub address, except fallback views (D9) | P2, P3 rows the area shows, A27 step 2 | the area works live with the PC on, shows stale or "needs the PC" with it off; width sweep, axe, keyboard, light/dark at 390/768/1366 |
| **P5 Tier 2** | pi-hub, LocalAI | measure first (Pi CPU, memory, temperature during a 180 s stream and a 10 MB body); then the streaming adapter, chat with cancel and resume by run id, the run viewer, images per D3 | P4 | a chat turn and a cancel work through the Pi; Pi stays within the measured budget |
| **P6 Retire** | LocalAI | delete moved views from `ui.js`/`app.js` (except the fallback set), retired routes (Web Push after D12, inbox, `activities` writes, `deployments`), unused kit files, `research-findings.js`, legacy `#agentRuns`; `frame-ancestors` for tier 3 only | P4, P5 | sprawl baseline down; fallback and tier 3 still work |

## Decisions for the owner

| # | Question | Recommended | Alternatives |
|---|---|---|---|
| D1 | How does Pi Hub get Local AI's data? | **Server-side adapter on an allow-list**; the browser never reaches Local AI through Pi Hub | browser proxy (breaks A4); keep everything framed |
| D2 | Does chat move to Pi Hub? | **Yes, in P5, after measuring the Pi** | chat stays framed |
| D3 | Images? | **Gallery and plain prompts in Pi Hub (P5); generate-with-source and Fix a part stay framed** until a 30 MB body is shown safe | all in Pi Hub; all framed |
| D4 | Tier 3 (Agent World, tools, Atlas, Spreadsheets, Claude chat, code-running Improve actions) | **Stay framed on Local AI's origin** | redraw later under a new amendment |
| D5 | Local AI sign-in after the move | **Hub key + owner flag on contract routes; pairing kept for the fallback, tier 3 and Shortcuts** | retire pairing |
| D6 | Home location | **Pi Hub's existing `place`**; Local AI reads it, its setting retires | keep both |
| D7 | "Wake the PC" | **Not in A34**; a separate amendment if wanted | add here |
| D8 | Release test budget | **Under 600 s by fixing tests**; raise 900 s only if that fails, with your yes | raise now |
| D9 | When Pi Hub is down | **Keep Local AI's Home, Work, Improve and Status as a frozen standalone fallback** (baseline l.829 holds) | accept that the Assistant's UI is down with Pi Hub (amend l.829) |
| D10 | May private Assistant data be cached on the Pi? | **Only titles, counts and states (`cache: owner`); never memory, facts, conversations, knowledge text, run answers; the cache is left out of the off-site backup** | cache everything the pages show; cache nothing |
| D11 | Set `LOCALAI_SIGN_IN=required` | **Yes, at the end of P1** (closes LAN reads, docs/SECURITY.md:241) | stay in report mode |
| D12 | Retire Local AI's Web Push | **After checking each device gets the same alerts by ntfy**; until then both run | keep Web Push; retire at once |
| D13 | Writes while the PC sleeps | **Refuse with "needs the PC"** | queue on the Pi and replay |
| D14 | Order relative to A27's build | **A27 step 2 (Local AI) before P4** | restate A34's rows in pre-A27 terms and go first |

## Evidence required (completion criteria)

1. Every tier-1 page opens on Pi Hub's address, drawn with the kit, with the PC on (live) and off (stale with age, or
   "needs the PC" for uncached reads; actions disabled with the reason): screenshots of both per area.
2. No browser request from a Pi Hub page reaches Local AI's origin; the adapter refuses unlisted and `key: never` paths;
   a browser cannot send the owner flag or the key through `site_assistant`: tests and live refusals.
3. Local AI text with markup is drawn as text; Markdown pages drop raw HTML and off-list links: tests per page type.
4. Each P3 duplicate has one live owner; its Local AI copy is off and nothing (fallback, tier 3) still reads it.
5. A breaking contract change without a version bump fails tests in both repos; Pi Hub shows "Assistant out of date"
   when Local AI is older than its minimum: shown once.
6. Pi Hub release tests under 600 s on the Pi for three releases after P4; Pi temperature and load recorded during a P5
   chat stream.
7. With Pi Hub stopped, the fallback's Home, Work, Improve and Status work at the Assistant's own address (D9).
8. Width sweep, axe, keyboard, light/dark at 390, 768 and 1366 for every page Pi Hub draws.
9. Recorded in `docs/operations.md` under "Pi Hub draws the Assistant (A34)" as "Accepted <date>", phase by phase.

## Risks

| Risk | Mitigation |
|---|---|
| The Pi becomes a single point of failure for the Assistant | the fallback (D9); tier 3 stays on the PC |
| The Pi runs out of headroom (tests, CPU, heat) | P0 first; per-phase test ceiling; P5 measured before built |
| Pi Hub's key widened into code execution | `key: never` list with a failing test; code-running actions stay framed |
| Owner flag spoofed | ignored without the key; stripped by Caddy; Local AI sign-in required (D11) |
| Private data on the Pi and in backups | `cache` flags, private reads `none`, cache outside the off-site backup (D10) |
| Contract drift across separate deploys | additive by default; versioned breaks served N and N-1; "out of date" state |
| Two copies disagree during migration | each P3 row turns the Local AI copy off in the release that turns Pi Hub's on, after checking its readers |
| Stale data read as current | `as_of` on every read; stale is a drawn state |
| A dead PC slows Pi Hub | breaker on the `pc` record, short timeouts, in-flight caps |

## Left to the builder

Adapter route names, the store's schema and pruning numbers, per-route caps and timeouts within the contract's bounds,
PR splits inside a phase, the sanitiser's implementation, test fixtures.

## Out of scope (noted, not gated)

- Wake-on-LAN (D7).
- The Workshop display's two pairings (Pi Hub `display_pairing.py`, Local AI `/api/display/pair`).
- `/api/claude/events` accepting any paired device rather than only the Mac key: a `/fix`.
- `/api/lab/*` reading Pi Hub's lab instead of the Mac mirror.
- `models` is the only Local AI view built at runtime (`ui.js:369`): fold into P6 or a sprawl pass.
