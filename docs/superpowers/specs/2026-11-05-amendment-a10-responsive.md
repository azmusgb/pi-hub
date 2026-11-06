# Amendment A10: Responsive, not adaptive

Date: 2026-11-05 · Status: **proposed** (owner, 5 Nov 2026: "use Responsive Design not adaptive -- for full site") ·
Amends: the platform baseline's page rules as restated in A6 and A7 (layout by named widths), A8 D5 and A9 (Home's size
table, the phone switch and the TV zoom), and the appliance-ui design contract (`DESIGN.md`: Type, Space and shape,
Navigation's "Layouts adapt to the width", and "Before a screen is done"), for every Pi Hub page.

## Why

After A9 shipped, the owner looked at Home on the iPad and the iPhone and called both "squished", then asked for
responsive design across the whole site. Measured on `main` (1cfcc26), 5 Nov 2026:

1. **The site is a set of fixed layouts.** Its 18 stylesheets switch at more than 30 different widths (420 px to
   1800 px; the most common are 860, 640 and 600). Between two switches nothing changes, so a screen just above a switch
   gets the cramped end of one layout. An iPad is laid out as a narrow desktop.
2. **Type and space don't scale.** The kit's type scale is fixed (`fs1`–`fs7`: 12–34 px), and so is its 4 px space
   step. A 13 px label is the same on a 390 px phone and on a 1366 px iPad, so a larger screen only adds empty space
   around the same small type.
3. **The page stops at a fixed width.** Pages cap at 1120 px until the window is 1680 px wide, then at 1440 px
   (`pages.css`). With the rail beside it, an iPad in landscape gets a page narrower than a laptop's, and Home's two
   columns split that width 4 : 8, so Needs you gets about 280 px.
4. **Home switches instead of flowing.** The band changes its whole layout at 520 px (A9), the two columns appear at a
   1000 px window whatever the space really is, and the TV is a 1.2× zoom inside the fixed page (A9 D3).

## Decisions

**D1 Type and space scale with the screen.** The kit's type steps and its space step become fluid. Each grows smoothly
from its size on a 360 px phone to about 1.25 times that on a 1920 px screen (CSS `clamp()` against the viewport), and
stops there. The floors stay what they are today, so nothing gets smaller on a phone, and `fs1` stays the floor for
meta lines. The readout sizes scale the same way. This is a kit change (`tokens.json`, built to `tokens.css` and
`tokens.h`), made in appliance-ui and synced, never set per page. Contrast is unchanged: no colour moves.

**D2 Layout flows from the content, not from named devices.** A grid sets its columns by the smallest width its
content can live with (`repeat(auto-fit, minmax(…))`, `fr`, `ch`, `min()`), and a component changes its own
arrangement by the width of its container (container queries), not the window's. A rule that switches at a window
width is allowed only for the shell (rail versus tab bar) and is named in the stylesheet as such. No breakpoints named
after devices. Two columns appear where both columns fit their minimum, and stack where they don't.

**D3 No fixed widths for content.** Columns, label columns, gauges and charts take fractions of their container with
a minimum and a maximum (`clamp()`), never a fixed pixel width. The page's width cap becomes a reading-measure cap
in `rem` (it grows with the type), so a larger screen gets a larger page, not a wider margin.

**D4 Home flows (amends A8 D5 and A9).**

- **Needs you and Systems:** two columns when Needs you can have at least about 22 rem and Systems about 36 rem;
  otherwise Needs you above Systems. This replaces the 1000 px switch and the fixed 4 : 8 split.
- **The rack's rows:** they arrange themselves by their own width (name, readings and link in a row when they fit,
  readings under the name when they don't).
- **The band:**
  - Its row height, bar height, lane-name column and type scale with its width.
  - Where it is too narrow for a lane name beside each track, the name goes above.
  - The span rule keeps A9's intent as a measure, not a device: the band shows the whole day when an hour gets at
    least about 24 px. Otherwise it shows midnight to an hour after Now, at least six hours.
- **The TV:** no zoom. Fluid type (D1) and the `rem` page cap (D3) make Home read from across the room, so A9 D3's
  1.2× step is removed.

**D5 The workshop display is out of scope.** It is a fixed 480 × 320 screen with its own layouts (the contract's
display rules are unchanged).

**D6 Checking is continuous.** A page is checked across a sweep of widths, from 320 px to 2560 px in 20 px steps,
dark and light. The checks are:

- no horizontal overflow
- no clipped text
- no control under its touch target
- two neighbouring marks or labels never overlapping

Screenshots are still taken at the named sizes for the owner to look at. The sweep replaces "check at 390, 1024 and
1440" as the gate.

## Model rejected

**Keep the breakpoints and add more for each device (iPad portrait, iPad landscape, iPad Pro).** That is what the site
has, and every new device lands between two of them. The owner asked for the other model.

## Not changed

The anatomy of every page (A7), Home's content and order (A8), the kit's colours and contrast, the words, the wall
display's board, and the workshop display.

## Delivery

A plan before code, in these PRs, each reviewable alone:

1. **appliance-ui:** fluid type and space tokens, the readout sizes, and the contract's text, with the kit's tests and
   its contrast table.
2. **Pi Hub, shell:** the kit synced, the page cap in `rem`, the rail and tab bar the only window switch.
3. **Pi Hub, Home:** D4.
4. **Pi Hub, the other pages,** one area per PR (Workshop, Documents, Media, Home & network, System): their breakpoints
   replaced by D2 and D3.
5. **The width sweep (D6)** as a script in `tests/browser`, run on every PR from step 2.

The Assistant's own pages pick up the fluid tokens through the kit; replacing its breakpoints is a follow-up in
LocalAI's own plan.
