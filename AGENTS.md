# Rules for coding agents in pi-hub

These hold for every agent (Claude Code, Antigravity, others). They are short on purpose; read them all.

## What governs

- The frozen baseline is `docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`: section 11
  (migration sequence), section 12 (decisions) and its Amendments. It governs until an approved amendment changes it.
- A change the baseline doesn't contain (a new page, a new navigation model, a new route through Caddy, a new store) is
  a **proposed amendment**: write it as `docs/superpowers/specs/<date>-amendment-<id>-<name>.md` and open it as a PR.
  Don't implement it before that PR merges.
- Any UI work follows the design contract in appliance-ui, `DESIGN.md` (https://github.com/azmusgb/appliance-ui/blob/main/DESIGN.md),
  after the baseline and its amendments (A6, A7). Contrast claims come from its measured `docs/contrast.md`, never from
  eyeballing; a new token or component is proposed in appliance-ui and synced into `hub/static/ui`, never added here.
- Work on one named step or plan at a time. If there is no plan in `docs/superpowers/plans/` for the step, the first PR
  is the plan.

## How changes land

- Never push to `main`, and never push to the `pi` remote. Branch, open a PR, stop. The Pi's deploy repo refuses a tip that isn't a
  merged PR; never use `-o allow-direct`, which is the owner's.
- Every migration PR says: the baseline requirement it implements, full or partial coverage, and acceptance evidence.
- Run both suites before opening the PR and paste the counts:
  `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests` and `node --test tests/*.mjs`.
- Deploys (`git push pi main`) are done by the owner's Claude Code session after the deploy preflight
  (`deploy_state` for pi-hub), never by an agent working a feature.

## Boundaries that are easy to break

- Local AI stays on its own origin (`assistant.…`). Never proxy it under Pi Hub's origin: its scripts would run with
  the owner's Pi Hub session.
- `deploy/caddy/Caddyfile`, `deploy/`, auth (`hub/auth.py`, `hub/gate.py`) and printer control routes change only in a
  PR that names the baseline decision allowing it.
- "Merged" is not "live", and "live" is not "accepted": acceptance is the check the plan defines, seen and recorded.
