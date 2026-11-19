# Amendment A28: memory core is the Assistant's record of its own work

Date: 2026-11-19 · Status: **proposed** (approved when the owner merges this PR) · Amends: baseline 1.3 (adds the
verdict for LocalAI's `2026-10-23-memory-core-design.md`, which the reconciliation did not list) · Builds on: baseline
3 (Knowledge and workspace: memory, LocalAI-only), 6.5 (two histories), 6.7 (asking the AI), 7 (page ownership), 8.2
(Find, Assistant); A25 section 4 (History); A27 (the Assistant's navigation); LocalAI's `coordinator` (local by
default).

Read on 19 Nov 2026: pi-hub at `3cde305`, LocalAI at `caaddc5`.

## Why

LocalAI approved memory core on 24 Oct (LocalAI #375) and shipped its first PR on 25 Oct (#376): the journal
(`app/journal.js`, full-text search in `localai.db`), the run recorder, the one-time import, `GET /api/journal` and
`POST /api/journal/delete`. The baseline was approved a week later. Its section 1.3 gives every LocalAI spec a verdict
and does not list this one, so the four PRs the spec still plans have none: the other recorders, Ask history, ⌘K hits
with a History tab, and the evening recap.

Three things decided since then cut across those four PRs:

- **Who holds house facts.** Prints and spools are Bambuddy's and films are Plex's, both drawn by Pi Hub (baseline 7).
  LocalAI reads house facts and does not hold them. The plan's print recorder also reads the printer through the
  Workshop display, a path `display-on-hub` D1 and D3 superseded (baseline 1.3, `household` row).
- **History is a Pi Hub page.** A25 section 4 defines System › History and one line on Home. That is migration step
  20, not approved to start. The spec plans a History tab in the Assistant and a daily line of its own.
- **The Assistant's navigation is capped.** A22 put every page in the kit's `pages.json`, and A27 gave each Assistant
  view one home. A new tab is a change to that list.

Built as written, the remaining plan would keep a second record of prints, films and spools on the PC, add a second
page called History, and put a second daily line on a Home.

## Verdicts

| Part of the memory-core spec | Verdict | Reason |
|---|---|---|
| §1 the journal, §3 the import, the read and delete routes (shipped) | Kept | One of the Assistant's own stores (baseline 7, `localai.db`); "memory" is Knowledge and workspace, LocalAI-only (baseline 3) |
| §2 recorders: run (shipped), voice, approval, release | Kept | The Assistant's own events. Release means Local AI's own release |
| §2 recorders: print, watch, materials | Superseded | D2 |
| §4 Ask history | Kept, changed | D3, D4, D5 |
| §5 journal hits in ⌘K | Kept | It is baseline 8.2's "Find (Assistant)" row |
| §5 the History tab under Projects | Not approved | D6 |
| §7 the evening recap, its Home card, its push and the morning "Yesterday" line | Not approved | D7 |
| Not goals: embeddings or a vector store | Kept | Unchanged: revisit only if full-text search misses in practice |

## Decisions

**D1 The journal records the Assistant's own work, and nothing else.** What the owner asked, what the Assistant
answered or made, what was approved, what changed in Local AI. It is scoped to the Assistant the way the Inbox is
(baseline 6.5), and it is never a source for Pi Hub's History (A25 4.3 keeps the Assistant's histories apart).

**D2 The journal does not record house things.** No print, watch or materials recorder is built. A recorder on the PC
only sees what happens while the PC is awake, so its record would disagree with Bambuddy's and Plex's whenever the PC
slept through a print or a film, and Pi Hub must stay right with the PC off (baseline 7).

**D3 A question about the house is answered from Pi Hub when it is asked, or the answer says it can't be.**
- Prints: the answer reads Pi Hub's print list (`GET /api/workshop`, `prints`: Bambuddy's last 20) at ask time, stores
  none of it, and cites each one with a link to Workshop. `prints_available: false` reads as "Bambuddy isn't
  answering", never as "no prints".
- Films: Pi Hub serves no watch history today (the `/api/movies*` routes are the catalogue), so the answer is that
  the Assistant keeps no record of what was watched. A route for it is not part of A28.
- Pi Hub not answering is said with the phrase table's `source_down`, never as an empty result.
- LocalAI reads `/api/now`, `/api/needs`, `/api/attention` and `/api/records` today (`app/pi-hub.js`), not
  `/api/workshop`. How it is allowed to read that route is settled in LocalAI's plan; A28 approves no new Pi Hub
  route, key or gate change. If step 20 builds `GET /api/history`, whether Ask reads it is decided with step 20.

**D4 The composer mode is not named "Ask history".** A25 gives the name History to Pi Hub's page, and one name has one
meaning across the platform. Proposed label: **Past work**, with the hint "Answers from what you did here". The route
stays `POST /api/journal/ask`.

**D5 Stored text that reaches a model is held to four rules.** This is the first place it does.
1. **Data, not instructions.** Retrieved entries go to the model inside a marked block and are described as quoted
   material to answer from, as LocalAI already marks board text (`<<<UNTRUSTED_REQUEST`). A journal entry can hold
   words from a web page, a board item or an old answer.
2. **No tools.** The run is a `prompt` run. It has no tools and starts no other run, so the worst a planted
   instruction can do is produce a wrong answer, shown above the entries it came from.
3. **This PC only.** A run whose prompt carries journal entries or project Memory is `private` in
   `app/model-router.js`'s terms: the local model, never a cloud one, including when "Use a bigger model" is on. This
   extends `coordinator`'s rule that house questions, voice and Siri are private (baseline 6.7).
4. **Not into a run that has tools.** A28 approves no injection of journal text into a mission's or an agent's
   prompt.

**D6 No History page in the Assistant for now.** Journal hits in ⌘K are built (the Find row). The tab is not: its name
is taken, it changes the page list A27 just settled, and whether the platform has one History or two is step 20's
question, answered after the owner's walk of step 17. Until then the spec's "any entry can be deleted" is met where
entries are already shown: each entry listed under a Past work answer has Delete, through the approval sheet, on the
route that exists.

**D7 No evening recap for now.** Its push would go through the one sender (baseline D2), but its Home card and
"Yesterday" line sit beside A25 4.2's line, and after D2 it would sum up the Assistant's own work only. Revisit with
step 20.

## What this approves

In LocalAI, each as its own PR off `main`, gated by its local CI:

1. Recorders for voice, approvals and Local AI's own release (the spec's PR 2, reduced by D2).
2. Past work: `POST /api/journal/ask`, the composer mode and the voice intent, under D3, D4 and D5 (PR 3).
3. Journal hits in ⌘K (the first half of PR 4).

The first of those PRs also brings `docs/superpowers/plans/2026-10-23-memory-core.md` into line: Tasks 5 and 6 out,
Task 7 kept, Tasks 8 and 9 changed by D3 to D5, Task 10 cut to the palette, Task 11 out.

## Not decided here

- **Answer feedback, project Memory notes in chat prompts, a list of owner facts in the system prompt.** Each is new
  behaviour and needs its own spec in LocalAI. D5 applies to all three.
- **The label in D4.** "Past work" is a proposal; "My record" and "Ask the journal" were the alternatives.
- **A watch-history route on Pi Hub**, and whether the Assistant's journal ever joins History (A25 already leaves the
  Inbox and Audit log to a later amendment).

## Non-goals

Any change to Pi Hub's code, routes or pages; any change to A25 or its steps; a new store; a new page in either app;
embeddings; fine-tuning.

## Evidence required

In LocalAI's tests, for the Past work PR:
- nothing retrieved: the answer is "I don't have anything about that" and no model is called;
- the prompt holds every retrieved entry inside the marked block, and the run is created with no tools;
- the router gives a Past work run the local model only, with "Use a bigger model" on;
- Pi Hub not answering, and `prints_available: false`, each produce an answer that names the source, with no model
  claim about prints;
- `app/journal-recorders.js` has no builder for `print`, `watch` or `materials`.

After it ships, the owner asks "what did I ask about yesterday" and "did my last print finish", in the composer and
by voice, and the second answer links to Workshop.
