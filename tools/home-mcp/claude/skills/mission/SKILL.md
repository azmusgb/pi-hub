---
name: mission
description: Attach this Claude Code session to a Pi Hub mission (A35 Mission Control) so its lifecycle is reported, mark a mission task started or done, detach, or show the binding. Use when the owner says "/mission attach a34", "/mission task measure start", "/mission detach", "/mission status", or asks to report this session's work against an initiative. Not for creating initiatives, plans or decisions (those come from reviewed manifests), and never for printer or deploy actions.
argument-hint: attach <initiative> [workstream] | detach | task <task> start|done | status
---

# Mission

A35 Mission Control records an initiative's live work in Pi Hub's mission ledger. Only sessions attached here report
(D3); everything else sends nothing. Reporting is off until `~/.claude/mission-config.json` says `"enabled": true`
(that happens at M1b acceptance); while it is off, `attach` still records the binding, and nothing is spooled.

What is reported (D9): session, turn and tool lifecycle with short labels (a command's own description, a file name),
the model id, effort, branch, remote, subagent start and finish, commit shas and PR numbers. Never prompts, replies,
tool input or output, file contents or thinking.

## How each action runs

Every action is one command, run with the Bash tool from the session's working directory. The runner is the skill's
own `home-mission` script, which execs home-mcp's `home-mission` CLI:

```
~/.claude/skills/mission/home-mission <action> ... --session "${CLAUDE_SESSION_ID}"
```

Always pass `--session "${CLAUDE_SESSION_ID}"`. If it arrives unsubstituted, the CLI ignores it and the hook fills the
session id in on its next firing in this directory, so `attach` still works. Report the command's output to the owner
as it is; do not summarise a "not spooled" line as success.

| You were asked | Run |
|---|---|
| `/mission attach <initiative> [workstream]` | `~/.claude/skills/mission/home-mission attach <initiative> [workstream] --session "${CLAUDE_SESSION_ID}"` |
| `/mission detach` | `~/.claude/skills/mission/home-mission detach --session "${CLAUDE_SESSION_ID}"` |
| `/mission task <task> start` | `~/.claude/skills/mission/home-mission task <task> start --session "${CLAUDE_SESSION_ID}"` |
| `/mission task <task> done` | `~/.claude/skills/mission/home-mission task <task> done --summary "<one line>" --session "${CLAUDE_SESSION_ID}"` |
| `/mission status` | `~/.claude/skills/mission/home-mission status --session "${CLAUDE_SESSION_ID}"` |

- `<initiative>` is the initiative's slug (`a34`). `[workstream]` and `<task>` take the full child id
  (`a34:task:measure`) or just its last part (`measure`); the CLI refuses an id that isn't of the bound initiative.
- `attach` records `~/.claude/mission-attach.json` under this directory's real path, with the session id, branch and
  remote, and spools `session.attached` when reporting is on. A session started here later (after `/clear`, a resume
  or a compaction) is re-bound by the hook, which keeps the old session id in the binding's lineage.
- `detach` removes the binding and spools `session.ended` with reason `detached`.
- `task` spools `task.started` or `task.done`. It refuses when this directory isn't attached. Keep `--summary` to one
  plain line about the outcome, never pasted output.
- `status` prints the binding, whether reporting is on (and why not), and how many events wait in the spool.

## Exit codes

`0` done (including "not spooled: reporting is off"); `1` refused, with the reason on the first line. Say what was
refused and why; don't retry with a different id unless the owner gives one.
