// Home & network: devices, the internet and ad blocking.
import { toolUrl } from "./sections.js";
import { linkGroup } from "./section-links.js";

export const every = 600;
export function mount(state) {
  state.root.append(linkGroup("", [
    ["/control", "Devices", "Lights, plugs and scenes"],
    [toolUrl("network"), "Internet and network ↗", "Speed, the router and the AT&T line, in Grafana"],
    [toolUrl("status"), "Service checks ↗", "What is up and what isn't, in Uptime Kuma"],
    [toolUrl("adguard"), "Ad blocking ↗", "What AdGuard blocked today"],
    [toolUrl("devices"), "Homebridge ↗", "Add or fix a smart-home device"],
  ]));
}
export async function load() {}
