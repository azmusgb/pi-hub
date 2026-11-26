# Amendment A35: Mission Control — initiatives, decisions and evidence in Pi Hub; Agent World draws them

Date: 2026-11-24 · Status: **proposed** (this PR; approval is its merge; D1-D10 answered as recommended, 24 Nov) · Amends:
- **A34 D4** (Agent World stays framed, tier 3) and A34's page-table row "agents (Agent World), Main Street": the
  initiative views become Pi Hub tier-1 pages. Agent World's spatial renderer stays framed in Local AI. From M5 it
  draws initiative state that Local AI's server reads from Pi Hub. It is never a source of that state.
- **A33** §Design "Record", "Calls made" 2 and 6, and the anti-goal on taps. The old rules were one source (`claude`),
  two to four options, a 280-character question, `choice | text` only, and "a tap only records". Under A35:
  - the `decisions` table gains the fields and kinds in §9;
  - a `multi`, `rank`, `number` or `approve` answer may also accept a ledger change (a plan revision, a gate verdict)
    in Pi Hub's own records;
  - a tap still never merges, deploys, restarts, prints or changes a house setting.
- **Baseline §7** (page ownership): new Pi Hub pages `/missions` and `/missions/<id>` in the kit's `pages.json`, area
  `system`.

Builds on:
- A25: one action model, and History.
- A30 D1: Pi Hub executes house actions.
- A31/A32: research intake.
- A33: owner decisions.
- A34: the adapter, `cache` flags, D10 (what may be stored on the Pi) and D13 (writes refused while the PC sleeps).
  A35 follows both D10 and D13.
- Baseline D8: mirrors are labelled and never authoritative.

Leaves unchanged:
- Main Street on Local AI Home.
- Local AI's run ledger and mission orchestrator.
- print-lab's experiment engine and printing rules.
- The owner's `CLAUDE.md` and `permissions.ask` rules. D2 proposes no change to them in v1.

Read on 24 Nov 2026:
- pi-hub `653dc50`, LocalAI `cfff3458`, appliance-ui `06cdf6c` (kit 2.27.1), home-mcp `a5b129e`.
- `~/.claude/settings.json` and its hooks.

The owner's direction:
- 24 Nov: the "A34 Additional Mandate — Agent World Evolution and Interactive Mission Control".
- The same day: "as recommended" to approach C (a hybrid with a Pi Hub ledger).

Before this PR, a builder check and an independent review read the first draft. The review found 3 blockers and 8
major issues. This text includes the fixes; §19 lists them. Under the frozen baseline this is a proposal until this PR
merges. Nothing below is built or approved by being said.

## 1. Why

The owner's engineering work (A34 is the example) happens in five places:
- Claude Code sessions on the Mac;
- spec and plan files in git;
- GitHub PRs and checks;
- Pi Hub releases;
- A33 decisions.

Agent World sees almost none of it. It draws Local AI's own missions: short jobs where a router hands work to
specialists and a synthesis step combines their answers. Those jobs only read Local AI's own source code
(`agent-orchestrator.js:106`).

So there is nowhere to:
- see an initiative's stages, gates, open decisions, evidence and live work together;
- answer a structured decision with its alternatives and evidence;
- steer the work.

What does exist goes dark when the PC sleeps.

## 2. Current state (evidence)

### 2.1 Agent World (LocalAI)

| Area | What exists | Evidence |
|---|---|---|
| Renderers | Two canvas-2D renderers. **City**: IIFE in the hand-edited `ui.js` (~1,000 lines), 1280×760 world, 40×23 grid, 8 fixed districts, A* walking. **Main Street**: 15 modules under `public/street/`, side-scrolling strip on Home, 10 buildings, DOM chips for text, rAF stops when still | `ui.js:1157-2164`, `:1159`, `:1176-1186`, `:1240-1281`; `street/street.js:10-27` |
| Budgets | `aw/*` 12 KB gz total (4 KB/file, never in the shell); `street/*` 60 KB gz (8 KB/file); shell 370 KB | `tests/budgets.test.cjs:237-284` |
| World model | City sprites = mission `workers[]`; role → district by `ROLE_ZONE`; error/blocked → Repair. Street buildings fed by `buildStreet()` from runs (3 running, 3 recent, 3 needs-you, 3 failed each); Claude Yard from `world.crews` (≤6) | `ui.js:1186`, `:1219`; `world-street.js:19-68`; `street/yard.js:4-9` |
| Mission record | `missions` collection, newest 200; states `running/complete/needs_attention/error`; workers `pending/running/complete/error/blocked` with `model`, `dependsOn`, `routingMeta`; `timeline` (10 event types), `toolEvents` (≤200), `evidenceRecords{id,source,kind,excerpt}`; interrupted missions marked `error` on restart. Missions are runs (`type:'agent'`, `cancellable:true`, AbortController) | `agent-orchestrator.js:177-279`, `:198`, `:205`, `:218`; `server/agents.js:199-204` |
| Router | Scores and picks specialists by fixed rules; no model involved. Some dependencies are hard-coded: docs wait for research and UX; tests, security and perf wait for code analysis. The coordinator may add ≤2 follow-up workers | `agent-orchestrator.js:54-88`, `:66-74`, `:170-177` |
| Sync | Mission SSE sends the whole record on every tool event, with no `id:`, no `Last-Event-ID` and no replay. The client refetches the list on reconnect. `/api/world` is polled every 10 s with ETag; the Claude board every 4 s | `server/agents.js:224-227`; `ui.js:1163-1174`, `:2159-2179`; `aw/landmarks.js:1-8` |
| Replay | Frames recorded **in the browser** (localStorage, 120 frames) when the City sees a change; the server keeps only the record's own timeline | `ui.js:1205`, `:1309`, `:1316-1326` |
| Approvals | `approvals` store: binary `pending/approved/rejected`, cap 500. The orchestrator never references approvals (0 hits), so nothing in a mission waits on one. Only `meta.changeId` ties an approval to a change | `server/notifications.js:54-72` |
| Mission Control (#619) | Read-only projection: stage, `n of m` workers, blockers, evidence, and "revisions" (the initial route plus `followup`/`fallback` events). Its decisions are a hard-coded **demo** kept in localStorage `localai.agentWorld.missionControlDemo.v1` | `aw/mission-control.js:2-18` |
| Claude | `POST /api/claude/events` from the Mac hook `localai-progress.py`: session id, short cwd, tool label, phase, status. A session is "live" if its newest event is under 30 min old. It is "working" if that event is under 2 min old and its title is not the literal `"Finished responding"`. Model, branch, PR, subagent stop and permission waits are not sent | `server/changes.js:596`, `:781-813`; `~/.claude/hooks/localai-progress.py` |
| Auth | Mission and world GETs are not guarded; mission writes and Claude routes are; sign-in mode defaults to report-only | `signin.js:3-6`, `:15-40` |
| Size | City ~1,008 lines; street ~1,579; orchestrator 283; `aw/*` 162 | non-empty line counts |

**Synthetic or decorative today** (in the City unless noted):
- Six looping traffic cars, not tied to any state.
- Birds, clouds and an 8-minute day cycle.
- Fireworks, confetti, sparks and flow packets.
- An idle crew of five named roles, shown when no mission exists.
- `demo-city-mission`, labelled Demo.
- Artifact icons, one per completed worker; they are not files.
- Mission progress clamped to 5-95 % (`agents.js:208`).
- Street: night is set by the wall clock.
- Claude Yard shows "No sessions" when the crews read fails (`yard.js:19`), so an unknown is shown as empty.

### 2.2 Around it

| System | What exists | Evidence |
|---|---|---|
| Pi Hub decisions (A33) | `decisions(id, source, question, options, recommended, link, kind, created_at, answered_at, answer, answer_note, supersedes)`. Kinds: `choice` (2-4 options) or `text`. Answering is owner-only and same-origin. The answer write is conditional on `question` and `options`, so a double tap is safe and a changed question gets 409. An open `id` asked again is rewritten in place. Only the Mac key can add a decision (`SOURCES={"claude"}`). Answered rows are trimmed to 50. Each answer is logged in `action_log`. Body cap 8 KB | `hub/decisions.py:23-45`, `:164-214`, `:271-312` |
| home-mcp `decisions` | Key-gated read. Text is wrapped as untrusted. A failed read is not shown as empty. An unknown `kind` or option shape fails the **whole** read | `home-mcp/src/home_mcp/decisions.py:11-99` |
| Pi Hub records stream | `GET /api/records/stream` SSE; each subscriber holds a default-executor thread (`asyncio.to_thread(q.get…)`) with an unbounded queue and no resume | `hub/app.py:196`; `hub/records.py:269-303` |
| Pi Hub releases and keys | Deploy evidence per target. `KEY_FOR` maps `mac-watch`, `x2d-bridge-mac` and `print-lab` all to one `mac` key; `deploy/deploy-key.sh` makes keys. Pi Hub's own release already reports its test seconds (A34 P0), but `releases.valid()` has no test field for other targets | `hub/releases.py:34-36`; `deploy/pi-hub-release:108-113` |
| `pc` record | on/off/unknown from netmon with 5-min grace | `hub/things/house.py:43-61` |
| `action_log` | flat, 90-day retention, `result` ≤200 chars | `hub/auth.py:28`, `:241-250` |
| Kit | 2.27.1. `ui-tabs` (≤5 tabs; 6 shown as rows; 7 means two pages), rows, chips, `ui-meter` only with a real fraction, `renderDecisions` (choice and text). The honest-states table has no Imported or Observed state. There is **no** graph, timeline, inspector or side-sheet component | appliance-ui `DESIGN.md:237-298` |
| Claude Code hooks in use | `localai-progress.py` and `localai-chat/hook.py` are both `async: true`, so neither can block or steer. `permissions.ask` covers `gh pr merge*`, and `defaultMode` is bypass | `~/.claude/settings.json` |
| Owner-question skill | Sessions check `mcp__home__decisions` first, then post with the Mac key. Merge and deploy go-aheads are excluded | `~/.claude/skills/owner-question/SKILL.md` |

### 2.3 Verdict

- **Keep and reuse:**
  - Local AI's mission record, its timeline and evidence.
  - `/api/world` and the Claude event ingest.
  - A33's table, routes, conditional write and untrusted-text handling.
  - `releases.py` and `deploy-key.sh`.
  - Main Street's engine: chips over the canvas, still when idle, size budgets.
- **Replace:**
  - The City renderer: fixed topology, decoration, browser-side replay.
  - The Mission Control demo decisions.
- **Missing everywhere:**
  - An initiative above a single run.
  - Structured decisions with evidence.
  - Any notion of verification, review or acceptance.
  - Durable server-side history.
  - Any authorization that something outside the agent enforces.

## 3. Goals, non-goals, anti-goals

**Goals.** One place to understand, direct and govern an initiative:
- See its stages, gates, workstreams, tasks, current and past executions, evidence, risks and decisions in one place.
- Read it on the phone while the PC sleeps.
- Answer decisions with their alternatives, a recommendation and evidence.
- Use controls that say honestly whether they were delivered and applied.
- Trace every visual state to a record.
- Reuse it for engineering, research, experiments and improvement work.

**Non-goals.**
- Running agents on the Pi.
- Replacing Local AI's orchestrator, GitHub, git or print-lab.
- A general project tracker: no deadlines, assignees or comments.
- Live token or reasoning streams.
- Gantt charts.

**Anti-goals** (a failure even if it works):
- A figure, percentage or "live" label not backed by a record and a fresh timestamp.
- An import, a self-report or a demo shown as live or verified.
- An unknown shown as idle, empty or done.
- A tap that runs anything.
- A guard described as enforcement when the governed agent can bypass it.
- Private model reasoning stored or shown.
- A second mission store or decision store.
- The Pi's release tests pushed back over budget.

## 4. Approaches

| | A. Evolve in Local AI | B. Standalone app | **C. Hybrid: Pi Hub ledger (chosen 24 Nov)** |
|---|---|---|---|
| PC asleep | all dark | depends on host | ledger, decisions, history readable |
| Reuse | most code | least | A33, releases, keys, kit pages; Local AI keeps missions |
| Decision store | a second one beside A33 | a second one | A33 extended |
| Pi load | none | none / new host | small writes; polling reads; drawing in the browser |
| New deploy / auth | none | new service, new sign-in | new keys only |
| Risk | dark while PC sleeps | maintenance | Pi test budget (A34 P0); Pi as single point for the views |

Also rejected:
- A shared visualization package *first*: there is no state to draw yet, and M5 revisits it.
- Moving orchestration to the Pi: an A34 non-goal.

## 5. Architecture and placement

```
 Claude Code (Mac)        Local AI (PC)            Mac importer          Pi Hub itself
 hooks: mission-report    missions (titles,        git manifests,        releases, decisions, action_log,
   │ key: mission-claude  states, evidence refs)   print-lab records     GitHub reader (read-only token)
   │                        │ key: localai           │ key: mission-importer    │ in-process
   ▼                        ▼                        ▼                          ▼
 ┌──────────────────────────── Pi Hub: mission ledger (SQLite, hub.db) ──────────────────────────────┐
 │ mission_events (append-only, global seq) → projections + per-revision change-sets                 │
 │ decisions (A33 table, extended; authoritative itself; mirrored into the log)                      │
 └──────────────┬───────────────────────────────────────┬──────────────────────────────────────────────┘
                │ owner session (browser, Pi Hub origin) │ key-gated reads (server to server)
                ▼                                         ▼
  /missions, /missions/<id> (kit, tier 1)       home-mcp `decisions` v2, `mission`;
                                                Local AI server → Agent World world view (M5)
```

| Responsibility | Owner | Why |
|---|---|---|
| Initiative structure, revisions, gate verdicts, commands, the event log | **Pi Hub ledger** | always on; owner sign-in; low write rate |
| Decisions and answers | **Pi Hub `decisions`** (A33), authoritative itself | already the one decision store |
| Spec and plan text | **git**: the ledger stores repo, path and commit | already the reviewed source |
| PR state and check results | **GitHub**, read by Pi Hub's own reader; evidence rows store the head SHA, check name, conclusion and read time | GitHub never sleeps, so this is read when needed, not mirrored (baseline D8) |
| Mission internals and answers | **Local AI**. The ledger stores the execution id, title and state only, never answer text (A34 D10) | A34: Local AI is the engine |
| Experiments | **print-lab** (refs) | its engine and records |
| Claude Code sessions | **nobody**: their events are kept as *reported*, never as verified | Claude Code exposes hooks, not a state API |
| Drawing | the **browser** | the Pi serves static files only |

**Trust boundary, stated plainly.** Anything on the Mac can read the Mac's keys (`security find-generic-password`),
and the agents being governed run on the Mac. So nothing written by a Mac-side source can make a task `verified`,
`reviewed` or `accepted`, or count as an authorization. Only three things count as trusted:
- Pi Hub's own release records;
- Pi Hub's own GitHub reader;
- the owner's signed-in session.

## 6. Mission data model

Ids are stable.
- An initiative id is a slug (`a34`).
- A child id is `<initiative>:<kind>:<slug>` (`a34:task:p1-contract-tests`).
- An entity's URL is `/missions/<initiative>#<id>`, for example `/missions/a34#a34:task:p1-contract-tests`.

### 6.1 Entities

| Entity | Key fields | Notes |
|---|---|---|
| Initiative | id, title, intent, status (`proposed/active/paused/done/retired`), manifest ref (repo, path, commit), created, closed | one per amendment or programme |
| PlanRevision | id, n, at, proposer, summary, why, evidence ids, `requires_approval` (**derived by the server**, §8), decision id, status (`proposed/accepted/rejected`), base commit | never edited |
| PlanChange | revision id, op (`add/remove/change`), entity id, before, after | the per-revision change-set; "Compare" reads these, so history survives compaction |
| Stage | id, n, title, status | A34 P0-P6 |
| AcceptanceGate | id, stage, criterion, evidence kinds required, verdict (`open/met/failed/waived`), verdict by (**owner only**), at | the "Done when" column |
| Workstream | id, stage, title, repo, branch, status | — |
| Task | id, workstream, title, state (§8), state source | — |
| Dependency | from, to, kind (`blocks/informs`), status (`open/met/broken`) | any entity to any entity |
| Participant | id, provider, role, model, reasoning config, parent participant (subagents), session lineage (previous session ids), first seen, last seen | model and reasoning config are as reported; `null` means not reported, never guessed |
| ExecutionProvider | id, integration level (§7.1), capabilities (§11), last event at | — |
| Execution | id, provider, external id, participant, state (§7.5), started, ended, last event at, title ≤120 | one Claude session, Local AI mission, CI run or release |
| ExecutionTask | execution id, task id | many-to-many |
| Evidence | id, kind (`spec/plan/commit/pr/ci/test/release/live-check/measurement/finding/review/doc`), uri, digest (sha or content hash), summary ≤500, observed at, source, **trust** (`trusted/reported/imported/owner`) | references only; the body stays at its source |
| EvidenceLink | evidence id, entity id, role (`supports/verifies/refutes`) | links evidence to tasks, gates, decisions and findings |
| Finding | evidence with `confidence` and `status` (`open/validated/refuted`) | validated only by owner or a trusted source |
| Decision | §9 | A33 table, extended |
| Authorization | §9.4; **off in v1** (D2) | — |
| Command | id, target, verb, args, requested by, state (§11), detail, timestamps | — |
| Risk | id, kind (`risk/blocker`), title, likelihood, impact, mitigation, status, linked ids | — |
| Opportunity, Experiment | id, title, hypothesis, status, decision id, outcome evidence ids | M6 |
| Deliverable | id, title, kind, evidence ids, status (`planned/ready/accepted`) | accepted by owner only |
| Review | id, targets, reviewer participant, independence (**derived**, §8), verdict, evidence id | — |
| ResourceBudget | scope, kind (`cloud_tokens/usd/wall_time/pi_test_seconds`), limit, used, source, trust | shown only where a source reports usage |
| Event | seq (global, Pi-assigned), event id (client uuid), at, received at, source, initiative, entity id, type, body ≤4 KB, `late` | append-only |

### 6.2 Storage, order, reconstruction, retention

**The log**
- `mission_events` has a global `seq` (SQLite `INTEGER PRIMARY KEY`). It is the only order clients see.
- Idempotency is by client `event_id` (a uuid). A duplicate gets a 200 and changes nothing.
- Projections and change-sets are written in the same transaction as their event.

**Rebuild**
- `python -m hub.missions rebuild <initiative>` rebuilds projections and change-sets from the log.
- A test asserts that the rebuild matches the live tables.
- `decisions` is outside the rebuild. It stays authoritative itself, and its changes are mirrored into the log as
  `decision.*` events so that history is complete.

**Owner writes**
- Gate verdicts, manual evidence, initiative status, accepting a revision and the owner's own Commands all go through
  `POST /api/missions/{id}/owner` (owner session, same origin).
- These events carry `source=owner`.

**The Mac spool**
- Hooks append to `~/.claude/mission-spool.jsonl` under `flock`.
- One drainer, guarded by a lock file, posts batches.
- The client uuids make a replay safe.
- Spooled events keep their original `at` and are marked `late`.

**Write limits per source**
- ≤ 60 events per minute, ≤ 4 KB per event, batches of ≤ 50.
- Writes are batched into one `BEGIN IMMEDIATE` per request.
- The fields in an execution row are updated in place. Only state changes are appended to the log, never per-tool
  events.

**Retention**
- Events of open initiatives are kept.
- For closed initiatives, events are kept for 1 year. After that they are compacted to projections, change-sets,
  decisions, gates and evidence refs (D8).
- Decisions linked to an initiative are exempt from A33's 50-row trim.

**Backup.** The ledger lives in `hub.db` and goes with Pi Hub's backups, including C1 off-site (D5). It holds plan
data, titles and states, never Local AI answer text or private Assistant data (A34 D10).

## 7. External execution providers

### 7.1 Integration levels (shown on every execution and evidence row)

| Level | Meaning | Label |
|---|---|---|
| Full | we own both sides: lifecycle, cancel, evidence | "Live" only while its state's freshness window holds (§7.5) |
| Observable | events arrive; control is advisory or absent | "Reported HH:MM" |
| Read-only | Pi Hub reads its state | "Checked HH:MM" |
| Imported | historical, imported from a manifest | "Imported from <repo>@<sha>" |
| Manual | the owner recorded it | "Recorded by you" |
| Unavailable | the source is silent past its window, or failing | "No report since HH:MM" (never idle) |

### 7.2 Providers

| Provider | Level | Mechanism | Control |
|---|---|---|---|
| Local AI missions | Full | Local AI posts lifecycle, title, state and evidence refs with its own key (M4) | cancel through the existing run cancel; refused "needs the PC" while it sleeps (A34 D13) |
| Claude Code sessions | Observable | hook `mission-report.py`, key `mission-claude` (§7.3) | advisory only (§11) |
| Claude subagents | Observable | Agent tool PreToolUse (start); SubagentStop if the M0 spike shows it can be matched | none |
| GitHub PRs and checks | Read-only, **trusted** | Pi Hub's reader: a fine-grained read-only token, only for PRs linked to an open initiative, ≤1 request per PR per 2 min, ETag | none |
| Pi Hub releases | Full, **trusted** | in-process (`releases.py`), including Pi Hub's own release test seconds | none |
| Local AI local CI | Reported | `npm run ship` posts a test summary (counts, seconds, commit) with the Local AI key | none |
| print-lab experiments | Read-only (imported) | Mac importer, key `mission-importer` | none; printing rules unchanged |
| Scheduled tasks, scripts | Observable | same contract with their own key | per script |
| Other assistants, cloud providers | Unavailable until an adapter exists | — | — |

### 7.3 Claude Code reporting

**Attaching a session** (D3)
- `/mission attach a34 [workstream]` is a small skill. It records the session id, cwd, branch and remote.
- It also writes `~/.claude/mission-attach.json`, keyed by cwd. When a session starts in the same cwd after `/clear`,
  a resume or a compaction, the SessionStart hook re-attaches it and links the old session id under
  `session lineage`.
- Sessions that are not attached send nothing to the ledger. Local AI's board feed is unchanged.

**Events sent** (each one only if the M0 spike confirms the hook fires reliably)

| Event | Comes from |
|---|---|
| `session.attached`, `session.ended` | the attach skill; the SessionEnd hook |
| `turn.started` | UserPromptSubmit |
| `turn.finished` | Stop, synchronous and short |
| `tool.running` | PreToolUse: label only, start time |
| `tool.finished` | PostToolUse: label only |
| `subagent.started` | Agent PreToolUse: description, type |
| `task.started`, `task.done` | the skill: `/mission task <id> start\|done` |
| `evidence.reported` | the skill or post-tool detection of `git commit` / `gh pr create`: sha or PR number |
| `error` | — |

- Fields sent: model (where the hook input gives it, else null), branch, remote, PR number when known.
- `tool.running` and `tool.finished` update the execution row in place and are not appended to the log.
- **Never sent:** prompts, replies, tool inputs or outputs, file contents, thinking. Titles are the same labels
  `localai-progress.py` already derives.

**Keys.** Hooks read their key with a 2 s timeout (Keychain can prompt). On a timeout they spool and never block the
session.

### 7.4 Contract and routes

**Contract file.** `docs/contracts/mission-events-v1.json` in pi-hub lists event types, fields, limits, each source's
allowed types and the error codes. It is frozen only after the M0 spike.
- Additive changes need no version bump.
- A breaking change bumps the version, and Pi Hub accepts N and N-1 for one release.

| Route | Who | Purpose |
|---|---|---|
| `POST /api/missions/events/{source}` | that source's own key (`mission-claude`, `mission-importer`, `localai`) | batch of events |
| `GET /api/missions`, `/api/missions/{id}?view=` | owner session | list; per-tab projection (paged, `as_of`, ETag) |
| `GET /api/missions/{id}/changes?after=<seq>` | owner session | changes since a seq; the page polls it every 10 s while visible |
| `POST /api/missions/{id}/owner` | owner session, same origin | gate verdicts, manual entries, revision accept, initiative status, Commands |
| `GET /api/missions/commands?execution=` | the provider's key | its pending Commands |
| `POST /api/missions/commands/{id}/ack` | the provider's key | delivered / applied / rejected / failed |
| `GET /api/decisions` | Mac deploy key (A33) | **unchanged:** returns only rows of A33 kinds and shapes |
| `GET /api/decisions?v=2` | Mac deploy key | every row, structured; for home-mcp v2 |
| `GET /api/missions/{id}?view=summary` | Mac deploy key, Local AI key (read scope) | for home-mcp `mission` and Local AI's server (M5) |
| `POST /api/decisions/{did}/answer` | owner session | A33 route; body extended (§9.2) |

**Per-source keys.** `mission-claude`, `mission-importer` and `localai` keys come from `deploy-key.sh` and are added to
`KEY_FOR`. A source may write only events of its own allowed types, and only for executions it created.
- This stops one source from writing over another's records by mistake.
- It is **not** a security boundary between Mac-side sources (§5). The trust rules in §8 do not depend on it.

### 7.5 Execution states and freshness

| State | Set by | Freshness | Shown after the window |
|---|---|---|---|
| `running_tool` | `tool.running` | none while a tool runs; tool age shown ("running a tool for 9 min") | — |
| `working` | `turn.started`, `tool.finished` | 2 min | "No report since HH:MM" |
| `turn_finished` | `turn.finished` | — | "Turn finished HH:MM": the session is at its prompt. That is **not** "waiting on you" unless an open decision from it exists |
| `queued/running/done/failed/cancelled` | Local AI, releases | Local AI: while the `pc` record is on | "Last known HH:MM (PC asleep)" |
| `unknown` | no event since attach, or source failing | — | "No report since HH:MM" |

Staleness is computed **when a read happens**, from `last_event_at` and the server's `now`. Every response carries
`as_of`. The page re-labels with a timer between polls, so a silent source never stays "Live".

## 8. Progress and plan evolution

Task states run `planned → assigned → queued → active → (blocked) → done → verified → reviewed → accepted`.

| State | Requires | Trusted? |
|---|---|---|
| active / done | a `task.*` event from the session, a Local AI state, or the owner | reported |
| verified | an EvidenceLink `verifies` to evidence with trust `trusted` (Pi Hub's GitHub reader: check conclusion `success` on the PR's head SHA; Pi Hub release record) or `owner`, carrying commit digest and outcome | yes |
| reviewed | a Review whose independence is **derived**: the reviewer is the owner, **or** a participant with no parent/child link to the author and a different session lineage. A Mac-side review is labelled "Reported independent review" | owner reviews trusted; others reported |
| accepted | the owner's `met` verdict on the gate covering it | yes |

A session can report "done" and attach evidence. On its own word alone, nothing becomes verified or accepted.

**Progress is shown as counts with their denominator**, per dimension, never as a percentage made up by a model:

| Dimension | Shown as | Denominator |
|---|---|---|
| Tasks | `12 done · 9 verified · 4 reviewed of 31 planned` | tasks in the current revision |
| Gates | `2 of 7 gates met` | gates in the current revision |
| Decisions | `3 open (1 blocking) · 14 answered` | decisions linked to the initiative |
| Evidence | `18 trusted · 6 reported · 9 imported` | evidence refs |
| Risks | `2 open · 5 mitigated` | risk rows |
| Review | `4 of 6 workstreams reviewed (1 by you)` | workstreams |
| Discovery | `9 validated findings · 2 contradictions open` | not a fraction |

`ui-meter` is used only for the `n of m` rows above, with the denominator in its label.

**Plan evolution.** Every change to stages, gates, workstreams, tasks or dependencies is a PlanRevision with its
PlanChange rows.
- **Derived approval.** The server sets `requires_approval` from the change-set. It is true when the change adds or
  removes a stage or gate, changes a gate criterion, removes a task with evidence, or changes a budget. It is also true
  when the owner turned on "approve every revision" for this initiative.
- **What the proposer controls.** A proposer may raise `requires_approval`, never lower it.
- **Approval flow.** A revision that requires approval creates a Decision of kind `approve` and stays `proposed` until
  that decision is answered. Revisions that don't require approval are accepted automatically and shown in History.
- **Imports.** An imported plan lands as revision 1, `proposed`. One owner tap accepts it. Later manifest commits
  become new proposed revisions with their diff.
- **Compare.** "Compare" shows the PlanChanges between any two revisions.

## 9. Decision Center

### 9.1 Record (A33 extended)

New columns. All are nullable, so A33 rows are unchanged.

| Field | Content and limits |
|---|---|
| `initiative` | the initiative id |
| `context` | ≤2000 |
| `why_needed` | ≤500 |
| `requested_by` | participant id |
| `options` | a list of `{id, label ≤60, summary ≤280, benefits[], drawbacks[], risks[], consequences ≤280}`, ≤8 options. A33's string list is still accepted |
| `recommended` | option id or ids |
| `rationale` | ≤1000 |
| `evidence` | ≤10 evidence ids |
| `confidence` | `low/medium/high` |
| `reversibility` | `reversible/costly/irreversible` |
| `affects` | entity ids |
| `blocking` | bool |
| `delegable`, `default_if_delegated` | see the rules below |
| `number` | `{min, max, step, unit}` |
| `status` | `open/investigating/answered/deferred/superseded` |
| `digest` | sha-256 of every field shown to the owner |

Kinds:
- `choice` and `text` (both A33);
- `multi`, `rank`, `yesno`, `number`;
- `approve` (approve / reject / approve with conditions).

Rules the server enforces:
- **Re-asking.** Re-asking an open decision may change only `context`, `rationale` and `evidence`. Any other change
  needs a new id with `supersedes`. A decision of kind `approve`, `irreversible` or `costly` is immutable once created.
- **Answer check.** The answer write is conditional on `digest`, not only on `question` and `options`. If anything the
  owner saw has changed, the answer is refused with 409 `Changed`.
- **Delegation and reversibility.** `delegable` is honoured only for `reversible` decisions that are not `approve`.
  `reversibility` may be raised by the requester and lowered only by the owner.
- **Size.** The v2 body cap is 32 KB. A33's 8 KB cap still applies to rows of A33 shape.

### 9.2 Answers

| Answer | Allowed when | Records |
|---|---|---|
| Accept recommendation | a recommendation exists | the recommended option(s) |
| Choose / multi / rank / number | per kind | option(s); the full order for `rank`; the value, within bounds, for `number` |
| Approve with conditions | `approve` | approval plus conditions text; the requester must state how it meets them, as a reply event, before acting |
| Request investigation | any | status `investigating`; a task on the requester; the decision stays open |
| Add constraints / custom direction | any | text on the answer |
| Delegate to the architect | `delegable`, reversible, not `approve` | the `default_if_delegated` option, marked "delegated" |
| Defer | `blocking = false` | status `deferred`; back in the list on the requester's next report |
| Supersede | an answered decision | a new decision with `supersedes` and a reason; the old row is kept |

Every answer:
- goes to `action_log` and the mission event log;
- is read back by sessions through home-mcp `decisions` v2, which wraps **every** text field as untrusted, including
  `context`, `rationale`, `summary`, `benefits` and `drawbacks`.

### 9.3 Rules

- **No recommendation.** Every decision either has a recommendation or says "No recommendation: <why>". The API
  refuses a decision that has evidence but neither.
- **Routine choices are not asked.** The owner-question skill gains a rule: decide yourself unless the choice is costly,
  irreversible, scope-changing, security-relevant, or a stated owner preference.
- **Blocking decisions reach the owner.** A blocking initiative decision sends one ntfy notice (new notify source
  `missions`, kind `decision-blocking`, using the usual dedupe). It also shows in Needs you's Decisions group. A33 keeps
  decisions out of the badge.
- **Nothing consequential is auto-approved.** `approve`, `costly` and `irreversible` decisions cannot be delegated or
  defaulted, and an open decision never turns into an answer by expiring.

### 9.4 Authorization: off in v1 (D2)

The mandate says a UI approval alone is not authorization: the system that executes the action must enforce it.

**Why a hook guard on the Mac can't do this.** It is cooperative:
- The agent it governs can read the Mac key and edit `~/.claude`.
- Command matching can be bypassed (`gh api …/merge`, compound commands, other tools).
- Whether a hook's `allow` overrides `permissions.ask` in bypass mode is unverified.

So A35 v1 records answers only. No tap authorizes an action, and merges stay under the owner's chat "merge" and
`permissions.ask`.

**The enforceable path (M0 spike, then D2).**
1. When the owner taps, Pi Hub sets a GitHub commit status `owner-authorized` on the PR's exact head SHA. It uses a
   token that only Pi Hub holds, scoped to commit statuses.
2. Branch protection on the repo requires that status.
3. GitHub, the executor, then enforces it. A push after the tap creates a new head SHA without the status, so the
   approval doesn't carry over.

The spike must show three things:
- the owner's own merges still work when they choose;
- the token's scope is narrow enough;
- a Mac hook can do no more than read the status.

Until then, no "authorize" control is drawn.

## 10. Experience

### 10.1 Views kept, and why

| View | Kept as | Reason |
|---|---|---|
| Mission overview | **Overview** tab | the 10-second answer: stage, gates, blockers, open decisions, executions with their freshness |
| Decision center | **Decisions** tab | the main reason to open the page |
| Roadmap, gates, dependencies, revisions | **Plan** tab | one structure. Dependencies are "waits on / unblocks" rows with highlighting; the kit has no graph component |
| Workstream board, agent activity | **Work** tab | columns by task state; executions with their integration label |
| Evidence explorer, execution history | **Evidence** tab | evidence by trust and kind; event history with filters |
| World view | Agent World (M5) | spatial overview; optional |
| Opportunity queue, experiments, research | **Learning** page (M6) | a different rhythm; not every initiative has one |
| Timeline/Gantt, resource utilization, standalone graph | **not built** | there are no committed dates, and no reliable usage telemetry beyond Local AI's models. Revisit only with evidence of need |

Five tabs is the kit limit (`ui-tabs`). Risks and blockers sit in Overview and on the entities they affect.

### 10.2 Selection

Every entity has one inspector: a kit sheet, which needs a kit PR first.
- Selecting a building, agent, row, dependency or decision in any view opens the same inspector at `#<entity id>`.
- Switching tabs keeps the selection, and Back returns to the previous one.
- The inspector shows:
  - the record and its provenance label (§7.1);
  - linked evidence with its trust;
  - dependencies in both directions;
  - only the actions the provider supports.

### 10.3 Wireframes

Every value below is **illustrative**. A34 data on the real page comes from imports and is labelled so.

Desktop, `/missions/a34`, Overview:

```
┌ Pi Hub ▸ System ▸ Missions ▸ A34 Pi Hub draws the Assistant ─────────── Active · as of 09:41 ┐
│ [Overview] [Decisions 2] [Plan] [Work] [Evidence]                              ⌘K  Search │
├────────────────────────────────────────────────┬─────────────────────────────────────────────┤
│ Stage  P0 Headroom (gate open)                  │ Needs you                                    │
│ Gates  0 of 7 met (imported plan, rev 1)        │ ● Raise the 900 s test limit?    BLOCKING    │
│ Tasks  4 done · 2 verified of 23 planned        │   Recommended: No, fix tests                 │
│ Decisions 2 open (1 blocking) · 14 answered     │   high confidence · reversible               │
│ Risks  1 open: Pi test budget                   │   [Accept] [Other options…] [Investigate]    │
├────────────────────────────────────────────────┤                                              │
│ Executions                                      │ Recent                                       │
│ ▸ Claude Code · pi-hub fix/release-test-timing  │ 09:12 PR #315 opened · reported              │
│   Opus 5.5 (reported) · running a tool, 4 min   │ 08:50 Release 653dc50 live, tests 880 s ·    │
│ ▸ Local AI · last known 08:58 · PC asleep       │       trusted                                │
│ ▸ GitHub #315 · checks: none · checked 09:40    │ 23 Nov D1–D14 answered · imported            │
└────────────────────────────────────────────────┴─────────────────────────────────────────────┘
 Sources: ledger (as of 09:41) · plan imported from pi-hub@4ef3c14 · GitHub checked 09:40
```

Phone (390 px), Decisions:

```
┌ A34 · Decisions (2) ──────────┐
│ Raise the 900 s test limit?   │
│ BLOCKING · asked by Claude    │
│ Why: release tests 883/900 s  │
│ ★ No, fix the tests           │
│   high · reversible           │
│   + keeps headroom honest     │
│   − 2-3 PRs of test work      │
│ ○ Raise to 1200 s             │
│ ○ Raise now, fix later        │
│ Evidence (3) ▸                │
│ [Accept recommendation]       │
│ [Choose another] [Investigate]│
│ [Add direction]               │
└───────────────────────────────┘
```

World view (M5):

```
  ┌ A34 quarter ──────────────────────────────────── Ledger · as of 09:41 ┐
  │  P0 ▓▓░ │gate▕ P1 ··· lot │ P2 ··· lot │ P3 ··· lot │ ...             │
  │ [Tests]🏗 ⚑1 ▕ (planned)                                              │
  │  👷 Claude (reported 09:40)                                           │
  │  ═══road═══╪══ barrier: P1 waits on P0 gate ══╪═══                   │
  └───────────────────────────────────────────────────────────────────────┘
  Chips are HTML: "Tests · 2 tasks active · 1 decision waiting"
```

### 10.4 World semantics (M5)

| Element | Means | Never |
|---|---|---|
| District | a stage | decorative |
| Building | a workstream; floors are its tasks | — |
| Scaffolding / crane | tasks `active` / an execution `working` or `running_tool` within its window | shown past the freshness window |
| Lit floor, flag | `verified` / `accepted` | lit by a reported state |
| Gate arch | an acceptance gate, open or met | — |
| Road barrier | an open `blocks` dependency | — |
| Figure | a participant in a fresh state; an outline with "No report since" when stale | idle crews, invented roles |
| Beacon | a decision waiting | — |
| Car leaving | an execution finished (existing Street meaning) | ambient traffic |
| Frame ribbon | Ledger as of HH:MM / Unavailable / Replay <time> / Demo | "Live" without a fresh read |

- **Removed:** ambient traffic, birds, fireworks and the idle crew.
- **Night,** if kept, is a theme toggle and labelled as one.
- **Reduced motion:** no walking or driving; state changes snap.
- **Replay** reads the server event log, never localStorage.
- **No world-only paths:** every element has the same record in the tab views.

### 10.5 Accessibility and states

- **Kit only.** Every control is keyboard reachable, with visible focus and 44 px targets.
- **States per view:**
  - loading; live with `as_of`; stale with age; never read;
  - unavailable source (named); empty (truly empty);
  - refused; out-of-date contract;
  - imported; reported;
  - actions disabled, with the reason.
- **Kit first.** Imported and Reported are new honest states, and `renderDecisions` gains the new kinds. Both need kit
  PRs first.
- **Checks:** width sweep and axe at 320-1920 px, light and dark.

## 11. Governance and control

| Control | Local AI mission | Claude Code session | GitHub / CI | Ledger |
|---|---|---|---|---|
| Pause / resume | — | **not in v1** (D4) | — | initiative status (recorded intent) |
| Cancel | run cancel; refused while the PC sleeps | — (the owner stops the session) | — | — |
| Direction, reprioritize, depth, breadth, budget, model escalation | a new mission with options | **advisory**: delivered as context at the session's next hook event, if the M0 spike confirms the hook can add context; otherwise read by the session through home-mcp | — | recorded intent |
| Approve scope change, retire objectives | — | read through home-mcp | — | PlanRevision + Decision |
| Request review | — | creates a Review task | — | Review row |
| Authorize merge / experiment | — | — | v1 off; the GitHub status path after the spike (D2) | — |

**Rules**
- A control appears only if its provider row says it is supported. Otherwise it is absent, not shown disabled.
- Every control is a Command, and its state is shown on its target:
  - Local AI: `requested → delivered → acknowledged → applied | rejected | failed`.
  - Claude advisory: `requested → delivered` (with time). It is never "applied", because nothing can confirm that.
  - A Command not delivered within 24 h becomes `expired`.
- "Recorded intent" controls say that's what they are.
- All Commands are owner-only, same-origin and logged.

## 12. Continuous learning (M6)

The Learning page and a research quarter draw Local AI's A31/A32 topics and findings through A34's adapter, as titles
and counts only (`cache: owner`).

| In the quarter | Means |
|---|---|
| A building | one topic |
| Its height | validated findings that a decision, task or opportunity used; never documents read |
| A cracked facade | an open contradiction |
| A lit window | an opportunity waiting |

The lifecycle:
1. An opportunity becomes an Opportunity row.
2. An owner decision promotes it to an Experiment (print-lab or a repo branch) or to a task in Local AI's Improve queue.
3. Trusted outcome evidence closes it.

Source authority and confidence come from A31's source records, and nothing here re-ranks them.

## 13. Availability, recovery, performance, security

| Failure | Behaviour |
|---|---|
| PC asleep | ledger, decisions, history and imports readable; Local AI executions show "Last known HH:MM (PC asleep)"; Local AI controls disabled "needs the PC" (A34 D13) |
| Mac asleep | Claude and importer sources stop; their executions show "No report since HH:MM" or "Turn finished HH:MM", never idle |
| Pi Hub down | no Mission Control; sessions keep working; hooks spool and never block (2 s timeout) |
| Pi Hub restart | data in SQLite; pages resume polling from their last `seq` |
| A source sends garbage or too much | 4xx with a code and a per-source rate limit; after repeated refusals, a `pi:missions:<source>:refused` Needs item |
| A projection is corrupt | `rebuild` from the event log |
| GitHub unreachable or token invalid | GitHub rows show "Not checked since HH:MM"; nothing becomes verified |

**Performance**
- **Reads:** polling, not SSE. Each open tab polls `changes?after=<seq>` every 10 s, with ETag and 304s, only while
  visible.
- **Why not SSE:** Pi Hub's records stream pins one default-executor thread per subscriber, with unbounded queues
  (`records.py:269-303`). A35 adds no stream.
- **Writes:** ≤60 per minute per source, batched, one transaction per request.
- **Page size:** ≤20 KB gz of page JS.
- **World view:** the world engine runs in the browser and is loaded only on its own view.

**Test budget**
- Every phase states its added Pi test seconds.
- The Pi-side half of M1 (M1b) may add ≤15 s, counted inside the A34 P0 ceiling A34's phases share. It starts only
  after A34 P0 is accepted (three releases under 600 s).
- Projection logic is pure functions with fast unit tests. There are no streaming tests.

**Security**
- **Browser access:** the owner session for every read and write. Writes need `Sec-Fetch-Site` same-origin.
- **Machine writes:** per-source keys, scoped to their own executions. This is honestly a mistake guard, not a trust
  boundary (§5).
- **Trust:** verification, review independence and acceptance come only from trusted sources or the owner (§8).
- **What is stored:** event text is drawn as text; links are limited to A33's `link` hosts. The contract has no field
  for prompts, outputs or reasoning, and bodies over 4 KB are refused.
- **Decisions:** immutable or digest-checked (§9.1).
- **GitHub token:** read-only, and held only on the Pi.

## 14. A34 as the reference mission

Every A34 row below is **Imported** (from a reviewed manifest, §15 M1a) or **Manual** until a live source reports. None
is shown as live.

| Mandate item | A34 example | Source | Today | Needs |
|---|---|---|---|---|
| Environment assessment | the "Constraints found" table | spec at `4ef3c14` | text only | Evidence (doc) via manifest |
| Models used | Opus 5.5 sessions; Local AI's model map | hook model field | not captured | M1a hook (as reported) |
| Subagents | the code-explorer tracers used for this spec | Agent PreToolUse | Agent call only | M1a hook |
| Skills / MCP | brainstorming, platform-plan; `home` MCP | hook tool labels | labels to Local AI only | M1a hook (labels only) |
| Parallel investigations | P0 test-time PRs | PRs #313, #315 | GitHub | Pi GitHub reader |
| Workstreams, dependencies | P0 → P1 → P2 → P3/A27 step 2 → P4 → P5 → P6 | spec "Needs" column | text | manifest |
| Findings | "1,724 scrypt hashes ≈ 210 s on Pi" | P0 plan | text | Evidence (measurement, imported) |
| Architectural decisions | D1–D14, answered 23 Nov | spec "Answered" line | text | manifest → answered decisions, labelled imported |
| Interactive decision | "raise the 900 s limit?" (D8's fallback) | — | chat | Decision Center |
| Experiments | P5 Pi stream measurement | spec | planned | Experiment row |
| Verification | release test seconds | `deploy/pi-hub-release:109`, release records | the Pi release reports test time; `releases.valid()` has no test field | add the field (M1b) |
| Independent review | first-draft review: 3 blockers, 10 major | spec text | text | Review row (manual) |
| Risks | the Risks table | spec | text | manifest |
| Roadmap, gates | P0-P6 "Done when" | spec | text | Stages + Gates |
| Documentation | `operations.md` "Accepted <date>" | git | text | owner gate verdict + Evidence |

## 15. Roadmap

Each phase is its own plan and PRs, gated by the repo's engineer agent, ui-ux-reviewer and qa-release.

| Phase | Repos | What | Needs | Done when |
|---|---|---|---|---|
| **M0 Spikes** | ~/.claude (throwaway) | (1) Hook behaviour in bypass mode: which of SessionStart sources, UserPromptSubmit, PreToolUse, PostToolUse, Stop (sync), SubagentStop, Notification and PermissionRequest fire, with what fields (model?), and whether a hook can add context. (2) The GitHub `owner-authorized` status with branch protection on a scratch repo | this spec merged | findings written into this spec as a dated addendum; contract v1 frozen from them |
| **M1a Mac side** | ~/.claude, home-mcp | `mission-report.py`, `/mission attach` and `/mission task` skills, spool; manifest format `docs/missions/<id>.json` and the A34 manifest (a reviewed PR); importer for manifests and print-lab; home-mcp `decisions` v2 (wraps every text field) **before** any structured decision is written | M0 | the A34 manifest validates; spool replay idempotent (test); home-mcp reads A33 and v2 rows |
| **M1b Pi side** | pi-hub, appliance-ui | keys; `mission_events`, projections, change-sets, rebuild; owner route; A33 columns (additive) with `?v=2` read; Pi GitHub reader; release test field; `/missions/<id>` Overview, Decisions (`choice`, `text`, `multi`, `yesno`), Evidence; kit: decision kinds, Imported/Reported states | M1a (A34 P0 waived 25 Nov, §22) | A34 shown from its manifest, accepted by one owner tap; one attached session shows each §7.5 state honestly, including "No report since" with the Mac asleep; a decision answered on the phone is read back via home-mcp; rebuild = live; PC off: page fully readable |
| **M2 Decisions** | pi-hub, appliance-ui | all kinds and answers (§9.2), digest check, immutability, supersession, derived flags; ntfy for blocking decisions | M1b | §17 items 4-5 |
| **M3 Plan and work** | pi-hub, appliance-ui | Plan and Work tabs; revisions with Compare; owner gate verdicts; trusted verification; derived review independence; progress dimensions; inspector sheet (kit) | M2 | a manifest change shows as a proposed revision with its diff; a task becomes verified only from trusted evidence |
| **M4 Providers and control** | LocalAI, pi-hub | Local AI missions report (Full) with cancel through Command states; Local AI CI summary; advisory Claude direction (if M0 allows); D2 GitHub authorization if M0 passed and the owner says yes | M3, A34 P2 | a Local AI mission started for a task appears, finishes and links evidence; a cancel goes through every Command state; refused while the PC sleeps |
| **M5 World** | LocalAI | world view from the ledger, read server to server by Local AI with its key (§10.4), using Main Street's engine; retire the City renderer (`ui.js:1157-2164`), its decoration and browser-side replay; replace #619's demo. Sequenced with A34 P6, which also edits `ui.js` (whichever lands second rebases) | M3 (D6 re-answered 25 Nov: build now, §22) | every world element traceable to a ledger id; reduced-motion parity; budgets held; City code deleted |
| **M6 Learning** | LocalAI, pi-hub | Learning page and research quarter (§12) | M4 | one opportunity goes from finding to experiment to trusted outcome |

**Migration**
- Nothing is moved or deleted before M5.
- #619's Mission Control stays until the ledger replaces its data, and its demo store is never imported.
- Local AI's `approvals` are not migrated: their consumer is the change queue. Mission-linked approval requests become
  Decision Center decisions in M4.
- A33 rows and the A33 read keep working unchanged at every step.

## 16. Decisions for the owner

**Answered 24 Nov 2026, 10:01:** the owner chose "Approve as recommended" for D2-D10 (D1 answered earlier the same
day). Each row's recommended answer is the decision; the alternatives stay listed for the record. Approval of A35 itself
is the merge of this PR.

| # | Question | Recommended | Alternatives |
|---|---|---|---|
| D1 | Where do the ledger and Decision Center live? | **Pi Hub (approach C)**. Answered "as recommended", 24 Nov | Local AI; standalone app |
| D2 | How are actions such as merges authorized from the page? | **Not in v1. After the M0 spike, by a GitHub `owner-authorized` status on the head SHA that branch protection requires, set by Pi Hub on your tap.** A Mac hook guard is advisory only | a Mac hook guard (bypassable); never |
| D3 | How do sessions join an initiative? | **Explicitly, with `/mission attach`; re-attached by cwd after `/clear` or a resume** | inferred from branch or spec path |
| D4 | Pause a Claude session from the page? | **No in v1.** Denying every tool call makes the model retry, and a hook can't pause an idle session. Direction stays advisory | pause by deny, with a local cache |
| D5 | Ledger in Pi Hub's backups, including C1 off-site? | **Yes.** It holds plan data, titles and states, not private Assistant data | exclude from off-site |
| D6 | World view | **Re-answered 25 Nov: build now**, right after M3, and retire the City renderer then (§22). Was: build only after two weeks of M1-M3 use and your yes | drop the world view |
| D7 | Widen A33's limits for initiative decisions (8 options, 2000-character context, 32 KB body)? | **Yes.** Rows of A33 shape keep their limits | keep 4 options |
| D8 | Event retention for closed initiatives | **1 year, then compact to projections, change-sets, decisions, gates and evidence refs** | keep forever |
| D9 | What may the Claude hook send? | **Model, branch, remote, PR, subagent start, turn and tool lifecycle, labels; never prompts, outputs, tool inputs or thinking** | labels only |
| D10 | Who reads GitHub? | **Pi Hub, with a read-only fine-grained token** (trusted evidence); the Mac importer handles manifests and print-lab only | Mac importer for everything (all evidence then counts as reported) |

## 17. Evidence required (completion criteria)

1. **A34 shown honestly.** `/missions/a34` shows A34 from its manifest, every row labelled with its source and age.
   - Screenshots with the PC off and with the Mac off show the correct "Last known", "No report since" and "Turn
     finished" labels.
   - A stale "Live" label without an event is impossible (timer test).
2. **Rebuild and spool.** `rebuild` matches the live tables, and replaying a spool is idempotent under concurrent hooks
   (tests).
3. **Sources stay in their lane.** A source cannot write another source's executions or types. A body over 4 KB, or a
   prompt or output field, is refused (tests).
4. **Decisions.** Each kind is answered on the phone (390 px) and read back through home-mcp within one call.
   - A double tap is safe.
   - A decision changed after it was viewed is refused with 409.
   - `approve`, `costly` and `irreversible` decisions cannot be delegated.
   - Lowering `reversibility` or `requires_approval` from a session is refused.
   - Tests for all of the above.
5. **home-mcp compatibility.** A structured row never breaks home-mcp's A33 read, before or after v2 (test).
6. **Verification needs trusted evidence.** A task moved to "verified" by a Mac-side evidence report stays "done", and
   becomes verified only from the Pi's GitHub reader or a release record (test).
7. **Commands.** Each Command shows every state it reaches. A Local AI command while the PC sleeps is refused, not
   queued (test and live check).
8. **No bare percentages.** No page shows a percentage without its denominator in the label (test on the rendered DOM).
9. **No new streams.** Mission Control opens no SSE stream, and no default-executor thread is held per viewer (test).
10. **UI checks.** Width sweep, axe, keyboard, and light and dark at 320/390/820/1366/1920 px for every Mission Control
    view.
11. **Test budget.** Pi Hub's release tests stay under the A34 P0 ceiling after each phase, and each PR states the
    seconds it adds.
12. **Recorded.** Each phase is written in `docs/operations.md` under "Mission Control (A35)" as "Accepted <date>".

## 18. Risks

| Risk | Mitigation |
|---|---|
| Pi test budget (883/900 s on 23 Nov) | M1b waits for A34 P0; per-phase ceiling; pure-function tests |
| Pi as the single point for the views | sessions and Local AI keep working; spool; hooks never block |
| Hook behaviour differs from assumptions | the M0 spike before the contract freezes; every hook-derived state labelled "reported" |
| Self-attested progress | trust levels; only trusted sources and the owner verify or accept |
| An authorization path that can be bypassed | none in v1; the only proposed path is GitHub-enforced (D2) |
| A decision changed under the owner | immutable kinds; digest-checked answers |
| Imported data mistaken for live | the integration label on every row; imports never get a freshness state |
| Decision fatigue | routine choices not asked (§9.3); non-blocking decisions can be deferred |
| A visual gimmick comes back | §10.4's "Never" column is M5's test list |
| Scope creep into a tracker | non-goals: no dates, assignees or comments |
| Duplicate stores | Local AI missions and A33 decisions stay the only stores of their kind; the ledger holds refs |

## 19. Independent review

A builder check and an independent adversarial review read the first draft on 24 Nov 2026. The review spot-checked
about 28 citations and found them accurate, apart from the backup reference fixed below.

**Blockers**

| # | Problem | How this text fixes it |
|---|---|---|
| B1 | The merge guard was cooperative and bypassable, consumed its authorization before the merge ran, and conflicted with `permissions.ask` | §9.4 and D2: authorization is off in v1; the proposed path is a GitHub status enforced on the head SHA, after a spike |
| B2 | A requester could change the authority fields, or re-ask in place between the owner's view and the tap | §9.1: immutable kinds, digest-checked answers, server-derived flags (§8) |
| B3 | Mac sources share a key, so `verified` and `reviewed` were self-attested | §5 trust boundary; §7.4 per-source keys, described as a mistake guard only; §8 trust levels; D10 puts GitHub reads on the Pi |

**Major**

| # | Problem | How this text fixes it |
|---|---|---|
| M1 | Command delivery and liveness assumed hook behaviour that doesn't hold | §7.5 per-state freshness; §11 advisory control and no pause (D4); the M0 spike |
| M2 | Staleness had no mechanism | §7.5: staleness computed at read time, `as_of` on every response, a client timer |
| M3 | Conflicts with D8, A34 D10 and D13, and the A33 anti-goal; a wrong backup citation | §5 GitHub is read, not mirrored; no answer text stored; Local AI commands refused while the PC sleeps; the A33 amendment stated in the header; C1 cited |
| M4 | A structured row would break home-mcp's read | §7.4 `?v=2`; home-mcp v2 lands in M1a first and wraps every field |
| M5 | Ordering, idempotency, rebuild and Compare had gaps | §6.2 global seq, uuids, `flock` on the spool; decisions outside the rebuild; PlanChange; EvidenceLink; task events |
| M6 | The plan was parsed from prose | M1a: a manifest file reviewed by PR; imports land as proposed |
| M7 | SSE threads and the test budget on the Pi | §13: polling, no new streams; M1b ≤15 s inside the P0 ceiling |
| M8 | Phase ordering | M0 spikes first; M1 split into a Mac half and a Pi half; owner routes and kit work listed |

**Minor fixes:** release test time (§14), blocking decisions reaching the owner (§9.3), session id changes after
`/clear` (§7.3), Keychain hangs (§7.3), kit honest states (§10.5), and the added acceptance tests (§17).

**Builder questions settled as the writer's calls** (the owner can overrule any):
- import format: a manifest file;
- decisions stay authoritative and outside the rebuild;
- owner writes go through one owner route;
- M1 split into a Mac half and a Pi half;
- review independence is derived;
- the M5 world view is read server to server by Local AI;
- authorization is consumed by GitHub, not at a check.

## 20. Left to the builder

- Table and column names beyond those given.
- Projection indexes.
- The importer's schedule.
- Exact limits within those stated.
- The manifest's exact schema; it must cover §6.1.
- The inspector's kit markup; a kit PR names it.
- PR splits within a phase.
- Test fixtures.

## 21. Addendum: M0 findings (24 Nov 2026)

Measured on the Mac with Claude Code 2.1.323, headless (`claude -p`), in a scratch project. A logging hook was attached
to every event, under bypass and default permission modes. The GitHub test used a scratch repository,
`azmusgb/a35-m0-scratch`: made public only for the test, then private again, PRs #1 and #2. Spike cost about $0.44.
Contract v1 is frozen from this section.

### 21.1 Claude Code hooks

| Question | Finding | Consequence for §7.3, §7.5 and §11 |
|---|---|---|
| Which events fire in bypass mode? | SessionStart (`source` startup or resume), UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, SubagentStart, SubagentStop, Stop and SessionEnd all fired. Notification, PreCompact and StopFailure did not occur headless | the events in §7.3 hold; Notification stays **unverified** and is not used |
| Does a resumed session keep its id? | yes: same `session_id`, `source: resume` | lineage is needed only after `/clear`; that `/clear` gives a new id is **unverified** (interactive only) |
| Is the model in the hook input? | **no**, in no event. `effort: {level}` is in tool and stop events. The main session's model is in the transcript (`message.model`). A subagent's model, tokens, duration and `agentId` are in the Agent tool's PostToolUse `tool_response` (`resolvedModel`, `totalTokens`, `totalDurationMs`, `agentId`) | the hook reads the model id from the transcript's last assistant line and sends only that id. `effort` is sent as the reasoning configuration. The subagent participant is keyed by `agentId` and linked to the Agent call's `tool_use_id` |
| Can subagent events be matched? | yes: SubagentStart and SubagentStop carry `agent_id` and `agent_type`, and every tool event inside a subagent carries the same `agent_id` | `subagent.started` and `subagent.finished` both go in the contract |
| Is there a "waiting on the owner" signal? | PermissionRequest fires, **in bypass mode too**, when a call matches `permissions.ask` | `waiting.owner` comes from PermissionRequest only. A Stop means "Turn finished", as §7.5 says |
| Does a PreToolUse `allow` override `permissions.ask`? | **no**, in bypass or default mode. `echo spike-ask …` was refused, and PermissionRequest fired | a Mac hook cannot relax your ask rules, and cannot authorize. That confirms §9.4 |
| Does a PreToolUse `deny` block a call? | yes, and the model sees the reason | deny works, but D4 stands: an idle session cannot be paused, and repeated denies make the model retry |
| Does `additionalContext` reach the model? | yes, from UserPromptSubmit and from PostToolUse: the nonce appeared in the transcript, and the direction was followed. PostToolUse hooks also fire inside subagents | advisory direction (§11) is sent **once**, as context on the next PostToolUse or UserPromptSubmit. Repeating context made the model repeat the action until it stopped itself, so delivery must be one-shot. "Delivered" means the hook emitted it, and is never "applied" |
| Does a Stop `block` continue the turn? | yes; the model followed the reason. `stop_hook_active` was true on the second Stop | a Stop-block is used only when you choose "deliver now"; it always checks `stop_hook_active`. The current async Stop hooks are unchanged |

### 21.2 GitHub authorization (D2)

| Test | Result |
|---|---|
| Branch protection on a **private** repo (Free plan) | refused: HTTP 403, "Upgrade to GitHub Pro or make this repository public". pi-hub and print-lab are public; LocalAI, appliance-ui and home-mcp are private |
| Merge with no `owner-authorized` status | refused ("base branch policy prohibits the merge") |
| Status set, then a new commit pushed | refused: the new head lacks the status |
| Status on the current head | merged. GitHub's mergeability took about 10 s to update |
| Status posted with **your classic token**, check not bound to an app | accepted, so any session holding your token can forge it |
| Required check bound to an `app_id`, status posted with your token | refused (`BLOCKED`): only that GitHub App can satisfy it |
| `enforce_admins: false`, `gh pr merge --admin` | merged without the status. Your token also edited branch protection throughout this test |

**Conclusion.** The GitHub gate is real enforcement only when all four of these hold:
- (a) Pi Hub sets the check through **its own GitHub App**, and the required check is bound to that app's id;
- (b) `enforce_admins` is on;
- (c) the Mac sessions' GitHub credential has **no administration permission** (a fine-grained token with contents and
  pull-request write only);
- (d) the repository is public, or the plan is Pro.

Today's sessions use your classic `repo` token, which is admin on your repositories and can turn the gate off.
Meeting (a)-(c) means creating a GitHub App and new tokens. Those are your actions, and they change how every session
reaches GitHub, so **D2's authorize path stays off** and is raised as D11. M1-M3 do not need it.

### 21.3 Decision raised

**Answered 24 Nov 2026, 11:12:** the owner chose D11 as recommended (not now; revisit at M4).

| # | Question | Recommended | Alternatives |
|---|---|---|---|
| D11 | Set up GitHub enforcement for pi-hub and print-lab: a Pi Hub GitHub App, `enforce_admins` on, and session tokens without administration? | **Not now; revisit at M4.** Merges stay under your chat "merge" and `permissions.ask` (verified to hold in bypass mode, §21.1). Private repos would need Pro | do it now for the two public repos; never |

**Housekeeping:** `azmusgb/a35-m0-scratch` is private again and is safe to delete. Deleting it needs the
`delete_repo` scope, which only the owner can add.

## 22. Addendum: gates waived (25 Nov 2026)

The owner asked for A35 to be built in full, M1b to M5, and waived two gates:

- **M1b no longer waits for A34 P0 to be accepted.** M1b can start while P0's test work is still open. The A34
  manifest's P0 rows stay as imported and reported until their gate is met. Nothing marks P0 accepted early.
- **D6 is re-answered as "build now".** M5 follows M3 directly, without the two weeks of M1-M3 use. Everything else
  in M5 is unchanged: the "Done when" column, the §10.4 semantics, its "Never" column as M5's test list, and the City
  renderer's retirement in the same milestone.

The design study for M5's world view is LocalAI `docs/superpowers/specs/assets/2026-11-25-agent-world-m5-world-view.html`
(LocalAI #642). It proposes four differences from §10.4, which M5's plan settles:
- hazard tape on a blocked task's floor;
- reported-done floors drawn dark;
- an HTML district ruler;
- the inspector as the M3 kit sheet.

Every other gate stands. Each phase still has its own plan and PRs, gated by the engineer agent, ui-ux-reviewer and
qa-release, and nothing merges without the owner's say-so.
