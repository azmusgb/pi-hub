// More: the pages that don't fit in the phone's bottom bar.
import { h } from "./core.js";

export const every = 600;

const PAGES = [
  ["/weather", "Weather", "The next hours, the week, air quality and warnings"],
  ["/workshop", "Workshop", "The X2D, print history, the touchscreen and Local AI"],
  ["/print", "Print", "Send a file to the HP DeskJet, see the queue and ink"],
  ["/pi", "Raspberry Pi", "Fix-it buttons, charts, services, storage and updates"],
  ["/drives", "Drives", "Drive health, and moving the movies to a new drive"],
  ["/rules", "Rules", "When something happens, do something: lights, alerts, fixes"],
  ["/alerts", "Alerts", "Everything the Pi has sent to your phone"],
  ["/settings", "Settings", "Owner settings: PIN, Homebridge, Wi-Fi, backups"],
];

export function mount(state) {
  state.root.append(h("ul", { class: "more" }, PAGES.map(([href, name, what]) =>
    h("li", {}, h("a", { href, "data-link": true }, h("strong", {}, name), h("span", { class: "meta" }, what))))));
}

export async function load() {}
