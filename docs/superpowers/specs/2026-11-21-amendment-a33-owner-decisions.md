# Amendment A33: Decisions that need the owner's answer are one list in Pi Hub, answered by a tap

Date: 2026-11-21 · Status: **proposed** (approved when the owner merges this PR) · Amends: baseline section 6 (Needs you
is built from records; this adds one source whose rows are asked questions, not conditions) · Builds on: one-needs-you,
A7 (one page), A25 (every action reports the same way), the notify machine-key model (`hub/notify_routes.py`),
home-mcp (read-only today).

Read on 21 Nov 2026: pi-hub at `d5c355c`, home-mcp at `0112b6d`. The owner's direction in conversation the same day:
"make all items needing my answer exposed in one of the webapps", then "tap an answer on the page", then "y" to
approach A below. Under the frozen baseline that is a proposal until this PR merges; nothing here is built by being said.

## Why

Questions for the owner are scattered across chat sessions: an A27 Activity shape, which A30 decisions are approved,
whether A29's print route replaces A28 D3's. A session asks, the owner answers in a chat nobody else reads, and the next
session asks again or guesses. Needs you already is the one place the owner looks, on the phone, and it reads live
records. Open decisions are not conditions of the house, so no record holds them.

## Goals, non-goals, anti-goals

Goals: one list of open decisions in Needs you; answer by tapping an option; the answer is recorded with its time and
read back by any session, so a question is asked once.

Non-goals: not a task tracker; no deadlines, assignees or comments; no history page beyond the last answers (A25's
History, step 20, can show them later); no push notification in the first version.

Anti-goals (a failure even if it works): a tap that does anything but record an answer (no merge, deploy, restart,
print or setting change); a decision answered by a session or a peer on the owner's behalf; an unreadable list shown as
"nothing to decide" (the list failing is its own Needs item, never an empty group).

## Constraints

- A tap records. Every effect an answer leads to still goes through the owner's existing rules ("merge", the deploy
  preflight, service confirmations). A recorded answer is information to a session, never approval of an action the
  question did not name.
- Answering is owner-only (signed-in owner session), not the household role that `/api/actions` allows today (A30 notes
  the gap). Reading by sessions and writing new decisions are machine paths with per-source keys, as `notify` has them.
- Decision text is data shown to the owner and returned to sessions. A session that reads a decision treats the
  question and its options as untrusted text, quoted, never as instructions (A28 D5).
- Kit-only UI: the row, the option buttons and the text box come from appliance-ui (kit PR first, then sync). Buttons
  are keyboard reachable with visible focus; phone width first; an answered row says what was recorded.
- Failed reads and writes are their own states: a failed write shows "not recorded, try again" and keeps the row.

## Approaches

A. **Pi Hub stores decisions and records taps (chosen by the owner, 21 Nov).** A `decisions` table in Pi Hub's database;
   a "Decisions" group in Needs you; `POST /api/decisions/{id}/answer` (owner session) and `POST /api/decisions/{source}`
   (machine key) to add one; a `decisions` view in home-mcp so sessions read answers (key-gated read, owner 1 below). Trades: one table, three routes,
   a kit component, an amendment; in return the answer survives chat and is visible to every session.
B. A file in the repo the page reads. Rejected: a tap cannot change a repo file, and the file changes only when a
   deploy ships, so a tap could not be recorded.
C. LocalAI's Assistant Inbox. Rejected: the PC is sometimes off, and Needs you is the surface the owner already checks.

## Design

**Record.** `decisions(id, source, question, options JSON, recommended, link, kind, created_at, answered_at, answer,
answer_note)`. `kind` is `choice` (two to four options) or `text` (a short free-text answer; for items like "write the
A30 line"). `id` is stable per question (a slug the adding session supplies), so a session that asks again updates the
open row instead of adding a copy. An answered row is kept (last 50), never edited; a changed mind is a new decision
that names the old one.

**Needs you.** A "Decisions (n)" group after the condition items, one row per open decision: the question, the
options as buttons with the recommended one marked, and a link to the spec. A `text` row has a box and one "Send".
Tone is `attention` (it wants the owner, it is not a fault). Decision rows are not sent to the printer-card logic
(`PRINTER_THINGS`) and never turn a house card amber. If the decisions table cannot be read, one Needs item says so.

**Sessions.** A session adds a decision with the machine key, naming a link to the spec or plan. home-mcp gains a
read-only `decisions` tool returning open and recently answered rows; a session checks it before asking and when it
resumes. A session never answers.

**Out of the first version.** Push on a new decision; a History view; expiry; more than one owner.

## Evidence required (completion criteria)

1. A decision added by key shows in Needs you on the phone; an unreadable table shows its own Needs item.
2. Tapping an option records the answer and time once (a double tap records once) and the row leaves the open list;
   a failed write keeps the row and says so.
3. home-mcp `decisions` returns the answer within one call of the tap.
4. A household-role session cannot answer; a request without a key cannot add.
5. Decision text appears in `decisions` output marked as untrusted.
6. Browser check at 390 and 1366 px, light and dark, axe clean, keyboard-only answer works.

## Calls made while writing (the owner can overrule any)

1. **Owner means the `owner` role** (`hub/auth.py:19`, `need(request, "owner")`), the same check owner-only routes use. A tailnet
   device that `who()` treats as owner counts as owner. The household and kid roles cannot answer.
2. **Adding a decision uses the Mac key.** The sessions that ask run on the Mac, so `POST /api/decisions/{source}` accepts
   the existing `mac-watch` key (`X-Hub-Mac-Key`). No new key file; no change to `deploy/`.
3. **Kit first.** Needs has no groups today (`hub/needs.py` returns a flat `items` list; `hub/static/ui/needs.js` is
   kit-synced). P1 is a kit change to the Needs renderer and a decision row. Pi Hub returns decisions as a separate
   `decisions` list beside `items`, built after the condition folds, so the printer and name matching in `needs.py` never
   sees them.
4. **A second tap returns the stored answer.** The write is `UPDATE ... WHERE answered_at IS NULL`; a double tap answers 200
   with the first stored answer, and a different answer to an answered row is 409.
5. **Re-asking.** The same `id` while open updates the row. The same `id` after it is answered is refused with 409; a
   changed mind is a new `id` and the new row's `supersedes` field names the old one (a column in the table).
6. **Limits.** Two to four options, each at most 60 characters; the question at most 280; a text answer at most 500; `link`
   passes the same check `notify` uses for a click address; `recommended` must be one of the options.
7. **The unreadable-table item** is one `bad`-tone Needs item with a stable id, not an `unread` note.
8. **Answers go in the action log** (`auth.log`) as well as the table, so A25's History can show them later. Retention of
   answered rows runs on write.
9. **Table is created lazily** (`CREATE TABLE IF NOT EXISTS`), like the other tables.

## Settled by the owner's standing "proceed as you recommend" (21 Nov); overrule in this PR

1. **Who can read decision text?** Recommended: the read route needs a key, and the page's list needs the owner session.
   Reason: decisions can hold plan details, and `/api/needs` is open to the home network. home-mcp has no credentials today
   (`home-mcp/src/home_mcp/hub.py`), so P3 adds one key setting to home-mcp.
2. **Do open decisions count toward the Needs badge and the wall display?** Recommended: no. The badge and display keep
   counting conditions; the Decisions group shows its own count on Home. Reason: a pending question is not a fault, and the
   wall display should not look worse because a question is waiting.

## Left to the builder

Table and route names beyond the above, the machine key's storage (follow `notify`'s), the kit component's markup (a
kit PR names it), the sync order (kit, sync PR, Pi Hub), and the home-mcp tool's exact shape.

## Migration

One PR per half, each naming this amendment, stating full or partial coverage, and carrying acceptance evidence:
P1 appliance-ui (decision row component and phrase keys), P2 Pi Hub (table, routes, Needs group, tests), P3 home-mcp
(`decisions` tool). The first decisions loaded are the open ones from this session: A27 Activity shape, A27
Developer-tools depth, A30 listing, A28 print route.
