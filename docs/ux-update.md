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


## Navigation and layout follow-up

Implemented the next recommendations:

- One shared order for household destinations: Home, Movies, Devices, Lists, Print, Workshop and Weather. The phone keeps Home, Movies, Devices, Lists and More on one row.
- Everyday and Maintenance groups on desktop and in More. Maintenance contains Help & system, Alerts, Automations and Settings.
- Keep tablet navigation labels visible at 861–1180px. Every navigation item retains an accessible label and tooltip.
- Rename Overview to Home, Control to Devices and Rules to Automations throughout user-facing navigation and forms. Existing URLs remain valid.
- Movie storage is reached from Movies and Help. It highlights Movies, rather than both Movies and More, in phone navigation.
- Home reads in this order: attention items, everyday actions, active 3D print, device status, weather/setup context, then Ask. Avoid repeating the same warning in a large greeting card.
- Help starts with expandable guides for movies, lights, document printing and Workshop. These remain usable if diagnostics are unavailable. Charts and restart controls live under System checks & advanced fixes; opening a guide never triggers an action.
- Reduce background texture and filled gold maintenance buttons; keep emphasis on selected navigation and primary tasks.

Recommendations to revisit after household use: observe which three tasks people perform most often before adding personal shortcuts; test the symptom guides with someone unfamiliar with the Pi; extend the same task-first pattern to pages where real use reveals friction. Full screen-reader validation remains outstanding.

Follow-up validation: all 68 Python tests pass. Browser checks confirm the Home/Movies/Devices/Lists/More order on a single row at 390px, no horizontal overflow, labeled navigation at 1024px, grouped More links, expandable symptom guides, and preserved movie-storage URLs. The diagnostic controls remain behind the existing PIN and confirmation flow.
