// Weather: now, the next hours, the week, air quality and official warnings, for the saved town (A7 P1: the faceplate
// holds now; warnings are notices above it; the hours and the week are sections).
import { api, h, weatherIcon } from "./core.js";
import { faceplate, faceplateLoading, lampRows, section } from "./page-parts.js";

export const every = 300;

const day = (iso, i) => i === 0 ? "Today" : i === 1 ? "Tomorrow" : new Date(`${iso}T12:00`).toLocaleDateString([], { weekday: "long" });

export function mount(state) {
  state.body = h("div", { class: "stack" }, faceplateLoading("Weather"));
  state.root.append(state.body);
}

// The page's parts from /api/outside, so they can be checked without a browser.
export function weatherView(o) {
  const w = o?.weather;
  if (!w || !w.now || !Array.isArray(w.days) || !w.days.length) {
    const set = !!o?.place_set;
    return {
      sources: [set ? { name: "Open-Meteo", tone: "bad", word: "isn't answering" } : { name: "Open-Meteo", tone: "unknown", word: "no town set" }],
      parts: [faceplate({
        name: "Weather",
        lamp: set ? ["bad", "Not answering"] : ["unknown", "Town not set"],
        caption: set ? "The weather service isn't answering right now. It will try again in a few minutes." : "The hub needs your town to show the weather.",
        actions: set ? [] : [h("a", { class: "ui-btn ui-btn--primary", href: "/settings#group-outside", "data-link": true }, "Set it in Settings")],
      })],
    };
  }
  const speed = w.units === "F" ? "mph" : "km/h";
  const today = w.days[0];
  const hours = Array.isArray(w.hours) ? w.hours : [];
  return {
    sources: [{ name: "Open-Meteo", tone: "ok" }, ...(w.units === "F" ? [{ name: "National Weather Service", tone: "ok" }] : [])],
    parts: [
      ...(w.alerts || []).map((a) => h("div", { class: "ui-notice ui-notice--warn wx-alert", role: "alert" },
        h("strong", {}, a.event), h("p", {}, a.headline), a.advice ? h("details", {}, h("summary", {}, "What to do"), h("p", {}, a.advice)) : null)),
      faceplate({
        name: w.place || "Weather",
        lamp: w.alerts?.length ? ["warn", w.alerts.length === 1 ? "1 warning" : `${w.alerts.length} warnings`] : null,
        readout: `${w.now.temp}°`,
        caption: `${w.now.sky}. Feels like ${w.now.feels}°.`,
        readings: [
          ["High and low", `${today.high}° / ${today.low}°`],
          ["Wind", `${w.now.wind} ${speed}${w.now.gusts > w.now.wind + 5 ? `, gusts ${w.now.gusts}` : ""}`],
          ["Humidity", `${w.now.humidity}%`],
          ["UV", `${w.now.uv}${w.now.uv >= 6 ? ", high" : ""}`],
          ["Air quality", w.air ? `${w.air.label} (${w.air.aqi})` : null],
          ["Sunset", w.sunset || "—"],
        ],
        // What's coming (rain soon, frost tonight) is part of now, under the caption, not a panel of its own.
        extra: [w.soon || w.freeze_tonight ? h("p", { class: "ui-faceplate__caption wx-soon" },
          [w.soon, w.freeze_tonight ? `Freezing tonight, down to ${w.tonight_low}°.` : null].filter(Boolean).join(" ")) : null],
        aside: weatherIcon(w.now.icon, w.now.sky),
      }),
      hours.length ? section("Next hours", h("ol", { class: "wx-hours", tabindex: 0, "aria-label": "The next 24 hours" }, hours.map((x, i) => h("li", {},
        h("span", { class: "wx-h-time" }, i === 0 ? "Now" : x.label),
        weatherIcon(i === 0 ? w.now.icon : x.icon),
        h("span", { class: "wx-h-temp" }, `${i === 0 ? w.now.temp : x.temp}°`),
        h("span", { class: "wx-h-rain", style: `--pct:${x.rain}%` }, x.rain >= 10 ? `${x.rain}%` : "", h("span", { class: "sr" }, `${x.rain}% chance of rain`)))))) : null,
      section("This week", lampRows(w.days.map((d, i) => ({
        title: day(d.date, i),
        detail: `${d.sky}${d.rain >= 20 ? `, ${d.rain}% chance of rain` : ""}`,
        value: `${d.high}° / ${d.low}°`,
      }))), { note: `Units: °${w.units}, change them in Settings.` }),
    ].filter(Boolean),
  };
}

export async function load(state) {
  const v = weatherView(await api("/api/outside"));
  state.sources = v.sources;
  state.body.replaceChildren(...v.parts);
}
