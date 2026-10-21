// Keeps the page shell available when the Pi is briefly unreachable. Live data is never cached.
const SHELL = "pi-hub-shell-v57";
const FILES = ["/", "/static/app.css", "/static/pages.css", "/static/js/main.js", "/static/enhance.css", "/static/refine.css", "/static/enhance-audit.css", "/static/now-rich.css", "/static/weather-rich.css", "/static/settings-rich.css", "/static/lists-rich.css", "/static/workshop-pi-rich.css", "/static/movies-print-rules-alerts-rich.css", "/static/ambient.css", "/static/js/ambient.js", "/static/js/enhance.js", "/static/js/enhance-audit.js", "/static/js/core.js", "/static/js/now.js",
  "/static/js/movies.js", "/static/js/workshop.js", "/static/js/print.js", "/static/js/lists.js", "/static/js/pi.js",
  "/static/js/alerts.js", "/static/js/control.js", "/static/js/settings.js", "/static/js/more.js", "/static/js/rules.js", "/static/js/drives.js", "/static/js/weather.js", "/static/icon.svg", "/static/manifest.webmanifest"];

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
