// System › Versions › Missions (A35 M1b step H7, spec §10.1): one row per initiative, read from GET /api/missions. Read
// only: the page starts nothing. Every state is drawn and none is empty by default: loading; the rows with the hub's
// time; the last rows with how old they are when a refresh fails; "No missions yet" only when the ledger said so;
// "Missions can't be read" when it can't (not the owner, the ledger down, the hub silent, a newer contract).
import { h } from "./core.js";
import { ageLabel } from "./freshness.js";
import { faceplate, faceplateLoading, section } from "./page-parts.js";
import { POLL, SLUG, chip, clockOf, hhmm, hubNow, isCount, notice, prov, readView, statusOf, words } from "./mission-parts.js";

export const every = POLL;

// The last rows are kept (drawn as old) only when the hub is the one that failed; a refused or newer-contract answer
// isn't a reason to go on showing what an earlier read said.
const KEEP = new Set(["failed", "unavailable", "unreadable"]);
const valid = (b) => Array.isArray(b.missions) && b.missions.every((m) => m && typeof m.id === "string" && typeof m.title === "string");

// The row's open-decision count: a number only when the hub read its decisions table, else null (never 0).
export const openOf = (m) => (m.decisions?.state === "ok" && isCount(m.decisions.open) ? m.decisions.open : null);

function rowEl(m) {
  const open = openOf(m), rev = m.revision;
  const plan = rev ? `Revision ${rev.n}, ${rev.status}` : "No plan imported yet";
  const decisions = open === null ? "Decisions couldn't be read" : open === 0 ? "No decisions open"
    : isCount(m.decisions.blocking) && m.decisions.blocking ? `${m.decisions.blocking} blocking` : "";
  const to = SLUG.test(m.id) ? `/missions/${m.id}` : null;
  const body = [
    h("span", { class: "ui-row__name" }, h("span", { class: "ui-row__title" }, m.title), chip(statusOf(m.status))),
    h("span", { class: "ui-row__detail" }, prov("imported", { from: (rev?.provenance || m.provenance)?.from }), ` · ${[plan, decisions].filter(Boolean).join(" · ")}`),
    open ? h("span", { class: "ui-row__figure" }, String(open), h("small", {}, open === 1 ? "open decision" : "open decisions")) : null,
  ];
  return h("li", {}, to ? h("a", { class: "ui-row", href: to, "data-link": true }, ...body) : h("div", { class: "ui-row" }, ...body));
}

// The page's one panel. A decisions table that couldn't be read is said, never counted as nothing waiting.
export function listPlate(rows) {
  const caption = "Each mission is a plan imported from a reviewed file, with what sessions report against it.";
  if (!rows) return faceplate({ name: "Missions", lamp: ["unknown", "Not read"], caption: "Missions couldn't be read just now." });
  if (!rows.length) return faceplate({ name: "Missions", lamp: ["unknown", "None yet"], caption: "A plan imported with home-mission import appears here." });
  const open = rows.reduce((n, m) => n + (openOf(m) || 0), 0), unread = rows.filter((m) => openOf(m) === null).length;
  const lamp = unread ? ["unknown", "Decisions not read"] : open ? ["warn", `${open} decision${open === 1 ? "" : "s"} open`] : ["ok", "Nothing waiting for you"];
  return faceplate({ name: "Missions", lamp, readout: String(rows.length), unit: rows.length === 1 ? "mission" : "missions", size: "md", caption });
}

export function mount(state) {
  state.notice = h("div");
  state.plate = h("div", {}, faceplateLoading("Missions"));
  state.list = h("div", {}, h("span", { class: "ui-skeleton", style: "width:70%;height:1em" }));
  state.root.append(state.notice, state.plate, state.list);
}

function draw(state) {
  const { body, fail } = state;
  const rows = body && (!fail || KEEP.has(fail.state)) ? body.missions : null;
  const asOf = state.clock ? hhmm(state.clock.asOf) : "";
  state.plate.replaceChildren(listPlate(rows));
  state.notice.replaceChildren(...(rows && fail ? [notice("warn", `Couldn't refresh. This is what Pi Hub last said, as of ${asOf} (${ageLabel((hubNow(state.clock) - state.clock.asOf) / 1000)}).`)] : []));
  if (rows?.length) state.list.replaceChildren(section("Missions", h("ul", { class: "ui-rows ui-rows--grid" }, ...rows.map(rowEl))));
  else if (rows) state.list.replaceChildren(h("p", { class: "ui-empty" }, "No missions yet"));
  else {
    state.list.replaceChildren(section("Missions", notice("bad", h("strong", {}, "Missions can't be read"), ` ${words(fail.state)} `,
      fail.state === "refused" ? h("a", { href: "/settings#group-people", "data-link": true }, "Open Settings")
        : h("button", { class: "ui-btn", type: "button", onclick: () => load(state) }, "Try again"))));
  }
  state.sources = [rows && !fail ? { name: "Ledger", tone: "ok", word: `as of ${asOf}` }
    : { name: "Ledger", tone: "bad", word: rows ? `isn't answering, last read ${asOf}` : "can't be read" }];
}

export async function load(state) {
  const r = await readView("/api/missions", valid);
  if (r.state === "ok") {
    Object.assign(state, { body: r.body, clock: clockOf(r.body.as_of), fail: null });
  } else {
    state.fail = { state: r.state };
    if (!KEEP.has(r.state)) state.body = null;
  }
  draw(state);
}
