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

  // ---- Command palette -----------------------------------------------
  const palette = $("#palette");
  const input = $("#palette-input");
  const results = $("#palette-results");

  const items = $$(".rail a[data-page]").map((a) => ({
    label: (a.querySelector("span")?.textContent || a.dataset.page || "? ").trim(),
    page: a.dataset.page || "",
    href: a.getAttribute("href") || "#",
    el: a,
  }));

  let activeIdx = 0;
  let filtered = items;

  const renderResults = () => {
    if (!results) return;
    results.replaceChildren();
    if (!filtered.length) {
      const li = document.createElement("li");
      li.className = "palette-empty";
      li.textContent = "Nothing matches";
      results.appendChild(li);
      return;
    }
    filtered.forEach((it, i) => {
      const li = document.createElement("li");
      li.className = "palette-item" + (i === activeIdx ? " is-active" : "");
      li.setAttribute("role", "option");
      li.innerHTML =
        `<span class="palette-label">${it.label}</span>` +
        `<span class="palette-page">${it.page}</span>`;
      li.addEventListener("mouseenter", () => { activeIdx = i; renderResults(); });
      li.addEventListener("click", () => { it.el.click(); closePalette(); });
      results.appendChild(li);
    });
  };

  const openPalette = () => {
    if (!palette) return;
    palette.hidden = false;
    input?.setAttribute("aria-expanded", "true");
    if (input) input.value = "";
    filtered = items;
    activeIdx = 0;
    renderResults();
    requestAnimationFrame(() => input?.focus());
  };

  const closePalette = () => {
    if (!palette) return;
    palette.hidden = true;
    input?.setAttribute("aria-expanded", "false");
  };

  input?.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    filtered = q ? items.filter((it) => it.label.toLowerCase().includes(q) || it.page.includes(q)) : items;
    activeIdx = 0;
    renderResults();
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, Math.max(filtered.length - 1, 0)); renderResults(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); renderResults(); }
    else if (e.key === "Enter") { e.preventDefault(); filtered[activeIdx]?.el.click(); closePalette(); }
    else if (e.key === "Escape") closePalette();
  });
  palette?.addEventListener("click", (e) => {
    if (e.target.classList.contains("palette-backdrop")) closePalette();
  });

  document.querySelector("[data-palette-close]")?.addEventListener("click", closePalette);

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

    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (e.key === "Escape") {
      closePalette();
      if (shortcuts) shortcuts.hidden = true;
      if (document.body.classList.contains("wall") || document.documentElement.dataset.wall === "1") {
        location.href = "/";
      }
      return;
    }
    if (editing) return;

    if (e.key === "/") { e.preventDefault(); openPalette(); return; }
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
