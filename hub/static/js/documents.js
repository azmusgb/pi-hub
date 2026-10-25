// Documents: find, scan and print papers, and the household lists.
import { toolUrl } from "./sections.js";
import { linkGroup } from "./section-links.js";

export const every = 600;
export function mount(state) {
  state.root.append(linkGroup("", [
    [toolUrl("paperless"), "Find a document ↗", "Bills, statements and records in Paperless"],
    [toolUrl("scan"), "Scan a document ↗", "From the HP or the Epson, straight into Paperless"],
    ["/print", "Print", "Print a file and check the queue"],
    ["/lists", "Lists", "Shopping, to-dos and notes"],
  ]));
}
export async function load() {}
