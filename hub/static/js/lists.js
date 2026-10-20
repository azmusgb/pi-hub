// Lists: shopping, to do and notes, shared by everyone in the house.
import { api, h, post, toast } from "./core.js";

export const every = 20;

const ORDER = ["shopping", "todo", "notes"];
const PLACEHOLDER = { shopping: "Add something to buy", todo: "Add a job", notes: "Write a note for the house" };

export function mount(state) {
  state.active = sessionStorage.getItem("hub-list") || "shopping";
  state.tabs = h("div", { class: "tabs", role: "tablist", "aria-label": "Lists" });
  state.panel = h("section", { class: "card list-card", role: "tabpanel" });
  state.root.append(state.tabs, state.panel);
}

function render(state) {
  const data = state.data;
  state.tabs.replaceChildren(...ORDER.map((key) => {
    const open = data[key].items.filter((i) => !i.done).length;
    return h("button", {
      role: "tab", class: "tab", "aria-selected": String(key === state.active), id: `tab-${key}`,
      onclick: () => { state.active = key; try { sessionStorage.setItem("hub-list", key); } catch {} render(state); },
    }, data[key].name, open ? h("span", { class: "count" }, String(open)) : null);
  }));
  const key = state.active;
  const list = data[key];
  const input = h("input", { type: "text", id: "list-new", maxlength: 200, placeholder: PLACEHOLDER[key], autocomplete: "off", enterkeyhint: "done" });
  const notes = key === "notes";
  const items = list.items.map((i) => h("li", { class: `item ${i.done ? "done" : ""}` },
    notes ? null : h("input", {
      type: "checkbox", id: `item-${i.id}`, checked: !!i.done,
      onchange: async () => { await post(`/api/lists/${key}/${i.id}/toggle`); refresh(state); },
    }),
    h(notes ? "p" : "label", notes ? { class: "note-text" } : { for: `item-${i.id}` }, i.text),
    h("button", {
      class: "ghost small", "aria-label": `Remove ${i.text}`,
      onclick: async () => { await post(`/api/lists/${key}/${i.id}/delete`); refresh(state); },
    }, "Remove")));
  const anyDone = list.items.some((i) => i.done);
  state.panel.setAttribute("aria-labelledby", `tab-${key}`);
  state.panel.replaceChildren(
    h("form", { class: "add", onsubmit: async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      try { await post(`/api/lists/${key}`, { text }); input.value = ""; await refresh(state); document.getElementById("list-new")?.focus(); }
      catch (err) { toast(err.message, "bad"); }
    } }, h("label", { for: "list-new", class: "sr" }, PLACEHOLDER[key]), input, h("button", { type: "submit", class: "primary" }, "Add")),
    items.length ? h("ul", { class: "items" }, items)
      : h("p", { class: "empty" }, notes ? "No notes yet. Leave one for the house." : "Nothing on this list."),
    anyDone && !notes ? h("button", { class: "ghost", onclick: async () => { await post(`/api/lists/${key}/clear-done`); refresh(state); } }, "Clear ticked items") : null,
  );
}

async function refresh(state) {
  state.data = await api("/api/lists");
  render(state);
}

export async function load(state) {
  // Don't redraw under someone who's typing.
  if (document.activeElement?.id === "list-new" && document.activeElement.value) return;
  await refresh(state);
}
