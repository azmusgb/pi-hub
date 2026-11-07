# Step 10 Atlas on release records: finish and accept — Plan

Date: 2026-11-07 · Status: **proposed** · Covers: baseline §11 step 10, §6.4; LocalAI's Atlas plan and redesign spec.

**Goal:** the owner opens Assistant › System › Advanced › Architecture and confirms, by looking, that it does what was
approved. Every core repository has a map at the commit that is live. A release becomes a snapshot without anyone pressing a
button. The Changed lens answers "what changed in this release" against any kept snapshot, including modules that were
added or removed. Step 10 is then recorded as accepted.

## Spec

- Baseline `docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`:
  - §11 step 10: "**Atlas on release records (6.4)**, after 3." Step 3 is complete (2 Nov).
  - §6.4 "Architecture understanding": the target trigger, coverage, where it runs, where it is read, and findings.
- Approved under it, in LocalAI:
  - Plan `docs/superpowers/plans/2026-11-01-atlas-every-repo.md` (owner decisions 1 Nov).
  - Redesign spec `docs/superpowers/specs/2026-11-04-atlas-redesign-design.md` (#483, approved 4 Nov). Its lenses:
    "Risk, Tests, Blast radius, Changed since the previous snapshot".
- No amendment touches Atlas. A4 leaves `/architecture` out of scope and keeps the Versions link. There's nothing to
  wait on: everything this plan accepts is merged.

## Done means

From §6.4's target column, quoted:

1. Trigger: "When awake, LocalAI reads Pi Hub's release records and snapshots any new commit. A PC that slept catches
   up on waking. Repos with no deploy target, and anything else, use the manual button."
2. Coverage: "Every home-platform repo and satellite, as snapshots keyed by repo and commit." Owner decision 2
   (1 Nov) scopes this step to the core three: pi-hub, LocalAI and print-lab. The satellites are "added later", and
   are out of scope here.
3. Where it runs: "From a clean copy at the snapshot's commit, not the deploy checkout."
4. Where it is read: "Same page. Versions rows link to 'Architecture at this commit'."
5. Findings: "Findings stay on that page. The owner can promote one into Improve's Signals."

The every-repo plan's acceptance and the redesign spec's acceptance (listed under P1) are the evidence for these.
Neither has been checked or recorded yet.

## What exists today (read on 7 Nov 2026; LocalAI `origin/main` b5dae3a, live ae4b2fb; pi-hub live c10fc9f)

- **Built and merged:**
  - Every-repo plan: PRs 1–6. The generator (#444), server (#445), picker (#446/#447), Snapshot now (#449/#451),
    intelligence on a snapshot, and the release trigger (`app/atlas-releases.js`).
  - Redesign: PRs 1–6 (#486–#492): typed and HTTP links, risk v2, the named-row map that replaced the plate,
    the Systems strip, the pi-hub and print-lab rules, and the Ask packet.
  - Atlas now runs from its own copy of each release (#450, #505).
- **Snapshots on the PC** (`C:\LocalAI\repo\.atlas\snapshots\index.json`, read-only): 5 per repository, each with
  `changedSince` set to that repository's previous snapshot.
  - pi-hub: c10fc9f, a5be11c, 367c3c2, 7b3919d, 3df402f.
  - print-lab: 90b6a33 … 75f7b5c.
  - LocalAI: ae4b2fb … a8bdfd5.
  - pi-hub c10fc9f was released at 14:57 and snapshotted at 15:01 on 7 Nov, without a button. That is one observed
    instance of criterion 1, not yet a recorded acceptance.
- **The trigger:** `atlas-releases.js` reads Pi Hub's records every 5 minutes (`EVERY_MS`, line 9), and also 30 s after a
  start (line 67). It compares live commits against the index, so the first read after waking catches up (lines 3–4).
- **Snapshot now:** `atlas_snapshot_runner.py` `request()` (line 90). The same repository and ref already waiting is that
  same job; a request while one runs queues again. `MAX_QUEUED = 5`.
- **The Changed lens** (`app/public/architecture.js`):
  - A module is "changed" when its files changed between the snapshot and the previous one
    (`quick_arch.py:475` `snapshot_changed_files`).
  - The lens paints changed rows and adds a dot (`:196`, `:374`). The legend says "Changed since <commit>" (`:402`).
  - Missing: comparing against any kept snapshot other than the previous one, and any view of modules added or
    removed between the two. A removed module has no row on the current map.
- **Versions:** Pi Hub links "Architecture at this commit" (`hub/static/js/versions.js:89`).
- **Status docs:** the roadmap's facts say step 10 is "started … Not checked against its criteria". No
  "Accepted" line exists in either repository's `docs/operations.md`.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **Accept before building.** P1 checks the merged work first; P2 fixes only what P1 fails; P3 extends the lens.
   Rejected: building the lens first. It would be accepted together with work nobody has checked.
2. **One acceptance walk for both documents.** The every-repo plan and the redesign spec are both step 10's, and they
   overlap, so they get one guided walk and one record. Rejected: two separate sessions, which would check the same
   page twice.
3. **"Catches up on waking" is tested with a real sleep, not a simulated one.** The owner sleeps the PC across a release.
   That's an owner step, because it changes the PC's power state. Rejected: faking the clock in a test only, which
   leaves the wake path on the PC unobserved. The unit test (`tests/atlas-releases.test.cjs`) stays as the
   regression check.
4. **Compare with any kept snapshot, defaulting to the previous one.** The lens keeps its meaning, "changed since";
   the owner picks which commit "since" means. The default stays the previous snapshot, so today's behaviour is
   unchanged unless the owner picks another. Only kept snapshots can be picked (5 per repository): an older commit
   says "not kept". Rejected: an arbitrary commit, which would mean scanning on demand. That is new behaviour, and a
   scan takes minutes.
5. **Added and removed modules are a list, not ghost rows.** Added modules are already on the map and carry the dot.
   Removed modules have no row, so the inspector area shows "Removed since <commit>" as a list. Rejected: drawing
   removed modules as faded rows, which would move every other row and break "the map stays where you left it".
6. **The comparison is worked out on the page, from two `graph.json` files already served.** Module ids and file
   lists are compared in the browser. Both graphs come from `GET /api/atlas/graph?repo=&commit=`.
   - Trade-off: it costs a second download (pi-hub's graph is about the size of today's), but it adds no new scanner
     field, keeps schema 2 as it is, and old snapshots can still be compared.
   - Rejected: a scanner-side diff, which would change the schema and need a rescan of every kept snapshot.

## PRs, one at a time

### P1. Acceptance walk (owner present; no code)

- **Covers:** §6.4 criteria 1–5, plus both acceptance lists in full.
- **What the walk checks:**
  - Every-repo plan:
    - The page offers all three repositories, each at a named commit, generated from a clean copy.
    - The deploy checkout stays clean (`git status` on `C:\LocalAI\repo`).
    - "Snapshot now" on each repository produces a snapshot within a few minutes. Pressing it twice queues the
      second run.
    - A release appears as a snapshot without a button, including after the PC wakes from sleep (decision 3,
      **owner**).
  - Redesign spec:
    - LocalAI's map shows HTTP links from the browser modules that call the API.
    - `app/server.js` highlights its imports and shows risk, reach and "no tests".
    - The findings name a real dangling or untested route, or say there are none.
    - The no-risk-rise unit test passes.
    - The page reads correctly at 390 and 1440 px in both themes, with the browser suite and axe clean.
    - A version 1 snapshot opens.
    - Ask about `app/storage.js` sends at most 3,000 tokens, with that module first. An 8k model fits or is
      refused clearly.
  - Versions: "Architecture at this commit" opens the right map.
  - Findings: one is promoted into Improve's Signals (§6.4 criterion 5).
- **Evidence:** a table of each check with pass or fail, the commit and a screenshot or command output. Failures
  become P2's list.

### P2. Fixes from P1 (LocalAI; only if P1 finds failures)

- One PR per failure, each with a test that fails first. The scope is fixed by P1's table. Anything new goes to "Out of
  scope", not into P2.
- **Evidence:** each failed check re-run and passing.

### P3. The Changed lens: choose a snapshot to compare with, and added and removed modules (LocalAI)

- **Covers:** the redesign spec's "Changed since the previous snapshot" lens, extended under decisions 4–6.
  Partial for §6.4: it serves "explanation", and doesn't change any criterion.
- **Page:**
  - The Changed lens gains a "Compare with" picker of the repository's other kept snapshots, newest first, with the
    previous one selected.
  - Changed rows are worked out by comparing the two graphs' file lists per module. Added modules are marked "New".
  - "Removed since <commit>" lists modules missing from the current snapshot.
  - The legend names both commits.
- **States:**
  - The compared graph is loading: the current map stays readable, with a line saying so.
  - It can't be read (pruned, PC asleep): say which, and fall back to `changedSince`.
  - Same commit picked: "Nothing to compare".
  - A version 1 snapshot on either side: compare by module id only, and say so.
- **Tests:** a unit test of the comparison over fixture graphs, covering added, removed, changed, unchanged, a
  renamed file and two snapshots with the same commit. Plus browser checks for the picker, its keyboard use,
  `aria-pressed` on the lens buttons, and 390 px.
- **Evidence:** on the live page, pi-hub c10fc9f compared with 3df402f shows the modules changed by #160–#170 (for
  example `hub/system.py` from #170 and the Start sheet from #160) as changed.
  The removed list is empty or correct. Screenshots at 390 and 1440 px, both themes.

### P4. Record acceptance (owner)

- After P1 passes (and P2 and P3 are verified live), record "Step 10 accepted <date>" in pi-hub `docs/operations.md`,
  with the P1 table linked. Update the roadmap's facts. Until then, status stays on the ladder: merged, deployed,
  runtime verified.

### Coverage

| Criterion | Evidenced by |
|---|---|
| 1 Trigger, wake catch-up, manual button | P1 (release without a button; sleep across a release; Snapshot now twice) |
| 2 Coverage (core three, decision 2) | P1 (picker and maps for all three) |
| 3 Clean copy | P1 (snapshot source path; deploy checkout clean) |
| 4 Same page, Versions link | P1 (Versions → map at that commit) |
| 5 Findings, promote to Signals | P1 (one promoted) |
| Redesign acceptance list | P1 (each item), P2 (fixes) |
| Compare any kept snapshot, added and removed | P3 |

## Acceptance

The owner watches the P1 walk and the P3 lens on the live page. The record goes in pi-hub `docs/operations.md` as
"Step 10 accepted <date>", linking the evidence table. A matching commit on the PC is a deploy, not acceptance.

## Out of scope (noted, not gated)

- **Atlas across repositories** (declared contract edges between pi-hub, LocalAI, print-lab and home-mcp). §6.4 puts the
  cross-repo picture in specs. Showing it in Atlas is a design change. Owner: a LocalAI design spec, "Atlas across
  repositories", written after this plan.
- **Satellites** (appliance-ui, home-mcp, netmon, bambuhelper-smart-display). Decided on 1 Nov: "added later", each a
  config change plus a read-only deploy key, which the owner confirms.
- **Scanner modularisation and parse caching.** `quick_arch.py` is 5,606 lines, but scans run in the background on each
  release and nothing needs them faster. Revisit only if a scan's time blocks something.
- **Deep links with lens and module** (`#architecture?repo=&commit=` exists). Small; it can ride along with P3 only if
  the owner asks.
