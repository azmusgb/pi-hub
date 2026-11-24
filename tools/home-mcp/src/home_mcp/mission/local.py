"""The Mac-local mission files the hook and the CLI share: the config, the attach binding and the hook's small state
files, plus the cleaning and git reads every claude event needs. Standard library only, with no relative imports:
claude/hooks/mission-report.py loads this file by path, because importing home_mcp would pull in httpx."""
import fcntl
import json
import os
import re
import subprocess
import tempfile
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

LINEAGE_MAX = 20  # the contract's list:uuid:20
GIT_TIMEOUT = 1.0
STATE_MAX_AGE_S = 86400  # a tool start or prompt id older than a day belongs to a session that is gone
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_SLUG = re.compile(r"[a-z0-9][a-z0-9-]{1,39}")
_REPO = re.compile(r"[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}")
# owner/name at the end of an origin URL: https://github.com/o/n(.git), git@github.com:o/n.git, ssh://.../o/n
_REMOTE_TAIL = re.compile(r"[:/]([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?/?$")
_STATE_NAME = re.compile(r"[^A-Za-z0-9_.-]")


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


def _path(env: str, default: str) -> Path:
    return Path(os.environ.get(env) or default).expanduser()


def config_path() -> Path:
    return _path("HOME_MISSION_CONFIG", "~/.claude/mission-config.json")


def lock_path() -> Path:
    return _path("HOME_MISSION_LOCK", "~/.claude/mission-drain.lock")


def log_path() -> Path:
    return _path("HOME_MISSION_LOG", "~/.claude/mission-drain.log")


def attach_path() -> Path:
    return _path("HOME_MISSION_ATTACH", "~/.claude/mission-attach.json")


def state_dir() -> Path:
    return _path("HOME_MISSION_STATE", "~/.claude/mission-state")


def _config() -> tuple[dict | None, str]:
    try:
        cfg = json.loads(config_path().read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None, "no mission-config.json, so mission reporting is off"
    except (OSError, ValueError):
        return None, "mission-config.json is unreadable, so mission reporting is off"
    return (cfg, "") if isinstance(cfg, dict) else (None, "mission-config.json is not an object, so reporting is off")


def enabled() -> tuple[bool, str]:
    """(on, why). Off unless the config file says `"enabled": true`; an unreadable file is off, and says so."""
    cfg, why = _config()
    if cfg is None:
        return False, why
    if cfg.get("enabled") is not True:
        return False, "mission reporting is off (enabled is not true)"
    return True, ""


def drain_argv() -> list[str] | None:
    """The drain command the install script wrote, or None when there is none (then nothing is spawned)."""
    cfg, _ = _config()
    argv = cfg.get("drain") if cfg else None
    ok = isinstance(argv, list) and argv and all(isinstance(a, str) and a for a in argv)
    return argv if ok else None


def is_uuid(value) -> bool:
    return isinstance(value, str) and _UUID.fullmatch(value) is not None


def is_slug(value) -> bool:
    return isinstance(value, str) and _SLUG.fullmatch(value) is not None


def clean(text, limit: int) -> str:
    """One line of contract text: control characters gone, all whitespace (newlines too) collapsed to single
    spaces, cut to `limit` characters with an ellipsis. '' when nothing printable is left."""
    text = "".join(c if c.isprintable() or c.isspace() else " " for c in str(text or ""))
    text = " ".join(text.split())
    return text if len(text) <= limit else text[:limit - 1].rstrip() + "…"


def _git(cwd: str, *args: str) -> str | None:
    try:
        r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=GIT_TIMEOUT,
                           stdin=subprocess.DEVNULL)
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def branch(cwd: str) -> str | None:
    """The checked-out branch, or None (detached head, not a repo, git missing or slower than 1 s)."""
    name = clean(_git(cwd, "branch", "--show-current"), 120)
    return name or None


def remote(cwd: str) -> str | None:
    """owner/name of origin, or None when there is no origin or it doesn't end in owner/name."""
    url = _git(cwd, "remote", "get-url", "origin")
    m = _REMOTE_TAIL.search(url or "")
    if m is None:
        return None
    repo = f"{m.group(1)}/{m.group(2)}"
    return repo if _REPO.fullmatch(repo) else None


def cwd_key(cwd: str) -> str:
    return os.path.realpath(cwd)


def _write_json(path: Path, data) -> None:
    """Write `data` as `path` atomically: a temp file in the same directory renamed over it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, sort_keys=True)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def load_bindings() -> dict:
    """{cwd realpath: binding}. A missing or unreadable file is no bindings: nothing reports."""
    try:
        data = json.loads(attach_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in data.items() if isinstance(v, dict) and is_slug(v.get("initiative"))} \
        if isinstance(data, dict) else {}


@contextmanager
def bindings_for_update():
    """The bindings under an exclusive flock on a sidecar file, written back when the caller changed them."""
    path = attach_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(f"{path}.lock", os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        data = load_bindings()
        before = json.dumps(data, sort_keys=True)
        yield data
        if json.dumps(data, sort_keys=True) != before:
            _write_json(path, data)
    finally:
        os.close(fd)


def find(bindings: dict, cwd: str, session_id: str) -> str | None:
    """The key of the binding this session reports under: the one holding its session id (wherever the session has
    since cd'd), else a binding for its cwd that /mission attach left waiting for a session id."""
    for key, b in bindings.items():
        if b.get("session_id") == session_id:
            return key
    key = cwd_key(cwd)
    return key if key in bindings and not bindings[key].get("session_id") else None


def rebind(binding: dict, session_id: str) -> None:
    """Point a binding at a new session, keeping the old id in its lineage (newest last, at most 20)."""
    old = binding.get("session_id")
    lineage = [x for x in binding.get("lineage", []) if is_uuid(x)]
    if is_uuid(old) and old != session_id and old not in lineage:
        lineage.append(old)
    binding["session_id"] = session_id
    binding["lineage"] = lineage[-LINEAGE_MAX:]


def common(binding: dict, cwd: str) -> dict:
    """The session fields every claude event carries that come from the binding and git."""
    body = {"session_id": binding["session_id"]}
    name = branch(cwd) or binding.get("branch")
    if name:
        body["branch"] = name
    if binding.get("remote"):
        body["remote"] = binding["remote"]
    return body


def attached_body(binding: dict, key: str, start_source: str) -> dict:
    """The type fields of session.attached for a binding."""
    body = {"cwd_name": clean(os.path.basename(key.rstrip("/")) or "/", 120), "start_source": start_source}
    if binding.get("workstream"):
        body["workstream"] = binding["workstream"]
    if binding.get("lineage"):
        body["lineage"] = binding["lineage"]
    return body


def event(etype: str, initiative: str, body: dict) -> dict:
    """A claude event with its uuid4 event_id fixed now (decision 7), so a drain that retries resends the same id."""
    return {"event_id": str(uuid.uuid4()), "type": etype, "at": now_iso(), "initiative": initiative, "body": body}


def _state_file(name: str) -> Path:
    return state_dir() / _STATE_NAME.sub("_", name)[:120]


def put_state(name: str, value: str) -> None:
    """Remember a short value (a tool's start time, a prompt id, an agent's type) for a later hook firing."""
    path = _state_file(name)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(value)
    os.replace(tmp, path)


def take_state(name: str, keep: bool = False) -> str | None:
    """A value put_state stored, removed unless `keep`; None when there is none."""
    path = _state_file(name)
    try:
        value = path.read_text(encoding="utf-8")
        if not keep:
            path.unlink()
    except OSError:
        return None
    return value


def prune_state(now: float | None = None) -> None:
    """Remove state older than a day (a tool whose PostToolUse never came, a session that ended unseen)."""
    now = time.time() if now is None else now
    try:
        entries = list(os.scandir(state_dir()))
    except OSError:
        return
    for e in entries:
        try:
            if now - e.stat().st_mtime > STATE_MAX_AGE_S:
                os.unlink(e.path)
        except OSError:
            continue
