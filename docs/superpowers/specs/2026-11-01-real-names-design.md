# Real names and certificates for the house tools

Date: 2026-11-01. Status: approved by the owner ("a", free deSEC subdomain) after the options in chat. Replaces
decisions D3, D4 and part of D5 of `2026-10-24-one-home-design.md`; everything else there stands.

## Why

The gate works, but `*.home.arpa` costs the owner three things:

- **A private CA on every device.** Each phone, tablet and computer must trust Caddy's root by hand. The Pi's root and
  Local AI's root are both named "Caddy Local Authority - 2026 ECC Root", so on 1 Nov 2026 the iPhone trusted the wrong
  one and could not reach Local AI. Guests' browsers can't be fixed at all.
- **No shared sign-in.** `home.arpa` is a public suffix, so browsers refuse a `Domain=.home.arpa` cookie. Each tool
  gets its own cookie through a one-time code (`plans/2026-10-27-gate-per-tool-cookie.md`).
- **Awkward names.** `home.home.arpa`.

The owner won't pay for a domain. deSEC (a non-profit DNS host) gives a free `<name>.dedyn.io` with an API, and
`dedyn.io` is on the Public Suffix List (checked 1 Nov 2026), so `<name>.dedyn.io` is its own site: it can hold a
shared cookie and get its own Let's Encrypt certificates.

## Decisions

| # | Decision |
|---|---|
| N1 | The house names move to **`<name>.dedyn.io`**, a free deSEC subdomain the owner registers. `<name>` is the owner's choice and should not identify them (it appears in public DNS). |
| N2 | **One Let's Encrypt wildcard certificate**, `*.<name>.dedyn.io` plus `<name>.dedyn.io`, issued and renewed by Caddy through the DNS-01 challenge with the `caddy-dns/desec` module. A wildcard keeps tool names out of the public certificate-transparency logs. No device trusts a private CA any more. |
| N3 | **Caddy 2.10+ from Caddy's official build server** with that module, installed at `/usr/local/bin/caddy` at a pinned version with its SHA-256 recorded in the repo. The Debian `caddy` package stays for its user, unit and directories; the existing drop-in already sets `ExecStart`, and now points it at `/usr/local/bin/caddy`. `install.sh` installs or replaces the binary only when the pinned version differs. |
| N4 | **The deSEC token** lives in `/etc/pi-hub/secrets/desec.env` (`DESEC_TOKEN=…`, root 0600) and reaches Caddy through `EnvironmentFile`, like `hub_proxy.env`. The owner writes it on the Pi; it never goes in the repo, chat or logs. Use a token restricted to `_acme-challenge` TXT records if deSEC's token policies allow it. |
| N5 | **DNS.** At home, AdGuard rewrites `*.<name>.dedyn.io` and `<name>.dedyn.io` to `10.0.0.30`, as it does for `home.arpa` today. In public DNS, deSEC holds a wildcard A record to the Pi's Tailscale address, so the names also work away from home, or on a device whose resolver skips AdGuard, whenever Tailscale is on. Nothing becomes reachable from the internet: the Tailscale address only answers inside the tailnet. Tailscale split DNS for the new suffix is then optional. |
| N6 | **Same tool names, new suffix.** `home.home.arpa` becomes `hub.<name>.dedyn.io`; every other name keeps its first label (`assistant`, `bambuddy`, `paperless`, `homebox`, `backups`, `network`, `status`, `adguard`, `devices`, `pi`, `scan`). |
| N7 | **Shared sign-in.** The gate cookie is set with `Domain=.<name>.dedyn.io`, so one sign-in covers every tool. Retiring the one-time-code hand-off is a separate, later PR, once the new names have run for a week. |
| N8 | **Local AI is unchanged.** `assistant.<name>.dedyn.io` proxies to `https://10.0.0.21` as `assistant.home.arpa` does, with the Pi trusting Local AI's CA file. Browsers see only the real certificate. Local AI's own CA stays for direct `https://10.0.0.21` use and machine callers. |

## Moving over

1. **Owner:** create the deSEC account, register `<name>.dedyn.io`, create the token, and write it to
   `/etc/pi-hub/secrets/desec.env` on the Pi.
2. **Caddy 2.10+ on the Pi (PR 1):** the pinned binary, the drop-in change, and `caddy validate` of the current
   Caddyfile on the new version, plus the full test suite and `selfcheck`. Behaviour to re-check on 2.10: the gate's
   `request_header Cookie "hub_gate=[^;]*" "hub_gate="` (the Caddyfile notes 2.6 drops an empty replacement), and
   `forward_auth` with `copy_headers`. No names change in this PR.
3. **New names alongside the old (PR 2):** `acme_dns desec`, the wildcard site with a host matcher per tool, the
   AdGuard rewrite, and the deSEC A record. `home.arpa` keeps working unchanged.
4. **Browsers move (PR 3):** for browser page requests (`GET`, `Accept: text/html`), `*.home.arpa` answers with a 308
   redirect to the same path on the new name. `/api/*` and machine callers are not redirected. The hub's links, the
   display's links, push notification URLs and docs switch to the new names. The gate cookie gets
   `Domain=.<name>.dedyn.io` (N7).
5. **Machine callers move (PR 4):** pi-status, the PC's Pi Hub backup task, Local AI's hub calls, the Mac watcher,
   and anything else found by grepping for `home.arpa`. Each one is checked against live traffic in Caddy's log.
6. **Retire `home.arpa` (PR 5):** once Caddy's log shows no `home.arpa` requests for 7 days, the old sites and the
   `/home-ca.crt` download are removed. **Owner:** remove the old root from the iPhone, iPad and Mac.

## Not in this work

Local AI getting its own public certificate, exposing anything to the internet, and replacing AdGuard.

## Risks and how each is handled

- **Renewal depends on deSEC's API.** Caddy starts renewing 30 days before expiry and retries, so a deSEC outage of
  hours or days costs nothing. `selfcheck` warns when the certificate has under 14 days left.
- **deSEC rate limits** (15 record changes a minute, 300 a day per domain): one wildcard renewal is two changes about
  every 60 days. Never issue per-tool certificates.
- **A custom binary skips apt security updates.** The pin lives in the repo; bumping it is a one-line PR, and
  `selfcheck` reports the running version against the newest release.
- **Caddy 2.6 → 2.10 behaviour changes** could open the gate. PR 1 changes only the binary and must pass the gate
  tests (signed out → redirect, signed in → tool, a client-sent `X-Remote-User` is stripped) before any names move.
- **DNS-rebinding filters** in some resolvers drop public answers that point at private or CGNAT addresses. At home,
  AdGuard answers first; away from home, Tailscale handles it. Only a device that uses neither would fail, as it
  does today.
- **Losing `/var/lib/caddy`** no longer means re-trusting anything: Caddy simply gets a new certificate.
