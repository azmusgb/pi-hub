import { VERIFIABLE, verifyRecovery } from "./recovery.js";

// Shared helpers for every page: building elements, talking to the hub,
// authentication, common UI, and small formatters.

const DEFAULT_TIMEOUT_MS = 30_000;
const DRIVE_TIMEOUT_MS = 150_000;
const ACTION_VERIFY_TIMEOUT_MS = 15_000;

const RANK = {
  none: 0,
  kid: 1,
  household: 2,
  owner: 3,
};

// A source that doesn't answer in time gives its fallback, so one slow service never holds a whole page.
export function settle(promise, ms, fallback) {
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// One load per page at a time. A load that misses its deadline is reported as failed, but it is left to finish (each
// request has its own timeout) and no new load starts until it has, so a late answer can never overwrite a newer one.
export function loadOnce(page, start, ms) {
  if (page.inflight) return Promise.resolve({ skipped: true });
  const run = Promise.resolve().then(start);
  page.inflight = run;
  run.catch(() => {}).finally(() => { if (page.inflight === run) page.inflight = null; });
  return deadline(run, ms).then(() => ({ skipped: false }));
}

// A page load that hangs fails after its deadline, so the page says so and the next refresh can try again.
export function deadline(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The page took too long to load.")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function makeTimeoutSignal(ms) {
  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
  ) {
    return AbortSignal.timeout(ms);
  }

  if (typeof AbortController === "undefined") {
    return undefined;
  }

  const controller = new AbortController();

  setTimeout(() => {
    controller.abort(
      new DOMException("The request timed out.", "TimeoutError"),
    );
  }, ms);

  return controller.signal;
}

function combineSignals(...signals) {
  const valid = signals.filter(Boolean);

  if (!valid.length) {
    return undefined;
  }

  if (valid.length === 1) {
    return valid[0];
  }

  if (
    typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.any === "function"
  ) {
    return AbortSignal.any(valid);
  }

  if (typeof AbortController === "undefined") {
    return valid[0];
  }

  const controller = new AbortController();

  const abort = (signal) => {
    if (controller.signal.aborted) {
      return;
    }

    try {
      controller.abort(signal.reason);
    } catch {
      controller.abort();
    }
  };

  for (const signal of valid) {
    if (signal.aborted) {
      abort(signal);
      break;
    }

    signal.addEventListener(
      "abort",
      () => abort(signal),
      { once: true },
    );
  }

  return controller.signal;
}

function appendChild(parent, child) {
  if (
    child == null ||
    child === false
  ) {
    return;
  }

  if (
    typeof Node !== "undefined" &&
    child instanceof Node
  ) {
    parent.append(child);
    return;
  }

  parent.append(String(child));
}

export function h(
  tag,
  attrs = {},
  ...kids
) {
  const node =
    document.createElement(tag);

  for (
    const [key, value] of
    Object.entries(attrs || {})
  ) {
    if (
      value == null ||
      value === false
    ) {
      continue;
    }

    if (key === "class") {
      node.className =
        String(value);

      continue;
    }

    if (key === "dataset") {
      if (
        value &&
        typeof value === "object"
      ) {
        for (
          const [dataKey, dataValue] of
          Object.entries(value)
        ) {
          if (
            dataValue == null ||
            dataValue === false
          ) {
            continue;
          }

          node.dataset[dataKey] =
            String(dataValue);
        }
      }

      continue;
    }

    if (key === "style") {
      if (
        typeof value === "string"
      ) {
        node.style.cssText =
          value;
      } else if (
        value &&
        typeof value === "object"
      ) {
        for (
          const [styleKey, styleValue] of
          Object.entries(value)
        ) {
          if (
            styleValue == null
          ) {
            continue;
          }

          node.style[styleKey] =
            String(styleValue);
        }
      }

      continue;
    }

    if (
      key.startsWith("on") &&
      typeof value === "function"
    ) {
      node.addEventListener(
        key.slice(2).toLowerCase(),
        value,
      );

      continue;
    }

    if (value === true) {
      node.setAttribute(
        key,
        "",
      );

      continue;
    }

    node.setAttribute(
      key,
      String(value),
    );
  }

  for (const child of kids.flat(Infinity)) {
    appendChild(
      node,
      child,
    );
  }

  return node;
}

async function parseResponseBody(response) {
  const contentType =
    response.headers.get(
      "content-type",
    ) || "";

  if (
    contentType.includes(
      "application/json",
    )
  ) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  try {
    const text =
      await response.text();

    return text || null;
  } catch {
    return null;
  }
}

function responseErrorMessage(
  response,
  body,
) {
  if (
    body &&
    typeof body === "object"
  ) {
    return (
      body.detail ||
      body.error ||
      body.message ||
      `The hub answered ${response.status}.`
    );
  }

  if (
    typeof body === "string" &&
    body.trim()
  ) {
    return body.trim();
  }

  return `The hub answered ${response.status}.`;
}

export async function api(
  path,
  opts = {},
) {
  const method =
    String(
      opts.method || "GET",
    ).toUpperCase();

  const timeout =
    path.startsWith(
      "/api/drives",
    )
      ? DRIVE_TIMEOUT_MS
      : DEFAULT_TIMEOUT_MS;

  const timeoutSignal =
    makeTimeoutSignal(timeout);

  const signal =
    combineSignals(
      opts.signal,
      timeoutSignal,
    );

  let response;

  try {
    response = await fetch(
      path,
      {
        cache: "no-store",
        ...opts,
        method,
        signal,
      },
    );
  } catch (error) {
    if (
      error?.name ===
        "AbortError" ||
      error?.name ===
        "TimeoutError"
    ) {
      throw new Error(
        "The hub took too long to respond.",
      );
    }

    throw new Error(
      error?.message ||
        "The hub could not be reached.",
    );
  }

  const body =
    await parseResponseBody(
      response,
    );

  if (!response.ok) {
    const failure = new Error(
      responseErrorMessage(
        response,
        body,
      ),
    );
    failure.status = response.status;
    throw failure;
  }

  return body;
}

export function post(
  path,
  data,
  opts = {},
) {
  const headers = new Headers(
    opts.headers || {},
  );

  if (
    data !== undefined &&
    !headers.has(
      "Content-Type",
    )
  ) {
    headers.set(
      "Content-Type",
      "application/json",
    );
  }

  return api(
    path,
    {
      ...opts,
      method: "POST",
      headers,

      body:
        data === undefined
          ? undefined
          : JSON.stringify(data),
    },
  );
}

let toastTimer = null;

export function toast(
  message,
  tone = "ok",
) {
  const element =
    document.getElementById(
      "toast",
    );

  if (!element) {
    return;
  }

  element.textContent =
    String(
      message ||
        "Something happened.",
    );

  element.dataset.tone =
    tone;

  element.hidden =
    false;

  clearTimeout(
    toastTimer,
  );

  toastTimer =
    setTimeout(
      () => {
        if (
          element.isConnected
        ) {
          element.hidden =
            true;
        }
      },
      4000,
    );
}

export function clockTime(ts) {
  const seconds =
    finiteNumber(ts);

  if (seconds === null) {
    return "—";
  }

  const date =
    new Date(
      seconds * 1000,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "—";
  }

  return date.toLocaleTimeString(
    [],
    {
      hour: "numeric",
      minute: "2-digit",
    },
  );
}

export function when(ts) {
  const seconds =
    finiteNumber(ts);

  if (seconds === null) {
    return "—";
  }

  const date =
    new Date(
      seconds * 1000,
    );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return "—";
  }

  const now =
    new Date();

  const today =
    new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );

  const yesterday =
    new Date(today);

  yesterday.setDate(
    yesterday.getDate() - 1,
  );

  const targetDay =
    new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
    );

  const time =
    clockTime(seconds);

  if (
    targetDay.getTime() ===
    today.getTime()
  ) {
    return `Today, ${time}`;
  }

  if (
    targetDay.getTime() ===
    yesterday.getTime()
  ) {
    return `Yesterday, ${time}`;
  }

  return `${date.toLocaleDateString(
    [],
    {
      weekday: "short",
      day: "numeric",
      month: "short",
    },
  )}, ${time}`;
}

export function duration(
  seconds,
) {
  const value =
    finiteNumber(seconds);

  if (value === null) {
    return "—";
  }

  const totalMinutes =
    Math.max(
      0,
      Math.round(
        value / 60,
      ),
    );

  if (
    totalMinutes < 60
  ) {
    return `${totalMinutes} min`;
  }

  const hours =
    Math.floor(
      totalMinutes / 60,
    );

  const minutes =
    totalMinutes % 60;

  return `${hours} h ${String(
    minutes,
  ).padStart(2, "0")} min`;
}

export function spark(
  values,
  {
    max,
    height = 28,
  } = {},
) {
  const ns =
    "http://www.w3.org/2000/svg";

  const svg =
    document.createElementNS(
      ns,
      "svg",
    );

  const chartHeight =
    Math.max(
      1,
      finiteNumber(height) ??
        28,
    );

  svg.setAttribute(
    "viewBox",
    `0 0 100 ${chartHeight}`,
  );

  svg.setAttribute(
    "preserveAspectRatio",
    "none",
  );

  svg.setAttribute(
    "aria-hidden",
    "true",
  );

  svg.classList.add(
    "spark",
  );

  const vals =
    (Array.isArray(values)
      ? values
      : []
    )
      .map(finiteNumber)
      .filter(
        (value) =>
          value !== null,
      );

  if (
    vals.length < 2
  ) {
    return svg;
  }

  const requestedMax =
    finiteNumber(max);

  const top =
    requestedMax !== null &&
    requestedMax > 0
      ? requestedMax
      : Math.max(
          ...vals,
          1,
        );

  const points =
    vals.map(
      (value, index) => {
        const x =
          (index /
            (vals.length -
              1)) *
          100;

        const normalized =
          Math.max(
            0,
            Math.min(
              value,
              top,
            ),
          ) / top;

        const y =
          chartHeight -
          normalized *
            (chartHeight -
              2);

        return `${x},${y}`;
      },
    );

  const area =
    document.createElementNS(
      ns,
      "polygon",
    );

  area.setAttribute(
    "points",
    `0,${chartHeight} ${points.join(
      " ",
    )} 100,${chartHeight}`,
  );

  const line =
    document.createElementNS(
      ns,
      "polyline",
    );

  line.setAttribute(
    "points",
    points.join(" "),
  );

  svg.append(
    area,
    line,
  );

  return svg;
}

export function card(
  title,
  {
    pill,
    tone,
    id,
    cls,
  } = {},
  ...body
) {
  const classes = [
    "card",
    cls,
  ]
    .filter(Boolean)
    .join(" ");

  return h(
    "section",
    {
      class: classes,
      id,
    },

    h(
      "div",
      {
        class:
          "card-head",
      },

      h(
        "h2",
        {},
        title,
      ),

      pill != null &&
      pill !== ""
        ? h(
            "span",
            {
              class: "pill",

              dataset: tone
                ? { tone }
                : {},
            },
            pill,
          )
        : null,
    ),

    ...body,
  );
}

export const empty = (
  text,
) =>
  h(
    "p",
    {
      class: "empty",
    },
    text,
  );

// Links to apps on this Pi follow whatever address the hub was opened with.
export function piLink(
  port,
  path = "",
  scheme = "http",
) {
  const hostname =
    location.hostname.includes(
      ":",
    )
      ? `[${location.hostname}]`
      : location.hostname;

  const suffix =
    !path
      ? ""
      : path.startsWith("/")
        ? path
        : `/${path}`;

  return `${scheme}://${hostname}:${port}${suffix}`;
}

// ---- Who's signed in, and asking for the PIN only when an action needs it ----

let me = null;
let meRequest = null;

export async function whoami(
  force = false,
) {
  if (
    me &&
    !force
  ) {
    return me;
  }

  if (
    meRequest &&
    !force
  ) {
    return meRequest;
  }

  meRequest =
    api("/api/me")
      .then((result) => {
        me = result;
        return result;
      })
      .finally(() => {
        meRequest = null;
      });

  return meRequest;
}

export function forgetMe() {
  me = null;
  meRequest = null;
}

export async function ensure(
  role = "household",
) {
  // "kid" is enough for switching lights; everything else that acts
  // needs an adult's PIN.

  const required =
    RANK[role];

  if (
    required === undefined
  ) {
    throw new Error(
      `Unknown access role: ${role}`,
    );
  }

  const user =
    await whoami(true);

  const current =
    RANK[user?.role] ??
    RANK.none;

  if (
    current >= required
  ) {
    return true;
  }

  if (
    user?.setup_needed
  ) {
    toast(
      "Set up the hub first: choose the household PIN in Settings.",
      "warn",
    );

    setTimeout(
      () => {
        location.assign(
          "/settings",
        );
      },
      1200,
    );

    return false;
  }

  if (
    role === "owner"
  ) {
    location.assign(
      "/settings",
    );

    return false;
  }

  return pinSheet();
}

function pinSheet() {
  return new Promise(
    (resolve) => {
      const previousFocus =
        document.activeElement;

      let closed =
        false;

      const input = h(
        "input",
        {
          type: "password",
          inputmode:
            "numeric",
          pattern: "[0-9]*",
          maxlength: 6,
          autocomplete:
            "one-time-code",
          id: "pin-input",
          class:
            "pin-input",

          "aria-describedby":
            "pin-help",

          required: true,
        },
      );

      const error =
        h(
          "p",
          {
            class:
              "sheet-error",
            role: "alert",
            "aria-live":
              "assertive",
          },
        );

      const cancelButton =
        h(
          "button",
          {
            type: "button",
            class: "ghost",
          },
          "Cancel",
        );

      const submitButton =
        h(
          "button",
          {
            type: "submit",
            class:
              "primary",
          },
          "Unlock",
        );

      let dialog;

      const close = (
        ok,
      ) => {
        if (closed) {
          return;
        }

        closed = true;

        if (
          dialog?.open
        ) {
          dialog.close();
        }

        dialog?.remove();

        if (
          previousFocus instanceof
            HTMLElement &&
          previousFocus.isConnected
        ) {
          previousFocus.focus();
        }

        resolve(ok);
      };

      const form =
        h(
          "form",
          {
            method:
              "dialog",

            class:
              "sheet-body",

            onsubmit:
              async (
                event,
              ) => {
                event.preventDefault();

                const pin =
                  input.value.trim();

                if (!pin) {
                  error.textContent =
                    "Enter your PIN.";

                  input.focus();

                  return;
                }

                error.textContent =
                  "";

                input.disabled =
                  true;

                submitButton.disabled =
                  true;

                cancelButton.disabled =
                  true;

                try {
                  await post(
                    "/api/signin",
                    { pin },
                  );

                  forgetMe();

                  await whoami();

                  toast(
                    "Unlocked on this device for 30 days.",
                  );

                  close(true);
                } catch (
                  requestError
                ) {
                  error.textContent =
                    requestError?.message ||
                    "The PIN could not be verified.";

                  input.disabled =
                    false;

                  submitButton.disabled =
                    false;

                  cancelButton.disabled =
                    false;

                  input.select();
                }
              },
          },

          h(
            "h2",
            {
              id:
                "pin-title",
            },
            "Enter your PIN",
          ),

          h(
            "p",
            {
              id: "pin-help",
              class: "meta",
            },
            "The household PIN, or your own. Needed once on each device before it can change things.",
          ),

          h(
            "label",
            {
              for:
                "pin-input",
              class: "sr",
            },
            "Household PIN",
          ),

          input,
          error,

          h(
            "div",
            {
              class:
                "sheet-actions",
            },

            cancelButton,
            submitButton,
          ),
        );

      dialog =
        h(
          "dialog",
          {
            class: "sheet",

            "aria-labelledby":
              "pin-title",

            "aria-describedby":
              "pin-help",
          },
          form,
        );

      cancelButton.addEventListener(
        "click",
        () =>
          close(false),
      );

      dialog.addEventListener(
        "cancel",
        (event) => {
          event.preventDefault();
          close(false);
        },
      );

      document.body.append(
        dialog,
      );

      dialog.showModal();

      requestAnimationFrame(
        () => input.focus(),
      );
    },
  );
}

// Runs a Fix-it action after confirmation and reports what happened.
export async function fix(
  name,
  label,
  {
    confirmText,
    onResult,
    isCurrent = () =>
      true,
  } = {},
) {
  if (
    !(await ensure(
      "household",
    )) ||
    !isCurrent()
  ) {
    return false;
  }

  const question =
    confirmText ||
    `${label}?`;

  if (
    !window.confirm(
      question,
    )
  ) {
    return false;
  }

  toast(
    `${label}…`,
    "warn",
  );

  try {
    const result =
      await post(
        `/api/actions/${encodeURIComponent(
          name,
        )}`,
      );

    if (
      !isCurrent()
    ) {
      return true;
    }

    if (
      VERIFIABLE.has(
        name,
      )
    ) {
      await verifyFix(
        name,
        {
          onResult,
          isCurrent,
        },
      );
    } else {
      const message =
        result?.message ||
        `${label} was requested.`;

      toast(message);

      onResult?.({
        ok: true,
        message,

        verification: {
          state:
            "not_supported",

          next_step:
            "Check the action’s progress and try the original task again.",
        },
      });
    }

    return true;
  } catch (error) {
    if (
      isCurrent()
    ) {
      const message =
        error?.message ||
        "The action could not be completed.";

      toast(
        message,
        "bad",
      );

      onResult?.({
        ok: false,
        message,
      });
    }

    return false;
  }
}

export async function verifyFix(
  name,
  {
    onResult,
    isCurrent = () =>
      true,
  } = {},
) {
  if (
    !isCurrent()
  ) {
    return;
  }

  onResult?.({
    ok: true,

    message:
      "Checking the affected service…",

    verification: {
      state: "checking",
    },
  });

  let verification;

  try {
    verification =
      await verifyRecovery(
        name,
        {
          active:
            isCurrent,

          check:
            (key) =>
              api(
                `/api/actions/${encodeURIComponent(
                  key,
                )}/verification`,
                {
                  signal:
                    makeTimeoutSignal(
                      ACTION_VERIFY_TIMEOUT_MS,
                    ),
                },
              ),
        },
      );
  } catch (error) {
    if (
      !isCurrent()
    ) {
      return;
    }

    const message =
      error?.message ||
      "The recovery check could not finish.";

    toast(
      message,
      "warn",
    );

    onResult?.({
      ok: true,
      message,

      verification: {
        state:
          "unknown",

        next_step:
          "The action may still have succeeded. Check the affected service before trying the fix again.",
      },
    });

    return;
  }

  if (
    !isCurrent() ||
    verification?.state ===
      "cancelled"
  ) {
    return;
  }

  const message =
    verification?.message ||
    "Recovery check finished.";

  toast(
    message,
    verification?.state ===
      "recovered"
      ? "ok"
      : "warn",
  );

  onResult?.({
    ok: true,
    message,
    verification,
  });
}

// ---- Weather icons: a small drawn set, coloured by the stylesheet ----

const SUN =
  '<circle cx="12" cy="12" r="4.2" class="wx-sun"/><path class="wx-ray" d="M12 2.5v2.3M12 19.2v2.3M2.5 12h2.3M19.2 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>';

const MOON =
  '<path class="wx-moon" d="M16.5 15.8A7 7 0 0 1 9.2 5.2a7 7 0 1 0 7.3 10.6z"/>';

const CLOUD =
  '<path class="wx-cloud" d="M7 18.5h10.2a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2-1A4.3 4.3 0 0 0 7 18.5z"/>';

const SMALL_SUN =
  '<g transform="translate(-3.5 -3.5) scale(.75)">' +
  SUN +
  "</g>";

const SMALL_MOON =
  '<g transform="translate(-2.5 -3) scale(.75)">' +
  MOON +
  "</g>";

const WX = {
  "clear-day":
    SUN,

  "clear-night":
    MOON,

  "partly-day":
    SMALL_SUN +
    '<g transform="translate(3 3) scale(.82)">' +
    CLOUD +
    "</g>",

  "partly-night":
    SMALL_MOON +
    '<g transform="translate(3 3) scale(.82)">' +
    CLOUD +
    "</g>",

  cloudy:
    CLOUD,

  fog:
    '<path class="wx-line" d="M4 9h16M3 13h18M5 17h14"/>',

  rain:
    '<g transform="translate(0 -3)">' +
    CLOUD +
    '</g><path class="wx-drop" d="M8.5 18.5l-1 2.5M12.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/>',

  sleet:
    '<g transform="translate(0 -3)">' +
    CLOUD +
    '</g><path class="wx-drop" d="M8.5 18.5l-1 2.5M16.5 18.5l-1 2.5"/><circle cx="12" cy="20" r="1" class="wx-flake"/>',

  snow:
    '<g transform="translate(0 -3)">' +
    CLOUD +
    '</g><circle cx="8" cy="19.5" r="1" class="wx-flake"/><circle cx="12" cy="21" r="1" class="wx-flake"/><circle cx="16" cy="19.5" r="1" class="wx-flake"/>',

  storm:
    '<g transform="translate(0 -3)">' +
    CLOUD +
    '</g><path class="wx-bolt" d="M12.5 15.5l-2.5 4h3l-1.5 3.5"/>',
};

export function weatherIcon(
  name,
  label = "",
) {
  const iconName =
    Object.hasOwn(
      WX,
      name,
    )
      ? name
      : "cloudy";

  const span =
    document.createElement(
      "span",
    );

  span.className =
    `wx wx-${iconName}`;

  if (label) {
    span.setAttribute(
      "role",
      "img",
    );

    span.setAttribute(
      "aria-label",
      String(label),
    );
  } else {
    span.setAttribute(
      "role",
      "presentation",
    );

    span.setAttribute(
      "aria-hidden",
      "true",
    );
  }

  span.innerHTML =
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${WX[iconName]}</svg>`;

  return span;
}