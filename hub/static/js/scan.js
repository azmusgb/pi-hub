// Household › Scan (A22 3.3, step 12): the page is in the strip from the start, with one line and the way to the Scan
// app. Step 15 fills it in, or leaves it this way (A22 5.3).
import { h } from "./core.js";
import { openInRow } from "./section-links.js";

export const every = 600;

export function mount(state) {
  state.root.append(
    h("p", {}, "Scans are made in the Scan app, which opens in a new tab."),
    openInRow("scan"));
}

export async function load() {}
