"""Claude Code hook payloads as the M0 spike recorded them (A35 §21.1, Claude Code 2.1.323): every event carries
session_id, transcript_path, cwd, permission_mode and hook_event_name; tool and stop events carry effort.level; a
subagent's events carry agent_id and agent_type; the Agent call's PostToolUse response carries agentId, resolvedModel,
totalTokens and totalDurationMs. Every free-text field holds SECRET, so a test can prove none of it is written."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HOOK = Path(__file__).resolve().parents[1] / "claude" / "hooks" / "mission-report.py"
SID = "5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
SID2 = "6e2d3c4b-5f60-4b7c-9d8e-0f1a2b3c4d5e"
SECRET = "SENTINEL-7f3a-never-written"
MODEL = "claude-opus-5-5"
AGENT = "a7c41e0b9d2f"


def git_repo(path: Path, remote: str = "git@github.com:azmusgb/pi-hub.git", branch: str = "feat/a35-mission-hook") -> Path:
    path.mkdir(parents=True, exist_ok=True)
    for argv in (["init", "-q", "-b", branch], ["remote", "add", "origin", remote]):
        subprocess.run(["git", "-C", str(path), *argv], check=True, capture_output=True)
    return path


def transcript(path: Path, model: str = MODEL) -> Path:
    """A transcript whose user and assistant text holds SECRET, with `model` on the newest assistant line."""
    lines = [
        {"type": "user", "message": {"role": "user", "content": f"please {SECRET}"}, "sessionId": SID},
        {"type": "assistant", "message": {"model": model, "role": "assistant",
                                          "content": [{"type": "text", "text": SECRET}]}},
        {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": SECRET}]}},
    ]
    path.write_text("".join(json.dumps(x) + "\n" for x in lines))
    return path


def base(event: str, cwd: Path, tpath: Path, sid: str = SID, **extra) -> dict:
    return {"session_id": sid, "transcript_path": str(tpath), "cwd": str(cwd), "permission_mode": "bypassPermissions",
            "hook_event_name": event, **extra}


def payloads(cwd: Path, tpath: Path, sid: str = SID) -> dict[str, dict]:
    """One payload per hook event the hook is registered for, keyed by the contract type it should map to."""
    effort = {"effort": {"level": "high"}}
    read = {"tool_name": "Read", "tool_input": {"file_path": "/Users/x/dev/pi-hub/hub/app.py"},
            "tool_use_id": "toolu_01ReadAbc"}
    return {
        "session.attached": base("SessionStart", cwd, tpath, sid, source="startup"),
        "turn.started": base("UserPromptSubmit", cwd, tpath, sid, prompt=f"do it {SECRET}"),
        "tool.running": base("PreToolUse", cwd, tpath, sid, **read, **effort),
        "tool.finished": base("PostToolUse", cwd, tpath, sid, **read, **effort,
                              tool_response={"type": "text", "file": {"content": SECRET}}),
        "waiting.owner": base("PermissionRequest", cwd, tpath, sid, tool_name="Bash",
                              tool_input={"command": f"echo {SECRET}", "description": "Echo a word"},
                              permission_suggestions=[{"type": "addRules", "rules": [{"ruleContent": SECRET}]}]),
        "subagent.started": base("SubagentStart", cwd, tpath, sid, agent_id=AGENT, agent_type="Explore"),
        "subagent.finished": base("SubagentStop", cwd, tpath, sid, agent_id=AGENT, agent_type="Explore",
                                  agent_transcript_path=str(tpath), stop_hook_active=False,
                                  last_assistant_message=SECRET, **effort),
        "turn.finished": base("Stop", cwd, tpath, sid, stop_hook_active=False, last_assistant_message=SECRET, **effort),
        "session.ended": base("SessionEnd", cwd, tpath, sid, reason="prompt_input_exit"),
    }


def bash_post(cwd: Path, tpath: Path, command: str, stdout: str, sid: str = SID, tuid: str = "toolu_01Bash") -> dict:
    return base("PostToolUse", cwd, tpath, sid, tool_name="Bash", tool_use_id=tuid,
                tool_input={"command": command, "description": "Run it"},
                tool_response={"stdout": stdout, "stderr": SECRET, "interrupted": False, "isImage": False})


def agent_post(cwd: Path, tpath: Path, sid: str = SID) -> dict:
    return base("PostToolUse", cwd, tpath, sid, tool_name="Agent", tool_use_id="toolu_01Agent",
                tool_input={"description": "Find the spool", "prompt": SECRET, "subagent_type": "Explore"},
                tool_response={"status": "completed", "prompt": SECRET, "agentId": AGENT,
                               "content": [{"type": "text", "text": SECRET}], "resolvedModel": "claude-haiku-5",
                               "totalTokens": 18342, "totalDurationMs": 41250, "totalToolUseCount": 7},
                effort={"level": "high"})


def run_hook(payload, env: dict | None = None, preexec=None, raw: str | None = None) -> tuple[subprocess.CompletedProcess, float]:
    """Run the hook as Claude Code does: python3 -I, the payload as JSON on stdin. Returns (result, seconds)."""
    started = time.monotonic()
    r = subprocess.run([sys.executable, "-I", str(HOOK)], input=raw if raw is not None else json.dumps(payload),
                       capture_output=True, text=True, timeout=20, env={**os.environ, **(env or {})},
                       preexec_fn=preexec)
    return r, time.monotonic() - started
