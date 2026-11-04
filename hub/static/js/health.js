// System › Health (platform step 7, PR 7.3): the hub and the Pi in one page. It took over /pi's cards and System's
// services. A6 keeps six sections in view (self-check, services, Pi disks, updates, other systems, fix it) and folds
// outages, network, history and the help guides into a collapsed More.
import {
  api,
  card,
  duration,
  empty,
  fix,
  verifyFix,
  h,
  spark,
  when,
} from "./core.js";
import { moreList, openInRow } from "./section-links.js";
import { toolPath } from "./sections.js";

export const every = 20;

// One of Health's six sections (A6): marked so the page, and its test, can tell them from what is under More.
const section = (node, name) => { node.dataset.health = name; return node; };

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

const CONFIRM = {
  "restart:pi":
    "Restart the Pi? Plex, Homebridge and the hub go away for about a minute.",

  "updates:install":
    "Install all waiting updates now? Plex or Homebridge may restart.",
};

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

  state.body = h("div", {
    class: "cards",
  });

  // Other systems has its own slot: it reads the records, so it stays when the Pi's diagnostics fail.
  state.others = h("div", { class: "pi-bottom-grid" });

  state.diagnostic = h(
    "p",
    {
      class: "meta",
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
    items: [["outages", "Outages"], ["network", "Network"], ["history", "Health history"], ["help", "What isn’t working?"]],
  });
  for (const key of ["outages", "network", "history"]) state.more.fill(key, []);  // until the diagnostics answer
  state.more.fill("help", topic ? [] : helpBody());
  const first = !topic ? null : h("section", { class: "help-start", "aria-labelledby": "help-title" },
    h("h2", { id: "help-title" }, "What isn’t working?"), ...helpBody());

  state.root.append(...[
    state.result,
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

function selfcheckCard(check) {
  if (!check) {
    return card(
      "Self-check",
      {},

      empty(
        "The first self-check runs tonight at 4:15. Tap “Run a self-check” above to run one now.",
      ),
    );
  }

  const checks =
    asArray(check.checks);

  const bad = checks.filter(
    (item) => !item?.ok,
  );

  const total =
    finiteNumber(check.total) ??
    checks.length;

  const failed =
    finiteNumber(check.failed) ??
    bad.length;

  return card(
    "Self-check",
    {
      pill: check.passed
        ? `All ${total} passed`
        : `${failed} of ${total} failed`,

      tone: check.passed
        ? "ok"
        : "bad",
    },

    h(
      "p",
      {
        class: "meta",
      },
      `Last run ${safeWhen(
        check.ts,
      )}. Every page, every API, the services, free space, last night's backup and the temperature.`,
    ),

    bad.length
      ? h(
          "ul",
          {
            class: "log",
          },

          bad.map((item) =>
            h(
              "li",
              {
                class: "log-row",
              },

              h("span", {
                class: "dot",
                dataset: {
                  tone: "bad",
                },
                "aria-hidden": "true",
              }),

              h(
                "span",
                {
                  class: "log-main",
                },

                h(
                  "strong",
                  {},
                  item?.name ||
                    "Check failed",
                ),

                item?.detail
                  ? h(
                      "span",
                      {
                        class: "meta",
                      },
                      item.detail,
                    )
                  : null,
              ),
            ),
          ),
        )
      : null,
  );
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

function fixCard(
  state,
  actionsData,
) {
  const data =
    asObject(actionsData);

  const updates =
    asObject(data.updates);

  const actions =
    asArray(data.actions);

  const log =
    asArray(data.log);

  return card(
    "Fix it",
    {
      cls: "wide",

      pill:
        updates.state ===
        "running"
          ? "Updates installing"
          : null,

      tone: "warn",
    },

    h(
      "p",
      {
        class: "meta",
      },
      "Choose a fix after checking the problem above. You’ll confirm before anything changes.",
    ),

    actions.length
      ? h(
          "div",
          {
            class: "fix-grid",
          },

          actions.map((action) => {
            const name =
              action?.name || "";

            const updateRunning =
              name ===
                "updates:install" &&
              updates.state ===
                "running";

            return h(
              "button",
              {
                type: "button",

                class:
                  `btn ghost ${
                    name ===
                    "restart:pi"
                      ? "btn--danger"
                      : ""
                  }`,

                disabled:
                  state.running ||
                  updateRunning,

                onclick: () =>
                  runFix(
                    state,
                    name,
                    action?.label ||
                      "Run action",
                    CONFIRM[name],
                  ),
              },
              action?.label ||
                name ||
                "Run action",
            );
          }),
        )
      : empty(
          "No maintenance actions are available right now.",
        ),

    updates.state ===
    "failed"
      ? h(
          "p",
          {
            class: "note",
          },
          `The last update run didn't finish${
            updates.message
              ? `: ${updates.message}`
              : "."
          }`,
        )
      : null,

    log.length
      ? [
          h(
            "h3",
            {
              class: "sub",
            },
            "Recent fixes",
          ),

          h(
            "ul",
            {
              class: "log",
            },

            log
              .slice(0, 5)
              .map((entry) => {
                const result =
                  entry?.result ||
                  "Action completed";

                const bad =
                  /didn't|isn't|failed|error/i.test(
                    result,
                  );

                return h(
                  "li",
                  {
                    class:
                      "log-row",
                  },

                  h("span", {
                    class: "dot",

                    dataset: {
                      tone: bad
                        ? "bad"
                        : "ok",
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
                      result,
                    ),

                    h(
                      "span",
                      {
                        class:
                          "meta",
                      },
                      entry?.device ||
                        "A device",
                    ),
                  ),

                  h(
                    "span",
                    {
                      class:
                        "log-side",
                    },
                    safeWhen(
                      entry?.ts,
                    ),
                  ),
                );
              }),
          ),
        ]
      : null,
  );
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
      btn.disabled = true;
      btn.textContent = "Restarting…";
      btn.setAttribute("aria-label", `Restarting ${name}`);
      // fix() asks first, shows the outcome (or the reason it failed) and returns false on cancel or failure.
      const done = await fix(a.name, a.label, {
        confirmText: `${a.label}? Anyone using it is cut off for a moment.`,
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
    h("p", { class: "meta" }, "Pair the workshop touchscreen in ", h("a", { href: "/settings", "data-link": true }, "Settings"), "."),
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
            class: "ghost",

            disabled:
              state.running ||
              running,

            onclick: () =>
              runFix(
                state,
                "updates:install",
                "Install updates",
                CONFIRM[
                  "updates:install"
                ],
              ),
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

  return card(
    "Network",
    {},
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

  // Six sections in view (A6, decision health): self-check, services, Pi disks, updates, other systems (its own slot,
  // above) and fix it. Outages, network and history are under More.
  state.body.replaceChildren(
    section(selfcheckCard(data.selfcheck), "selfcheck"),

    h("div", { class: "pi-bottom-grid" },
      section(servicesCard(
        data.services,
        actionsResult.status === "fulfilled" ? asArray(actionsData.actions) : null,
        records,
      ), "services"),
      section(storageCard(data.storage), "disks"),
      section(updatesCard(state, data, actionsData), "updates")),
  );

  state.fix.replaceChildren(...[
    actionsResult.status !== "fulfilled"
      ? card("Maintenance actions unavailable", { tone: "warn" },
        h("p", { class: "meta" }, "Health checks loaded, but restart and update controls aren't available right now."))
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

  state.diagnostic.classList.toggle("sr", false);
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

    // The card below says it for everyone who can see it; the status line still tells a screen reader.
    state.diagnostic.classList.toggle("sr", true);
    state.diagnostic.textContent =
      "System checks unavailable. The help guides on this page still work.";

    state.fix.replaceChildren();
    for (const key of ["outages", "network", "history"]) state.more.fill(key, []);
    state.body.replaceChildren(
      card(
        "Couldn’t check the system",
        {
          tone: "warn",
        },

        h(
          "p",
          {
            class: "meta",
          },
          "The hub’s diagnostic service didn’t answer. We’ll keep trying automatically. The help guides below still work.",
        ),

        h(
          "button",
          {
            type: "button",
            class: "ghost",

            onclick: () =>
              load(state),
          },
          "Retry system checks",
        ),
      ),
    );
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

async function runFix(
  state,
  name,
  label,
  confirmText,
  checkOnly = false,
) {
  if (
    state.running ||
    !name
  ) {
    return;
  }

  state.running = true;

  const buttons =
    state.root.querySelectorAll(
      ".fix-grid button, .fix-result button",
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
          confirmText,
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