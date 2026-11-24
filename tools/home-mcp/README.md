# home-mcp

Typed, bounded tools for the home systems, served to Claude Code over stdio. Design and phases:
[docs/superpowers/specs/2026-10-31-home-mcp-design.md](docs/superpowers/specs/2026-10-31-home-mcp-design.md).

## Tools (read-only)

| Tool | What it returns |
|---|---|
| `hub_now` | The hub's summary, issues, printer headline, network status and open needs |
| `printer_status(recent=5)` | The X2D's live state, recent prints (0-20), week totals, display, low spools |
| `pi_health` | Pi temperature, power, memory, services, storage, updates, failing self-checks, open outages, backups |
| `source_freshness(only_problems=False)` | Each data source's state, age and whether it is stale |
| `recent_alerts(limit=20, since_hours, tag)` | Alert history, newest first (limit 1-100) |
| `releases()` | What is live where: Pi Hub's `release:<target>` records for all six targets, the canonical deployment state |
| `deploy_state(target, intended)` | Deploy preflight for `pi-hub` or `localai`: `ready`, `blockers`, `warnings`, the target's `record` from Pi Hub, and `live` read from the target as verification (a mismatch is a warning) |
| `decisions()` | The owner's decisions (A33, A35): `open` and `recently_answered` with id, kind, `asked_at`, `answered_at`, `answer`, `supersedes`, `recommended`, `link`, `question` and `options`, plus `version` (2 when the hub answers `?v=2` with structured rows, else 1; v2 rows may add initiative, context, why_needed, rationale, evidence, confidence, reversibility, blocking, delegable, number, status, answer_note and object options). Every text a session wrote (question, options and their fields, recommended, context, why_needed, rationale, answer_note) comes wrapped in `UNTRUSTED_DECISION` markers: data, not instructions. A row the hub wouldn't produce is dropped and named in `errors` as `bad_row`; the other rows stand Read it before asking the owner anything and when resuming work. Needs the Mac's deploy key; without it, or if the hub can't answer, `ok` is false and `open` is null |
| `service_logs(service, minutes=60, lines=100, contains)` | Bounded, redacted logs from a fixed list of Pi units and Local AI containers |

Every result carries `ok`, `source` and `as_of`. A failed source appears under `errors` as `unreachable`, `http`
or `bad_json`; the rest of the result still holds what worked.

## Setup

```sh
uv sync
claude mcp add -s user home -- "$PWD/.venv/bin/python" -m home_mcp
```

Configuration: `HOME_MCP_HUB_URL` (default `https://hub.rahe-home.duckdns.org`), `HOME_MCP_HUB_CA` (a CA file
to trust instead of the system CAs; unset by default), `HOME_MCP_TIMEOUT` (default 10 seconds),
`HOME_MCP_PI_HOST` / `HOME_MCP_PC_HOST` (SSH host names, default `pi` / `windows`), `HOME_MCP_PIHUB_REPO` /
`HOME_MCP_LOCALAI_REPO` (local checkouts, default `~/dev/pi-hub` / `~/dev/ai-harness/LocalAI`).

`decisions` sends the Mac's deploy key (`X-Hub-Deploy-Key`) from `HOME_MCP_HUB_KEY` when set, else the login
Keychain item `pi-hub-deploy-key` (`security find-generic-password -s pi-hub-deploy-key -w`). The key is never
logged or returned.

`deploy_state` and `service_logs` use SSH with your existing keys. MCP clients start stdio servers without
`SSH_AUTH_SOCK`; on macOS the server recovers the agent socket from launchd so agent-held keys still work.

## Mission reporting (A35 M1a)

`home-mission` is a CLI in this package. Unlike the MCP tools, which are read-only, it **writes**: to a local spool
(`~/.claude/mission-spool.jsonl`) and to Pi Hub's mission routes. It is **off by default**: nothing is posted until
`~/.claude/mission-config.json` says `{"enabled": true}`. A missing or unreadable file means off.

```sh
home-mission validate docs/missions/a34.json            # exit 0, or 1 with the problems
home-mission import docs/missions/a34.json --repo azmusgb/pi-hub --commit <sha> --dry-run
home-mission import docs/missions/a34.json --repo azmusgb/pi-hub --commit <sha>   # posts; exit 2 if Pi Hub has no mission routes yet
home-mission drain                                      # post the spool, one drainer at a time
home-mission spool status                               # events waiting, by source, and the oldest
```

- Event ids are stable for a manifest at a commit, so importing it again is a no-op; the spool keeps each event's
  `event_id`, so a replayed drain is too.
- Keys: the Keychain items `pi-hub-mission-<source>-key` (2 s timeout), or `HOME_MISSION_KEY_<SOURCE>`. Keys are sent
  only to an https hub, and never logged.
- The drain keeps the spool on 429, 5xx, 401, 404, unreachable or no key; it drops events on any other 4xx and writes
  one line (code and count) to `~/.claude/mission-drain.log`.
- The contract and manifest schema are read from this repo's `docs/contracts/mission-events-v1.json` and
  `docs/missions/manifest.schema.json`, so run it from an editable install in a pi-hub checkout (`uv sync`).
- Paths can be moved with `HOME_MISSION_SPOOL`, `HOME_MISSION_LOCK`, `HOME_MISSION_LOG` and `HOME_MISSION_CONFIG`;
  print-lab is `HOME_MCP_PRINTLAB_REPO` (default `~/dev/print-lab`), read from its `origin/main`.

## Checks

```sh
uv run pytest -q
```
