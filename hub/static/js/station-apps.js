// Station Apps: Universal App Suite launcher and seamless embedded views for 10.0.0.30 services.
import { card, h } from "./core.js";

export const every = 0;

const SERVICES = [
  {
    id: "bambuddy",
    name: "Bambuddy",
    title: "3D Command Plane",
    desc: "Print queueing, automatic 3MF archiving, spool inventory, and live Bambu P1S telemetry.",
    port: "8000",
    embedUrl: "http://10.0.0.30:8000",
    directUrl: "http://10.0.0.30:8000",
    icon: "🖨️",
    badge: "Port 8000 · Self-hosted",
    tone: "ok",
    embeddable: true,
    parent: ["/workshop", "Workshop"],
  },
  {
    id: "grafana",
    name: "Grafana NOC",
    title: "Network Observability",
    desc: "Internet & gateway latency, packet loss, bandwidth monitoring, and Prometheus TSDB metrics.",
    port: "3000",
    embedUrl: "http://10.0.0.30:3000/d/netmon-overview/network-overview?orgId=1&kiosk",
    directUrl: "http://10.0.0.30:3000",
    icon: "📊",
    badge: "Port 3000 · Metrics TSDB",
    tone: "ok",
    embeddable: true,
    parent: ["/pi", "Help & system"],
  },
  {
    id: "status",
    name: "Uptime Kuma",
    title: "Service Health Checks",
    desc: "Automated layered ICMP ping, DNS query, and HTTP status verification across the home network.",
    port: "3001",
    embedUrl: "http://10.0.0.30:3001/status/home",
    directUrl: "http://10.0.0.30:3001",
    icon: "⏱️",
    badge: "Port 3001 · Live Probes",
    tone: "ok",
    embeddable: true,
    parent: ["/alerts", "Alerts"],
  },
  {
    id: "plex",
    name: "Plex Media Server",
    title: "Movie & TV Streaming",
    desc: "Household video library streaming from SSK SSD and Windows workstation backup share.",
    port: "32400",
    directUrl: "http://10.0.0.30:32400/web",
    icon: "🎬",
    badge: "Port 32400 · Streaming",
    tone: "ok",
    embeddable: false,
    parent: ["/movies", "Movies"],
  },
  {
    id: "scan",
    name: "Scan",
    title: "Scan to Paperless",
    desc: "Scan from the HP DeskJet (feeder or glass) or the Epson. Every PDF goes straight into Paperless.",
    port: "8095",
    embedUrl: "http://10.0.0.30:8095",
    directUrl: "http://10.0.0.30:8095",
    icon: "📠",
    badge: "Port 8095 · Scanners",
    tone: "ok",
    embeddable: true,
    parent: ["/print", "Print"],
  },
  {
    id: "paperless",
    name: "Paperless",
    title: "Household Documents",
    desc: "Bills, statements and records, read and searchable. Runs on the Windows PC; backed up to the Pi nightly.",
    port: "10.0.0.21:8010",
    directUrl: "http://10.0.0.21:8010",
    icon: "🗂️",
    badge: "PC · Port 8010",
    tone: "ok",
    embeddable: false,
    parent: ["/lists", "Lists"],
  },
  {
    id: "cockpit",
    name: "Cockpit Console",
    title: "Linux Server Admin",
    desc: "Raspberry Pi OS health, SSD storage filesystems, system updates, and web terminal.",
    port: "9090",
    directUrl: "http://10.0.0.30:9090",
    icon: "⚙️",
    badge: "Port 9090 · Linux Admin",
    tone: "ok",
    embeddable: false,
    parent: ["/pi", "Help & system"],
  },
  {
    id: "workshop-display",
    name: "Workshop Display",
    title: "Smart Kiosk OS",
    desc: "Touchscreen companion display on workbench showing live print progress and portal tools.",
    port: "10.0.0.124",
    directUrl: "http://10.0.0.124",
    icon: "🖥️",
    badge: "10.0.0.124 · Kiosk",
    tone: "ok",
    embeddable: false,
    parent: ["/workshop", "Workshop"],
  },
  {
    id: "local-ai",
    name: "Local AI Workstation",
    title: "Windows GPU Inference",
    desc: "Custom Windows 11 PC hosting local LLM inference models and SMB movie backup storage.",
    port: "10.0.0.21",
    directUrl: "https://10.0.0.21",
    icon: "🧠",
    badge: "10.0.0.21 · GPU Node",
    tone: "ok",
    embeddable: false,
    parent: ["/workshop", "Workshop"],
  },
];

function renderDirectory() {
  const intro = card("Station App Suite", { pill: `${SERVICES.length} Services`, tone: "ok", cls: "wide" },
    h("p", { class: "meta" }, "All dedicated appliances, network monitors, and services operating on 10.0.0.30 and the home LAN. Open them inside Pi Hub or launch them in a dedicated window.")
  );

  const cards = SERVICES.map((s) => {
    const buttons = [];
    if (s.embeddable) {
      buttons.push(h("a", { class: "action primary", href: `/apps/${s.id}`, "data-link": true }, "Open in Hub"));
    }
    buttons.push(h("a", { class: `action ${s.embeddable ? "ghost" : "primary"}`, href: s.directUrl, target: "_blank", rel: "noopener" }, "Direct window ↗"));

    return card(`${s.icon} ${s.name}`, { pill: s.badge, tone: s.tone },
      h("strong", { class: "app-service-title" }, s.title),
      h("p", { class: "meta", style: "margin: .5rem 0 1rem 0;" }, s.desc),
      h("div", { class: "app-card-actions", style: "display: flex; gap: .5rem; flex-wrap: wrap; margin-top: auto;" }, ...buttons)
    );
  });

  return [intro, h("div", { class: "cards app-suite-grid" }, ...cards)];
}

function renderEmbedded(service) {
  let frame = null;

  const reloadBtn = h("button", {
    type: "button",
    class: "ghost small",
    onclick: () => { if (frame) frame.src = frame.src; },
    title: "Reload embedded application"
  }, "Reload 🔄");

  const popoutBtn = h("a", {
    class: "ghost small action",
    href: service.directUrl,
    target: "_blank",
    rel: "noopener",
    title: "Open full application in a new browser tab"
  }, "New window ↗");

  const backBtn = h("a", {
    class: "ghost small action",
    href: "/apps",
    "data-link": true,
    title: "Return to App Suite directory"
  }, "← All Apps");

  const toolbar = h("div", { class: "app-frame-toolbar" },
    h("div", { class: "app-frame-lead" },
      backBtn,
      h("strong", {}, `${service.icon} ${service.name}`),
      h("span", { class: "app-port-chip" }, `Port ${service.port}`)
    ),
    h("div", { class: "app-frame-actions" },
      reloadBtn,
      popoutBtn
    )
  );

  frame = h("iframe", {
    class: "embedded-app-frame",
    src: service.embedUrl,
    title: `${service.name} application view`,
    allow: "fullscreen; clipboard-read; clipboard-write",
    loading: "eager"
  });

  return [toolbar, frame];
}

export function mount(state) {
  const path = location.pathname.replace(/\/$/, "");
  const match = SERVICES.find((s) => `/apps/${s.id}` === path || `/${s.id}` === path);

  state.root.replaceChildren();

  if (match && match.embeddable) {
    state.root.classList.add("embedded-mode");
    state.root.append(...renderEmbedded(match));
  } else {
    state.root.classList.remove("embedded-mode");
    state.root.append(...renderDirectory());
  }
}

export async function load() {
  // Static route launcher; embedded frames manage their own sub-resources.
}
