// The phone's More: the two sections that don't fit in the bottom bar.
import { linkGroup } from "./section-links.js";

export const every = 600;
export function mount(state) {
  state.root.append(linkGroup("", [
    ["/network", "Home & network", "Devices, internet and blocking"],
    ["/system", "System", "Backups, alerts and settings"],
    ["/weather", "Weather", "Forecast, air quality and warnings"],
  ]));
}
export async function load() {}
