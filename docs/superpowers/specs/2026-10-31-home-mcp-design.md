# home-mcp design

Date: 2026-10-31. Status: approved for Phase 1.

## Goal

Give Claude Code on the Mac typed, bounded tools for the home systems (Pi Hub, Local AI, the print lab, the
Windows PC) in place of ad-hoc ssh, curl and grep. The tools encode the house rules (deploy preflight, Local AI's
release-only deploys, cmd.exe quoting) so every session and subagent gets them right.

Not in scope: FormWorks, CAD or slicing (print-lab's planned `lab/mcp.py` stays separate), new backends.

## Prior designs checked

`docs/superpowers/specs` in pi-hub, LocalAI, print-lab and appliance-ui: no MCP design. print-lab's design plans a
CAD/slicing MCP; LocalAI's INTEGRATIONS.md plans an opt-in Penpot MCP bridge. Neither overlaps.

## Shape

- Python 3.12, official `mcp` SDK (the reference implementation) and `httpx` (async client, testable with
  `MockTransport`). Managed with uv.
- Stdio transport: Claude Code starts the server per session; no listening port, no service.
- A thin adapter over existing interfaces only: Pi Hub's FastAPI, Local AI's API, and SSH limited to a fixed
  command list.
- Every tool returns compact JSON with `source` and `as_of`. Large series and histories are trimmed. Failures come
  back as `{"ok": false, "source", "error": "unreachable" | "http" | "bad_json", "detail"}`, never a stack trace.

## Configuration

| Variable | Default |
|---|---|
| `HOME_MCP_HUB_URL` | `https://home.home.arpa` |
| `HOME_MCP_HUB_CA` | `~/.config/print-lab/home-ca.crt` (system CAs if the file is missing) |
| `HOME_MCP_TIMEOUT` | `10` seconds |

## Phases

1. **Read-only Pi Hub tools.** `hub_now`, `printer_status`, `pi_health`, `source_freshness`, `recent_alerts` over
   the hub's open read endpoints. (`/api/lab/*` needs a household session; deferred to Phase 4's key.)
2. **Deploy state and logs.** `deploy_state("pi-hub" | "localai")` compares the intended commit, the target's
   main/release and the live release, and reports the PC checkout's local changes. PC commands are read-only
   (`git rev-parse`, `git status --porcelain`, never `fetch`). `logs(service, lines)` from an allowlist; cmd.exe
   chaining with `&&`; process checks filtered so a search can't match itself.
3. **Local AI tools.** `localai_health`, `localai_runs` at `https://10.0.0.21` with the Mac key and CA print-lab
   already uses. Routes read from `~/dev/ai-harness/LocalAI`.
4. **Gated writes.** `printer_action`, `hub_action` over `/api/printer/{action}` and `/api/actions/{name}` (the
   hub's fixed action list and `action_log`), authenticated with a per-key token logged as "Claude". Two-step:
   the first call returns a preview and a confirm token; only a second call with it executes.
5. **Optional shared host.** The same server over authenticated HTTP. Private-network clients (goose, Claude Code
   elsewhere) can use the Pi or the PC; claude.ai and the phone app need public authenticated access (a tunnel).
   Network, firewall and service changes need explicit sign-off.

## Testing

pytest with `httpx.MockTransport` (and a fake SSH runner from Phase 2) for every tool, including unreachable,
HTTP error and bad JSON cases. One live smoke test against the real hub before a phase is called done.
