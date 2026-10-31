# home-mcp

Typed, bounded tools for the home systems, served to Claude Code over stdio. Design and phases:
[docs/superpowers/specs/2026-10-31-home-mcp-design.md](docs/superpowers/specs/2026-10-31-home-mcp-design.md).

## Tools (Phase 1, read-only)

| Tool | What it returns |
|---|---|
| `hub_now` | The hub's summary, issues, printer headline, network status and open needs |
| `printer_status(recent=5)` | The X2D's live state, recent prints (0-20), week totals, display, low spools |
| `pi_health` | Pi temperature, power, memory, services, storage, updates, failing self-checks, open outages, backups |
| `source_freshness(only_problems=False)` | Each data source's state, age and whether it is stale |
| `recent_alerts(limit=20, since_hours, tag)` | Alert history, newest first (limit 1-100) |

Every result carries `ok`, `source` and `as_of`. A failed source appears under `errors` as `unreachable`, `http`
or `bad_json`; the rest of the result still holds what worked.

## Setup

```sh
uv sync
claude mcp add -s user home -- "$PWD/.venv/bin/python" -m home_mcp
```

Configuration: `HOME_MCP_HUB_URL` (default `https://home.home.arpa`), `HOME_MCP_HUB_CA` (default
`~/.config/print-lab/home-ca.crt`; system CAs if missing), `HOME_MCP_TIMEOUT` (default 10 seconds).

## Checks

```sh
uv run pytest -q
```
