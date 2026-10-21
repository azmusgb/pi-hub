// ambient.js — reads weather and house state, sets attributes that ambient.css picks up.
// Purely cosmetic; failure is invisible by design.
(() => {
  "use strict";
  const root = document.documentElement;

  async function refresh() {
    try {
      const [o, n] = await Promise.all([
        fetch("/api/outside", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
        fetch("/api/now", { cache: "no-store" }).then((r) => r.json()).catch(() => null),
      ]);

      const icon = o?.weather?.now?.icon;
      if (icon) root.dataset.weather = icon;
      else delete root.dataset.weather;

      const playing = n?.movies?.playing?.length > 0;
      if (playing) document.body.dataset.house = "cinema";
      else delete document.body.dataset.house;
    } catch {}
  }

  refresh();
  setInterval(refresh, 60000);
  addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
})();
