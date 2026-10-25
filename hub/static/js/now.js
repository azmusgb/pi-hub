// Home: the one-line answer, then six cards (one home, "Home cards"): Needs you, Workshop, Documents, Media,
// Home & network and System. The wall display keeps its own layout.
import { api, clockTime, h, post, settle, weatherIcon } from "./core.js";
import { issueTopic, splitIssues } from "./experience.js";
import { tile } from "./control.js";
import { homeCards } from "./home-cards.js";
import { plainInternet } from "./wording.js";
import { resolveLink, toolUrl } from "./sections.js";
import { setNeeds } from "./navigation.js";
import { PRINTER_ACTIONS, runPrinterAction } from "./printer-actions.js";

export const every = 15;

const finishAt = (m) => Number.isFinite(m) ? new Date(Date.now() + m * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

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
        temps
      ),
      camElement
    )
  );
}

function workshopKioskConsole(d, cam, home, state) {
  const p = d.printer || {};
  const w = d.workshop || {};
  const isPrinting = p.state === "printing" || p.state === "paused";
  const pct = p.progress || 0;

  const camHud = h("div", { class: "kiosk-hud-overlay" },
    p.nozzle_temp !== undefined && p.nozzle_temp !== null
      ? h("span", { class: "kiosk-hud-chip" }, `🌡️ Nozzle: ${p.nozzle_temp}°C${p.nozzle_target ? ` / ${p.nozzle_target}°C` : ""}`)
      : null,
    p.bed_temp !== undefined && p.bed_temp !== null
      ? h("span", { class: "kiosk-hud-chip" }, `🛏️ Bed: ${p.bed_temp}°C${p.bed_target ? ` / ${p.bed_target}°C` : ""}`)
      : null,
    p.ams_humidity !== undefined && p.ams_humidity !== null
      ? h("span", { class: "kiosk-hud-chip" }, `💧 AMS: ${p.ams_humidity}% RH`)
      : null,
    w.display ? h("span", { class: "kiosk-hud-chip", style: "margin-left: auto; opacity: 0.85;" }, `WS350 Screen: ${w.display}`) : null
  );

  const camContainer = h("div", { class: "kiosk-cam-container" },
    h("img", {
      class: "kiosk-cam-img",
      src: `/api/camera.jpg?t=${Date.now()}`,
      alt: "Workshop live nozzle camera",
      loading: "eager"
    }),
    (cam && cam.ok) ? h("span", { class: "kiosk-cam-badge" }, "● LIVE") : null,
    camHud
  );

  const headline = isPrinting
    ? `Printing: ${pct}%`
    : (p.headline || "Idle · Ready for Print");

  const jobSubtitle = isPrinting && p.left
    ? `Done in about ${p.left}${finishAt(p.minutes_left) ? `, around ${finishAt(p.minutes_left)}` : ""}${p.layer_num ? ` · Layer ${p.layer_num} / ${p.total_layers || '?'}` : ""}`
    : (p.job_name ? `Job: ${p.job_name}` : (p.detail || "Ready for next print"));

  const progressSection = isPrinting ? h("div", {
    class: "line",
    role: "progressbar",
    "aria-label": "Print progress",
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": pct,
    style: "margin: .75rem 0;"
  },
    h("div", { class: "line-track" }),
    h("div", { class: "line-bead", style: `width:${pct}%` }),
    h("div", { class: "line-nozzle", style: `left:${pct}%` })
  ) : null;

  return h("div", { class: "kiosk-console" },
    h("div", { style: "display: flex; justify-content: space-between; align-items: baseline; margin-bottom: .75rem; flex-wrap: wrap; gap: .5rem;" },
      h("div", {},
        h("div", { style: "display: flex; gap: .5rem; align-items: center;" },
          h("span", { style: "font-size: 1.15rem;" }, "🖨️"),
          h("h2", { style: "margin: 0; font-size: 1.15rem; font-weight: 700;" }, "Bambu X2D Workshop"),
          h("span", {
            style: `font-size: .6875rem; font-weight: 700; padding: .15rem .5rem; border-radius: 999px; background: color-mix(in srgb, var(--${isPrinting ? 'ok' : 'text-3'}) 15%, transparent); color: var(--${isPrinting ? 'ok' : 'text-3'});`
          }, isPrinting ? "PRINTING" : "IDLE")
        ),
        h("p", { style: "margin: .35rem 0 0; color: var(--text-2); font-size: .875rem;" }, jobSubtitle)
      ),
      h("div", { style: "display: flex; gap: .4rem;" },
        h("a", { class: "chip", href: "/workshop", "data-link": true, style: "font-size: .75rem;" }, "Workshop History"),
        h("a", { class: "chip", href: "/bambuddy", "data-link": true, style: "font-size: .75rem;" }, "Bambuddy ↗")
      )
    ),
    camContainer,
    progressSection
  );
}

function workshopLightCard(light, state) {
  if (!light) return null;
  const isOn = Boolean(light.on);

  const bulbIcon = h("span", { style: `font-size: 1.5rem; transition: opacity .2s; opacity: ${isOn ? '1' : '0.45'};` }, "💡");
  const nameLabel = h("span", { style: "display: flex; flex-direction: column; text-align: left; margin-left: .75rem; flex: 1;" },
    h("strong", { style: "font-size: 1rem; color: var(--text);" }, light.name || "Workshop Light"),
    h("span", { class: "meta", style: "font-size: .75rem; margin-top: .1rem;" }, "Govee Workbench Illumination")
  );
  const stateLabel = h("span", {
    style: `font-size: .8rem; font-weight: 700; padding: .2rem .6rem; border-radius: 999px; background: color-mix(in srgb, ${isOn ? '#f2c45c' : 'var(--text-3)'} 20%, transparent); color: ${isOn ? '#d49b20' : 'var(--text-3)'}; margin-right: .75rem;`
  }, isOn ? (light.brightness ? `On (${light.brightness}%)` : "On") : "Off");
  const btnAction = h("span", { class: "chip", style: "font-size: .8rem; font-weight: 700;" }, isOn ? "Turn Off" : "Turn On");

  const toggleBtn = h("button", {
    type: "button",
    class: `kiosk-light-toggle-btn ${isOn ? "is-on" : ""}`,
    onclick: async () => {
      toggleBtn.disabled = true;
      try {
        await post(`/api/home/${light.id}`, { characteristic: light.control || "On", value: !light.on });
        light.on = !light.on;
        toggleBtn.classList.toggle("is-on", light.on);
        stateLabel.textContent = light.on ? (light.brightness ? `On (${light.brightness}%)` : "On") : "Off";
        stateLabel.style.background = `color-mix(in srgb, ${light.on ? '#f2c45c' : 'var(--text-3)'} 20%, transparent)`;
        stateLabel.style.color = light.on ? '#d49b20' : 'var(--text-3)';
        bulbIcon.style.opacity = light.on ? "1" : "0.45";
        btnAction.textContent = light.on ? "Turn Off" : "Turn On";
      } catch (e) {
        toast(e.message, "bad");
      }
      toggleBtn.disabled = false;
    }
  }, bulbIcon, nameLabel, stateLabel, btnAction);

  return h("div", { class: "kiosk-light-card" },
    h("div", { style: "display: flex; justify-content: space-between; align-items: baseline; margin-bottom: .6rem;" },
      h("h3", { style: "margin: 0; font-size: .8125rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-2); font-weight: 700;" }, "Workshop Controls"),
      h("span", { class: "meta", style: "font-size: .75rem;" }, "One-Touch Workbench Light")
    ),
    toggleBtn
  );
}

function renderWallHeader(state, out) {
  if (!state.wallTime) {
    state.wallTime = h("h1", { class: "wall-time" });
    state.wallDate = h("p", { class: "wall-date" });
    state.wallWeather = h("div", { class: "wall-weather" });
    state.wallHead = h("header", { class: "wall-head" },
      h("div", {}, state.wallTime, state.wallDate),
      state.wallWeather
    );
  }

  const updateTime = () => {
    const d = new Date();
    state.wallTime.textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    state.wallDate.textContent = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  };
  updateTime();

  const w = out?.weather;
  const wxIcon = w ? weatherIcon(w.now.icon, w.now.sky) : null;
  const wxTemp = w ? h("p", { class: "wall-temp" }, `${w.now.temp}°`) : null;
  const wxSky = w ? h("p", { class: "wall-sky" }, w.now.sky) : null;

  const currentView = localStorage.getItem("pi_wall_view") || "workshop";

  const toggleViewBtn = h("button", {
    type: "button",
    class: `kiosk-btn ${currentView === "workshop" ? "active" : ""}`,
    onclick: () => {
      const next = currentView === "workshop" ? "ambient" : "workshop";
      localStorage.setItem("pi_wall_view", next);
      load(state);
    }
  }, currentView === "workshop" ? "🛠️ Workshop Focus" : "🏠 Ambient Home");

  const fullscreenBtn = h("button", {
    type: "button",
    class: "kiosk-btn",
    onclick: () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, "⛶ Kiosk");

  const tools = h("div", { class: "wall-tools" }, toggleViewBtn, fullscreenBtn);
  state.wallWeather.replaceChildren(...[wxIcon, wxTemp, wxSky, tools].filter(Boolean));
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

// A printer action on a card (Clear the plate): the same flow as the Workshop page's buttons.
function cardButton(action, onDone) {
  const b = h("button", { type: "button", class: "btn home-card-action" }, action.label || PRINTER_ACTIONS[action.do]?.label);
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
    c.items ? h("ul", { class: "home-card-items" }, c.items.slice(0, 4).map((i) =>
      h("li", { dataset: { tone: i.tone } }, h("a", go(i.link), h("strong", {}, i.title), i.detail ? h("span", { class: "meta" }, i.detail) : null)))) : null,
    c.note ? h("p", { class: "meta" }, c.note) : null,
    showCam ? h("img", { class: "house-cam-img home-card-cam", src: `/api/camera.jpg?t=${Date.now()}`, alt: "The X2D's camera", loading: "lazy" }) : null,
    c.action?.do ? cardButton(c.action, onDone)
      : c.action ? h("a", { class: "btn home-card-action", ...go(c.action.href) }, c.action.label) : null,
    c.link ? h("a", { class: "home-card-link meta", ...go(c.link.href) }, c.link.label) : null);
}

export function mount(state) {
  state.summary = h("p", { class: "summary", "aria-live": "polite", dataset: { tone: "none" } }, "Checking the house…");
  state.outside = h("div", { class: "outside-wrap" });
  state.eyebrow = h("p", { class: "hero-eyebrow" }, eyebrowLabel());
  
  state.band = h("div");
  state.issues = h("div");
  
  // Left column
  state.leftCol = h("div", { class: "now-col-left" }, state.band, state.issues);
  
  // Right column
  state.rightCol = h("div", { class: "now-col-right" });
  
  state.main = h("div", { class: "now-layout" }, state.leftCol, state.rightCol);

  if (isWallMode()) {
    renderWallHeader(state, null);
    state._clockTimer = setInterval(() => {
      if (state.wallTime && state.wallDate) {
        const d = new Date();
        state.wallTime.textContent = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
        state.wallDate.textContent = d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
      }
    }, 1000);

    const exitWall = h("div", { class: "wall-exit-wrap", style: "text-align: center; margin-top: 2.5rem; padding: 1rem 0;" },
      h("a", { href: "/", class: "btn btn--ghost small", "data-link": true, style: "opacity: 0.5; font-size: 0.85rem;" }, "← Exit wall display")
    );
    state.root.append(state.wallHead, state.summary, state.outside, state.main, exitWall);
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
  state.summary.hidden = !isWallMode() && d.issues.length > 0;
  if (state.hero) state.hero.hidden = state.summary.hidden && state.outside.childElementCount === 0;
  if (state.eyebrow) state.eyebrow.textContent = eyebrowLabel();


  // Wall Kiosk Mode Specialized Flow
  if (isWallMode()) {
    renderWallHeader(state, out);
    const currentView = localStorage.getItem("pi_wall_view") || "workshop";
    const shopLight = home.accessories.find(a => a.id === "27e5e4f8f7746b97a91a0a24384bd30696d4f76a751d582e35a0a4bb767547f6" || a.kind === "light");

    if (currentView === "workshop") {
      state.summary.hidden = true;
      state.outside.hidden = true;
      state.leftCol.replaceChildren(workshopKioskConsole(d, cam, home, state), state.issues);
      state.rightCol.replaceChildren(...[
        workshopLightCard(shopLight, state),
        networkPanel(d.network),
        displayAccessories.length > 1 ? h("section", { class: "home-favourites" },
          h("div", { style: "display: flex; justify-content: space-between; align-items: baseline; margin-bottom: .5rem;" },
            h("h2", { class: "section-title", style: "margin: 0;" }, controlsTitle),
            h("a", { href: "/control?from=home", "data-link": true, style: "font-size: .8125rem; color: var(--accent); text-decoration: none; font-weight: 500;" }, "All devices →")
          ),
          h("div", { class: "tiles" }, displayAccessories.filter(a => a.id !== shopLight?.id).map(a => tile(a, state)))) : null,
      ].filter(Boolean));
      renderIssues(state, d.issues);
      return;
    }
  }

  state.summary.hidden = false;
  if (state.hero) state.hero.hidden = false;
  if (!state.cards) {  // the wall's "Ambient Home" view: the same cards in its right column
    state.cards = h("div", { class: "home-cards" });
    state.leftCol.replaceChildren(state.band);
    state.rightCol.replaceChildren(state.cards);
  }
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
    state.extra = { needs, backups, latest };
    if (state.cards.isConnected) draw(state.extra);
  });
}

export function failed(state) {
  state.summary.textContent = "Can't reach the Pi Hub right now. It will keep trying.";
  state.summary.dataset.tone = "bad";
}

function renderIssues(state, issues) {
  const key = JSON.stringify(issues);
  if (state.issueKey !== key) { state.issueKey = key; state.issuesExpanded = false; }
  if (!issues.length) { state.issues.replaceChildren(); return; }
  const { shown, remaining } = splitIssues(issues);
  const item = i => h("li", { class: "alert-item", dataset: { tone: i.tone } },
    h("strong", { class: "alert-title" }, i.what), h("p", { class: "alert-desc" }, i.say),
    h("a", { class: "action", href: `/pi?help=${issueTopic(i)}&from=home`, "data-link": true }, "Get help"));
  const more = remaining ? h("details", { class: "issue-overflow", open: state.issuesExpanded,
    ontoggle: e => { state.issuesExpanded = e.currentTarget.open; } },
    h("summary", {}, `View all ${issues.length} issues`), h("ul", {}, issues.slice(shown.length).map(item))) : null;
  state.issues.replaceChildren(h("section", { class: `alerts-panel ${issues.some(i => i.tone === "bad") ? "is-critical" : ""}`, "aria-label": "Needs attention" },
    h("h2", { class: "section-title" }, `${issues.length} ${issues.length === 1 ? "thing needs" : "things need"} attention`),
    h("ul", {}, shown.map(item)), more));
}

export function leave(state) {
  clearInterval(state._eyebrowTimer);
  clearInterval(state._camTimer);
  if (state._clockTimer) clearInterval(state._clockTimer);
}
