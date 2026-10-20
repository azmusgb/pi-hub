// Rules: "when this happens, do that", picked from lists. Plus what the hub has noticed lately.
import { api, card, empty, ensure, h, post, toast, when } from "./core.js";

export const every = 30;

export function mount(state) {
  state.body = h("div", { class: "cards" });
  state.root.append(state.body);
}

function select(id, label, options, value) {
  return h("label", { class: "field", for: id }, h("span", {}, label),
    h("select", { id, name: id }, options.map((o) => h("option", { value: o.key, selected: o.key === value }, o.label))));
}

function builder(state, d) {
  const form = h("form", { class: "rule-form", onsubmit: async (e) => {
    e.preventDefault();
    if (!(await ensure("household"))) return;
    const v = Object.fromEntries(new FormData(form));
    try {
      await post("/api/rules", { trigger: v.trigger, action: v.action, target: v.target || null });
      toast("Rule added.");
      state.force = true;
      load(state);
    } catch (x) { toast(x.message, "bad"); }
  } });
  const target = h("label", { class: "field", for: "target" }, h("span", {}, "Which one"),
    d.accessories.length
      ? h("select", { id: "target", name: "target" }, d.accessories.map((a) => h("option", { value: a.id }, a.name)))
      : h("p", { class: "meta" }, "Connect Homebridge in Settings to pick a light or plug."));
  const action = select("action", "Then", d.actions.map((a) => ({ key: a.key, label: a.label })), "notify");
  const sync = () => {
    const a = d.actions.find((x) => x.key === form.elements.action.value);
    target.hidden = !a?.needs_target;
  };
  action.querySelector("select").addEventListener("change", sync);
  form.append(select("trigger", "When", d.triggers.map((t) => ({ key: t.key, label: t.label })), "print_finished"),
    action, target, h("button", { type: "submit", class: "primary" }, "Add rule"));
  queueMicrotask(sync);
  return form;
}

export async function load(state) {
  if (!state.force && state.root.contains(document.activeElement) && document.activeElement.tagName === "SELECT") return;
  state.force = false;
  const d = await api("/api/rules");
  const rules = d.rules.map((r) => h("li", { class: "rule", dataset: { on: String(!!r.enabled) } },
    h("label", { class: "switch" },
      h("input", { type: "checkbox", role: "switch", checked: !!r.enabled, "aria-label": r.text,
        onchange: async (e) => {
          if (!(await ensure("household"))) { e.target.checked = !e.target.checked; return; }
          await post(`/api/rules/${r.id}/toggle`); load(state);
        } }),
      h("span", { class: "switch-track", "aria-hidden": "true" })),
    h("span", { class: "rule-main" }, h("strong", {}, r.text),
      r.last_run ? h("span", { class: "meta" }, `Last ran ${when(r.last_run)}: ${r.last_result}`) : h("span", { class: "meta" }, "Hasn't run yet.")),
    h("button", { class: "ghost small", "aria-label": `Remove: ${r.text}`, onclick: async () => {
      if (!(await ensure("household"))) return;
      await post(`/api/rules/${r.id}/delete`); toast("Rule removed."); load(state);
    } }, "Remove")));
  state.body.replaceChildren(
    card("Your rules", { cls: "wide", pill: `${d.rules.filter((r) => r.enabled).length} on` , tone: "ok" },
      rules.length ? h("ul", { class: "rules" }, rules) : empty("No rules yet. Add one below."),
      d.alerts_ready ? null : h("p", { class: "note" }, "Phone alerts aren't set up on this Pi, so “send a phone alert” won't reach anyone.")),
    card("Add a rule", {}, builder(state, d)),
    card("What the hub noticed", { pill: d.events.length ? `${d.events.length} recent` : null },
      d.events.length
        ? h("ul", { class: "log" }, d.events.slice(0, 15).map((e) => h("li", { class: "log-row" },
          h("span", { class: "dot", dataset: { tone: /drops|fails|down|stops|hotter/.test(e.text) ? "bad" : "ok" } }),
          h("span", { class: "log-main" }, h("strong", {}, e.text.charAt(0).toUpperCase() + e.text.slice(1)), e.detail ? h("span", { class: "meta" }, e.detail) : null),
          h("span", { class: "log-side" }, when(e.ts)))))
        : empty("Nothing yet. Changes like a print finishing or the drive dropping out show up here.")),
  );
}
