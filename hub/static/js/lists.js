// Lists: shopping, to do and notes, shared by everyone in the house.
import { api, ensure, h, post, toast, when } from "./core.js";

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
  const remindable = key === "todo";
  const remind = h("input", { type: "checkbox", id: "remind-on" });
  const at = h("input", { type: "datetime-local", id: "remind-at", "aria-label": "Remind me at" });
  const rep = h("select", { id: "remind-repeat", "aria-label": "Repeat" },
    h("option", { value: "" }, "Once"), h("option", { value: "daily" }, "Every day"), h("option", { value: "weekly" }, "Every week"));
  const remindRow = h("div", { class: "remind-row", hidden: true }, at, rep);
  remind.addEventListener("change", () => {
    remindRow.hidden = !remind.checked;
    if (remind.checked && !at.value) {
      const t = new Date(Date.now() + 3600000); t.setMinutes(0, 0, 0);
      at.value = new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    }
  });
  const items = list.items.map((i) => {
    if (notes) {
      return h("li", { class: "note-card" },
        h("p", { class: "note-text" }, i.text),
        h("button", {
          class: "ghost small note-remove", "aria-label": `Remove note`,
          onclick: async () => { await post(`/api/lists/${key}/${i.id}/delete`); refresh(state); },
        }, "✕")
      );
    }
    return h("li", { class: `item ${i.done ? "done" : ""}` },
      h("input", {
        type: "checkbox", id: `item-${i.id}`, checked: !!i.done,
        onchange: async () => { await post(`/api/lists/${key}/${i.id}/toggle`); refresh(state); },
      }),
      h("label", { for: `item-${i.id}` }, i.text,
        i.due ? h("span", { class: "due" }, `${i.repeat === "daily" ? "Every day, next " : i.repeat === "weekly" ? "Every week, next " : "Reminds "}${when(i.due)}`) : null),
      h("button", {
        class: "ghost small remove-btn", "aria-label": `Remove ${i.text}`,
        onclick: async () => { await post(`/api/lists/${key}/${i.id}/delete`); refresh(state); },
      }, "✕")
    );
  });
  const anyDone = list.items.some((i) => i.done);
  state.panel.setAttribute("aria-labelledby", `tab-${key}`);
  state.panel.replaceChildren(
    h("form", { class: "add-bar", onsubmit: async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      const extra = remindable && remind.checked && at.value ? { due: Math.floor(new Date(at.value).getTime() / 1000), repeat: rep.value } : {};
      try { await post(`/api/lists/${key}`, { text, ...extra }); input.value = ""; await refresh(state); document.getElementById("list-new")?.focus(); }
      catch (err) { toast(err.message, "bad"); }
    } }, h("label", { for: "list-new", class: "sr" }, PLACEHOLDER[key]), input, h("button", { type: "submit", class: "primary" }, "Add"),
      remindable ? h("label", { class: "check remind-toggle", for: "remind-on" }, remind, "Remind me") : null,
      remindable ? remindRow : null),
    items.length ? h("ul", { class: "items" }, items)
      : h("div", { class: "empty-state" },
          h("p", { class: "empty-title" }, notes ? "No notes yet" : `This ${list.name.toLowerCase()} is empty`),
          h("p", { class: "meta" }, notes ? "Write a note above to share it with the house." : "Add the first item above.")
        ),
    h("div", { class: "list-actions" },
      anyDone && !notes ? h("button", { class: "ghost", onclick: async () => { await post(`/api/lists/${key}/clear-done`); refresh(state); } }, "Clear ticked items") : null,
      !notes && list.items.some((i) => !i.done) ? h("button", { class: "ghost", onclick: async () => {
        if (!(await ensure("kid"))) return;
        try { const r = await post(`/api/lists/${key}/print`); toast(`Printing ${r.count} item${r.count > 1 ? "s" : ""} on the HP DeskJet.`); }
        catch (x) { toast(x.message, "bad"); }
      } }, "Print this list") : null),
  );
}

async function refresh(state) {
  state.data = await api("/api/lists");
  render(state);
}

export async function load(state) {
  // Don't redraw under someone who's typing.
  const a = document.activeElement;
  if (a && state.panel.contains(a) && (a.id === "list-new" ? a.value : ["INPUT", "SELECT"].includes(a.tagName) && a.type !== "checkbox")) return;
  await refresh(state);
}
