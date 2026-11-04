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

## N4. Plex opens in Plex's own web app (plex, revised 4 Nov 2026)

Decision `plex` changed from "a gated name" to "app.plex.tv", on the same day, before anything was deployed. Why:

- The gate makes Open Plex and every poster-to-movie link owner-only. The household would lose the links they use today. That is a regression, not a cleanup.
- Port 32400 stays open on the LAN for the TVs and phones' Plex apps either way, so the gate would protect nothing.
- A gated name needs a manual "Custom server access URL" setting in Plex, to be reached from outside the house. That is a step nobody has done and nobody wants to own.

What N4 does instead:

- No Caddyfile block and no `gate-check.sh` name. A test says Caddy serves no Plex name.
- Plex stays in the registry, as an outside tool: `host` `app.plex.tv`, `base` `/desktop`, `external` true (appliance-ui kit 2.3.0, PR #6). It still shows in ⌘K, the Site map and Media's "Open in" row.
- Media's Open in Plex goes to `https://app.plex.tv/desktop`. A movie's link is `https://app.plex.tv/desktop/#!/server/<machineIdentifier>/details?key=/library/metadata/<ratingKey>`; the hub already returns the server's id as `machine` in `/api/movies`. With no id, the link is the front door.
- Posters stay on the hub's own `/api/plex/thumb`. No raw `:32400` link is left, so the port-link guard has no Plex exemption.

Stacks on N3 (Media and the registry).

## Not in these PRs

Decision `printlab` (Local AI's code) and the Local AI link fixes listed in A6.
