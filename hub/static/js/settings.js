// Settings: first-time setup, owner sign-in, and the owner's controls.
import { firstFew } from "./section-links.js";
import { api, askFirst, card, empty, forgetMe, h, post, toast, when, whoami } from "./core.js";
import { displayCard } from "./display-pair.js";
import { faceplate } from "./page-parts.js";

export const every = 60;

// One setting (A7 P1): a section on the page with its state as a chip beside the heading, not a card. The sign-in and
// first-time setup screens keep their single panel.
function setting(title, { pill, tone } = {}, ...body) {
  return h("section", { class: "ui-section setting" },
    h("div", { class: "setting__head" }, h("h2", {}, title),
      pill ? h("span", { class: `ui-chip ui-chip--${tone === "warn" ? "warn" : tone === "bad" ? "bad" : "ok"}` }, pill) : null),
    ...body.flat().filter(Boolean));
}

// The faceplate (A7 P1): how much of the setup is done, and a button for each step left. It replaces the checklist the
// page used to open on.
export function setupPlate(steps) {
  const done = steps.filter((x) => x[1]).length;
  const left = steps.filter((x) => !x[1]);
  return faceplate({
    label: "Setup progress",
    lamp: left.length ? ["warn", `${left.length} step${left.length > 1 ? "s" : ""} left`] : ["ok", "All set"],
    readout: `${done} of ${steps.length}`, unit: "done",
    caption: left.length ? `Next: ${left[0][0].toLowerCase()}, ${left[0][3]}.` : "Everything the hub needs is connected.",
    actions: left.map(([label, , group, why]) => h("a", { class: "ui-btn", href: `#group-${group}`, title: why }, label)),
  });
}

// Phones capitalise the first letter and password managers fill in saved logins; neither
// is wanted for logins to other systems, so text fields switch both off.
function field(id, label, attrs = {}) {
  const input = h("input", { id, autocapitalize: "none", autocorrect: "off", spellcheck: "false", ...attrs });
  if (attrs.type !== "password") return h("label", { class: "field", for: id }, h("span", {}, label), input);
  const show = h("button", { type: "button", class: "ghost small reveal", "aria-controls": id, "aria-pressed": "false",
    onclick: () => {
      const on = input.type === "password";
      input.type = on ? "text" : "password";
      show.setAttribute("aria-pressed", String(on));
      show.textContent = on ? "Hide" : "Show";
    } }, "Show");
  return h("label", { class: "field", for: id }, h("span", {}, label), h("span", { class: "with-reveal" }, input, show));
}

function form(onsubmit, button, ...fields) {
  const btn = h("button", { type: "submit", class: "primary" }, button);
  const f = h("form", { class: "form", onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try { await onsubmit(Object.fromEntries(new FormData(f))); }
    catch (x) { toast(x.message, "bad"); }
    btn.disabled = false;
  } }, ...fields, btn);
  return f;
}

function shortcutsCard(state, keys, save) {
  const base = `${location.protocol}//${location.host}`;
  const shown = state.newKey;
  const steps = (key) => h("details", { class: "how", open: !!shown },
    h("summary", {}, "Set up three Siri Shortcuts"),
    h("ol", { class: "steps" },
      h("li", {}, "Open the Shortcuts app, tap +, and add the action “Get Contents of URL”."),
      h("li", {}, "For “Add to shopping”: set the URL to ", h("code", {}, `${base}/api/shortcut/add`),
        ", Method POST, Request Body JSON with ", h("code", {}, "text"), " (put an “Ask for Input” action first and use its answer) and ",
        h("code", {}, "list"), " = shopping. Add a header ", h("code", {}, "Authorization"), " = ", h("code", {}, `Bearer ${key || "your key"}`), "."),
      h("li", {}, "For “House status”: URL ", h("code", {}, `${base}/api/shortcut/status`), ", Method GET, the same header."),
      h("li", {}, "For “Ask the house”: URL ", h("code", {}, `${base}/api/shortcut/ask`), ", Method POST, JSON ", h("code", {}, "question"), " from an “Ask for Input”, the same header."),
      h("li", {}, "End each with “Speak Text” on the result, and name them what you'll say: “Hey Siri, add to shopping”."),
      h("li", {}, "Away from home, use the Tailscale address ", h("code", {}, "http://pi"), " in place of this one.")));
  return setting("Siri and Shortcuts", { cls: "wide", pill: keys.length ? `${keys.length} key${keys.length > 1 ? "s" : ""}` : null, tone: "ok" },
    h("p", { class: "meta" }, "A key lets a phone's Shortcuts add to the lists, hear the house's status, and ask Local AI, with no sign-in. Make one per phone; remove it if the phone is lost."),
    shown ? h("div", { class: "new-key" }, h("p", {}, h("strong", {}, "Copy this key now. It won't be shown again.")),
      h("code", { class: "key", tabindex: 0 }, shown),
      h("button", { class: "ghost", onclick: async () => { try { await navigator.clipboard.writeText(shown); toast("Key copied."); } catch { toast("Select the key and copy it.", "warn"); } } }, "Copy key")) : null,
    keys.length ? h("ul", { class: "log" }, keys.map((k) => h("li", { class: "log-row" },
      h("span", { class: "dot", dataset: { tone: "ok" } }),
      h("span", { class: "log-main" }, h("strong", {}, k.name), h("span", { class: "meta" }, k.last_used ? `Last used ${when(k.last_used)}` : "Not used yet")),
      h("button", { class: "ghost small", onclick: async (e) => { if (await askFirst(e.currentTarget, `The Shortcut key for ${k.name} stops working.`, { confirm: "Remove" })) await save("shortcut-remove")({ id: k.id }); } }, "Remove")))) : null,
    form(async (v) => {
      const r = await post("/api/settings/shortcut-add", v);
      state.newKey = r.key;
      toast(r.message);
      state.force = true;
      load(state);
    }, "Make a key", field("sc-name", "Which phone", { name: "name", placeholder: "Bill's iPhone", maxlength: 30, required: true, autocomplete: "off" })),
    steps(shown));
}

// The six groups, one per screen (A6, decision settings): a strip of their names, and the group the address (#group-…)
// or the last tap chose. A refresh redraws the page every minute, so the choice lives on `state`, not in the DOM.
export const GROUPS = [
  ["general", "General", ["Appearance"]],
  ["home", "Home", ["Homebridge", "Guest Wi-Fi", "Workshop display"]],
  ["outside", "Weather and calendar", ["Weather", "Calendar"]],
  ["phone", "Phone messages", ["Morning digest", "Quiet hours"]],
  ["people", "People and access", ["Your devices", "Siri and Shortcuts", "Owner password"]],
  ["pi", "The Pi", ["Backups", "Activity"]],
];

const groupFromHash = () => {
  const id = String(globalThis.location?.hash || "").replace(/^#group-/, "");
  return GROUPS.some(([key]) => key === id) ? id : null;
};

function showGroup(state) {
  for (const g of state.root.querySelectorAll(".settings-group")) g.hidden = g.id !== `group-${state.group}`;
  for (const a of state.root.querySelectorAll(".settings-tabs a")) {
    if (a.getAttribute("href") === `#group-${state.group}`) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
}

export function mount(state) {
  state.group = groupFromHash() || GROUPS[0][0];
  // A tap on a tab, or a step's link, changes the address: show the group it names. An unknown name changes nothing.
  state.onHash = () => {
    const id = groupFromHash();
    if (!id) return;
    state.group = id;
    showGroup(state);
  };
  window.addEventListener("hashchange", state.onHash);
  state.body = h("div", { class: "stack" });
  state.root.append(state.body);
}

export function leave(state) {
  window.removeEventListener("hashchange", state.onHash);
}

function setup(state) {
  return h("div", { class: "auth-box" }, card("Set up the hub", {},
    h("p", {}, "Choose an owner password. It protects these settings and everything that restarts or changes things."),
    h("p", { class: "meta" }, "The setup code is on the Pi. On the Mac, run: ssh pi sudo cat /etc/pi-hub/setup-code"),
    form(async (v) => {
      await post("/api/setup", { code: v.code, owner_password: v.owner_password });
      forgetMe();
      toast("The hub is set up, and you're signed in as the owner.");
      state.force = true;
      load(state);
    }, "Set up",
    field("code", "Setup code", { name: "code", required: true, autocomplete: "off", autocapitalize: "characters" }),
    field("owner_password", "Owner password", { name: "owner_password", type: "password", minlength: 8, required: true, autocomplete: "new-password" }))));
}

function signIn(state, m) {
  // Over Tailscale, the sign-in can also make this one of the owner's devices, which then never asks again.
  return h("div", { class: "auth-box" }, card("Owner sign-in", {},
    h("p", {}, "Settings need the owner password. Signing in lasts 30 days on this device."),
    form(async (v) => {
      await post("/api/signin", { password: v.password, remember: v.remember === "on" });
      forgetMe();
      state.force = true;
      load(state);
    }, "Sign in", field("owner-pw", "Owner password", { name: "password", type: "password", required: true, autocomplete: "current-password" }),
    m.tailscale ? h("label", { class: "check", for: "remember-device" },
      h("input", { type: "checkbox", id: "remember-device", name: "remember", checked: true }),
      "Remember this device. It opens the hub as the owner from now on, with no password.") : null)));
}

function devicesCard(v, save) {
  const mine = v.this && v.listed.some((x) => x.stable_id === v.this.stable_id);
  return setting("Your devices", { cls: "wide", pill: v.listed.length ? `${v.listed.length}` : "None yet", tone: v.listed.length ? "ok" : "warn" },
    h("p", { class: "meta" }, "Your own Tailscale devices open the hub and every house tool as the owner, with no password. Tailscale proves which device is asking. Remove a device here, or from Tailscale, and it needs the owner password again."),
    v.listed.length ? h("ul", { class: "log" }, v.listed.map((x) => h("li", { class: "log-row" },
      h("span", { class: "dot", dataset: { tone: "ok" } }),
      h("span", { class: "log-main" }, h("strong", {}, x.name, v.this?.stable_id === x.stable_id ? " (this device)" : ""),
        h("span", { class: "meta" }, x.last_seen ? `Last seen ${when(x.last_seen)}` : "Not seen yet")),
      h("button", { class: "ghost small", onclick: async (e) => {
        if (await askFirst(e.currentTarget, `${x.name} is forgotten and needs the owner password from now on.`, { confirm: "Remove" })) await save("device-remove")({ stable_id: x.stable_id });
      } }, "Remove")))) : null,
    v.this
      ? (mine ? null : h("button", { class: "primary", onclick: () => save("device-add")({}) }, `Add this device (${v.this.name})`))
      : h("p", { class: "note" }, "This device isn't reaching the hub over Tailscale, so it can't be added. Turn Tailscale on to add it."),
    v.login ? h("p", { class: "meta" }, `Tailscale account: ${v.login}`) : null);
}

export async function load(state) {
  if (!state.force && state.root.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  state.force = false;
  const m = await whoami(true);
  if (m.setup_needed) { state.body.replaceChildren(setup(state)); return; }
  if (m.role !== "owner") { state.body.replaceChildren(signIn(state, m)); return; }
  const d = await api("/api/settings");
  const save = (what) => async (v) => {
    const r = await post(`/api/settings/${what}`, v);
    toast(r.message);
    state.force = true;
    load(state);
  };
  const parts = [
    setting("Homebridge", { pill: d.homebridge.connected ? "Connected" : "Not connected", tone: d.homebridge.connected ? "ok" : "warn" },
      h("p", { class: "meta" }, "Use the login for Homebridge's own page at port 8581. The hub keeps it on the Pi and never shows it again."),
      form(save("homebridge"), d.homebridge.connected ? "Update login" : "Connect",
        field("hb-user", "Homebridge username", { name: "username", value: d.homebridge.username || "bjrmc", required: true, autocomplete: "off", "data-1p-ignore": true, "data-lpignore": "true" }),
        field("hb-pw", "Homebridge password", { name: "password", type: "password", required: true, autocomplete: "new-password", "data-1p-ignore": true, "data-lpignore": "true" }))),
    setting("Guest Wi-Fi", { pill: d.wifi ? d.wifi.ssid : "Not set", tone: d.wifi ? "ok" : "warn" },
      h("p", { class: "meta" }, "Guests scan the QR code on the Now page to join."),
      form(save("wifi"), "Save Wi-Fi",
        field("wifi-ssid", "Network name", { name: "ssid", value: d.wifi?.ssid || "", required: true, autocomplete: "off" }),
        field("wifi-pw", "Password", { name: "password", type: "password", autocomplete: "off" }),
        h("label", { class: "field", for: "wifi-sec" }, h("span", {}, "Security"),
          h("select", { id: "wifi-sec", name: "security" },
            ["WPA", "WEP", "nopass"].map((v) => h("option", { value: v, selected: (d.wifi?.security || "WPA") === v },
              { WPA: "WPA2 or WPA3 (most networks)", WEP: "WEP (old)", nopass: "No password" }[v]))))),
      d.wifi ? h("button", { class: "ghost", onclick: async () => { await post("/api/settings/wifi", { clear: true }); toast("Wi-Fi details removed."); load(state); } }, "Remove Wi-Fi details") : null),
    setting("Morning digest", { pill: d.digest.on ? `On, ${d.digest.at}` : "Off", tone: d.digest.on ? "ok" : "warn" },
      h("p", { class: "meta" }, "One phone message each morning: weather, overnight prints, dropouts, what needs a look, today's calendar and the shopping list."),
      form(async (v) => save("digest")({ on: v.on === "on", at: v.at }), "Save",
        h("label", { class: "check", for: "digest-on" }, h("input", { type: "checkbox", id: "digest-on", name: "on", checked: !!d.digest.on }), "Send the digest"),
        field("digest-at", "Time", { name: "at", type: "time", value: d.digest.at, required: true })),
      h("button", { class: "ghost", onclick: async () => { try { const r = await post("/api/settings/digest-test", {}); toast(r.message); } catch (x) { toast(x.message, "bad"); } } }, "Send one now"),
      d.alerts_ready ? null : h("p", { class: "note" }, "Phone alerts aren't set up on this Pi yet.")),
    setting("Quiet hours", { pill: d.quiet.on ? `${d.quiet.from} to ${d.quiet.to}` : "Off", tone: d.quiet.on ? "ok" : "warn" },
      h("p", { class: "meta" }, "Rules don't send phone alerts in these hours. The morning digest still arrives."),
      form(async (v) => save("quiet")({ on: v.on === "on", from: v.from, to: v.to }), "Save",
        h("label", { class: "check", for: "quiet-on" }, h("input", { type: "checkbox", id: "quiet-on", name: "on", checked: !!d.quiet.on }), "Hold alerts at night"),
        h("div", { class: "two" },
          field("quiet-from", "From", { name: "from", type: "time", value: d.quiet.from, required: true }),
          field("quiet-to", "To", { name: "to", type: "time", value: d.quiet.to, required: true })))),
    setting("Weather", { pill: d.place || "Not set", tone: d.place ? "ok" : "warn" },
      h("p", { class: "meta" }, "For the weather on Now, the wall display and the morning digest."),
      form(save("place"), d.place ? "Change town" : "Set town",
        field("place-name", "Town or city", { name: "name", placeholder: "Springfield, Illinois", required: true, autocomplete: "address-level2" })),
      h("div", { class: "seg", role: "group", "aria-label": "Temperature units" }, ["F", "C"].map((x) =>
        h("button", { class: "seg-btn", "aria-pressed": String((d.units || "F") === x), onclick: () => save("units")({ units: x }) }, `°${x}`)))),
    setting("Calendar", { pill: d.calendar_set ? "Connected" : "Not set", tone: d.calendar_set ? "ok" : "warn" },
      h("p", { class: "meta" }, "Paste a calendar's secret iCal address. In Google Calendar: Settings, your calendar, “Secret address in iCal format”. In iCloud: share the calendar publicly and copy the link."),
      form(save("calendar"), d.calendar_set ? "Replace calendar" : "Connect calendar",
        field("cal-url", "Calendar address", { name: "url", type: "url", placeholder: "https://…/basic.ics", required: true, autocomplete: "off" })),
      d.calendar_set ? h("button", { class: "ghost", onclick: async () => { await post("/api/settings/calendar", { clear: true }); toast("Calendar removed."); state.force = true; load(state); } }, "Remove calendar") : null),
    setting("Owner password", {},
      form(save("password"), "Change password",
        field("new-pw", "New owner password", { name: "password", type: "password", minlength: 8, required: true, autocomplete: "new-password" }))),
    setting("Backups", { pill: d.backups.length ? `${d.backups.length} kept` : "None yet", tone: d.backups.length ? "ok" : "warn" },
      d.backups.length
        ? h("ul", { class: "log" }, d.backups.slice(0, 5).map((b) => h("li", { class: "log-row" }, h("span", { class: "dot", dataset: { tone: "ok" } }),
          h("span", { class: "log-main" }, h("strong", {}, when(b.ts))), h("span", { class: "log-side" }, `${b.mb} MB`))))
        : empty("The first backup runs tonight at about 3:30."),
      h("p", { class: "meta" }, "Kept on the Pi for 14 days: hub data, lists, history, Homebridge settings and the Pi's own settings."),
      d.pc_copy ? h("p", {}, h("span", { class: "dot", dataset: { tone: Date.now() / 1000 - d.pc_copy.ts < 50 * 3600 ? "ok" : "warn" }, style: "display:inline-block;margin-right:.5rem" }),
        `Copied to the Windows PC ${when(d.pc_copy.ts)}. The PC fetches the newest one every morning at 5:00 and keeps 14.`)
        : h("p", { class: "note" }, "Not copied to the PC yet.")),
    devicesCard(d.devices, save),
    // Made once: a refresh every minute would otherwise drop a pairing code off the screen.
    state.display ??= displayCard(),
    shortcutsCard(state, d.shortcut_keys, save),
    setting("Activity", { cls: "wide" },
      d.log.length
        ? firstFew(d.log.map((l) => h("li", { class: "log-row" }, h("span", { class: "dot", dataset: { tone: /didn't|isn't/.test(l.result) ? "bad" : "ok" } }),
          h("span", { class: "log-main" }, h("strong", {}, l.result), h("span", { class: "meta" }, `${l.device || "A device"}, ${l.role === "owner" ? "owner" : "household"}`)),
          h("span", { class: "log-side" }, when(l.ts)))), { n: 6, noun: "changes" })
        : [empty("Nothing yet. Every restart, fix and settings change is listed here.")]),
  ];
  
  const appearanceCard = setting("Appearance", {},
    h("p", { class: "meta" }, "Theme and display settings."),
    h("div", { class: "row" },
      h("button", { type: "button", class: "ui-btn", onclick: () => document.getElementById("theme-btn")?.click() }, "Change the theme"),
      h("a", { href: "/wall", class: "ui-btn", target: "_blank", rel: "noopener" }, "Open the wall display ↗")
    )
  );
  parts.unshift(appearanceCard);
const byTitle = Object.fromEntries(parts.map((c) => [c.querySelector("h2")?.textContent, c]));
  const steps = [
    ["Connect Homebridge", d.homebridge.connected, "home", "so lights and plugs work from the hub"],
    ["Set your town", !!d.place, "outside", "for the weather and the wall's day and night"],
    ["Add guest Wi-Fi", !!d.wifi, "home", "for the QR code guests scan"],
    ["Connect a calendar", d.calendar_set, "outside", "for “Coming up” and the digest"],
    ["Add your devices", d.devices.listed.length > 0, "people", "so the hub opens as you, with no password"],
  ];
  state.body.replaceChildren(
    setupPlate(steps),
    h("nav", { class: "ui-chips settings-tabs", "aria-label": "Settings sections" },
      GROUPS.map(([id, title]) => h("a", { href: `#group-${id}` }, title))),
    ...GROUPS.map(([id, title, names]) => h("section", { class: "settings-group", id: `group-${id}`, "aria-labelledby": `group-${id}-title` },
      h("h2", { class: "group-title", id: `group-${id}-title` }, title),
      h("div", { class: "stack" }, names.map((n) => byTitle[n]).filter(Boolean)))),
    // Sign out is the danger button and asks first (A7 P7); the toast repeats its verb in the past tense.
    h("button", { type: "button", class: "ui-btn ui-btn--danger", onclick: async (e) => {
      if (!(await askFirst(e.currentTarget, "This device forgets its sign-in. You'll need the password to change things again.", { confirm: "Sign out" }))) return;
      await post("/api/signout"); forgetMe(); toast("Signed out on this device."); load(state);
    } }, "Sign out on this device"),
  );
  showGroup(state);
}
