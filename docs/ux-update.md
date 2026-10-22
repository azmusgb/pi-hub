# Household usability updates

See [current status](status.md) for deployment and acceptance checks. The validation notes below are dated records.

## 21 October 2026

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


## 22 October 2026 — committed as `bfd3468`

- Route Home issues to the relevant symptom guide, preserve query context through navigation and browser history, and show breadcrumbs back to Home, Movies or More.
- Group favourite devices ahead of other controls and show favourites on Home. Empty device lists do not render stray null text.
- Show device-local unread-alert counts and active/paused 3D-print indicators in navigation. Opening Alerts marks its fetched history as seen on that browser.
- Keep small issue sets visible; put additional issues in an expandable section when there are more than two.
- Put movie requests and storage details in an expandable section that remains open across refreshes. Keep the print queue under expandable details and open it when waiting jobs appear.
- Require confirmation for Fix-it actions and retain the action outcome in Help after the transient toast disappears.
- Update the offline shell to v61 and include the new experience/navigation modules.

Validation: 73 Python tests and 3 JavaScript tests passed locally. Browser checks covered contextual help, phone/tablet/desktop layouts, the Devices empty state and movie-details refresh. Hardware responses for the last two checks were mocked. Pi diagnostics were unavailable on the local Mac; symptom guides remained usable. Full screen-reader validation, household acceptance and live deployment of this commit remain outstanding.


## 22 October 2026 — freshness and verified recovery

- Add source-response ages and retained display summaries with explicit current-state uncertainty. Source failures and missing setup are distinct from confirmed device failures.
- Add recovery progress, confirmed/unconfirmed results and a concrete next step after Plex/Homebridge restart or storage remount. Rechecking recovery never repeats the command.
- Keep action buttons guarded while recovery checks run, cancel follow-up checks on navigation, and retain action-specific messages for operations without a recovery probe.
- Advance the offline shell to v62 and include the freshness/recovery modules.

Local validation: 82 Python tests and 8 JavaScript tests pass. Mocked browser checks exercise a failed mount check followed by recovery, check-only retry without a POST, retained source summaries, and no horizontal overflow at 390px, 1024px and 1440px. These checks do not replace live Pi and household acceptance.


## 22 October 2026 — live deployment

Deployed application commit `0dbc712a85`. The Pi's Python/JavaScript tests and release gate passed; the full operational self-check passed 37/37 checks. Live browser validation confirmed source-response rendering, authentication on the recovery-check endpoint, no horizontal overflow at 390px/1024px/1440px and no console errors. Six sources were current; Calendar was not configured. This deployment did not perform a live recovery action or a physical printing/playback/device-control test.
