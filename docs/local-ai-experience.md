# Local AI experience — Pi Hub

Pi Hub is the home and workshop workspace within Local AI Engineering Command Center.
This first implementation establishes the shared shell across Pi Hub pages.

## Experience contract

- Solution identity: Local AI / Engineering Command Center in the desktop rail.
- Workspace identity: Pi Hub remains visible above every normal page, including mobile.
- Command Center opens the existing Local AI root using the established `toolUrl` resolver.
- Assistant retains its existing page-and-facts handoff, availability checks and labels.
- Pi Hub search remains local to Pi Hub; its label makes that scope explicit.
- Page titles use `Page · Pi Hub · Local AI` for browser history and tabs.
- Figtree, blue accents, surfaces and status colours come from the existing appliance UI kit,
  already aligned with the Local AI design tokens. Light, dark and automatic theme choices remain intact.
- The new stylesheet changes shell presentation only. Wall mode hides the workspace bar.
- Offline navigation caches the new stylesheet with shell version v113; live API data remains uncached.

## Boundaries

Repositories, authentication, hardware controls, data ownership and release states remain separate.
The workspace bar is navigation, not a claim that Local AI is reachable or healthy.
No cross-origin theme synchronization or single sign-on is introduced.
The return destination uses the existing Local AI address; no new host or deployment is assumed.

## Validation

The existing 13 section/navigation/Assistant tests pass. JavaScript syntax checks pass for
main.js and sw.js. A static local preview server could not bind under the execution sandbox,
so browser layout and live Pi acceptance are outstanding.

Before promotion, check desktop, 860px tablet, 390px phone and 480×320 landscape layouts:

1. Switch between all six sections and child pages; confirm titles and active navigation.
2. Tab to Command Center and search; confirm visible focus and normal keyboard activation.
3. Confirm Command Center resolves on home.arpa and direct-IP entry points.
4. Confirm Assistant still carries page context and reports the PC-off state.
5. Test light/dark/auto, reduced motion, offline shell reload and reconnect.
6. Confirm wall mode has no workspace bar, and printer guards behave as before.

## Next integration

Add the reciprocal Pi Hub workspace entry to Local AI in a separate repository change.
Then align page-level summary/attention/detail patterns with the Command Center, preserving
household tasks and honest freshness states. Avoid replacing household navigation with
engineering-only categories or implying shared health across independently deployed apps.
