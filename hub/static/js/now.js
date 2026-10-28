// Home: the one-line answer, then six cards (one home, "Home cards"): Needs you, Workshop, Documents, Media,
// Home & network and System. The wall display keeps its own layout.
import { api, clockTime, h, post, settle, toast, weatherIcon } from "./core.js";
import { tile } from "./control.js";
import { homeCards, labLink, needsSummary } from "./home-cards.js";
import { plainInternet, workshopDisplayLabel } from "./wording.js";
import { resolveLink, toolUrl } from "./sections.js";
import { setNeeds } from "./navigation.js";
import { PRINTER_ACTIONS, kioskBadge, printerBusy, runPrinterAction } from "./printer-actions.js";
import { clockParts, deskLab, nextHours, printing, shopLight, upcoming, wallLayout, wallNeeds } from "./wall.js";

export const every = 15;

const finishAt = (m) => Number.isFinite(m) ? new Date(Date.now() + m * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
// The wall's headline: the finish time, with the day when it isn't today ("Tomorrow 3:10 AM").
const finishDay = (m) => {
  if (!Number.isFinite(m)) return "";
  const end = new Date(Date.now() + m * 60000), today = new Date();
  const days = Math.round((new Date(end).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 864e5);
  const day = days === 0 ? "" : days === 1 ? "Tomorrow " : `${end.toLocaleDateString([], { weekday: "long" })} `;
  return day + finishAt(m);
};

function greeting(now = new Date()) {
  const hr = now.getHours();
  if (hr < 5) return "Late night";
  if (hr < 12) return "Good morning";
  if (hr < 17) return "Good afternoon";
  if (hr < 21) return "Good evening";
  return "Good night";
}

function eyebrowLabel(now = new Date()) {
  const day = now.toLocaleDateString([], { weekday: "long" });
  return `${greeting(now)} · ${day}`;
}

function isWallMode() {
  return (
    window.location.pathname === "/wall" ||
    new URLSearchParams(window.location.search).has("wall") ||
    document.body.classList.contains("wall") ||
    document.documentElement.dataset.wall === "1"
  );
}


// The internet and the home network in plain words (the 25 Oct critique): one headline, then how quickly each part
// of the path answers. Details live in Grafana and Uptime Kuma.
export function networkPanel(net) {
  if (!net || (!net.orbi_ms && !net.wan_ms)) return null;
  const ms = (v) => (Number.isFinite(v) ? `${Math.round(v * 10) / 10} ms` : "no answer");
  const tone = (v) => (!Number.isFinite(v) ? "bad" : v > 60 ? "warn" : "ok");
  const row = (label, what, v) => h("li", {},
    h("span", { class: "dot", dataset: { tone: tone(v) }, "aria-hidden": "true" }),
    h("strong", {}, label), h("span", { class: "meta" }, what), h("span", { class: "status-side" }, ms(v)));
  const headline = plainInternet(net);
  return h("section", { class: "net-panel", "aria-label": "Internet and home network" },
    h("p", { class: "net-headline", dataset: { tone: headline.startsWith("Internet OK") ? "ok" : "warn" } }, headline),
    h("ul", { class: "status-list" },
      row("Router", "The Orbi", net.orbi_ms),
      row("AT&T line", "From the router to AT&T", net.att_ms),
      row("Internet", "Out to the wider internet", net.wan_ms),
      row("Name lookups", "Turning names into addresses", net.dns_ms),
      row("Windows PC", "Local AI and Paperless", net.win_ms),
      Number.isFinite(net.printer_ms) ? row("3D printer", "The X2D", net.printer_ms) : null),
    h("p", { class: "meta" },
      h("a", { class: "tool-link", href: toolUrl("network"), target: "_blank", rel: "noopener" }, "Open Grafana ↗"), " ",
      h("a", { class: "tool-link", href: `${toolUrl("status")}status/home`, target: "_blank", rel: "noopener" }, "Open Status ↗")));
}

export function band(p, cam = null) {
  const pct = p.progress || 0;
  const detail = p.state === "printing" && p.left
    ? ["Done in about ", h("strong", {}, p.left), finishAt(p.minutes_left) ? `, around ${finishAt(p.minutes_left)}` : ""]
    : [p.detail || ""];
  const cls = p.state === "printing" ? "band is-printing" : "band";
  const lab = labLink(p);

  const camElement = (cam && cam.ok) ? h("a", {
    href: "/workshop?from=home",
    "data-link": true,
    class: "band-cam",
    title: "Open Workshop camera"
  },
    h("img", {
      class: "band-cam-img",
      src: `/api/camera.jpg?t=${Date.now()}`,
      alt: "Bambu live camera",
      width: 140,
      height: 79
    }),
    h("span", { class: "band-cam-live" }, "● LIVE")
  ) : null;

  const temps = (p.nozzle_temp !== undefined && p.nozzle_temp !== null) ? h("div", {
    style: "display: flex; gap: .45rem; margin-top: .4rem; font-size: .75rem; color: var(--text-2); flex-wrap: wrap;"
  },
    h("span", { class: "meta", style: "background: color-mix(in srgb, var(--surface-3) 70%, transparent); padding: .15rem .45rem; border-radius: 4px; border: 1px solid var(--line);" }, `🌡️ Nozzle ${p.nozzle_temp}°C`),
    h("span", { class: "meta", style: "background: color-mix(in srgb, var(--surface-3) 70%, transparent); padding: .15rem .45rem; border-radius: 4px; border: 1px solid var(--line);" }, `🛏️ Bed ${p.bed_temp}°C`),
    p.ams_humidity != null ? h("span", { class: "meta", style: "background: color-mix(in srgb, var(--surface-3) 70%, transparent); padding: .15rem .45rem; border-radius: 4px; border: 1px solid var(--line);" }, `💧 AMS ${p.ams_humidity}%`) : null
  ) : null;

  return h("section", { class: cls, dataset: { state: p.state }, "aria-label": "Bambu 3D Printer" },
    h("div", { class: "band-content" },
      h("div", { class: "band-info" },
        h("p", { class: "band-name" }, "Bambu X2D"),
        h("h2", { class: "band-headline" }, p.headline),
        h("div", { class: "line", role: "progressbar", "aria-label": "Print progress", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct },
          h("div", { class: "line-track" }),
          h("div", { class: "line-bead", style: `width:${pct}%` }),
          h("div", { class: "line-nozzle", style: `left:${pct}%` })),
        h("p", { class: "band-detail" }, ...detail),
        lab ? h("a", { class: "tool-link", ...go(lab.href) }, lab.label) : null,
        temps
      ),
      camElement
    )
  );
}

// lab: the desk's way to the print lab, a link beside the printer's own (null on the wall).
function workshopKioskConsole(d, cam, lab = null) {
  const p = d.printer || {};
  const isPrinting = printing(p);
  const pct = p.progress || 0;
  const badge = kioskBadge(p);
  const chip = (text) => h("span", { class: "kiosk-hud-chip" }, text);

  const camHud = h("div", { class: "kiosk-hud-overlay" },
    p.nozzle_temp !== undefined && p.nozzle_temp !== null
      ? chip(`🌡️ Nozzle: ${p.nozzle_temp}°C${p.nozzle_target ? ` / ${p.nozzle_target}°C` : ""}`) : null,
    p.bed_temp !== undefined && p.bed_temp !== null
      ? chip(`🛏️ Bed: ${p.bed_temp}°C${p.bed_target ? ` / ${p.bed_target}°C` : ""}`) : null,
    p.ams_humidity !== undefined && p.ams_humidity !== null ? chip(`💧 AMS: ${p.ams_humidity}% RH`) : null
  );

  // No picture (the camera bridge is down, or the image fails to load): say so in words, not a broken-image icon.
  const noPicture = () => h("p", { class: "kiosk-cam-none" }, "No picture from the printer right now.");
  const camContainer = h("div", { class: "kiosk-cam-container" },
    cam && cam.ok ? h("img", {
      class: "kiosk-cam-img",
      src: `/api/camera.jpg?t=${Date.now()}`,
      alt: "Workshop live nozzle camera",
      loading: "eager",
      onload: (e) => {  // the box takes the picture's own shape
        const { naturalWidth: nw, naturalHeight: nh } = e.target;
        if (nw && nh) { e.target.parentNode?.style.setProperty("--cam-w", nw); e.target.parentNode?.style.setProperty("--cam-h", nh); }
      },
      onerror: (e) => e.target.replaceWith(noPicture()),
    }) : noPicture(),
    (cam && cam.ok) ? h("span", { class: "kiosk-cam-badge" }, "● LIVE") : null,
    camHud
  );

  // The headline is when it will be done (what you look up for); the percentage and the layer sit under it.
  // "Layer 93 / 150" wraps as one piece, never "Layer 93 /" over "150".
  const done = isPrinting ? finishDay(p.minutes_left) : "";
  const layer = p.layer_num ? [" · ", h("span", { class: "nowrap" }, `Layer ${p.layer_num} / ${p.total_layers || '?'}`)] : null;
  const jobSubtitle = isPrinting && p.left
    ? [done ? `${pct}% · ${p.left} to go` : `Done in about ${p.left}`, layer]
    : (p.job_name ? `Job: ${p.job_name}` : (p.detail || "Ready for next print"));

  const progressSection = isPrinting ? h("div", {
    class: "line kiosk-line",
    role: "progressbar",
    "aria-label": "Print progress",
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": pct,
  },
    h("div", { class: "line-track" }),
    h("div", { class: "line-bead", style: `width:${pct}%` }),
    h("div", { class: "line-nozzle", style: `left:${pct}%` })
  ) : null;

  return h("section", { class: "kiosk-console wall-tile", "aria-label": "Bambu X2D printer" },
    h("div", { class: "kiosk-head" },
      h("div", { class: "kiosk-title" },
        h("div", { class: "kiosk-name" },
          h("span", { "aria-hidden": "true" }, "🖨️"),
          h("h2", {}, "Bambu X2D"),
          h("span", { class: "kiosk-badge", dataset: { tone: badge.tone } }, badge.label)),
        done ? h("p", { class: "kiosk-pct kiosk-done" }, h("span", { class: "kiosk-done-label" }, "Done around "), done)
          : isPrinting ? h("p", { class: "kiosk-pct" }, `${pct}%`) : null,
        h("p", { class: "kiosk-sub" }, jobSubtitle)),
      h("div", { class: "kiosk-links" },
        h("a", { class: "chip", href: "/workshop", "data-link": true }, "Workshop History"),
        h("a", { class: "chip", href: toolUrl("bambuddy"), target: "_blank", rel: "noopener" }, "Open Bambuddy ↗"),
        lab ? h("a", { class: `chip desk-lab${lab.judge ? " is-judge" : ""}`, ...go(lab.href) }, lab.label) : null)),
    progressSection,
    h("div", { class: "kiosk-cam-slot" }, camContainer)
  );
}

function workshopLightCard(light, w = {}) {
  if (!light) return null;
  const label = (on) => on ? (light.brightness ? `On (${light.brightness}%)` : "On") : "Off";
  const bulbIcon = h("span", { class: "kiosk-light-bulb", "aria-hidden": "true" }, "💡");
  const nameLabel = h("span", { class: "kiosk-light-name" },
    h("strong", {}, light.name || "Workshop Light"),
    h("span", { class: "meta" }, "Govee Workbench Illumination"));
  const stateLabel = h("span", { class: "kiosk-light-state" }, label(light.on));
  const btnAction = h("span", { class: "chip kiosk-light-action" }, light.on ? "Turn Off" : "Turn On");

  const toggleBtn = h("button", {
    type: "button",
    class: `kiosk-light-toggle-btn ${light.on ? "is-on" : ""}`,
    "aria-pressed": String(Boolean(light.on)),
    onclick: async () => {
      toggleBtn.disabled = true;
      try {
        await post(`/api/home/${light.id}`, { characteristic: light.control || "On", value: !light.on });
        light.on = !light.on;
        toggleBtn.classList.toggle("is-on", light.on);
        toggleBtn.setAttribute("aria-pressed", String(light.on));
        stateLabel.textContent = label(light.on);
        btnAction.textContent = light.on ? "Turn Off" : "Turn On";
      } catch (e) {
        toast(e.message, "bad");
      }
      toggleBtn.disabled = false;
    }
  }, bulbIcon, nameLabel, stateLabel, btnAction);

  return h("section", { class: "kiosk-light-card wall-tile", "aria-labelledby": "wall-light-title" },
    h("div", { class: "kiosk-light-head" },
      h("h2", { id: "wall-light-title" }, "Workshop"),
      w.display ? h("span", { class: "meta" }, `Display: ${workshopDisplayLabel(w.display)}`) : null),
    toggleBtn
  );
}

// The clock: the time on one line, with a small AM/PM beside it.
function setWallClock(state) {
  const d = new Date();
  const { hm, ampm } = clockParts(d);
  state.wallHM.textContent = hm;
  state.wallAmPm.textContent = ampm;
  state.wallAmPm.hidden = !ampm;
  state.wallDate.textContent = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

function deskLayout() {
  let stored = null;
  try { stored = localStorage.getItem("pi_wall_layout"); } catch {}
  const { layout, remember } = wallLayout(window.location.search, stored);
  if (remember) try { localStorage.setItem("pi_wall_layout", remember); } catch {}
  return layout === "desk";
}

function wallView() {
  try { return localStorage.getItem("pi_wall_view") || "workshop"; } catch { return "workshop"; }
}

// One quiet toolbar in a corner: Workshop Focus (or Ambient Home), Kiosk (full screen) and Exit wall display.
function wallToolbar(state) {
  const exit = h("a", { href: "/", class: "kiosk-btn", "data-link": true }, "← Exit wall display");
  // The desk has one view, and iPad Safari has no full screen for pages (Add to Home Screen gives it): back to the
  // wall's layout instead.
  if (state.desk) return [h("a", { href: "/wall?layout=wall", class: "kiosk-btn" }, "Wall layout"), exit];
  const view = wallView();
  const toggleViewBtn = h("button", {
    type: "button",
    class: `kiosk-btn ${view === "workshop" ? "active" : ""}`,
    onclick: () => {
      try { localStorage.setItem("pi_wall_view", view === "workshop" ? "ambient" : "workshop"); } catch {}
      load(state);
    }
  }, view === "workshop" ? "🛠️ Workshop Focus" : "🏠 Ambient Home");

  const fullscreenBtn = h("button", {
    type: "button",
    class: "kiosk-btn",
    onclick: () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, "⛶ Kiosk");

  return [toggleViewBtn, fullscreenBtn, exit];
}

function renderWallHeader(state, out) {
  if (!state.wallHead) {
    state.wallHM = h("span", { class: "wall-hm" });
    state.wallAmPm = h("span", { class: "wall-ampm" });
    state.wallTime = h("h1", { class: "wall-time" }, state.wallHM, state.wallAmPm);
    state.wallDate = h("p", { class: "wall-date" });
    state.wallWeather = h("div", { class: "wall-weather" });
    state.wallHead = h("header", { class: "wall-head" },
      h("div", { class: "wall-clock" }, state.wallTime, state.wallDate),
      state.wallWeather
    );
  }
  setWallClock(state);

  const w = out?.weather;
  if (w) {
    const today = w.days?.[0];
    state.wallWeather.replaceChildren(
      weatherIcon(w.now.icon, w.now.sky),
      h("p", { class: "wall-temp" }, `${w.now.temp}°`),
      h("p", { class: "wall-sky" }, w.now.sky, today ? h("span", { class: "wall-hilo" }, ` · ${today.high}° / ${today.low}°`) : null));
  } else if (out !== null) {
    state.wallWeather.replaceChildren();
  }
}

// The Needs you tile: the top items, in the hub's order, each its own link; a calm "All clear" when nothing does.
function renderWallNeeds(state, needs) {
  const m = wallNeeds(needs, 5);
  state.wallNeeds.dataset.tone = m.tone;
  state.wallNeeds.replaceChildren(...[
    h("div", { class: "wall-needs-head" },
      h("h2", { id: "wall-needs-title" }, "Needs you"),
      h("span", { class: "wall-needs-status" }, m.status)),
    // Full list in, the kit trims it to 5 and adds the "more" link; "Checking…" and "Couldn't check" show no list at all.
    m.clear || m.items.length ? needsList(needs.items, { max: 5, dense: true, more: m.more && needs.items.length > 5 ? { href: "/", label: `${m.more} more on Home` } : null }) : null,
    m.note ? h("p", { class: "meta" }, m.note) : null].filter(Boolean));
}

// Extra tiles for tall screens (a portrait monitor): the next hours of weather and what's on today.
function renderWallExtra(state, out) {
  const hours = nextHours(out?.weather?.hours);
  const events = upcoming(out?.calendar);
  state.wallExtra.replaceChildren(...[
    hours.length ? h("section", { class: "wall-tile wall-hours-tile", "aria-label": "The next hours" },
      h("h2", {}, "Next hours"),
      h("ul", { class: "wall-hours" }, hours.map((x) => h("li", {},
        h("span", {}, x.label), weatherIcon(x.icon, ""), h("strong", {}, `${x.temp}°`),
        x.rain ? h("span", { class: "wall-rain" }, `${x.rain}%`) : null)))) : null,
    events.length ? h("section", { class: "wall-tile wall-agenda", "aria-label": "Coming up" },
      h("h2", {}, "Coming up"),
      h("ul", {}, events.map((e) => h("li", {},
        h("span", { class: "wall-when" }, e.all_day ? "All day" : clockTime(e.start)), h("span", {}, e.title))))) : null,
  ].filter(Boolean));
  // On a short screen this column can scroll, so a keyboard needs to reach it; an empty one is no stop.
  const any = state.wallExtra.childElementCount > 0;
  state.wallExtra.toggleAttribute("tabindex", any);
  if (any) { state.wallExtra.tabIndex = 0; state.wallExtra.setAttribute("role", "region"); state.wallExtra.setAttribute("aria-label", "Next hours and coming up"); }
  else { state.wallExtra.removeAttribute("role"); state.wallExtra.removeAttribute("aria-label"); }
}

function outsideLine(o) {
  const bits = [];
  if (o?.weather) {
    const w = o.weather, t = w.days[0];
    bits.push(h("a", { class: "out-weather", href: "/weather", "data-link": true }, weatherIcon(w.now.icon, w.now.sky),
      h("strong", {}, `${w.now.temp}°`), ` ${w.now.sky}, high ${t.high}°`));
    if (w.alerts?.length) bits.push(h("a", { class: "out-alert", href: "/weather", "data-link": true }, w.alerts[0].event));
    else if (w.soon) bits.push(h("span", { class: "out-soon" }, w.soon));
  }
  const next = o?.calendar?.find((e) => e.all_day || e.start * 1000 > Date.now() - 30 * 60000);
  if (next) bits.push(h("span", { class: "out-next" }, "Next: ", h("strong", {}, next.all_day ? next.title : `${clockTime(next.start)} ${next.title}`)));
  return bits.length ? h("p", { class: "outside" }, ...bits) : null;
}

const outward = (href) => /^https?:/.test(href);
const go = (link) => { const href = resolveLink(link); return outward(href) ? { href, target: "_blank", rel: "noopener" } : { href, "data-link": true }; };

// The kit draws every Needs you list (Home card, wall and desk tile). It hands back absolute same-origin hrefs; the
// SPA router takes those (main.js reads a[data-link] and compares origins), so mark the internal ones for it.
function needsList(items, { max, more = null, dense = false }) {
  const list = ApplianceNeeds.renderList(items, { resolve: resolveLink, here: new URL(location.href), self: "Pi Hub", max, more, dense });
  for (const a of list.querySelectorAll("a")) if (a.origin === location.origin) a.setAttribute("data-link", "");
  return list;
}

// A printer action on a card (Clear the plate): the same flow as the Workshop page's buttons.
function cardButton(action, onDone) {
  const b = h("button", { type: "button", class: "btn home-card-action", disabled: printerBusy() }, action.label || PRINTER_ACTIONS[action.do]?.label);
  b.addEventListener("click", () => runPrinterAction(action.do, [b], onDone));
  return b;
}

function homeCard(c, cam, onDone) {
  const showCam = c.key === "workshop" && cam?.ok && /^(Printing|Paused)/.test(c.status);
  return h("section", { class: `home-card home-card--${c.key}`, dataset: { tone: c.tone }, "aria-labelledby": `card-${c.key}` },
    h("div", { class: "home-card-head" },
      h("h2", { id: `card-${c.key}`, class: "home-card-title" }, c.title),
      h("span", { class: "dot", dataset: { tone: c.tone }, "aria-hidden": "true" })),
    h("p", { class: "home-card-status" }, c.status),
    c.items?.length ? needsList(c.items, { max: 4 }) : null,
    c.note ? h("p", { class: "meta" }, c.note) : null,
    showCam ? h("img", { class: "house-cam-img home-card-cam", src: `/api/camera.jpg?t=${Date.now()}`, alt: "The X2D's camera", loading: "lazy" }) : null,
    c.action?.do ? cardButton(c.action, onDone)
      : c.action ? h("a", { class: "btn home-card-action", ...go(c.action.href) }, c.action.label) : null,
    c.link ? h("a", { class: "home-card-link meta", ...go(c.link.href) }, c.link.label) : null,
    c.lab ? h("a", { class: "home-card-link meta", ...go(c.lab.href) }, c.lab.label) : null);
}

export function mount(state) {
  state.summary = h("p", { class: "summary", "aria-live": "polite", dataset: { tone: "none" } }, "Checking the house…");
  state.outside = h("div", { class: "outside-wrap" });
  state.eyebrow = h("p", { class: "hero-eyebrow" }, eyebrowLabel());
  
  if (isWallMode()) {
    // The wall board: the clock and weather, Needs you, the printer and camera, the house, extra tiles for tall
    // screens and one toolbar. home.css places them by the screen's shape.
    state.desk = deskLayout();
    renderWallHeader(state, null);
    state.wallNeeds = h("section", { class: "wall-tile wall-needs", "aria-labelledby": "wall-needs-title" });
    renderWallNeeds(state, undefined);
    state.wallPrint = h("div", { class: "wall-print" });
    state.wallHouse = h("div", { class: "wall-house" });
    state.wallExtra = h("div", { class: "wall-extra" });
    state.wallTools = h("nav", { class: "wall-tools", "aria-label": "Wall display" }, ...wallToolbar(state));
    state.wallBoard = h("div", { class: "wall-board", dataset: { layout: state.desk ? "desk" : "wall" } },
      state.wallHead, state.wallNeeds, state.wallPrint, state.wallHouse, state.wallExtra, state.wallTools);
    state.summary.hidden = true;
    state._clockTimer = setInterval(() => { if (state.wallHM) setWallClock(state); }, 1000);
    state.root.append(state.wallBoard, state.summary);
  } else {
    state.hero = h("section", { class: "home-context", "aria-label": "Around the house" }, state.summary, state.outside);
    state.cards = h("div", { class: "home-cards" });
    state.root.append(state.hero, state.cards);
  }

  if (state._eyebrowTimer) clearInterval(state._eyebrowTimer);
  state._eyebrowTimer = setInterval(() => {
    if (state.eyebrow) state.eyebrow.textContent = eyebrowLabel();
  }, 15 * 60 * 1000);

  if (state._camTimer) clearInterval(state._camTimer);
  state._camTimer = setInterval(() => {
    const imgs = state.root.querySelectorAll(".band-cam-img, .house-cam-img, .kiosk-cam-img");
    if (imgs.length && !document.hidden) {
      const ts = Date.now();
      imgs.forEach(img => { img.src = `/api/camera.jpg?t=${ts}`; });
    }
  }, 2000);
}

export async function load(state) {
  // Only the house status is required; each extra source gets 6 s, then the page shows without it.
  const [d, out, home, cam] = await Promise.all([
    api("/api/now"),
    settle(api("/api/outside"), 6000, null),
    settle(api("/api/home"), 6000, { connected: false, accessories: [], favourites: [] }),
    settle(api("/api/camera"), 6000, { ok: false }),
  ]);
  
  state.outside.replaceChildren(...[outsideLine(out), d.setup_left && !isWallMode()
    ? h("a", { class: "setup-hint", href: "/settings", "data-link": true }, `${d.setup_left} setup step${d.setup_left > 1 ? "s" : ""} remaining →`) : null].filter(Boolean));

  const favs = home.accessories.filter((a) => home.favourites.includes(a.id));
  const sortedAccessories = [...home.accessories].sort((a, b) => {
    const score = (x) => {
      if (x.kind === "light") return 1;
      if (x.kind === "plug") return 2;
      if (x.name && x.name.toLowerCase().includes("power")) return 3;
      return 4;
    };
    return score(a) - score(b);
  });
  const displayAccessories = favs.length ? favs : (home.connected ? sortedAccessories.slice(0, 3) : []);
  const controlsTitle = favs.length ? "Favourite controls" : "Quick controls";

  const worst = d.issues.some((i) => i.tone === "bad") ? "bad" : d.issues.length ? "warn" : "ok";
  state.summary.textContent = d.summary;
  state.summary.dataset.tone = worst;
  state.facts = d.summary;  // what the Assistant button hands Local AI
  state.summary.hidden = !isWallMode() && d.issues.length > 0;
  if (state.hero) state.hero.hidden = state.summary.hidden && state.outside.childElementCount === 0;
  if (state.eyebrow) state.eyebrow.textContent = eyebrowLabel();


  if (isWallMode()) return loadWall(state, d, out, home, cam, displayAccessories, controlsTitle);

  // The line holds the hub's own words until Needs you answers; while the hub counts problems, it waits for Needs you
  // (the card and the badge carry the count), so no count flashes up and goes.
  const line = (text) => {
    state.summary.textContent = text;
    state.summary.hidden = !text;
    if (state.hero) state.hero.hidden = state.summary.hidden && state.outside.childElementCount === 0;
  };
  line(state.extra ? needsSummary(state.extra.needs, d.summary) : d.issues.length ? "" : d.summary);  // a refresh: the last answer
  // The cards show now; Needs you, backups and the latest movie fill in as they answer (each gives up after 4 s), so
  // the page never waits on them.
  const draw = (extra) => state.cards.replaceChildren(
    ...homeCards({ now: d, home, ...extra }).map((c) => homeCard(c, cam, () => load(state))));
  draw(state.extra || {});
  Promise.all([
    settle(api("/api/needs"), 4000, null),
    settle(api("/api/system/backups"), 4000, null),
    settle(api("/api/movies/latest"), 4000, null),
  ]).then(([needs, backups, latest]) => {
    if (needs) setNeeds(needs);
    if (state.summary.isConnected) line(needsSummary(needs, d.summary));
    state.extra = { needs, backups, latest };
    if (state.cards.isConnected) draw(state.extra);
  });
}

export function failed(state) {
  state.summary.textContent = "Can't reach the Pi Hub right now. It will keep trying.";
  state.summary.dataset.tone = "bad";
  state.summary.hidden = false;  // Home may have hidden an empty line
  if (state.hero) state.hero.hidden = false;
}

// The wall: Needs you is fetched with the rest (it decides the first tile), then each tile is drawn in place.
async function loadWall(state, d, out, home, cam, displayAccessories, controlsTitle) {
  const needs = await settle(api("/api/needs"), 4000, null);
  if (needs) setNeeds(needs);
  state.summary.hidden = true;
  renderWallHeader(state, out);
  renderWallNeeds(state, needs);
  renderWallExtra(state, out);
  state.wallBoard.dataset.printing = printing(d.printer) ? "1" : "0";
  state.wallBoard.dataset.extra = state.wallExtra.childElementCount ? "1" : "0";
  state.wallBoard.dataset.needsMany = (needs?.items?.length || 0) > 2 ? "1" : "0";
  state.wallTools.replaceChildren(...wallToolbar(state));
  state.wallPrint.replaceChildren(workshopKioskConsole(d, cam, state.desk ? deskLab(d.printer) : null));

  if (state.desk) {
    // The desk: the workshop light (the print lab link is on the printer tile); the next hours and the network where
    // there's room (landscape).
    const light = shopLight(home.accessories);
    state.wallHouse.replaceChildren(...[
      workshopLightCard(light, d.workshop),
      networkPanel(d.network),
    ].filter(Boolean));
    return;
  }
  if (wallView() === "workshop") {
    const light = shopLight(home.accessories);
    const others = displayAccessories.filter(a => a.id !== light?.id);
    state.wallHouse.replaceChildren(...[
      workshopLightCard(light, d.workshop),
      networkPanel(d.network),
      others.length ? h("section", { class: "home-favourites wall-tile" },
        h("div", { class: "wall-favourites-head" },
          h("h2", { class: "section-title" }, controlsTitle),
          h("a", { href: "/control?from=home", "data-link": true }, "All devices →")),
        h("div", { class: "tiles" }, others.map(a => tile(a, state)))) : null,
    ].filter(Boolean));
    return;
  }
  // Ambient Home: Home's cards (less Needs you, which has its own tile) in the house column.
  state.wallHouse.replaceChildren(h("div", { class: "home-cards" },
    ...homeCards({ now: d, home, needs }).filter((c) => c.key !== "needs").map((c) => homeCard(c, cam, () => load(state)))));
}

export function leave(state) {
  clearInterval(state._eyebrowTimer);
  clearInterval(state._camTimer);
  if (state._clockTimer) clearInterval(state._clockTimer);
}
