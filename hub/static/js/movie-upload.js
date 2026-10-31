// Media › Add a movie: pick a video, confirm title and year, and it goes to the PC's Movies folder in 8 MB pieces.
// A dropped connection (a phone locking, Wi-Fi to cellular) only costs one piece: the page asks the hub how much it
// has and carries on. Backed by hub/uploads.py; owner only.
import { h, toast } from "./core.js";

const TRIES = 6;  // per piece, with a growing pause, before the page stops and offers Resume

// Same rule as uploads.guess on the hub, so the form starts with what the hub would name it.
export function guessTitle(filename) {
  const stem = String(filename || "").replace(/\.[^.]+$/, "");
  const m = /^(.+?)[\s._([-]+((?:19|20)\d{2})(?:[\s._)\]-]|$)/.exec(stem);
  const tidy = (t) => t.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  return m ? { title: tidy(m[1]), year: Number(m[2]) } : { title: tidy(stem), year: null };
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

async function call(path, opts = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...opts });
  let body = {};
  try { body = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, body };
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends `file` from wherever the hub says it is. Calls onProgress(sent, total). Resolves with the hub's final answer.
export async function sendFile(up, file, { onProgress = () => {}, signal } = {}) {
  let offset = up.offset || 0;
  while (offset < file.size) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const piece = file.slice(offset, Math.min(offset + up.chunk, file.size));
    let answer = null;
    for (let attempt = 0; attempt < TRIES && !answer; attempt += 1) {
      try {
        const r = await call(`/api/movies/uploads/${up.id}?offset=${offset}`, {
          method: "PUT", body: piece, signal, headers: { "Content-Type": "application/octet-stream" },
        });
        if (r.ok) answer = r.body;
        else if (r.status === 409 && Number.isFinite(r.body.offset)) answer = { offset: r.body.offset, done: false };
        else if (r.status >= 400 && r.status < 500) throw Object.assign(new Error(r.body.detail || `Refused (${r.status})`), { fatal: true });
      } catch (e) {
        if (e.fatal || e.name === "AbortError") throw e;
      }
      if (!answer) await pause(Math.min(15000, 1000 * 2 ** attempt));
    }
    if (!answer) throw new Error("The connection keeps dropping. Resume when you're back on a steady connection.");
    offset = answer.offset;
    onProgress(offset, file.size);
    if (answer.done) return answer;
  }
  return { done: true };
}

// The button and its dialog. `onAdded(final)` runs after a movie lands (Media refreshes its lists).
export function addMovieButton(onAdded = () => {}) {
  const fileInput = h("input", { type: "file", id: "movie-upload-file", accept: ".mkv,.mp4,.m4v,.avi,video/*" });
  const title = h("input", { type: "text", id: "movie-upload-title", autocomplete: "off", required: true, maxlength: 120 });
  const year = h("input", { type: "number", id: "movie-upload-year", inputmode: "numeric", min: 1888, max: 2100 });
  const named = h("p", { class: "meta", "aria-live": "polite" });
  const bar = h("div", { class: "meter-bar", style: "--pct:0" });
  const meter = h("div", { class: "meter meter--ok", hidden: true, role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0", "aria-label": "Upload progress" }, bar);
  const status = h("p", { class: "meta", role: "status", "aria-live": "polite" });
  const send = h("button", { type: "submit", class: "btn btn--primary" }, "Add to Plex");
  const stop = h("button", { type: "button", class: "btn ghost" }, "Cancel");
  const form = h("form", { class: "movie-upload-form stack", method: "dialog" },
    h("h2", {}, "Add a movie"),
    h("label", { for: "movie-upload-file" }, "Video file"), fileInput,
    h("label", { for: "movie-upload-title" }, "Title"), title,
    h("label", { for: "movie-upload-year" }, "Year (optional)"), year,
    named, meter, status,
    h("div", { class: "row-actions" }, send, stop));
  const dialog = h("dialog", { class: "movie-upload", "aria-labelledby": "movie-upload-heading" }, form);
  form.querySelector("h2").id = "movie-upload-heading";

  let current = null;   // { up, file } while sending or paused
  let controller = null;

  const preview = () => {
    const t = title.value.trim();
    const ext = (fileInput.files[0]?.name.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    named.textContent = t ? `Saved as "${t}${year.value ? ` (${year.value})` : ""}${ext}"` : "";
  };
  fileInput.addEventListener("change", () => {
    const f = fileInput.files[0];
    if (!f) return;
    const g = guessTitle(f.name);
    title.value = g.title;
    year.value = g.year ?? "";
    status.textContent = formatBytes(f.size);
    current = null;
    preview();
  });
  title.addEventListener("input", preview);
  year.addEventListener("input", preview);

  const progress = (sent, total) => {
    const pct = total ? Math.floor((sent / total) * 100) : 0;
    meter.hidden = false;
    bar.style.setProperty("--pct", String(pct));
    meter.setAttribute("aria-valuenow", String(pct));
    status.textContent = `${formatBytes(sent)} of ${formatBytes(total)} (${pct}%)`;
  };

  const busy = (on) => {
    send.disabled = on; fileInput.disabled = on; title.disabled = on; year.disabled = on;
    send.textContent = on ? "Sending…" : current ? "Resume" : "Add to Plex";
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file) { status.textContent = "Choose a video file first."; fileInput.focus(); return; }
    if (!title.value.trim()) { status.textContent = "Give it a title."; title.focus(); return; }
    controller = new AbortController();
    busy(true);
    try {
      if (!current) {
        const r = await call("/api/movies/uploads", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, size: file.size, title: title.value.trim(), year: year.value ? Number(year.value) : null }),
        });
        if (!r.ok) throw new Error(r.body.detail || `Couldn't start (${r.status})`);
        current = { up: r.body, file };
      } else {
        const r = await call(`/api/movies/uploads/${current.up.id}`);
        if (!r.ok) { current = null; throw new Error(r.body.detail || "That upload expired. Start again."); }
        current.up = { ...current.up, offset: r.body.offset };
      }
      const done = await sendFile(current.up, file, { onProgress: progress, signal: controller.signal });
      status.textContent = `Added "${done.final || current.up.final}". Plex ${done.rescanned === false ? "will find it on its next scan" : "is scanning now"}.`;
      toast(`Added ${done.final || current.up.final}`);
      current = null;
      form.reset();
      named.textContent = "";
      onAdded(done.final);
    } catch (e) {
      if (e.name === "AbortError") status.textContent = "Cancelled.";
      else status.textContent = e.message || "Something went wrong.";
    } finally {
      controller = null;
      busy(false);
    }
  });

  stop.addEventListener("click", async () => {
    if (controller) controller.abort();
    if (current) {
      try { await call(`/api/movies/uploads/${current.up.id}`, { method: "DELETE" }); } catch {}
      current = null;
    }
    meter.hidden = true;
    status.textContent = "";
    busy(false);
    dialog.close();
  });

  const open = h("button", { type: "button", class: "btn", "aria-haspopup": "dialog" }, "Add a movie");
  open.addEventListener("click", () => { dialog.showModal(); fileInput.focus(); });
  return h("div", { class: "movie-upload-row" }, open, dialog);
}
