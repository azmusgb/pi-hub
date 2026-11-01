# Your devices are the owner

**Date:** 1 Nov 2026 · **Status:** draft for the owner's review

**Owner's words:** "Rethink full experience. Right now I'm the only user on the internal network. All three devices are
mine. Maybe we can tie admin to machine registrations." Then "Yes" to: your Tailscale machines are the registration.

**Who it is for:** the owner alone (One Home, 2026-10-24, still stands), on the Mac, the Windows PC and the iPhone.

## Problem

Owner actions ask for a password the owner rarely types: Pi Hub settings, Pair display, and every `*.home.arpa` tool
behind the gate. A PIN sign-in gets "household", then the owner password is asked again. Owner sessions last 12 hours,
so it comes back twice a day on every device. The household PIN serves no one (One Home: the household is not a user).

## Outcome

On one of the owner's registered devices, Pi Hub and every gated tool open as the owner, with no sign-in screen, no
password and no expiry. Any other device sees today's sign-in. The owner adds or removes a device in one place.

## Decisions

| # | Decision |
|---|---|
| R1 | **The registration is Tailscale's.** A request is the owner when its source is a tailnet address that Tailscale's own `whois` names as a machine on the owner list. Tailscale proves the machine with its node key; nothing is stored on the device. |
| R2 | **The owner list** lives in Pi Hub (`owner_devices`: Tailscale StableID, name, added, last seen). Settings › People and access › **Your devices** lists them, shows "this device" and offers **Add this device** (on a tailnet device not yet listed) and **Remove**. Adding needs an owner (a listed device, or the owner password once). The first device is added at the owner-password sign-in with a "Remember this device" checkbox, checked by default. |
| R3 | **One identity, any user's node is refused.** `whois` must return the owner's login (`wjrahe@gmail.com`, saved at first add) and no tags; a shared or tagged node is never the owner, even if listed. |
| R4 | **Where it is checked:** `auth.who()`, the one place every role check goes through, and `GET /api/gate`. A device match is role `owner`, device name from the list; a cookie session is still read first. Nothing else changes in the route code. |
| R5 | **The source address must be real.** Caddy passes the peer it saw as `X-Hub-Peer: {remote_host}` with `X-Hub-Proxy: <secret>` (a 32-byte file readable by Caddy and pi-hub only, like the Grafana header). The hub trusts `X-Hub-Peer` only with the right secret, and only when it is in `100.64.0.0/10`. A client-sent `X-Hub-Peer` is stripped by Caddy. This keeps any other process on the Pi (which can reach 127.0.0.1:8100 and set `X-Forwarded-For`) from claiming a device. The Tailscale firewall's drop of `100.64.0.0/10` from other interfaces (present: `nft`, `iifname != "tailscale0" … drop`) keeps the LAN from spoofing one. |
| R6 | **`whois` by the hub user** through tailscaled's local socket (works today as `pi-hub`, no helper needed). Answers cached 60 s per address; a `whois` error is "not a device", never the owner. |
| R7 | **Sign-in that stays:** the owner password, for a device off Tailscale or not listed. Its session lasts **30 days** (was 12 hours). The household PIN, PIN people and the PIN form are removed. Siri Shortcut keys are unchanged (they have their own keys and log as household). |
| R8 | **Every owner action is logged** with the device name (`action_log.device`), as today. Settings shows each device's last seen. |
| R9 | **The display is not a device.** It keeps its own pairing key (`hubd_`). |

## The three devices

- **Mac** and **Windows PC:** already reach the Pi over Tailscale at home (the Pi advertises `10.0.0.30/32`). Nothing to set up.
- **iPhone:** works whenever Tailscale is on. Set Tailscale's **VPN On Demand** to always on, so it is on at home too.
  With it off, the iPhone gets the owner-password sign-in (30 days).
- The iPad is on the tailnet but not listed until the owner adds it.

## Error handling

- `whois` fails or times out (tailscaled down): not a device; the sign-in page shows, with "Your devices aren't
  recognised right now (Tailscale isn't answering on the Pi)".
- A listed device removed from the tailnet: `whois` no longer names it; it stops being the owner at once.
- A lost or stolen device: Remove in Settings, or remove it in the Tailscale admin console; either ends it at once.
- The last device can't be removed while it's the one asking unless the owner password is entered (no lock-out).

## Not in scope

Passkeys (Face ID/Touch ID). R1–R7 leave no daily prompt to replace; the owner password is the rare fallback.
Revisit if the iPhone often reaches the hub without Tailscale.

## Testing

- `auth.who()` with a fake `whois`: listed + right login + right secret → owner; unlisted, tagged, other login, wrong
  or missing secret, non-`100.64/10` peer, `whois` error → falls through to the cookie.
- Caddy: a client-sent `X-Hub-Peer` / `X-Hub-Proxy` never reaches the hub (a request through Caddy with both set).
- Settings: add, remove, last device guard; first-sign-in "Remember this device".
- On the Pi: the Mac and PC open Settings and Pair display with no sign-in; a LAN device without Tailscale gets the
  sign-in; turning Tailscale off on the iPhone shows the sign-in, on again shows the owner.

## Rollout

1. Pi Hub: owner list, `who()`/gate check, Caddy headers, Settings page; PIN still present. Owner adds the Mac, PC and iPhone.
2. After a few days with no sign-in prompts: remove the household PIN and its form; owner sessions to 30 days.
