# A34 capability tracker

Date: 24 Nov 2026 · Tracks: amendment A34 and its Amendment 1 · Read: Local AI `cfff3458`, pi-hub `58891bd`

One row per Local AI capability. A migrated workflow is one row, not coverage. Three columns move independently, and
"merged" and "deployed" are recorded per PR in the last table, never inferred from a row.

**API** (can a server-to-server caller on the Pi use it, today):
`as-is` usable now in report mode · `auth` needs the hub key and owner flag added (P1a/P1) · `new read` needs a merged
contract read · `never` code-running or host-level, stays off the key (`key: never`) · `none` no route.
Every `as-is` row becomes `auth` when `LOCALAI_SIGN_IN=required` (D11) unless it is on the allow-list.

**Native UI** (drawn by Pi Hub): `not started` · `in PR #n` · `drawn` (merged) · `framed` (stays a Local AI page, by
design, A34 D4) · `fallback` (also kept in Local AI as the D9 standalone).

**Verification** (what has actually been seen): `none` · `tests` (repo suites) · `live-on` (live, PC on) · `live-off`
(live, PC asleep: stale with age, or "needs the PC") · both = `live-on+off`. Nothing below is verified yet.

## Views (the 30 in `view-registry.js`)

| Capability | Local AI routes | Windows service | API | Native UI | Verification | Phase |
|---|---|---|---|---|---|---|
| home | `runs?threads=1&kind=needs`, nav, `approvals`, `home/hub-needs` | none | as-is per read; merged `home` = new read | not started | none | P4e (fallback kept) |
| inbox / Decisions | `notifications`, `approvals`; decide guarded | none | as-is read; write auth | not started | none | P3 / A27 step 2 |
| work / runs | `runs` (`id`, `threads`, `kind`, `before`), `runs/answers`, `runs/seen`; `cancel`, `retry`, `update`, `feedback` guarded | none | read as-is; **cancel auth (P1a)**; retry auth | **task view in this set** (read, cancel); list in P4d | none | P2n, P4d |
| ask / chat | `POST chat` (hub key), `chat/stream`, `route`, `journal/ask` | Ollama | `chat` as-is; `chat/stream` auth + streaming client | framed until P5 | none | P5 |
| create / images | `images/models`, `checkpoints`, `generate` (30 MB), `images/view` (hub key) | ComfyUI | view as-is; models as-is; generate auth | framed (D3) | none | P5 / framed |
| projects | `projects`, `create`, `update`, `projects/intelligence`, `conversations*` | none | read as-is; `project?id` new read | not started | none | P4c |
| knowledge (Sources) | `knowledge`, `import`, `delete`, `search` | none | list as-is; import auth | not started | none | P4c |
| memory, owner facts | `memory` + writes guarded; `facts/suggestions` guarded | none | memory as-is (cache none); facts auth | not started | none | P4c |
| library | `library`, `update`, `delete`, `keep`, `items/*`, `workspace`, `activity` | none | read as-is | not started | none | P4c |
| status | `status`, `capabilities`, `watch`, `workshop/status`, `gridcraft/health`, `artcraft/status` | Ollama, ComfyUI, n8n, GridCraft bridge, ArtCraft, Workshop display | each as-is; **contract `status` = new read (P1a)** | **in this set** (Status page) | none | P1a, P4a (fallback kept) |
| models | `models`, `models/pulls`, `models/routing`; `pull`, `delete`, `PUT routing` guarded | Ollama | reads as-is (502 on Ollama down: **contract `models` = new read (P1a)**); pull/delete never | **in this set** (read-only list); pull/delete framed | none | P1a, P4a |
| agents / Agent World | `agents/*`, `missions/start`, `mission?id`, `missions/events` (SSE), `world` (hub key) | Ollama, SearXNG | `world` as-is; **`missions/start`, `mission?id` auth (P1a)**; SSE auth | **task flow in this set** uses start/mission; the world view is framed | none | P2n; world framed (D4) |
| automationStudio | `automations*`, `monitors*`, `brief` | Ollama (runs), SearXNG | read as-is; `automations/run` blocks, no id | not started | none | P4d |
| Improve: backlog, inProgress, shipped, signals | `improve/items` guarded, `improve/*` writes guarded, `changes*` guarded, `quality`, `issues*`, `engineering/*` guarded | host (self-update) | `quality`, `issues` as-is; `improve/items` auth; code-running never | not started; code-running framed | none | P4b |
| spreadsheets | `gridcraft/*` (health, run, runs, progress, workbook(s), upload, cell, download, keep/discard) | **GridCraft, Excel** | health, progress as-is; writes guarded | framed (tier 3) | none | framed |
| research | `research/*` all guarded | none (SearXNG fetches) | auth; shape not pinned | not started | none | P4b |
| claude (board) | `claude/board`, `priorities`, `findings`, `events` guarded; `claude/chat/*` | none (Mac relay) | board auth; chat never | board not started; chat framed | none | P4b |
| architecture (Atlas) | `atlas/*` (ask, goose, snapshot guarded) | Atlas service 127.0.0.1:8765, Ollama | never | framed | none | framed |
| workbench | `workbench/*` guarded | host filesystem | never | framed | none | framed |
| repoTools | `repo/inspect`, `workbench/command` guarded | host git, node | never | framed | none | framed |
| powershell | `powershell/*` guarded, localhost-only (`server/powershell.js`) | **PowerShell on the Windows host** | never | framed | none | framed |
| actions (Browser and computer) | `browser/fetch`, `actions/http-check`, `computer/batch` guarded | host | never | framed | none | framed |
| automations (n8n) | links; `n8n` in `status` | n8n container | none | framed | none | framed |
| tools | menu over the five tool pages, no route | none | none | framed | none | framed |
| settings | `access`, `releases`, `nav/pins`, `nav/opens`, `signin/report`, `push/*`, `voice/home` | none | reads as-is; push browser-bound | not started | none | P3, P4a |
| activity (Audit log) | `activity`, `activity/clear` | none | read as-is | not started | none | P4b |

## Not views: route groups and jobs

| Item | Disposition | API | Native UI | Verification |
|---|---|---|---|---|
| `/api/display/*`, `/api/watch*`, `/api/glance*` | unchanged; Workshop display, Siri/Watch | some hub-keyed | n/a | existing |
| `/api/lab/*` (print-lab mirror; `lab/projects` hub key) | unchanged in A34 | as-is | n/a | existing |
| `/api/journal*` | behind chat | auth | with chat (P5) | none |
| `/api/storage/status`, `/healthz` | liveness | as-is | n/a | none |
| background jobs (automation 30 s, monitor 60 s, quality 5 min, research intake, health transitions, watchdog) | stay in Local AI | n/a | n/a | n/a |

## Windows services and how each looks when it is down (Local AI's wording, which Pi Hub reuses)

| Service | Down state shown | Impact line | Action line |
|---|---|---|---|
| Ollama (core) | Down / Degraded; "Not answering right now." | "Chat, research and missions are unavailable." | "Start Ollama on the Windows host." |
| ComfyUI | Down | "Images are unavailable." | "Start ComfyUI on the Windows host." |
| n8n | Down | "Workflows and scheduled automations are paused." | "Start its container in Docker Desktop on the Windows host." |
| SearXNG | Down | "Research and current facts are unavailable." | same, Docker Desktop |
| Proxy | Down | "Apps that talk to Local AI through its compatible endpoint are cut off." | same, Docker Desktop |
| GridCraft / Excel | "Optional · Offline"; bridge up, Excel not connected = Degraded; 502 "GridCraft bridge unavailable (code)", 504 "took too long to answer" | Spreadsheets: "Windows computer not answering" | "Check that it is on and GridCraft is open, then choose Refresh." |
| ArtCraft | "Windows computer not answering" / "Installed, not open" / "Not installed" | - | - |
| Workshop display | "Status unavailable", "Address not set up", "Not answering" | printer status sub-messages | - |
| Home, DSH (Mac, optional) | "Optional · Offline" | "Core appliance unaffected" | "Open the Local AI app on your Mac." |
| The PC asleep or off | Pi Hub's `pc_off` (the kit's phrase) | stale content with age, or "needs the PC" | - |

Pi Hub draws each of these from the P1a `sources` map: a source with `state: "failed"` shows its row above; `unknown`
is "not read yet"; none of them is ever drawn as empty or healthy.

## Pull requests (merged and deployed are recorded here, not above)

| PR | What | Implemented | Verified | Merged | Deployed |
|---|---|---|---|---|---|
| appliance-ui #52 | kit 2.29.0 shared shell | yes | tests | yes (`9f5675e`) | n/a (kit) |
| pi-hub #332 | kit sync 2.29.0 | yes | tests | no | no |
| (this docs PR) | A34 Amendment 1 and this tracker | yes | n/a | no | n/a |
| pi-hub: shell adoption, Home | branch `feat-kit-shell` | in progress | none | no | no |
| LocalAI: P1a reads and allow-list | to open | in progress | none | no | no |
| pi-hub: adapter, status, models, task | to open | not started | none | no | no |
| appliance-ui: registry rows | to open | not started | none | no | no |
| LocalAI: kit sync and shell adoption (with `fix-mobile-shell`) | to open | not started | none | no | no |
