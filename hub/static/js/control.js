// Control: lights, plugs and switches from Homebridge. Tap to switch; the PIN is asked once per device.
import { api, card, ensure, h, post, toast } from "./core.js";
import { applianceLabel, groupAppliances } from "./wording.js";

export const every = 10;

// Presentation layer: map raw hardware IDs to human names. (The dishwasher's switches are grouped into one
// appliance card instead; see wording.js groupAppliances.)
const FRIENDLY_NAMES = {
  "2CB1D23234351E0D": "Workshop Light",
  "3AA1F02111023E1F": "Living Room Plug",
};

function getFriendlyName(a) {
  return FRIENDLY_NAMES[a.id] || FRIENDLY_NAMES[a.name] || applianceLabel(a);
}

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
  const stateEl = h("span", { class: "tile-state" }, a.on ? (a.brightness != null ? `On, ${a.brightness}%` : "On") : "Off");
  const toggle = h("button", {
    class: "tile-main", "aria-pressed": String(a.on),
    onclick: async () => {
      if (!a.control || !(await ensure("kid"))) return;
      busy();
      try {
        await post(`/api/home/${a.id}`, { characteristic: a.control, value: !a.on });
        a.on = !a.on;
        toggle.setAttribute("aria-pressed", String(a.on));
        tileEl.dataset.on = String(a.on);
        stateEl.textContent = a.on ? (a.brightness != null ? `On, ${a.brightness}%` : "On") : "Off";
      } catch (e) { toast(e.message, "bad"); }
      tileEl.classList.remove("busy");
    },
  },
  h("span", { class: "tile-icon" }, icon(a.kind)),
  h("span", { class: "tile-name", title: a.name }, label || getFriendlyName(a)),
  stateEl);

  const kids = [toggle];
  if (a.brightness != null) {
    const slider = h("input", { type: "range", min: 1, max: 100, value: a.brightness || 1, class: "tile-slider", "aria-label": `${getFriendlyName(a)} brightness` });
    slider.addEventListener("change", async () => {
      if (!(await ensure("kid"))) return;
      try {
        await post(`/api/home/${a.id}`, { characteristic: "Brightness", value: Number(slider.value) });
        a.brightness = Number(slider.value);
        stateEl.textContent = a.on ? `On, ${a.brightness}%` : "Off";
      }
      catch (e) { toast(e.message, "bad"); }
    });
    kids.push(slider);
  }
  if (favourite !== undefined) {
    kids.push(h("button", {
      class: "tile-fav", "aria-pressed": String(favourite), "aria-label": favourite ? `Remove ${getFriendlyName(a)} from favourites` : `Show ${getFriendlyName(a)} in favourites`,
      onclick: async () => {
        if (!(await ensure("household"))) return;
        await post(`/api/home/${a.id}/favourite`);
        load(state);
      },
    }, favourite ? "★" : "☆"));
  }
  const tileEl = h("div", { class: "tile", dataset: { on: String(a.on), kind: a.kind } }, ...kids);
  return tileEl;
}

export function mount(state) {
  state.body = h("div", { class: "stack" });
  state.root.append(state.body);
}

export async function load(state) {
  if (state.root.querySelector(".tile.busy")) return;
  const d = await api("/api/home");
  if (!d.connected) {
    state.body.replaceChildren(card("Connect Homebridge", { cls: "wide" },
      h("p", {}, d.message),
      h("a", { class: "action", href: "/settings", "data-link": true }, "Open Settings")));
    return;
  }
  const favs = new Set(d.favourites);
  const groups = [["light", "Lights"], ["plug", "Plugs"], ["switch", "Switches"], ["fan", "Fans"]];
  const favouriteItems = d.accessories.filter(a => favs.has(a.id));
  const { appliances, rest } = groupAppliances(d.accessories);
  const applianceCards = appliances.map((ap) => h("section", { class: "row-section appliance" },
    h("h2", { class: "section-title" }, ap.name),
    ap.status ? h("p", { class: "meta" }, ap.status) : null,
    // Like the other sections, a switch already in Favourites isn't repeated here; each keeps its star.
    h("div", { class: "tiles" }, [[ap.power, "Power"], [ap.running, "Running"]]
      .filter(([a]) => a && !favs.has(a.id)).map(([a, label]) => tile(a, state, { label, favourite: false }))),
    ap.programs.some((p) => !favs.has(p.id)) ? h("h3", { class: "sub" }, "Programs") : null,
    h("div", { class: "tiles tiles--compact" }, ap.programs.filter((p) => !favs.has(p.id))
      .map((p) => tile(p, state, { label: p.name, favourite: false })))));
  const sections = groups.map(([kind, title]) => {
    const list = rest.filter((a) => a.kind === kind && !favs.has(a.id));
    return list.length ? h("section", { class: "row-section" }, h("h2", { class: "section-title" }, title),
      h("div", { class: "tiles" }, list.map((a) => tile(a, state, { favourite: favs.has(a.id) })))) : null;
  }).filter(Boolean);
  state.body.replaceChildren(...[
    h("p", { class: "page-intro" }, favouriteItems.length ? "Your favourites are ready below. Tap a device to switch it." : "Tap a device to switch it. Use its star to keep it in favourites and on Home."),
    favouriteItems.length ? h("section", { class: "row-section" }, h("h2", { class: "section-title" }, "Favourites"),
      h("div", { class: "tiles" }, favouriteItems.map(a => tile(a, state, { favourite: true })))) : null,
    ...applianceCards,
    ...(sections.length || applianceCards.length ? sections
    : favouriteItems.length ? [] : [card("Nothing to control", { cls: "wide" }, h("p", { class: "meta" }, "Homebridge has no lights, plugs or switches the hub can control."))]),
  h("p", { class: "meta" }, "Favourites also appear on Home.")].filter(Boolean));
}
