# Household usability update — 21 October 2026

- Unify navigation breakpoints in app.css: a single bottom row on phones, a compact rail on tablets, a labeled rail on desktop.
- Keep list forms full width, place reminder controls on their own row, improve empty-state wording, and support arrow keys/Home/End in list tabs.
- Keep keyboard labels on compact navigation and restore keyboard access to file selection.
- Prioritize everyday tasks, device status and recovery ahead of Ask. Hide Ask when local AI is unavailable.
- Explain service failures in household terms, link alerts to recovery, and distinguish unavailable telemetry from confirmed device failures.
- Show initial loading, visible errors, Retry and automatic recovery. Track freshness separately for each page and ignore requests from departed pages.
- Show printer status before upload; require a valid file and available printer before enabling Print. Read-only API requests time out after 30 seconds, with 150 seconds for drive scans.
- Link printer, display and AI alerts to Workshop, and storage alerts to Drives. Restore health-chart line and area styling.
- Improve secondary text/placeholder contrast and keep system cards within narrow screens.
- Advance the offline shell cache to v59.

Validation: 68 Python tests pass. Browser checks cover desktop list creation/completion, phone list/reminder reflow, single-row navigation at 390px and 820px, compact navigation at 1024px, keyboard tab switching, missing-service errors/retry, and unavailable-printer feedback. Test entries exist only in an isolated temporary local database. Deployment uses the Pi’s test-and-rollback release hook; live verification confirms the recovery page loads, the printer reports Ready, valid file selection enables Print, and invalid file selection disables it. No print job was submitted.
