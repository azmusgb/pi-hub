// Home & network: the devices, the internet, ad blocking and guest Wi-Fi.
import { api, ensure, h } from "./core.js";
import * as devices from "./control.js";
import { networkPanel } from "./now.js";
import { toolUrl } from "./sections.js";
import { openInRow } from "./section-links.js";
import { plainInternet } from "./wording.js";

export const every = devices.every;

export function mount(state) {
  state.devices = { root: h("div"), context: state.context };
  state.internet = h("div");
  state.extras = h("div");
  devices.mount(state.devices);
  state.root.append(
    h("section", { class: "more-group" }, h("h2", {}, "Devices"), state.devices.root),
    h("section", { class: "more-group" }, h("h2", {}, "Internet"), state.internet),
    state.extras,
    openInRow("network"));
}

// Paused protection still answers lookups and blocks none, so it is said plainly, not as a count (iPad, 1 Nov).
export function adBlocking(adguard) {
  if (!adguard?.available) return h("p", { class: "callout callout--warn" }, "AdGuard isn't answering.");
  const counted = `${adguard.blocked.toLocaleString()} of ${adguard.queries.toLocaleString()} lookups blocked today`;
  return adguard.protection === false
    ? h("p", { class: "callout callout--warn" }, `Ad blocking is off: AdGuard's protection is paused. ${counted}.`)
    : h("p", {}, `${counted[0].toUpperCase()}${counted.slice(1)}.`);
}

export async function load(state) {
  const [now, adguard, wifi] = await Promise.all([
    api("/api/now").catch(() => null),
    api("/api/network/adguard").catch(() => null),
    api("/api/wifi").catch(() => ({ set: false })),
    devices.load(state.devices),
  ]);
  state.facts = now?.network ? plainInternet(now.network) : "";
  state.internet.replaceChildren(networkPanel(now?.network) || h("p", { class: "meta" }, "The network checks aren't answering."));
  state.extras.replaceChildren(...[
    h("section", { class: "more-group" }, h("h2", {}, "Ad blocking"),
      adBlocking(adguard),
      h("a", { class: "tool-link", href: toolUrl("adguard"), target: "_blank", rel: "noopener" }, "Open AdGuard ↗")),
    wifi.set ? h("section", { class: "more-group wifi-panel" }, h("h2", {}, "Guest Wi-Fi"),
      h("div", { class: "wifi-content" },
        // The code holds the password: only a signed-in household member gets it (the password is null otherwise).
        wifi.password != null
          ? h("img", { src: `/api/wifi/qr.svg?v=${encodeURIComponent(wifi.ssid)}`, alt: `QR code to join ${wifi.ssid}`, class: "wifi-qr", width: 96, height: 96 })
          : null,
        h("div", {}, h("p", { class: "wifi-name" }, wifi.ssid),
          wifi.password != null
            ? h("p", { class: "meta" }, "Scan to join")
            : h("button", { type: "button", class: "btn", onclick: async () => { if (await ensure("household")) load(state); } }, "Sign in to show the join code")))) : null,
  ].filter(Boolean));
}
