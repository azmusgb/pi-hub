#!/usr/bin/env python3
"""Claude Code hook: report an attached session's lifecycle to the A35 mission spool (plan decisions 2, 3, 8-10).

Appends one line per event to ~/.claude/mission-spool.jsonl and starts `home-mission drain` detached; it never
touches the network, never prints, and always exits 0 within 2 s. Off until ~/.claude/mission-config.json says
"enabled": true, and then only sessions attached with /mission attach report.

Sent: ids, labels (a command's own description, a file name, a host), the model id from the transcript's newest
assistant line, effort, branch and remote, a commit sha or PR number. Never sent: the prompt, tool input beyond the
label, tool output beyond the sha or PR pattern, the assistant's message, or any transcript text.

Standard library only: the mission modules are loaded by file path from this file's real location (it is installed
as a symlink), because importing home_mcp would pull in httpx.
"""
import fcntl
import importlib.util
import json
import os
import re
import shlex
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

LIMIT_S = 1.8  # the self-limit, under Claude Code's 2 s budget for this hook with interpreter start-up included
TAIL_BYTES = 64 * 1024
SOURCE = "claude"
MISSION_SRC = Path(os.environ.get("HOME_MISSION_SRC")
                   or Path(__file__).resolve().parents[2] / "src" / "home_mcp" / "mission")
SKIP_TOOLS = ("TodoWrite", "TaskCreate", "TaskUpdate", "ToolSearch")  # bookkeeping, as localai-progress.py skips
AGENT_TOOLS = ("Agent", "Task")
EFFORTS = ("low", "medium", "high", "xhigh", "max")
START_SOURCES = ("startup", "resume", "clear", "compact")
_NAME = re.compile(r"[\w.:-]{1,80}")  # a tool name or agent type: an identifier, never free text
_REASON = re.compile(r"[a-z_]{1,60}")
# Evidence (decision 10): a command is only matched, never sent; from its output only a sha or a PR URL is taken.
_COMMIT_CMD = re.compile(r"(?:^|[\s;&|(])git\s+(?:-C\s+(\"[^\"]*\"|'[^']*'|\S+)\s+)?commit\b")
_PR_CMD = re.compile(r"(?:^|[\s;&|(])gh\s+pr\s+create\b")
_COMMIT_OUT = re.compile(r"^\[[^\]\n]*?\b([0-9a-f]{7,40})\]", re.M)  # git commit's "[main 1a2b3c4] ..."
_PR_OUT = re.compile(r"https://github\.com/([A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100})/pull/(\d{1,7})\b")


def _load(name: str):
    """A mission module loaded by path, or None when it can't be (then the hook does what it can without it)."""
    try:
        spec = importlib.util.spec_from_file_location(f"_mission_{name}", MISSION_SRC / f"{name}.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except Exception:
        return None


class Hook:
    """One firing: the payload, the shared modules, and the binding it reports under."""

    def __init__(self, payload: dict, local, labels):
        self.p = payload
        self.L = local
        self.labels = labels
        self.sid = payload.get("session_id")
        self.cwd = str(payload.get("cwd") or os.getcwd())
        self.event = payload.get("hook_event_name")
        self.key = None
        self.binding = None
        self.claimed = False

    # --- the binding -------------------------------------------------------------------------------------------

    def resolve(self) -> bool:
        """Find the binding this session reports under, re-binding on SessionStart in an attached cwd and claiming
        a binding /mission attach left waiting. This runs whether or not reporting is on: the binding is the one
        thing the hook keeps while off. Unattached sessions read the file and write nothing."""
        bindings = self.L.load_bindings()
        here = self.L.cwd_key(self.cwd)
        key = here if self.event == "SessionStart" and here in bindings else self.L.find(bindings, self.cwd, self.sid)
        if key is None:
            return False
        if bindings[key].get("session_id") != self.sid:  # a new session in an attached cwd, or an attach waiting
            with self.L.bindings_for_update() as fresh:
                if key not in fresh:
                    return False
                self.claimed = not fresh[key].get("session_id") and self.event != "SessionStart"
                self.L.rebind(fresh[key], self.sid)
                bindings = fresh
        self.key, self.binding = key, dict(bindings[key])
        return True

    # --- shared fields -----------------------------------------------------------------------------------------

    def tool(self) -> str:
        name = str(self.p.get("tool_name") or "")
        return name if _NAME.fullmatch(name) else "tool"

    def label(self) -> str:
        """The tool call's label from labels.describe(), cleaned to the contract; the tool's name without it."""
        tool = self.tool()
        try:
            title, detail = self.labels.describe(tool, self.p.get("tool_input"))
            text = f"{title} · {detail}" if detail else title
        except Exception:  # labels.py missing or broken: the name is still an honest label
            text = tool
        return self.L.clean(text, 240) or tool

    def model(self) -> str | None:
        """message.model of the newest assistant line in the last 64 KB of the transcript, and nothing else."""
        path = self.p.get("transcript_path")
        if not isinstance(path, str) or not path:
            return None
        try:
            with open(path, "rb") as f:
                size = f.seek(0, os.SEEK_END)
                start = max(0, size - TAIL_BYTES)
                f.seek(start)
                lines = f.read(TAIL_BYTES).split(b"\n")
        except (OSError, ValueError):
            return None
        for raw in reversed(lines[1:] if start else lines):  # a cut first line is not JSON
            model = _assistant_model(raw)
            if model:
                return self.L.clean(model, 80) or None
        return None

    def common(self) -> dict:
        body = self.L.common(self.binding, self.cwd)
        body["model"] = self.model()
        effort = self.p.get("effort")
        level = effort.get("level") if isinstance(effort, dict) else None
        if level in EFFORTS:
            body["effort"] = level
        agent = self.p.get("agent_id")
        if isinstance(agent, str) and _NAME.fullmatch(agent):
            body["agent_id"] = agent
        return body

    # --- one handler per hook event: each returns [(type, type fields)] ----------------------------------------

    def session_start(self) -> list:
        self.L.prune_state()
        source = self.p.get("source")
        body = self.L.attached_body(self.binding, self.key, source if source in START_SOURCES else "startup")
        return [("session.attached", body)]

    def session_end(self) -> list:
        reason = self.p.get("reason")
        return [("session.ended", {"reason": reason} if isinstance(reason, str) and _REASON.fullmatch(reason) else {})]

    def prompt(self) -> list:
        prompt_id = self.p.get("prompt_id")
        prompt_id = prompt_id if self.L.is_uuid(prompt_id) else str(uuid.uuid4())
        self.L.put_state(f"prompt-{self.sid}", prompt_id)
        return [("turn.started", {"prompt_id": prompt_id})]

    def stop(self) -> list:
        prompt_id = self.L.take_state(f"prompt-{self.sid}", keep=True)  # a blocked Stop fires again for the turn
        return [("turn.finished", {"prompt_id": prompt_id} if self.L.is_uuid(prompt_id) else {})]

    def _tool_use_id(self) -> str | None:
        tuid = self.p.get("tool_use_id")
        return tuid if isinstance(tuid, str) and _NAME.fullmatch(tuid) else None

    def pre_tool(self) -> list:
        tuid = self._tool_use_id()
        if tuid is None or self.tool() in SKIP_TOOLS:
            return []
        self.L.put_state(f"tool-{tuid}", str(int(time.time() * 1000)))
        return [("tool.running", {"tool_use_id": tuid, "tool": self.tool(), "label": self.label()})]

    def post_tool(self) -> list:
        tuid = self._tool_use_id()
        if tuid is None or self.tool() in SKIP_TOOLS:
            return []
        body = {"tool_use_id": tuid, "tool": self.tool(), "label": self.label()}
        duration = self._duration(tuid)
        if duration is not None:
            body["duration_ms"] = duration
        if self.event == "PostToolUseFailure":
            body["failed"] = True
            return [("tool.finished", body)]
        return [("tool.finished", body)] + self.subagent_detail() + self.evidence()

    def _duration(self, tuid: str) -> int | None:
        given = self.p.get("duration_ms")
        started = self.L.take_state(f"tool-{tuid}")
        if isinstance(given, int) and not isinstance(given, bool):
            ms = given
        elif started and started.isdigit():
            ms = int(time.time() * 1000) - int(started)
        else:
            return None
        return ms if 0 <= ms <= 86400000 else None

    def permission(self) -> list:
        return [("waiting.owner", {"tool": self.tool(), "label": self.label()})]

    def _agent(self) -> tuple[str, str] | None:
        agent_id, agent_type = self.p.get("agent_id"), self.p.get("agent_type")
        if not (isinstance(agent_id, str) and _NAME.fullmatch(agent_id)):
            return None
        return agent_id, agent_type if isinstance(agent_type, str) and _NAME.fullmatch(agent_type) else "agent"

    def subagent_start(self) -> list:
        agent = self._agent()
        if agent is None:
            return []
        self.L.put_state(f"agent-{agent[0]}", agent[1])  # the Agent call's PostToolUse names the type with it
        return [("subagent.started", {"agent_id": agent[0], "agent_type": agent[1]})]

    def subagent_stop(self) -> list:
        agent = self._agent()
        return [("subagent.finished", {"agent_id": agent[0], "agent_type": agent[1]})] if agent else []

    def subagent_detail(self) -> list:
        """The subagent's model, tokens and duration, from the Agent call's tool_response (§21.1), as a
        subagent.finished for the same agent_id. Only those three fields and agentId are read from it."""
        r = self.p.get("tool_response")
        if self.tool() not in AGENT_TOOLS or not isinstance(r, dict):
            return []
        agent_id = r.get("agentId")
        if not (isinstance(agent_id, str) and _NAME.fullmatch(agent_id)):
            return []
        body = {"agent_id": agent_id, "agent_type": self.L.take_state(f"agent-{agent_id}") or "agent"}
        model = self.L.clean(r.get("resolvedModel"), 80) if isinstance(r.get("resolvedModel"), str) else ""
        if model:
            body["subagent_model"] = model
        for field, key, top in (("tokens", "totalTokens", 100000000), ("duration_ms", "totalDurationMs", 86400000)):
            n = r.get(key)
            if isinstance(n, int) and not isinstance(n, bool) and 0 <= n <= top:
                body[field] = n
        return [("subagent.finished", body)]

    def evidence(self) -> list:
        """evidence.reported for a `git commit` or `gh pr create` that ran here, by fixed patterns only."""
        inp, r = self.p.get("tool_input"), self.p.get("tool_response")
        if self.tool() != "Bash" or not isinstance(inp, dict):
            return []
        command = str(inp.get("command") or "")
        out = str(r.get("stdout") or "") if isinstance(r, dict) else str(r or "")
        found = []
        commit, sha = _COMMIT_CMD.search(command), _COMMIT_OUT.search(out)
        if commit and sha:
            repo = self.L.remote(_git_dir(self.cwd, commit.group(1)))
            if repo:
                found.append(("evidence.reported", {"kind": "commit", "repo": repo, "sha": sha.group(1)}))
        pr = _PR_OUT.search(out) if _PR_CMD.search(command) else None
        if pr and 1 <= int(pr.group(2)) <= 1000000:
            found.append(("evidence.reported", {"kind": "pr", "repo": pr.group(1), "pr": int(pr.group(2))}))
        return found

    HANDLERS = {
        "SessionStart": session_start, "SessionEnd": session_end, "UserPromptSubmit": prompt, "Stop": stop,
        "PreToolUse": pre_tool, "PostToolUse": post_tool, "PostToolUseFailure": post_tool,
        "PermissionRequest": permission, "SubagentStart": subagent_start, "SubagentStop": subagent_stop,
    }

    def events(self) -> list[dict]:
        """The events this firing spools, each as spool.append takes it."""
        handler = self.HANDLERS.get(self.event)
        if handler is None:
            return []
        pairs = handler(self)
        if self.claimed:  # the first firing after /mission attach without a session id completes the attach
            pairs = [("session.attached", self.L.attached_body(self.binding, self.key, "attach"))] + pairs
        if not pairs:
            return []
        common = self.common()
        initiative = self.binding["initiative"]
        return [self.L.event(etype, initiative, {**common, **fields}) for etype, fields in pairs]


def _assistant_model(raw: bytes) -> str | None:
    try:
        entry = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(entry, dict) or entry.get("type") != "assistant" or not isinstance(entry.get("message"), dict):
        return None
    model = entry["message"].get("model")
    return model if isinstance(model, str) and model and not model.startswith("<") else None  # not "<synthetic>"


def _git_dir(cwd: str, dash_c: str | None) -> str:
    """The directory a `git [-C dir] commit` ran in, so a commit is credited to its own repo."""
    if not dash_c:
        return cwd
    try:
        path = shlex.split(dash_c)[0]
    except (ValueError, IndexError):
        return cwd
    return os.path.join(cwd, os.path.expanduser(path))


def _drain_idle(local) -> bool:
    """True when no process holds the drain's lock (a racing start is harmless: the loser reports busy)."""
    try:
        path = local.lock_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(path, os.O_CREAT | os.O_RDWR, 0o600)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except OSError:
        return False
    finally:
        os.close(fd)


def _start_drain(local) -> None:
    argv = local.drain_argv()
    if argv is None or not _drain_idle(local):
        return
    subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True, close_fds=True, cwd="/")


def _valid(validate, event: dict) -> bool:
    """The contract's own check, as a guard: a hook bug must not put a refused event in the spool. Without the
    validator (it didn't load, or can't read the contract) the event is spooled and the drain's post decides."""
    try:
        return validate is None or not validate.validate_event(SOURCE, event)
    except Exception:
        return True


def main() -> None:
    payload = json.load(sys.stdin)
    local = _load("local")
    if not isinstance(payload, dict) or local is None or not local.is_uuid(payload.get("session_id")):
        return
    hook = Hook(payload, local, _load("labels"))
    if not hook.resolve() or not local.enabled()[0]:
        return
    spool = _load("spool")
    if spool is None:
        return
    validate = _load("validate")
    wrote = 0
    for event in hook.events():
        if _valid(validate, event):
            spool.append(event, SOURCE)
            wrote += 1
    if wrote:
        _start_drain(local)


if __name__ == "__main__":
    signal.signal(signal.SIGALRM, lambda *_: os._exit(0))
    signal.setitimer(signal.ITIMER_REAL, LIMIT_S)
    sys.stdout = open(os.devnull, "w")  # Claude Code reads a hook's stdout as a decision; this hook has none
    try:
        main()
    except Exception:
        pass
    sys.exit(0)
