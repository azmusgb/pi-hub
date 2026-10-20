// Weather: now, the next hours, the week, air quality and official warnings, for the saved town.
import { api, card, empty, h, weatherIcon } from "./core.js";

export const every = 300;

const day = (iso, i) => i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(`${iso}T12:00`).toLocaleDateString([], { weekday: "long" });

export function mount(state) {
  state.body = h("div", { class: "stack" });
  state.root.append(state.body);
}

export async function load(state) {
  const o = await api("/api/outside");
  const w = o.weather;
  if (!w) {
    state.body.replaceChildren(card("Set your town", { cls: "wide" },
      h("p", {}, o.place_set ? "The weather service isn't answering right now. It will try again in a few minutes." : "The hub needs your town to show the weather."),
      o.place_set ? null : h("a", { class: "action", href: "/settings", "data-link": true }, "Set it in Settings")));
    return;
  }
  const u = `°${w.units}`;
  const speed = w.units === "F" ? "mph" : "km/h";
  const lows = Math.min(...w.days.map((d) => d.low)), highs = Math.max(...w.days.map((d) => d.high));
  const span = Math.max(1, highs - lows);
  state.body.replaceChildren(...[
    ...(w.alerts || []).map((a) => h("section", { class: "wx-alert", role: "alert" },
      h("strong", {}, a.event), h("p", {}, a.headline), a.advice ? h("details", {}, h("summary", {}, "What to do"), h("p", {}, a.advice)) : null)),
    h("section", { class: "wx-now" },
      weatherIcon(w.now.icon, w.now.sky),
      h("div", {},
        h("p", { class: "wx-temp" }, `${w.now.temp}°`),
        h("p", { class: "wx-sky" }, `${w.now.sky}. Feels like ${w.now.feels}°.`),
        h("p", { class: "meta" }, w.place)),
      h("dl", { class: "facts wx-facts" },
        h("div", {}, h("dt", {}, "High and low"), h("dd", {}, `${w.days[0].high}° / ${w.days[0].low}°`)),
        h("div", {}, h("dt", {}, "Wind"), h("dd", {}, `${w.now.wind} ${speed}${w.now.gusts > w.now.wind + 5 ? `, gusts ${w.now.gusts}` : ""}`)),
        h("div", {}, h("dt", {}, "Humidity"), h("dd", {}, `${w.now.humidity}%`)),
        h("div", {}, h("dt", {}, "UV"), h("dd", {}, `${w.now.uv}${w.now.uv >= 6 ? ", high" : ""}`)),
        w.air ? h("div", {}, h("dt", {}, "Air quality"), h("dd", { dataset: { tone: w.air.aqi > 100 ? "bad" : "ok" } }, `${w.air.label} (${w.air.aqi})`)) : null,
        h("div", {}, h("dt", {}, "Sunset"), h("dd", {}, w.sunset || "—")))),
    w.soon || w.freeze_tonight ? h("p", { class: "wx-soon" }, [w.soon, w.freeze_tonight ? `Freezing tonight, down to ${w.tonight_low}°.` : null].filter(Boolean).join(" ")) : null,
    h("section", { class: "row-section" }, h("h2", { class: "section-title" }, "Next hours"),
      h("ol", { class: "wx-hours", tabindex: 0, "aria-label": "The next 24 hours" }, w.hours.map((x, i) => h("li", {},
        h("span", { class: "wx-h-time" }, i === 0 ? "Now" : x.label),
        weatherIcon(i === 0 ? w.now.icon : x.icon),
        h("span", { class: "wx-h-temp" }, `${i === 0 ? w.now.temp : x.temp}°`),
        h("span", { class: "wx-h-rain", style: `--p:${x.rain}%` }, x.rain >= 10 ? `${x.rain}%` : "", h("span", { class: "sr" }, `${x.rain}% chance of rain`)))))),
    card("This week", { cls: "wide" },
      h("ol", { class: "wx-days" }, w.days.map((d, i) => h("li", {},
        h("span", { class: "wx-d-day" }, day(d.date, i)),
        weatherIcon(d.icon, d.sky),
        h("span", { class: "wx-d-rain" }, d.rain >= 20 ? `${d.rain}%` : ""),
        h("span", { class: "wx-d-low" }, `${d.low}°`),
        h("span", { class: "wx-range", "aria-hidden": "true" },
          h("i", { style: `left:${((d.low - lows) / span) * 100}%;right:${100 - ((d.high - lows) / span) * 100}%` })),
        h("span", { class: "wx-d-high" }, `${d.high}°`))))),
    h("p", { class: "meta" }, `Forecast from Open-Meteo${w.units === "F" ? ", warnings from the US National Weather Service" : ""}. Units: ${u}, change them in Settings.`),
  ].filter(Boolean));
}
