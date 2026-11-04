# Navigation cleanup — Plan

Date: 2026-11-04 · Status: approved; all 12 decisions as written (owner, "fix all", 4 Nov 2026) · Baseline: `2026-11-01-platform-product-architecture-design.md` + amendment A6 (`2026-11-04-amendment-a6-navigation-cleanup.md`)

**Goal:** every page is reachable from a visible strip, each thing has one name, no link points at a raw port or a retired name,
and no page has more than six sections on first view.

Every PR is tests first, bumps the `sw.js` cache version, and is checked at 390 px and 1366 px (no horizontal scroll; strips and
focus reachable by keyboard).

## N1. Broken and duplicate links (decisions tools-once, names; "broken links fixed")

- Workshop's Bambuddy links and Health's Cockpit link use the registry address, paths kept.
- `versions.js` and `notify_routes.py` use current names; `notify_routes` still accepts the old click hosts and accepts `assistant.rahe-home.duckdns.org`.
- `/movies` and `/control` leave `sections.js`. Duplicate tool links within a page go; the "Open in ↗" row stays. "Print Lab v3" becomes "Print lab".
- A guard test: no static JS builds a `piLink(` port link or a `.home.arpa` href (the D4 display paths are allowed).

## N2. Strips on every area, and names (strips, network-split, weather, lists, drives, names, sitemap's nav entry)

- `system-strip.js` generalised: Documents, Media, Home & network and System strips.
- `/devices` and `/network` split; `/weather` joins the Home & network strip; old links keep working.
- "Drives", "Movies drive", "Pi disks"; rail, ⌘K, More, `routes.js` and section tables use one name.

Stacks on N1 (same files).

## N3. Page sizes and the site map (health, settings, sitemap)

- Health: six sections, rest in a collapsed "More" (`<details>`, remembered). Media: six plus More.
- Settings: six groups as a strip, one per screen.
- `/map`: every area, page and tool, generated from `routes.js` and the registry; a test proves nothing is missing.

Stacks on N2.

## N4. Plex behind the gate (plex)

- `deploy/caddy/Caddyfile`: `plex.rahe-home.duckdns.org` to `127.0.0.1:32400`, behind the gate, like the other tool blocks.
- Plex in the registry (and appliance-ui's `tools.json` if it needs the same row); Media's links and posters use it; the deploy's gate test covers the host.

Stacks on N3 (Media and the registry).

## Not in these PRs

Decision `printlab` (Local AI's code) and the Local AI link fixes listed in A6.
