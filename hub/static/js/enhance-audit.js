// enhance-audit.js — additive; works alongside enhance.js.
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;

  // 1. Wall mode: pre-empt the shortcuts bound by enhance.js.
  document.addEventListener("keydown", (e) => {
    if (!root.dataset.wall) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k === "?" || k === "t" || k === "w" || k === "/") {
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);

  // 2. Time-of-day drift: re-evaluate every 15 min and on focus.
  function refreshTod() {
    const h = new Date().getHours();
    root.dataset.timeofday =
      h < 6 ? "night" : h < 11 ? "morning" : h < 17 ? "day" : h < 21 ? "evening" : "night";
  }
  setInterval(refreshTod, 15 * 60 * 1000);
  addEventListener("visibilitychange", () => { if (!document.hidden) refreshTod(); });

  // 3. Focus trap: inert the shell while any overlay is open.
  const shell = $(".shell");
  let paletteOpen = false;
  let shortcutsOpen = false;
  const applyInert = () => { if (shell) shell.inert = paletteOpen || shortcutsOpen; };
  const watch = (id, set) => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(() => set(!el.hidden))
      .observe(el, { attributes: true, attributeFilter: ["hidden"] });
  };
  watch("palette",   (v) => { paletteOpen = v; applyInert(); });
  watch("shortcuts", (v) => { shortcutsOpen = v; applyInert(); });

  // 4. aria-activedescendant on the palette input.
  const results = document.getElementById("palette-results");
  const input   = document.getElementById("palette-input");
  if (results && input) {
    const sync = () => {
      $$(".palette-item", results).forEach((li, i) => { li.id = "palette-opt-" + i; });
      const active = $(".palette-item.is-active", results);
      if (active) input.setAttribute("aria-activedescendant", active.id);
      else input.removeAttribute("aria-activedescendant");
    };
    new MutationObserver(sync).observe(results, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ["class"],
    });
    sync();
  }
})();
