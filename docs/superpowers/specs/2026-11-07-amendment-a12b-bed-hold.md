# Amendment A12b: Start may wait for the bed to cool

Date: 2026-11-07 · Status: **approved** 7 November 2026 (pi-hub #162) · Amends: A12 D-S5 (print-lab spec
S5, "any miss shows the reason and leaves the Start button disabled") for one reason only, the bed temperature.

## Why

The owner finishes a print, removes the part, and wants the next lab print to begin as soon as the bed is cool, without
standing at the phone. Today the sheet refuses while the bed is 35 °C or warmer and the owner must tap again. After a
50-minute PLA print the bed takes about 20 minutes to fall from 55 °C to 35 °C.

## Decisions

**H1 Only the bed can be waited for.** If the bed temperature is the only thing S5 refuses, Start may be tapped as
"Start when the bed is cool". Any other refusal (printer busy or in error, build not staged, file gone, Bambuddy not
the proven version) is refused at the tap exactly as before.

**H2 The tap still carries both ticks.** The two ticks ("The plate is clear and dry", "The filament matches") are sent
with the tap. The owner is saying the plate is clear now, and the part is already off while the bed cools.

**H3 Everything is checked again when the bed is cool.** Pi Hub holds the request in memory and checks S5 from scratch
every 10 seconds: the same refusals, the staged build still the same sha256, and the library file still the one the lab
checked (S3). It sends only when the list is empty. If anything other than the bed refuses, or the staged build
changed, the hold is cancelled and the reason is shown; nothing is sent.

**H4 One hold, 45 minutes, owner-cancellable.** There is at most one hold. It ends after 45 minutes, sent or not, so a
forgotten tap can't start a print hours later. The sheet shows the hold and a Cancel button; cancelling is owner only
and logged.

**H5 A restart drops the hold (fail closed).** The hold lives in Pi Hub's memory, not the database. A deploy or restart
cancels it, the sheet then shows no hold, and the owner taps again. This trades convenience for never starting a print
on a plate no one has looked at since an unplanned restart.

**H6 The start is recorded when it is sent, not when it was tapped.** The one-tap record (S6) carries the send time as
the tap time, so the run starts when the printer starts. `action_log` records three rows: held, then sent, cancelled
or expired.

## What does not change

Owner only, the two ticks, S3's sha256 proof, the manual-start queue item, one printer command at a time, and no
Start in the palette or in notifications. A12's D1 writes to Bambuddy are the same two.

## Acceptance

One real lab print tapped while the bed is warm, started by the hub once the bed is below 35 °C, with the owner
present, and its `action_log` rows (held, sent) shown.
