# Movie nights, Workshop projects and explainable automations

These features extend Movies, Workshop and Automations. There are no additional top-level destinations and no external AI dependency.

## Movie night

Open **Movies → Movie night**. Add contenders from the unwatched suggestions, or use **Add to Movie night** on a movie in library search results. Vote for the films you would enjoy, and use **Choose for tonight** to select a shared pick. The watch link opens Plex; it does not start playback automatically.

- **Time available** filters suggestions to films with a known runtime that fits. **Family-friendly ratings** limits suggestions to the listed family-oriented ratings. This is a discovery filter, not parental access control or a guarantee of suitability.
- Each suggestion explains its fit. Filters affect suggestions; existing shortlist entries remain visible with their votes.
- A named person's PIN identifies their votes across devices. Owner/shared household PIN sessions vote per signed-in browser session. Repeated clicks or retries do not add duplicate votes. Each identity can vote for several films and withdraw its own votes.
- Children can nominate and vote. Adults and the owner choose the shared pick or remove a nominee and its votes.
- The shortlist holds up to 12 films. Its stored titles, votes and selected pick remain available when Plex is temporarily unreachable. This does not establish current playback availability.
- The selected film and votes remain until changed or removed; the shortlist does not reset at midnight.

Data lives in SQLite tables `movie_shortlist`, `movie_votes` and `movie_night_choice`. Session tokens are not returned in poll responses or stored as plaintext vote identities.

## Workshop projects and filament (Bambuddy since 24 October 2026)

Spools and projects live in **Bambuddy** (Docker on the Pi, `http://pi.local:8000`), not in the hub. Bambuddy is connected to the X2D, so it takes each print's filament off its spool by itself; it also has the project parts lists, the print queue and the 3MF archive. One list replaces the hub's own filament shelf and project board, which were empty when they were retired.

The Workshop page reads both from Bambuddy and links there to change anything:

- **Projects:** the active (not archived) projects, with how many prints each has, linking to the project in Bambuddy.
- **Filament:** each active spool with its colour, material, brand and what's left ("not weighed" until Bambuddy has a reading: a print, a scale weight or an AMS tray).
- **Low filament:** a spool counts as low under its own Bambuddy threshold, or 15% of its label weight. A spool that newly turns low fires `filament_low` (default rule: phone alert).

When Bambuddy doesn't answer, Workshop says so instead of showing an empty shelf. `hub/bambuddy.py` is the only code that talks to it (`HUB_BAMBUDDY_URL`, default `http://127.0.0.1:8000`); it never writes.

The old `spools`, `projects` and `project_files` tables are left in the database, unused. The nightly backup still copies any files in `/var/lib/pi-hub/project-files` that `project_files` refers to.

### Backups and restore verification

The backup script holds a SQLite writer lock while taking a consistent database backup and copying its referenced project files. It archives the staged snapshot afterward. Incomplete uploads are omitted, and a missing referenced file or an archive error prevents publishing a new backup.

New archives contain `hub.db` and `var/lib/pi-hub/project-files/` alongside the selected Pi settings. Existing backup transfer and retention continue to apply. During an isolated restore drill, check both the restored project rows and their model bytes. Restoring just the database is insufficient for attachments. A production restore must also restore file ownership/access for the `pi-hub` service.

The tables are additive. Older releases can ignore them, but their older backup scripts may not include model files. Application rollback does not roll back household data.

## Automation preview and history

Use **Automations → Build an automation → Preview safely** or a saved rule's **Preview** button. Preview does not enable a rule, run a helper action, switch a device, send a notification, or add a real run to history.

The preview evaluates up to the latest 100 matching events within the last 30 days. It applies **current settings and current accessory availability** at each recorded event time. It is a simulation, not a reconstruction of historical configuration. With no matching events, only the hypothetical “if it happened now” decision is shown.

Decisions explain disabled rules, quiet hours, missing phone-alert configuration and unavailable accessories. Official weather-warning notifications retain their quiet-hours bypass. **Add & enable** explicitly saves an enabled rule; previewing alone never saves it. Adults/owner manage and preview rules.

Real matching events write durable outcomes to `rule_runs`:

| Outcome | Meaning |
|---|---|
| Completed | The action returned success; physical playback/device behaviour may still need checking. |
| Failed | The action or notification returned an error. |
| Blocked | A required accessory was unavailable. |
| Skipped | The rule was disabled, or a nonurgent phone notification was held for quiet hours. |
| No completion recorded | Execution began but no completion was persisted, for example after a process interruption. |

History shows the latest 60 outcomes within 30 days, offers a **Needs a look** filter and keeps the rule description if the rule is deleted. Earlier releases' executions are not backfilled. No automatic retry of a failed action is introduced.

Unknown/missing telemetry does not count as a drive dropout, stopped service, PC recovery or completed print. Changes still need the existing steady-state checks before triggering automations.

## Validation

An isolated demo database is used for browser testing. No sample votes, projects, files, rules or events are seeded into the household database by installation or deployment.

Tests cover preview side effects, quiet hours and urgent bypass, history outcomes, vote deduplication and filtering, role checks, project estimates, attachment upload/download and cleanup, quota failures, consistent backup contents, unknown telemetry, and parallel first-request schema initialization. Browser checks cover the complete nomination/vote/pick flow, project creation/stage changes/file round trips, unsaved draft retention, and rule preview/history filters.
