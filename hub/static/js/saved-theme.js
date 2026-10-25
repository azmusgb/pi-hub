// Pages outside the hub's shell (the signed-out Scan page) follow the theme picked in the hub: Light or Dark is this
// device's saved choice; Auto (or nothing saved) leaves the kit to follow the device. A classic script, run before paint.
(() => {
  try {
    const t = localStorage.getItem("hub-theme");
    if (t === "light" || t === "dark") {
      document.documentElement.dataset.theme = t;
      document.documentElement.style.colorScheme = t;
    }
  } catch {}
})();
