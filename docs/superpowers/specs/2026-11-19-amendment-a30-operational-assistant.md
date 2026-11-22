# Amendment A30: the Assistant is an operational agent, with chat as its primary interface

Date: 2026-11-19 · Status: **approved** (merged on 20 Nov 2026, pi-hub #288: D1-D6 as recommended; D7 stays the owner's, as marked) ·
Amends: baseline 6.2 ("Surfaces that can act", l.601) and the Assistant rows of section 7 (l.708-711) only if D1's
alternative is chosen; A27 (D4 here); A28 D5.2 and D5.4 and A29 D4 (D2 here, for named reads only) · Builds on:
baseline 4 (Actions are part of a Record, l.364-367), 6.7 (asking the AI, l.682), 8.2 (action confirmation,
l.757-759); A22 (one site, Assistant pages inside Pi Hub's shell); A25 (every action reports the same way; History,
step 20); A28; A29; LocalAI's `coordinator` (local by default).

Read on 19 Nov 2026: pi-hub at `c7ec699`, LocalAI at `46e5178`. The owner's direction, in conversation the same day:
"Operational agent, with chat as its primary interface." Under the frozen baseline that is a proposal until this PR
merges; nothing below is built or approved by being said.

## Why

The owner wants one conversation that understands the house (printers, network, devices, services, Local AI), answers
from the system's own data, helps troubleshoot, and can do things safely. Today the Assistant cannot do any of that,
and the baseline forbids part of it.

What the code does now:

- **Chat is one model call with no tools.** The non-streaming path posts to Ollama with `messages` and no tool list
  (`app/server/chat.js:186-196`); the streaming path is the same (`chat.js:298-309`). Context is put in before the call:
  a status snapshot (`chat.js:94-104`), web search results as a system-level block with no untrusted marker
  (`chat.js:83-91`), owner facts and project notes (marked), and, for a House question, a block Pi Hub builds
  (`hub/ask.py:22-86`) whose house data is not marked.
- **Missions already have a read-only tool loop** (`app/agent-runtime.js:92`, tools in `app/agent-tools.js:120-211`),
  and no tool there reads the house or writes anything.
- **Pi Hub owns every device action.** `POST /api/printer/{action}` (`hub/app.py:536`; steps `clear`, `pause`,
  `resume`, `hub/printer_control.py:16`) and `POST /api/actions/{name}` (`hub/app.py:1120`) take the signed-in session
  and write `action_log` (`hub/auth.py:28`, `:237`). The baseline says there is no second action model (l.367) and
  lists Pi Hub and the display, not LocalAI, as the surfaces that can act (l.601). LocalAI holds no Pi Hub write key.
- **Approvals are records, not gates.** `apiApprovalDecide` sets a status and a notification; nothing waits on it, and
  `risk` is whatever the caller sent (`app/server/notifications.js:58-70`).
- **The route shown can be wrong.** `meta.route` names the provider that answered (`chat.js:223`, `:290`), but the
  local path reports the planned class and reason (`chat.js:152`, `usedLocal`), so after a cloud attempt fails the
  reason still describes the plan. Each cloud attempt is logged as activity before it is sent
  (`app/model-coordinator.js:64`, `:67`), but the attempts are not on the run. A fix is in progress in LocalAI.
- **The chat screen is the run view** (`app/public/run-bodies.js`). The kit (appliance-ui 2.23.2) has no chat thread,
  disclosure or tool-card pattern. A cloud answer arrives whole; only this PC's model streams (`chat.js:287`).
- **Pi Hub's confirmation is one inline line** (`hub/static/ui/confirm.js`), and the server routes do not check that it
  was shown: any owner or household session that POSTs runs the action. `/api/actions` takes the `household` role
  (`hub/app.py:1122`), though the baseline says every action is owner-only (l.759). The kit has no typed-entry confirm.
- **Chat is "a mode" under A27 D5 item 8, and A27 is merged but not built.** A28 D5 and A29 D4 keep stored text and
  prints to runs with no tools. House questions are private and local (baseline l.682).
- **An Open WebUI trial is in flight** (replacement audit, 16 Nov; the gated name is in pi-hub #272). It is a second
  chat front end for the same PC.

## What changes against the baseline

| Baseline says | A30 proposes | Decision |
|---|---|---|
| "There is no second action model" (l.367); only Pi Hub and the display act (l.601) | Unchanged under the recommendation. The Assistant proposes; Pi Hub's existing path executes. Changed only under D1's alternative | D1 |
| A28 D5.2: Past work runs have no tools. D5.4: no journal text into a run with tools. A29 D4: print names to a no-tools run | A chat run may call a fixed list of read-only Pi Hub readers. Stored journal text and project notes still never enter a run that has tools | D2 |
| Host-level actions in the Assistant keep typed confirmation (l.758) | The same rule applies to host-level actions proposed by the Assistant, run on Pi Hub | D3 |
| A27: chat is a mode under Ask; Assistant navigation capped at two levels | Chat is the Assistant's front door; A27's navigation is folded in, and its two-level cap stands | D4 |
| House questions are private (l.682) | The rule becomes a property of the turn (it read house data), not of how the question was worded | D5 |
| Provenance: "Answered by ..." (l.683) | Provenance is recorded per turn, from routing telemetry, with attempts behind a disclosure | D6 |

## Decisions

**D1 The Assistant proposes; Pi Hub executes.** (Recommended.) An action card in chat calls nothing. It names an
action Pi Hub already lists (`restart:plex`, `pause`, and so on) and carries the run id; its button opens Pi Hub's own
confirmation for that action, on Pi Hub's origin, under the owner's Pi Hub session. Pi Hub re-checks the state itself,
as `api_printer_action` does today (`hub/app.py:545-552`), runs the action, and logs it. Three consequences:

- **Audit.** `action_log` has `ts, role, device, action, result` and no run id. Pi Hub gains one nullable column
  (`source_run`) and Phase 4 writes the Assistant's run id into it, so "what did the Assistant suggest, and what did I
  run" is two rows joined on the id. The Assistant's own Audit log (System › Assistant, A27 D3) records the proposal.
- **Hand-off.** The card opens Pi Hub with the action name and run id as a link; arriving executes nothing, and Pi Hub
  accepts only names in `actions.ACTIONS` or `printer_control.STEPS`. The framed Assistant and Pi Hub's shell are on
  different origins (A4, A22), so the link, not a cross-origin POST, carries the proposal.
- **Nothing to rotate.** No key lives on the PC, and with the PC off nothing changes (baseline 7: Pi Hub must be right
  with the PC off).

Alternative: a scoped LocalAI-to-Pi Hub service key, one per action name, so a card can run in place. It saves a tap
and costs a surface. Baseline 6.2 l.601 would add LocalAI to "Surfaces that can act"; l.364-367 would read "one action
model, three callers"; section 7 l.708-711 gains a key store on the PC; Pi Hub gains per-key scope, rate limit and
revocation; the key becomes a secret the model-router's `secretish` guard must never send to a cloud model; and
confirmation moves into LocalAI, which has no server-side gate today (`notifications.js:58-70`). Recommend against.

**D2 Read-only tools in chat.** (Recommended.) A chat turn may call tools that read Pi Hub, local model only:
`/api/now`, `/api/now/prints`, `/api/needs`, `/api/records` (all read by LocalAI today, `app/pi-hub.js:113`, `:131`,
`:147`, `:170`). This reuses the mission loop (`runAgentLoop`, `agent-runtime.js:92`) with a new tool set.

- **Read-only by construction.** Each tool is a fixed GET to one of those four paths. No tool takes a method, a URL or
  a header; none can write. The sign-in-free machine paths are all it can reach, so it cannot read owner-only data.
- **Untrusted text is marked.** Everything that is not Local AI's own words is wrapped as quoted material the way
  board text is (`<<<UNTRUSTED_REQUEST`): print names, notice text, device names, error strings, web results
  (`chat.js:83-91` is unmarked today; this PR set marks it, since a run with tools now exists).
- **Amends A28 D5.2, D5.4 and A29 D4 for these four readers only.** Journal text and project Memory still go only to
  no-tools runs, and a turn with house reads carries none of them. A turn that has any tool is `private` (D5).
- A failed read is its own result: `source_down` or `prints_available: false` reaches the model and the card as
  "not answering", never as an empty list.

Alternative: keep chat tool-less and put readers behind the existing Past work and House question modes. It is the
smaller change and leaves "answer from actual system data" to two modes the owner must choose between.

**D3 Owner-only printer actions are never proposed unprompted; consequential ones always confirm.** (Recommended.)

- Print start, queue, pause, resume and cancel, and clear-plate, are proposed only when the owner asks for that action
  in that turn. Start stays the A12/A19 flow with its own sheet. A status question never ends in an action card, and
  "the print looks stuck" gets a diagnosis and a card only if the owner then asks.
- Service restarts, network changes and a reboot always open Pi Hub's confirmation. Host-level ones (`restart:pi`) need
  typed entry, as baseline l.758 says. Pi Hub's confirm has none (`restart:pi` is a danger-toned button,
  `hub/static/js/core.js:1239`), so Phase 4 starts with a typed variant in appliance-ui, then syncs it into Pi Hub.
- **This amendment adds no action.** The Assistant may propose only what `ACTIONS` and `printer_control.STEPS` list. Pi
  Hub exposes no network-equipment action beyond `restart:adguard`; adding one is its own amendment.
- Read-only versus state-changing is a property of the tool or action, set in Pi Hub's code, never a field a model or
  a caller supplies (compare the caller-supplied `risk`, `notifications.js:60`).

Alternative: allow the Assistant to propose any action whenever it judges it useful. Faster for the owner and puts a
nudge to act beside the printer on a model's guess. Not recommended while a print is the costly thing to get wrong.

**D4 Chat is the Assistant's primary surface; A27 is folded in.** (Recommended.) A27 makes chat a mode behind an Ask
action and is merged but not built, so nothing needs undoing. Instead: `/assistant` opens on the conversation with a
persistent composer, and the two-level cap, the System › Assistant tab and the Developer tools card page (A27 D1,
D3, D5) stand as written. A27 D4's Pinned and Recent move beneath the composer, and its ⌘K promotion stands. Modes
(Past work, Image, voice) are chips on the composer, not routes. This amends A27 D5 item 8 ("chat → Ask action /
mode") and D4's "Assistant Home" and nothing else; the LocalAI plan for A27 (#274) is revised, not replaced.

Alternative: build A27 as merged and add the conversation later. Two navigation rebuilds on the same views.

**D5 House data never goes to a cloud model.** (Recommended.) Today a turn is private when it is labelled a House
question or matches a pattern (`chat.js:127`), a question by wording. Under D2 the server marks a turn `private` the
moment any tool result from Pi Hub enters it, and the thread stays private afterwards, as a voice or key turn does
(`chat.js:119`). "Use a bigger model" does not lift it. House data in this sense is every D2 reader's output.

Alternative: allow cloud models for redacted house data. Not recommended; baseline l.682 chose the opposite and redaction
of names and addresses is a promise the router can't verify.

**D6 Route transparency from telemetry.** (Recommended.) Each assistant message shows a chip, "This PC" or the cloud
provider's name, and the reason, taken from what the run recorded, not from the plan. LocalAI records the attempts
(provider, model, outcome, time) on the run's `meta`, from the same point that already logs them as activity
(`model-coordinator.js:64-67`), and the chip reads the last attempt that answered. The attempts list, the model name and
the tool trace sit behind one disclosure per message, closed by default. The chip depends on the in-progress fix;
until it merges, the chip is not shown, rather than showing the planned reason.

Alternative: show the plan before the turn ("will use this PC") and not the outcome. Cheaper and can be wrong after a
fallback, which is the fault being fixed.

**D7 Close the Open WebUI trial in favour of this direction.** (Recommended; the owner decides.) A second chat client
with its own accounts and memory splits the record A28 D1 keeps in one place, would need the Caddy gate to stay within
A22's one sign-in, and cannot call Pi Hub's readers or propose its actions (D1, D2). If the owner prefers to run it
anyway, it stays a trial: no data from Pi Hub, no tools, no link from the platform's navigation, and a stated end date.
The audit's own gate ("do not trial until the owner wants it") and #272 stay the owner's.

## Phased delivery

- **Phase 0, defects: not part of this amendment.** Route and reason after fallback (in progress in LocalAI); marking
  web search text as untrusted is listed under D2 because it matters more once tools exist. Referenced here only.
- **Phase 1** is this amendment's decision. It is not a build phase.
- **Phase 2, conversation-first UI, no new authority.** Kit first, in appliance-ui: chat thread, composer, disclosure
  (details/summary), streaming message and a result card, each with loading, empty, error, disabled and long-content
  states, keyboard and `prefers-reduced-motion`. Then LocalAI adopts them in the run view and `/assistant` (D4, D6's
  chip when its fix is in). No tool, no action, no Pi Hub change.
- **Phase 3, read-only tools in chat (D2, D5).** Four readers, marked untrusted text, `private` by server rule,
  structured cards for device state, diagnostics and tool results (kit pattern from Phase 2). LocalAI only; no Pi Hub
  route, key or Caddy change, since all four paths are served today.
- **Phase 4, actions (D1, D3).** Appliance-ui typed confirm; Pi Hub `source_run` column and the hand-off link; action
  cards. Status of an executed action reads back from Pi Hub's own result and, where the action has one, its
  verification (`/api/actions/{name}/verification`), shown on the card and in A25's History when step 20 exists.

Each phase is its own PR per repo, provider first (Pi Hub or the kit, then LocalAI), each gated by its own CI.

## What stays unchanged

Pi Hub as the only executor and its owner session, `action_log`'s 90-day window, A12/A19 start sheets, A13 ship and
merge, and Pi Hub's work with the PC off. The machine paths and Caddy. A28 D1-D4 and D5.1, D5.3 (journal and notes stay
local). A25's one History. A22's one site and A27's two-level cap. Local AI on its own origin. Printing: no job is
queued, started, paused or cancelled by a model; only the owner, through Pi Hub's confirmation.

## Conflicts and gaps found while writing this

- Baseline l.364-367 cites `hub/app.py:379` and `:747`; the routes are at `:536` and `:1120` now. Not changed here.
- Baseline l.759 says every action is owner-only; `/api/actions/{name}` allows `household` (`hub/app.py:1122`) and
  every entry in `ACTIONS` is `household` or higher. D1 relies on the session role either way; the mismatch is a
  separate fix.
- Confirmation is a client sheet only. A direct POST skips it. D1 keeps that true for the Assistant (it never POSTs),
  but "confirmation for consequential actions" is not a server guarantee, and this amendment does not make it one.
- A28 and A29 files still read "proposed" though merged (pi-hub #282; A29 implemented in LocalAI #567). A doc fix, not
  made here.
- The baseline's Amendments list lacks A24 (a draft), and the platform-roadmap fact sheet still says A26-A28 are
  missing from it though they were added in `f7ef432`.

## Not decided here

A watch-history reader; network-equipment actions; a longer tool list (documents, Plex, Homebridge accessories)
beyond the four; whether tool traces are journalled (A28 D1 says only the Assistant's own work; a trace is that, but it
holds house text, so no until decided); voice and Siri turns using tools; cloud use for non-house turns with tools.

## Non-goals

Any LocalAI write to Pi Hub; any new Pi Hub action; a change to Caddy, keys or sign-in; embeddings; replacing the
Past work or House question modes in Phase 2 or 3; a chat client other than the Assistant's.

## Evidence required

- **Phase 2:** appliance-ui checks for each new pattern across all states; LocalAI width sweep (390, 820, 1440) in
  light and dark with axe clean; composer stays visible with the keyboard open on a phone; a streamed local reply and a
  whole cloud reply both render; reduced-motion honoured.
- **Phase 3:** tests that no tool can send a non-GET or reach a path outside the four; marked-untrusted text in the
  prompt for each reader; a turn with a Pi Hub read is created `private` and stays so with "bigger model" on and on a
  follow-up turn; Pi Hub down, Bambuddy down (`prints_available: false`) and a stale record each read as "not answering",
  never as empty; a planted instruction in a print name changes nothing.
- **Phase 4:** a card never issues a request to Pi Hub; arriving by link executes nothing and an unknown name is
  refused; the executed action's `action_log` row carries the run id; `restart:pi` needs the typed entry and `pause`
  does not; a status question produces no action card; with the PC off, Pi Hub's own buttons are unchanged.
- After each ships, the owner asks on the phone: "is the printer busy", then "pause it", and sees the card, the Pi Hub
  confirmation, the result and the `action_log` row.
