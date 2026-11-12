# Rules for coding agents in pi-hub

These hold for every agent (Claude Code, Antigravity, others). They are short on purpose; read them all.

## What governs

- The frozen baseline is `docs/superpowers/specs/2026-11-01-platform-product-architecture-design.md`: section 11
  (migration sequence), section 12 (decisions) and its Amendments. It governs until an approved amendment changes it.
- A change the baseline doesn't contain (a new page, a new navigation model, a new route through Caddy, a new store) is
  a **proposed amendment**: write it as `docs/superpowers/specs/<date>-amendment-<id>-<name>.md` and open it as a PR.
  Don't implement it before that PR merges.
- **Read the design contract before any UI work**: appliance-ui `DESIGN.md`
  (https://github.com/azmusgb/appliance-ui/blob/main/DESIGN.md). Read it at the start of the task, not from memory or
  from this summary. The baseline and its approved amendments win where they differ. If you can't open it (no network,
  no access), say so and stop before changing a screen. Contrast claims come from its measured `docs/contrast.md`, never from
  eyeballing; a new token or component is proposed in appliance-ui and synced into `hub/static/ui`, never added here.
- Work on one named step or plan at a time. If there is no plan in `docs/superpowers/plans/` for the step, the first PR
  is the plan.

## How changes land

- Never push to `main`, and never push to the `pi` remote. Branch, open a PR, stop. The Pi's deploy repo refuses a tip that isn't a
  merged PR; never use `-o allow-direct`, which is the owner's.
- Base every PR on `main`. Never stack one PR on another's branch: a PR merged into a branch that isn't `main` never
  ships.
- Every migration PR says: the baseline requirement it implements, full or partial coverage, and acceptance evidence.
- Run both suites before opening the PR and paste the counts:
  `HUB_NO_SAMPLER=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests` and `node --test tests/*.mjs`.
- Also run the sprawl check: `python3 -I tools/sprawl.py . --out /tmp/pi-hub-sprawl --baseline .sprawl-baseline.json`.
  It exits 1 and names the measure when dead code, duplication, oversized files or over-complex functions grow.
  Fix the growth, or explain it in the PR. A PR that removes sprawl lowers the baseline with `--write-baseline
  .sprawl-baseline.json` in the same PR.
- The kit's literals check runs in the JS suite (`tests/test_kit_literals.mjs`): a colour, size, spacing, radius,
  shadow, duration, layer or private custom-property name written by hand under `hub/static` may not be added. Use
  the kit's `--ui-*` value. A PR that removes one lowers the baseline in the same PR:
  `node hub/static/ui/literals.mjs hub/static --write-baseline` (it refuses to raise a count; `--list` shows each
  finding). Adding to `.kit-literals-allow.json` needs a sentence in the PR saying why.
- If a change makes an existing test wrong, change that test in its own commit and say why in the PR. Never loosen or
  delete an assertion to get a pass.
- A PR that changes anything under `hub/static` bumps `SHELL` in `hub/static/sw.js`, or phones keep the old files.
- Browser checks (`tests/browser`: the width sweep, `structure.mjs` with axe, `tabbar.mjs`) run from the Mac against
  `python3 tests/browser/preview.py`. Run `npm install` in `tests/browser` in each worktree (Playwright 1.63): the main
  checkout's copy is 1.55, whose Chromium crashes on this Mac. After the PR merges, `git worktree remove --force` is fine
  when the only untracked files are `tests/browser/node_modules` and `tests/browser/out`.
- Deploys (`git push pi main`) are done by the owner's Claude Code session after the deploy preflight
  (`deploy_state` for pi-hub), never by an agent working a feature.

## Boundaries that are easy to break

- Local AI stays on its own origin (`assistant.…`). Never proxy it under Pi Hub's origin: its scripts would run with
  the owner's Pi Hub session.
- `deploy/caddy/Caddyfile`, `deploy/`, auth (`hub/auth.py`, `hub/gate.py`) and printer control routes change only in a
  PR that names the baseline decision allowing it.
- Layouts adapt by their own width (container queries, `auto-fit` grids, `clamp()`), never by window-width media
  queries. The exceptions are the marked shell switch and the wall display (A10, enforced by
  `tests/test_css_responsive.mjs`).
- "Merged" is not "live", and "live" is not "accepted": acceptance is the check the plan defines, seen and recorded.
