// Movies: what's playing, continue watching, recently added, search, requests, and drive health.
import { api, card, empty, h, piLink, post, toast, when } from "./core.js";
import { addMovieButton } from "./movie-upload.js";
import { mountMovieNight, refreshMovieNight } from "./movie-night.js";
import { rememberOpen } from "./section-links.js";

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
  const rawRating = Number(item?.rating);
  const rating = Number.isFinite(rawRating) && rawRating > 0 ? rawRating : null;
  const cert = item?.content_rating || null;

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

  const badges = [];
  if (rating) {
    badges.push(
      h(
        "span",
        {
          class: "poster-badge poster-rating",
          "aria-label": `Rated ${rating.toFixed(1)}`,
        },
        `★ ${rating.toFixed(1)}`,
      ),
    );
  }
  if (cert) {
    badges.push(
      h(
        "span",
        {
          class: "poster-badge poster-cert",
          "aria-label": `Advisory: ${cert}`,
        },
        cert,
      ),
    );
  }

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

      badges.length
        ? h(
            "div",
            {
              class: "poster-badges",
              "aria-hidden": "true",
            },
            ...badges,
          )
        : null,

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

// Each shelf shows its first six; the page was ~13,000 px tall on a phone (25 Oct critique).
const SHELF_FIRST = 6;

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

    shelf(list.slice(0, SHELF_FIRST), machine),
    list.length > SHELF_FIRST ? rememberOpen(h("details", { class: "show-all" },
      h("summary", {}, `Show all ${list.length}`), shelf(list.slice(SHELF_FIRST), machine)), `shelf:${title}`) : null,
  );
}

function librarySwitcher(sections, active, onChange) {
  const list = asArray(sections);
  if (list.length <= 1) {
    return null;
  }

  const options = [
    { key: "all", title: "All Libraries" },
    ...list.map((s) => ({
      key: String(s.key),
      title: s.title === "Movies" ? "Movies (Pi Drive)" : (s.title || `Library ${s.key}`),
    })),
  ];

  return h(
    "nav",
    {
      class: "movie-libraries",
      "aria-label": "Select movie library",
    },
    h(
      "span",
      { class: "movie-libraries-label" },
      "Library:",
    ),
    h(
      "div",
      {
        class: "movie-libraries-chips",
        role: "radiogroup",
        "aria-label": "Select movie library",
      },
      options.map((opt) => {
        const isSelected = String(active) === String(opt.key);
        return h(
          "button",
          {
            type: "button",
            class: `chip ${isSelected ? "is-active" : ""}`,
            role: "radio",
            "aria-checked": isSelected ? "true" : "false",
            "aria-pressed": isSelected ? "true" : "false",
            onclick: () => {
              if (isSelected) return;
              onChange(opt.key);
            },
          },
          opt.title,
        );
      }),
    ),
  );
}

export function mount(state) {
  try {
    state.section = localStorage.getItem("hub-movie-section") || "all";
  } catch (_) {
    state.section = "all";
  }

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

  state.night = mountMovieNight(state);

  state.body = h("div", {
    class: "stack",
  });

  // Search and Add a movie share one row, aligned with the content under them (iPad, 1 Nov: a floating button above
  // an indented search box left a dead band at the top of the page).
  state.root.append(
    h("div", { class: "movie-toolbar" },
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
    addMovieButton(() => load(state).catch(() => {}))),

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

function movieNight(state, genres) {
  const kids = h("input", {
    type: "checkbox",
    id: "mn-kids",
  });

  const short = h("input", {
    type: "checkbox",
    id: "mn-short",
  });

  const genreSelect = h(
    "select",
    {
      id: "mn-genre",
      class: "mn-genre-select",
      "aria-label": "Filter by genre",
    },
    h("option", { value: "" }, "Any genre"),
    ...asArray(genres).map((g) => h("option", { value: g }, g)),
  );

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

    if (genreSelect.value) {
      query.set("genre", genreSelect.value);
    }

    if (state.section && state.section !== "all") {
      query.set("section", state.section);
    }

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

      const rawRating = Number(pick.rating);
      const rating = Number.isFinite(rawRating) && rawRating > 0 ? rawRating : null;
      const cert = pick.content_rating || null;

      const metadata = [
        pick.year,
        formatRuntime(pick.minutes),
        cert,
        rating ? `★ ${rating.toFixed(1)}` : null,
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

  genreSelect.addEventListener(
    "change",
    () => {
      seen.length = 0;
    },
  );

  return card(
    "Surprise pick",
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
      genreSelect,

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

function statsCard(data, activeTitle) {
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

  const cardTitle =
    activeTitle
      ? `Watching · ${activeTitle}`
      : "Watching";

  return card(
    cardTitle,
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
              class: "log-row np-row",  // no status dot: two columns (title, progress)
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

// The Pi's own drive holds the films Plex plays; each night they're copied from the Windows PC's share.
function mirrorSay(m) {
  if (!m || m.state === "never") return { tone: "warn", say: "Not copied from the PC yet" };
  const age = m.last_ok ? Date.now() / 1000 - m.last_ok : Infinity;
  if (m.state === "running") return { tone: "ok", say: "Copying from the PC now" };
  if (age > 2 * 86400) return { tone: "warn", say: m.last_ok ? `Last copied ${when(m.last_ok)}` : "Never copied successfully" };
  return { tone: m.state === "ok" ? "ok" : "warn", say: `Copied ${when(m.last_ok)}` };
}

export function driveCard(drive, driveEvents) {
  const drv = drive || {};
  const events = asArray(driveEvents);
  const drops = events.filter((event) => event.kind === "dropped").length;
  const connected = drv.state === "Connected";
  const hasErrors = Number(drv.errors) > 0;
  const m = drv.mirror || null;
  const copy = mirrorSay(m);
  const freeDetail = [drv.free, drv.total ? `of ${drv.total}` : null].filter(Boolean).join(" ");
  const fact = (k, v, tone) => h("div", {}, h("dt", {}, k), h("dd", tone ? { dataset: { tone } } : {}, v));

  return card(
    "Movies drive status",
    {
      pill: connected ? "Connected" : drv.state || "Unknown",
      tone: connected ? (hasErrors || drops || copy.tone !== "ok" ? "warn" : "ok") : "bad",
    },
    h("dl", { class: "facts" },
      fact("Plays from", drv.source || "Pi drive"),
      fact("Movies on the Pi", drv.count ?? "—"),
      fact("Available space", freeDetail || "—"),
      fact("Copy from the PC", copy.say, copy.tone),
      m && m.source_count != null ? fact("Movies on the PC", m.share ? m.source_count : `${m.source_count} (share not connected)`) : null,
    ),
    !connected
      ? h("p", { class: "note" }, "The Pi's movies drive is disconnected. Check its cable and power; the Drives page shows its health.")
      : hasErrors || drops
        ? h("p", { class: "note" }, "The Pi's movies drive has reported reliability problems. The PC still has every film, so nothing is lost, but check the drive.")
        : m && m.state !== "ok" && m.state !== "running" && m.message
          ? h("p", { class: "note" }, m.message)
          : null,
    events.length
      ? h("ul", { class: "timeline" },
        events.slice(0, 3).map((event) => {
          const dropped = event.kind === "dropped";
          return h("li", { dataset: { tone: dropped ? "bad" : "ok" } },
            h("span", {}, dropped ? "Dropped out" : "Came back"),
            h("time", {}, event.ts ? when(event.ts) : ""));
        }))
      : null,
  );
}

function filterAndSortCatalog(movies, q, genre, unwatchedOnly, sortBy) {
  let list = asArray(movies);
  if (q) {
    const query = q.trim().toLowerCase();
    list = list.filter((m) =>
      (m.title || "").toLowerCase().includes(query) ||
      String(m.year || "").includes(query),
    );
  }
  if (genre && genre !== "all") {
    const gLower = genre.toLowerCase();
    list = list.filter((m) =>
      asArray(m.genres).some((g) => (g || "").toLowerCase() === gLower),
    );
  }
  if (unwatchedOnly) {
    list = list.filter((m) => !m.watched && !m.progress);
  }

  return [...list].sort((a, b) => {
    switch (sortBy) {
      case "title_asc":
        return (a.title || "").localeCompare(b.title || "");
      case "title_desc":
        return (b.title || "").localeCompare(a.title || "");
      case "rating_desc":
        return (Number(b.rating) || 0) - (Number(a.rating) || 0);
      case "year_desc":
        return (Number(b.year) || 0) - (Number(a.year) || 0);
      case "year_asc":
        return (Number(a.year) || 0) - (Number(b.year) || 0);
      case "duration_asc":
        return (Number(a.minutes) || 9999) - (Number(b.minutes) || 9999);
      case "added_desc":
      default:
        return (Number(b.added) || 0) - (Number(a.added) || 0);
    }
  });
}

function catalogSection(state, allMovies, genres) {
  const list = asArray(allMovies);
  if (!list.length) {
    return null;
  }

  if (!state.catalog) {
    state.catalog = {
      q: "",
      genre: "all",
      unwatchedOnly: false,
      sortBy: "title_asc",
      expanded: false,
    };
  }

  const cState = state.catalog;
  const section = h("section", {
    class: "movie-section movie-catalog",
    "aria-labelledby": "movie-catalog-heading",
  });

  const countBadge = h("span", { class: "catalog-count" });
  const gridContainer = h("div", { class: "catalog-grid-wrap" });

  const renderGrid = () => {
    const filtered = filterAndSortCatalog(
      list,
      cState.q,
      cState.genre,
      cState.unwatchedOnly,
      cState.sortBy,
    );

    const totalFiltered = filtered.length;
    countBadge.textContent =
      totalFiltered === list.length
        ? `${list.length} movies`
        : `${totalFiltered} of ${list.length} movies`;

    const displayLimit = cState.expanded ? totalFiltered : 12;
    const visible = filtered.slice(0, displayLimit);

    gridContainer.replaceChildren();

    if (!visible.length) {
      gridContainer.append(
        empty(
          cState.q
            ? `No movies match “${cState.q}”.`
            : "No movies match the selected filters.",
        ),
      );
      return;
    }

    const shelfEl = h(
      "ul",
      { class: "poster-shelf" },
      visible.map((m) => poster(m, state.machine)),
    );
    gridContainer.append(shelfEl);

    if (totalFiltered > 12) {
      const moreBtn = h(
        "button",
        {
          type: "button",
          class: `btn ${cState.expanded ? "ghost" : "btn--primary"} catalog-more-btn`,
          onclick: () => {
            cState.expanded = !cState.expanded;
            renderGrid();
          },
        },
        cState.expanded
          ? "Show fewer movies"
          : `Show all ${totalFiltered} movies (+${totalFiltered - 12})`,
      );
      gridContainer.append(h("div", { class: "catalog-actions" }, moreBtn));
    }
  };

  const genreCounts = {};
  for (const m of list) {
    for (const g of asArray(m.genres)) {
      genreCounts[g] = (genreCounts[g] || 0) + 1;
    }
  }

  const genreSelect = h(
    "select",
    {
      class: "catalog-select",
      "aria-label": "Filter catalog by genre",
      onchange: (e) => {
        cState.genre = e.target.value;
        renderGrid();
      },
    },
    h(
      "option",
      { value: "all", selected: cState.genre === "all" },
      `All Genres (${list.length})`,
    ),
    ...asArray(genres).map((g) =>
      h(
        "option",
        { value: g, selected: cState.genre === g },
        `${g} (${genreCounts[g] || 0})`,
      ),
    ),
  );

  const sortSelect = h(
    "select",
    {
      class: "catalog-select",
      "aria-label": "Sort catalog",
      onchange: (e) => {
        cState.sortBy = e.target.value;
        renderGrid();
      },
    },
    h("option", { value: "title_asc", selected: cState.sortBy === "title_asc" }, "Title (A → Z)"),
    h("option", { value: "title_desc", selected: cState.sortBy === "title_desc" }, "Title (Z → A)"),
    h("option", { value: "rating_desc", selected: cState.sortBy === "rating_desc" }, "Highest Rated (★)"),
    h("option", { value: "year_desc", selected: cState.sortBy === "year_desc" }, "Release Year (Newest)"),
    h("option", { value: "year_asc", selected: cState.sortBy === "year_asc" }, "Release Year (Oldest)"),
    h("option", { value: "added_desc", selected: cState.sortBy === "added_desc" }, "Recently Added"),
    h("option", { value: "duration_asc", selected: cState.sortBy === "duration_asc" }, "Shortest First"),
  );

  const filterInput = h("input", {
    type: "search",
    class: "catalog-filter-input",
    placeholder: "Quick filter collection...",
    value: cState.q,
    autocomplete: "off",
  });
  filterInput.addEventListener("input", () => {
    cState.q = filterInput.value;
    renderGrid();
  });

  const unwatchedBtn = h(
    "button",
    {
      type: "button",
      class: `chip ${cState.unwatchedOnly ? "is-active" : ""}`,
      onclick: () => {
        cState.unwatchedOnly = !cState.unwatchedOnly;
        unwatchedBtn.classList.toggle("is-active", cState.unwatchedOnly);
        renderGrid();
      },
    },
    "Unwatched only",
  );

  const toolbar = h(
    "div",
    { class: "catalog-toolbar" },
    h("div", { class: "catalog-search-wrap" }, filterInput),
    genreSelect,
    sortSelect,
    unwatchedBtn,
    countBadge,
  );

  section.append(
    h(
      "div",
      { class: "eyebrow-section" },
      h("h2", { id: "movie-catalog-heading" }, "Browse Library"),
    ),
    toolbar,
    gridContainer,
  );

  renderGrid();
  return section;
}

export async function load(
  state,
) {
  state.force = false;

  if (!state.section) {
    try {
      state.section = localStorage.getItem("hub-movie-section") || "all";
    } catch (_) {
      state.section = "all";
    }
  }

  try {
    const params = new URLSearchParams();
    if (state.section && state.section !== "all") {
      params.set("section", state.section);
    }
    const qs = params.toString();
    const [data, catalogData] = await Promise.all([
      api(`/api/movies${qs ? `?${qs}` : ""}`),
      api(`/api/movies/catalog${qs ? `?${qs}` : ""}`).catch(() => ({ movies: [], genres: [] })),
    ]);

    if (data?.active_section) {
      state.section = data.active_section;
    }

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

    const catalogMovies = asArray(catalogData?.movies);
    const genres = asArray(catalogData?.genres || data?.genres);

    const activeSec = asArray(data?.sections).find(
      (s) => String(s.key) === String(state.section),
    );
    const activeTitle = activeSec
      ? activeSec.title === "Movies"
        ? "Movies (Pi Drive)"
        : activeSec.title
      : null;

    const recentEmptyMessage =
      drive.state ===
      "Connected"
        ? "Nothing new lately."
        : "The movies drive is missing, so Plex can't list new movies.";

    state.body.replaceChildren(
      ...[
        librarySwitcher(
          data?.sections,
          state.section || "all",
          async (newSection) => {
            state.section = newSection;
            try {
              localStorage.setItem("hub-movie-section", newSection);
            } catch (_) {}
            state.night = null;
            await load(state);
          },
        ),

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
          activeTitle
            ? `Recently added · ${activeTitle}`
            : "Recently added",
          data?.recent,
          state.machine,
          recentEmptyMessage,
        ),

        catalogSection(state, catalogMovies, genres),

        state.night,

        movieNight(state, genres),

        driveCard(
          drive,
          driveEvents,
        ),

        requestsCard(
          state,
          data?.requests,
        ),

        rememberOpen(h("details", { class: "show-all" }, h("summary", {}, "What's been watched"), statsCard(data, activeTitle)), "movies-stats"),

        h(
          "div",
          {
            class: "row",
          },

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
    refreshMovieNight(state);
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