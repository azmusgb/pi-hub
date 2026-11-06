# Amendment A14: a text size for each device

Date: 2026-11-06 · Status: **proposed** · Amends: the appliance-ui design contract (`DESIGN.md`, Type: "One fluid
scale", A10 D1) and Pi Hub's footer (`hub/static/js/main.js`, beside Theme).

## Why

1. **The owner asked for roomier reading.** On 6 Nov the owner shared a Home prototype ("Comfortable+ Refined") whose
   type is about 15% larger than Pi Hub's, with a 100 / 115 / 130% text control. Asked what to take from it, they chose
   its ideas over its look: the text size and the comfortable type.
2. **Today the only way to get larger text is the browser's.** A10 D1 follows the browser's text size, which works on a
   Mac but is buried on an iPhone (Safari's per-site "aA" menu) and absent on the wall display's kiosk browser.
3. **The kit can't grow one device's type.** The root's curve (`dist/tokens.css:7`,
   `html{font-size:clamp(100%, 0.9423rem + 0.2564vw, 125%)}`) is the same for every device, and an app may not set
   its own curve (DESIGN.md, Type).

## Decisions

**D1 Each device picks Standard, Large or Larger.**
- The choice is 100%, 115% or 130%. It multiplies the kit's root curve, so the fluid scale (A10 D1) and the
  browser's own text size still apply on top.
- Like Theme, it's remembered per device (`localStorage`, key `hub-text`). Standard is the default, so a device
  nobody has set looks as it does today.
- Rejected: a slider. Three steps can each be swept and checked (D4). A slider has every size in between, and no
  check covers them.

**D2 The kit owns the multiplier.**
- `tokens.css` reads one custom property, `--ui-text-scale` (default `1`), inside the root's size:
  `html{font-size:calc(clamp(100%, 0.9423rem + 0.2564vw, 125%) * var(--ui-text-scale, 1))}`. The type, space and
  header tokens are `rem`, so all of them follow, and spacing grows with the type.
- The app only sets the property on `<html>`. It's still never a curve of its own, and never a px size.
- This is a kit change in appliance-ui, synced into Pi Hub and the Assistant, and never set per page.
- Rejected: scaling only the type tokens. Spacing that doesn't grow with the type is what made the prototype's 130%
  look cramped.

**D3 The control sits in the footer, beside Theme.**
- It reads "Text: Standard" and cycles on each tap, as Theme does (`hub/static/js/main.js:142-181`).
- It is a native button with the 44 px target, and it announces its new value.
- Rejected: the prototype's segmented control in the top bar. It's a set-once preference, and the head of every page
  is for the page (A7).

**D4 The width sweep runs at every size.**
- A10 D6's sweep runs at Standard, Large and Larger, dark and light. Its checks are unchanged: no overflow, no clipped
  text, no target under 44 px, no overlapping labels.
- At Larger, a page may stack sooner. That is intended: container queries and auto-fit grids are measured in `rem`, so
  columns give way as the type grows.

**D5 What doesn't change.**
- The colour tokens, the A11 dial and Home's layout (A8, A10 D4).
- The 12 px floor (A10 plan decision 12): Large and Larger only raise it.
- The workshop display (`tokens.h`, fixed px).
- The wall display: it keeps Standard unless the owner sets it, and its URL may carry `?text=large`.

**D6 Pages still in px follow when A10 reaches them.** A page whose stylesheet still sets px sizes scales only its
`rem` parts until its A10 step converts it (P6–P9). So the control ships after P9, or ships earlier with those pages
listed as "not yet". The plan chooses which.

## Model rejected

**Adopt the prototype's design.** It has a palette of its own, two dark themes and no light one, about 15 window
breakpoints, 9–11 px text in places, and a timeline in place of the dial. Each of these reverses an approved
amendment (A8, A10, A11) or the contract. The owner chose to take its ideas, not its look.

## Unchanged

The contract's "one fluid scale" stays: A14 adds a per-device multiplier to it, not a second curve.
