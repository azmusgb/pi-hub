// Home & network: the devices, the internet, ad blocking and guest Wi-Fi.
import { api, h } from "./core.js";
import * as devices from "./control.js";
import { networkPanel } from "./now.js";
import { toolUrl } from "./sections.js";

export const every = devices.every;

export function mount(state) {
  state.devices = { root: h("div"), context: state.context };
  state.internet = h("div");
  state.extras = h("div");
  devices.mount(state.devices);
  state.root.append(
    h("section", { class: "more-group" }, h("h2", {}, "Devices"), state.devices.root),
    h("section", { class: "more-group" }, h("h2", {}, "Internet"), state.internet),
    state.extras);
}

export async function load(state) {
  const [now, adguard, wifi] = await Promise.all([
    api("/api/now").catch(() => null),
    api("/api/network/adguard").catch(() => null),
    api("/api/wifi").catch(() => ({ set: false })),
    devices.load(state.devices),
  ]);
  state.internet.replaceChildren(networkPanel(now?.network) || h("p", { class: "meta" }, "The network checks aren't answering."));
  state.extras.replaceChildren(...[
    h("section", { class: "more-group" }, h("h2", {}, "Ad blocking"),
      h("p", {}, adguard?.available
        ? `Blocked today: ${adguard.blocked.toLocaleString()} of ${adguard.queries.toLocaleString()} lookups`
        : "AdGuard isn't answering."),
      h("a", { class: "tool-link", href: toolUrl("adguard"), target: "_blank", rel: "noopener" }, "Open AdGuard ↗")),
    wifi.set ? h("section", { class: "more-group wifi-panel" }, h("h2", {}, "Guest Wi-Fi"),
      h("div", { class: "wifi-content" },
        h("img", { src: `/api/wifi/qr.svg?v=${encodeURIComponent(wifi.ssid)}`, alt: `QR code to join ${wifi.ssid}`, class: "wifi-qr", width: 96, height: 96 }),
        h("div", {}, h("p", { class: "wifi-name" }, wifi.ssid), h("p", { class: "meta" }, "Scan to join")))) : null,
  ].filter(Boolean));
}
