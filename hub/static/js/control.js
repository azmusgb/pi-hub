// Control: lights, plugs and switches from Homebridge. Tap to switch; a device that is not the owner's is asked to sign in once.
// A7 P1: the faceplate says how many are on; each kind of device is a section of tiles (the tiles are the controls).
import { api, ensure, h, post, toast } from "./core.js";
import { faceplate, faceplateLoading, section } from "./page-parts.js";
import { applianceControls, applianceLabel, groupAppliances, laundryLine, tileState } from "./wording.js";

export const every = 10;

const PATHS = {
  light: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z",
  plug: "M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4",
  switch: "M12 3v8M7.5 6.3a7 7 0 1 0 9 0",
  fan: "M12 12c0-4 1-8 4-8s3 4-4 8zm0 0c4 0 8 1 8 4s-4 3-8-4zm0 0c0 4-1 8-4 8s-3-4 4-8zm0 0c-4 0-8-1-8-4s4-3 8 4z",
};
function icon(kind) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(ns, "path");
  p.setAttribute("d", PATHS[kind] || PATHS.switch);
  svg.append(p);
  return svg;
}

export function tile(a, state, { favourite, label } = {}) {
  const busy = () => tileEl.classList.add("busy");
  const st = tileState(a);
  const stateEl = h("span", { class: "tile-state" }, st.text);
  const toggle = h("button", {
    class: "tile-main",
    // Unknown: not a toggle, since switching would assume a state the bridge didn't report.
    ...(st.known && a.control ? { "aria-pressed": String(st.on) } : { disabled: true }),
    onclick: async () => {
      if (!tileState(a).known || !a.control || !(await ensure("kid"))) return;
      busy();
      try {
        await post(`/api/home/${a.id}`, { characteristic: a.control, value: !a.on });
        a.on = !a.on;
        toggle.setAttribute("aria-pressed", String(a.on));
        tileEl.dataset.on = String(a.on);
        stateEl.textContent = tileState(a).text;
      } catch (e) { toast(e.message, "bad"); }
      tileEl.classList.remove("busy");
    },
  },
  h("span", { class: "tile-icon" }, icon(a.kind)),
  h("span", { class: "tile-name", title: a.name }, label || applianceLabel(a)),
  stateEl);

  const kids = [toggle];
  if (a.brightness != null && st.known) {
    const slider = h("input", { type: "range", min: 1, max: 100, value: a.brightness || 1, class: "tile-slider", "aria-label": `${applianceLabel(a)} brightness` });
    slider.addEventListener("change", async () => {
      if (!(await ensure("kid"))) return;
      try {
        await post(`/api/home/${a.id}`, { characteristic: "Brightness", value: Number(slider.value) });
        a.brightness = Number(slider.value);
        stateEl.textContent = tileState(a).text;
      }
      catch (e) { toast(e.message, "bad"); }
    });
    kids.push(slider);
  }
  if (favourite !== undefined) {
    kids.push(h("button", {
      class: "tile-fav", "aria-pressed": String(favourite), "aria-label": favourite ? `Remove ${applianceLabel(a)} from favourites` : `Show ${applianceLabel(a)} in favourites`,
      onclick: async () => {
        if (!(await ensure("household"))) return;
        await post(`/api/home/${a.id}/favourite`);
        load(state);
      },
    }, favourite ? "★" : "☆"));
  }
  const tileEl = h("div", { class: "tile", dataset: { on: st.known ? String(st.on) : "unknown", kind: a.kind } }, ...kids);
  return tileEl;
}

export function mount(state) {
  state.plate = h("div", {}, faceplateLoading("Lights and plugs"));
  state.body = h("div", { class: "stack" });
  // `state.needs`, when the page has one, sits under the faceplate, before the sections (A7 P1).
  state.root.append(...[state.plate, state.needs, state.body].filter(Boolean));
}

// Read-only: LG ThinQ, GE SmartHQ and Bosch Home Connect. Hidden until a token is saved on the Pi. A source that
// fails shows its message under the machines the others still report.
export function laundryCard(l) {
  if (!l?.configured) return null;
  const machines = l.available ? (l.machines || []) : [];
  const lines = machines.length ? machines.map((m) => h("p", { class: "meta" }, laundryLine(m)))
    : l.available ? [h("p", { class: "meta" }, "No washer, dryer or dishwasher found on these accounts.")] : [];
  if (l.message || !l.available) lines.push(h("p", { class: "ui-notice ui-notice--warn" }, l.message || "Laundry isn't answering."));
  return section("Laundry", lines);
}

const GROUPS = [["light", "Lights"], ["plug", "Plugs"], ["switch", "Switches"], ["fan", "Fans"]];

// The faceplate (A7 P1): how many of the devices Homebridge reports are on. A device with no answer is counted apart,
// never as off.
export function devicesPlate(d) {
  if (!d?.connected) {
    return faceplate({ name: "Lights and plugs", lamp: ["warn", "Not connected"], readout: "—",
      caption: d?.message || "The hub isn't connected to Homebridge.",
      actions: [h("a", { class: "ui-btn", href: "/settings#group-home", "data-link": true }, "Open Settings")] });
  }
  const all = Array.isArray(d.accessories) ? d.accessories : [];
  const known = all.filter((a) => tileState(a).known);
  const on = known.filter((a) => a.on).length;
  const silent = all.length - known.length;
  const count = (kind) => {
    const list = known.filter((a) => a.kind === kind);
    return list.length ? `${list.filter((a) => a.on).length} of ${list.length} on` : null;
  };
  return faceplate({
    name: "Lights and plugs",
    lamp: silent ? ["warn", `${silent} not answering`] : ["ok", "Connected"],
    readout: String(on), unit: "on",
    caption: all.length ? `Of ${all.length} device${all.length === 1 ? "" : "s"} the hub can switch, through Homebridge.` : "Homebridge has no lights, plugs or switches the hub can control.",
    readings: GROUPS.map(([kind, title]) => [title, count(kind)]),
  });
}

export function devicesSources(d, l) {
  const out = [d?.connected ? { name: "Homebridge", tone: "ok" } : { name: "Homebridge", tone: "bad", word: "not connected" }];
  if (l?.configured) out.push(l.available && !l.message ? { name: "Laundry", tone: "ok" } : { name: "Laundry", tone: l?.available ? "warn" : "bad", word: l?.available ? "partly answering" : "isn't answering" });
  return out;
}

// At most six sections on the page (A7 P1); the rest fold under one closed More.
export function capSections(list, max = 6) {
  if (list.length <= max) return list;
  return [...list.slice(0, max - 1), h("details", { class: "ui-section devices-more" }, h("summary", {}, h("h2", {}, "More")), ...list.slice(max - 1))];
}

export async function load(state) {
  if (state.root.querySelector(".tile.busy")) return;
  const [d, l] = await Promise.all([api("/api/home"), api("/api/laundry").catch(() => ({ configured: true, available: false }))]);
  state.sources = devicesSources(d, l);
  state.plate.replaceChildren(devicesPlate(d));
  const laundry = laundryCard(l);
  if (!d.connected) {
    state.body.replaceChildren(...(laundry ? [laundry] : []));
    return;
  }
  const favs = new Set(d.favourites);
  const favouriteItems = d.accessories.filter(a => favs.has(a.id));
  const { appliances, rest } = groupAppliances(d.accessories);
  const applianceSections = appliances.map((ap) => section(ap.name,
    h("div", { class: "tiles" }, applianceControls(ap, favs).map((a) => tile(a, state, { label: "Power", favourite: false }))), { note: ap.status || null }));
  const hint = favouriteItems.length ? null : "Tap a device to switch it. Use its star to keep it in favourites and on Home.";
  const groups = GROUPS.map(([kind, title]) => [title, rest.filter((a) => a.kind === kind && !favs.has(a.id))])
    .filter(([, list]) => list.length)
    .map(([title, list], i) => section(title, h("div", { class: "tiles" }, list.map((a) => tile(a, state, { favourite: false }))), { note: i === 0 ? hint : null }));
  state.body.replaceChildren(...capSections([
    favouriteItems.length ? section("Favourites", h("div", { class: "tiles" }, favouriteItems.map(a => tile(a, state, { favourite: true }))),
      { note: "Tap a device to switch it. Favourites also appear on Home." }) : null,
    ...applianceSections,
    laundry,
    ...groups,
  ].filter(Boolean)));
}
