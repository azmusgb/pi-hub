# Amendment A15: Pi Hub signs the owner in to Bambuddy

Date: 2026-11-07 · Status: **approved** 7 November 2026 (pi-hub #165) · Amends: A12 D1 ("Nothing else writes to
Bambuddy: no settings, keys, …") by one named write; and `docs/status.md` item 17 (Authentik: skip) for Bambuddy only.

## Why

1. **The owner signs in twice.** `bambuddy.rahe-home.duckdns.org` is behind the house gate, which already knows the owner
   (Pi Hub's session). Bambuddy then asks for its own password.
2. **Bambuddy's session ends every 24 hours.** The limit is a constant in its source (`ACCESS_TOKEN_EXPIRE_MINUTES =
   60 * 24`), with no setting. The owner re-types the password daily, and again whenever the phone drops site data.
3. **Bambuddy already supports the fix.** Its Settings has OpenID Connect providers: authorization code with PKCE (S256),
   state and nonce, the provider found through `/.well-known/openid-configuration`, and an `is_autologin` flag that sends
   the sign-in page straight to the provider. Read on 7 Nov 2026 from Bambuddy 1.3.0's API and source.
4. **Why not Authentik (status.md 17).** That item was skipped as "far too heavy for one household", and it is. This is
   not a second product: one small provider inside Pi Hub, for one user and one client.

## Decisions

**O1 Pi Hub is the provider for Bambuddy only.** One registered client (Bambuddy), one person (the owner). It is not a
general sign-in service, and no other app is added without its own amendment.

**O2 Owner only, from the existing session.** The authorize step needs Pi Hub's owner session, the same one the gate
reads. With no session, the owner goes to Pi Hub's sign-in and comes back. A household member or a guest gets no token.

**O3 A small, standard flow and nothing more.** Discovery document, authorize, token and keys endpoints; authorization
code with PKCE S256 and the client secret; one exact redirect URI, `https://bambuddy.rahe-home.duckdns.org/api/v1/auth/oidc/callback`.
Codes work once and last 60 seconds; the ID token lasts 5 minutes; no refresh tokens, no userinfo endpoint, no dynamic
registration. The issuer is `https://hub.rahe-home.duckdns.org`; Bambuddy's container reaches it (checked 7 Nov: TLS answers
from inside the container).

**O4 Secrets stay on the Pi.** The signing key and the client secret live under `/etc/pi-hub/secrets/` (root:pi-hub 640),
and the client secret is entered once in Bambuddy. Neither is committed or logged. If the Pi is lost, both are made
again and Bambuddy's provider is set up again; nothing else depends on them (the key's loss signs no one out of anything
but Bambuddy).

**O5 The password sign-in stays (break-glass).** Bambuddy's own login and the admin account `bill` are not removed, and
the machine callers' scoped keys are untouched. If Pi Hub is down, the owner signs in to Bambuddy with its password as
today. `is_autologin` is turned on only if the plan's first step shows the password form is still reachable when the
provider isn't (Open question Q1); otherwise Bambuddy shows a "Sign in with Pi Hub" button and the owner taps it.

**O6 One named write to Bambuddy.** A12 D1's list gains: the owner, once, adds the Pi Hub provider in Bambuddy's settings
through Bambuddy's own admin sign-in (a script run on the Pi like `bambuddy-key-scopes.py`, or its settings screen).
Pi Hub's runtime never writes to Bambuddy's settings. The provider links to the existing `bill` account, not a new one
(O7).

**O7 The account is linked by the owner's address, safely.** The ID token carries the owner's email, set in Pi Hub's
owner record, with `email_verified` true. Bambuddy links it to the existing admin account only for that address, and
`auto_create_users` stays off so no one else can get an account through the provider. If Bambuddy refuses this
combination (it has a guard against unsafe linking), the plan links the account by hand in Bambuddy once instead.

**O8 What the owner sees.** Tapping "Open Bambuddy" from Pi Hub opens Bambuddy already signed in when Pi Hub's session is
valid. Bambuddy's 24-hour timer still runs, but renewing it is a quick redirect with no typing. Signing out of Bambuddy
does not sign out of Pi Hub.

## Open question

**Q1** What Bambuddy shows when `is_autologin` is on and the provider can't be reached, and whether its password form
has a direct address. The plan's first step reads this from Bambuddy's source and settles O5 before any code.

## What does not change

The house gate, Pi Hub's own sign-in, the scoped machine keys, A12's two named writes, and Bambuddy's port allow-list.

## Acceptance

On the owner's phone, signed in to Pi Hub and signed out of Bambuddy: "Open Bambuddy" lands signed in with no password, and
again after Bambuddy's session has expired. The password route still works with the provider turned off in Bambuddy
(not by stopping Pi Hub). Recorded as "Accepted <date>".
