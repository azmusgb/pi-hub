// Workshop: the X2D now and its print history, the touchscreen, and Local AI.
import { api, card, duration, empty, h, when } from "./core.js";
import { band } from "./now.js";

export const every = 15;

const OUTCOME = { finished: ["Finished", "ok"], stopped: ["Stopped", "warn"], failed: ["Failed", "bad"] };

export function mount(state) {
  state.band = h("div");
  state.body = h("div", { class: "cards" });
  state.root.append(state.band, state.body);
}

export async function load(state) {
  const d = await api("/api/workshop");
  state.band.replaceChildren(band(d.printer));
  const prints = d.prints.map((p) => {
    const [label, tone] = p.ended ? (OUTCOME[p.outcome] || ["Ended", "warn"]) : ["Printing", "ok"];
    return h("li", { class: "log-row" },
      h("span", { class: "dot", dataset: { tone } }),
      h("span", { class: "log-main" }, h("strong", {}, label), h("span", { class: "meta" }, when(p.started))),
      h("span", { class: "log-side" }, p.ended ? duration(p.ended - p.started) : `${p.progress}% so far`));
  });
  state.body.replaceChildren(
    card("Print history", { pill: `${d.week.finished} finished this week`, tone: "ok", cls: "wide" },
      prints.length ? h("ul", { class: "log" }, prints) : empty("Prints show up here once the hub has seen one start."),
      h("p", { class: "meta" }, `${d.week.hours} hours of printing in the last 7 days.`)),
    card("Workshop display", { pill: d.display.state, tone: d.display.state === "Online" ? "ok" : "bad" },
      h("dl", { class: "facts" },
        h("div", {}, h("dt", {}, "Firmware"), h("dd", {}, d.display.firmware || "—"))),
      h("a", { class: "action", href: "http://10.0.0.124", target: "_blank", rel: "noopener" }, "Open the display's page")),
    card("Local AI", { pill: d.ai.state, tone: d.ai.state === "Down" ? "bad" : "ok" },
      d.ai.state === "Down"
        ? h("p", { class: "meta" }, "The Windows PC isn't answering. It may be off, or the room's breaker tripped.")
        : h("dl", { class: "facts" },
          h("div", {}, h("dt", {}, "Models loaded"), h("dd", {}, d.ai.models.length ? d.ai.models.join(", ") : "None")),
          h("div", {}, h("dt", {}, "Jobs waiting"), h("dd", {}, String(d.ai.waiting ?? 0)))),
      h("a", { class: "action", href: "https://10.0.0.21", target: "_blank", rel: "noopener" }, "Open Local AI")),
  );
}
