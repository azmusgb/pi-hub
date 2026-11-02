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

`deploy_state` and `service_logs` use SSH with your existing keys. MCP clients start stdio servers without
`SSH_AUTH_SOCK`; on macOS the server recovers the agent socket from launchd so agent-held keys still work.

## Checks

```sh
uv run pytest -q
```
