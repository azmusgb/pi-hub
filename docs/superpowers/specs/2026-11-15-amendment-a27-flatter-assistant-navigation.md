# Amendment A27: Flatter Assistant Navigation and IA (Two-Level Cap)

Amends A22 ("One site") sections 2.2, 2.5, 3.2, and 3.3.

## Context and Problem

A22 established "One site": Pi Hub provides the surrounding frame, menu, strip, and palette, with Assistant views framed beneath. However, Assistant navigation suffered from severe nesting and redundant tab surfaces:
1. **Four levels of depth:** `Setup › Assistant status › Developer tools › [Files | Repository | PowerShell | Browser | n8n]`.
2. **Tab proliferation:** Up to 28 section, tab, and detail entries across 5 sections (Ask, Work, Projects, Improve, Setup).
3. **Admin leakage:** Appliance maintenance (Status, Models, Tools, Settings, Audit log) was housed inside the Assistant workspace rather than Pi Hub's central `System` area.
4. **Filters as pages:** Lifecycle stages (`Backlog`, `In progress`, `Shipped`) were rendered as distinct strip pages rather than filters on one list.
5. **Orphaned views (C5):** Twelve views sat outside any primary navigation strip, reachable only via ⌘K or direct URL.

## Decisions

### D1. Maximum Depth: Two Levels (`Section › Page`)
No navigation path in the Assistant or Pi Hub exceeds two visual levels.
- Sub-tab rows beneath tabs are eliminated.
- **Developer tools** becomes a single page containing an overview card grid (`.tool-cards` using `ui-card`), replacing five independent sub-tabs.
- Each tool opens in place with a visible, accessible return link (`← Developer tools`) positioned above the tool header.

### D2. Filters Instead of Navigation Tabs
Related states on a single entity type must use in-page filters or segmented chips, not navigation routes:
- `Changes` stages (`Backlog`, `In progress`, `Shipped`) merge into one `Changes` backlog view with stage filters.
- `Signals` (system anomalies) and `Claude Code` (coding runs) merge into a single **Activity** page.
- `Atlas` remains an independent system architecture view.

### D3. Move Setup into System Area
Admin and appliance maintenance surfaces are relocated out of Assistant and into Pi Hub's `System` area:
- The `Setup` section is removed from the Assistant's section strip.
- Status, Models, Developer Tools, Assistant Settings, and Audit Log move under Pi Hub `System` (e.g. `/system/assistant` or child tabs of `Health`).
- Assistant is left with exactly four operational sections: **Ask**, **Work**, **Projects**, and **Improve**.

### D4. Assistant Home with Pinned, Recent, and Promoted ⌘K
The `/assistant` landing prioritizes active and recurrent workflows:
- Pinned projects and recent Claude/agent runs appear at the top.
- The ⌘K palette is promoted as the primary fast-switcher for deep entities, handling long-tail routing without cluttering top-level menus.

### D5. Disposition of the 12 Un-stripped Views (C5)
Every view previously lacking an entry point is assigned a home or retired:
1. `tools-files` → Card on Developer Tools page.
2. `tools-repository` → Card on Developer Tools page.
3. `tools-powershell` → Card on Developer Tools page.
4. `tools-browser` → Card on Developer Tools page.
5. `tools-n8n` → Card on Developer Tools page.
6. `run` (`/assistant/run/<id>`) → Reached from Work cards and Activity list.
7. `camera-fit` → Reached from Lab tools card.
8. `chat` → Ask action / mode.
9. `image` → Ask action / mode.
10. `decisions` → Filter / sub-view on Ask or Activity.
11. `library` → Projects subsection.
12. `runs` (alias) → Formalized as redirect to Work.

## Non-goals
- Changing backend API contracts or LocalAI model serving pipelines.
- Redesigning tool execution sandboxes or PowerShell security gating.
- Re-architecting Pi Hub's 5 core area rails.

## Evidence Required
1. `pages.json` updated with no navigation hierarchy exceeding depth 2; total Assistant strip + tab entries reduced from ~28 to ~14.
2. Visual screenshots across phone (390px), tablet (820px), and desktop (1440px) proving Developer Tools card grid and return navigation.
3. Automated route/navigation checks in `tests/browser/` and `verify.mjs` verifying all routes resolve and zero console errors occur.
