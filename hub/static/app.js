// Pi Hub, Now screen. Fetches /api/now every 15 seconds and fills the page.
(() => {
  const $ = (id) => document.getElementById(id);
  const wall = new URLSearchParams(location.search).has("wall");
  let lastOk = 0;

  if (wall) document.body.classList.add("wall");

  // Links to apps on this Pi follow whatever address the hub was opened with.
  for (const a of document.querySelectorAll('a[href*="10.0.0.30"]')) {
    a.href = a.href.replace("10.0.0.30", location.hostname);
  }

  function tick() {
    const d = new Date();
    $("clock").textContent = d.toLocaleString([], { weekday: "long", hour: "numeric", minute: "2-digit" });
    $("clock").dateTime = d.toISOString();
    if (lastOk) {
      const s = Math.round((Date.now() - lastOk) / 1000);
      $("updated").textContent = s < 20 ? "Up to date" : `Last updated ${Math.round(s / 60) || 1} min ago`;
    }
  }

  const finishAt = (minutes) =>
    Number.isFinite(minutes) ? new Date(Date.now() + minutes * 60000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  function text(id, value, tone) {
    const n = $(id);
    n.textContent = value ?? "—";
    if (tone) n.dataset.tone = tone; else delete n.dataset.tone;
  }

  function spark(id, values, max) {
    const svg = $(id);
    if (!values || values.length < 2) { svg.replaceChildren(); return; }
    const top = max ?? Math.max(...values, 1);
    const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - (Math.min(v, top) / top) * 26}`);
    const ns = "http://www.w3.org/2000/svg";
    const area = document.createElementNS(ns, "polygon");
    area.setAttribute("points", `0,28 ${pts.join(" ")} 100,28`);
    const line = document.createElementNS(ns, "polyline");
    line.setAttribute("points", pts.join(" "));
    svg.replaceChildren(area, line);
  }

  function hours(h) {
    if (h == null) return "—";
    if (h < 1) return "under an hour";
    if (h < 48) return `${Math.round(h)} h`;
    return `${Math.round(h / 24)} days`;
  }

  function renderPrinter(p) {
    const band = $("band");
    band.dataset.state = p.state;
    $("band-headline").textContent = p.headline;
    const pct = p.progress || 0;
    band.querySelector(".line").setAttribute("aria-valuenow", String(pct));
    $("bead").style.width = `${pct}%`;
    $("nozzle").style.left = `${pct}%`;
    const detail = $("band-detail");
    if (p.state === "printing" && p.left) {
      const strong = document.createElement("strong");
      strong.textContent = p.left;
      const at = finishAt(p.minutes_left);
      detail.replaceChildren("Done in about ", strong, at ? `, around ${at}` : "");
    } else {
      detail.textContent = p.detail || "";
    }
  }

  function renderIssues(issues) {
    const box = $("issues");
    box.hidden = issues.length === 0;
    $("issue-list").replaceChildren(...issues.map((i) => {
      const li = document.createElement("li");
      li.className = "issue";
      li.dataset.tone = i.tone;
      const dot = document.createElement("span");
      dot.className = "dot";
      const what = document.createElement("strong");
      what.textContent = i.what;
      const say = document.createElement("span");
      say.className = "say";
      say.textContent = i.say;
      li.append(dot, what, say);
      return li;
    }));
  }

  function renderMovies(m) {
    $("movies-count").textContent = m.count != null ? `${m.count} movies` : (m.drive === "Connected" ? "Movies" : "Drive missing");
    const pill = $("movies-pill");
    pill.textContent = !m.plex_running ? "Plex stopped" : m.drive === "Connected" ? "Ready" : "No movies";
    pill.dataset.tone = m.tone;
    $("movies-drive").textContent = m.drive === "Connected"
      ? `Movies drive connected, ${m.free} free`
      : m.drive === "Missing" ? "Waiting for the movies drive." : `Movies drive: ${m.drive.toLowerCase()}`;
    const list = $("playing");
    if (m.playing === null) {
      list.replaceChildren(Object.assign(document.createElement("li"), { className: "empty", textContent: "Plex isn't answering." }));
    } else if (!m.playing.length) {
      list.replaceChildren(Object.assign(document.createElement("li"), { className: "empty", textContent: "Nothing playing." }));
    } else {
      list.replaceChildren(...m.playing.map((s) => {
        const li = document.createElement("li");
        const t = Object.assign(document.createElement("span"), { className: "t", textContent: s.title });
        const where = [s.who, s.device].filter(Boolean).join(" on ");
        const left = s.minutes_left != null ? `${s.minutes_left} min left` : "";
        const w = Object.assign(document.createElement("span"), {
          className: "w", textContent: [s.state === "paused" ? "Paused" : "", where, left].filter(Boolean).join(", "),
        });
        const bar = document.createElement("span");
        bar.className = "bar";
        const fill = document.createElement("i");
        fill.style.width = `${s.progress}%`;
        bar.append(fill);
        li.append(t, w, bar);
        return li;
      }));
    }
  }

  function render(d) {
    const worst = d.issues.some((i) => i.tone === "bad") ? "bad" : d.issues.length ? "warn" : "ok";
    $("summary").textContent = d.summary;
    $("summary").dataset.tone = worst;
    renderPrinter(d.printer);
    renderIssues(d.issues);
    renderMovies(d.movies);

    text("home-state", d.home.homebridge_running ? "Homebridge running" : "Homebridge stopped");
    $("home-pill").textContent = d.home.homebridge_running ? "Running" : "Stopped";
    $("home-pill").dataset.tone = d.home.tone;

    const w = d.workshop;
    text("ws-display", w.display === "Online" ? `Online, ${w.display_firmware}` : w.display,
      w.display === "Online" ? "ok" : w.display === "Offline" ? "bad" : null);
    text("ws-ai", w.ai, w.ai === "Down" ? "bad" : "ok");
    text("ws-models", w.ai === "Down" ? "—" : String(w.ai_models ?? 0));

    const p = d.pi;
    text("pi-temp", p.temp != null ? `${Math.round(p.temp)} °C` : "—");
    const cpu = p.cpu_series?.at(-1);
    text("pi-cpu", cpu != null ? `${Math.round(cpu)}%` : "—");
    text("pi-mem", p.mem_free_gb != null ? `${p.mem_free_gb} GB` : "—");
    spark("spark-temp", p.temp_series, 90);
    spark("spark-cpu", p.cpu_series, 100);
    spark("spark-mem", p.mem_series, 100);
    text("pi-power", p.power ?? "—", p.power === "Good" ? "ok" : p.power ? "bad" : null);
    text("pi-disk", p.disk_free_gb != null ? `${p.disk_free_gb} GB` : "—");
    text("pi-updates", p.updates == null ? "—" : String(p.updates));
    text("pi-uptime", hours(p.uptime_h));
    $("pi-pill").textContent = p.tone === "ok" ? "Healthy" : "Check";
    $("pi-pill").dataset.tone = p.tone;
  }

  async function refresh() {
    try {
      const r = await fetch("/api/now", { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      render(await r.json());
      lastOk = Date.now();
    } catch {
      $("summary").textContent = "Can't reach the Pi Hub right now. It will keep trying.";
      $("summary").dataset.tone = "bad";
    }
    tick();
  }

  // On the wall, keep the screen on where the browser allows it.
  async function stayAwake() {
    try { if (wall && "wakeLock" in navigator) await navigator.wakeLock.request("screen"); } catch {}
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { refresh(); stayAwake(); } });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

  tick();
  setInterval(tick, 15000);
  refresh();
  setInterval(refresh, 15000);
  stayAwake();
})();
