# Amendment A22: One site

Date: 2026-11-11 · Status: **approved by the owner on 11 Nov 2026** ("merge 230", pi-hub #230), with the open questions settled under O7 · Amends: the platform
baseline (`2026-11-01-platform-product-architecture-design.md`) sections 5.1, 5.2, 5.3, 5.6 and 9; A4 (who draws the
Assistant's navigation, and its requirements 5, 6, 7 and 8); A6 decisions 1, 2, 6 and 11 (areas, strips, Settings'
groups, Site map); A7 P1 (what the page title says). Builds A15 as approved. Adds migration steps 11 to 16.

## Summary, in plain words

Today the house has three sites that look related but don't behave as one: Pi Hub, the Assistant, and a dozen linked
apps, each with its own menu, words and sign-in. This amendment makes Pi Hub the only face.

- **One menu.** Pi Hub alone draws the menu, the page title, search and the phone tabs. The Assistant's pages appear
  inside it, with no menu of their own.
- **Five areas, all on the phone bar.** Home, Workshop, Household, Network, System. Media folds into Household, which
  opens on Movies. The phone's "More" page goes away.
- **One page list.** One file names every page: its menu word, its heading and its address. Tests fail when the three
  disagree, or when a page has no way in.
- **One set of values.** Colours, sizes, spacing, shadows and motion come from the kit (the shared design files both
  apps copy). A check fails any change that writes a colour or size by hand, and the ones written by hand today can
  only go down.
- **Linked apps stay as they are; Pi Hub does their everyday jobs.** Each app stays installed and one link away for
  the rest. Nothing is restyled or shown inside Pi Hub. Uptime Kuma is retired. Homebox leaves the pages' link rows but
  stays in the Site map until the owner confirms it is empty.
- **One sign-in.** Pi Hub's own, owner only. Second passwords are removed app by app where the app allows it.
- **One home for print-lab.** Print lab gets Experiments, Designs and Lab tools tabs, so the galleries, camera fit and the
  Fusion add-ins each have a way in.

Nothing the household uses today is removed, apart from the two apps the owner chose (O4, O5), and every address that
works today keeps working or redirects.

## What this is based on

### Inputs that were missing

| Input the brief named | What was found |
|---|---|
| `appliance-ui-cohesion-spec.md` (the owner's draft) | Not found. `~/Downloads` holds only the brief itself (`fable-design-spec-prompt.md`), whose path line still reads `<PATH — fill in>`. No file named or mentioning "cohesion" exists under the home folder. This spec is written from the audit, not from the draft. |
| The A22 "one site" amendment and its wireframes | Not found. The amendments list runs A21 then A23 (baseline, `## Amendments`). No branch or PR carries an A22. This document is A22, written new. |
| The page inventory (about 150 rows) | Not found. The nearest is a 9 Nov print of `/map` in `~/Downloads`. The page list in section 3 was rebuilt from source. |
| The billrahe-e8 session | Not running. See "Coordination" below. |

### Owner decisions (11 Nov 2026)

| # | Decision | The owner's words |
|---|---|---|
| O1 | Single sign-on is Pi Hub's own session. No Authelia, no Authentik. Owner only. | "pi-hub is fine - owner only use" |
| O2 | Media folds into Household. Five areas. | "fold" |
| O3 | Outside apps are in scope. Custom Pi Hub pages in front of them are welcome. | "fine with custom apps" |
| O4 | Uptime Kuma is retired. | "retire kuma" |
| O5 | Homebox has no settled value. | "homebox was just something i looked at - not sure of value" |
| O7 | The open questions are settled by this spec's recommendations, on the site's functions and roadmap. | "proceed as you recommend based on the functionalities, roadmap, etc" |
| O8 | A22 is approved and is to be built. | "build it - make it a thing of beauty", "merge 230" |
| O6 | The Assistant's navigation and names may be changed by this spec without the Assistant session's sign-off. | "im granting you creative freedom" |

### Coordination

The brief says to message the billrahe-e8 session before proposing changes to the Assistant's navigation, because it
paused that work (#519) until A22 is decided.

- No session with that name was running on 11 Nov 2026 (peer list checked at 21:59 and again after the audit).
- A second session that had received the same brief answered: it had not started, held none of the missing inputs,
  and did not know which session billrahe-e8 is.
- LocalAI #519 is not paused. It is merged ("Navigation depth: approved design and plan"), and its four follow-ups
  (#522 Changes page, #523 Pins, #524 Status and Connections, #525 page-open counter) are merged to LocalAI `main`
  (`5938b0f`) but not shipped: `origin/release` is still `90d11ba`.
- The owner then granted O6. Every Assistant change below is therefore **a proposal made without the Assistant
  session's answer**. Build brief 4 starts by sending this section to whichever session owns LocalAI navigation and
  recording its reply here.
- The navigation-depth spec names Changes' chips "Backlog · Doing · Shipped". This spec renames "Doing" to "In
  progress" (section 8.1), which amends that LocalAI spec.
- Two questions the navigation-depth spec left open stay open and are not decided here: Work's "Needs you" and
  "Missions" filters, and Library as a "Kept" filter (`LocalAI/docs/superpowers/specs/2026-11-09-navigation-depth-design.md`).

### Audit, in numbers

All counts are declarations in CSS, JS and HTML outside the kit's own files, vendored code and tests.

| | appliance-ui `src/` | pi-hub `hub/static` (not `ui/`) | LocalAI `app/public` (not `ui/`) |
|---|---|---|---|
| Kit version | 2.16.0 (`tokens.json:2`) | 2.16.0 (`hub/static/ui/VERSION`) | **2.7.0** (`app/public/ui/VERSION`) |
| Hardcoded colours | 1 | 308 | 1,394 (about 1,000 are Agent World art in `ui.js` and `street/*.js`) |
| Hardcoded font sizes | 3 | 333 | 34 |
| Hardcoded spacing | 15 | 981 | 1,042 |
| Private value names | 4 | 105 (`app.css:5-58`, `enhance.css:7-`) | 140 (`app.css:761-797`) |
| Light theme | yes | yes | **none** (`app.css:762`; no `prefers-color-scheme` rule) |
| Loads the kit's `tokens.css` | n/a | yes (`index.html:86-89`) | **no**; it re-declares `--ui-*` by hand (`app.css:789-794`) |

- **Largest offenders.** pi-hub: `home.css`, `lab.css`, `pages.css`, `enhance.css`. LocalAI: `app.css` (994 spacing,
  182 colour), `ui.js` (473 colour).
- **The kit has gaps.** It has one spacing value (`--ui-space`) and no shadow, motion or layer values, so pi-hub grew
  `--shadow-*`, `--sh-*`, `--ease`, `--dur`, `--z-*` and `--s-1` to `--s-10` (the last is used nowhere), and LocalAI
  grew `--ds-*`, `--ux-*`, `--aw-*` and a legacy set.
- **Nothing guards it.** The only literal-colour check is on the kit's own CSS (`appliance-ui/tests/components.test.mjs:11`).
  No repo rejects hardcoded sizes or spacing.

### Critique

Screenshots were taken on 11 Nov 2026 at 1440 × 900 and 390 × 844 of Home, Workshop › Printer and `/assistant`, signed
out (the viewer's view), in light mode. They are kept in the session scratchpad, not in the repo.

| # | Finding | Evidence | Fix in |
|---|---|---|---|
| C1 | **The heading names the area, not the page.** Printer is headed "Workshop", Health "System", Papers "Documents". The faceplate then uses a third name ("Bambu X2D", "Self-check", "Paperless, on the PC"). | `system-strip.js:42-47`, `main.js:280-282`; screenshot of `/workshop` | Section 2.3, names list |
| C2 | **Two of six areas are hidden on a phone.** Home & network and System sit behind More. | `index.html:185-235`, `sections.js:9-19` | Section 2.2 |
| C3 | **The Assistant has its own five-area menu inside Pi Hub's frame.** When framed it drops its rail but draws its own area strip and page strip (`LocalAI/app/public/framed.js`, `app.css:2624`), in its own values. | Source; the live page could not be captured (C7) | Section 2.5 |
| C4 | **Four words mean two things.** Home, System, Settings and Automations each name a Pi Hub page and an Assistant page. | `routes.js:5-21`; `view-registry.js:13-68` | Names list |
| C5 | **Twelve Assistant views are in no page strip.** inbox (a rail button when opened on its own, `index.html:12`, but hidden when framed), ask, create, spreadsheets, runs, inProgress, shipped, workbench, repoTools, powershell, actions, automations. | `view-registry.js:13-68` | Section 3.3 |
| C6 | **print-lab has pieces with no way in.** Design galleries, camera fit, both Fusion add-ins, and most `lab` commands. | `print-lab/tools/`, `hub/static/js/lab.js` (no "designs") | Section 7 |
| C7 | **The Assistant has been down since 10 Nov** after a failed update, so no live Assistant page could be captured. The down notice itself reads well. | Home's Needs you list; `/assistant` screenshot | Not this spec; noted for the owner |
| C8 | **Printer shows "Loading workshop…" for more than five seconds** at both sizes, with skeletons under it. | Screenshots | Not this spec; worth a `/fix` |
| C9 | **No linked app could be captured.** They need the owner's sign-in, which an agent may not enter. | Bambuddy redirected to the owner sign-in | Nightly check (section 9) runs signed in from the owner's Mac |

Not reviewed: the A22 wireframes (none exist), any linked app's own screens, and the Assistant's live pages.

---

## 1. The shared stylesheet of values

### 1.1 The rule

Every colour, size, space, radius, shadow, duration and layer in Pi Hub and the Assistant is a kit value
(`appliance-ui/tokens.json`, built to `dist/tokens.css` as `--ui-*`). An app never defines its own name for a kit
value and never writes the value itself. This restates `appliance-ui/DESIGN.md` "Tokens"; what is new is that the kit
gains the values it lacks (1.3), both apps load the same file (1.4), and a check enforces it (1.5).

Dark is the default. Light applies by the system setting or `data-theme="light"`; `data-theme="dark"` forces dark
(`dist/tokens.css:3-5`). That switch is unchanged.

### 1.2 Values that exist today (kit 2.16.0)

**Colour**

| Name | Dark | Light | Use (from `DESIGN.md`) |
|---|---|---|---|
| `--ui-bg` | `#1a1d1c` | `#f2f3f1` | The page |
| `--ui-bar` | `#1f2321` | `#fbfbfa` | The header and the rail |
| `--ui-surface` | `#242927` | `#ffffff` | The faceplate, sheets, dialogs |
| `--ui-surface-2` | `#2a302d` | `#eaece9` | The well behind buttons, meters, inputs |
| `--ui-line` | `#343b38` | `#d9ddda` | Dividers (decoration only) |
| `--ui-line-2` | `#48514d` | `#c1c7c3` | Frames (decoration only) |
| `--ui-field-line` | `#76817c` | `#7a8480` | A field's border (3:1) |
| `--ui-text` | `#ecefea` | `#161a18` | Primary text |
| `--ui-muted` | `#a9b1ab` | `#4f5853` | Secondary text |
| `--ui-accent` | `#3fc1c9` | `#0b7a83` | Primary button fill, selection, focus ring |
| `--ui-accent-text` | `#63d1d7` | `#08666d` | Links, the current strip item |
| `--ui-on-accent` | `#062a2d` | `#ffffff` | Text on an accent fill |
| `--ui-accent-soft` | `rgba(63,193,201,.14)` | `rgba(11,122,131,.10)` | Tint behind a selected chip or row |
| `--ui-ok` | `#8fcc6c` | `#29610f` | Fine |
| `--ui-warn` | `#f0b43c` | `#775000` | Needs a look |
| `--ui-bad` | `#ff957f` | `#9c2b1b` | Broken or blocking |
| `--ui-unknown` | `#b0b8b2` | `#4e5752` | Not known |

**Type, shape and space** (the same in both modes)

| Name | Value |
|---|---|
| `--ui-font` | `Archivo, system-ui, -apple-system, "Segoe UI", sans-serif` |
| `--ui-mono` | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` |
| `--ui-stretch-heading` / `--ui-stretch-readout` | `87.5%` / `75%` |
| `--ui-fs-1` … `--ui-fs-7` | `.75`, `.8125`, `.875`, `1`, `1.25`, `1.625`, `2.125` rem (12, 13, 14, 16, 20, 26, 34 px at a 16 px root) |
| `--ui-r-1` … `--ui-r-4` | `4px`, `6px`, `9px`, `14px` |
| `--ui-space` | `.25rem` |
| `--ui-header-h` | `2.75rem` |
| `--ui-header-total` | `calc(var(--ui-header-h) + env(safe-area-inset-top, 0px))` |
| Root size | `clamp(100%, 0.9423rem + 0.2564vw, 125%)` (built into `dist/tokens.css` from `tokens.json`'s `fluid`) |

### 1.3 Values to add to the kit (proposed)

These are **proposals for an appliance-ui PR**, not kit values yet. AGENTS.md: "a new token or component is proposed
in appliance-ui and synced into `hub/static/ui`, never added here." The numbers below are starting points taken from
what the two apps already use; the appliance-ui PR settles them, and any pairing that carries text gets its row in
`docs/contrast.md` before it ships.

| Proposed name | Dark | Light | Replaces today |
|---|---|---|---|
| `--ui-s-1` … `--ui-s-8` | `.25`, `.5`, `.75`, `1`, `1.5`, `2`, `3`, `4` rem | same | `calc(var(--ui-space)*N)` by hand; pi-hub's unused `--s-1..10` (`enhance.css:7-`); 981 and 1,042 spacing literals |
| `--ui-r-pill` | `999px` | same | pi-hub `--r-full` (`app.css:5-58`) |
| `--ui-shadow-1` (toast, popover) | `0 2px 8px rgb(0 0 0 / .40)` | `0 2px 8px rgb(22 26 24 / .12)` | pi-hub `--shadow-1`, `--sh-1`; LocalAI `--shadow` |
| `--ui-shadow-2` (sheet, dialog, palette) | `0 12px 32px rgb(0 0 0 / .50)` | `0 12px 32px rgb(22 26 24 / .18)` | pi-hub `--shadow-2`, `--sh-2`, `--sh-3` |
| `--ui-backdrop` | `rgb(0 0 0 / .50)` | `rgb(0 0 0 / .50)` | the one literal in `appliance-ui/src/palette.css`; pi-hub `--backdrop` |
| `--ui-dur-1` (a press, a tint) | `120ms` | same | literals |
| `--ui-dur-2` (a sheet, the palette) | `220ms` | same | pi-hub `--dur` (`.22s`) |
| `--ui-ease` | `cubic-bezier(.2, 0, 0, 1)` | same | pi-hub `--ease`, `--smooth`, `--spring`, `--snap` |
| `--ui-z-bar` | `50` | same | pi-hub `--z-progress` 55 and the shell |
| `--ui-z-toast` | `60` | same | pi-hub `--z-offline` 65 |
| `--ui-z-sheet` | `80` | same | sheets and dialogs |
| `--ui-z-palette` | `90` | same | pi-hub `--z-palette` 90, `--z-shortcuts` 95 |

Not added, on purpose:

- **No second radius scale.** pi-hub's `--r-xs` to `--r-xl` (8, 10, 14, 20, 28 px) map onto the kit's four, rounding
  down. `DESIGN.md` already says controls are `r3` and panels `r2`.
- **No extra colours.** LocalAI's `--ds-soft`, `--ds-faint`, `--ds-surface-3`, `--ds-progress`, `--ds-violet` and the
  three `-text` variants have no kit equivalent. Each use maps to the nearest kit role (`muted`, `surface-2`, `warn`,
  `accent-text`), or the appliance-ui PR makes the case for a new one with a measured contrast row. LocalAI's two
  ambers (`--warn` `#ffb224` and `--ui-warn` `#f0b43c`) become one: `--ui-warn`.
- **No glass.** pi-hub's `--glass-*` and `--acrylic*` (`app.css`) are decoration on operational surfaces, which
  `DESIGN.md` rules out. They resolve to `--ui-bar` and `--ui-surface`.

### 1.4 What each app changes

| App | Change |
|---|---|
| pi-hub | Delete the alias layer in `app.css:5-58` and `enhance.css:7-` (`--bg`, `--surface`, `--text-2`, `--pei`, `--danger`, `--state-*`, `--r-*`, `--shadow-*`, `--sh-*`, `--s-*`, `--ease`, `--dur`, `--z-*`, `--font-*`) and use the `--ui-*` name at each use. Keep per-instance values (`--pct`, `--x`, `--y`, `--size`, `--vx`, `--vy`, `--vz`, `--box`), the wall board's own sizes (`--wall-*`, `--cam-*`) and the printer band's amber `--band-accent` (`home.css:749-751`), which `DESIGN.md` allows on the band only. |
| LocalAI | Take kit 2.16.0 or later (it is nine releases behind). Load `/ui/tokens.css` in `index.html:6` and delete the hand-written `--ui-*` aliases (`app.css:789-794`). Replace `--ds-*`, `--ux-*`, the legacy set and `--st-*` with `--ui-*`. Type moves from px (`--ds-fs-*`: 13, 15, 17, 22, 28) to the kit's `rem` scale. A light theme comes for free once the values are the kit's. `tests/appliance-ui.test.cjs:31` (which today requires `fs-1` to be 13 px) is changed in its own commit, per AGENTS.md. |
| LocalAI, Agent World | The world's art palettes in `ui.js`, `street/*.js` and `aw/*.js` are pictures, not interface. They are exempt from the check through a listed set of files (1.5) and keep their colours. The panels, labels and buttons around the world are interface and are not exempt. |
| print-lab | `tools/camera_fit/index.html` and `tools/fusion/ParamsPanel/palette.html` are the platform's own pages. Each takes a copy of the kit (as a fourth entry in `appliance-ui/consumers.json`) and uses its values. |

### 1.5 The build check

A new kit script, `check/literals.mjs`, synced with the kit so each app runs the same one.

**What it rejects**, in any `.css` file and any `style` attribute or `<style>` block outside the kit's own folder:

| Category | Rejected | Allowed instead |
|---|---|---|
| Colour | hex, `rgb()`, `rgba()`, `hsl()`, `hsla()`, and named colours other than `transparent` and `currentColor` | `var(--ui-*)`, `color-mix()` of kit values |
| Type size | `font-size` or `font` with a px, rem or em number | `var(--ui-fs-N)` |
| Spacing | `margin*`, `padding*`, `gap`, `inset*` with a non-zero px, rem or em number | `var(--ui-s-N)`, `calc()` of kit values, `0`, `auto`, `env()` |
| Radius | `border-radius` with a number | `var(--ui-r-N)`, `var(--ui-r-pill)`, `0`, `50%` |
| Shadow | `box-shadow` with a literal | `var(--ui-shadow-N)`, `none` |
| Motion | `transition` or `animation` with a literal duration or easing | `var(--ui-dur-N)`, `var(--ui-ease)` |
| Layer | `z-index` with a number other than `0`, `1`, `-1` | `var(--ui-z-*)` |
| Names | a custom property whose name does not start `--ui-`, unless it is in the app's per-instance list | — |

**How it lands without a big-bang rewrite.** The check is a ratchet, the same shape as the sprawl baseline
(`tools/sprawl.py`, `.sprawl-baseline.json`):

- Each app commits `.kit-literals-baseline.json`: a count per file and category, measured on the day the check lands.
- A count that rises fails. A count that falls must be written back to the baseline in the same PR.
- A **new** file starts at zero.
- An app's allow list (`.kit-literals-allow.json`) names files that are art, not interface. Adding a file to it needs
  a sentence in the PR saying why. LocalAI's starts with the Agent World art files; pi-hub's starts empty.

**Where it runs.** pi-hub: in `node --test tests/*.mjs`, on the Mac. LocalAI: as a step in `scripts/local-ci.mjs`
beside `kit-drift`. It is a text scan with no browser and takes well under a second, so it adds nothing to the Pi's
load; the full suite is still not run on the Pi.

**Starting baselines** (11 Nov 2026): pi-hub 308 colours, 333 type sizes, 981 spacings; LocalAI 1,394 colours (about
390 once the art files are exempt), 34 type sizes, 1,042 spacings. The radius, shadow, motion, layer and name counts
are measured when the check is written; they were not counted in this audit.

---

## 2. The shared frame

### 2.1 Who draws what

| Part | Drawn by | Notes |
|---|---|---|
| The rail (desktop) and the tab bar (phone) | Pi Hub | The five areas, and the Assistant button |
| The page head: title, one-line purpose, Search | Pi Hub | The title is the page's name (2.3) |
| The area strip (`ui-strip`) | Pi Hub | The area's pages |
| A second row of views (`ui-tabs`) | Pi Hub | Only where one page has two to six views of the same thing: Print lab, Settings (six groups), and each Assistant section. The kit documents `ui-tabs` for two to five; six is a kit change proposed with the page list |
| ⌘K search (`AppliancePalette`) | Pi Hub | One list, from the page list |
| The foot: Open in (`ui-tools`), sources (`ui-sources`), Site map, Theme and Text size | Pi Hub | |
| Page content | The owner of the page: Pi Hub, or the Assistant inside its frame | Content only |

The Assistant draws none of the first six rows when Pi Hub frames it. That is the change to A4: A4 let the framed
Assistant draw its five pages as a strip "at the top of the frame"; A22 moves that strip, and every page strip under
it, out of the frame and into Pi Hub.

### 2.2 The five areas

| Order | Area | Was | Lands on | Strip |
|---|---|---|---|---|
| 1 | **Home** | Home | Home | none |
| 2 | **Workshop** | Workshop | Printer | Printer · Print lab · Quick Print |
| 3 | **Household** | Documents and Media | **Movies** | Movies · Papers · Scan · Print · Lists · Drives |
| 4 | **Network** | Home & network | Lights | Lights · Internet · Weather |
| 5 | **System** | System | Health | Health · Backups · Versions · Alerts · Automations · Settings · Site map |

- **Phone.** The tab bar shows all five. The Assistant button stays in the top bar, as A4 set. `/more` is retired and
  redirects to `/map`.
- **Desktop.** The rail shows the same five in the same order, with the Assistant button at its foot.
- **Why "Network".** "Home & network" doesn't fit a phone tab, and one thing gets one name. "House" was considered
  and dropped: Home, House and Household side by side on a phone are too easy to mix up. "Network" is short and
  distinct. It describes Internet exactly and Lights loosely (the plugs and lights are devices on the network);
  Weather sits here because A6 decision 3 put it here. The page that was called "Network" is named Internet, so no
  page shares its area's name.
- **Household's strip has six pages**, the cap A6 set for a page's sections and applied here to a strip. System keeps
  seven; it has no new entry, and Site map is also in the foot.
- **What a phone gains and loses.** Network and System go from two taps to one. Movies stays one tap, because
  Household opens on it. Papers goes from one tap (Documents) to two (Household, then Papers), and Drives from two to
  two. Papers is second in the strip so it is on screen at 320 px without scrolling. Which page Household opens on is
  the owner's call ("Questions settled under O7").
- **On an Assistant page** no area is marked in the rail or tab bar; the Assistant button is marked
  (`aria-current`), as `main.js:288` does today.

### 2.3 The page head

```
 Printer                                  Search ⌘K
 The X2D: what it's doing and what it needs
 ─ Printer · Print lab · Quick Print ───────────────
```

- **The title is the page's name**, the same word as its strip entry, its ⌘K entry and its Site map row. Not the
  area's name. This amends A7 P1's "Title" and what `system-strip.js:42-47` does today.
- **The area is shown by position**, not by a second heading: the rail or tab bar marks the current area, and the
  strip shows its pages. No eyebrow above the title (`DESIGN.md`: "no tracked-out eyebrows").
- **The browser tab** reads "Page · Area · Pi Hub", as today.
- **The faceplate's nameplate names the thing**, not the page: "Bambu X2D", "HP DeskJet 4200", "Plex". It never
  carries a second name for the page ("Setup" on Settings becomes no nameplate at all).
- **One `h1` per document.** Pi Hub's title is the `h1`. Section headings are `h2`.

### 2.4 Search (⌘K)

- One list, built from the page list (section 3): every page, every tab, every filter view, every tool, and the
  actions that exist today (`command-palette.js:9-30`).
- Every entry shows its area on the right, as the palette's `__area` part already allows.
- The Assistant's pages are entries like any other and open `/assistant/…` in the frame. Today the generic
  "Open {tool}" entry for the Assistant opens its own origin (`command-palette.js:49-50`); it is replaced by the page
  entry "Ask". The "Ask the Assistant: …" entries that carry the typed words (`command-palette.js:103-112`) stay.
- When the PC is asleep, Assistant entries stay listed, marked "PC is asleep" with the palette's `__down` part, and
  open the banner (section 4).
- The Assistant's own palette (`.cmdk`, `app.css:20`) does not open when framed. Opened on its own, it stays.

### 2.5 The Assistant in the frame

**Addresses.** Each Assistant view gets a Pi Hub address under `/assistant/` (section 3.3). `/assistant?to=<route>`
keeps working and redirects to the path form.

**What Pi Hub draws.** On any `/assistant/…` page:

```
 Changes                                  Search ⌘K
 What's proposed, in progress and shipped
 ─ Ask · Work · Projects · Improve · Setup ─────────    (ui-strip: the Assistant's sections)
   Changes   Signals   Claude Code   Atlas              (ui-tabs: this section's pages)
 ┌──────────────────────────────────────────────────┐
 │  the Assistant's content, in its frame           │
 └──────────────────────────────────────────────────┘
```

**What the Assistant draws when framed.** Its content, from the first section down. Not its rail, context bar, phone
bar, "← Home", five-area strip (`#uxFramedStrip`), page strip, or palette. Its own page title stays in its document as
the frame document's `h1`, visually hidden, so the frame is not a headless document for a screen reader.

**The contract between them.** A4's requirements 1 to 4 and 9 stand unchanged (separate origin, `frame-ancestors`,
origin-checked messages, text never HTML). Requirements 5 to 8 change as the table after this one says. One message is
added and one is reused, both origin-checked the same way:

| Message | From → to | Meaning |
|---|---|---|
| `{type: "assistant-go", route}` (**new**) | Pi Hub → frame | The owner picked a strip, tab or ⌘K entry. `route` is the Assistant's own hash route as a string, the same form the frame reports. The Assistant shows that view, replacing history as it does today (`router.js:46-50`). |
| `{type: "assistant-route", route}` (today) | frame → Pi Hub | Unchanged in shape (`framed.js:25`; read at `hub/static/js/assistant.js:62-65`). Pi Hub now also looks the route's view up in the page list to mark the current strip and tab and to set the title. |

| A4 requirement | Was | Becomes |
|---|---|---|
| 5, the down state | `/assistant` shows `pc_off` or `assistant_down` and no frame | The banner of section 4, with a third state (Waking), on every `/assistant/…` address |
| 6, the frame's lifetime | Created on mount, removed on leave | Created on the first `/assistant/…` page and **kept** while the address starts with `/assistant`; removed on leaving for any other page. Moving between tabs never reloads it |
| 7, history | Pi Hub rewrites `/assistant?to=…` with `replaceState`; Back leaves in one step | Pi Hub rewrites `/assistant/<path>` with `replaceState`, for the frame's own moves **and** for strip and tab clicks. It never pushes. Back still leaves the Assistant in one step |
| 8, focus | The frame takes focus when the page opens | Unchanged on opening `/assistant/…` from elsewhere. On a tab click, focus stays on the tab (section 9, F5) |

**When Pi Hub is down** there is no frame to be in: the owner opens the Assistant on its own address, as the
baseline's section 10 already says.

**On a phone.** The head, the section strip and the tab row sit above the frame; the tab bar sits below it.

```
 Changes                    Search  ✦      title row            2.75rem (--ui-header-h)
 Ask Work Projects Improve Setup          section strip        2.75rem, scrolls sideways if it must
 Changes Signals Claude Code Atlas        tab row              2.75rem, scrolls sideways if it must
 ┌──────────────────────────────────┐
 │ the Assistant's content          │     the frame: all the height that is left
 └──────────────────────────────────┘
 Home Workshop Household Network System   tab bar              68 px + the safe-area inset
```

- The purpose line is not shown on a phone on Assistant pages, to keep the frame tall.
- **Height budget.** At 390 × 844 the three rows take about 132 px and the tab bar 68 px plus the inset, leaving
  about 610 px for content. At 320 × 568 that is about 330 px. Today the framed Assistant spends one strip row and
  Pi Hub's head and tab bar, so this costs one row (about 44 px) more than today. Brief 4's acceptance checks the
  composer stays visible with the keyboard up at 320 px; if it doesn't, the title row and section strip scroll away
  with the content and only the tab row stays.

- The Assistant's view ids stay its own. The page list (section 3) maps each id to its Pi Hub address and label, so
  neither app hard-codes the other's names.
- **A view Pi Hub doesn't know.** If the frame reports a view that isn't in the page list, Pi Hub shows the title
  "Assistant", marks no tab, and the page-list test fails on the next run (3.5). The owner is never stranded.
- **Opened on its own** (`assistant.rahe-home.duckdns.org` in a tab), the Assistant keeps a frame of its own so it
  still works when Pi Hub is down (baseline section 10). That frame uses the same labels from the same page list, and
  its "← Home" link reads "← Pi Hub" (section 6.4).

**One area at a time.** The switch is per section (brief 4): until a section is moved, the Assistant keeps drawing
that section's page strip in the frame, and Pi Hub draws only the section strip.

---

## 3. The page list

### 3.1 What it is

One file, `pages.json`, in appliance-ui beside `tools.json`, synced into each app with the kit. It is the only place
a page's label, heading and address are written. `tools.json` stays the list of linked apps; `pages.json` refers to
tools by id.

Putting it in the kit is a kit change and is proposed there first (brief 2). Until it merges, nothing in pi-hub or
LocalAI reads it.

### 3.2 Format

```json
{
  "version": 1,
  "areas": [
    {"id": "workshop", "label": "Workshop", "order": 2, "landing": "printer"}
  ],
  "pages": [
    {
      "id": "printer",
      "system": "hub",
      "area": "workshop",
      "label": "Printer",
      "purpose": "The X2D: what it's doing and what it needs",
      "path": "/workshop",
      "role": "page",
      "reach": ["strip", "palette", "map"],
      "aliases": ["/apps/bambuddy", "/bambuddy"],
      "tools": ["bambuddy"]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Stable id. For an Assistant page, `view` also gives the Assistant's own view id. |
| `system` | `hub`, `assistant` or `mac` (a page served from the Mac, such as camera fit) |
| `area`, `section` | The Pi Hub area; for Assistant pages, also the Assistant section |
| `label` | The one name: strip or tab entry, title, ⌘K entry, Site map row |
| `purpose` | The one line under the title |
| `path` | The Pi Hub address |
| `role` | See below |
| `reach` | Every visible way in: `rail`, `strip`, `tabs`, `chips`, `card:<page id>`, `button`, `foot`, `palette`, `map` |
| `aliases` | Old addresses that redirect here |
| `tools` | Tool ids shown in this page's "Open in" row |
| `needs` | `pc` when the page needs the PC awake; `mac` when it needs the Mac |

**Roles**

| Role | Meaning | Must have |
|---|---|---|
| `page` | A page in an area's strip | `strip` in `reach` |
| `tab` | One of two to five views of a page | `tabs` in `reach`; a parent |
| `filter` | The same page with a filter applied, with its own address | `chips` in `reach`; a parent |
| `mode` | A way of using a page, with its own address (the Assistant composer's Chat and Image) | `button` in `reach`; a parent |
| `detail` | Opened from a card or row on another page | `card:<id>` in `reach` |
| `ambient` | No frame (Wall display) | `foot` in `reach` |
| `standalone` | Outside the frame on purpose (Privacy note) | `foot` or `map` in `reach` |

Every role must also have `palette` and `map` in `reach`. That is how "no page reachable only by knowing its address"
is enforced.

**Fields the table in 3.3 doesn't repeat.** `reach` follows from the role, as above. `purpose` for a Pi Hub page is
the line it shows today (`main.js:98-120`), reworded only where the page's name changed; for an Assistant page it is
the registry's description for that view. `aliases` are in section 10. `needs` is `pc` for every Assistant row and
`mac` for Camera fit. Two rows may share a `path` only when one is a page and the other is its first tab (Print lab
and Experiments; Settings and its first group); the route and alias tests treat that pair as one address.

### 3.3 The complete list

**Pi Hub** (today's routes: `hub/static/js/routes.js:5-21`)

| Area | Label and title | Address | Role | Was | Open in |
|---|---|---|---|---|---|
| Home | Home | `/` | page | Home | — |
| Home | Wall display | `/wall` | ambient | h1 "Wall" | — |
| Workshop | Printer | `/workshop` | page | h1 "Workshop" | Bambuddy |
| Workshop | Print lab | `/lab` | page | h1 "Workshop" | — |
| Workshop | Print lab › Experiments | `/lab` | tab | the page today | — |
| Workshop | Print lab › Designs | `/lab/designs` | tab | **new** | — |
| Workshop | Print lab › Lab tools | `/lab/tools` | tab | **new** | — |
| Workshop | Quick Print | `/quick` | page | h1 "Workshop" | Bambuddy |
| Household | Movies | `/media` | page | h1 "Media" | Plex |
| Household | Papers | `/documents` | page | h1 "Documents" | Paperless |
| Household | Scan | `/scan` | page | **new**; `/scan` redirected to the Scan app | Scan |
| Household | Print | `/print` | page | h1 "Documents" | — |
| Household | Lists | `/lists` | page | h1 "Documents" | — |
| Household | Drives | `/drives` | page | h1 "Media" | — |
| Network | Lights | `/devices` | page | "Devices", h1 "Home & network" | Homebridge |
| Network | Internet | `/network` | page | "Network", h1 "Home & network" | AdGuard, Grafana |
| Network | Weather | `/weather` | page | h1 "Home & network" | — |
| System | Health | `/system` | page | h1 "System" | Cockpit, Healthchecks |
| System | Backups | `/backups` | page | h1 "System" | Backrest |
| System | Versions | `/versions` | page | h1 "System" | — |
| System | Alerts | `/alerts` | page | h1 "System" | — |
| System | Automations | `/rules` | page | h1 "System" | — |
| System | Settings | `/settings` | page | h1 "System", nameplate "Setup" | — |
| System | Settings › each of its six groups | `/settings#group-<id>` | tab | groups today (`settings.js:92`); in no menu, ⌘K or Site map | — |
| System | Site map | `/map` | page | h1 "System" | — |
| — | Privacy note | `/privacy` | standalone | in no menu (`app.py:1551`) | — |

- Addresses do not change with the areas. `/documents` stays Papers and `/media` stays Movies, so nothing saved to a
  phone's home screen breaks.
- Settings keeps its own row of groups. A6 decision 6 called it "a strip of their own"; A22 draws it as `ui-tabs`
  under the area strip, and lists each group by the name `settings.js` gives it today, so each is in ⌘K and the Site map.
- The Scan page exists from brief 2 as a page with one line and its "Open in Scan ↗" link, so the strip is complete
  from the start. Brief 5 fills it in, or leaves it that way (5.3).
- `/privacy` gains a Site map row and a ⌘K entry. `/healthz` and `/home-ca.crt` are machine addresses, not pages, and
  are not in the list.

**The Assistant** (today's views: `LocalAI/app/public/view-registry.js:13-68`)

| Section | Label and title | Pi Hub address | Role | Assistant view id | Was |
|---|---|---|---|---|---|
| Ask | Ask | `/assistant` | page | `home` | "Home"; title was a greeting |
| Ask | Chat | `/assistant/chat` | mode | `ask` | in no menu |
| Ask | Image | `/assistant/image` | mode | `create` | "Images"; in no menu |
| Ask | Decisions | `/assistant/decisions` | tab | `inbox` | "Inbox"; no strip entry, and hidden when framed |
| Work | Work | `/assistant/work` | page | `work` | — |
| Work | Agent World | `/assistant/agent-world` | tab | `agents` | — |
| Work | Assistant automations | `/assistant/automations` | tab | `automationStudio` | title was "Work" |
| Work | Spreadsheets | `/assistant/spreadsheets` | tab | `spreadsheets` | in no menu |
| Projects | Projects | `/assistant/projects` | page | `projects` | — |
| Projects | Sources | `/assistant/sources` | tab | `knowledge` | title was "Projects" |
| Projects | Memory | `/assistant/memory` | tab | `memory` | title was "Projects" |
| Projects | Library | `/assistant/library` | tab | `library` | title was "Projects" |
| Improve | Changes | `/assistant/changes` | page | `backlog` | nameplate "Backlog". With no filter it shows the Backlog chip's list |
| Improve | Changes › In progress | `/assistant/changes/in-progress` | filter | `inProgress` | chip said "Doing"; in no menu |
| Improve | Changes › Shipped | `/assistant/changes/shipped` | filter | `shipped` | in no menu |
| Improve | Signals | `/assistant/signals` | tab | `signals` | — |
| Improve | Claude Code | `/assistant/claude-code` | tab | `claude` | strip said "Claude" |
| Improve | Atlas | `/assistant/atlas` | tab | `architecture` | title said "Architecture" |
| Setup | Assistant status | `/assistant/status` | page | `status` | "System" section; strip said "Status" |
| Setup | Models | `/assistant/models` | tab | `models` | — |
| Setup | Developer tools | `/assistant/tools` | tab | `tools` | "Tools" |
| Setup | Developer tools › Files | `/assistant/tools/files` | detail | `workbench` | in no menu |
| Setup | Developer tools › Repository | `/assistant/tools/repository` | detail | `repoTools` | in no menu |
| Setup | Developer tools › PowerShell | `/assistant/tools/powershell` | detail | `powershell` | in no menu |
| Setup | Developer tools › Browser & computer | `/assistant/tools/browser` | detail | `actions` | in no menu |
| Setup | Developer tools › n8n workflows | `/assistant/tools/n8n` | detail | `automations` | in no menu. Open in: n8n |
| Setup | Assistant settings | `/assistant/settings` | tab | `settings` | "Settings" |
| Setup | Audit log | `/assistant/audit-log` | tab | `activity` | — |
| — | A run | `/assistant/run/<id>` | detail | `#run/<id>` | reached from Work and Needs you |

- **Eleven of the twelve views that were in no strip now have a way in**, and all are in ⌘K and the Site map. The
  twelfth, `runs`, is not a page: it is an alias of Work today (`view-registry.js`, ALIAS `runs`) and stays a redirect.
- `ask` and `create` are also aliases of `home` in the registry (they open Home in a mode). They are listed here as
  `mode` rows on purpose; the registry test allows an alias that has a `mode` row.
- **Decisions is past approvals only.** The old Inbox's description also covers alerts; those already show in Needs
  you on Ask and on Pi Hub's Home and Alerts, and are not repeated on Decisions.
- **Open in.** Image lists ComfyUI, and Developer tools › n8n workflows lists n8n. No other Assistant page has a tool.
- **Sections renamed:** Home becomes **Ask**, System becomes **Setup**. That removes two of the four double meanings
  (C4). Settings becomes **Assistant settings**; Automations was already "Assistant automations".
- **The Assistant's Print lab** is not in the list: its page is already gone and `#printLab` redirects to Pi Hub's
  `/lab` (`router.js:28-29`). Brief 1 deletes the server code it left behind.

**Served from the Mac**

| Label | Address | Role | Reached from |
|---|---|---|---|
| Camera fit | `http://<the Mac>:8765/?t=<token>` | standalone, `needs: mac` | Print lab › Lab tools |

### 3.4 Linked apps in the list

`tools.json` changes (a kit PR, with the page list):

| Tool id | Change |
|---|---|
| `hub` | Name "Home" becomes "Pi Hub", so the Site map no longer lists a tool called Home on a page called Home |
| `status` (Uptime Kuma) | Removed (O4) |
| `homebox` | Removed from every page's "Open in" row; kept in the file as `retired: true`, and so still listed in the Site map under "No longer used", until the owner confirms it is empty (O5) |
| `n8n`, `comfy` | Added, area `assistant`, reached through the Assistant's own `/go/n8n` and `/go/comfy` |
| `healthchecks` | Its name stays "Healthchecks.io" as in the file; this spec's "Healthchecks" means that entry |
| all others | Unchanged |

`hub`, `assistant`, `display` and `ota` are the site itself, the Assistant's door and the display's two machine
addresses. They belong to no page's "Open in" row and are exempt from `test_pages_tools`.

### 3.5 Tests that keep it honest

Run on the Mac, in each repo's ordinary suite. Each is a file read and a comparison; none needs a browser.

| Test | Repo | Fails when |
|---|---|---|
| `test_pages_routes` | pi-hub | A `hub` page's `path` is not a route in `routes.js`, or a route is not in the list |
| `test_pages_headings` | pi-hub | The title a page renders is not its `label` (checked against what `main.js` sets; the browser structure check asserts the rendered `h1` too) |
| `test_pages_reach` | pi-hub | A page lacks `palette` or `map` in `reach`, a `page` isn't in its area's strip, or a `detail` names a card page that doesn't link to it |
| `test_pages_redirects` | pi-hub | An `alias` doesn't redirect to its page, or two pages claim one alias |
| `test_pages_areas` | pi-hub | The rail and the tab bar don't list exactly the five areas in order, or an area's strip has more than six pages (System: seven) |
| `test_pages_tools` | pi-hub | A page's `tools` names an id that isn't in `tools.json`, or a tool that isn't exempt (3.4) or retired is on no page |
| `pages-registry.test.cjs` | LocalAI | An `assistant` page's `view` isn't in `view-registry.js`; a view that isn't an alias is missing from the list; an alias is listed without being a `mode` row; or a view's label there differs from `label` |
| `pages-words.test.mjs` | appliance-ui | Two pages share a `label` anywhere on the site, a `label` isn't sentence case (the proper names in 8.1 are listed as exceptions), or a `label` is one of the retired words in section 8.6 |
| Site map check | pi-hub | `/map` (`map.js`) shows a row that isn't generated from the list |

---

## 4. The "PC is asleep" banner

The Assistant runs on the Windows PC, which sleeps. Pi Hub already knows three things from `/api/assistant`
(`hub/app.py:1039`, `sections.js:90-99`): whether the PC is on, and whether Local AI is Ready, Busy or Down.

### 4.1 States

| State | When | What the owner sees on any `/assistant/…` page |
|---|---|---|
| Ready | PC on, Local AI Ready or Busy | The page |
| **Asleep** | The `pc` record is off, and Local AI isn't Ready or Busy | The banner, **Asleep** wording. No frame. |
| **Waking** | The PC has come on (it was Asleep on this page), Local AI not Ready yet | The banner, **Waking** wording, with a `ui-skeleton` under it |
| **Down** | PC on, Local AI Down; or the frame gave no answer in 10 s (A4 requirement 5) | The banner, **Down** wording |
| Unknown | Pi Hub can't tell | The frame opens (A4: "Unknown isn't off") |

- **Pi Hub cannot wake the PC.** There is no wake-on-LAN in `hub/` or `deploy/`. The Asleep wording says so plainly.
  A "Wake the PC" button would be a network action and a new amendment; it is listed under "Questions settled under O7".
- **The banner replaces the content, not the frame around it.** The title, the section strip and the tabs stay, so
  the owner can still see where they are and move.
- **It watches by itself.** While Asleep or Waking, Pi Hub re-checks every 15 s and when the page regains focus, and
  moves to the next state without a reload. It never moves keyboard focus.
- **It is `ui-notice--warn`** above where the faceplate would be, with a heading, one sentence and at most one button (two after a failed retry, 8.4), as the
  current down notice is (`hub/static/js/assistant.js:68-69`). Wording is in section 8.4.

### 4.2 Elsewhere on the site

| Place | Asleep | Down |
|---|---|---|
| The Assistant button (rail foot, phone top bar) | Label "PC is asleep"; still opens `/assistant`, which shows the banner | Label "Assistant isn't answering"; same |
| ⌘K Assistant entries | Listed, marked "PC is asleep" | Listed, marked "Not answering" |
| Site map's Assistant group | Listed, with one line above: "The PC is asleep. These pages open when it's awake." | Same, Down wording |
| Home's Needs you | Nothing: a sleeping PC is normal | One item, as today |
| A page that only reads Assistant data (Versions' Atlas link) | The link stays and opens the banner | Same |

Today the Assistant button is disabled when the PC is off (`sections.js:98`). It becomes enabled, because a disabled
control can't explain itself and the banner can.

---

## 5. Linked apps

### 5.1 The rule

Each linked app is an **engine**. Its everyday job is a Pi Hub page; the app itself stays installed, unchanged, for
everything else.

- **Absorb:** Pi Hub calls the app's documented API from the server (`hub/*.py`) and draws the result in the kit. The
  browser never talks to the app.
- **Label:** the app opens in a new tab from the page's "Open in" row, looking like itself.
- **Never** framed, forked, restyled or proxied under Pi Hub's origin.
- **No skin tier.** No app documents custom CSS. Restyling would mean a custom Caddy build that rewrites other apps'
  pages (`replace-response`, which stock Caddy doesn't include), against security headers that could not be confirmed
  for any app. With the everyday jobs on Pi Hub pages, the apps are opened rarely, so the risk buys little. The
  "← Pi Hub" top bar therefore applies only to the platform's own off-frame pages (6.4).

### 5.2 The plan for each app

| App | Tier | Everyday job on Pi Hub | Why (from the audit) |
|---|---|---|---|
| Bambuddy | Absorb | Printer and Quick Print: queue, history, spools | Documented API; Pi Hub already reads it (`hub/bambuddy.py`) |
| Paperless | Absorb | Papers: find, open, add a paper | Documented search and upload; `hub/paperless.py` exists |
| Scan (scanservjs) | Absorb, after a check | Scan: start a scan, see it arrive | Its API is self-documented on the instance only; brief 5 reads it first |
| AdGuard | Absorb | Internet: ad blocking on or off, today's numbers | Documented API |
| Backrest | Absorb | Backups: last run per plan, "Back up now" | Two calls documented as stable |
| Homebridge | Absorb what exists | Lights: on, off, state | `hub/homecontrol.py` exists; the API's calls were only confirmed second-hand |
| Healthchecks | Absorb, read-only | Health: the outside alarm's state (A1) | Documented API with a read-only key; hosted elsewhere, so it can't be anything but labelled as a site |
| Grafana | Label | — | No custom CSS. A light or dark default can follow the system |
| Cockpit | Label | — | No REST API found; it is the tool for when Pi Hub is broken, so it must not depend on Pi Hub |
| Plex | Label | Movies already shows what's on (`hub/plex.py`) | Hosted by Plex |
| n8n, ComfyUI | Label | — | Large editors on the PC; added to the tool list |
| Uptime Kuma | **Retire** (O4) | Health already runs Pi Hub's own self-check and heartbeat | Only a metrics feed is documented; it keeps a second password |
| Homebox | **Out of the menus** (O5) | — | Unused. Uninstalled only after the owner confirms it holds nothing |

### 5.3 API calls for absorbed apps

Each call is made by Pi Hub's server with a key kept in `/etc/pi-hub/secrets/`, never by the browser. Writes are
owner-only and ask through `ApplianceConfirm` where they are risky.

**Bambuddy** — https://wiki.bambuddy.cool/reference/api/ (base `/api/v1`, `X-API-Key`)

| Call | For |
|---|---|
| `GET /printers/{id}/status` | Printer's faceplate |
| `GET /queue` | The queue section |
| `GET /archives`, `GET /archives/search?q=` | Print history |
| `GET /inventory/spools` | Filament |

Reads only. Bambuddy stays read-only except for the two starts A12 and A19 already allow.

**Paperless** — https://raw.githubusercontent.com/paperless-ngx/paperless-ngx/dev/docs/api.md (`Authorization: Token`)

| Call | For |
|---|---|
| `GET /api/documents/?query=` | Find a paper |
| `GET /api/search/autocomplete/?term=` | Suggestions while typing |
| `POST /api/documents/post_document/` | Add a paper |
| `GET /api/tasks/?task_id=` | "Filing…" until it is done |

**AdGuard** — https://raw.githubusercontent.com/AdguardTeam/AdGuardHome/master/openapi/openapi.yaml (HTTP Basic
while AdGuard's own login is on. When the owner turns that login off in brief 6, the owner also empties Pi Hub's
AdGuard secret, and Pi Hub sends no credentials. The same holds for Backrest.)

| Call | For |
|---|---|
| `GET /control/status` | Is ad blocking on |
| `GET /control/stats` | Today's numbers |
| `POST /control/protection` `{enabled, duration}` | Turn it off for a while, or back on (owner; asks first when turning off) |

**Backrest** — https://garethgeorge.github.io/backrest/docs/api (HTTP Basic, or none when its login is off)

| Call | For |
|---|---|
| `POST /v1.Backrest/GetOperations` `{"selector": {"planId": …}}` | Last run and result per plan |
| `POST /v1.Backrest/Backup` `{"value": "<planId>"}` | "Back up now" (owner). The call blocks until done, so Pi Hub sends it in the background and shows sent, running, done |

**Healthchecks** — https://healthchecks.io/docs/api/ (`X-Api-Key`, read-only key)

| Call | For |
|---|---|
| `GET /api/v3/checks/` | Each check's `status`: `up`, `grace` (late), `down`, `paused`, `new` |

**Scan** — https://github.com/sbs20/scanservjs. The project documents only that an API explorer is served at
`/api-docs` on the instance. Brief 5's first task is to read it there and write the calls into this table. If it
doesn't offer "start a scan" and "fetch the result", Scan stays a labelled app and the Scan page is dropped from the
list.

**Homebridge** — https://github.com/homebridge/homebridge-config-ui-x/wiki/API-Reference. The explorer at `/swagger`
is documented; the calls Pi Hub would add (`GET /api/accessories`, `PUT /api/accessories/{uniqueId}`) were confirmed
only from third-party pages. Lights keeps using what `hub/homecontrol.py` does today; anything new is checked against
the instance's `/swagger` first.

### 5.4 The "Open in ↗" row

Each page ends with the kit's `ui-tools` row, generated from the page's `tools` in the page list (A6 decision 12:
each tool once per page).

```
 Open in   Bambuddy ↗    Paperless ↗ · asks for its own password
```

- The link text is the product's name (A6 decision 10). "Open in" is the row's label, said once.
- It opens a new tab. The arrow says so to the eye, and the link's accessible name says so in words (section 9).
- **"asks for its own password"** follows the name only for an app that still has a second sign-in (5.5, 6.2), so
  the owner is never surprised by one.
- A tool whose machine is asleep stays listed with "PC is asleep" after its name, and still opens.
- Retired tools don't appear.

---

## 6. Single sign-on and the proxy

### 6.1 How it works today, and stays

Caddy fronts every app (`deploy/caddy/Caddyfile`). For a gated app it strips any identity header the client sent,
asks Pi Hub `GET /api/gate`, and passes only Pi Hub's answer on as `X-Remote-User` (the `gated` snippet, lines 21-40).
Pi Hub answers yes for the owner: a signed-in password session, or one of the owner's own Tailscale devices
(`hub/devices.py`, `hub/gate.py`). Nobody else gets through.

That is the single sign-on (O1). A22 adds no identity service. What remains is the second password some apps ask for
after the gate.

### 6.2 Removing second passwords

| App | Today | A22 | Setting (from the app's docs) |
|---|---|---|---|
| Grafana | None: trusted header | Unchanged | `[auth.proxy]`, already set (`Caddyfile:78-89`) |
| Bambuddy | Own password | "Sign in with Pi Hub": one tap, or none | A15 as approved: the owner adds Pi Hub once as a provider in Bambuddy's own settings (A15 O6). Whether Bambuddy then skips its sign-in page (`is_autologin`) depends on A15's open question Q1; if not, the owner taps "Sign in with Pi Hub". Bambuddy's sign-in options: https://wiki.bambuddy.cool/features/authentication/ |
| Paperless | Own password | Trusted header | `PAPERLESS_ENABLE_HTTP_REMOTE_USER=true`, `PAPERLESS_HTTP_REMOTE_USER_HEADER_NAME=HTTP_X_REMOTE_USER` (Paperless `docs/configuration.md`) |
| AdGuard | Own password | Its login off | `users: []` (https://github.com/AdguardTeam/AdGuardHome/wiki/Configuration) |
| Backrest | Own password | Its login off | Authentication disabled, which its docs name for use "behind an authenticating reverse proxy" (https://garethgeorge.github.io/backrest/introduction/getting-started) |
| Homebridge | Own password | Its login off | `auth: "none"` (https://github.com/homebridge/homebridge-config-ui-x/wiki/Config-Options) |
| Scan | None | Unchanged | — |
| Cockpit | Own password | **Keeps it** | No header sign-in documented; it also must work when Pi Hub doesn't |
| Plex, Healthchecks, n8n, ComfyUI | Their own | **Keep them** | Hosted elsewhere, or no free option (n8n's single sign-on is a paid feature) |

**The condition for turning a login off.** An app whose own login is off is protected only by the gate. So before
that setting changes, the app must be unreachable except through Caddy:

- It listens on `127.0.0.1` only, or the Pi's firewall (`deploy/pi-lock-firewall.nft`) drops everything to its port
  except from the Pi itself; and
- that is verified from another machine on the house network (`curl` to the raw port is refused).

Paperless runs on the PC (`10.0.0.21:8010`), where a trusted header is only safe if the PC accepts that port from the
Pi alone (`deploy/windows-lock-paperless.ps1`). The same check applies there.

Each of these is a service or firewall change. Under the owner's standing rule they are **made only with the owner's
confirmation at the time**, one app per change, and are not part of any agent's PR.

### 6.3 Proxy changes

All in `deploy/caddy/Caddyfile`. AGENTS.md allows changes there only in a PR that names the baseline decision
permitting it; **this section is that decision**, once A22 is approved.

| Change | Lines today | Why |
|---|---|---|
| Remove the `@status` host | 212-215 | Uptime Kuma retired (O4). Done only after its container is stopped (brief 5) |
| Remove the `@homebox` host | 200-203 | Only after the owner confirms Homebox is empty (O5) |
| No other host changes | — | Paperless already receives `X-Remote-User` through `gated`; A15's sign-in is served by Pi Hub itself |
| **Not added:** any rewrite of another app's pages; any Local AI route under `hub.` | — | 5.1; A4 requirement 1 |

One finding outside the proxy, recorded for the sign-in work: `hub_session` is set without the `Secure` flag
(`hub/app.py:985`). Every house name is already https-only, so it should be set. The edit is in `hub/app.py`, where
the cookie is set; `hub/auth.py` and `hub/gate.py` are not edited. Because it is sign-in behaviour, the fix rides in
brief 6 and cites this paragraph.

### 6.4 The "← Pi Hub" bar

For the platform's **own** pages that live outside the frame, never for outside apps:

- the Assistant opened on its own address (its "← Home" link today);
- Camera fit on the Mac;
- the Privacy note.

It is a proposed kit part, `ui-backbar`: one link, "← Pi Hub", at the top left of the page, the first thing in the
document, using `--ui-bar` and `--ui-accent-text`. It is not sticky, so it never covers content or focus. It links to
`https://hub.rahe-home.duckdns.org/` (or to the page the visitor came from, when that is a Pi Hub address).

---

## 7. One home for print-lab

Print lab (`/lab`) becomes three tabs, drawn as `ui-tabs` under Workshop's strip.

| Tab | Address | Holds |
|---|---|---|
| **Experiments** | `/lab` | Everything `/lab` shows today (`hub/static/js/lab.js`): questions, experiments, builds, runs, photos, verdicts, the plan preview |
| **Designs** | `/lab/designs` | An index of design runs, newest first: the run's date, its project, how many candidates, and the chosen one. Opening a run shows its candidates as pictures with their measurements. Pi Hub draws this in the kit from data the Mac sends; it does not serve the Mac's own gallery HTML |
| **Lab tools** | `/lab/tools` | Every other piece of print-lab, each one usable or honestly marked |

**Lab tools**, as `ui-row--lamp` rows in four sections:

| Section | Row | Lamp and value | Action |
|---|---|---|---|
| On the Mac | Camera fit | Running, with its address · Not running · Mac asleep | **Start camera fit**; once running, **Open camera fit ↗** |
| On the Mac | Lab sync (`com.printlab.pull`) | Last ran 40 s ago · Not running | — |
| On the Mac | Quick Print worker (`~/Library/LaunchAgents/com.printlab.quickworker.plist`, installed on the Mac; the repo holds the command it runs, `lab quick worker`) | Last ran 40 s ago · Not running | — |
| On the Mac | Qualification gate (`tools/qualification-gate/apply.py`) | Listed with its one-line purpose | **Copy** the command |
| In Fusion | Parameters panel (`tools/fusion/ParamsPanel`) | Installed · Not installed · Not reported | — |
| In Fusion | Phone bridge (`tools/camera_fit/PhoneBridge`) | Installed · Not installed · Not reported; "Start it from Fusion: Shift+S" | — |
| Commands | The `lab` commands, grouped: Look at a model · Plan and build · Record what happened · Housekeeping | One line each, from `lab --help` | **Copy** beside each |
| Coming | Print twin (A24) | Draft, not approved, not built | — |

**How "Start camera fit" works.** Pi Hub can't start a program on the Mac. The Mac already asks Pi Hub for pending
requests every 60 s (`com.printlab.pull`, `lab pull`). So:

1. The button queues a request of a new kind, `tool_start` with `tool: "camera_fit"`, in the lab's request queue
   (`hub/lab.py`). Owner only.
2. The row says "Waiting for the Mac…" (the `mac_waiting` phrase) and the button is disabled. It never shows a
   success it didn't get (`DESIGN.md`, "Actions have three steps").
3. On its next pull the Mac starts `tools/camera_fit/server.py` and sends back the address and its token.
4. The row turns to Running and offers **Open camera fit ↗**. The token is in the link; it is never shown as text.
5. If the Mac doesn't pick the request up within three minutes, the row says "The Mac didn't answer. Check that it's
   awake, then try again."

`tool_start` starts only tools on a fixed list in print-lab (today: `camera_fit`). It does not touch the printer, is
not a printer-control route, and leaves A12's and A19's start rules as they are. It is a new way for Pi Hub to start
a program on the Mac, so:

- Queuing it is owner-only, checked in `hub/lab.py` like the page's other owner actions.
- The Camera fit row's address, its link and its token are returned only to the owner. A signed-out viewer sees
  "Running" or "Not running" and no link, and no API a viewer can call returns the token.

**Designs' data.** The galleries are written on the Mac by `lab design make` and `lab design gallery`
(`lab/design/gallery.py`) as HTML under `projects/<project>/designs/runs/`, which is not committed. `lab sync` sends
each run's data and pictures, not that HTML. `lab page` (`lab/page.py`), which refreshes `page.json` and the spool
colours for the Experiments tab, is unchanged.

**How the page knows what's installed.** `lab sync` adds a small `tools` record to what it already sends: whether each
add-in's link exists in Fusion's add-ins folder, when each launch agent last ran, whether camera fit is running, the
`lab --help` text, and the index of design runs. "Not reported" means the Mac hasn't sent a record yet; it is never
drawn as "Not installed".

**Camera fit's own page** takes the kit's values and the "← Pi Hub" bar (1.4, 6.4). The Fusion panel's page takes the
kit's values; it has no bar, because it lives inside Fusion.

**The Assistant's leftovers.** The Assistant no longer has a Print lab page, but still carries its store and API
(`LocalAI/app/print-lab.js`, `app/display-lab.js`, `app/lab-callers.js`, routes in `app/server.js:149-165,185,600-638`,
`tests/print-lab-ui.mjs`). `lab sync` writes to Pi Hub only (`print-lab/lab/sync.py:117-124`), so that store is stale.
Brief 1 removes it once `lab-callers` shows no caller, as the baseline's D5 already requires. `lab page`'s help text,
which still says "the page itself is in Local AI", is corrected in print-lab.

---

## 8. Names: one name per thing

Sentence case everywhere. A tool keeps its product name; a page gets a plain word (A6 decision 10). Proper names
keep their capitals and are the only exceptions to sentence case: Quick Print, Agent World, Claude Code, Atlas,
PowerShell, Pi Hub.

### 8.1 Areas and pages

| Thing | The one name | Retired names |
|---|---|---|
| The site | Pi Hub | "Home" as the hub's name (tool list, PWA name), "Home network" |
| The start page | Home | — |
| The ambient board | Wall display | "Wall" |
| The Assistant | Assistant | "Local AI" in anything the owner reads, "Assistant (Local AI)". "Local AI" remains the software's name in Versions, Atlas and logs |
| Area 3 | Household | Documents, Media |
| Area 4 | Network | Home & network |
| The X2D's page | Printer | "Workshop" as its title |
| Paper documents | Papers | "Documents" as its title |
| Paper printing | Print | — |
| 3D printing without an experiment | Quick Print | — |
| Movies | Movies | "Media" as its title |
| Disks holding movies | Drives | "Storage" |
| Smart-home controls | Lights | "Devices", "Lights and plugs", "Smart-home controls" |
| The connection | Internet | "Network" as a page name |
| The house's health | Health | "System" as its title, "Self-check" as a nameplate |
| The house's rules | Automations | — |
| Pi Hub's settings | Settings | "Setup" |
| The Assistant's rules | Assistant automations | "Automation studio", "Operations" |
| The Assistant's health | Assistant status | "Status", "Health", "Connections" |
| The Assistant's settings | Assistant settings | "Settings" inside the Assistant |
| The Assistant's start page | Ask | "Home", the greeting as a title |
| The Assistant's fifth section | Setup | "System" |
| Past approvals | Decisions | "Inbox" |
| Proposed and running changes | Changes | "Backlog" as a page name |
| A change being worked on | In progress | "Doing" |
| The system map | Atlas | "Architecture" as a title |
| Claude's workspace | Claude Code | "Claude" |
| print-lab's other pieces | Lab tools | "Tools" as a Print lab tab |
| The Assistant's engineering pages | Developer tools | "Tools" as an Assistant tab, "Workbench", "Advanced" |
| The row of linked apps on a page | Open in | "Tools" as a word the owner reads (the kit's class stays `ui-tools`) |
| What needs the owner | Needs you | "Problems", "Inbox", "Notifications" |

### 8.2 Menu and frame

| Element | Text |
|---|---|
| Rail and tab bar | Home · Workshop · Household · Network · System |
| Assistant button | Assistant |
| Search button | Search (with `⌘K` shown on a keyboard device) |
| Search field | Find a page, tool or action |
| No results | Nothing matches "{query}". Try a page name, like Printer or Backups. |
| Foot | Wall display · Site map · Theme · Text size |
| Tools row | Open in |
| Back bar | ← Pi Hub |

### 8.3 Buttons (specific verbs, per `DESIGN.md`)

| Where | Button | Toast when done |
|---|---|---|
| Banner | Try again | — |
| Backups | Back up now | Backed up {plan} |
| Internet | Turn ad blocking off for 10 minutes · Turn ad blocking on | Ad blocking is off until {time} · Ad blocking is on |
| Scan | Start a scan | Scanned: {name} |
| Papers | Add a paper | Added {name} |
| Print lab › Lab tools | Start camera fit · Open camera fit ↗ · Copy | Camera fit is running · Copied |
| A tool row | {Product} ↗ | — |

### 8.4 The PC: asleep, waking, down

| State | Heading | Sentence | Button |
|---|---|---|---|
| Asleep | The PC is asleep | The Assistant runs on the PC. Wake the PC, and this page opens by itself. | Try again |
| Waking | The PC is waking up | The Assistant is starting. This usually takes under a minute. | — |
| Down | The Assistant isn't answering | The PC is on, but the Assistant didn't answer. If it stays this way, restart the Assistant on the PC. | Try again |
| Down, after "Try again" fails | The Assistant still isn't answering | Checked just now. Health has the details. | Try again · Open Health |

Short forms, where there's no room for a sentence:

| Place | Asleep | Waking | Down |
|---|---|---|---|
| Assistant button | PC is asleep | PC is waking up | Assistant isn't answering |
| ⌘K and tool rows | PC is asleep | Waking up | Not answering |

These replace the phrase table's `pc_off` ("The PC is off or asleep") and extend `assistant_down`
(`appliance-ui/src/needs.js:15`; `hub/static/js/sections.js:92`). The kit PR renames the key's text and adds
`pc_waking`; the display's `words.h` follows from the same source.

The Mac has one phrase already, `mac_waiting`: "Waiting for the Mac…". Its failure: "The Mac didn't answer. Check that
it's awake, then try again."

### 8.5 Empty states (what's missing, then what to do)

| Page | Text |
|---|---|
| Needs you | Nothing needs you. |
| Papers, no results | No papers match "{query}". Try fewer words, or add a paper. |
| Scan, nothing yet | No scans today. Put a page on the scanner, then start a scan. |
| Backups, never run | No backup has run yet. Back up now to make the first one. |
| Movies, source down | Plex isn't answering, so the list couldn't be read. |
| Print lab › Designs | No design runs yet. Run `lab design make` on the Mac to make one. |
| Print lab › Lab tools, no record | The Mac hasn't reported its tools yet. This fills in after its next sync. |
| Decisions | No decisions yet. Approvals you give or refuse are kept here. |
| Changes › In progress | Nothing is in progress. |
| Site map, PC asleep | The PC is asleep. These pages open when it's awake. |
| Page not found | This page doesn't exist. Search for it, or open the site map. |

A list from a source that is down never shows an empty state: it says the source couldn't be read (`DESIGN.md`,
"Honest states").

### 8.6 Retired words

`pages-words.test.mjs` (3.5) fails on any of these as a page `label`: Documents, Media, Home & network, Devices,
Network (as a page; it is the area's name), Storage, Setup (as a Pi Hub page), Inbox, Backlog, Doing, Architecture, Status (alone), Tools (alone),
Local AI, More. "Backlog" stays as a chip on Changes; a chip is a filter's name, not a page `label`.

---

## 9. Accessibility

Reviewed against WCAG 2.1 AA and the kit's own rules (`DESIGN.md`, "Accessibility"), as a design review of the five
parts the brief named. Nothing here was tested with a screen reader; that is in the acceptance checks. Contrast
claims are limited to pairs `appliance-ui/docs/contrast.md` already measures; every new pair below gets a row there
before it ships.

**Summary:** 21 findings. 3 critical (they block someone), 11 major, 7 minor. All are folded into the sections above
or the briefs.

### 9.1 The shared frame

| # | Issue | Criterion | Severity | Fix |
|---|---|---|---|---|
| F1 | The frame adds two rows of navigation before the content on every Assistant page. A keyboard user tabs through the rail, the strip and the tabs each time. | 2.4.1 Bypass blocks | Critical | Keep the "Skip to content" link that is already first on every page (`index.html:111`). New: on `/assistant/…` it moves focus into the frame, past both rows. |
| F2 | Three navigation regions would all be announced as "navigation". | 1.3.1, 2.4.6 | Major | The rail keeps its label ("Primary navigation" today, `index.html`); new: `<nav aria-label="{Area} pages">` for the strip, and the second row is a `tablist` named by the current page. |
| F3 | The current page must not be shown by colour alone. | 1.4.1 | Major | Keep `aria-current="page"` on the current area (set today) and add it to the strip entry; `ui-strip`'s underline and `ui-tabs`' wash-plus-bar already add a non-colour mark. |
| F4 | With the title now outside the frame, the frame's document would have no heading. | 1.3.1, 2.4.6 | Major | The Assistant keeps its `h1` in its document, visually hidden when framed (2.5). The frame's `title` is "{Page}, Assistant content". |
| F5 | When the owner picks a tab, the content changes inside the frame and nothing is announced. | 4.1.3 Status messages | Major | Pi Hub's title is in a polite live region, so the new page name is spoken. Focus stays on the tab (the tab pattern), not thrown into the frame. |
| F6 | Text size "Larger" (130%, A14) on a 320 px phone with five tabs. | 1.4.4, 1.4.10 | Major | The width sweep (`tests/browser/sweep.mjs`) runs the five-tab bar at 320 px at all three text sizes. If "Household" or "Workshop" clips at 130%, the bar shows icons with labels under them at `--ui-fs-1` and never truncates a label. |

### 9.2 Phone tabs

| # | Issue | Criterion | Severity | Fix |
|---|---|---|---|---|
| P1 | The fixed bar can cover the focused control at the bottom of a page. | 2.4.7 (and 2.4.11 in WCAG 2.2) | Critical | `scroll-padding-bottom` equal to the bar's height plus the safe-area inset, so focus is never under it. |
| P2 | Home's count badge is a bare number. | 1.1.1, 4.1.2 | Major | The tab's accessible name is "Home, 7 need you". The badge itself is hidden from assistive tech. |
| P3 | Five tabs at 320 px are 64 px wide each. | 2.5.5 | Minor | Each tab's target is the full cell, at least 44 px high (the bar is 68 px today, `app.css` `--tabbar-h`). |
| P4 | The bar is a list of places, not tabs. | 4.1.2 | Minor | It is a `<nav>` of links, not `role="tablist"`. Only the second row in the frame is a tablist. |

### 9.3 ⌘K search

| # | Issue | Criterion | Severity | Fix |
|---|---|---|---|---|
| K1 | The palette must be usable without knowing the shortcut. | 2.1.1 | Major | The Search button is always visible and focusable. `⌘K` and `Ctrl+K` both open it; the button carries `aria-keyshortcuts`. |
| K2 | Results must be reachable and announced. | 4.1.2, 4.1.3 | Major | The combobox pattern: the field has `role="combobox"`, `aria-expanded`, `aria-controls` and `aria-activedescendant`; results are a `listbox` of `option`s; the count ("12 results", "No results") is in the palette's `__status` region. |
| K3 | A result marked "PC is asleep" by tint alone. | 1.4.1 | Minor | The words are in the option's text. |
| K4 | Closing it. | 2.4.3 | Minor | Escape closes it and returns focus to what opened it; focus is trapped while open (`DESIGN.md`, "Dialogs"). |

### 9.4 The "PC is asleep" banner

| # | Issue | Criterion | Severity | Fix |
|---|---|---|---|---|
| B1 | The Assistant button is disabled today when the PC is off, so a keyboard or screen-reader user can't reach the reason. | 4.1.2, 3.3.1 | Critical | The button stays enabled and opens the banner (4.2). |
| B2 | The banner changes state by itself (Asleep, Waking, Ready). | 4.1.3 | Major | It is `role="status"` (polite), not `alert`: nothing here is urgent. The heading text change is what is announced. The page opening is announced by the title region (F5). |
| B3 | The 15 s re-check must not move focus or reset what the owner is reading. | 3.2.1, 2.2.2 | Major | It replaces only the banner's text. Focus stays where it is; if it was on "Try again" and that button goes away (Waking), focus moves to the banner's heading, which takes `tabindex="-1"`. |
| B4 | The amber bar must not be the only sign. | 1.4.1 | Minor | The heading says the state in words. The skeleton under "Waking" is `aria-hidden`, and respects `prefers-reduced-motion`. |

### 9.5 "Open in ↗" and the "← Pi Hub" bar

| # | Issue | Criterion | Severity | Fix |
|---|---|---|---|---|
| O1 | "↗" is read as "north east arrow", or not at all. | 1.1.1, 3.2.5 | Major | The arrow is `aria-hidden`; each link's name ends "(opens in a new tab)", in visually hidden text. `rel="noopener"`. |
| O2 | "asks for its own password" is outside the link. | 1.3.1 | Minor | It is joined to the link with `aria-describedby`. |
| O3 | The back bar's arrow, and its place in the order. | 1.1.1, 2.4.3 | Minor | The arrow is `aria-hidden`; the link's name is "Back to Pi Hub". It is first in the document, inside `<nav aria-label="Pi Hub">`, at least 44 px high, not sticky. |

### 9.6 Keyboard order on an Assistant page

| Step | Element | Keys |
|---|---|---|
| 1 | Skip to content | Enter moves focus into the frame |
| 2 | Areas (rail) | Tab through; Enter opens |
| 3 | Search | Enter opens the palette; `⌘K` or `Ctrl+K` anywhere |
| 4 | Assistant button | Enter |
| 5 | Section strip | Tab through; Enter opens |
| 6 | Tabs | One Tab stop; arrow keys move; Home and End jump |
| 7 | The frame | Tab enters the Assistant's content, and Tab from its last control leaves it |
| 8 | Foot: Open in, Site map, Theme, Text size | Tab through |

### 9.7 What still needs a person

Before any brief that changes the frame is accepted: VoiceOver on an iPhone through the tab bar, a banner state change
and a ⌘K search; keyboard only on a Mac through the order above; and 200% browser zoom at 1280 px with no loss of
content.

---

## 10. Old addresses

Every address that works today keeps working. Redirects are generated from `aliases` in the page list.

**Pi Hub**

| Old | New | Status |
|---|---|---|
| `/next`, `/apps` | `/` | today (`routes.js`) |
| `/movies` | `/media` | today |
| `/control` | `/devices` | today |
| `/pi` | `/system` | today |
| `/apps/bambuddy`, `/bambuddy` | `/workshop` | today |
| `/apps/grafana`, `/grafana` | `/network` | today |
| `/apps/status`, `/status` | **`/system`** | changed: Uptime Kuma is retired, and Health is where "is it up" lives. Was `/network` |
| `/apps/scan` | **`/scan`** | changed: was `/documents` |
| `/scan` | the **Scan page** | changed for `GET` only: was a server redirect to the Scan app (`app.py:1493-1496`). `/scan/<anything>`, and any `POST`, `PUT` or `DELETE` to `/scan`, still redirect to the app with a 308, so its own links and calls keep working |
| `/more` | `/map` | new |
| `/assistant?to=<route>` | `/assistant/<path>` for that view, keeping other parameters | new |
| `/assistant?context=…` | `/assistant?context=…` | unchanged (A4 requirement 4) |
| `/lab?p=…&e=…&do=judge` | unchanged; it is the Experiments tab | unchanged |
| any other path | the Page not found page | today |

**Addresses that do not change** although their menu place does: `/documents` (Papers), `/print`, `/lists`, `/media`
(Movies), `/drives`, `/devices` (Lights), `/network` (Internet), `/weather`.

**The Assistant** (its own hash routes, when opened on its own or sent by an old link)

| Old | New | Status |
|---|---|---|
| `#approvals` | Decisions | today (alias of `inbox`) |
| `#operations` | Assistant automations | today |
| `#engineering`, `#changes` | Changes › In progress | today |
| `#deployments` | Changes › Shipped | today |
| `#issues`, `#quality` | Signals | today |
| `#integrations` | Assistant status | today |
| `#runs` | Work | today |
| `#ask`, `#create` | Chat, Image | today |
| `#printLab` | Pi Hub `/lab` | today |
| `#home`, `#system` | Ask, Assistant status | the ids stay; only the labels change |

**Hosts**

| Old | New |
|---|---|
| `status.rahe-home.duckdns.org` | Removed with Uptime Kuma, including its public `status/home` page (`hub/sources.py:125`). Caddy's catch-all drops it (`Caddyfile:236-239`); nothing in the site links to it after brief 5 |
| `homebox.rahe-home.duckdns.org` | Unchanged until the owner confirms Homebox is empty |
| `*.home.arpa` | Unchanged (they already redirect, `Caddyfile:169-172`) |

Notice links already sent to a phone (A6's "old click hosts stay accepted") are unaffected.

---

## 11. Fit with the baseline

| Text | From | To |
|---|---|---|
| §5.1, level 1 | Pi Hub's six sections; the Assistant's five pages inside the Assistant | Pi Hub's five areas; the Assistant's five sections drawn by Pi Hub |
| §5.2, phone | Home, Workshop, Documents, Media, More | Home, Workshop, Household, Network, System; no More |
| §5.2, inside the Assistant, framed | "the five pages are a level-2 strip" drawn by Local AI | drawn by Pi Hub from the page list |
| §5.3 | Uptime Kuma under Home & network; Homebox under Documents | Removed; `n8n` and ComfyUI added under the Assistant |
| §5.6 | The route table | Section 3.3 and section 10 |
| §9 | Terminology | Section 8 replaces the rows it names |
| A4, "Inside the Assistant, framed" | Local AI draws its five pages as a strip in the frame | Pi Hub draws both rows; two messages added (2.5). Requirements 1 to 9 stand |
| A6 decisions 1, 2 | Documents, Media, Home & network strips | Household and Network strips |
| A6 decision 6 | Settings' groups are "a strip of their own" | `ui-tabs`, listed in the page list |
| A4 requirements 5, 6, 7, 8 | See 2.5 | See 2.5 |
| LocalAI navigation-depth spec | Chips "Backlog · Doing · Shipped" | "Backlog · In progress · Shipped" |
| A6 decision 11 | Site map generated from `routes.js` and the tool registry | generated from the page list |
| A7 P1 | "Title" (the area's name in practice) | the page's name |
| A15 | Approved, not built | Built in brief 6, unchanged |

Unchanged, and relied on: A4's separate-origin rule; A10 (layouts by their own width; its own header still says
"proposed", though AGENTS.md and the tests already enforce it, so A22 relies on it as it stands); A12 and A19 (the
only Bambuddy writes); A14 (text size); D3 (no new chrome: the frame is the existing shell).

**Migration steps added to section 11:** 11 (quick wins), 12 (page list and frame), 13 (values and the check),
14 (the Assistant as content), 15 (absorb), 16 (sign-in and the nightly check). They are the six briefs below.

---

## 12. Build briefs

One brief per rollout step. Each PR is based on `main`, says which requirement of this amendment it implements, and
pastes its evidence (AGENTS.md). **No brief runs the full suite or a deploy on the Pi:** tests run on the Mac, and the
Pi is heat-throttling. Browser checks run from the Mac against `tests/browser/preview.py`.

**For every brief.** AGENTS.md's rules apply and are not repeated in each: a plan doc in `docs/superpowers/plans/`
is the first PR of each step; both suites and the sprawl check are run on the Mac and their counts pasted; a PR that
changes anything under `hub/static` bumps `SHELL` in `hub/static/sw.js`; and a test that the change makes wrong is
changed in its own commit, with the reason in the PR.

No brief starts until A22 is approved and merged, with one exception: the parts of brief 1 marked "needs no
amendment" fix names the baseline already settled and may start at once.

### Brief 1: Quick wins

**What changes.** Names and leftovers that need no new machinery.

| Repo | Change |
|---|---|
| LocalAI | Check `lab-callers` (`/api/lab-callers`, `server.js:600`) for callers of the old lab API. It can only be read while the Assistant is running, and it has been down since 10 Nov; until it is back, this row waits and nothing is deleted on a guess. If none: delete `app/print-lab.js`, `app/display-lab.js`, `app/lab-callers.js`, their routes in `app/server.js`, and `tests/print-lab-ui.mjs`. If any: report who, and stop. (Needs no amendment: baseline D5.) |
| LocalAI | The seven label fixes of section 8: (1) Claude Code in the strip; (2) Atlas as the title; (3) In progress on the chip; (4) Decisions for Inbox; (5) Assistant settings; (6) Developer tools; (7) each tab's title is its own name, not its parent's (Sources, Memory, Library, Assistant automations). Section names Ask and Setup wait for brief 4. |
| LocalAI | Ship the four merged navigation PRs (#522 to #525) with `npm run ship`, once the failed update of 10 Nov is understood. This is the owner's call, not this brief's. |
| pi-hub | Titles become page names (2.3). Wall display, Settings (no "Setup" nameplate). `/privacy` gets a Site map row and a ⌘K entry. ⌘K's Assistant entry opens `/assistant`. The app's name in `manifest.webmanifest` becomes "Pi Hub", and the two `aria-label`s that read "Assistant (Local AI)" (`index.html:231`, `index.html:264`) become "Assistant". |
| print-lab | `lab page` help text no longer says the page is in Local AI. |
| appliance-ui | `tools.json`: `hub` is named "Pi Hub". |

**Done when.** No page's title is its area's name; the seven label fixes above are in; the old lab API answers 404
(once the Assistant is back and the caller check is clean); each of the eleven unlisted Assistant views is at least
in ⌘K, and `runs` still redirects to Work.

**Tested by.** pi-hub: a test that each route's title equals its strip label; `structure.mjs` on the Mac for the
rendered `h1`. LocalAI: its registry tests, plus one asserting `/api/lab/projects` is gone. Screenshots of Printer,
Health and Papers at 390 and 1440 px, light and dark.

**Not in this brief.** Areas, the page list, any move of a page.

### Brief 2: The page list and the shared frame

**What changes.**

| Repo | Change |
|---|---|
| appliance-ui | Add `pages.json` (3.2, 3.3), its schema test and `pages-words.test.mjs`. Update `tools.json` (3.4). Release. |
| pi-hub | Sync the kit. `routes.js`, the rail, the tab bar, the strips, ⌘K and `/map` are generated from `pages.json`. Five areas; Household (opening on Movies) and Network; `/more` redirects and `more.js` is deleted. `sections.js` and `system-strip.js` lose their own lists. Settings' groups become `ui-tabs`. `/scan` becomes a page with its "Open in" link (GET only; 3.3, section 10). The tests in 3.5. |
| pi-hub | Tests this makes wrong, each changed in its own commit: `tests/test_sections.mjs:28` (`/apps/scan` → `/documents`), `tests/test_nav_links.mjs:119` and `tests/test_home_cards.mjs:36` (the Scan link), and any test that lists the six areas or the More tab. |
| pi-hub | The strip's `nav` label, `aria-current` on the strip entry, the tab bar's `scroll-padding-bottom`, Home's badge name (9.1, 9.2). The skip link and the rail's label exist and are kept. |

**Done when.** A phone shows five tabs and no More; every page in 3.3's Pi Hub table opens from its strip, from ⌘K
and from the Site map; every alias in section 10 redirects; changing a `label` in `pages.json` changes the strip, the
title, ⌘K and the Site map together.

**Tested by.** The six `test_pages_*` tests. `tabbar.mjs` and the width sweep at 320 to 2560 px, three text sizes,
light and dark, on the Mac. axe with no serious or critical findings. Keyboard walk of 9.6, steps 1 to 5 and 8.

**Phones must not get worse.** Acceptance includes the owner opening Movies, Papers and Health on their own phone and
confirming none takes more taps than section 2.2 says.

### Brief 3: The shared values and the build check

**What changes.**

| Repo | Change |
|---|---|
| appliance-ui | The values in 1.3, with contrast rows where they carry text. `check/literals.mjs` and its tests. `ui-backbar`. Phrase keys `pc_waking` and the reworded `pc_off`. Release. |
| pi-hub | Sync. Commit `.kit-literals-baseline.json` at today's counts. Delete the alias layer (1.4) file by file, lowering the baseline in each PR. The check joins `node --test`. |
| LocalAI | Take the current kit. Load `tokens.css`. Commit its baseline and its allow list (the Agent World art files). Replace `--ds-*` and the rest with `--ui-*`, by section. Change `tests/appliance-ui.test.cjs:31` in its own commit. The check joins `local-ci.mjs`. |
| print-lab | Camera fit and the Fusion panel take a copy of the kit; `consumers.json` gains print-lab. |

**Done when.** Both apps load the same `tokens.css`; the Assistant has a light theme; no private name remains for a
kit value in either app; both baselines are lower than on the day they were committed, and the check fails on a PR
that adds a hex colour.

**Tested by.** `check/literals.mjs` on each repo (the output is pasted in the PR). The width sweep on pi-hub. LocalAI's
`design-system-ui.mjs` in both themes. Before and after screenshots of four pages per app; a visible change is a
finding to explain, since this brief should change no look on purpose except the Assistant's light theme.

**Order.** This brief is long. Its first PR in each repo (kit sync, baseline, check on) can land right after the kit
release; the clean-up PRs follow one file at a time and are never a gate for briefs 4 to 6.

### Brief 4: The Assistant becomes content only

**First task.** Send the "Coordination" section and section 2.5 to the session that owns LocalAI navigation, and
record its answer in this spec. If it objects to a name or a move, bring the objection to the owner before building.

**What changes**, one section per pair of PRs (LocalAI first, then pi-hub), in this order: Setup, Improve, Projects,
Work, Ask.

| Repo | Change, per section |
|---|---|
| LocalAI | When framed, stop drawing that section's page strip; answer `assistant-go`; keep its `h1` visually hidden; report its view as today. After the last section, stop drawing `#uxFramedStrip` and stop opening `.cmdk` when framed. Rename the sections Ask and Setup. `pages-registry.test.cjs`. |
| pi-hub | `/assistant/<path>` routes for that section from `pages.json`; draw its `ui-tabs`; send `assistant-go`; set the title from `assistant-route`. The banner states and wording (section 4, 8.4), with the Assistant button enabled. Bump `SHELL`. |

**Done when.** On every Assistant page inside Pi Hub there is exactly one menu, one title and one search, all Pi
Hub's; a reload reopens the same page; Back leaves the Assistant in one step (A4 requirement 7); with the PC asleep,
every Assistant address shows the banner and opens by itself when the PC wakes.

**On a phone.** The width sweep gains `/assistant/changes` and `/assistant` at 320 and 390 px, three text sizes: the
composer stays visible with the keyboard up, there is one scroller, and neither row clips a label (2.5's height
budget).

**Tested by.** LocalAI's framed-mode tests extended per section. pi-hub: route and message tests, including a
message from a wrong origin changing nothing (A4's security checks, rerun). Keyboard walk of 9.6 in full. VoiceOver
on an iPhone through one section. The banner: put the PC to sleep, open `/assistant/changes`, wake it, and watch the
page open with no reload; record it.

**Depends on.** Brief 2, and the **first PR of brief 3 in LocalAI** (the kit brought up to date and `tokens.css`
loaded): LocalAI is on kit 2.7.0, and `pages.json` arrives with the kit. It does not wait for the rest of brief 3,
but each section's content looks right only once that section's values are the kit's.

### Brief 5: Absorb

One PR per app, pi-hub only, each adding a section to an existing page (or, for Scan, a page).

| Order | App | Page | Calls | Owner-only writes |
|---|---|---|---|---|
| 1 | Backrest | Backups | 5.3 | Back up now |
| 2 | AdGuard | Internet | 5.3 | Ad blocking on or off (asks first when turning off) |
| 3 | Bambuddy | Printer, Quick Print | 5.3 | None new |
| 4 | Paperless | Papers | 5.3 | Add a paper |
| 5 | Healthchecks | Health | 5.3 | None |
| 6 | Scan | Scan | read `/api-docs` on the instance first; fill in 5.3 | Start a scan |
| 7 | Uptime Kuma | — | In order: (a) the owner stops and removes its container, which is defined in the **netmon** repo (`netmon/docker-compose.yml:101-103`), and says whether its history is kept; (b) a netmon PR removes it from the compose file; (c) a pi-hub PR removes its tool entry (`hub/static/ui/tools.js:17`, through the kit), `uptime_kuma_url` in `hub/sources.py:125`, its rows in `deploy/pi-lock.py` (lines 97 and 136), the `@status` host, and redirects `/status` to `/system`. Doing (c) before (a) would make the lock check report an unrecognised service | Stopping the container is the owner's action |
| 8 | Homebox | — | Remove from the Open in rows; keep it in the Site map under "No longer used" | Uninstalling waits for the owner |
| 9 | print-lab home | Print lab | Section 7: the `tools` record in `lab sync` (print-lab), the Designs and Lab tools tabs, the `tool_start` request (pi-hub) | Start camera fit |

**Done when.** Each everyday job in 5.2 can be done on its Pi Hub page without opening the app; each app is still
one tap away in "Open in"; a source that is down says so and never shows an empty list; Print lab's Lab tools tab shows
every piece in section 7, and "Start camera fit" works with the Mac awake and says so honestly with it asleep.

**Tested by.** For each app: unit tests against recorded responses from the real instance (never a guessed shape),
including the app being down, slow and returning an error. One manual check per write, by the owner. Keys are in
`/etc/pi-hub/secrets/` and appear in no log (checked with the redacted service log).

**Rule.** Printer control routes are not touched. Any change under `deploy/` cites section 6.3.

### Brief 6: Sign-in and the nightly check

**What changes.**

| Part | Change | Who |
|---|---|---|
| Bambuddy | Build A15 as approved | pi-hub PR |
| `hub_session` | Set `Secure` (6.3) | pi-hub PR, citing 6.3 |
| Paperless, AdGuard, Backrest, Homebridge | The settings in 6.2, one app at a time, each after its port is proven closed from another machine | **The owner**, or an agent with the owner's confirmation at the time. Not a PR |
| "asks for its own password" | Shown beside Cockpit and any app whose second login remains | pi-hub PR |
| `ui-backbar` | On the Assistant's own address, Camera fit and the Privacy note | LocalAI, print-lab, pi-hub PRs |
| Nightly screenshot check | Below | pi-hub PR, plus a LaunchAgent on the Mac |

**The nightly check.** It runs on the owner's **Mac**, not the Pi, from a LaunchAgent at night.

- It opens every page in `pages.json` at 390 and 1440 px, light and dark, signed in as the owner's own device, and
  compares each picture with the last accepted one.
- It opens each labelled app's first screen once, only to confirm it loads and whether it asks for a password. It
  does not compare their look, since A22 doesn't restyle them.
- A page that differs by more than a small threshold, fails to load, or shows "Loading…" after 10 s becomes one
  forwarded notice per page under A21's rules (keyed by source and topic, closed by the next clean run).
- When the Mac is asleep it doesn't run, and says so the next time it does. When the PC is asleep it checks the
  banner instead of the Assistant's pages and raises nothing.
- Accepting a new look is one command on the Mac that replaces the stored pictures for the pages named.

**Done when.** Opening Paperless, AdGuard, Backrest or Homebridge from Pi Hub asks for no second password; Bambuddy
asks for none, or for one tap on "Sign in with Pi Hub" if A15's Q1 rules out skipping its sign-in page;
Cockpit says it will ask; a deliberate one-pixel change to a page raises one notice the next morning and the next
clean run closes it.

**Tested by.** For each app whose login is turned off: `curl` to its raw port from the Mac is refused, before and
after. A15's own acceptance. The nightly check's comparison is unit-tested with two fixed pictures; its first three
real runs are read by the owner.

---

## Questions settled under O7

The owner asked for these to be settled by recommendation (O7). Each can still be changed before approval.

| # | Question | Settled as | Why |
|---|---|---|---|
| 1 | The fourth area's name | **Network** | Distinct from Home and Household on a phone bar, which is used many times a day. An imperfect fit for Lights and Weather costs less than three look-alike tabs |
| 2 | The page Household opens on | **Movies** | It keeps today's one-tap path to Movies on a phone. Papers is second in the strip and on screen without scrolling |
| 3 | Does Scan get a page | **Yes, one line and its link from brief 2; filled in by brief 5 only if the scanner app's own API allows it** | The strip is complete from the start, and nothing is built on an API nobody has read |
| 4 | A "Wake the PC" button | **Not in A22** | It needs a network change, which is the owner's to approve each time, and a design of its own. The banner says plainly that the PC must be woken by hand. It is the natural next amendment once brief 4 is accepted |
| 5 | Grafana charts on Internet | **Not in A22** | Internet gains ad blocking's numbers in brief 5. Charts are added later, one at a time, when the owner names one they open Grafana for |
| 6 | Uptime Kuma's history and public status page | **Not kept** | Pi Hub's Health and Alerts already keep the house's own history, and the outside alarm (Healthchecks.io) covers the Pi being down. The owner can export Kuma's data before stopping it in brief 5 if they want a copy |

## Still open

1. **The Assistant's two open filters** (Work's "Needs you" and "Missions"; Library as "Kept") stay with the
   navigation-depth spec.
2. **The Assistant session's answer** to "Coordination" and section 2.5, which brief 4 collects first.
3. **The owner's draft.** If `appliance-ui-cohesion-spec.md` turns up, it should be read against this spec before
   approval; anything it decided that this spec decided differently is the owner's to choose.

## Acceptance (for this amendment)

- The owner approved it on 11 Nov 2026 ("build it", then "merge 230").
- The `## Amendments` list in the baseline names A22, and sections 5.1, 5.2, 5.3, 5.6 and 9 point to it.
- Migration steps 11 to 16 are in section 11 of the baseline.
- The Assistant's session has seen "Coordination" and section 2.5, and its answer is recorded here.
