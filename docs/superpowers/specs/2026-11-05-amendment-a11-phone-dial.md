# Amendment A11: Home's day is a dial where the band can't show the whole day

Date: 2026-11-05 · Status: **proposed** (owner, 5 Nov 2026: "Just not a fan. Hoping it can look better. Maybe iPhone
gets a different view/widget/dashboard?!", then chose option B, "Day dial", from the prototype) · Amends: A8 D1 (the
band as the hero) and D3 (the rack's rows), A9 D1 (the phone's span), and A10 D4 (the band's span rule and "names go
above"), for Home only.

Prototype: https://claude.ai/artifact/FHK9iYtc9hzbJZsahWcmiH (option B), with the evening of 5 Nov 2026.

## Why

After A10's shell shipped (b87f109), the owner looked at Home on the iPhone at 11:40 PM:

1. **The band is long and thin on a phone.** With names above the tracks, each lane takes a name line and a bar, so
   four of the five lanes fill the first screen and the counts, the band and the first need never show together.
2. **A shortened day hides the morning.** A9's span (midnight to an hour after Now) keeps marks readable but drops
   the hours after Now and, early in the day, everything but six hours. A10 D4 keeps that rule as a measure.
3. **A phone's space is square, the band is wide.** At 390 px a full day has about 13 px an hour along a line, but a
   circle of the same width has about 3.3 times that along its outer ring.

The owner asked for a different view on the iPhone and chose the dial over a widget grid and a timeline list.

## Decisions

**D1 Where the band can't show the whole day, Home draws the day as a dial.** The switch is A10 D4's own measure, not
a device: when the band, with lane names beside its tracks, would give an hour less than about 24 px, Home draws the
dial instead of a shortened band. In practice that is a phone, and a narrow window on anything else. The decision is
made from Home's own width (A10 D2), and it is the same data (`/api/today`), the same marks and the same words.

**D2 The dial.**

- **Geometry:** 24 hours clockwise, midnight at the top, one ring per lane, inside to outside in A8's lane order
  (X2D, Workshop display, Raspberry Pi, Backups, Updates). Hour ticks every hour, labelled at 12a, 6a, 12p and 6p.
- **Now:** a hand from the centre to the outer ring. The hours still to come are hatched on every ring, as on the
  band.
- **Centre:** the time and the day's headline counts in words ("3 done, 2 failed").
- **Marks:** spans are arcs and points short arcs, in the band's colours (`ok`, `bad`, `warn`, `run`, deployed). A
  running print draws to Now with its remaining time as a dashed arc, as on the band.
- **Lane names:** a key under the dial names each ring in order, inside to outside.
- **Size:** the dial fills the width of its card, up to about 22 rem across, and its rings and type scale with it
  (A10 D1).

**D3 Pointing at a mark works as on the band.** Tapping, pointing at or tabbing to a mark writes "lane: what, when"
in the line under the dial (A8 D1). Every mark is reachable by keyboard in time order, and each has a hit area at
least 44 × 44 px, however short its arc; where two hit areas overlap, a tap takes the nearer mark. A need with a mark
today lights it, as A8 D2 does on the band.

**D4 Honest states on the dial.** A lane whose source didn't answer draws its ring dashed and empty, and the key says
`source_down`'s words for it (A8 D6). A quiet day is empty rings and zero counts. Loading is a kit skeleton circle.

**D5 The four counts sit under the dial, and the rack becomes compact rows.** Where the dial is drawn, the rack's
rows show lamp, name, the state in words and one reading (the X2D's state or progress, the Pi's temperature, the
network's state, free space, prints this week), with the row's link. The full readings stay one tap away on each
row's page. Needs you stays between the dial and the rows, in A8's order.

**D6 Where the band fits, nothing changes.** On an iPad, the Mac and the TV, Home is A8 as amended by A10 D4: the
band with the whole day, names beside the tracks.

## Model rejected

- **A. Glance (widgets):** one verdict sentence, the day as one merged strip, systems as two-column tiles. Rejected by
  the owner; the merged strip also loses which system each mark belongs to.
- **C. The day as a list:** systems as chips, the day as a timeline newest first. Rejected by the owner; it drops the
  shape of the day.
- **A separate phone page or app:** a second Home to keep in step. The dial is the same page and data, drawn for the
  space it has.

## Not changed

Home's content and order (A8: the day, Needs you, Systems), the data (`/api/today`, `/api/now`, `/api/needs`), the
words, the kit's colours and tokens, the shell (rail and tab bar), the wall display's board, and every other page.

## Delivery

One Pi Hub PR, in the A10 plan's P4 (Home), which this amendment extends: the dial with tests (geometry, hit areas,
keyboard order, honest states, the switch measure), the compact rows, the sweep for `/` passing at every width, and
screenshots at 320, 390 and 430 px, dark and light, with axe over Home.
