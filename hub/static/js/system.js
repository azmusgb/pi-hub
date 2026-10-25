// System: backups, alerts, automations, help and settings.
import { toolUrl } from "./sections.js";
import { linkGroup } from "./section-links.js";

export const every = 600;
export function mount(state) {
  state.root.append(linkGroup("", [
    ["/alerts", "Alerts", "Recent events and warnings"],
    ["/rules", "Automations", "Choose what happens automatically"],
    [toolUrl("backups"), "Restore a file ↗", "Backups of the Pi and the Mac, in Backrest"],
    ["/pi", "Help & system", "Solve a problem and check the hub"],
    ["/drives", "Movie storage", "The movies drive and its health"],
    ["/settings", "Settings", "Household access, connections and backups"],
    [toolUrl("pi"), "The Pi's admin ↗", "Cockpit: services, updates and logs"],
  ]));
}
export async function load() {}
