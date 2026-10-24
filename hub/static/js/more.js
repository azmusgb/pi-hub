// The phone's additional destinations, grouped by household purpose.
import { h } from "./core.js";
export const every = 600;
const GROUPS = [
  ["Everyday", [
    ["/print", "Print", "Print a file and check the queue"],
    ["/apps/scan", "Scan", "Scan a document into Paperless"],
    ["http://10.0.0.21:8010", "Paperless ↗", "Find a bill, statement or record"],
    ["/workshop", "Workshop", "3D printer, camera, display and local AI"],
    ["/weather", "Weather", "Forecast, air quality and weather warnings"],
  ]],
  ["Appliance Suite", [
    ["/apps", "App Suite", "Station app directory and launchpad"],
    ["/apps/bambuddy", "Bambuddy 3D", "Queue, spool inventory, 3MF archives"],
    ["/apps/grafana", "Grafana NOC", "Internet, gateway and network dashboards"],
    ["/apps/status", "Service Status", "Uptime Kuma live health checks"],
  ]],
  ["Maintenance", [
    ["/pi", "Help & system", "Solve a problem and check the hub"],
    ["/alerts", "Alerts", "Recent events and warnings"],
    ["/rules", "Automations", "Choose what happens automatically"],
    ["/settings", "Settings", "Household access, connections and backups"],
  ]],
];
export function mount(state) {
  state.root.append(...GROUPS.map(([title, pages]) => h("section", { class: "more-group" },
    h("h2", {}, title), h("ul", { class: "more" }, pages.map(([href, name, what]) =>
      // Apps on other machines open in their own tab; everything else stays in the hub.
      h("li", {}, h("a", href.startsWith("http") ? { href, target: "_blank", rel: "noopener" } : { href, "data-link": true }, h("strong", {}, name), h("span", { class: "meta" }, what))))))));
}
export async function load() {}
