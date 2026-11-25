// The kit's phrase table for a test, the way index.html gives it to the page: ui/needs.js is a classic script that
// sets ApplianceNeeds before the modules run. Import this file first in a test whose modules read the kit's phrases.
import { readFileSync } from 'node:fs';

const kit = { exports: {} };
new Function('module', readFileSync(new URL('../../hub/static/ui/needs.js', import.meta.url), 'utf8'))(kit);
globalThis.ApplianceNeeds = kit.exports;

export const PHRASES = kit.exports.PHRASES;

// The kit's navigation shell (ui/shell.js), a classic script that sets ApplianceShell (navigation.js reads it there).
const shell = { exports: {} };
new Function('module', readFileSync(new URL('../../hub/static/ui/shell.js', import.meta.url), 'utf8'))(shell);
globalThis.ApplianceShell = shell.exports;
