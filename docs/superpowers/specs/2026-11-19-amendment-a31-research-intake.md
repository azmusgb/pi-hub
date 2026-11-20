# Amendment A31: the Assistant follows sources you register and keeps what it reads

Date: 2026-11-19 · Status: **proposed** (approved when the owner merges this PR) · Amends: baseline 3 (Knowledge and
workspace is LocalAI-only: adds a store there), A27 (adds one page under Improve and one card under System › Assistant,
inside its four sections and two-level cap), A28 D5 (extends its rules for stored text to text fetched from outside) ·
Builds on: baseline 6.2 (only Pi Hub and the display act; unchanged), 10 (a failed read is never shown as empty), A7
(sign-in), A28 (the journal's pattern for additive tables) · Independent of A30 (PR #288); chat control of research
waits on it and is not approved here.

Read on 19 Nov 2026: pi-hub at `c7ec699`, LocalAI at `b01e8b68`. Full design, inventory and alternatives:
LocalAI `docs/superpowers/specs/2026-11-19-knowledge-loop-design.md` (LocalAI PR #584). This amendment approves only
that design's phases 1 and 2.

## Why

The owner asked (19 Nov 2026) for the platform to find useful outside knowledge on its own and turn it into evidenced
improvements. Most of the loop exists in LocalAI: Improve's backlog, the change pipeline, Hand to Claude, local CI and
ship, the journal. What does not exist is anything before Signals:

- No registry of sources. The only outside reading is one SearXNG query on a chat turn or a `research` automation,
  stored as raw output (`app/server/automations.js:14`), with no provenance, deduplication or record of what was read.
- No stored record that ties an Improve item to the source that prompted it, and none of what happened after it shipped.

Three things the baseline does not contain are needed to add that, and each needs an amendment: a new store, scheduled
outbound fetching from the PC, and a new class of stored outside text that a model reads.

## Decisions

**D1 LocalAI owns it; Pi Hub does not change.** Sources, documents and findings live in LocalAI. No Pi Hub route, page,
key, Caddy rule or store changes. The PC sleeps, so intake runs when the PC is on and catches up within its caps;
nothing depends on it being on.

**D2 A new store in LocalAI's database.** Tables named `research_*` in the existing SQLite file, created
`IF NOT EXISTS` with no schema-version bump, so Safe Deploy's rollback still opens the database (the journal's rule,
A28). Phase 1: sources, fetches, documents. Phase 2: findings and an append-only log of their status changes. The
nightly backup already covers the file. Retention caps are fixed in the plan, per table.

**D3 Scheduled outbound fetching, only to sources the owner registers.** LocalAI fetches Atom and RSS feeds on a
schedule. Rules:

- Off unless `LOCALAI_RESEARCH=on` in `stack.env`. Off means no network calls at all.
- Only a URL the owner added is fetched. A source the system comes across is a suggestion, never fetched until added.
- `https` on port 443 only; the host must be the source's own; every resolved address is checked and loopback,
  private, link-local, tailnet (100.64.0.0/10) and their IPv6 equivalents are refused; the connection is pinned to the
  checked address; redirects are re-checked, three at most; 2 MiB and 20 s per fetch.
- Caps per source and per day; a source that fails five times in a row is quarantined and resumes only when the owner
  says so.
- One Pause control stops all of it before the next fetch.
- No credentials, cookies or owner data are sent. The user agent is a generic client name.

**D4 Outside text is data, and what a model makes of it is not an instruction (extends A28 D5).**

1. Fetched text is stored as fetched (bounded, secrets redacted) and reaches a model only inside a marked untrusted
   block.
2. The run that reads it has **no tools** and, by default, runs on this PC. Its output is accepted only as a fixed
   shape: a short claim, a quote that must appear word for word in the document, and a label from a closed list.
   Anything else is discarded and counted.
3. A finding never enters any run that has tools.
4. A finding moves past "extracted" only by the owner's action or a second, separately registered source.
5. Nothing the system reads changes a repo, a setting or a device. The only way from a finding to a change is the
   owner promoting it to Improve, where its text is quoted between the existing `UNTRUSTED_REQUEST` markers and its
   sources are links.

Phase 1 calls no model.

**D5 Pages, inside A27.** One new page under Improve, **Research**, with tabs Findings and Sources, and one card under
System › Assistant for the switch, Pause and the caps. No new top-level section and no third level. The page's name
goes into `pages.json` first. It is an on-demand module: the Assistant's shell is at its size budget.

**D6 Limited attention.** At most a fixed number of new findings reach the owner per day (the plan sets it; the
proposal is 10). The rest wait and the page says how many. Advisories for software the platform runs are the one
exception and go to Needs you.

**D7 Sign-in.** Every `/api/research/*` route is refused without a signed-in device, reads included: the source list
shows what the owner follows. No route accepts an approval asserted in its request body.

**D8 Authority.** The system fetches, reads and recommends. It does not run experiments, change settings or write code
under this amendment.

## What this approves

1. **LocalAI, phase 1 (intake):** the address guard, fetcher, feed reader, store, intake job and guarded API, shipped
   dark. Plan: LocalAI `docs/superpowers/plans/2026-11-19-research-intake-step-1.md`.
2. **LocalAI, phase 1 (page):** Research with Sources and a plain list of what was read, and the settings card. Its
   own plan.
3. **LocalAI, phase 2 (findings and outcomes):** the no-tools reader, the Findings inbox with the daily cap, Promote
   to Improve with evidence, and one question after an item ships ("did this help?") whose answer is recorded on the
   finding. Its own plan.

Phase 2 starts only after phase 1 is live and the owner has registered sources.

## Not decided here

- Whether public source text may go to a cloud model for reading, per source. Until decided, the reader is this PC only.
- Benchmarks, experiments and contracts for changes (the design's phase 3), topics and research depth (phase 4), and
  research from chat (phase 5, after A30). Each needs its own amendment.
- Page fetching beyond feeds, and with it robots.txt handling.
- Embeddings or any search beyond FTS5 (A28 kept them out; unchanged).
- New kit components (a detail pane, a quote block). If phase 2 needs one it goes into appliance-ui first.

## Non-goals

Any Pi Hub code, route, key, Caddy or sign-in change; a second product or a new Assistant section; a new service,
database or dependency; a headless coding agent; any action on a device; anything that runs with the PC off.

## Evidence required

- Phase 1 tests: each blocked address range is refused before a connection, as is a redirect to one and a name whose
  second lookup differs; the same feed fetched twice stores each entry once; a failed fetch leaves stored documents
  and the last good time unchanged and is shown as failed; five failures quarantine a source; off or paused means zero
  network calls; every route refuses an unsigned caller.
- After release with the switch on: one real feed added and fetched from the appliance, its entries listed; adding
  `https://10.0.0.80/feed` is refused.
- Phase 2: a document carrying instructions yields a shape-valid finding with a matching quote or nothing; the inbox
  never exceeds the cap; a promoted item lists its sources and its handed text sits inside the untrusted markers.
- After four weeks of use: at least 30% of findings shown were kept or promoted. Below that, later phases are not
  proposed until the reader or the sources are fixed.
