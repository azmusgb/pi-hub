# Amendment A29: the Assistant can read the print list

Date: 2026-11-19 · Status: **approved** (merged on 19 Nov 2026, pi-hub #285) · Amends: A28 D3 (how the Assistant
reads prints) and its non-goal "any change to Pi Hub's code, routes or pages" for this one route · Builds on: baseline
7 (Bambuddy holds prints; Pi Hub draws them; LocalAI reads house facts and does not hold them), the shared contract
"House facts (`/api/now`, `/api/needs`, `/api/records`)", A25 (a print has one address).

Read on 19 Nov 2026: pi-hub at `origin/main`, LocalAI at `d01ae43`.

## Why

A28 D3 says a question about prints is answered from Pi Hub's print list at ask time, and left how the Assistant may
read that list to LocalAI's plan, with no new Pi Hub route, key or gate. There is no way to do that:

- The list is in `GET /api/workshop` (`prints`: Bambuddy's last 20 via `bambuddy.prints(20)`, and
  `prints_available`).
- Local AI reaches Pi Hub over plain http (`http://10.0.0.80`). Caddy's `http://` block answers only the machine
  paths (`@machine`: `/api/now`, `/api/now/*`, `/api/needs`, `/api/records`, `/api/systems`, the Bambuddy webhook,
  shortcuts, `/healthz`). `/api/workshop` gets a redirect to the signed-in hub.

So Past work (LocalAI #565, live in `ca9aff1`) answers every print question with "I can't read Pi Hub's print list
from here yet", and the owner asked for that to be fixed (19 Nov 2026). LocalAI already validates the shape it would
read (`app/pi-hub.js` `printLog`) and does not fetch it.

## Decisions

**D1 A narrow print list under `/api/now`.** Pi Hub adds `GET /api/now/prints`:

```json
{ "as_of": 1795097000, "prints_available": true,
  "prints": [ { "id": 812, "name": "RIFT tile 10in", "status": "completed", "word": "Finished",
                "started": 1795010000, "ended": 1795018000, "seconds": 8000, "grams": 41.2, "error": null } ] }
```

- The newest 20 from `bambuddy.prints(20)` (the same cached fetch `/api/workshop` uses, so no extra Bambuddy load),
  with only those fields: no cost, no photo, no lab project or build, no archive id.
- When Bambuddy doesn't answer: `{"prints_available": false, "prints": []}` with 200, which LocalAI reads as
  "Bambuddy isn't answering", never as "no prints" (A28 D3). An error in Pi Hub itself is a 5xx, which LocalAI reads
  as "Pi Hub isn't answering".
- `/api/now/*` is already a machine path, so **Caddy does not change**. The route sits beside `/api/now` and
  `/api/now/poster/{n}.jpg` and follows their rule: read-only, no sign-in, cached.

**D2 Who can read it.** Recommended: like `/api/now`, anyone on the home network or the tailnet, with no key. It shows
print names, times and outcomes, which the Workshop display and `/api/now`'s printer card already show to the same
network. The alternative is a key header (the Mac and hub keys exist for other routes), which adds a secret to the
PC and a gate change for a list that is not more private than what `/api/now` serves today.

**D3 Each print links to its one address.** The Assistant cites a print with a link to Workshop on the signed-in hub
(`https://hub.rahe-home.duckdns.org/workshop`), as Past work does today. If A25's step for a print's own address ships,
the link follows it; that is not part of A29.

**D4 Nothing is stored on the PC.** LocalAI reads the list when a Past work question is about prints, uses it for that
one answer, and does not journal it (A28 D2). The run stays under A28 D5: the print names go to the local model inside
the marked block, with no tools.

## What this approves

1. **Pi Hub** (first): `GET /api/now/prints` in `hub/app.py`, with tests: the fields and only those fields; at most
   20; Bambuddy down gives `prints_available: false` and an empty list, not an error; served over the `http://` block
   (a Caddy test or the existing machine-path test extended to name it).
2. **LocalAI** (after Pi Hub's release is live): `app/pi-hub.js` fetches `/api/now/prints` through `printLog` at ask
   time and passes it to Past work; the "can't read" answer stays for Pi Hub not answering, and a new answer names
   Bambuddy when `prints_available` is false. Its tests: a finished, a failed and a cancelled print; Bambuddy down;
   Pi Hub down; print names inside the marked block.

Order per the coordinated-changes rule: the provider ships first, then the consumer.

## Not decided here

- A watch-history route (A28 still leaves films as "no record kept").
- Whether prints join the Assistant's journal (A28 D2 says no; unchanged).

## Non-goals

Any Caddyfile change; any change to sign-in or keys; the photo, cost or lab fields over plain http; a Pi Hub page
change; storing prints on the PC.

## Evidence required

- Pi Hub tests above, then after its release: `curl -s http://10.0.0.80/api/now/prints` from the Mac returns the
  shape with no sign-in, and `curl -s http://10.0.0.80/api/workshop` still redirects.
- LocalAI tests above, then after its release: in Past work, "did my last print finish" answers from the list and
  links to Workshop; with Bambuddy stopped it says Bambuddy isn't answering.
