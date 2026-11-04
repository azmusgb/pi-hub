# Amendment A6: Navigation cleanup

Date: 2026-11-04 · Status: **approved by the owner on 4 Nov 2026 ("fix all")**: all 12 decisions below, as written, plus the broken-link fixes · Amends: the platform baseline
(`2026-11-01-platform-product-architecture-design.md`, section 5.1 and 5.2 (level-2 strips), 5.3 (tools once, from the registry),
5.6 (route mapping), section 9 (terminology) and section 12's gate decisions for the `plex.` host).

## Why

The 4 Nov 2026 navigation inventory found 23 problems across Pi Hub, the Assistant and the tools: six dead or stale links,
five names for the same thing, pages with up to 13 sections, and three areas (Documents, Media, Home & network) that hide their
sub-pages because they have no strip. The owner reviewed the proposed layout (the "Home site map") and approved it.

## Broken links fixed (not a decision; fixed whatever is decided)

| Link | Today | Becomes |
|---|---|---|
| Workshop's spool and project links | `http://<host>:8000/<path>` | `bambuddy.rahe-home.duckdns.org/<path>` (paths kept) |
| Health's "More in Cockpit" | `https://<host>:9090/system/services` | `pi.rahe-home.duckdns.org/system/services` |
| Versions' "Architecture at this commit" | `localai.home.arpa` | `assistant.rahe-home.duckdns.org` |
| Phone-notice tap link | click host `localai.home.arpa` | Pi Hub also accepts `assistant.rahe-home.duckdns.org`; the old click hosts stay accepted for notices already sent |
| `/movies` and `/control` in the section tables | listed as pages | removed (they stay redirects) |
| Pi Hub's "Print Lab v3" card | old name | "Print lab" |
| Plex | raw `:32400` | see decision `plex` |

Out of scope here, because the files are in other repos: Local AI's own `hub-notify.js` default host, its Bambuddy link,
its `/go/n8n` and `/go/comfy` host handling (inventory 6c, 6d and 16). They are reported, not changed, by this amendment.

## Decisions (all approved 4 Nov 2026)

1. **strips.** Every area gets a page strip, so no page is hidden. Documents: Papers | Print | Lists. Media: Movies | Drives.
   Home & network: Devices | Network | Weather. System adds Site map.
2. **network-split.** Home & network splits into `/devices` and `/network`. The old `/network` address keeps working (it is the
   Network page); links that meant devices go to `/devices`.
3. **weather.** Weather sits under Home & network (`/weather`, in its strip).
4. **lists.** Lists (shopping, to-dos, notes) stays under Documents.
5. **drives.** The `/drives` page is named "Drives" everywhere; Media's card becomes "Movies drive"; Health's card becomes "Pi disks".
6. **settings.** Settings stays in System; its six groups become a strip of their own, one group per screen.
7. **health.** Health shows at most six sections; the rest fold into a collapsed "More". Media keeps at most six sections plus More.
8. **plex.** Plex gets a gated address, `plex.rahe-home.duckdns.org` (Caddy to `127.0.0.1:32400`, behind the front gate), joins the
   tool registry, ⌘K and Media's tools; Media's links and posters use it. This is the baseline decision that allows the
   `deploy/caddy/Caddyfile` change.
9. **printlab.** Print lab is removed from the Assistant entirely; it lives only in Workshop. **Not in this repo's PRs**: the code is
   Local AI's, so it needs its own plan there (the baseline already retires `printLab`, section 5.6). Recorded so it is not lost.
10. **names.** Tools keep their product names everywhere (Uptime Kuma, Grafana, Backrest, Homebridge); pages keep plain words.
11. **sitemap.** System gains Site map (`/map`), generated from `routes.js` and the tool registry, and in ⌘K.
12. **tools-once.** Each tool is linked once per page, in the "Open in ↗" row at the bottom.

## Delivery

Plan: `docs/superpowers/plans/2026-11-04-navigation-cleanup.md`, PRs N1 to N4. Decision 9 is a Local AI task and has no PR here.
