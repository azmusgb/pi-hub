// The phone's More: the two sections that don't fit in the bottom bar.
import { linkGroup } from "./section-links.js";

export const every = 600;
export function mount(state) {
  state.root.append(linkGroup("", [
    ["/devices", "Home & network", "Devices, internet, ad blocking and weather"],
    ["/system", "System", "Health, backups, alerts, settings and the site map"],
  ]));
}
export async function load() {}
