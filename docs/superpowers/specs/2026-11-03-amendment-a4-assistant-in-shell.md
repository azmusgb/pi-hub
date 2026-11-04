# Amendment A4: The Assistant opens inside Pi Hub's shell

Date: 2026-11-03 · Status: **approved**, option 1 with the recommended phone bar and Atlas choices (owner, "do it all", 3 Nov 2026; merged in #78) · Amends: the platform
baseline (`2026-11-01-platform-product-architecture-design.md`, section 5.1's level 0, section 5.2's surfaces, section
5.6's route table, section 10's "PC asleep" row) and adds migration step 7a.

## Why

Today the Assistant button leaves Pi Hub: it opens `assistant.rahe-home.duckdns.org` with the page's facts in
`#ask?context=` (`sections.js:63-74`). The owner wants the house and the Assistant to feel like one product, with no
visible jump between them. On 3 Nov 2026 seven commits tried that straight on `main`, without a PR or a plan, and were
reverted by #77. They showed both what is wanted and what goes wrong:

- **Serving Local AI under Pi Hub's origin is unsafe.** `b76c879` proxied `hub…/ai/*` to Local AI. Every script in
  Local AI's pages then ran on Pi Hub's origin and could call Pi Hub's owner-only APIs with the owner's session
  (`POST /api/printer/pause`, settings, pairing). HttpOnly stops a script reading the cookie, not using it. Local AI
  renders model output, so one injection bug there would have been an owner-level bug in Pi Hub.
- **A frame alone loses the hand-off.** `76e49eb` framed `assistant.…/#ask` with no context. It sent the context by
  `postMessage(…, "*")`, which Local AI doesn't listen for and which names no target origin.
- **It dropped the "PC is off" guard.** With the PC asleep the page showed a dead frame instead of the phrase-table
  wording (section 10).
- **It added a sixth phone tab and nested bars.** Pi Hub's bar plus Local AI's own top bar and phone bar.

The baseline's door model (section 5.1, level 0) assumes the Assistant is a separate app. This amendment changes
how the door opens, not who owns what.

## Options

1. **The Assistant opens in Pi Hub's shell, in a frame of its own origin (recommended).** `/assistant` in Pi Hub
   shows `assistant.rahe-home.duckdns.org` in an iframe. Local AI stays on its own origin and its own gate; Pi Hub
   only frames it. The requirements below make the hand-off, the down state and navigation work. Cost: one Pi Hub PR
   and one LocalAI PR.
2. **Keep the door as it is.** The button leaves Pi Hub for the Assistant, as now. No cost; the jump between apps
   stays.
3. **Proxy Local AI under Pi Hub's origin.** Rejected: it is the `b76c879` risk above.

## Change (option 1)

### Section 5.1, level 0

- **From:** "Pi Hub: the Assistant button (`sections.js:4,77`). LocalAI: '← Home'"
- **To:** "Pi Hub: the Assistant button, which opens `/assistant` in Pi Hub's shell (amendment A4). LocalAI: '← Home'
  when opened on its own; no door when framed by Pi Hub, because Pi Hub's rail is the way back"

### Section 5.2, surfaces

- **Desktop web and phone web: unchanged.** The phone bar stays at five (Home, Workshop, Documents, Media, More). The
  Assistant stays the top-bar button on the phone and the rail's foot on desktop. Nothing yields, because the
  Assistant isn't added as a tab: it remains level 0.
- **Inside the Assistant, framed:** Local AI shows no top bar, no "← Home" and no phone bar of its own. Its five pages
  (Home, Work, Projects, Improve, System) become a level-2 strip at the top of the frame, in the section 5.1 strip
  style. Opened on its own (not framed), Local AI is unchanged.

### Section 5.6, Pi Hub routes

Add: `/assistant` | Add | The Assistant in Pi Hub's shell (A4). Takes `?context=` (at most 300 characters, section 8)
and `?to=<LocalAI hash route>` | A4

### Requirements

1. **Separate origin, always.** The frame's `src` is `https://assistant.rahe-home.duckdns.org/…`. Never a path under
   Pi Hub's origin, never a Caddy route under `hub.`. A test asserts no `site_hub` route proxies to Local AI.
2. **Framing is allowed only by Pi Hub.** Local AI's responses carry
   `Content-Security-Policy: frame-ancestors 'self' https://hub.rahe-home.duckdns.org https://home.home.arpa`.
   Today it sends no framing header, so any site can frame it; this closes that too.
3. **Local AI drops its chrome only when Pi Hub frames it.** Local AI checks `window.top !== window` and that
   `document.referrer`'s origin, or the first message's `event.origin`, is a Pi Hub origin. Anything else gets the
   normal chrome.
4. **The hand-off keeps its contract.** On first load the context travels in the frame's `src` as today
   (`#ask?context=…`, at most 300 characters), so the first question needs no LocalAI change. When the frame is
   already open and the owner presses the button from another page, Pi Hub sends
   `postMessage({type: "assistant-context", context}, "https://assistant.rahe-home.duckdns.org")`, an explicit
   target origin, never `"*"`. Local AI's listener ignores any message whose `event.origin` isn't a Pi Hub origin and
   treats the payload as text, never HTML.
5. **The down state is Pi Hub's.** When the Pi's status service says Local AI is Down, `/assistant` renders the
   phrase-table wording (`pc_off` / `assistant_down`, section 9) and no frame. "Unknown" isn't "off": it shows the
   frame. If the frame fails to load within 10 s, the page says `assistant_down` and offers "Try again".
6. **The frame loads only when opened.** `/assistant` creates the iframe on mount and removes it on leave. Home and
   other pages never load Local AI in the background.
7. **Back and deep links.** Pi Hub's URL carries the Assistant's route: Local AI posts its hash route to the parent
   (origin-checked as above), and Pi Hub updates `/assistant?to=…` with `history.replaceState`, so a reload or a
   shared link reopens the same Assistant page. Browser back leaves `/assistant` in one step; Local AI's own in-frame
   moves don't add Pi Hub history entries. Needs-you links of the form `tool:assistant/#run/<id>` open
   `/assistant?to=run/<id>`.
8. **Focus and scrolling.** The frame has a `title`, takes focus when the page opens, and is the only scroller in the
   page (no double scrollbars). The rail and the phone bar stay reachable by keyboard.
9. **Pi Hub down is unchanged.** Local AI opened on its own keeps "← Home" and the section 10 behaviour.

### Section 10, "PC asleep or off"

Add to "What the owner sees": "In Pi Hub's shell the Assistant page shows 'The PC is off' instead of the frame (A4)."

### Atlas (`/architecture`)

Out of this amendment. Versions keeps linking "Architecture at this commit" to the Assistant's Atlas
(`#architecture?repo=…&commit=…`); with A4 that link opens `/assistant?to=architecture?repo=…&commit=…`, so it stays in
the shell without a page of its own. A separate `/architecture` page is not added.

### Migration step 7a

"**7a. The Assistant in the shell (A4), after 7's strip and 404 land.** One LocalAI PR (requirements 2, 3, 4's
listener, 7's route post), then one Pi Hub PR (`/assistant`, requirements 1, 4-8). LocalAI ships first; Pi Hub's page
works against an unchanged Local AI except for the chrome and the route sync."

## Fit with the baseline

- **D3 and the door model hold.** No new chrome: the rail and the phone bar are the only global navigation, and the
  Assistant stays level 0.
- **Ownership is unchanged.** Local AI owns the Assistant, its runs and its pages; Pi Hub owns the shell.
- **The device-owner gate is unchanged.** `assistant.` stays behind the same gate. The gate cookie is
  `SameSite=Lax`; `hub.` and `assistant.` are the same site (`rahe-home.duckdns.org` is a registrable domain under
  `duckdns.org`), so the framed request carries it.
- **Section 8's hand-off limit (300 characters) is unchanged.**
- **Steps 5, 6 and 10 are unaffected.**

## Acceptance (for step 7a)

- **Desktop (Mac, Safari and Chrome):** the button opens `/assistant` with the page's context over the composer; Local
  AI shows no bar of its own; reload keeps the Assistant page; back returns to the previous Pi Hub page in one step.
- **Phone (iPhone Safari):** five tabs; no second bar; the composer stays visible with the keyboard up; one scroller.
- **Keyboard:** Tab reaches the rail, then the frame, then out again; focus is visible.
- **PC asleep:** with the PC asleep, `/assistant` says "The PC is off" and loads no frame; waking it and pressing "Try
  again" opens the Assistant.
- **Security checks:** `curl -I https://assistant.…/` shows the `frame-ancestors` header; a page on another origin
  can't frame it; no `site_hub` route proxies to Local AI (test); a `postMessage` from another origin changes nothing.

## Acceptance (for this amendment)

- Sections 5.1, 5.2, 5.6 and 10 read as above, step 7a is in section 11, and the `## Amendments` list names A4.
- No other baseline text changes.
