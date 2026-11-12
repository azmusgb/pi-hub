// Home & network › Network: the internet, ad blocking and guest Wi-Fi. The devices are /devices (devices.js). A7 P1: the
// faceplate is the internet; the hops, the house's machines, ad blocking and guest Wi-Fi are sections of lamp rows.
import { api, ensure, h } from "./core.js";
import { faceplate, faceplateLoading, fillNeedsHere, lampRows, needsHere, section } from "./page-parts.js";
import { openInRow } from "./section-links.js";
import { plainInternet } from "./wording.js";

export const every = 10;

export function mount(state) {
  state.plate = h("div", {}, faceplateLoading("Internet"));
  state.needs = needsHere();
  state.extras = h("div", { class: "stack" });
  state.root.append(state.plate, state.needs, state.extras, openInRow("internet"));
}

const ms = (v) => (Number.isFinite(v) ? `${Math.round(v * 10) / 10} ms` : null);
// As Home's network panel: slow past 60 ms, no answer is bad.
const hop = (title, detail, v) => ({ title, detail, value: ms(v),
  ...(!Number.isFinite(v) ? { tone: "bad", word: "No answer" } : v > 60 ? { tone: "warn", word: "Slow" } : { tone: "ok", word: "OK" }) });
const mbps = (v) => (Number.isFinite(v) ? `${Math.round(v * 10) / 10} Mbps` : null);

// Paused protection still answers lookups and blocks none, so it is said plainly, not as a count (iPad, 1 Nov).
export function adBlocking(adguard) {
  if (!adguard?.available) return { title: "Ad blocking", detail: "AdGuard isn't answering.", tone: "unknown", word: "Unknown" };
  const counted = `${adguard.blocked.toLocaleString()} of ${adguard.queries.toLocaleString()} lookups blocked today`;
  return adguard.protection === false
    ? { title: "Ad blocking", detail: `AdGuard's protection is paused. ${counted}.`, tone: "warn", word: "Off" }
    : { title: "Ad blocking", detail: `${counted[0].toUpperCase()}${counted.slice(1)}.`, tone: "ok", word: "On" };
}

// The faceplate and the sources line from /api/now's network, so they can be checked without a browser. A missing or
// unknown reading is never shown as fine.
export function internetPlate(net) {
  const answering = !!net && net.status !== "unknown" && (Number.isFinite(net.orbi_ms) || Number.isFinite(net.wan_ms));
  if (!answering) {
    return faceplate({ name: "Internet", lamp: ["unknown", "Not answering"], readout: "—",
      caption: "The network checks aren't answering. The readings return when they do." });
  }
  const headline = plainInternet(net);
  const lamp = net.status === "bad" ? ["bad", "Internet down"] : headline.startsWith("Internet slow") ? ["warn", "Internet slow"] : ["ok", "Internet OK"];
  return faceplate({
    name: "Internet", lamp,
    readout: Number.isFinite(net.wan_ms) ? String(Math.round(net.wan_ms * 10) / 10) : "—", unit: Number.isFinite(net.wan_ms) ? "ms" : "",
    caption: Number.isFinite(net.wan_ms) ? "To the wider internet, just now." : "The wider internet didn't answer the last check.",
    readings: [["In use, down", mbps(net.orbi_down_mbps)], ["In use, up", mbps(net.orbi_up_mbps)]],
  });
}

export function networkSources(net, adguard) {
  const up = !!net && net.status !== "unknown";
  return [up ? { name: "Network monitor", tone: "ok" } : { name: "Network monitor", tone: "bad", word: "isn't answering" },
    adguard?.available ? { name: "AdGuard", tone: "ok" } : { name: "AdGuard", tone: "bad", word: "isn't answering" }];
}

function wifiSection(state, wifi) {
  if (!wifi?.set) return null;
  return section("Guest Wi-Fi", h("div", { class: "wifi-content" },
    // The code holds the password: only a signed-in household member gets it (the password is null otherwise).
    wifi.password != null
      ? h("img", { src: `/api/wifi/qr.svg?v=${encodeURIComponent(wifi.ssid)}`, alt: `QR code to join ${wifi.ssid}`, class: "wifi-qr", width: 96, height: 96 })
      : null,
    h("div", {}, h("p", { class: "wifi-name" }, wifi.ssid),
      wifi.password != null
        ? h("p", { class: "meta" }, "Scan to join")
        : h("button", { type: "button", class: "ui-btn", onclick: async () => { if (await ensure("household")) load(state); } }, "Sign in to show the join code"))));
}

export async function load(state) {
  const [now, adguard, wifi] = await Promise.all([
    api("/api/now").catch(() => null),
    api("/api/network/adguard").catch(() => null),
    api("/api/wifi").catch(() => ({ set: false })),
    fillNeedsHere(state.needs, "/network"),
  ]);
  const net = now?.network;
  state.facts = net ? plainInternet(net) : "";
  state.sources = networkSources(net, adguard);
  state.plate.replaceChildren(internetPlate(net));
  const up = !!net && net.status !== "unknown";
  state.extras.replaceChildren(...[
    up ? section("From the house to the internet", lampRows([
      hop("Router", "The Orbi", net.orbi_ms),
      hop("AT&T line", "From the router to AT&T", net.att_ms),
      hop("Internet", "Out to the wider internet", net.wan_ms),
      hop("Name lookups", "Turning names into addresses", net.dns_ms),
    ])) : null,
    up ? section("In the house", lampRows([
      hop("Windows PC", "Local AI and Paperless", net.win_ms),
      Number.isFinite(net.printer_ms) ? hop("3D printer", "The X2D", net.printer_ms) : null,
    ])) : null,
    section("Ad blocking", lampRows([adBlocking(adguard)])),
    wifiSection(state, wifi),
  ].filter(Boolean));
}
