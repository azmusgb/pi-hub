// Keeps the page shell available when the Pi is briefly unreachable. Live data is never cached.
const SHELL = "pi-hub-shell-v118";
const FILES = ["/static/solution.css", "/static/household-features.css", "/static/js/movie-night.js", "/static/js/freshness.js", "/static/js/recovery.js", "/static/js/experience.js", "/static/js/navigation.js", "/", "/static/ui/tokens.css", "/static/ui/components.css", "/static/ui/needs.css", "/static/ui/needs.js", "/static/ui/figtree-latin-wght-normal.woff2", "/static/app.css", "/static/pages.css", "/static/js/main.js", "/static/enhance.css", "/static/home.css", "/static/settings-rich.css", "/static/lists-rich.css", "/static/workshop-pi-rich.css", "/static/movies-print-rules-alerts-rich.css", "/static/movies.css", "/static/ambient.css", "/static/js/ambient.js", "/static/js/enhance.js", "/static/js/enhance-audit.js", "/static/js/core.js", "/static/js/now.js", "/static/js/wall.js",
"/static/components.css",
  "/static/js/movies.js", "/static/js/movie-upload.js", "/static/js/workshop.js", "/static/js/lab.js", "/static/js/lab-net.js", "/static/js/lab-store.js", "/static/js/lab-photos.js", "/static/js/lab-observe.js", "/static/js/lab-refresh.js", "/static/js/lab-evidence.js", "/static/js/lab-v2.js", "/static/lab.css", "/static/js/printer-actions.js", "/static/js/print.js", "/static/js/lists.js", "/static/js/pi.js",
  "/static/js/alerts.js", "/static/js/control.js", "/static/js/settings.js", "/static/js/more.js", "/static/js/rules.js", "/static/js/drives.js", "/static/js/weather.js",
  "/static/js/documents.js", "/static/js/home-cards.js", "/static/js/network.js", "/static/js/next.js", "/static/js/saved-theme.js", "/static/js/section-links.js", "/static/js/sections.js", "/static/js/system.js", "/static/js/wording.js",
  "/static/icon.svg", "/static/manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  // Network first, so updates show at once; fall back to the saved shell.
  e.respondWith(fetch(e.request)
    .then((r) => {
      const copy = r.clone();
      caches.open(SHELL).then((c) => c.put(e.request, copy));
      return r;
    })
    .catch(() => caches.match(e.request)));
});
