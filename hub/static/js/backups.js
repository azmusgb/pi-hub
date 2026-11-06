// System › Backups (platform step 7, PR 7.3): each Backrest repository and when it last backed up, and where to restore.
// A7 P1: the faceplate counts the repositories backed up within a day and a half; each repository is a lamp row.
import { api, h } from "./core.js";
import { faceplate, faceplateLoading, fillNeedsHere, lampRows, needsHere, section } from "./page-parts.js";
import { openInRow } from "./section-links.js";
import { agoText } from "./wording.js";

export const every = 300;

// Nightly backups: one missed night is still inside 36 hours; past that, or never, the repository needs a look.
const STALE_H = 36;
const fresh = (r) => r.hours !== null && r.hours !== undefined && r.hours <= STALE_H;
const repoName = (name) => (name === "Pi" ? "The Pi" : name === "Mac" ? "The Mac" : name);

export function mount(state) {
  state.plate = h("div", {}, faceplateLoading("Backups"));
  state.needs = needsHere();
  state.extras = h("div", { class: "stack" });
  state.root.append(state.plate, state.needs, state.extras, openInRow("system", ["backups"]));
}

// The faceplate from /api/system/backups, pure so it is tested without a page. A failed read is unknown, never fine.
export function backupsPlate(b) {
  if (!b?.available) {
    return faceplate({ name: "Backups", lamp: ["unknown", "Not answering"], readout: "—",
      caption: "Couldn't read the backups just now. Backrest may be restarting; this page tries again in five minutes." });
  }
  const repos = Array.isArray(b.repos) ? b.repos : [];
  if (!repos.length) {
    return faceplate({ name: "Backups", lamp: ["warn", "None set up"], readout: "—", caption: "No backup repositories are set up yet." });
  }
  const ok = repos.filter(fresh).length;
  const newest = Math.min(...repos.filter(fresh).map((r) => r.hours));
  return faceplate({
    name: "Backups",
    lamp: ok === repos.length ? ["ok", "Up to date"] : ["warn", `${repos.length - ok} behind`],
    readout: `${ok} of ${repos.length}`, unit: "up to date", size: "md",
    caption: ok ? `The newest backup finished ${agoText(newest)}.` : "None has backed up in the last day and a half.",
  });
}

export function backupRows(b) {
  return (b?.available && Array.isArray(b.repos) ? b.repos : []).map((r) => ({
    title: repoName(r.name),
    detail: r.hours === null || r.hours === undefined ? "No backup found" : `Backed up ${agoText(r.hours)}`,
    ...(fresh(r) ? { tone: "ok", word: "OK" } : { tone: "warn", word: r.hours === null || r.hours === undefined ? "None" : "Behind" }),
  }));
}

export async function load(state) {
  const [b] = await Promise.all([api("/api/system/backups").catch(() => null), fillNeedsHere(state.needs, "/backups")]);
  state.facts = b?.available ? b.repos.map((r) => `${r.name} ${r.hours === null ? "has no backup" : `backed up ${agoText(r.hours)}`}`).join(", ") : "";
  state.sources = [b?.available ? { name: "Backrest", tone: "ok" } : { name: "Backrest", tone: "bad", word: "isn't answering" }];
  state.plate.replaceChildren(backupsPlate(b));
  const rows = backupRows(b);
  state.extras.replaceChildren(...(rows.length ? [section("Repositories", lampRows(rows), { note: "To restore a file, open Backrest below." })] : []));
}
