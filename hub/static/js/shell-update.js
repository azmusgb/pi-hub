// A deploy bumps SHELL in sw.js and the new worker takes over at once (skipWaiting, clients.claim), but an open page
// keeps the modules it loaded, and a phone's home-screen app resumes that same page. So: ask for a new worker whenever
// the page comes back, and once one has taken over a page that already had one, load the new version at the next safe
// moment. main.js does a full load on the next in-app navigation (stale()); here, the next return to the page reloads
// unless a field holds something the person typed.
export function watchShell(container, registering, { doc = document, reload = () => location.reload() } = {}) {
  let controlled = !!container.controller, stale = false;
  // The first install (no controller at load) is not an update: this page's modules came from the network.
  container.addEventListener("controllerchange", () => { stale ||= controlled; controlled = true; });
  doc.addEventListener("visibilitychange", () => {
    if (doc.hidden) return;
    if (stale) { if (!typed(doc)) reload(); return; }
    // A failed check (offline, no registration) changes nothing.
    registering.then((r) => r?.update()).catch(() => {});
  });
  return { stale: () => stale };
}

// Not text: their value isn't typing.
const NOT_TEXT = new Set(["checkbox", "radio", "hidden", "button", "submit", "reset", "file", "range", "color", "image"]);

// A text field or box whose value differs from the one the page gave it holds the person's typing.
function typed(doc) {
  return [...doc.querySelectorAll("textarea, input")].some((f) => !NOT_TEXT.has(f.type) && f.value !== f.defaultValue);
}
