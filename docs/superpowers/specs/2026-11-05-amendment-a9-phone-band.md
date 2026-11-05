# Amendment A9: Home's Today band on a phone shows the day so far

Date: 2026-11-05 · Status: **approved by the owner on 5 Nov 2026** ("Squished on phone"; chose "So far only") ·
Amends: A8 (`2026-11-05-amendment-a8-home-dashboard.md`), D1 (the band's span) and D5 (the phone and TV rows of the
layout table), for Home only.

## Why

A8 shipped on 5 Nov 2026 (d801c05). On the owner's iPhone the band was "squished":

1. **The day doesn't fit.** Midnight to midnight in about 320 px is 13 px an hour. That afternoon's three prints, finished
   and failed, ran together into one block, and the display's two offline spans touched.
2. **A quarter of the width was empty.** At 6 PM the hatched hours still to come took the band's right quarter, where
   nothing can be drawn yet.
3. **Two count labels wrapped** ("prints finished", "updates shipped"), so the four counts no longer read as one row.

Measured at 390 px against the live hub, and seen in the owner's screenshots (IMG_1553, IMG_1554).

Also recorded here: A8 D5's TV row asked for 1.6× at 2560 px and 2.4× at 3840 px. In P2's browser check that scaling
narrowed the band to 267 px, because the shell holds the page to 1440 px and a zoom inside it only shrinks Home's own
layout. P2 shipped 1.2× only (#126). This amendment makes the spec match what is right, rather than leaving the drift.

## Decisions

**D1 On a phone, the band runs from midnight to just after Now.** When the band is narrower than 520 px (a phone; it is
drawn at its own pixel width, A8 D5), its right edge is one hour after Now, and never less than six hours after
midnight, so a band seen at 1 AM is not a sliver. It never runs past the next midnight. The hour still to come stays
hatched, so Now still reads as now and not as the end of the day. Hour labels space themselves to the hours shown.
Wider bands keep midnight to midnight.

Model rejected: scrolling a 24-hour band sideways, starting at Now. It keeps every hour at a readable scale, but the
prototype tried it and lost the lane names, and the owner chose the day so far.

**D2 On a phone, the counts keep one row of four with short labels:** finished, failed, power dips, updates. Each count
still reads in full to a screen reader ("3 prints finished").

**D3 The TV scales once.** A landscape screen 1800 px or wider gets two columns at 1.2×. Wider screens keep 1.2× until
the shell itself scales, which is outside Home.

## Not changed

Everything else in A8, including the sweep of the Now line on first load (D1), which is still owed and lands with this
amendment's code. `/api/today` is unchanged: the phone's span is drawn from the same day.

## Delivery

One Pi Hub PR after this merges: the band's span and labels on a phone, the short count labels, the Now sweep, with
tests, checked in the browser at 320, 375, 390 and 430 px against the live hub.
