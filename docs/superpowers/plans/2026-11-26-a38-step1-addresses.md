# A38 step 1: every Assistant page opens at its own address — Plan

Date: 2026-11-26. Status: **proposed** (approved when the owner merges this PR); nothing built.

## Goal

Every Assistant page in the page list opens in Pi Hub at its own address (`/assistant/work`, `/assistant/chat`, …)
instead of "Page not found", and the address bar names the page the frame is showing. Nothing else about the Assistant
page changes yet: Local AI still draws its own strip in the frame until steps 2 and 3.

## Spec

- Amendment A38, `docs/superpowers/specs/2026-11-25-amendment-a38-assistant-unnested.md`, approved by the owner's merge
  of pi-hub #351 (`a43fd07`) and listed under the baseline's `## Amendments`. This plan covers **step 1 (Addresses)**
  of its Steps table: "Section 1: serve every Assistant path in the list, map path ↔ view, redirect `?to=`. No strip
  yet; Local AI is unchanged".
- Built here, from A38 section 1 and D1 ("the page list's path, `?to=` kept as a redirect"): the addresses, the path
  ↔ route map, `?to=` for routes with no row, the address following the frame, and the `?to=` redirect.
- Left for step 3, with reasons below: "Moving between framed pages keeps the frame" (decision 1; A38 gives it no step
  of its own, this plan assigns it to 3) and "A route that belongs to a `drawn: hub` row … Pi Hub opens its own page"
  (decision 4).
- Not built here: A38 sections 2 (navigation), 3 (the frame's edge and height), 4 (sign-in) and 5 (messages). They are
  steps 2 and 3.
- **Waits on:** nothing. A38: "Step 1 is worth shipping alone: it fixes 19 dead addresses and needs nothing from Local
  AI."

## Done means (A38 step 1, "Done when", quoted)

1. "a test walks the synced page list and every Assistant path answers with the shell and frames the right view";
2. "the 19 addresses above open live".

## What exists today (read on 26 Nov 2026, `origin/main`: pi-hub `affbe94`, kit 2.32.0 synced; LocalAI `2ddce95c`)

- **The server** answers the shell for `SHELL_PATHS` (the list's `system: hub` pages and `/assistant`), two hard-coded
  Assistant pages and a task (`hub/app.py:1598-1616`, `_shell_paths`, `ASSISTANT_PAGES`, `ASSISTANT_RUN`,
  `_is_shell_path`). Any other address gets the standalone 404 page (`app.py:1671-1672`).
- **The page list** (`hub/static/ui/pages.json`, kit 2.32.0) has 23 `system: assistant` rows. Three are marked
  `drawn: hub` (`/assistant/status`, `/assistant/models`, `/assistant/run/<id>`); `/assistant` is the frame; the other
  **19** have a `path` and a `view` and are not served.
- **The router** (`hub/static/js/main.js:73-105`) knows `/assistant` (in the `ROUTES` literal), the two drawn pages
  (added after it, `:102-103`) and the task pattern; `pageFor()` (`:105`) returns nothing for the 19, so an in-app link
  to one draws `NOT_FOUND` (`:108-118`). The hand-off test (`:313`) matches `/assistant` exactly.
- **The head.** The heading and tab title fall back to the page's own title (`main.js`, `SITE.headingFor(path) ||`);
  the purpose line is the Assistant's only for `path === "/assistant"` (`purposeOf`, `:120`). `SITE` holds `system: hub`
  rows only (`site.js:10`), so Assistant rows have no strip, no heading and no palette entry, and `sectionFor` marks
  the head's button for any `/assistant/…` path (`site.js:70-71`).
- **Needs-you links** into the Assistant are `#inbox`, `#work`, `#status`, `#ask?context=…` or bare (`hub/needs.py:21-22`,
  `:105`); none carries a run. Pi Hub's task page has no link to Local AI's own run view.
- **The frame page** (`hub/static/js/assistant.js`): `frameSrc()` (`:52-58`) builds the frame's address from
  `?context=` or `?to=`; `addressFor()` (`:60`) writes `/assistant?to=<route>`; the route listener (`:126-136`) replaces
  the address only when `location.pathname === "/assistant"`; `retarget()` (`:156-168`) returns false for a `?to=` link,
  so the shell remounts the page and the frame reloads.
- **Links that write `?to=`:** `sections.js:42` (`tool:assistant/#…` links), `versions.js` (the Atlas link),
  `assistant-run.js`, and the Site map (`map.js:32`, from the five hard-coded `ASSISTANT_PAGES` at `assistant.js:28`).
- **The service worker** precaches a fixed file list (`hub/static/sw.js:7`, `FILES`).
- **Not served, and staying so:** the list's `redirects` (such as `/assistant/changes/in-progress`) and `cards`
  addresses (such as `/assistant/tools/files`). A38 section 1 serves a row's `path` only.
- **Tests that pin today's behaviour:** `tests/test_routes.py:75-80` (the `ROUTES` literal equals the list's hub pages,
  and `SHELL_PATHS == pages | redirects`); `tests/test_assistant_no_proxy.py:50-54` (`/assistant/chat` is **not** a
  shell path); `tests/test_assistant_pages.mjs:10`, `:36-47`, `:72-73` (imports `ASSISTANT_PAGES` and `addressFor`; no
  Assistant row in strips, palette or map; the Site map's five); `tests/test_assistant_shell.mjs:40-43`, `:112`,
  `:122-125`, `:151`, `:173`, `:178-179` (`frameSrc(query)`, `/assistant?to=run%2F…`, the Atlas link, the five Site map
  links); `tests/browser/assistant.mjs`.
- **Local AI's views** (`app/public/view-registry.js`): all 22 `view` values in the list exist. `ask` and `create`
  resolve to `home` with a mode (`router.js:7`; `ALIASES`, `view-registry.js:78`), and `runs` to `work`. Views with no
  row carry their own placement: `inProgress` and `shipped` have `lights: 'backlog'`; `workbench`, `repoTools`,
  `powershell`, `actions` and `automations` have `card: 'tools'`; `research` is in the `improve` domain with neither.
- **Live:** the 19 addresses answered "Page not found" at 1440 and 390 px in the walk of 25 Nov.

## Decisions this plan makes (for the owner's review)

None changes the spec. If the owner disagrees with one, it changes here.

1. **A link from one framed page to another reloads the frame in this step.** A38 section 1 keeps the frame by posting
   `assistant-go`, which Local AI does not have until step 2. Until then such a link remounts the page, as a `?to=`
   link does today. Moves made inside the frame (Local AI's own strip and tabs, still there) already keep it. Rejected:
   steering the frame by replacing its fragment from Pi Hub, a second mechanism that step 3 would delete. Cost: text
   typed in the composer is lost if the owner uses the palette or Site map to jump to another Assistant page. That is
   today's behaviour, so nothing gets worse.
2. **Rows the list does not have ride on these pages** (A38: "the plan names the row each rides on"), following Local
   AI's own registry:

   | Local AI route (its view is the exact text before `?`) | Pi Hub address | Why |
   |---|---|---|
   | `home`, or empty | `/assistant` | the list's `ask` row |
   | `home?mode=ask`; `ask` with no context | `/assistant/chat` | A38 names it; the router rewrites `ask` |
   | `home?mode=create`; `create` | `/assistant/image` | A38 names it |
   | `home?mode=<anything else>` | `/assistant?to=<route>` | not a row |
   | `ask?context=…` (what Local AI posts after a hand-off) | no change: the address stays `/assistant?context=…` | a hand-off is not a page |
   | `inProgress`, `shipped` | `/assistant/changes?to=<route>` | registry `lights: 'backlog'` |
   | `research` | `/assistant/changes?to=research` | `improve` domain; it has no tab of its own |
   | `workbench`, `repoTools`, `powershell`, `actions`, `automations` (n8n; not the `automationStudio` row) | `/assistant/tools?to=<route>` | registry `card: 'tools'` |
   | `runs` | `/assistant/work` | registry alias |
   | `run/<id>` | `/assistant/work?to=run/<id>` | Work is where runs live (decision 4) |
   | `status`, `models` | `/assistant/system?to=<route>` | their parent row; Local AI's own copies, as today (decision 4) |
   | a view Pi Hub does not know | `/assistant?to=<route>` | today's behaviour; never "Page not found" for a real Local AI page |

   Any other query on a route (`backlog?stage=x`) is kept as `?to=` on its row's path. Chat and Image are modes of one
   Local AI view, and switching mode inside the frame does not change its route, so the address can read
   `/assistant/chat` while Image is showing. That is Local AI's to post (step 2), and is named here so it is not taken
   for a bug in this step.
3. **`/assistant?to=<route>` is corrected in the browser, not by the server.** On opening, the page replaces its own
   address with the mapped one (`history.replaceState`), then frames the route. Rejected: a server redirect, which
   would need the route map twice (Python and JavaScript) for no gain the owner can see.
4. **A route that names a page Pi Hub draws stays in the frame in this step.** A38 section 1 says such a route
   (`status`, `models`, `run/<id>`) opens Pi Hub's own page. Built as written today, opening a run from Local AI's
   Work list would leave the frame for Pi Hub's task page, and nothing leads back: that page has no link to Local AI's
   run view, which shows more (A34 keeps the run viewer for P5). So this step keeps those three framed, as they are
   now, and step 3's plan settles the hop with one of two readings, for the owner to choose there: (a) follow A38 as
   written and add "Open in the Assistant" on Pi Hub's task page, exempt from the hop; (b) follow it for `status` and
   `models` only, and for runs when P5 lands. This plan recommends (a). Addresses the owner types are unaffected:
   `/assistant/status`, `/assistant/models` and `/assistant/run/<id>` open Pi Hub's pages, as today.
5. **The head is `/assistant`'s on every framed page in this step**: the heading and the tab title read
   "Assistant" and the purpose line is the Assistant's (today `purposeOf` gives it for `/assistant` only; it is widened
   to every framed path). A38 section 2 gives Pi Hub the page's own title only once Local AI has dropped its navigation
   (step 3); showing the row's name over Local AI's own title now would add the doubled heading A38 removes.
6. **The hard-coded lists go.** `ASSISTANT_PAGES` in `hub/app.py` (status and models) is replaced by the list's own
   `drawn: hub` mark, now that kit 2.32.0 carries it; the task pattern stays. `ASSISTANT_PAGES` in `assistant.js` (the
   Site map's five) is deleted: `map.js` reads the Assistant's rows straight from the page list. `site.js` still holds
   hub rows only, so no strip, heading or palette entry appears for an Assistant row before step 3.
7. **Pi Hub's tests hold a copy of Local AI's view ids**, dated and with the commit it was read at, so the "every view
   is placed" test can run on the Pi. It cannot see a view Local AI adds later; step 2's LocalAI PR adds the matching
   test on its side (every view id is in the list or in this table). Until then drift shows as decision 2's last row,
   not as an error.

## Steps, one PR at a time

### PR 1 (pi-hub): the addresses

Spec: A38 section 1, D1. Coverage: **partial** (all of section 1 except keeping the frame across framed pages, which
is step 3 with `assistant-go`). Evidences criterion 1.

- `hub/app.py`: `_shell_paths()` also takes the list's `system: assistant` rows that are built, have no `#` and no
  `<…>` in the path. `ASSISTANT_PAGES` is deleted; `ASSISTANT_RUN` and `_is_shell_path` keep the task pattern.
  An Assistant address not in the list still gets the 404 page.
- New `hub/static/js/assistant-routes.js`, pure and with no DOM: `routeForPath(path, query)`, `addressForRoute(route)`
  and `isHubDrawn(address)`, built from the page list (`site.js`) plus decision 2's table. `addressFor()` in
  `assistant.js` is replaced by it; nothing else writes an Assistant address.
- `hub/static/js/main.js`: `pageFor()` returns the frame page for every framed row, added beside
  `PAGES["/assistant/status"]`; the `ROUTES` literal is not touched (`test_routes.py` compares it with the list's hub
  pages). `purposeOf` per decision 5. The hand-off test at `:313` stays exact (decision 1).
- `hub/static/js/assistant.js`: `frameSrc()` takes the path as well as the query; on mount a `?to=` address is
  replaced per decision 3; the route listener writes the mapped address on any framed row and never leaves the frame
  (decision 4); a posted `ask?context=…` changes nothing. The 10 s timeout, the down states and "Start a task" (on `/assistant`
  only) are untouched.
- `sections.js:42`, `versions.js`, `assistant-run.js`, `map.js`: build addresses with `addressForRoute`.
- `hub/static/sw.js`: `assistant-routes.js` joins `FILES`.
- **Tests** (named for what they prove):
  - Python: every `system: assistant` path in the synced list answers 200 with the shell; `/assistant/nope`,
    `/assistant/chat/x` and `/assistant/run/..` answer 404; `SHELL_PATHS` equals the list's hub pages, their aliases
    and the Assistant's rows; the no-proxy test still finds no route into Local AI.
  - Node: path → route → path round-trips for all 22 rows with a view; each row of decision 2's table; `run/<id>` with
    any id; a route with a query (`backlog?stage=x`) keeps it as `?to=`; `ask?context=…` maps to nothing; an over-long
    or control-character route is no route (unchanged `cleanRoute`); every id in the Local AI view fixture is placed;
    the Site map lists the list's Assistant rows; no Assistant row has a strip, a heading or a palette entry.
  - Existing tests rewritten to the new addresses, each named in the PR: `test_assistant_shell.mjs` (`frameSrc`'s
    signature, `:112`, `:151`, `:173`, `:178-179`), `test_assistant_pages.mjs` (`:10`, `:36-47`, `:72-73`),
    `test_assistant_no_proxy.py:50-54`, `test_routes.py:80`.
  - Browser (`tests/browser/assistant.mjs`, the stand-in frame): each of the 19 addresses loads the shell and frames
    the expected fragment; a route post moves the address to the mapped path with no history entry; a route post for
    `status` keeps the frame at `/assistant/system?to=status`; `/assistant?to=work` ends at `/assistant/work`; a
    hand-off keeps `/assistant?context=…`; the heading, purpose line and tab title on `/assistant/work` are the
    Assistant's; with the PC off, a framed address
    shows "The PC is off" and no frame; reload on `/assistant/changes?to=shipped` reopens it.
  - The repo's width sweep and axe on `/assistant/work` (the page's layout is `/assistant`'s, so one framed address
    stands for all).
- Merges independently. `hub/app.py`'s `_shell_paths` is also changed by the A35 session's later H7 PR (a
  `/missions/<slug>` pattern); whoever lands second merges main.

### PR 2: none

There is no second code PR. Step 1 ends with the live check below.

### Live check (after PR 1 is deployed)

Evidences criterion 2.

- Agent, signed out: all 19 addresses answer 200 with the shell at 1440 and 390 px, and the frame's address is the
  mapped route (the walk script of 25 Nov, rerun). Signed out, the frame itself still shows the gate's redirect (A38
  finding 7); that is step 3's to fix and is recorded, not counted as a failure here.
- **Owner**, signed in, on the phone and the laptop: open `/assistant/work`, `/assistant/chat` and `/assistant/tools`
  from the address bar; in the frame move from Work to Projects and see the address follow; reload and see the same
  page; press Back once and leave the Assistant.

## Acceptance

Recorded in `docs/operations.md` as "A38 step 1 accepted <date>" with the walk's counts and what the owner saw.
The ladder: merged, deployed, runtime verified (the agent's walk), accepted (the owner's check). A matching commit on
the Pi is a deploy, not acceptance. Step 2's plan (LocalAI framed mode) is written after acceptance.

## Out of scope (noted, not gated)

- **Two navigations are still visible** after this step (Local AI's strip in the frame). Owner: A38 steps 2 and 3.
- **Signed out, the frame shows Pi Hub inside Pi Hub.** Owner: A38 step 3 (section 4).
- **Whether a run opened in the frame hops to Pi Hub's task page** (decision 4). Owner: A38 step 3's plan.
- **A view Local AI adds later is not caught on the Pi** (decision 7). Owner: A38 step 2's LocalAI PR.
- **`/lab/designs` and `/lab/tools`** stay "Page not found" (`built: false`; baseline step 15).
