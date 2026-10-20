// Settings: first-time setup, owner sign-in, and the owner's controls.
import { api, card, empty, forgetMe, h, post, toast, when, whoami } from "./core.js";

export const every = 60;

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

function versionsCard(r, save) {
  const live = r.log.find((x) => x.sha === r.current);
  const STATUS = { live: ["Live", "ok"], failed: ["Didn't pass", "bad"], "rolled-back": ["Went back", "warn"] };
  return card("Versions", { cls: "wide", pill: r.current ? `Running ${r.current.slice(0, 7)}` : "Not set up", tone: "ok" },
    h("p", { class: "meta" }, "New versions arrive from Claude, run the hub's tests on the Pi, and only go live if every page and API answers. If one fails its checks, the hub goes back to the version before by itself."),
    live ? h("p", {}, h("strong", {}, live.subject || "Current version"), h("span", { class: "meta" }, `, live since ${when(live.ts)}`)) : null,
    r.log.length ? h("ul", { class: "log" }, r.log.map((x) => {
      const [label, tone] = STATUS[x.status] || [x.status, "warn"];
      const canGoBack = x.status === "live" && x.sha !== r.current && r.on_pi.includes(x.sha);
      return h("li", { class: "log-row" }, h("span", { class: "dot", dataset: { tone } }),
        h("span", { class: "log-main" }, h("strong", {}, x.subject || x.sha), h("span", { class: "meta" }, `${label}. ${x.message} ${when(x.ts)}`)),
        canGoBack ? h("button", { class: "ghost small", onclick: async () => {
          if (!confirm(`Go back to “${x.subject || x.sha}”? The hub restarts.`)) return;
          await save("rollback")({ to: x.sha });
        } }, "Go back to this") : h("span", { class: "log-side" }, x.sha === r.current ? "Running" : ""));
    })) : empty("No versions recorded yet."));
}

export function mount(state) {
  state.body = h("div", { class: "stack" });
  state.root.append(state.body);
}

function setup(state) {
  return card("Set up the hub", { cls: "wide" },
    h("p", {}, "Choose an owner password (for these settings) and a 6-digit household PIN (for everyone who should be able to restart things and switch lights)."),
    h("p", { class: "meta" }, "The setup code is on the Pi. On the Mac, run: ssh pi sudo cat /etc/pi-hub/setup-code"),
    form(async (v) => {
      if (v.pin !== v.pin2) throw new Error("The two PINs don't match.");
      await post("/api/setup", { code: v.code, owner_password: v.owner_password, pin: v.pin });
      forgetMe();
      toast("The hub is set up, and you're signed in as the owner.");
      state.force = true;
      load(state);
    }, "Set up",
    field("code", "Setup code", { name: "code", required: true, autocomplete: "off", autocapitalize: "characters" }),
    field("owner_password", "Owner password", { name: "owner_password", type: "password", minlength: 8, required: true, autocomplete: "new-password" }),
    field("pin", "Household PIN (6 digits)", { name: "pin", type: "password", inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6, required: true, autocomplete: "off" }),
    field("pin2", "Household PIN again", { name: "pin2", type: "password", inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6, required: true, autocomplete: "off" })));
}

function signIn(state, role) {
  return card("Owner sign-in", { cls: "wide" },
    h("p", {}, role === "household" ? "This device has the household PIN. Settings need the owner password." : "Settings need the owner password."),
    form(async (v) => {
      await post("/api/signin", { password: v.password });
      forgetMe();
      state.force = true;
      load(state);
    }, "Sign in", field("owner-pw", "Owner password", { name: "password", type: "password", required: true, autocomplete: "current-password" })));
}

export async function load(state) {
  if (!state.force && state.root.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  state.force = false;
  const m = await whoami(true);
  if (m.setup_needed) { state.body.replaceChildren(setup(state)); return; }
  if (m.role !== "owner") { state.body.replaceChildren(signIn(state, m.role)); return; }
  const d = await api("/api/settings");
  const save = (what) => async (v) => {
    const r = await post(`/api/settings/${what}`, v);
    toast(r.message);
    state.force = true;
    load(state);
  };
  const parts = [
    card("Homebridge", { pill: d.homebridge.connected ? "Connected" : "Not connected", tone: d.homebridge.connected ? "ok" : "warn" },
      h("p", { class: "meta" }, "Use the login for Homebridge's own page at port 8581. The hub keeps it on the Pi and never shows it again."),
      form(save("homebridge"), d.homebridge.connected ? "Update login" : "Connect",
        field("hb-user", "Homebridge username", { name: "username", value: d.homebridge.username || "bjrmc", required: true, autocomplete: "off", "data-1p-ignore": true, "data-lpignore": "true" }),
        field("hb-pw", "Homebridge password", { name: "password", type: "password", required: true, autocomplete: "new-password", "data-1p-ignore": true, "data-lpignore": "true" }))),
    card("Guest Wi-Fi", { pill: d.wifi ? d.wifi.ssid : "Not set", tone: d.wifi ? "ok" : "warn" },
      h("p", { class: "meta" }, "Guests scan the QR code on the Now page to join."),
      form(save("wifi"), "Save Wi-Fi",
        field("wifi-ssid", "Network name", { name: "ssid", value: d.wifi?.ssid || "", required: true, autocomplete: "off" }),
        field("wifi-pw", "Password", { name: "password", type: "password", autocomplete: "off" }),
        h("label", { class: "field", for: "wifi-sec" }, h("span", {}, "Security"),
          h("select", { id: "wifi-sec", name: "security" },
            ["WPA", "WEP", "nopass"].map((v) => h("option", { value: v, selected: (d.wifi?.security || "WPA") === v },
              { WPA: "WPA2 or WPA3 (most networks)", WEP: "WEP (old)", nopass: "No password" }[v]))))),
      d.wifi ? h("button", { class: "ghost", onclick: async () => { await post("/api/settings/wifi", { clear: true }); toast("Wi-Fi details removed."); load(state); } }, "Remove Wi-Fi details") : null),
    card("Morning digest", { pill: d.digest.on ? `On, ${d.digest.at}` : "Off", tone: d.digest.on ? "ok" : "warn" },
      h("p", { class: "meta" }, "One phone message each morning: weather, overnight prints, dropouts, what needs a look, today's calendar and the shopping list."),
      form(async (v) => save("digest")({ on: v.on === "on", at: v.at }), "Save",
        h("label", { class: "check", for: "digest-on" }, h("input", { type: "checkbox", id: "digest-on", name: "on", checked: !!d.digest.on }), "Send the digest"),
        field("digest-at", "Time", { name: "at", type: "time", value: d.digest.at, required: true })),
      h("button", { class: "ghost", onclick: async () => { try { const r = await post("/api/settings/digest-test", {}); toast(r.message); } catch (x) { toast(x.message, "bad"); } } }, "Send one now"),
      d.alerts_ready ? null : h("p", { class: "note" }, "Phone alerts aren't set up on this Pi yet.")),
    card("Quiet hours", { pill: d.quiet.on ? `${d.quiet.from} to ${d.quiet.to}` : "Off", tone: d.quiet.on ? "ok" : "warn" },
      h("p", { class: "meta" }, "Rules don't send phone alerts in these hours. The morning digest still arrives."),
      form(async (v) => save("quiet")({ on: v.on === "on", from: v.from, to: v.to }), "Save",
        h("label", { class: "check", for: "quiet-on" }, h("input", { type: "checkbox", id: "quiet-on", name: "on", checked: !!d.quiet.on }), "Hold alerts at night"),
        h("div", { class: "two" },
          field("quiet-from", "From", { name: "from", type: "time", value: d.quiet.from, required: true }),
          field("quiet-to", "To", { name: "to", type: "time", value: d.quiet.to, required: true })))),
    card("Weather", { pill: d.place || "Not set", tone: d.place ? "ok" : "warn" },
      h("p", { class: "meta" }, "For the weather on Now, the wall display and the morning digest."),
      form(save("place"), d.place ? "Change town" : "Set town",
        field("place-name", "Town or city", { name: "name", placeholder: "Springfield, Illinois", required: true, autocomplete: "address-level2" })),
      h("div", { class: "seg", role: "group", "aria-label": "Temperature units" }, ["F", "C"].map((x) =>
        h("button", { class: "seg-btn", "aria-pressed": String((d.units || "F") === x), onclick: () => save("units")({ units: x }) }, `°${x}`)))),
    card("Calendar", { pill: d.calendar_set ? "Connected" : "Not set", tone: d.calendar_set ? "ok" : "warn" },
      h("p", { class: "meta" }, "Paste a calendar's secret iCal address. In Google Calendar: Settings, your calendar, “Secret address in iCal format”. In iCloud: share the calendar publicly and copy the link."),
      form(save("calendar"), d.calendar_set ? "Replace calendar" : "Connect calendar",
        field("cal-url", "Calendar address", { name: "url", type: "url", placeholder: "https://…/basic.ics", required: true, autocomplete: "off" })),
      d.calendar_set ? h("button", { class: "ghost", onclick: async () => { await post("/api/settings/calendar", { clear: true }); toast("Calendar removed."); state.force = true; load(state); } }, "Remove calendar") : null),
    card("People", { pill: d.people.length ? `${d.people.length}` : null, cls: "wide" },
      h("p", { class: "meta" }, "Give each person their own PIN so the activity log shows who did what. Adults can do everything the household PIN can; kids can switch lights and plugs and tick lists, but can't restart things, change rules or ask Local AI."),
      d.people.length ? h("ul", { class: "log" }, d.people.map((p) => h("li", { class: "log-row" },
        h("span", { class: "dot", dataset: { tone: "ok" } }),
        h("span", { class: "log-main" }, h("strong", {}, p.name), h("span", { class: "meta" }, p.kind === "kid" ? "Kid" : "Adult")),
        h("button", { class: "ghost small", onclick: async () => {
          if (!confirm(`Remove ${p.name}? Their devices are signed out.`)) return;
          await save("person-remove")({ id: p.id });
        } }, "Remove")))) : null,
      form(save("person-add"), "Add person",
        h("div", { class: "two" },
          field("person-name", "Name", { name: "name", required: true, maxlength: 30, autocomplete: "off" }),
          h("label", { class: "field", for: "person-kind" }, h("span", {}, "Who"),
            h("select", { id: "person-kind", name: "kind" }, h("option", { value: "adult" }, "Adult"), h("option", { value: "kid" }, "Kid")))),
        field("person-pin", "Their 6-digit PIN", { name: "pin", type: "password", inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6, required: true, autocomplete: "off" }))),
    card("Household PIN", {},
      h("p", { class: "meta" }, "Changing it signs every device out of the household PIN."),
      form(save("pin"), "Change PIN",
        field("new-pin", "New 6-digit PIN", { name: "pin", type: "password", inputmode: "numeric", pattern: "[0-9]{6}", maxlength: 6, required: true, autocomplete: "off" }))),
    card("Owner password", {},
      form(save("password"), "Change password",
        field("new-pw", "New owner password", { name: "password", type: "password", minlength: 8, required: true, autocomplete: "new-password" }))),
    card("Backups", { pill: d.backups.length ? `${d.backups.length} kept` : "None yet", tone: d.backups.length ? "ok" : "warn" },
      d.backups.length
        ? h("ul", { class: "log" }, d.backups.slice(0, 5).map((b) => h("li", { class: "log-row" }, h("span", { class: "dot", dataset: { tone: "ok" } }),
          h("span", { class: "log-main" }, h("strong", {}, when(b.ts))), h("span", { class: "log-side" }, `${b.mb} MB`))))
        : empty("The first backup runs tonight at about 3:30."),
      h("p", { class: "meta" }, "Kept on the Pi for 14 days: hub data, lists, history, Homebridge settings and the Pi's own settings."),
      d.pc_copy ? h("p", {}, h("span", { class: "dot", dataset: { tone: Date.now() / 1000 - d.pc_copy.ts < 50 * 3600 ? "ok" : "warn" }, style: "display:inline-block;margin-right:.5rem" }),
        `Copied to the Windows PC ${when(d.pc_copy.ts)}. The PC fetches the newest one every morning at 5:00 and keeps 14.`)
        : h("p", { class: "note" }, "Not copied to the PC yet.")),
    versionsCard(d.releases, save),
    card("Activity", { cls: "wide" },
      d.log.length
        ? h("ul", { class: "log" }, d.log.map((l) => h("li", { class: "log-row" }, h("span", { class: "dot", dataset: { tone: /didn't|isn't/.test(l.result) ? "bad" : "ok" } }),
          h("span", { class: "log-main" }, h("strong", {}, l.result), h("span", { class: "meta" }, `${l.device || "A device"}, ${l.role === "owner" ? "owner" : "household PIN"}`)),
          h("span", { class: "log-side" }, when(l.ts)))))
        : empty("Nothing yet. Every restart, fix and settings change is listed here.")),
  ];
  const byTitle = Object.fromEntries(parts.map((c) => [c.querySelector("h2")?.textContent, c]));
  const GROUPS = [
    ["home", "Home", ["Homebridge", "Guest Wi-Fi"]],
    ["outside", "Weather and calendar", ["Weather", "Calendar"]],
    ["phone", "Phone messages", ["Morning digest", "Quiet hours"]],
    ["people", "People and access", ["People", "Household PIN", "Owner password"]],
    ["pi", "The Pi", ["Versions", "Backups", "Activity"]],
  ];
  const steps = [
    ["Connect Homebridge", d.homebridge.connected, "home", "so lights and plugs work from the hub"],
    ["Set your town", !!d.place, "outside", "for the weather and the wall's day and night"],
    ["Add guest Wi-Fi", !!d.wifi, "home", "for the QR code guests scan"],
    ["Connect a calendar", d.calendar_set, "outside", "for “Coming up” and the digest"],
    ["Add the people in the house", d.people.length > 0, "people", "so the activity log says who did what"],
  ];
  const left = steps.filter((x) => !x[1]);
  state.body.replaceChildren(
    left.length ? h("section", { class: "setup-steps", "aria-labelledby": "setup-title" },
      h("h2", { class: "section-title", id: "setup-title" }, `Finish setting up: ${left.length} step${left.length > 1 ? "s" : ""} left`),
      h("ol", {}, steps.map(([label, done, group, why]) => h("li", { dataset: { done: String(done) } },
        h("span", { class: "dot", dataset: { tone: done ? "ok" : "warn" } }),
        done ? h("span", {}, h("s", {}, label)) : h("a", { href: `#group-${group}` }, label),
        h("span", { class: "meta" }, done ? "Done" : why))))) : null,
    h("nav", { class: "jump", "aria-label": "Settings sections" }, GROUPS.map(([id, title]) => h("a", { class: "chip", href: `#group-${id}` }, title))),
    ...GROUPS.map(([id, title, names]) => h("section", { class: "settings-group", id: `group-${id}`, "aria-labelledby": `group-${id}-title` },
      h("h2", { class: "group-title", id: `group-${id}-title` }, title),
      h("div", { class: "cards" }, names.map((n) => byTitle[n]).filter(Boolean)))),
    h("button", { class: "ghost", onclick: async () => { await post("/api/signout"); forgetMe(); toast("Signed out on this device."); load(state); } }, "Sign out on this device"),
  );
}
