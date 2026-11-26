# Amendment A38: The Assistant reads as one page; Pi Hub draws its navigation, the frame has no chrome

Date: 2026-11-25 · Status: **proposed** (approved when the owner merges this PR; D1-D3 as recommended) · Amends:
- **A4** (`2026-11-03-amendment-a4-assistant-in-shell.md`):
  - section 5.2, "Inside the Assistant, framed" (a4:50-52: Local AI's five pages "become a level-2 strip at the top
    of the frame");
  - section 5.6's route (a4:56-57, `?to=<LocalAI hash route>`) and **requirement 7** (a4:80-84, Pi Hub's URL is
    `/assistant?to=…`);
  - **requirement 3** (a4:66-68), widened: framed, Local AI drops its navigation and page title as well as its chrome;
  - **requirement 8** (a4:85-86, the frame "is the only scroller in the page").
- Adds to A4: sign-in is never drawn inside the frame; the frame has no edge of its own.

Builds on: A22 (one site, one page list, one sign-in), A27 (two levels: a strip and tabs), A34 and its Amendment 1 (Pi
Hub draws the Assistant page by page; one Assistant entry; tiers 1-3), A6 and kit 2.29 (the shell and the strips).

Leaves unchanged: A4 requirements 1 (as A34 narrowed it), 2, 4, 5, 6 and 9; A34 in full (tiers, phases, the adapter, the
standalone fallback); Local AI opened on its own; the rail and the phone bar; the Assistant button as the one entry.

Read on 25 Nov 2026: pi-hub `002303e`, LocalAI `2ddce95c` (`~/dev/ai-harness/LocalAI`), appliance-ui kit 2.31.3 (all
four consumers except the display are on it; `npm run drift`). The owner, that day: "i want a improved and consistent
experience for the user and i dont want it to look like pages are iframed", then "even the framed nav bars, tabs and
such - looked nested", then, to the five-point shape below, "proceed". Under the frozen baseline this is a proposal
until this PR merges; nothing below is built or approved by being said.

## Why

A walk of the live hub on 25 Nov (every address in the kit's `pages.json`, 55 of them, at 1440 and 390 px, signed out)
and a read of both apps' code found:

| # | Found | Where |
|---|---|---|
| 1 | One frame on the whole site: `/assistant`. Every other Pi Hub page, and `/assistant/status` and `/assistant/models`, is drawn by Pi Hub with one title, one rail and no frame | `hub/static/js/assistant.js:96` |
| 2 | Inside the frame Local AI draws **its own strip** of five areas, and under it **its own page tabs**, both below Pi Hub's head. That is A4 section 5.2 as written: a second navigation, inside a box | LocalAI `app/public/framed.js` `strip()` (`#uxFramedStrip`); `app.css:2720-2728` (`.ux-framed-strip`, `.ux-page-strip`) |
| 3 | The frame is drawn as a box: a 1 px line, rounded corners and its own surface colour | `hub/static/app.css:238-241` |
| 4 | The frame is the page's only scroller (A4 requirement 8), so Pi Hub's head stays still while the content moves under it, the phone's tap-to-top and toolbar collapse do nothing, and wide screens show a scrollbar inside the page | `app.css:246`; a4:85 |
| 5 | **19 Assistant addresses in the page list answer "Page not found"**, with no rail: `/assistant/chat`, `/image`, `/decisions`, `/work`, `/agent-world`, `/automations`, `/spreadsheets`, `/projects`, `/sources`, `/memory`, `/library`, `/changes`, `/signals`, `/claude-code`, `/atlas`, `/system`, `/tools`, `/settings`, `/audit-log`. The list gives each a path; Pi Hub serves only `/assistant`, two drawn pages and a task | `hub/app.py:1605-1612` (`SHELL_PATHS`, `ASSISTANT_PAGES`) |
| 6 | The address of a framed page is `/assistant?to=<hash route>`, not the page's path, so the address bar, the palette and a shared link name a page two ways | a4:80-84; `assistant.js` `addressFor()` |
| 7 | Signed out, the frame is sent to Pi Hub's own `/settings#group-people`, so Pi Hub's whole shell appears inside Pi Hub's shell. Pi Hub answers `X-Frame-Options: SAMEORIGIN`, which allows it | seen in the walk; `curl -I https://hub.rahe-home.duckdns.org/` |

What the walk did **not** see: the framed pages signed in (the agent does not enter the owner's password). Rows 2-4 are
from the code and from the owner's own description; step 4 below is where they are checked on the owner's devices.

A34 removes most frames in time: each tier-1 and tier-2 page ends drawn by Pi Hub. It does not remove this problem. A34
keeps tier 3 framed for good (Spreadsheets, Agent World, Atlas, Developer tools, Claude Code chat, the code-running
actions), and until P4 and P5 land every other Assistant page is framed too. A38 says what a framed page looks like in
the meantime and after.

## Options

1. **Pi Hub draws everything round the content; the frame is content only (recommended).** Pi Hub draws the title, the
   strip and the tabs for every Assistant page from the page list, at the page's own address. Framed, Local AI draws no
   navigation and no title. The frame has no edge and, for pages that read as documents, no scroller. Cost: two Pi Hub
   PRs and one LocalAI PR.
2. **Wait for A34.** No cost now. The nested look stays until P4 and P5 finish, and stays for tier 3 after that.
3. **Restyle only**: drop the frame's border and keep Local AI's strip inside. Cheap, and it leaves the second
   navigation, which is the thing the owner named.
4. **Proxy Local AI under Pi Hub's origin so there is no frame.** Rejected in A4 (the `b76c879` risk) and again in A34
   for the browser; unchanged.

## Change (option 1)

### 1. Every Assistant page has its address (amends A4 section 5.6 and requirement 7)

- Pi Hub answers every `path` in the page list whose `system` is `assistant` (and that is not `built: false`) with the
  shell. A row marked `drawn: hub` is drawn by Pi Hub as today; any other row is a **framed page**: Pi Hub's head,
  strip and tabs, and under them the frame showing that row's `view`.
- The address bar always shows the row's `path`. Moving between Assistant pages is an ordinary Pi Hub navigation (a
  history step, like any two Pi Hub pages); the frame is kept, not reloaded: Pi Hub posts
  `{type: "assistant-go", route}` to it.
- A route inside a page that the list has no row for (a filter, an open item) rides as `?to=<route>` on that page's
  path, written with `history.replaceState` as in A4. In-frame moves still add no history entries.
- `/assistant?to=<route>` keeps working: it redirects to the row whose `view` the route names, else it opens
  `/assistant` with the route as today. Needs-you links and the Versions page's Atlas link (a4:95-97) follow the same
  rule and need no change of their own.
- When Local AI posts a route that belongs to another row, Pi Hub moves the address, the title, the strip and the tabs
  to that row (`replaceState`), so the navigation never disagrees with the content.
- An address that is not in the list stays "Page not found".

### 2. Pi Hub draws the navigation; Local AI, framed, draws none (amends A4 section 5.2 and requirement 3)

- **From** (a4:50-52): "Local AI shows no top bar, no '← Home' and no phone bar of its own. Its five pages … become a
  level-2 strip at the top of the frame".
- **To:** "Local AI, framed by Pi Hub, shows no top bar, no '← Home', no phone bar, **no strip, no page tabs and no
  page title or purpose line**. Pi Hub draws the page's name, the Assistant's strip and the page's tabs above the
  frame, from the page list, with the kit's own strip and tabs (A27's two levels), exactly as on a page Pi Hub draws."
- Navigation means anything that moves between rows of the page list. A page's own controls (filters, a stage picker,
  a composer) are content and stay in the frame.
- One page, one title: Pi Hub's. The frame keeps its `title` attribute for assistive tech.
- When A34 later flips a row to `drawn: hub`, its address, title, strip and tabs do not change. Only what fills the
  space under them does.

### 3. The frame has no edge and, where the page is a document, no scroller (amends A4 requirement 8)

- **From** (a4:85-86): "The frame … is the only scroller in the page (no double scrollbars)."
- **To:** "A page has one scroller. For a framed page that reads as a document, that scroller is the page: the frame is
  as tall as its content and never scrolls. For a framed page that fills the window (a composer pinned to the bottom, a
  canvas), the frame fills the space under the navigation and is the only scroller, as before. Local AI says which, per
  view."
- The frame has no border, no rounded corners and no surface of its own; Local AI's framed page uses the page
  background token and no outer padding, so its content sits on Pi Hub's column and width cap (A10 D3).
- Local AI posts `{type: "assistant-size", height}` when its content's height changes, or
  `{type: "assistant-size", fill: true}` for a view that fills the window. Until the first one arrives the frame fills,
  as today, so an older Local AI still works.
- **Overlays stay in view.** A dialog, sheet, menu or toast opened in a content-height frame appears inside the part
  of the window the owner can see, and focus stays reachable. The recommended way: Pi Hub posts
  `{type: "assistant-viewport", top, height}` (at most once a frame) on scroll and resize, and Local AI places its
  overlays within that band. The builder may choose another way that meets the sentence above.
- A link to a place inside a framed page (a hash target, a restored scroll position) scrolls the page, not the frame.

### 4. Sign-in is Pi Hub's, before the frame and never inside it (adds to A4)

- Pi Hub creates the frame only for the signed-in owner. Anyone else sees Pi Hub's own sign-in state on that address
  and no frame.
- Framed, Local AI never navigates itself to a Pi Hub page. If its gate refuses a request it posts
  `{type: "assistant-signin"}`; Pi Hub removes the frame and shows the same sign-in state.
- Pi Hub's pages refuse to be framed by anything: `Content-Security-Policy: frame-ancestors 'none'` on its HTML
  responses, after the builder confirms nothing frames a Pi Hub page on purpose (`/wall` and the Workshop display are
  not frames). This is the backstop for finding 7 whatever sends the redirect.

### 5. Messages

All are checked as A4 requirement 4 already says: explicit target origin, never `"*"`; the receiver checks
`event.origin` against its list and `event.source` against the frame or its parent; payloads are data, never HTML.
Each side ignores a type it does not know.

| Type | From → to | Payload | Checked by the receiver |
|---|---|---|---|
| `assistant-context` | Pi Hub → Local AI | `context` | unchanged (A4) |
| `assistant-route` | Local AI → Pi Hub | `route` | unchanged (A4) |
| `assistant-go` | Pi Hub → Local AI | `route` | a known view or `run/<id>`; anything else is ignored |
| `assistant-size` | Local AI → Pi Hub | `height` (px) or `fill: true` | a finite number, clamped to a floor (the space under the navigation) and a ceiling the plan sets; applied at most once a frame |
| `assistant-viewport` | Pi Hub → Local AI | `top`, `height` (px) | finite numbers, clamped to the frame's own height |
| `assistant-signin` | Local AI → Pi Hub | — | removes the frame; the owner's session is read from Pi Hub, never from the message |

Pi Hub asks for the new behaviour by adding `nav=hub` to the frame's first address. Local AI drops its strip, tabs and
title only when framed by Pi Hub (requirement 3's test, unchanged) **and** asked. So neither deploy order shows two
navigations or none.

## Steps

Each is its own PR, gated by the repo's engineer agent, ui-ux-reviewer and qa-release. A step starts when the one
before is live.

| Step | Repo | What | Done when |
|---|---|---|---|
| **1 Addresses** | pi-hub | Section 1: serve every Assistant path in the list, map path ↔ view, redirect `?to=`. No strip yet; Local AI is unchanged | a test walks the synced page list and every Assistant path answers with the shell and frames the right view; the 19 addresses above open live |
| **2 Framed mode** | LocalAI | `nav=hub`: no strip, tabs or title; `assistant-go`; `assistant-size` with each view marked document or fill; overlays in view; `assistant-signin` | Local AI's tests cover each message, a wrong origin and a wrong source; without `nav=hub` the frame is as today |
| **3 One page** | pi-hub (and appliance-ui only if the kit's strip cannot draw Assistant rows in Pi Hub; that is a kit release, named in the plan) | Sections 2-4: title, strip and tabs; `nav=hub`; no edge; content height; sign-in state; `frame-ancestors` | the acceptance below, by test where a test can see it |
| **4 Owner check** | — | The owner opens the Assistant on the iPhone, the iPad and the laptop, signed in | the owner says it reads as one page, or names what does not |

Step 1 is worth shipping alone: it fixes 19 dead addresses and needs nothing from Local AI.

## Decisions for the owner

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| D1 | Address of a framed page | **the page list's path** (`/assistant/work`), `?to=` kept as a redirect | keep `/assistant?to=…`; the 19 paths then redirect to it, and a page still has two names |
| D2 | Scrolling | **the page scrolls; the frame is content-tall, except views that fill the window** | keep the frame as the only scroller on every page: less work in Local AI (no overlay placing), and the phone keeps a head that never moves and no tap-to-top |
| D3 | When | **now, as steps 1-4 beside A34** | wait for A34's P4 and P5; tier 3 stays nested either way |

## Fit with the baseline

- **Separate origins hold.** The frame's `src` is still Local AI's origin; nothing is proxied; A34's adapter is
  untouched. The four new messages carry a route, two sizes and a sign-in notice, no content.
- **Ownership is unchanged.** Local AI owns the Assistant's content; Pi Hub owns the shell and, now, all navigation
  shown in it. The page list (appliance-ui) stays the one source for names, addresses, strips and tabs.
- **A34 is unchanged and made smoother**: a row's flip to `drawn: hub` no longer changes what is round the content.
- **The down and asleep states are unchanged** (A4 requirement 5, A22 section 4.1): they are Pi Hub's, drawn under the
  same title, strip and tabs.
- **The standalone fallback is unchanged**: opened on its own, Local AI draws its full chrome.

## Acceptance (for step 3)

- **One of each.** On every Assistant address at 390, 1024 and 1440 px, light and dark: one page title, one strip, one
  row of tabs, one rail or tab bar; the framed document has no navigation landmark and no page title; no line, corner
  or change of background marks where the frame starts.
- **Moving.** Home → Assistant → Work → Agent World → Printer, then Back four times: each step is one page, the address
  bar shows that page's path, and the frame is loaded once.
- **Reload and share.** Reloading any Assistant address, or opening it in a new tab, shows the same page.
- **Scrolling.** A document page scrolls as one page (the head moves with it; on the iPhone a tap on the status bar
  returns to the top); a fill page keeps its composer on screen with the keyboard up. No page has two scrollbars.
- **Overlays.** With a long document page scrolled to its end, a dialog opened from the last item is on screen and
  holds focus.
- **Signed out.** Any Assistant address shows Pi Hub's sign-in and loads no frame; a session that ends while the frame
  is open ends the same way. `curl -I` on a Pi Hub page shows `frame-ancestors 'none'`.
- **PC asleep.** Unchanged from A4, under the page's own title and navigation.
- **Keyboard and assistive tech.** Tab order is rail, strip, tabs, frame, out again; the strip and tabs name the
  current page (`aria-current`); the frame has a title.
- **Old and new together.** Pi Hub at step 3 against Local AI before step 2 shows today's page (Local AI's strip, a
  frame that fills), not two strips.

## Acceptance (for this amendment)

- A4's sections 5.2 and 5.6 and requirements 3, 7 and 8 read as above; the `## Amendments` list names A38.
- No other baseline text changes. Nothing here is built by this PR.

## Risks

| Risk | Handling |
|---|---|
| A content-height frame and its parent chase each other's size | height is taken from the framed content, never from the frame's own viewport; applied once a frame; clamped; a test drives a resize loop |
| Overlays open off screen in a tall frame | section 3's rule, its acceptance line, and D2's alternative if it proves costly |
| The iPhone keyboard in a fill page | fill pages keep A4's layout unchanged, which is live today |
| A forged or stale message | origin and source checks both ways; numbers clamped; routes matched against the list; sign-in read from Pi Hub only |
| The two apps on different kit versions look different across the seam | both are on 2.31.3 today; `npm run drift` is run before step 3 ships, and step 3 waits if Local AI is behind |
| The page list and Local AI's views drift | step 1's test walks the list; a row whose `view` Local AI does not know shows Pi Hub's "Page not found" under the navigation, not an empty frame |
| Work spent on pages A34 will redraw | sections 1 and 2 on the Pi Hub side are permanent (addresses and navigation stay when a row flips); only Local AI's framed-mode work for tier-1 and tier-2 views is interim |

## Left to the builder

- Which Local AI views are documents and which fill (expected fill: chat, Agent World, Atlas, Spreadsheets; read each).
- Whether the kit's strip and tabs draw Assistant rows inside Pi Hub as they stand (kit 2.31.3), or need a release.
- What sends the signed-out redirect seen in finding 7 (the device-owner gate or Local AI's sign-in), and its fix
  there, beyond the backstop in section 4.
- The ceiling for `assistant-size`.

## Out of scope (noted, not gated)

- `/lab/designs` and `/lab/tools` answer "Page not found"; the list marks both `built: false`.
- Pi Hub's "Page not found" is drawn without the rail on these addresses; whether every unknown address should keep the
  shell is baseline step 7's question, not this amendment's.
- Print Lab's pages: the walk found no frame and no second shell there.
