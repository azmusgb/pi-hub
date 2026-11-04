// Home: the one-line answer, then the control room (Now, Needs you, Since you last looked; control-room.js). The wall
// display keeps its own layout and the house cards (home-cards.js).
import { api, clockTime, h, post, settle, toast, weatherIcon } from "./core.js";
import { tile } from "./control.js";
import { homeCards, labLink, needsSummary } from "./home-cards.js";
import { plainInternet, tileState, workshopDisplayLabel } from "./wording.js";
import { resolveLink, toolUrl } from "./sections.js";
import { setNeeds } from "./navigation.js";
import { mountControlRoom, loadControlRoom, leaveControlRoom, setControlNeeds, problemsBadge } from "./control-room.js";
import { PRINTER_ACTIONS, kioskBadge, printerBusy, runPrinterAction } from "./printer-actions.js";
import { clockParts, deskLab, nextHours, printing, shopLight, upcoming, wallLayout, wallNeeds,
  WALL_VIEWS, DEFAULT_CUSTOM_CONFIG, HERO_OPTIONS, SIDE_OPTIONS, getWallView, getWallCustomConfig, resolveWallPanes } from "./wall.js";

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
// `links: false` leaves out the Grafana and Uptime Kuma links, for a page that has them in its Open in row.
export function networkPanel(net, { links = true } = {}) {
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
    links ? h("p", { class: "meta" },
      h("a", { class: "tool-link", href: toolUrl("network"), target: "_blank", rel: "noopener" }, "Open Grafana ↗"), " ",
      h("a", { class: "tool-link", href: `${toolUrl("status")}status/home`, target: "_blank", rel: "noopener" }, "Open Uptime Kuma ↗")) : null);
}

function telemetryAge(iso) {
  const parsed = Date.parse(iso || "");
  const ms = Date.now() - parsed;
  if (!Number.isFinite(parsed) || !Number.isFinite(ms) || ms < 0) return "checked now";
  const sec = Math.floor(ms / 1000);
  if (sec < 10) return "checked now";
  if (sec < 60) return `checked ${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `checked ${min}m ago`;
  return `checked ${Math.floor(min / 60)}h ago`;
}

function printerMetric(label, value) {
  if (value === null || value === undefined || value === "") return null;
  return h("div", { class: "printer-metric" },
    h("span", { class: "printer-metric__label" }, label),
    h("strong", { class: "printer-metric__value" }, String(value)));
}

// A file name as a title: no extension, and "RIFT_MARKED_10IN_SINGLE" as "Rift marked 10in single". Mixed-case names
// are kept as they were written.
export function jobTitle(name) {
  const base = String(name || "").replace(/\.(gcode\.3mf|3mf|gcode)$/i, "").trim();
  if (!base) return "";
  const spaced = base.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (spaced !== spaced.toUpperCase()) return spaced;
  const lower = spaced.toLowerCase();
  return lower[0].toUpperCase() + lower.slice(1);
}

// The readings' source, as a chip. "Offline" only when a source answered and said so (Bambuddy with connected: false);
// no source answering says nothing about the printer, so that is "No answer" in the neutral colour (spec section 9).
export function telemetryLabel(p) {
  const telemetry = p?.telemetry || {};
  const reported = telemetry.status === "offline" && telemetry.source && telemetry.source !== "No source";
  let state = ["live", "degraded"].includes(telemetry.status) ? telemetry.status : reported ? "offline" : "none";
  // A printer that is printing or paused is physically there, whatever the telemetry says.
  if (state !== "live" && state !== "degraded" && (p?.state === "printing" || p?.state === "paused")) state = "degraded";
  // "Fallback" said nothing (iPad, 1 Nov): degraded means Bambuddy isn't connected and the Pi's status is read instead.
  const label = state === "live" ? "Live" : state === "degraded" ? "Backup readings" : state === "offline" ? "Offline" : "No answer";
  const why = state === "degraded"
    ? "Bambuddy isn't connected to the printer, so these readings come from the Pi's status service and update less often."
    : state === "none" ? "No source has answered with the printer's state." : telemetry.source || "Printer telemetry";
  return { state, label, why };
}

function telemetryBadge(p) {
  const { state, label, why } = telemetryLabel(p);
  return h("span", {
    class: "printer-source",
    dataset: { state },
    title: why
  },
    h("span", { class: "printer-source__dot", "aria-hidden": "true" }),
    label);
}

export function band(p, cam = null) {
  const pct = Number.isFinite(Number(p.progress))
    ? Math.max(0, Math.min(100, Number(p.progress)))
    : 0;
  const detail = p.state === "printing" && p.left
    ? ["Done in about ", h("strong", {}, p.left),
       finishAt(p.minutes_left) ? `, around ${finishAt(p.minutes_left)}` : ""]
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

  const layerValue = p.layer_num != null
    ? `${p.layer_num}${p.total_layers ? ` / ${p.total_layers}` : ""}`
    : null;

  const metrics = [
    printerMetric("Layer", layerValue),
    printerMetric(
      "Nozzle",
      p.nozzle_temp != null
        ? `${p.nozzle_temp}°C${p.nozzle_target != null ? ` / ${p.nozzle_target}°C` : ""}`
        : null
    ),
    printerMetric(
      "Bed",
      p.bed_temp != null
        ? `${p.bed_temp}°C${p.bed_target != null ? ` / ${p.bed_target}°C` : ""}`
        : null
    ),
    printerMetric("AMS", p.ams_humidity != null ? `${p.ams_humidity}% RH` : null),
    printerMetric("Material", p.filament_type || null),
  ].filter(Boolean);

  const source = p.telemetry || {};

  const isPrinting = p.state === "printing" || p.state === "paused";
  const displayHeadline = isPrinting && pct != null
    ? `${p.state === "paused" ? "Paused" : "Printing"} · ${pct}%`
    : p.headline;
  const cleanJob = jobTitle(p.job_name);

  return h("section", {
    class: cls,
    dataset: { state: p.state },
    "aria-label": "Bambu X2D printer"
  },
    h("div", { class: "band-content" },
      h("div", { class: "band-info" },
        h("div", { class: "printer-title-row" },
          h("p", { class: "band-name" }, "Bambu X2D"),
          telemetryBadge(p)),
        h("h2", { class: "band-headline" }, displayHeadline),
        cleanJob
          ? h("p", { class: "printer-job", title: p.job_name }, cleanJob)
          : null,
        h("div", {
          class: "line",
          role: "progressbar",
          "aria-label": "Print progress",
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": pct
        },
          h("div", { class: "line-track" }),
          h("div", { class: "line-bead", style: `width:${pct}%` })),
        h("p", { class: "band-detail" }, ...detail),
        metrics.length
          ? h("div", {
              class: "printer-metrics",
              "aria-label": "Live printer telemetry"
            }, ...metrics)
          : null,
        h("p", { class: "printer-freshness" },
          `${source.source || "Pi Hub"} · ${telemetryAge(source.observed_at)}`),
        lab
          ? h("a", {
              class: "tool-link",
              href: lab.href,
              target: "_blank",
              rel: "noopener"
            }, lab.label)
          : null
      ),
      camElement
    )
  );
}

// lab: the desk's way to the print lab, a link beside the printer's own (null on the wall).
function workshopKioskConsole(d, cam, lab = null, onDone = null) {
  const p = d.printer || {};
  const isPrinting = printing(p);
  const pct = p.progress || 0;
  const badge = kioskBadge(p);
  const chip = (text) => h("span", { class: "kiosk-hud-chip" }, text);

  const filamentText = p.filament_type ? `${p.filament_type}` : null;
  const filamentColor = p.filament_color ? `#${String(p.filament_color).replace(/^#/, "").slice(0, 6)}` : null;

  const camHud = h("div", { class: "kiosk-hud-overlay" },
    p.nozzle_temp !== undefined && p.nozzle_temp !== null
      ? chip(`🌡️ Nozzle: ${p.nozzle_temp}°C${p.nozzle_target ? ` / ${p.nozzle_target}°C` : ""}`) : null,
    p.bed_temp !== undefined && p.bed_temp !== null
      ? chip(`🛏️ Bed: ${p.bed_temp}°C${p.bed_target ? ` / ${p.bed_target}°C` : ""}`) : null,
    p.ams_humidity !== undefined && p.ams_humidity !== null ? chip(`💧 AMS: ${p.ams_humidity}% RH`) : null,
    filamentText ? h("span", { class: "kiosk-hud-chip" },
      filamentColor ? h("span", {
        class: "kiosk-hud-swatch",
        style: `background: ${filamentColor};`,
        "aria-hidden": "true"
      }) : null,
      filamentText
    ) : null
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
  const cleanJob = jobTitle(p.job_name);
  const jobTag = isPrinting && cleanJob ? [" · ", h("span", { class: "kiosk-job-tag" }, cleanJob)] : null;
  const jobSubtitle = isPrinting && p.left
    ? [done ? `${pct}% · ${p.left} to go` : `Done in about ${p.left}`, layer, jobTag]
    : (p.job_name ? `Job: ${cleanJob || p.job_name}` : (p.detail || "Ready for next print"));

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

  // Desk mode gets tactile printer action buttons (Pause / Resume / Clear the plate) right in the console header.
  const actionBtns = [];
  if (onDone && Array.isArray(p.actions)) {
    for (const act of p.actions) {
      const def = PRINTER_ACTIONS[act];
      if (!def) continue;
      const btn = h("button", {
        type: "button",
        class: `chip kiosk-action-btn${act === "clear" || act === "resume" ? " is-primary" : ""}`,
        disabled: printerBusy(),
      }, def.label);
      btn.addEventListener("click", () => runPrinterAction(act, [btn], onDone));
      actionBtns.push(btn);
    }
  }

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
        ...actionBtns,
        lab ? h("a", { class: `chip desk-lab${lab.judge ? " is-judge" : ""}`, ...go(lab.href) }, lab.label) : null,
        h("a", { class: "chip", href: "/workshop", "data-link": true }, "Workshop History"),
        h("a", { class: "chip", href: toolUrl("bambuddy"), target: "_blank", rel: "noopener" }, "Open Bambuddy ↗"))),
    progressSection,
    h("div", { class: "kiosk-cam-slot" }, camContainer)
  );
}

function workshopLightCard(light, w = {}) {
  if (!light) return null;
  // Unknown (Homebridge didn't report on/off) is "No answer" and can't be toggled: unknown is never Off.
  const known = tileState(light).known;
  const label = (on) => !known ? "No answer" : on ? (light.brightness ? `On (${light.brightness}%)` : "On") : "Off";
  const bulbIcon = h("span", { class: "kiosk-light-bulb", "aria-hidden": "true" }, "💡");
  const nameLabel = h("span", { class: "kiosk-light-name" },
    h("strong", {}, light.name || "Workshop Light"),
    h("span", { class: "meta" }, "Govee Workbench Illumination"));
  const stateLabel = h("span", { class: "kiosk-light-state" }, label(light.on));
  const btnAction = known ? h("span", { class: "chip kiosk-light-action" }, light.on ? "Turn Off" : "Turn On") : null;

  const toggleBtn = h("button", {
    type: "button",
    class: `kiosk-light-toggle-btn ${light.on ? "is-on" : ""}`,
    ...(known ? { "aria-pressed": String(Boolean(light.on)) } : { disabled: true }),
    onclick: async () => {
      if (!known) return;
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

function miniPrinterCard(p) {
  if (!p) return null;
  const isPrinting = printing(p);
  const pct = p.progress || 0;
  const badge = kioskBadge(p);
  return h("section", { class: "wall-tile", "aria-label": "3D Printer status" },
    h("div", { style: "display: flex; justify-content: space-between; align-items: center; margin-bottom: .4rem;" },
      h("div", { style: "display: flex; align-items: center; gap: .4rem;" },
        h("span", { "aria-hidden": "true" }, "🖨️"),
        h("strong", { style: "font-size: .95em;" }, "Bambu X2D")),
      h("span", { class: "kiosk-badge", dataset: { tone: badge.tone } }, badge.label)),
    isPrinting
      ? [
          h("div", { class: "line kiosk-line", style: "margin: .4rem 0;" },
            h("div", { class: "line-track" }),
            h("div", { class: "line-bead", style: `width:${pct}%` })),
          h("p", { class: "meta", style: "margin: 0; display: flex; justify-content: space-between;" },
            h("span", {}, `${pct}%${p.left ? ` · ${p.left} left` : ""}`),
            p.layer_num ? h("span", {}, `Layer ${p.layer_num} / ${p.total_layers || '?'}`) : null)
        ]
      : h("p", { class: "meta", style: "margin: 0;" }, p.headline || "Ready for next print"),
    h("div", { style: "margin-top: .5rem; display: flex; gap: .4rem;" },
      h("a", { class: "chip", style: "min-height: 38px; padding: 0 .7rem; font-size: .8em;", href: "/workshop", "data-link": true }, "Workshop →"),
      h("a", { class: "chip", style: "min-height: 38px; padding: 0 .7rem; font-size: .8em;", href: toolUrl("bambuddy"), target: "_blank", rel: "noopener" }, "Open Bambuddy ↗"))
  );
}

function mediaHeroConsole(d) {
  const movies = d.movies || {};
  const playing = movies.playing?.[0];
  const isPlaying = Boolean(playing);
  const badge = isPlaying
    ? { label: "NOW PLAYING", tone: "ok" }
    : movies.plex_running
      ? { label: "LIBRARY READY", tone: "ok" }
      : { label: "PLEX IDLE", tone: "none" };

  const titleText = isPlaying ? (playing.title || "Now Playing") : (movies.count ? `${movies.count} Movies Available` : "Movie Library");
  const subText = isPlaying
    ? [playing.user ? `Watched by ${playing.user}` : "Playing on Plex", playing.year ? ` · ${playing.year}` : ""]
    : [movies.drive ? `Drive: ${movies.drive}` : "Plex Media Server", movies.free ? ` · ${movies.free} free` : ""];

  return h("section", { class: "kiosk-console wall-tile", "aria-label": "Media and Entertainment" },
    h("div", { class: "kiosk-head" },
      h("div", { class: "kiosk-title" },
        h("div", { class: "kiosk-name" },
          h("span", { "aria-hidden": "true" }, "🎬"),
          h("h2", {}, "Media & Plex"),
          h("span", { class: "kiosk-badge", dataset: { tone: badge.tone } }, badge.label)),
        h("p", { class: "kiosk-pct", style: "font-size: clamp(1.4rem, 3.5vw, 2.5rem); margin: .2em 0;" }, titleText),
        h("p", { class: "kiosk-sub" }, ...subText)),
      h("div", { class: "kiosk-links" },
        h("a", { class: "chip", href: "/media", "data-link": true }, "Watch a movie"))),
    h("div", { class: "kiosk-cam-slot", style: "display: grid; place-items: center; background: color-mix(in srgb, var(--surface-2) 60%, transparent); border-radius: var(--r-md); padding: 1.5rem; text-align: center; border: 1px dashed var(--line);" },
      isPlaying
        ? h("div", { style: "display: flex; flex-direction: column; align-items: center; gap: .75rem;" },
            h("span", { style: "font-size: 3.5rem; line-height: 1;" }, "🍿"),
            h("strong", { style: "font-size: 1.25rem;" }, playing.title),
            h("p", { class: "meta", style: "margin: 0; max-width: 28em;" }, playing.summary || "Playing on your home entertainment system."))
        : h("div", { style: "display: flex; flex-direction: column; align-items: center; gap: .75rem;" },
            h("span", { style: "font-size: 3.5rem; line-height: 1;" }, "🎞️"),
            h("strong", { style: "font-size: 1.25rem;" }, "Ready for Movie Night"),
            h("p", { class: "meta", style: "margin: 0; max-width: 28em;" }, "Browse your Plex library, view recently added titles, and queue up films."))
    )
  );
}

function calendarHeroConsole(out) {
  const events = upcoming(out?.calendar, Date.now(), 8);
  const dateStr = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const w = out?.weather;

  const eventRows = events.length
    ? events.map((e) => h("li", {
        style: "display: grid; grid-template-columns: minmax(5.5em, auto) 1fr; gap: 1rem; padding: .65rem .85rem; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--line); align-items: baseline;"
      },
        h("span", { style: "font-weight: 700; color: var(--accent-strong); font-size: .9em;" }, e.all_day ? "All day" : clockTime(e.start)),
        h("span", { style: "font-weight: 600; font-size: .95em;" }, e.title)
      ))
    : [h("p", { class: "meta", style: "padding: 1.5rem; text-align: center;" }, "No upcoming appointments scheduled for today.")];

  return h("section", { class: "kiosk-console wall-tile", "aria-label": "Family and Agenda" },
    h("div", { class: "kiosk-head" },
      h("div", { class: "kiosk-title" },
        h("div", { class: "kiosk-name" },
          h("span", { "aria-hidden": "true" }, "📅"),
          h("h2", {}, "Family Agenda"),
          h("span", { class: "kiosk-badge", dataset: { tone: "ok" } }, `${events.length} ${events.length === 1 ? "EVENT" : "EVENTS"}`)),
        h("p", { class: "kiosk-pct", style: "font-size: clamp(1.4rem, 3.2vw, 2.2rem); margin: .2em 0;" }, dateStr),
        h("p", { class: "kiosk-sub" }, w?.now ? `${w.now.temp}° ${w.now.sky} · High ${w.days?.[0]?.high || w.now.temp}°` : "Upcoming household schedule")),
      h("div", { class: "kiosk-links" },
        h("a", { class: "chip", href: "/lists", "data-link": true }, "Lists & Notes"))),
    h("div", { class: "kiosk-cam-slot", style: "overflow-y: auto; padding: .25rem 0;" },
      h("ul", { style: "list-style: none; margin: 0; padding: 0; display: grid; gap: .5rem;" }, ...eventRows))
  );
}

function opsHeroConsole(d) {
  const net = d.network || {};
  const pi = d.pi || {};
  const ms = (v) => (Number.isFinite(v) ? `${Math.round(v * 10) / 10} ms` : "—");
  const tone = (v) => (!Number.isFinite(v) ? "bad" : v > 60 ? "warn" : "ok");

  const checkCard = (label, what, v) => h("div", {
    style: "display: flex; justify-content: space-between; align-items: center; padding: .55rem .85rem; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--line);"
  },
    h("div", { style: "display: flex; align-items: center; gap: .5rem;" },
      h("span", { class: "dot", dataset: { tone: tone(v) }, "aria-hidden": "true" }),
      h("strong", { style: "font-size: .9em;" }, label),
      h("span", { class: "meta", style: "font-size: .8em;" }, what)),
    h("span", { class: "status-side", style: "font-weight: 700; font-size: .9em; font-variant-numeric: tabular-nums;" }, ms(v))
  );

  return h("section", { class: "kiosk-console wall-tile", "aria-label": "System and Ops" },
    h("div", { class: "kiosk-head" },
      h("div", { class: "kiosk-title" },
        h("div", { class: "kiosk-name" },
          h("span", { "aria-hidden": "true" }, "🖥️"),
          h("h2", {}, "System & Network Ops"),
          h("span", { class: "kiosk-badge", dataset: { tone: net.status === "bad" ? "bad" : "ok" } }, net.status === "bad" ? "ISSUES" : "ONLINE")),
        h("p", { class: "kiosk-pct", style: "font-size: clamp(1.3rem, 3vw, 2rem); margin: .2em 0;" }, plainInternet(net)),
        h("p", { class: "kiosk-sub" }, [
          Number.isFinite(pi.temp) ? `Pi temp: ${Math.round(pi.temp)}°C` : "",
          Number.isFinite(pi.uptime_h) ? ` · Uptime: ${Math.round(pi.uptime_h)} h` : "",
          pi.disk_free_gb ? ` · ${pi.disk_free_gb} GB disk free` : ""
        ].filter(Boolean))),
      h("div", { class: "kiosk-links" },
        h("a", { class: "chip", href: toolUrl("network"), target: "_blank", rel: "noopener" }, "Open Grafana ↗"),
        h("a", { class: "chip", href: `${toolUrl("status")}status/home`, target: "_blank", rel: "noopener" }, "Open Uptime Kuma ↗"),
        h("a", { class: "chip", href: "/system", "data-link": true }, "System"))),
    h("div", { class: "kiosk-cam-slot", style: "overflow-y: auto; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15em), 1fr)); gap: .5rem; padding: .25rem 0;" },
      checkCard("Router", "The Orbi", net.orbi_ms),
      checkCard("AT&T Line", "WAN Link", net.att_ms),
      checkCard("Internet", "Cloud latency", net.wan_ms),
      checkCard("DNS", "Name lookups", net.dns_ms),
      checkCard("Windows PC", "Local AI / Paperless", net.win_ms),
      Number.isFinite(net.printer_ms) ? checkCard("3D Printer", "Bambu X2D", net.printer_ms) : null
    )
  );
}

function weatherHeroConsole(out) {
  const w = out?.weather;
  const now = w?.now || {};
  const today = w?.days?.[0] || {};
  const hours = nextHours(w?.hours, new Date(), 8);

  return h("section", { class: "kiosk-console wall-tile", "aria-label": "Weather and Forecast" },
    h("div", { class: "kiosk-head" },
      h("div", { class: "kiosk-title" },
        h("div", { class: "kiosk-name" },
          h("span", { "aria-hidden": "true" }, "⛅"),
          h("h2", {}, "Weather & Forecast"),
          h("span", { class: "kiosk-badge", dataset: { tone: "ok" } }, now.sky || "CURRENT")),
        h("p", { class: "kiosk-pct", style: "font-size: clamp(1.4rem, 3.5vw, 2.5rem); margin: .2em 0;" }, `${now.temp ?? "—"}° ${now.sky || ""}`),
        h("p", { class: "kiosk-sub" }, [
          today.high !== undefined ? `High ${today.high}° · Low ${today.low}°` : "",
          today.sunrise ? ` · 🌅 ${today.sunrise}  🌇 ${today.sunset}` : ""
        ].filter(Boolean))),
      h("div", { class: "kiosk-links" },
        h("a", { class: "chip", href: "/weather", "data-link": true }, "Full Forecast"))),
    h("div", { class: "kiosk-cam-slot", style: "overflow-y: auto; padding: .5rem 0;" },
      h("ul", { class: "wall-hours", style: "display: grid; grid-template-columns: repeat(auto-fit, minmax(4.5rem, 1fr)); gap: .5rem; margin: 0; padding: 0; list-style: none;" },
        hours.map((x) => h("li", { style: "display: flex; flex-direction: column; align-items: center; gap: .3rem; padding: .6rem .3rem; border-radius: var(--r-sm); background: var(--surface-2); border: 1px solid var(--line);" },
          h("span", { style: "font-size: .8em; color: var(--text-2);" }, x.label),
          weatherIcon(x.icon, ""),
          h("strong", { style: "font-size: 1.1em;" }, `${x.temp}°`),
          x.rain ? h("span", { class: "wall-rain", style: "font-size: .75em;" }, `${x.rain}%`) : null
        ))
      )
    )
  );
}

function openWallConfigDialog(state, initialTab = "presets") {
  const existing = document.querySelector(".wall-config-dialog");
  if (existing) existing.remove();

  let activeTab = initialTab;
  const currentView = wallView();
  const currentCustom = wallCustomConfig();

  const dialog = h("dialog", { class: "wall-config-dialog", "aria-labelledby": "wall-config-title" });

  const closeDialog = () => {
    dialog.close();
    dialog.remove();
  };

  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) closeDialog();
  });

  const title = h("h2", { id: "wall-config-title" }, "Wall Display Layout & Panes");
  const closeBtn = h("button", {
    type: "button",
    class: "kiosk-btn",
    style: "min-width: 44px; padding: 0 .75rem;",
    "aria-label": "Close settings",
    onclick: closeDialog
  }, "✕");

  const head = h("div", { class: "wall-config-head" }, title, closeBtn);

  const tabPresetsBtn = h("button", {
    type: "button",
    class: `kiosk-btn ${activeTab === "presets" ? "active" : ""}`,
    onclick: () => switchTab("presets")
  }, "📑 Presets");

  const tabCustomBtn = h("button", {
    type: "button",
    class: `kiosk-btn ${activeTab === "custom" ? "active" : ""}`,
    onclick: () => switchTab("custom")
  }, "⚙️ Customize Panes");

  const tabsBar = h("div", { class: "wall-config-tabs", style: "display: flex; gap: .5rem; margin: .75rem 0;" },
    tabPresetsBtn, tabCustomBtn);

  const contentArea = h("div", { class: "wall-config-content" });

  function renderPresetsTab() {
    const list = h("div", { class: "wall-preset-list" },
      ...WALL_VIEWS.map((v) => {
        const isActive = currentView === v.id;
        return h("button", {
          type: "button",
          class: `wall-preset-btn ${isActive ? "active" : ""}`,
          onclick: () => {
            if (v.id === "custom") {
              switchTab("custom");
              return;
            }
            try { localStorage.setItem("pi_wall_view", v.id); } catch {}
            closeDialog();
            load(state);
          }
        },
          h("strong", {}, v.label),
          h("span", { class: "meta" }, v.desc)
        );
      })
    );
    contentArea.replaceChildren(
      h("p", { class: "meta", style: "margin: 0 0 .5rem;" }, "Choose a preset view for this screen. Each device remembers its selection."),
      list
    );
  }

  function renderCustomTab() {
    let selectedHero = currentCustom.hero;
    const heroRadios = HERO_OPTIONS.map((opt) => {
      const radio = h("input", {
        type: "radio",
        name: "wall-hero-choice",
        value: opt.id,
        checked: selectedHero === opt.id,
        onchange: () => { selectedHero = opt.id; }
      });
      return h("label", { class: "wall-option-row" },
        radio,
        h("div", { class: "wall-option-text" },
          h("strong", {}, opt.label),
          h("span", { class: "meta" }, opt.desc))
      );
    });

    const sideChecked = new Set(currentCustom.side);
    const sideCheckboxes = SIDE_OPTIONS.map((opt) => {
      const box = h("input", {
        type: "checkbox",
        value: opt.id,
        checked: sideChecked.has(opt.id),
        onchange: (e) => {
          if (e.target.checked) sideChecked.add(opt.id);
          else sideChecked.delete(opt.id);
        }
      });
      return h("label", { class: "wall-option-row" },
        box,
        h("div", { class: "wall-option-text" },
          h("strong", {}, opt.label),
          h("span", { class: "meta" }, opt.desc))
      );
    });

    const applyBtn = h("button", {
      type: "button",
      class: "kiosk-btn active",
      style: "min-height: 44px; padding: 0 1.25rem;",
      onclick: () => {
        const side = Array.from(sideChecked);
        const finalSide = side.length ? side : DEFAULT_CUSTOM_CONFIG.side;
        const config = { hero: selectedHero, side: finalSide };
        try {
          localStorage.setItem("pi_wall_custom", JSON.stringify(config));
          localStorage.setItem("pi_wall_view", "custom");
        } catch {}
        closeDialog();
        load(state);
      }
    }, "Save & Apply Custom Layout");

    const resetBtn = h("button", {
      type: "button",
      class: "kiosk-btn",
      style: "min-height: 44px; padding: 0 1rem;",
      onclick: () => {
        try {
          localStorage.setItem("pi_wall_custom", JSON.stringify(DEFAULT_CUSTOM_CONFIG));
          localStorage.setItem("pi_wall_view", "custom");
        } catch {}
        closeDialog();
        load(state);
      }
    }, "Reset to Defaults");

    const actions = h("div", { style: "display: flex; gap: .75rem; margin-top: 1.25rem; flex-wrap: wrap;" },
      applyBtn, resetBtn);

    contentArea.replaceChildren(
      h("div", { class: "wall-custom-section" },
        h("h3", {}, "1. Main Hero Display (Left Pane)"),
        h("div", { style: "display: grid; gap: .25rem;" }, ...heroRadios)),
      h("div", { class: "wall-custom-section" },
        h("h3", {}, "2. Side Stack Tiles (Right Panes)"),
        h("div", { style: "display: grid; gap: .25rem;" }, ...sideCheckboxes)),
      actions
    );
  }

  function switchTab(tab) {
    activeTab = tab;
    tabPresetsBtn.classList.toggle("active", activeTab === "presets");
    tabCustomBtn.classList.toggle("active", activeTab === "custom");
    if (activeTab === "presets") renderPresetsTab();
    else renderCustomTab();
  }

  switchTab(activeTab);

  dialog.append(head, tabsBar, contentArea);
  document.body.append(dialog);
  dialog.showModal();
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
  try { return getWallView(localStorage.getItem("pi_wall_view")); } catch { return "workshop"; }
}

function wallCustomConfig() {
  try { return getWallCustomConfig(localStorage.getItem("pi_wall_custom")); } catch { return getWallCustomConfig(null); }
}

function switchWallLayoutMode(state, mode) {
  const isDesk = mode === "desk";
  state.desk = isDesk;
  try { localStorage.setItem("pi_wall_layout", isDesk ? "desk" : "wall"); } catch {}
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("layout", isDesk ? "desk" : "wall");
    window.history.replaceState({}, "", url.pathname + url.search);
  } catch {}
  if (state.wallBoard) state.wallBoard.dataset.layout = isDesk ? "desk" : "wall";
  load(state);
}

// One quiet toolbar in a corner: View Switcher, Desk/Wall Mode toggle, Kiosk (full screen) and Exit wall display.
function wallToolbar(state) {
  const exit = h("a", { href: "/", class: "kiosk-btn", "data-link": true }, "← Exit wall display");
  const view = wallView();
  const panes = resolveWallPanes(view, wallCustomConfig());
  const toggleViewBtn = h("button", {
    type: "button",
    class: "kiosk-btn active",
    title: "Switch view preset or customize panes",
    onclick: () => openWallConfigDialog(state, "presets")
  }, `${panes.label} ▾`);

  // The desk has a streamlined companion toolbar; switching between Desk and Wall layout is a single tap with no reload.
  if (state.desk) {
    const toWallBtn = h("button", {
      type: "button",
      class: "kiosk-btn",
      title: "Switch to TV / Wall layout",
      onclick: () => switchWallLayoutMode(state, "wall")
    }, "📺 Wall mode");
    return [toggleViewBtn, toWallBtn, exit];
  }

  const toDeskBtn = h("button", {
    type: "button",
    class: "kiosk-btn",
    title: "Switch to iPad Desk companion layout",
    onclick: () => switchWallLayoutMode(state, "desk")
  }, "📱 Desk mode");

  // Customize lives in the view dialog's second tab, so the toolbar stays one short row.
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

  return [toggleViewBtn, toDeskBtn, fullscreenBtn, exit];
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
  
  if (c.key === "needs" && c.items?.length > 1) {
    const primaryItem = c.items[0];
    const otherCount = c.items.length - 1;
    let expanded = false;

    const summaryCount = h("span", { class: "needs-triage-badge" }, `${c.items.length} total`);
    const toggleBtn = h("button", {
      type: "button",
      class: "btn btn-ghost needs-toggle-btn",
      "aria-expanded": "false"
    }, `+ ${otherCount} more issues ▾`);

    const extraContainer = h("div", { class: "needs-extra-items", hidden: true },
      needsList(c.items.slice(1), { max: 8, dense: true })
    );

    toggleBtn.addEventListener("click", () => {
      expanded = !expanded;
      extraContainer.hidden = !expanded;
      toggleBtn.setAttribute("aria-expanded", String(expanded));
      toggleBtn.textContent = expanded ? "Collapse issues ▴" : `+ ${otherCount} more issues ▾`;
    });

    return h("section", { class: `home-card home-card--needs`, dataset: { tone: c.tone }, "aria-labelledby": `card-${c.key}` },
      h("div", { class: "home-card-head" },
        h("div", { class: "needs-head-left" },
          h("h2", { id: `card-${c.key}`, class: "home-card-title" }, c.title),
          summaryCount
        ),
        h("span", { class: "dot", dataset: { tone: c.tone }, "aria-hidden": "true" })),
      h("p", { class: "home-card-status" }, "Action required:"),
      needsList([primaryItem], { max: 1 }),
      toggleBtn,
      extraContainer
    );
  }

  return h("section", { class: `home-card home-card--${c.key}`, dataset: { tone: c.tone }, "aria-labelledby": `card-${c.key}` },
    h("div", { class: "home-card-head" },
      h("h2", { id: `card-${c.key}`, class: "home-card-title" }, c.title),
      h("span", { class: "dot", dataset: { tone: c.tone }, "aria-hidden": "true" })),
    h("p", { class: "home-card-status" }, c.status),
    c.items?.length ? needsList(c.items, { max: 4 }) : null,
    c.note ? h("p", { class: "meta" }, c.note) : null,
    showCam ? h("div", { class: "home-card-cam-wrap", style: "position:relative; cursor:zoom-in;", onclick: () => openCameraModal(null) },
      h("img", { class: "house-cam-img home-card-cam", src: `/api/camera.jpg?t=${Date.now()}`, alt: "The X2D's camera", loading: "lazy" }),
      h("button", {
        type: "button",
        class: "hud-cam-btn",
        style: "position:absolute; top:6px; right:6px; z-index:5;",
        title: "Full Screen & Zoom",
        onclick: (e) => { e.stopPropagation(); openCameraModal(null); }
      }, "⛶")
    ) : null,
    c.action?.do ? cardButton(c.action, onDone)
      : c.action ? h("a", { class: "btn home-card-action", ...go(c.action.href) }, c.action.label) : null,
    c.link ? h("a", { class: "home-card-link meta", ...go(c.link.href) }, c.link.label) : null,
    c.lab ? h("a", { class: "home-card-link meta", ...go(c.lab.href) }, c.lab.label) : null);
}

// Global camera viewer modal state
let activeCamModal = null;

function openCameraModal(p) {
  if (activeCamModal) {
    try { activeCamModal.close(); } catch {}
    activeCamModal.remove();
    activeCamModal = null;
  }

  const modal = h("dialog", { class: "cam-modal", "aria-label": "Printer Camera Full View" });
  let zoom = 1;
  let posX = 0;
  let posY = 0;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let pinchDist = 0;

  const titleText = p ? `Bambu X2D · Layer ${p.layer_num || 0}/${p.total_layers || 0} (${p.progress || 0}%)` : "Bambu X2D Live Camera";
  
  const zoomDisplay = h("span", { class: "cam-modal-zoom-text" }, "100%");
  const img = h("img", {
    class: "cam-modal-img",
    src: `/api/camera.jpg?t=${Date.now()}`,
    alt: "Bambu X2D Full Camera Stream"
  });

  function updateTransform(anim = false) {
    img.style.transition = anim ? "transform 0.15s ease-out" : "none";
    img.style.transform = `translate(${posX}px, ${posY}px) scale(${zoom})`;
    zoomDisplay.textContent = `${Math.round(zoom * 100)}%`;
  }

  function adjustZoom(factor, centerX = 0, centerY = 0) {
    const oldZoom = zoom;
    zoom = Math.min(5, Math.max(1, zoom * factor));
    if (zoom === 1) {
      posX = 0;
      posY = 0;
    } else {
      posX = posX * (zoom / oldZoom);
      posY = posY * (zoom / oldZoom);
    }
    updateTransform(true);
  }

  function resetZoom() {
    zoom = 1;
    posX = 0;
    posY = 0;
    updateTransform(true);
  }

  let fitMode = "cover"; // "cover" to fill screen, "contain" to see entire sensor
  const btnFit = h("button", { type: "button", class: "hud-cam-btn", title: "Toggle Fill Screen / Fit Entire Sensor" }, "Fill");
  btnFit.onclick = () => {
    fitMode = fitMode === "cover" ? "contain" : "cover";
    img.style.objectFit = fitMode;
    btnFit.textContent = fitMode === "cover" ? "Fill" : "Fit";
  };

  const btnZoomIn = h("button", { type: "button", class: "hud-cam-btn", title: "Zoom In" }, "+");
  btnZoomIn.onclick = () => adjustZoom(1.3);

  const btnZoomOut = h("button", { type: "button", class: "hud-cam-btn", title: "Zoom Out" }, "-");
  btnZoomOut.onclick = () => adjustZoom(0.77);

  const btnReset = h("button", { type: "button", class: "hud-cam-btn", title: "Reset Zoom" }, "1:1");
  btnReset.onclick = () => resetZoom();

  const btnClose = h("button", { type: "button", class: "hud-cam-btn", title: "Close" }, "✕");
  btnClose.onclick = () => modal.close();

  // HTML5 fullscreen toggle
  const btnFs = h("button", { type: "button", class: "hud-cam-btn", title: "Native Fullscreen" }, "⛶");
  btnFs.onclick = () => {
    if (!document.fullscreenElement) {
      modal.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const stage = h("div", { class: "cam-modal-stage" }, img);

  // Mouse wheel zoom
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    adjustZoom(e.deltaY < 0 ? 1.15 : 0.85);
  }, { passive: false });

  // Double click / tap to toggle zoom
  let lastTap = 0;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target !== img && e.target !== stage) return;
    isDragging = true;
    startX = e.clientX - posX;
    startY = e.clientY - posY;
    stage.setPointerCapture?.(e.pointerId);

    const now = Date.now();
    if (now - lastTap < 300) {
      if (zoom > 1) resetZoom();
      else adjustZoom(2.5);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  });

  stage.addEventListener("pointermove", (e) => {
    if (!isDragging || zoom <= 1) return;
    posX = e.clientX - startX;
    posY = e.clientY - startY;
    updateTransform(false);
  });

  const stopDrag = (e) => {
    isDragging = false;
    try { stage.releasePointerCapture?.(e.pointerId); } catch {}
  };
  stage.addEventListener("pointerup", stopDrag);
  stage.addEventListener("pointercancel", stopDrag);

  // Pinch to zoom for touch devices (iPad / iPhone)
  stage.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  stage.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && pinchDist > 0) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      adjustZoom(dist / pinchDist);
      pinchDist = dist;
    }
  }, { passive: true });

  stage.addEventListener("touchend", (e) => {
    if (e.touches.length < 2) pinchDist = 0;
  }, { passive: true });

  // Header & Footer
  const header = h("div", { class: "cam-modal-header" },
    h("div", { class: "cam-modal-title" },
      h("span", { class: "dot", dataset: { tone: "warn" } }),
      titleText
    ),
    h("div", { class: "cam-modal-actions" },
      zoomDisplay,
      btnFit,
      btnZoomOut,
      btnZoomIn,
      btnReset,
      btnFs,
      btnClose
    )
  );

  const footer = h("div", { class: "cam-modal-footer" },
    h("span", {}, "Live feed: updates every 1.5s"),
    h("span", {}, "Pinch, scroll, or double-tap to zoom · Drag to pan")
  );

  modal.append(header, stage, footer);
  document.body.append(modal);

  // Auto-refresh interval while open
  const timer = setInterval(() => {
    if (!modal.open) return;
    img.src = `/api/camera.jpg?t=${Date.now()}`;
  }, 1500);

  modal.addEventListener("close", () => {
    clearInterval(timer);
    modal.remove();
    activeCamModal = null;
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  });

  activeCamModal = modal;
  modal.showModal();
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
    // Home is the control room: Now (the printer leads it), Needs you, Since you last looked (platform 5.5). The
    // rail reaches every area, so Home carries no area cards or shortcut chips. The Home tab's badge counts Needs you
    // once it has answered.
    state.homeMode = true;
    state.control = h("div", { class: "home-control" });
    mountControlRoom(state, state.control, { search: false });
    state.homeNeedsAnswered = false;
    state.onProblems = (probs) => { if (state.homeNeedsAnswered) setNeeds(problemsBadge(state.needs, probs)); };
    state.root.append(state.hero, state.control);
  }

  if (state._eyebrowTimer) clearInterval(state._eyebrowTimer);
  state._eyebrowTimer = setInterval(() => {
    if (state.eyebrow) state.eyebrow.textContent = eyebrowLabel();
  }, 15 * 60 * 1000);

  if (state._camTimer) clearInterval(state._camTimer);
  state._camTimer = setInterval(() => {
    const imgs = state.root.querySelectorAll(".band-cam-img, .house-cam-img, .kiosk-cam-img, .cr-hero-cam-img");
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
  
  // Setup steps live in Settings; Home carries no setup nags (control-room: "No setup nags").
  state.outside.replaceChildren(...[outsideLine(out)].filter(Boolean));

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

  // Now's printer camera opens the full view; the camera answered or not decides whether Now shows it at all.
  state.cameraOk = !!cam?.ok;
  state.openCamera = () => openCameraModal(d.printer);

  // The line holds the hub's own words until Needs you answers; while the hub counts problems, it waits for Needs you
  // (the card and the badge carry the count), so no count flashes up and goes.
  const line = (text) => {
    state.summary.textContent = text;
    state.summary.hidden = !text;
    if (state.hero) state.hero.hidden = state.summary.hidden && state.outside.childElementCount === 0;
  };
  line(state.extra ? needsSummary(state.extra.needs, d.summary) : d.issues.length ? "" : d.summary);  // a refresh: the last answer
  // Needs you fills in when it answers (it gives up after 4 s), so the page never waits on it.
  loadControlRoom(state, state.extra ? state.extra.needs : null).catch(() => {});
  settle(api("/api/needs"), 4000, null).then((needs) => {
    state.homeNeedsAnswered = true;
    setControlNeeds(state, needs);  // renders Needs you, which sets the badge
    if (state.summary.isConnected) line(needsSummary(needs, d.summary));
    state.extra = { needs };
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

  const viewId = wallView();
  const customConfig = wallCustomConfig();
  const panes = resolveWallPanes(viewId, customConfig);

  if (panes.side.includes("needs")) {
    state.wallNeeds.style.display = "";
    renderWallNeeds(state, needs);
  } else {
    state.wallNeeds.style.display = "none";
  }

  if (panes.side.includes("extra")) {
    state.wallExtra.style.display = "";
    renderWallExtra(state, out);
  } else {
    state.wallExtra.style.display = "none";
  }

  state.wallBoard.dataset.printing = printing(d.printer) ? "1" : "0";
  state.wallBoard.dataset.extra = state.wallExtra.childElementCount && panes.side.includes("extra") ? "1" : "0";
  state.wallBoard.dataset.needsMany = (needs?.items?.length || 0) > 2 ? "1" : "0";
  state.wallTools.replaceChildren(...wallToolbar(state));

  let heroElement;
  if (panes.hero === "media") {
    heroElement = mediaHeroConsole(d);
  } else if (panes.hero === "calendar") {
    heroElement = calendarHeroConsole(out);
  } else if (panes.hero === "ops") {
    heroElement = opsHeroConsole(d);
  } else if (panes.hero === "weather") {
    heroElement = weatherHeroConsole(out);
  } else {
    heroElement = workshopKioskConsole(d, cam, state.desk ? deskLab(d.printer) : null, state.desk ? () => load(state) : null);
  }
  state.wallPrint.replaceChildren(heroElement);

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
  if (viewId === "ambient") {
    // Ambient Home: Home's cards (less Needs you, which has its own tile) in the house column.
    state.wallHouse.replaceChildren(h("div", { class: "home-cards" },
      ...homeCards({ now: d, home, needs }).filter((c) => c.key !== "needs").map((c) => homeCard(c, cam, () => load(state)))));
    return;
  }

  const light = shopLight(home.accessories);
  const others = displayAccessories.filter(a => a.id !== light?.id);
  const houseWidgets = [];

  if (panes.side.includes("controls")) {
    if (light) houseWidgets.push(workshopLightCard(light, d.workshop));
    if (others.length) {
      houseWidgets.push(h("section", { class: "home-favourites wall-tile" },
        h("div", { class: "wall-favourites-head" },
          h("h2", { class: "section-title" }, controlsTitle),
          h("a", { href: "/devices", "data-link": true }, "All devices →")),
        h("div", { class: "tiles" }, others.map(a => tile(a, state)))));
    }
  }

  if (panes.side.includes("network")) {
    const net = networkPanel(d.network);
    if (net) houseWidgets.push(net);
  }

  if (panes.side.includes("home_cards")) {
    houseWidgets.push(h("div", { class: "home-cards" },
      ...homeCards({ now: d, home, needs }).filter((c) => c.key !== "needs").map((c) => homeCard(c, cam, () => load(state)))));
  }

  if (panes.side.includes("printer_mini") && panes.hero !== "printer") {
    const mini = miniPrinterCard(d.printer);
    if (mini) houseWidgets.push(mini);
  }

  if (panes.side.includes("media") && panes.hero !== "media") {
    const mediaC = homeCards({ now: d, home, needs }).find((c) => c.key === "media");
    if (mediaC) houseWidgets.push(homeCard(mediaC, cam, () => load(state)));
  }

  if (panes.side.includes("system") && panes.hero !== "ops") {
    const sysC = homeCards({ now: d, home, needs }).find((c) => c.key === "system");
    if (sysC) houseWidgets.push(homeCard(sysC, cam, () => load(state)));
  }

  if (panes.side.includes("calendar") && panes.hero !== "calendar" && !panes.side.includes("extra")) {
    const events = upcoming(out?.calendar, Date.now(), 4);
    if (events.length) {
      houseWidgets.push(h("section", { class: "wall-tile wall-agenda", "aria-label": "Coming up" },
        h("h2", {}, "Coming up"),
        h("ul", {}, events.map((e) => h("li", {},
          h("span", { class: "wall-when" }, e.all_day ? "All day" : clockTime(e.start)), h("span", {}, e.title))))));
    }
  }

  state.wallHouse.replaceChildren(...houseWidgets.filter(Boolean));
}

export function leave(state) {
  if (activeCamModal) {
    try { activeCamModal.close(); } catch {}
    activeCamModal.remove();
    activeCamModal = null;
  }
  if (state.homeMode) leaveControlRoom(state);
  clearInterval(state._eyebrowTimer);
  clearInterval(state._camTimer);
  if (state._clockTimer) clearInterval(state._clockTimer);
}
