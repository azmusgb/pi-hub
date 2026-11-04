// ============================================================
// Pi Hub — enhance.js
// Optional enhancement layer. Safe to remove.
// Does not touch main.js routing. Only adds overlays,
// keyboard shortcuts, ambient state, and reveal animations.
// ============================================================
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const isEditing = (el) =>
    el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

  // ---- Time-of-day ambient ---------------------------------------------
  const hour = new Date().getHours();
  const tod = hour < 6 ? "night" : hour < 11 ? "morning" : hour < 17 ? "day" : hour < 21 ? "evening" : "night";
  document.documentElement.dataset.timeofday = tod;

  // ---- Offline banner --------------------------------------------------
  const offline = $("#offline-banner");
  const updateOnline = () => { if (offline) offline.hidden = navigator.onLine; };
  addEventListener("online", updateOnline);
  addEventListener("offline", updateOnline);
  updateOnline();

  // ---- Top progress bar ------------------------------------------------
  const progress = $(".progress-top");
  let progressTimer;
  const showProgress = () => {
    if (!progress) return;
    progress.classList.add("is-active");
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => progress.classList.remove("is-active"), 6000);
  };
  const hideProgress = () => {
    if (!progress) return;
    progress.classList.remove("is-active");
    clearTimeout(progressTimer);
  };
  document.addEventListener("click", (e) => {
    const a = e.target.closest("a[data-link]");
    if (!a) return;
    if (a.id === "wall-link") return;
    showProgress();
  }, true);
  addEventListener("popstate", showProgress);

  // ---- Clock date line -------------------------------------------------
  // (removed — main.js already includes the weekday in the clock)

  // ---- Staggered reveal for direct children of #view ------------------
  const revealCards = () => {
    const view = $("#view");
    if (!view) return;
    [...view.children].forEach((el, i) => {
      if (!el.hasAttribute("data-revealed")) {
        el.setAttribute("data-revealed", "1");
        el.style.setProperty("--i", i);
        el.classList.add("reveal");
      }
    });
    hideProgress();
  };
  const view = $("#view");
  if (view) {
    revealCards();
    new MutationObserver(revealCards).observe(view, { childList: true });
  }

  // The ⌘K palette (⌘K, Ctrl+K and "/") is the kit's, set up by command-palette.js.

  // ---- Shortcuts dialog -----------------------------------------------
  const shortcuts = $("#shortcuts");
  const toggleShortcuts = () => {
    if (!shortcuts) return;
    shortcuts.hidden = !shortcuts.hidden;
  };
  shortcuts?.addEventListener("click", (e) => {
    if (e.target === shortcuts || e.target.classList.contains("shortcuts-backdrop") || e.target.closest("[data-shortcuts-close]")) {
      shortcuts.hidden = true;
    }
  });

  // ---- Keyboard shortcuts --------------------------------------------
  document.addEventListener("keydown", (e) => {
    const editing = isEditing(e.target);
    const mod = e.metaKey || e.ctrlKey;

    if (e.key === "Escape") {
      if (shortcuts) shortcuts.hidden = true;
      if (document.body.classList.contains("wall") || document.documentElement.dataset.wall === "1") {
        location.href = "/";
      }
      return;
    }
    if (editing) return;

    if (e.key === "?") { e.preventDefault(); toggleShortcuts(); return; }
    if (!mod && !e.altKey && e.key === "t") { e.preventDefault(); $("#theme-btn")?.click(); return; }
    if (!mod && !e.altKey && e.key === "w") {
      e.preventDefault();
      if (document.body.classList.contains("wall") || document.documentElement.dataset.wall === "1") {
        location.href = "/";
      } else {
        location.href = "/wall";
      }
      return;
    }
  });
})();
