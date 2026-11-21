# Amendment A32: research measurement, topics and chat reads: what shipped, and what is approved

Date: 2026-11-20 · Status: **proposed** (approved when the owner merges this PR, decision by decision as marked) ·
Amends: A31 (its "Not decided here" list and D4.3, D8) · Builds on: baseline 10 (a failed read is never shown as empty),
A28 D5 (stored text is data), A30 (chat control; phase 5 waits on it), A31 · Spec: LocalAI
`docs/superpowers/specs/2026-11-19-knowledge-loop-design.md`, sections 3.8, 4 to 6 and 11 (section 11 is LocalAI #601).

Read on 20 Nov 2026: LocalAI at `df69969f`, pi-hub at `7faf287`.

## Why

A31 approved phases 1 and 2 of the knowledge loop and said phases 3, 4 and 5 "each need their own amendment".
LocalAI then merged all three without one: #593 (benchmarks, experiments, contracts), #594 (topics, event log,
conflicts), #595 (a research tool for agents), #596 (eval CLI, seeded sources, badges). They are live behind
`LOCALAI_RESEARCH=on`, which is not set, so nothing runs today. This amendment records what was built, rules on each part,
and names what must change before the switch is turned on. It does not approve by silence.

## What exists (observed at `df69969f`)

- **Phase 3:** `evals/past-work-retrieval/` (cases and scorer); `research_experiments` and `research_contracts`
  (`app/research/experiments.js`); a verdict derived from recorded control and candidate metrics; a contract pins a
  suite commit. Nothing runs code; the runner records metrics it is handed.
- **Phase 4:** `research_topics` (depth D1 to D3, breadth B1 and B2, `budget_daily_model_calls`,
  `budget_daily_characters`), `research_events` (append-only state changes), `research_conflicts`
  (`app/research/topics.js`). The two budget columns are stored and **not read by any code**.
- **Phase 5:** the `search_research_findings` tool in `app/agent-tools.js`, passed `researchStore` by
  `app/agent-orchestrator.js:142` into `runAgentLoop`, a run that has tools. Its description says "validated or kept"
  findings; the code calls `listFindings({ limit: 50 })` with no status, so it returns findings in every state,
  including `extracted` (unreviewed) and `dismissed`, and returns their claim and quote to the model.
- `app/research/reader.js` (the no-tools reader) has no caller: no model reads documents yet.

## Decisions

**D1 Phase 3 is approved as a recorder, not a runner.** Experiments and contracts stay as records of metrics produced
by scripts and local CI. They may not start model calls, change settings or write code. Authority stays L1 (A31 D8);
L2 (an experiment that changes parameters of existing code) is **not** approved here.

**D2 Phase 4 is approved only with its budgets enforced.** Topics, the event log and conflicts may stay. Depth and
breadth are labels until a budget check exists: before any model call attributed to a topic, the daily call and
character budgets are read, a failed read stops the call (it is never zero used), and an exhausted budget queues the
work and leaves intake running. The enforcement is a precondition of wiring the reader (D4), not a follow-up.

**D3 Phase 5's tool is approved only in this form (owner chose, 20 Nov 2026).** As built it breaks A31 D4.3 (a finding
never enters a run with tools) and returns unreviewed and dismissed text to such a run. Until the form below exists the
tool is removed from the agent catalog (or `researchStore` is not passed to it). The form:

- Read-only, and only findings the owner has `kept` or `promoted`. `extracted` and `dismissed` findings are never returned.
- The claim and quote reach the model inside the existing `UNTRUSTED` markers, as data. The tool cannot act on them, and
  nothing a finding says changes a repo, a setting or a device.
- **A31 D4.3 is amended** to read: a finding never enters a run with tools, except a kept or promoted finding returned
  by the read-only research tool, quoted as untrusted data.
- A test shows an `extracted` and a `dismissed` finding are never returned.

**D4 The reader stays unwired until the cost contract is in force.** No model reads fetched documents until LocalAI #601
section 11 (tiers, four budget caps checked before the call, Tier 2 only on promotion or the stated gate) is merged
and its enforcement exists. A31's open question on cloud reading stays open: this PC only.

**D5 Scope control.** Research code is limited to the phases an approved amendment lists. LocalAI's `CLAUDE.md` says so
(LocalAI #602). A later phase starts with an amendment, not a PR.

## What this approves

1. Phase 3 as the recorder in D1; the eval suite and scorer; the eval CLI.
2. Phase 4 tables and routes, subject to D2.
3. Seeded production sources (#596) as **suggestions** only: none is fetched until the owner adds it (A31 D3).

## Not decided here

- L2 authority, any experiment that changes code or settings, and any model-graded scoring as a primary metric.
- Cloud models for reading, per source (A31's open item, unchanged).
- Phase 5's tool beyond D3 (for example any write, or findings in any other state), and any chat route that writes (A30 owns chat control).
- A repo indexer, tiers, budgets and the measures table in LocalAI #601: approved only when this amendment or a
  successor lists them; #601 is a proposal.

## Non-goals

Any Pi Hub change; turning the switch on; deleting the shipped tables (they are inert and harmless, and rollback still
opens the database); a new service or dependency.

## Evidence required

- D3: a test that the tool returns no `extracted` or `dismissed` finding, that its output sits inside the untrusted
  markers, and that with the tool removed an agent run has no research read.
- D2: a test that an exhausted topic budget queues and intake still runs, and that an unreadable counter blocks the call
  rather than allowing it.
- D4: `git grep` shows the reader has a caller only after D2's check exists.
- After the owner sets `LOCALAI_RESEARCH=on`: one real feed fetched from the appliance (A31's open check), and the
  state route shows budgets with `used`, `limit` and `resetsAt`.
