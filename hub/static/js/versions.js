// System › Versions (platform step 3; spec D1, D7): what is live where, read only from the release:<target> records
// each target's deploy writes. Read-only for every target; going back is Pi Hub's alone, and needs the owner.
import { api, card, empty, h, post, toast, when, whoami } from "./core.js";
import { firstFew } from "./section-links.js";

export const every = 60;

const REPO = {
  "pi-hub": "azmusgb/pi-hub", localai: "azmusgb/LocalAI", firmware: "azmusgb/bambuhelper-smart-display",
  netmon: "azmusgb/netmon", "mac-watch": "azmusgb/LocalAI", "x2d-bridge-mac": "azmusgb/bambuhelper-smart-display",
};
const BY = {
  "pi-hub-release": "Pi Hub's release runner", "safe-deploy": "Local AI's Safe Deploy", "ota-hook": "the OTA publish hook",
  "netmon-deploy": "netmon's deploy script", "mac-install": "the Mac installer",
};
const CHIP = {
  live: ["Live", "ok"], behind: ["Behind", ""], ahead: ["Ahead", ""], unknown: ["", ""], drifted: ["Drifted", "warn"],
};

const short = (c) => (c || "").slice(0, 7);
// when() starts with "Today" or "Yesterday"; mid-sentence those read lower case.
const inLine = (ts) => when(ts).replace(/^(Today|Yesterday)\b/, (w) => w.toLowerCase());

// One view row per release record, in the order the hub lists them. Pure, so it is tested without a page.
export function versionRows(records = []) {
  return (records || []).filter((r) => r?.id?.startsWith("release:")).map((r) => {
    const d = r.detail || {};
    const last = d.last || {};
    const target = d.target || r.id.slice("release:".length);
    let [chip, tone] = CHIP[r.state] || [r.state, ""];
    if (last.result === "failed" || last.result === "rolled-back") tone = "warn";
    if (r.state === "unknown") {
      return { id: r.id, target, label: d.label || target, chip, tone, unknown: true, line: "Not publishing yet", note: "" };
    }
    const href = d.commit && REPO[target] ? `https://github.com/${REPO[target]}/commit/${d.commit}` : "";
    const parts = [d.deployed_at ? `deployed ${inLine(d.deployed_at)}` : "", BY[d.mechanism] ? `by ${BY[d.mechanism]}` : ""];
    const quiet = r.state === "live" && last.result === "deployed";
    return {
      id: r.id, target, label: d.label || target, chip, tone, unknown: false,
      commit: short(d.commit), href, dirty: !!d.dirty, line: parts.filter(Boolean).join(" "),
      // Anything other than a clean, live deploy says what happened, in the record's own words.
      note: quiet ? "" : [r.headline, last.result !== "deployed" ? r.cause : ""].filter(Boolean).join(". "),
    };
  });
}

// Pi Hub's own history (the release runner's log), with "Go back to this" for a retained live version.
export function historyRows(releases) {
  const STATUS = { live: ["Live", "ok"], failed: ["Didn't pass", "bad"], "rolled-back": ["Went back", "warn"] };
  return (releases?.log || []).map((x) => {
    const [label, tone] = STATUS[x.status] || [x.status, "warn"];
    return { ...x, label, tone, running: x.sha === releases.current,
      canGoBack: x.status === "live" && x.sha !== releases.current && (releases.on_pi || []).includes(x.sha) };
  });
}

function rowEl(v) {
  return h("li", { class: "log-row", dataset: { target: v.target } },
    h("span", { class: "dot", dataset: { tone: v.tone }, "aria-hidden": "true" }),
    h("span", { class: "log-main" },
      h("strong", {}, v.label),
      h("span", { class: "meta" }, v.unknown ? v.line
        : [v.href ? h("a", { href: v.href, target: "_blank", rel: "noopener" }, h("code", {}, v.commit)) : h("code", {}, v.commit || "—"),
          v.dirty ? " + local changes" : "", v.line ? ` ${v.line}` : ""]),
      v.note ? h("span", { class: "meta version-note" }, v.note) : null),
    h("span", { class: "log-side" }, v.chip));
}

export function mount(state) {
  state.list = h("div", {}, h("p", { class: "meta" }, "Checking…"));
  state.notice = h("p", { class: "note", role: "status", hidden: true });
  state.history = h("div");
  state.root.append(
    card("What is live where", { cls: "wide" },
      h("p", { class: "meta" }, "Each part's own deploy reports here when it finishes. A failed deploy, or a part running something other than its report, also shows in Needs you."),
      state.notice, state.list),
    card("Pi Hub versions", { cls: "wide" }, state.history));
}

async function goBack(state, x) {
  if (!confirm(`Go back to “${x.subject || x.sha}”? The hub restarts.`)) return;
  try {
    const r = await post("/api/settings/rollback", { to: x.sha });
    toast(r.message);
  } catch (e) {
    toast(e.message || "Couldn't go back.");
  }
  state.force = true;
  load(state);
}

async function loadHistory(state) {
  const me = await whoami().catch(() => null);
  if (me?.role !== "owner") {
    state.history.replaceChildren(h("p", { class: "meta" }, "Sign in as the owner in Settings to see Pi Hub's earlier versions and go back to one."));
    return;
  }
  const d = await api("/api/settings").catch(() => null);
  if (!d?.releases) {
    state.history.replaceChildren(h("p", { class: "meta" }, "Couldn't read Pi Hub's versions just now."));
    return;
  }
  const rows = historyRows(d.releases);
  state.history.replaceChildren(
    h("p", { class: "meta" }, "New versions run the hub's tests on the Pi and go live only if every page and API answers. If one fails its checks, the hub goes back to the version before by itself."),
    ...(rows.length ? firstFew(rows.map((x) => h("li", { class: "log-row" },
      h("span", { class: "dot", dataset: { tone: x.tone }, "aria-hidden": "true" }),
      h("span", { class: "log-main" }, h("strong", {}, x.subject || x.sha), h("span", { class: "meta" }, `${x.label}. ${x.message} ${when(x.ts)}`)),
      x.canGoBack ? h("button", { class: "ghost small", onclick: () => goBack(state, x) }, "Go back to this")
        : h("span", { class: "log-side" }, x.running ? "Running" : ""))), { n: 3, noun: "versions" })
      : [empty("No versions recorded yet.")]));
}

export async function load(state) {
  const recs = await api("/api/records").catch(() => null);
  const rows = recs ? versionRows(recs.records) : null;
  if (rows) state.rows = rows;
  state.notice.hidden = !!rows;
  state.notice.textContent = rows ? "" : state.rows ? "Couldn't read the release records. This is the last list." : "";
  if (state.rows?.length) state.list.replaceChildren(h("ul", { class: "log" }, state.rows.map(rowEl)));
  else state.list.replaceChildren(h("p", { class: "meta" }, rows ? "No release records yet." : "Couldn't read the release records just now."));
  await loadHistory(state);
}
