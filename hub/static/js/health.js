// System › Health (platform step 7, PR 7.3): the hub and the Pi in one page. It took over /pi's cards and System's
// services. A6 keeps six sections in view (self-check, services, Pi disks, updates, other systems, fix it) and folds
// outages, network, history and the help guides into a collapsed More.
import {
  api,
  askFirst,
  duration,
  empty,
  fix,
  FIX_WHAT,
  verifyFix,
  h,
  spark,
  when,
} from "./core.js";
import { faceplate, faceplateLoading, lampRows, section as uiSection } from "./page-parts.js";
import { moreList, openInRow } from "./section-links.js";
import { toolPath } from "./sections.js";

export const every = 20;

// One of Health's parts (A6): marked so the page, and its test, can tell them from what is under More.
const section = (node, name) => { node.dataset.health = name; return node; };

// A titled part of the page: a kit section (A7 P1), its state as a lamp beside the heading rather than a card's pill.
const card = (title, { pill, tone, id, cls } = {}, ...body) =>
  uiSection(title, body, { id, cls, lamp: pill != null && pill !== "" ? [tone || "unknown", pill] : null });

const STATE = {
  active: ["Running", "ok"],
  inactive: ["Off", "warn"],
  failed: ["Failed", "bad"],
  activating: ["Starting", "warn"],
};

const RANGES = [
  [6, "6 hours"],
  [24, "Day"],
  [168, "Week"],
];

// What a fix will do is said once, in core.js FIX_WHAT; nothing here overrides it.
const CONFIRM = {};

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object"
    ? value
    : {};
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampPercent(value) {
  const number = finiteNumber(value);

  if (number === null) {
    return 0;
  }

  return Math.max(0, Math.min(100, number));
}

function safeWhen(value) {
  return value ? when(value) : "—";
}

export function helpGuidance() {
  return [
    [
      "movies",
      "Movies won’t play",
      "Check the TV’s connection and try Plex again. If movies are missing, check the movies drive before restarting anything.",
      "/media",
      "Check Movies",
    ],

    [
      "devices",
      "Lights aren’t responding",
      "Check that the light or plug has power. Open Devices to try its controls. If every device is affected, check Homebridge under Services on this page.",
      "/devices",
      "Check Devices",
    ],

    [
      "print",
      "Printer won’t print",
      "Turn on the HP DeskJet and check for paper or an error on its screen. Open Print to see its status and waiting jobs.",
      "/print",
      "Check the printer",
    ],

    [
      "workshop",
      "3D printer or workshop problem",
      "Check the Bambu printer’s screen for errors. Workshop shows the camera and print status; Local AI and the workshop display are under Other systems on this page.",
      "/workshop",
      "Check Workshop",
    ],
  ];
}

export function mount(state) {
  state.range = 24;
  state.running = false;

  state.plate = h("div", {}, faceplateLoading("Self-check"));
  state.body = h("div", { class: "pi-bottom-grid" });

  // Other systems has its own slot: it reads the records, so it stays when the Pi's diagnostics fail.
  state.others = h("div", { class: "pi-bottom-grid" });

  // The faceplate's skeleton shows the loading; this line tells a screen reader how the checks went.
  state.diagnostic = h(
    "p",
    {
      class: "sr",
      role: "status",
      "aria-live": "polite",
    },
    "Checking system details…",
  );

  state.result = h("section", {
    class: "fix-result",
    role: "status",
    "aria-live": "polite",
    hidden: true,
  });

  const topic = state.context?.get("help") || "";
  const guidance = helpGuidance();

  guidance.sort(
    (a, b) =>
      Number(b[0] === topic) -
      Number(a[0] === topic),
  );

  // The guides are under More; opened with ?help=, they come first.
  const helpBody = () => [
    h("p", { class: "meta" }, "Start with the problem. These checks won’t restart or change anything."),
    h("div", { class: "help-topics" },
      guidance.map(([key, title, advice, href, label]) =>
        h("details", { class: "help-topic", id: `help-${key}`, open: topic === key },
          h("summary", {}, title),
          h("p", {}, advice),
          h("a", { class: "action", href, "data-link": true }, label)))),
    h("a", { class: "action", href: "/drives", "data-link": true }, "Check the movies drive"),
  ];

  state.fix = h("div");
  state.more = moreList({
    storeKey: "hub-health-more",
    title: "More",
    cls: "health-more",
    alerts: ["outages", "network"],
    items: [["outages", "Outages"], ["network", "Network"], ["history", "Health history"], ["help", "What isn’t working?"]],
  });
  for (const key of ["outages", "network", "history"]) state.more.fill(key, []);  // until the diagnostics answer
  state.more.fill("help", topic ? [] : helpBody());
  const first = !topic ? null : h("section", { class: "help-start", "aria-labelledby": "help-title" },
    h("h2", { id: "help-title" }, "What isn’t working?"), ...helpBody());

  state.root.append(...[
    state.result,
    state.plate,
    first,
    state.diagnostic,
    state.body,
    state.others,
    state.fix,
    state.more.root,
    openInRow("system"),
  ].filter(Boolean));
}

function chart(
  title,
  series,
  unit,
  max,
  current,
) {
  const values = asArray(series).map(
    (value) =>
      finiteNumber(value) ?? 0,
  );

  const currentValue =
    finiteNumber(current);

  return h(
    "figure",
    {
      class: "chart",
    },

    h(
      "figcaption",
      {},

      h(
        "span",
        {},
        title,
      ),

      h(
        "strong",
        {},
        currentValue !== null
          ? `${Math.round(
              currentValue,
            )}${unit}`
          : "—",
      ),
    ),

    spark(values, {
      max,
      height: 40,
    }),
  );
}

// The faceplate (A7 P1): the last self-check, with the services the Pi runs. A failed check or a failed service lights it;
// with no self-check yet it says so and never shows as healthy.
export function healthPlate(check, services = [], pi = {}) {
  const failedUnits = asArray(services).filter((s) => s?.state === "failed");
  const checks = asArray(check?.checks);
  const bad = checks.filter((item) => !item?.ok);
  const total = finiteNumber(check?.total) ?? checks.length;
  const failed = finiteNumber(check?.failed) ?? bad.length;
  const unitRows = failedUnits.map((s) => ({ title: s.name || "A service", detail: "Stopped with an error.", tone: "bad", word: "Failed" }));
  const checkRows = bad.map((item) => ({ title: item?.name || "Check failed", detail: item?.detail || null, tone: "bad", word: "Failed" }));
  const extra = unitRows.length || checkRows.length ? [lampRows([...checkRows, ...unitRows])] : [];
  const temp = finiteNumber(pi?.temp);
  const up = finiteNumber(pi?.uptime_h);
  const readings = [["The Pi's temperature", temp === null ? null : `${Math.round(temp)} °C`], ["Running for", up === null ? null : `${up} h`]];
  if (!check) {
    return faceplate({ name: "Self-check", lamp: failedUnits.length ? ["bad", `${failedUnits.length} service${failedUnits.length === 1 ? "" : "s"} failed`] : ["unknown", "Not run yet"],
      readout: "—", caption: "The first self-check runs tonight at 4:15. Run a self-check under Fixes to run one now.", readings, extra });
  }
  const lamp = !check.passed ? ["bad", `${failed} failed`]
    : failedUnits.length ? ["bad", `${failedUnits.length} service${failedUnits.length === 1 ? "" : "s"} failed`]
      : ["ok", "All passed"];
  return faceplate({
    name: "Self-check", lamp,
    readout: check.passed ? `${total} of ${total}` : `${total - failed} of ${total}`, unit: "passed", size: "md",
    caption: `Last run ${safeWhen(check.ts)}. Every page, every API, the services, free space, last night's backup and the temperature.`,
    readings, extra,
  });
}

function healthCard(
  state,
  data,
) {
  const health =
    asObject(data.health);

  const history =
    asArray(data.history);

  const live =
    asObject(data.live);

  const power =
    health.power || "Unknown";

  const healthy =
    power === "Good";

  return card(
    "Health",
    {
      cls: "wide",

      pill: healthy
        ? "Healthy"
        : "Check",

      tone: healthy
        ? "ok"
        : "warn",
    },

    h(
      "div",
      {
        class: "seg",
        role: "group",
        "aria-label":
          "Chart range",
      },

      RANGES.map(
        ([hours, label]) =>
          h(
            "button",
            {
              type: "button",

              class: "seg-btn",

              "aria-pressed":
                String(
                  state.range ===
                    hours,
                ),

              disabled:
                !!state.loadingRange,

              onclick: async () => {
                if (
                  state.range ===
                    hours ||
                  state.loadingRange
                ) {
                  return;
                }

                state.range =
                  hours;

                state.loadingRange =
                  true;

                try {
                  await load(state);
                } finally {
                  state.loadingRange =
                    false;
                }
              },
            },
            label,
          ),
      ),
    ),

    h(
      "div",
      {
        class: "charts",
      },

      chart(
        "Temperature",
        history.map(
          (point) =>
            point?.temp,
        ),
        " °C",
        90,
        asArray(
          live.temp_series,
        ).at(-1),
      ),

      chart(
        "Processor",
        history.map(
          (point) =>
            point?.cpu,
        ),
        "%",
        100,
        asArray(
          live.cpu_series,
        ).at(-1),
      ),

      chart(
        "Memory used",
        history.map(
          (point) =>
            point?.mem,
        ),
        "%",
        100,
        asArray(
          live.mem_series,
        ).at(-1),
      ),
    ),

    history.length < 3
      ? h(
          "p",
          {
            class: "meta",
          },
          "History builds up over the next hour.",
        )
      : null,

    h(
      "div",
      {
        class: "stat-cluster",
      },

      h(
        "div",
        {
          class:
            "stat-numbered",
        },

        h(
          "span",
          {
            class:
              "stat-label",
          },
          "Power",
        ),

        h(
          "span",
          {
            class:
              "stat-value",

            dataset: {
              tone: healthy
                ? "ok"
                : "bad",
            },
          },
          power,
        ),
      ),

      h(
        "div",
        {
          class:
            "stat-numbered",
        },

        h(
          "span",
          {
            class:
              "stat-label",
          },
          "Running for",
        ),

        h(
          "span",
          {
            class:
              "stat-value",
          },

          health.uptime_h !=
          null
            ? health.uptime_h
            : "—",

          h(
            "span",
            {
              class: "unit",
            },
            "h",
          ),
        ),
      ),
    ),
  );
}

// Recent fixes, grouped (A7 P6, decision 5): the same fix with the same outcome on the same local day is one row with a
// count and a time range. The log itself stays one entry per run; only the page groups.
export function groupFixLog(log) {
  const groups = new Map();
  for (const e of asArray(log)) {
    const ts = finiteNumber(e?.ts);
    if (ts === null) continue;
    const d = new Date(ts * 1000);
    const key = [e.action || "", e.result || "", d.getFullYear(), d.getMonth(), d.getDate()].join("|");
    const g = groups.get(key);
    if (g) {
      g.count += 1; g.first = Math.min(g.first, ts); g.last = Math.max(g.last, ts);
      if (e.device && !g.devices.includes(e.device)) g.devices.push(e.device);
    } else {
      groups.set(key, { action: e.action || "", result: e.result || "Action completed", count: 1, first: ts, last: ts, devices: e.device ? [e.device] : [] });
    }
  }
  return [...groups.values()].sort((a, b) => b.last - a.last);
}

const clock = (ts) => new Date(ts * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function fixLogRow(g) {
  const bad = /didn't|isn't|failed|error/i.test(g.result);
  const when = g.count > 1 ? `${g.count} times · ${clock(g.first)}–${clock(g.last)}` : safeWhen(g.last);
  return h("li", { class: "ui-row ui-row--lamp" },
    h("div", {}, h("span", { class: "ui-row__title" }, g.result),
      h("span", { class: "ui-row__detail" }, g.devices.join(", ") || "A device")),
    h("span", { class: `ui-chip ui-chip--${bad ? "bad" : "ok"}` }, bad ? "Didn't work" : "Done"),
    h("span", { class: "ui-row__value" }, when));
}

// Fixes (A7 P7): a closed section. Each row says what will happen; its button asks inline, repeating its verb, before
// anything runs. Restart the Pi is the danger button. The section stays open across the page's own refreshes.
function fixCard(
  state,
  actionsData,
) {
  const data = asObject(actionsData);
  const updates = asObject(data.updates);
  const actions = asArray(data.actions).filter((a) => a?.name);
  const log = groupFixLog(data.log).slice(0, 5);

  const rows = actions.map((action) => {
    const name = action.name;
    const label = action.label || name;
    const updateRunning = name === "updates:install" && updates.state === "running";
    const btn = h("button", {
      type: "button",
      class: `ui-btn ${name === "restart:pi" ? "ui-btn--danger" : ""}`.trim(),
      disabled: state.running || updateRunning,
      onclick: () => runFix(state, name, label, CONFIRM[name], false, btn),
    }, updateRunning ? "Installing…" : label);
    return h("li", { class: "ui-row ui-row--lamp" },
      h("div", {}, h("span", { class: "ui-row__title" }, label),
        h("span", { class: "ui-row__detail" }, FIX_WHAT[name] || "")),
      btn);
  });

  const el = h("details", { class: "ui-section health-fixes", id: "fixes" },
    h("summary", {}, h("h2", {}, "Fixes")),
    h("p", { class: "ui-section__note" }, "Check the problem above first. Each fix says what it will do and asks before it runs."),
    rows.length ? h("ul", { class: "ui-rows" }, ...rows) : empty("No maintenance actions are available right now."),
    updates.state === "failed"
      ? h("p", { class: "ui-notice ui-notice--warn" }, `The last update run didn't finish${updates.message ? `: ${updates.message}` : "."}`)
      : null,
    log.length ? h("h3", { class: "sub" }, "Recent fixes") : null,
    log.length ? h("ul", { class: "ui-rows" }, ...log.map(fixLogRow)) : null);
  el.open = !!state.fixesOpen || location.hash === "#fixes";
  el.addEventListener("toggle", () => { state.fixesOpen = el.open; });
  return el;
}

function outagesCard(outages) {
  const list =
    asArray(outages);

  return card(
    "Outages",
    {
      pill: list.length
        ? `${list.length} in 30 days`
        : "None",

      tone: list.length
        ? "warn"
        : "ok",
    },

    list.length
      ? h(
          "ul",
          {
            class: "log",
          },

          list
            .slice(0, 10)
            .map((outage) => {
              const start =
                finiteNumber(
                  outage?.start,
                );

              const end =
                finiteNumber(
                  outage?.end,
                );

              const seconds =
                start !== null &&
                end !== null
                  ? Math.max(
                      0,
                      end - start,
                    )
                  : null;

              return h(
                "li",
                {
                  class:
                    "log-row",
                },

                h("span", {
                  class: "dot",

                  dataset: {
                    tone: outage?.end
                      ? "warn"
                      : "bad",
                  },

                  "aria-hidden":
                    "true",
                }),

                h(
                  "span",
                  {
                    class:
                      "log-main",
                  },

                  h(
                    "strong",
                    {},
                    outage?.what ||
                      "Service",
                  ),

                  h(
                    "span",
                    {
                      class:
                        "meta",
                    },
                    safeWhen(
                      outage?.start,
                    ),
                  ),
                ),

                h(
                  "span",
                  {
                    class:
                      "log-side",
                  },

                  outage?.end &&
                  seconds !== null
                    ? duration(
                        seconds,
                      )
                    : "Still down",
                ),
              );
            }),
        )
      : empty(
          "Nothing has gone down in the last 30 days.",
        ),

    h(
      "p",
      {
        class: "meta",
      },
      "The Windows PC, the movies drive, Plex and Homebridge, as the hub saw them.",
    ),
  );
}

// Which record speaks for each restartable service; the rest have no record, so their row says nothing about health.
const SERVICE_RECORD = { plex: "plex", homebridge: "devices", adguard: "adguard", backrest: "backups", bambuddy: "printer" };
const TONE = { ok: "ok", attention: "warn", problem: "bad" };

// The restartable services (System's old "Services on the Pi"), each with its record's health where one speaks for it.
export function serviceRows(actions = [], records = []) {
  const byId = new Map((records || []).map((r) => [r.id, r]));
  return (actions || [])
    .filter((a) => a?.name?.startsWith("restart:") && a.name !== "restart:pi")
    .map((a) => {
      const key = a.name.slice("restart:".length);
      const rec = byId.get(SERVICE_RECORD[key]);
      const known = rec && rec.state !== "unknown" && !rec.stale;
      return { key, action: a, name: a.label.replace(/^Restart\s+/i, ""),
        tone: known ? TONE[rec.severity] || "" : "", status: known ? rec.headline : "" };
    });
}

// One Services card: the Pi's units first, then the apps the hub can restart. A unit and an app with the same name
// (Plex, Homebridge) share one row, so nothing is listed twice.
export function mergeServices(services = [], rows = []) {
  const left = [...(rows || [])];
  const take = (name) => {
    const i = left.findIndex((r) => r.name.toLowerCase() === String(name || "").toLowerCase());
    return i < 0 ? null : left.splice(i, 1)[0];
  };
  const units = (services || []).map((service) => ({ service, restart: take(service?.name) }));
  return [...units, ...left.map((restart) => ({ service: null, restart }))];
}

// A small Restart beside its service: restarting is the rare thing (iPad, 1 Nov: eight identical buttons and no status).
function restartButton(restart) {
  const { action: a, name } = restart;
  const btn = h("button", {
    type: "button",
    class: "btn btn--ghost",
    "aria-label": a.label,
    onclick: async () => {
      // Ask first, inline under this button (A7 P7), while it can still take focus back.
      if (!(await askFirst(btn, FIX_WHAT[a.name] || `${a.label}? Anyone using it is cut off for a moment.`, { confirm: a.label }))) return;
      btn.disabled = true;
      btn.textContent = "Restarting…";
      btn.setAttribute("aria-label", `Restarting ${name}`);
      // fix() shows the outcome (or the reason it failed) and returns false on failure.
      const done = await fix(a.name, a.label, {
        asked: true,
        isCurrent: () => btn.isConnected,
      });
      btn.textContent = done ? "Restarted" : "Restart";
      setTimeout(() => { btn.disabled = false; btn.textContent = "Restart"; btn.setAttribute("aria-label", a.label); }, done ? 2000 : 0);
    },
  }, "Restart");
  return btn;
}

function serviceRow({ service, restart }) {
  const [label, unitTone] = service
    ? STATE[service.state || "unknown"] || [service.state || "unknown", "warn"]
    : [restart.status, restart.tone];
  // A running unit whose record reports trouble shows the record's tone; a stopped unit shows its own.
  const tone = service && unitTone === "ok" && restart?.tone ? restart.tone : unitTone;
  const what = [service?.what, service && restart?.status ? restart.status : ""].filter(Boolean).join(" · ");
  return h(
    "li",
    { class: "log-row" },
    h("span", { class: "dot", dataset: { tone }, "aria-hidden": "true" }),
    h(
      "span",
      { class: "log-main" },
      h("strong", {}, service?.name || restart.name),
      what ? h("span", { class: "meta" }, what) : null,
    ),
    h(
      "span",
      { class: "log-side", dataset: { tone } },
      label,
      restart ? restartButton(restart) : null,
    ),
  );
}

// The systems Health watches beyond the Pi: Local AI and the PC it runs on, and the workshop touchscreen (their cards
// left Workshop, workshop flow W.1). Read from their records; a record not read yet, unknown or stale is never "off".
const OTHER_SYSTEMS = [
  ["local_ai", "Local AI"],
  ["workshop_display", "Workshop display"],
  ["pc", "Windows PC"],
];
const SEVERITY_TONE = { ok: "ok", info: "ok", attention: "warn", problem: "bad" };

export function otherSystemRows(records) {
  const byId = new Map(asArray(records).filter((r) => r && r.id).map((r) => [r.id, r]));
  return OTHER_SYSTEMS.map(([id, label]) => {
    const r = byId.get(id);
    if (!r) return { id, label, text: "Not checked yet", tone: "warn", meta: "" };
    const tone = r.state === "unknown" || r.stale ? "warn" : SEVERITY_TONE[r.severity] || "warn";
    const d = asObject(r.detail);
    const models = asArray(d.models).filter(Boolean);
    const meta = r.cause
      || (id === "local_ai" && models.length ? `Models loaded: ${models.join(", ")}` : "")
      || (id === "workshop_display" && d.firmware ? `Firmware ${d.firmware}` : "");
    return { id, label, text: r.headline || "No reading", tone, meta };
  });
}

function otherSystemsCard(records) {
  return section(card(
    "Other systems",
    {},
    h(
      "ul",
      { class: "log" },
      otherSystemRows(records).map(({ id, label, text, tone, meta }) =>
        h(
          "li",
          { class: "log-row", dataset: { system: id } },
          h("span", { class: "dot", dataset: { tone }, "aria-hidden": "true" }),
          h("span", { class: "log-main" }, h("strong", {}, label), h("span", { class: "meta" }, text), meta ? h("span", { class: "meta" }, meta) : null),
        )),
    ),
    h("p", { class: "meta" }, "Pair the workshop touchscreen in ", h("a", { href: "/settings#group-home", "data-link": true }, "Settings"), "."),
  ), "others");
}

function servicesCard(
  services,
  actions,
  records,
) {
  const list =
    mergeServices(
      asArray(services),
      serviceRows(asArray(actions), records),
    );
  return card(
    "Services",
    {},
    list.length
      ? h(
          "ul",
          {
            class: "log service-list",
          },
          list.map(serviceRow),
        )
      : empty(
          "No service status is available.",
        ),
    actions === null
      ? null
      : actions.length
        ? null
        : h(
            "p",
            {
              class: "meta",
            },
            "Sign in as the owner to restart services.",
          ),
    h(
      "a",
      {
        class: "action",
        href: toolPath("pi", "/system/services"),
        target: "_blank",
        rel:
          "noopener noreferrer",
      },
      "More in Cockpit",
    ),
  );
}

function storageCard(storage) {
  const list =
    asArray(storage);

  return card(
    "Pi disks",
    {},

    list.length
      ? list.map(
          (storageItem) => {
            const used =
              clampPercent(
                storageItem?.used_pct,
              );

            const tone =
              used > 90
                ? "bad"
                : used > 75
                  ? "warn"
                  : "ok";

            return h(
              "div",
              {
                class: "store",
              },

              h(
                "div",
                {
                  class:
                    "store-head",
                },

                h(
                  "strong",
                  {},
                  storageItem?.name ||
                    "Disk",
                ),

                h(
                  "span",
                  {
                    class: "meta",
                  },

                  storageItem?.mounted
                    ? `${storageItem.free_gb ?? "—"} GB free of ${storageItem.total_gb ?? "—"} GB`
                    : "Not connected",
                ),
              ),

              storageItem?.mounted
                ? h(
                    "span",
                    {
                      class: "meter",

                      role:
                        "progressbar",

                      "aria-label":
                        `${storageItem?.name || "Disk"} used`,

                      "aria-valuemin":
                        "0",

                      "aria-valuemax":
                        "100",

                      "aria-valuenow":
                        String(
                          Math.round(
                            used,
                          ),
                        ),
                    },

                    h("i", {
                      style:
                        `width:${used}%`,

                      dataset: {
                        tone,
                      },
                    }),
                  )
                : null,
            );
          },
        )
      : empty(
          "Disk information is unavailable.",
        ),
  );
}

function updatesCard(
  state,
  data,
  actionsData,
) {
  const updates =
    asArray(data?.updates);

  const actionUpdates =
    asObject(
      actionsData?.updates,
    );

  const running =
    actionUpdates.state ===
    "running";

  return card(
    "Updates",
    {
      pill: updates.length
        ? `${updates.length} waiting`
        : "Up to date",

      tone: updates.length
        ? "warn"
        : "ok",
    },

    updates.length
      ? h(
          "ul",
          {
            class: "pkg",
          },

          updates
            .slice(0, 12)
            .map((update) =>
              h(
                "li",
                {},

                h(
                  "strong",
                  {},
                  update?.name ||
                    "Package",
                ),

                update?.version
                  ? h(
                      "span",
                      {
                        class:
                          "meta",
                      },
                      update.version,
                    )
                  : null,
              ),
            ),
        )
      : empty(
          "Everything's up to date. Security fixes install by themselves each day.",
        ),

    updates.length
      ? h(
          "button",
          {
            type: "button",
            class: "ghost updates-install",

            disabled:
              state.running ||
              running,

            onclick: (event) =>
              runFix(state, "updates:install", "Install updates", undefined, false, event.currentTarget),
          },
          running
            ? "Installing…"
            : "Install them now",
        )
      : null,
  );
}

function networkCard(network) {
  const data =
    asObject(network);
  const m =
    asObject(data.metrics);

  const facts = [
    h(
      "div",
      {},
      h("dt", {}, "Name"),
      h("dd", {}, data.name || "—"),
    ),
    h(
      "div",
      {},
      h("dt", {}, "Address"),
      h("dd", {}, data.ip || "—"),
    ),
    h(
      "div",
      {},
      h("dt", {}, "Connection"),
      h("dd", {}, data.connection || "Network cable"),
    ),
  ];

  if (m.orbi_ms !== undefined) {
    facts.push(
      h(
        "div",
        {},
        h("dt", {}, "Orbi Router"),
        h("dd", {}, m.orbi_ms !== null ? `${m.orbi_ms} ms` : "—"),
      ),
      h(
        "div",
        {},
        h("dt", {}, "AT&T Gateway"),
        h("dd", {}, m.att_ms !== null ? `${m.att_ms} ms` : "—"),
      ),
      h(
        "div",
        {},
        h("dt", {}, "Internet (WAN)"),
        h("dd", {}, m.wan_ms !== null ? `${m.wan_ms} ms` : "—"),
      ),
      h(
        "div",
        {},
        h("dt", {}, "DNS Lookup"),
        h("dd", {}, m.dns_ms !== null ? `${m.dns_ms} ms` : "—"),
      ),
    );
  }

  // A hop that doesn't answer (its reading is null) is what a person opening this card is looking for.
  const silent = ["orbi_ms", "att_ms", "wan_ms", "dns_ms"].filter((k) => m[k] === null);
  const trouble = silent.length
    ? { pill: `${silent.length} not answering`, tone: silent.includes("wan_ms") ? "bad" : "warn" }
    : {};

  return card(
    "Network",
    trouble,
    h(
      "dl",
      {
        class: "facts",
      },
      ...facts,
    ),
    h(
      "div",
      {
        class: "network-tools-actions",
        style: "display: flex; gap: .5rem; margin-top: 1rem; flex-wrap: wrap;",
      },
      h(
        "a",
        {
          class: "button secondary",
          href: m.grafana_url || "https://network.rahe-home.duckdns.org/",
          target: "_blank",
          rel: "noopener",
          style: "font-size: .875rem; text-decoration: none;",
        },
        "Open Grafana ↗",
      ),
      h(
        "a",
        {
          class: "button secondary",
          href: m.uptime_kuma_url || "https://status.rahe-home.duckdns.org/status/home",
          target: "_blank",
          rel: "noopener",
          style: "font-size: .875rem; text-decoration: none;",
        },
        "Open Uptime Kuma ↗",
      ),
    ),
  );
}

async function loadDiagnostics(
  state,
) {
  const [
    diagnosticsResult,
    actionsResult,
    recordsResult,
  ] =
    await Promise.allSettled([
      api(
        `/api/pi?hours=${state.range}`,
      ),

      api("/api/actions"),

      api("/api/records"),
    ]);

  // Records only colour the restartable services; without them those rows say nothing about health.
  const recordsValue =
    recordsResult.status ===
    "fulfilled"
      ? recordsResult.value
      : null;

  const records =
    asArray(
      recordsValue?.records ||
        recordsValue,
    );

  state.others.replaceChildren(
    otherSystemsCard(
      recordsResult.status ===
        "fulfilled"
        ? records
        : null,
    ),
  );

  if (
    diagnosticsResult.status !==
    "fulfilled"
  ) {
    throw diagnosticsResult.reason;
  }

  const data =
    asObject(
      diagnosticsResult.value,
    );

  /*
   * Diagnostics are still useful if the actions endpoint is temporarily down.
   * Do not discard health/service/storage information just because maintenance
   * actions cannot be loaded.
   */
  const actionsData =
    actionsResult.status ===
    "fulfilled"
      ? asObject(
          actionsResult.value,
        )
      : {
          actions: [],
          log: [],
          updates: {},
        };

  // The self-check is the faceplate (A7 P1); then five sections in view (A6, decision health): services, Pi disks,
  // updates, other systems (its own slot, above) and fix it. Outages, network and history are under More.
  state.plate.replaceChildren(section(healthPlate(data.selfcheck, data.services, data.health), "selfcheck"));
  state.body.replaceChildren(
    section(servicesCard(
      data.services,
      actionsResult.status === "fulfilled" ? asArray(actionsData.actions) : null,
      records,
    ), "services"),
    section(storageCard(data.storage), "disks"),
    section(updatesCard(state, data, actionsData), "updates"),
  );

  state.fix.replaceChildren(...[
    actionsResult.status !== "fulfilled"
      ? h("p", { class: "ui-notice ui-notice--warn" }, "Health checks loaded, but the fixes aren't available right now.")
      : null,
    section(fixCard(state, actionsData), "fix"),
  ].filter(Boolean));

  state.more.fill("outages", [outagesCard(data.outages)]);
  state.more.fill("network", [networkCard(data.network)]);
  state.more.fill("history", [healthCard(state, data)]);
}

// Household guides stay available even when the diagnostic service is down.
export async function load(
  state,
) {
  if (
    state.loading &&
    !state.loadingRange
  ) {
    return;
  }

  state.loading = true;

  state.diagnostic.textContent =
    "Checking system details…";

  try {
    await loadDiagnostics(
      state,
    );

    if (
      !state.root.isConnected
    ) {
      return;
    }

    state.diagnostic.textContent =
      "System checks updated.";
  } catch {
    if (
      !state.root.isConnected
    ) {
      return;
    }

    // The faceplate says it for everyone who can see it; the status line still tells a screen reader.
    state.diagnostic.textContent =
      "System checks unavailable. The help guides on this page still work.";

    state.fix.replaceChildren();
    for (const key of ["outages", "network", "history"]) state.more.fill(key, []);
    // Unknown, never healthy: the faceplate says the checks didn't answer and offers to try again.
    state.body.replaceChildren();
    state.plate.replaceChildren(section(faceplate({
      name: "Self-check", lamp: ["unknown", "Not answering"], readout: "—",
      caption: "The hub’s diagnostic service didn’t answer. We’ll keep trying automatically. The help guides below still work.",
      actions: [h("button", { type: "button", class: "ui-btn", onclick: () => load(state) }, "Retry system checks")],
    }), "selfcheck"));
  } finally {
    state.loading = false;
  }
}

function showFixResult(
  state,
  name,
  result,
) {
  if (
    !state.root.isConnected
  ) {
    return;
  }

  const response =
    asObject(result);

  const verification =
    asObject(
      response.verification,
    );

  const status =
    verification.state;

  const title =
    !response.ok
      ? "The fix didn’t finish"
      : status === "checking"
        ? "Checking recovery…"
        : status ===
            "recovered"
          ? "Recovery check passed"
          : status ===
              "not_supported"
            ? "Action requested"
            : "Recovery is not confirmed";

  state.result.hidden =
    false;

  state.result.dataset.tone =
    !response.ok
      ? "bad"
      : status ===
          "recovered"
        ? "ok"
        : "warn";

  state.result.replaceChildren(
    h(
      "h2",
      {},
      title,
    ),

    h(
      "p",
      {},
      response.message ||
        (response.ok
          ? "The action was requested."
          : "The action did not complete."),
    ),

    h(
      "p",
      {
        class: "meta",
      },

      verification.next_step ||
        (response.ok
          ? "Waiting for a fresh response; the fix won’t be repeated."
          : "Check the connection and the relevant guide before trying again."),
    ),
  );

  if (
    response.ok &&
    ![
      "checking",
      "not_supported",
    ].includes(status)
  ) {
    state.result.append(
      h(
        "button",
        {
          type: "button",
          class: "ghost",

          onclick: () =>
            runFix(
              state,
              name,
              "",
              "",
              true,
            ),
        },
        "Check recovery again",
      ),
    );
  }

  state.result.scrollIntoView({
    block: "nearest",
    behavior: window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
      ? "auto"
      : "smooth",
  });
}

// Runs one fix. It asks first, inline under `trigger` (A7 P7), before any button is disabled, so focus can go back to it.
async function runFix(
  state,
  name,
  label,
  confirmText,
  checkOnly = false,
  trigger = null,
) {
  if (
    state.running ||
    !name
  ) {
    return;
  }

  if (!checkOnly && !(await askFirst(trigger, confirmText || FIX_WHAT[name] || `${label}?`, { confirm: label, danger: name === "restart:pi" }))) {
    return;
  }
  if (state.running) {
    return;
  }

  state.running = true;

  const buttons =
    state.root.querySelectorAll(
      ".health-fixes button, .fix-result button, .updates-install",
    );

  buttons.forEach(
    (button) => {
      button.disabled = true;
    },
  );

  const options = {
    isCurrent: () =>
      state.root.isConnected,

    onResult: (result) =>
      showFixResult(
        state,
        name,
        result,
      ),
  };

  try {
    if (checkOnly) {
      await verifyFix(
        name,
        options,
      );
    } else {
      await fix(
        name,
        label,
        {
          ...options,
          asked: true,
        },
      );
    }
  } finally {
    state.running = false;

    if (
      state.root.isConnected
    ) {
      await load(state);
    }
  }
}