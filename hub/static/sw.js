// Keeps the page shell available when the Pi is briefly unreachable. Live data is never cached.
const SHELL = "pi-hub-shell-v206";
const FILES = ["/static/household-features.css", "/static/js/movie-night.js", "/static/js/freshness.js", "/static/js/sources.js", "/static/js/page-parts.js", "/static/js/recovery.js", "/static/js/experience.js", "/static/js/navigation.js", "/", "/static/ui/tokens.css", "/static/ui/components.css", "/static/ui/needs.css", "/static/ui/needs.js", "/static/ui/palette.css", "/static/ui/palette.js", "/static/ui/confirm.js", "/static/ui/tools.js", "/static/ui/archivo-latin-ui.woff2", "/static/app.css", "/static/pages.css", "/static/js/main.js", "/static/enhance.css", "/static/home.css", "/static/home-dashboard.css", "/static/settings-rich.css", "/static/lists-rich.css", "/static/workshop-pi-rich.css", "/static/movies-print-rules-alerts-rich.css", "/static/movies.css", "/static/ambient.css", "/static/js/ambient.js", "/static/js/enhance.js", "/static/js/enhance-audit.js", "/static/js/core.js", "/static/js/now.js", "/static/js/wall.js",
"/static/components.css",
  "/static/js/movies.js", "/static/js/movie-upload.js", "/static/js/workshop.js", "/static/js/lab.js", "/static/js/lab-net.js", "/static/js/lab-store.js", "/static/js/lab-photos.js", "/static/js/lab-observe.js", "/static/js/lab-refresh.js", "/static/js/lab-evidence.js", "/static/js/lab-v2.js", "/static/lab.css", "/static/quick.css", "/static/js/quick.js", "/static/js/quick-layers.js", "/static/js/quick-3d.js", "/static/js/quick-3d-data.js", "/static/js/printer-actions.js", "/static/js/print.js", "/static/js/lists.js", "/static/js/health.js", "/static/js/backups.js", "/static/js/system-strip.js",
  "/static/js/alerts.js", "/static/js/control.js", "/static/js/settings.js", "/static/js/scan.js", "/static/js/site.js", "/static/ui/pages.js", "/static/js/rules.js", "/static/js/drives.js", "/static/js/weather.js",
  "/static/js/documents.js", "/static/js/home-cards.js", "/static/js/network.js", "/static/js/devices.js", "/static/js/map.js", "/static/js/assistant.js", "/static/js/control-room.js", "/static/js/home-dashboard.js", "/static/js/command-palette.js", "/static/js/saved-theme.js", "/static/js/section-links.js", "/static/js/sections.js", "/static/js/versions.js", "/static/js/display-pair.js", "/static/js/wording.js",
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
