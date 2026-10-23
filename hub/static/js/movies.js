// Movies: what's playing, continue watching, recently added, search, requests, and drive health.
import { api, card, empty, h, piLink, post, toast, when } from "./core.js";

export const every = 30;

const SEARCH_DEBOUNCE_MS = 300;
const REQUEST_MAX_LENGTH = 200;

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function clampPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function formatRuntime(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return null;

  const rounded = Math.round(total);

  if (rounded < 60) {
    return `${rounded} min`;
  }

  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;

  return mins
    ? `${hours} h ${String(mins).padStart(2, "0")} min`
    : `${hours} h`;
}

function remainingMinutes(item) {
  const minutes = Number(item?.minutes);
  const progress = clampPercent(item?.progress);

  if (!Number.isFinite(minutes) || minutes <= 0 || progress <= 0) {
    return null;
  }

  return Math.max(0, Math.round(minutes * (1 - progress / 100)));
}

function plexUrl(machine, key) {
  return machine && key
    ? piLink(
        32400,
        `/web/index.html#!/server/${machine}/details?key=${encodeURIComponent(
          `/library/metadata/${key}`,
        )}`,
      )
    : piLink(32400, "/web");
}

function poster(item, machine) {
  const title = item?.title || "Untitled";
  const progress = clampPercent(item?.progress);
  const left = remainingMinutes(item);

  const subtitle = [
    item?.year,
    formatRuntime(item?.minutes),
  ]
    .filter(Boolean)
    .join(" · ");

  const art = item?.thumb
    ? h("img", {
        src: `/api/plex/thumb?path=${encodeURIComponent(item.thumb)}`,
        alt: "",
        loading: "lazy",
        decoding: "async",
      })
    : h(
        "div",
        {
          class: "poster-blank",
          "aria-hidden": "true",
        },
        title.slice(0, 1).toUpperCase(),
      );

  return h(
    "li",
    {},
    h(
      "a",
      {
        class: "poster-card",
        href: plexUrl(machine, item?.key),
        target: "_blank",
        rel: "noopener noreferrer",
        "aria-label": subtitle ? `${title}, ${subtitle}` : title,
      },
      h("div", { class: "poster-art" }, art),

      progress > 0
        ? h(
            "span",
            {
              class: "poster-bar",
              "aria-hidden": "true",
            },
            h("i", {
              style: `width:${progress}%`,
            }),
          )
        : null,

      left !== null && left > 0
        ? h(
            "span",
            {
              class: "poster-left",
            },
            `${left}m left`,
          )
        : null,

      h(
        "div",
        {
          class: "poster-meta",
        },
        h(
          "span",
          {
            class: "poster-title",
          },
          title,
        ),

        subtitle
          ? h(
              "span",
              {
                class: "poster-sub",
              },
              subtitle,
            )
          : null,
      ),
    ),
  );
}

function shelf(items, machine) {
  const list = asArray(items);

  return list.length
    ? h(
        "ul",
        {
          class: "poster-shelf",
        },
        list.map((item) => poster(item, machine)),
      )
    : null;
}

function sectionId(title) {
  return `section-${title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function shelfSection(title, items, machine, none) {
  const list = asArray(items);

  if (!list.length) {
    return none
      ? h(
          "p",
          {
            class: "meta",
          },
          none,
        )
      : null;
  }

  const id = sectionId(title);

  return h(
    "section",
    {
      class: "movie-section",
      "aria-labelledby": id,
    },

    h(
      "div",
      {
        class: "eyebrow-section",
      },
      h(
        "h2",
        {
          id,
        },
        title,
      ),
    ),

    shelf(list, machine),
  );
}

export function mount(state) {
  const input = h("input", {
    type: "search",
    id: "movie-search",
    placeholder: "Search movies and shows",
    autocomplete: "off",
    enterkeyhint: "search",
  });

  state.results = h("div", {
    class: "movie-search-results",
    "aria-live": "polite",
    "aria-busy": "false",
  });

  let timer = null;
  let searchGeneration = 0;

  input.addEventListener("input", () => {
    clearTimeout(timer);

    const generation = ++searchGeneration;
    const q = input.value.trim();

    if (!q) {
      state.results.setAttribute("aria-busy", "false");
      state.results.replaceChildren();
      return;
    }

    timer = setTimeout(async () => {
      state.results.setAttribute("aria-busy", "true");

      try {
        const response = await api(
          `/api/movies/search?q=${encodeURIComponent(q)}`,
        );

        // Prevent an older request from overwriting newer search results.
        if (generation !== searchGeneration) {
          return;
        }

        const results = asArray(response?.results);

        state.results.replaceChildren(
          results.length
            ? h(
                "ul",
                {
                  class: "poster-shelf",
                },
                results.map((item) => poster(item, state.machine)),
              )
            : empty(`Nothing in the library matches “${q}”.`),
        );
      } catch {
        if (generation !== searchGeneration) {
          return;
        }

        state.results.replaceChildren(
          empty("Search isn't available while Plex is down."),
        );
      } finally {
        if (generation === searchGeneration) {
          state.results.setAttribute("aria-busy", "false");
        }
      }
    }, SEARCH_DEBOUNCE_MS);
  });

  state.body = h("div", {
    class: "stack",
  });

  state.root.append(
    h(
      "form",
      {
        class: "movie-search",
        role: "search",
        onsubmit: (event) => event.preventDefault(),
      },

      h(
        "label",
        {
          for: "movie-search",
          class: "sr",
        },
        "Search the library",
      ),

      input,
    ),

    state.results,
    state.body,
  );
}

function requestsCard(state, requests) {
  const list = asArray(requests);
  const open = list.filter((request) => !request.done);

  const input = h("input", {
    type: "text",
    id: "req-new",
    maxlength: REQUEST_MAX_LENGTH,
    placeholder: "A movie or show to get",
    autocomplete: "off",
    value: state.requestDraft || "",
  });

  const submit = h(
    "button",
    {
      type: "submit",
      class: "btn btn--primary",
    },
    "Request",
  );

  input.addEventListener("input", () => {
    state.requestDraft = input.value;
  });

  const mutate = async (action, failureMessage) => {
    try {
      await action();

      state.force = true;
      await load(state);
    } catch (error) {
      toast(
        error?.message || failureMessage,
        "bad",
      );
    }
  };

  return card(
    "Movie requests",
    {
      pill: open.length
        ? `${open.length} wanted`
        : null,

      tone: open.length
        ? "warn"
        : "ok",
    },

    h(
      "form",
      {
        class: "add-bar",

        onsubmit: async (event) => {
          event.preventDefault();

          const text = input.value.trim();

          if (!text) {
            return;
          }

          input.disabled = true;
          submit.disabled = true;

          try {
            await post(
              "/api/lists/requests",
              {
                text,
              },
            );

            state.requestDraft = "";
            input.value = "";
            state.force = true;

            await load(state);
          } catch (error) {
            toast(
              error?.message ||
                "Couldn't add that request.",
              "bad",
            );
          } finally {
            input.disabled = false;
            submit.disabled = false;
          }
        },
      },

      h(
        "label",
        {
          for: "req-new",
          class: "sr",
        },
        "Request a movie or show",
      ),

      input,
      submit,
    ),

    list.length
      ? h(
          "ul",
          {
            class: "items",
          },

          list.map((request) => {
            const id = `req-${request.id}`;

            return h(
              "li",
              {
                class: `item ${
                  request.done
                    ? "done"
                    : ""
                }`,
              },

              h("input", {
                type: "checkbox",
                id,
                checked: !!request.done,

                "aria-label": `${
                  request.done
                    ? "Mark as wanted"
                    : "Mark as acquired"
                }: ${request.text}`,

                onchange: (event) => {
                  event.currentTarget.disabled = true;

                  mutate(
                    () =>
                      post(
                        `/api/lists/requests/${request.id}/toggle`,
                      ),

                    "Couldn't update that request.",
                  );
                },
              }),

              h(
                "label",
                {
                  for: id,
                },
                request.text,
              ),

              h(
                "button",
                {
                  type: "button",
                  class: "ghost small remove-btn",
                  "aria-label": `Remove ${request.text}`,

                  onclick: (event) => {
                    event.currentTarget.disabled = true;

                    mutate(
                      () =>
                        post(
                          `/api/lists/requests/${request.id}/delete`,
                        ),

                      "Couldn't remove that request.",
                    );
                  },
                },
                "✕",
              ),
            );
          }),
        )
      : empty(
          "Nothing requested. Anyone can add a movie or show they'd like.",
        ),
  );
}

function movieNight(state) {
  const kids = h("input", {
    type: "checkbox",
    id: "mn-kids",
  });

  const short = h("input", {
    type: "checkbox",
    id: "mn-short",
  });

  const out = h("div", {
    class: "mn-out",
    "aria-live": "polite",
    "aria-busy": "false",
  });

  const pickButton = h(
    "button",
    {
      type: "button",
      class: "btn btn--primary",
    },
    "Pick a movie",
  );

  const seen = [];
  let picking = false;

  const spin = async ({
    reset = false,
  } = {}) => {
    if (picking) {
      return;
    }

    if (reset) {
      seen.length = 0;
    }

    picking = true;
    pickButton.disabled = true;
    out.setAttribute(
      "aria-busy",
      "true",
    );

    const query = new URLSearchParams({
      kids: String(kids.checked),
      short: String(short.checked),
      skip: seen.join(","),
    });

    try {
      const { pick } = await api(
        `/api/movies/pick?${query}`,
      );

      if (!pick) {
        out.replaceChildren(
          h(
            "p",
            {
              class: "empty",
            },
            seen.length
              ? "That's every match. Change a filter to see more."
              : "Nothing unwatched matches those filters.",
          ),
        );

        return;
      }

      if (pick.key) {
        seen.push(pick.key);
      }

      const metadata = [
        pick.year,
        formatRuntime(pick.minutes),
        pick.content_rating,

        Number.isFinite(
          Number(pick.rating),
        )
          ? `rated ${Number(
              pick.rating,
            ).toFixed(1)}`
          : null,

        ...asArray(pick.genres),
      ]
        .filter(Boolean)
        .join(" · ");

      out.replaceChildren(
        h(
          "article",
          {
            class: "mn-pick",
          },

          pick.thumb
            ? h("img", {
                src: `/api/plex/thumb?path=${encodeURIComponent(
                  pick.thumb,
                )}`,
                alt: "",
                class: "mn-poster",
                loading: "lazy",
                decoding: "async",
              })
            : null,

          h(
            "div",
            {
              class: "mn-body",
            },

            h(
              "h3",
              {
                class: "mn-title",
              },
              pick.title ||
                "Untitled",
            ),

            metadata
              ? h(
                  "p",
                  {
                    class: "meta",
                  },
                  metadata,
                )
              : null,

            pick.summary
              ? h(
                  "p",
                  {
                    class: "mn-summary",
                  },
                  pick.summary,
                )
              : null,

            h(
              "div",
              {
                class: "mn-actions",
              },

              h(
                "a",
                {
                  class:
                    "btn btn--primary",

                  href: plexUrl(
                    state.machine,
                    pick.key,
                  ),

                  target: "_blank",
                  rel: "noopener noreferrer",
                },
                "Watch in Plex",
              ),

              h(
                "button",
                {
                  type: "button",
                  class: "btn",
                  onclick: () =>
                    spin(),
                },
                "Another one",
              ),
            ),
          ),
        ),
      );
    } catch {
      out.replaceChildren(
        h(
          "p",
          {
            class: "note",
          },
          "Plex isn't answering, so there’s nothing to pick from right now.",
        ),
      );
    } finally {
      picking = false;
      pickButton.disabled = false;

      out.setAttribute(
        "aria-busy",
        "false",
      );
    }
  };

  pickButton.addEventListener(
    "click",
    () =>
      spin({
        reset: true,
      }),
  );

  kids.addEventListener(
    "change",
    () => {
      seen.length = 0;
    },
  );

  short.addEventListener(
    "change",
    () => {
      seen.length = 0;
    },
  );

  return card(
    "Movie night",
    {
      cls: "wide",
    },

    h(
      "p",
      {
        class: "meta",
      },
      "Can't decide? The hub picks something nobody has watched yet.",
    ),

    h(
      "div",
      {
        class: "mn-controls",
      },

      pickButton,

      h(
        "label",
        {
          class: "check",
          for: "mn-kids",
        },
        kids,
        "Family-friendly",
      ),

      h(
        "label",
        {
          class: "check",
          for: "mn-short",
        },
        short,
        "Under 1 h 45",
      ),
    ),

    out,
  );
}

function watchingNow(watching) {
  if (!watching) {
    return null;
  }

  const nights =
    asArray(watching.nights);

  const people =
    asArray(watching.people);

  const repeated =
    asArray(watching.again);

  const top = Math.max(
    1,
    ...nights.map(
      (night) =>
        Number(night.count) || 0,
    ),
  );

  const most = Math.max(
    1,
    ...people.map(
      (person) =>
        Number(person.count) || 0,
    ),
  );

  return h(
    "div",
    {
      class: "watching",
    },

    h(
      "p",
      {
        class: "watch-sum",
      },

      h(
        "strong",
        {},
        `${watching.watched ?? 0} watched`,
      ),

      ` in the last ${
        watching.days ?? 0
      } days, about ${
        watching.hours ?? 0
      } hours.`,

      watching.busiest
        ? ` ${watching.busiest} are movie night.`
        : "",
    ),

    nights.length
      ? h(
          "div",
          {
            class: "nights",
            role: "img",

            "aria-label":
              `Watching by day of the week: ${nights
                .map(
                  (night) =>
                    `${night.day} ${night.count}`,
                )
                .join(", ")}`,
          },

          nights.map(
            (night) =>
              h(
                "span",
                {
                  class: "night",
                },

                h("i", {
                  style:
                    `height:${Math.round(
                      ((Number(
                        night.count,
                      ) || 0) /
                        top) *
                        100,
                    )}%`,

                  "aria-hidden":
                    "true",
                }),

                h(
                  "b",
                  {},
                  String(
                    night.day || "",
                  ).slice(0, 2),
                ),
              ),
          ),
        )
      : null,

    people.length > 1
      ? h(
          "ul",
          {
            class: "people-bars",
          },

          people.map(
            (person) =>
              h(
                "li",
                {},

                h(
                  "span",
                  {},
                  person.name ||
                    "Unknown",
                ),

                h(
                  "span",
                  {
                    class: "progress",
                    style: "flex:1",
                    "aria-hidden":
                      "true",
                  },

                  h("span", {
                    style:
                      `width:${Math.round(
                        ((Number(
                          person.count,
                        ) || 0) /
                          most) *
                          100,
                      )}%`,
                  }),
                ),

                h(
                  "span",
                  {
                    class: "meta",
                  },
                  String(
                    person.count ??
                      0,
                  ),
                ),
              ),
          ),
        )
      : null,

    repeated.length
      ? h(
          "p",
          {
            class: "meta",
          },
          `Watched more than once: ${repeated
            .map(
              (item) =>
                `${item.title} (${item.count})`,
            )
            .join(", ")}.`,
        )
      : null,
  );
}

function statsCard(data) {
  const stats = data?.stats;

  if (!stats) {
    return null;
  }

  const history =
    asArray(data.history);

  const oldUnwatched =
    asArray(
      stats.never_watched_old,
    );

  return card(
    "Watching",
    {
      pill:
        `${stats.watched ?? 0} of ${
          stats.movies ?? 0
        } watched`,
      tone: "ok",
    },

    watchingNow(
      data.watching,
    ),

    h(
      "dl",
      {
        class: "facts",
      },

      h(
        "div",
        {},
        h(
          "dt",
          {},
          "Library size",
        ),
        h(
          "dd",
          {},
          `${stats.total_gb ?? 0} GB`,
        ),
      ),

      h(
        "div",
        {},
        h(
          "dt",
          {},
          "Never watched",
        ),
        h(
          "dd",
          {},
          `${stats.unwatched ?? 0} movies, ${
            stats.unwatched_gb ??
            0
          } GB`,
        ),
      ),
    ),

    history.length
      ? [
          h(
            "div",
            {
              class:
                "eyebrow-section",
            },
            h(
              "h3",
              {},
              "Recently watched",
            ),
          ),

          h(
            "ul",
            {
              class: "log",
            },

            history
              .slice(0, 6)
              .map(
                (item) =>
                  h(
                    "li",
                    {
                      class:
                        "log-row",
                    },

                    h("span", {
                      class: "dot",
                      dataset: {
                        tone: "ok",
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
                        item.title ||
                          "Untitled",
                      ),

                      item.who
                        ? h(
                            "span",
                            {
                              class:
                                "meta",
                            },
                            item.who,
                          )
                        : null,
                    ),

                    h(
                      "span",
                      {
                        class:
                          "log-side",
                      },

                      item.when
                        ? when(
                            item.when,
                          )
                        : "",
                    ),
                  ),
              ),
          ),
        ]
      : null,

    oldUnwatched.length
      ? [
          h(
            "div",
            {
              class:
                "eyebrow-section",
            },

            h(
              "h3",
              {},
              "Never watched, added over 6 months ago",
            ),
          ),

          h(
            "p",
            {
              class: "meta",
            },
            "Largest files first, if you want to free up space.",
          ),

          h(
            "ul",
            {
              class: "pkg",
            },

            oldUnwatched
              .slice(0, 8)
              .map(
                (item) =>
                  h(
                    "li",
                    {},

                    h(
                      "span",
                      {},
                      `${item.title || "Untitled"}${
                        item.year
                          ? ` (${item.year})`
                          : ""
                      }`,
                    ),

                    h(
                      "span",
                      {
                        class:
                          "meta",
                      },
                      `${item.gb ?? 0} GB`,
                    ),
                  ),
              ),
          ),
        ]
      : null,
  );
}

function hero(item, machine) {
  if (!item) {
    return null;
  }

  const art =
    item.art || item.thumb;

  const progress =
    clampPercent(
      item.progress,
    );

  const left =
    remainingMinutes(item);

  const title =
    item.title || "Untitled";

  return h(
    "section",
    {
      class: "movie-hero",
      "aria-label":
        "Pick up where you left off",
    },

    art
      ? h("img", {
          class:
            "movie-hero-bg",

          src:
            `/api/plex/thumb?wide=${
              item.art ? 1 : 0
            }&path=${encodeURIComponent(
              art,
            )}`,

          alt: "",
          decoding: "async",
        })
      : null,

    h(
      "div",
      {
        class:
          "movie-hero-body",
      },

      h(
        "p",
        {
          class:
            "movie-hero-kicker",
        },
        "Pick up where you left off",
      ),

      h(
        "h2",
        {
          class:
            "movie-hero-title",
        },
        title,
      ),

      h(
        "p",
        {
          class:
            "movie-hero-meta",
        },

        [
          item.year,
          left !== null
            ? `${left} min left`
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
      ),

      progress > 0
        ? h(
            "div",
            {
              class:
                "movie-hero-bar",

              role: "progressbar",

              "aria-label":
                `${title} progress`,

              "aria-valuemin":
                "0",

              "aria-valuemax":
                "100",

              "aria-valuenow":
                String(progress),
            },

            h("i", {
              style:
                `width:${progress}%`,
            }),
          )
        : null,

      h(
        "a",
        {
          class:
            "btn btn--primary movie-hero-go",

          href: plexUrl(
            machine,
            item.key,
          ),

          target: "_blank",

          rel:
            "noopener noreferrer",
        },
        "Resume in Plex",
      ),
    ),
  );
}

function playingNowCard(
  playing,
) {
  const sessions =
    asArray(playing);

  if (!sessions.length) {
    return null;
  }

  return card(
    "Playing now",
    {},

    h(
      "ul",
      {
        class: "log",
      },

      sessions.map(
        (session) => {
          const progress =
            clampPercent(
              session.progress,
            );

          const details = [
            [
              session.who,
              session.device,
            ]
              .filter(Boolean)
              .join(" on "),

            session.minutes_left !=
            null
              ? `${session.minutes_left} min left`
              : "",
          ]
            .filter(Boolean)
            .join(" · ");

          return h(
            "li",
            {
              class: "log-row",
            },

            h(
              "span",
              {
                class:
                  "log-main",
              },

              h(
                "strong",
                {},
                session.title ||
                  "Untitled",
              ),

              details
                ? h(
                    "span",
                    {
                      class:
                        "meta",
                    },
                    details,
                  )
                : null,
            ),

            h(
              "div",
              {
                class:
                  "progress",

                style:
                  "width:120px",

                role:
                  "progressbar",

                "aria-label":
                  `${
                    session.title ||
                    "Playback"
                  } progress`,

                "aria-valuemin":
                  "0",

                "aria-valuemax":
                  "100",

                "aria-valuenow":
                  String(
                    progress,
                  ),
              },

              h("span", {
                style:
                  `width:${progress}%`,
              }),
            ),
          );
        },
      ),
    ),
  );
}

function driveCard(
  drive,
  driveEvents,
) {
  const drv =
    drive || {};

  const events =
    asArray(driveEvents);

  const drops =
    events.filter(
      (event) =>
        event.kind === "dropped",
    ).length;

  const connected =
    drv.state === "Connected";

  const hasErrors =
    Number(drv.errors) > 0;

  return card(
    "Movies drive",
    {
      pill:
        drv.state || "Unknown",

      tone: connected
        ? hasErrors || drops
          ? "warn"
          : "ok"
        : "bad",
    },

    h(
      "dl",
      {
        class: "facts",
      },

      h(
        "div",
        {},
        h("dt", {}, "Movies"),
        h(
          "dd",
          {},
          drv.count ?? "—",
        ),
      ),

      h(
        "div",
        {},
        h(
          "dt",
          {},
          "Free space",
        ),
        h(
          "dd",
          {},
          drv.free || "—",
        ),
      ),

      h(
        "div",
        {},
        h(
          "dt",
          {},
          "Dropouts this week",
        ),

        h(
          "dd",
          {
            dataset: {
              tone: drops
                ? "bad"
                : "ok",
            },
          },
          String(drops),
        ),
      ),

      h(
        "div",
        {},
        h(
          "dt",
          {},
          "Errors since the Pi started",
        ),

        h(
          "dd",
          {
            dataset: {
              tone: hasErrors
                ? "bad"
                : "ok",
            },
          },

          String(
            drv.errors ?? "—",
          ),
        ),
      ),
    ),

    drops || hasErrors
      ? h(
          "p",
          {
            class: "note",
          },
          "The movies drive has reported reliability problems. Back up anything important and review drive health before relying on it.",
        )
      : null,

    events.length
      ? h(
          "ul",
          {
            class: "timeline",
          },

          events
            .slice(0, 8)
            .map((event) => {
              const dropped =
                event.kind ===
                "dropped";

              return h(
                "li",
                {
                  dataset: {
                    tone: dropped
                      ? "bad"
                      : "ok",
                  },
                },

                h(
                  "span",
                  {},
                  dropped
                    ? "Dropped out"
                    : "Came back",
                ),

                h(
                  "time",
                  {},
                  event.ts
                    ? when(
                        event.ts,
                      )
                    : "",
                ),
              );
            }),
        )
      : null,
  );
}

export async function load(
  state,
) {
  state.force = false;

  try {
    const data =
      await api(
        "/api/movies",
      );

    state.machine =
      data?.machine || null;

    const drive =
      data?.drive || {};

    const driveEvents =
      asArray(
        data?.drive_events,
      );

    const continueWatching =
      asArray(
        data?.continue,
      );

    const recentEmptyMessage =
      drive.state ===
      "Connected"
        ? "Nothing new lately."
        : "The movies drive is missing, so Plex can't list new movies.";

    state.body.replaceChildren(
      ...[
        playingNowCard(
          data?.playing,
        ),

        hero(
          continueWatching[0],
          state.machine,
        ),

        shelfSection(
          "Also half-watched",
          continueWatching.slice(
            1,
          ),
          state.machine,
        ),

        shelfSection(
          "Recently added",
          data?.recent,
          state.machine,
          recentEmptyMessage,
        ),

        driveCard(
          drive,
          driveEvents,
        ),

        state.night ||
          (state.night =
            movieNight(state)),

        requestsCard(
          state,
          data?.requests,
        ),

        statsCard(data),

        h(
          "div",
          {
            class: "row",
          },

          h(
            "a",
            {
              class: "btn",
              href: "/drives",
              "data-link":
                true,
            },
            "Drive health and moving to a new drive",
          ),

          h(
            "a",
            {
              class: "btn",

              href: piLink(
                32400,
                "/web",
              ),

              target:
                "_blank",

              rel:
                "noopener noreferrer",
            },
            "Open Plex",
          ),
        ),
      ].filter(Boolean),
    );
  } catch (error) {
    state.body.replaceChildren(
      card(
        "Movies unavailable",
        {
          tone: "bad",
        },

        h(
          "p",
          {
            class: "note",
          },
          "The movies dashboard couldn't load. Plex or the hub API may be unavailable.",
        ),

        h(
          "button",
          {
            type: "button",
            class:
              "btn btn--primary",

            onclick: () =>
              load(state),
          },
          "Try again",
        ),
      ),
    );

    toast(
      error?.message ||
        "Couldn't load movies.",
      "bad",
    );
  }
}