"""Bounded, redacted logs from an allowlist of services. Each command is fixed here; callers choose only which
service, how far back and how many lines, all validated, and filtering happens locally."""
import re

from . import shell
from .deploy import Runner
from .hub import now_iso

MAX_BYTES = 20_000

# service -> (machine, kind, name). journal: a systemd unit on the Pi; docker: a container on the PC;
# file: a log file on the PC (no time window; the newest lines only).
SERVICES = {
    "pi-hub": ("pi", "journal", "pi-hub"),
    "pi-hub-helper": ("pi", "journal", "pi-hub-helper"),
    "pi-hub-selfcheck": ("pi", "journal", "pi-hub-selfcheck"),
    "pi-hub-backup": ("pi", "journal", "pi-hub-backup"),
    "pi-hub-rollback": ("pi", "journal", "pi-hub-rollback"),
    "pi-status": ("pi", "journal", "pi-status"),
    "caddy": ("pi", "journal", "caddy"),
    "x2d-camera-bridge": ("pi", "journal", "x2d-camera-bridge"),
    "x2d-camera-failover": ("pi", "journal", "x2d-camera-failover"),
    "localai": ("pc", "docker", "local-ai-appliance"),
    "localai-https": ("pc", "docker", "local-ai-https"),
    "localai-sandbox": ("pc", "docker", "local-ai-sandbox-api"),
    "localai-ollama-proxy": ("pc", "docker", "local-ai-ollama-responses-proxy"),
    "localai-deploy": ("pc", "file", r"C:\LocalAI\.deploy\auto-deploy.log"),
}

REDACTIONS = [
    (re.compile(r"(?i)\b(bearer|basic)\s+[^\s\"',;]+"), r"\1 [redacted]"),
    # A secret-like key name, alone or as the last part of a compound one (access_token, FOO_API_KEY, x-hub-mac-key).
    (re.compile(r"(?i)(?<![A-Za-z0-9])((?:[A-Za-z0-9]+[_-])*(?:authorization|bearer|api[_-]?key|key|token|secret|"
                r"password|passwd|pin))"
                r"(\"?\s*[:=]\s*\"?|\s+)([^\s\"',;&]+)"), r"\1\2[redacted]"),
    (re.compile(r"(?i)([?&](?:key|token|sig|signature|code)=)[^&\s]+"), r"\1[redacted]"),
    # Long opaque tokens: letters and digits mixed, no path separators. A 40-hex commit SHA is kept.
    (re.compile(r"(?<![/\w.-])(?=[A-Za-z0-9+_=-]*\d)(?=[A-Za-z0-9+_=-]*[A-Za-z])[A-Za-z0-9+_-]{40,}={0,2}"),
     lambda m: m.group(0) if re.fullmatch(r"[0-9a-f]{40}", m.group(0)) else "[redacted]"),
]


def redact(line: str) -> str:
    for pattern, repl in REDACTIONS:
        line = pattern.sub(repl, line)
    return line


def command(service: str, minutes: int, lines: int) -> tuple[str, str]:
    _, kind, name = SERVICES[service]
    if kind == "journal":
        return shell.pi_host(), f"journalctl -u {name} --since -{minutes}min -n {lines} --no-pager -o short-iso"
    if kind == "docker":
        return shell.pc_host(), f"docker logs --timestamps --since {minutes}m --tail {lines} {name} 2>&1"
    return shell.pc_host(), f"powershell -NoProfile -Command \"Get-Content -LiteralPath '{name}' -Tail {lines}\""


async def logs(run: Runner, service: str, minutes: int = 60, lines: int = 100, contains: str | None = None) -> dict:
    if service not in SERVICES:
        raise ValueError(f"service must be one of: {', '.join(sorted(SERVICES))}")
    if not 1 <= minutes <= 1440:
        raise ValueError("minutes must be between 1 and 1440")
    if not 1 <= lines <= 500:
        raise ValueError("lines must be between 1 and 500")
    if contains is not None and not 1 <= len(contains) <= 200:
        raise ValueError("contains must be 1-200 characters")
    host, cmd = command(service, minutes, lines)
    r = await run(shell.ssh(host, cmd), timeout=45)
    out = {"ok": r.code == 0, "service": service, "source": f"{SERVICES[service][1]} on {host}", "as_of": now_iso(),
           "window_minutes": None if SERVICES[service][1] == "file" else minutes}
    if r.code != 0:
        out["errors"] = [{"source": out["source"], "error": "unreachable" if r.code in (None, 255) else "command",
                          "detail": redact((r.err or r.out.strip() or f"exit {r.code}")[:300])}]
        out["lines"] = []
        return out
    # Redact before filtering, so contains can't be used to confirm a hidden value one guess at a time.
    text = [redact(line) for line in r.out.splitlines() if line.strip() and line.strip() != "-- No entries --"]
    if contains:
        text = [line for line in text if contains.lower() in line.lower()]
    kept, size, truncated = [], 0, False
    for line in reversed(text):  # keep the newest lines when the byte cap bites
        line = line[:1000]
        if size + len(line) > MAX_BYTES:
            truncated = True
            break
        kept.append(line)
        size += len(line) + 1
    out.update(lines=list(reversed(kept)), count=len(kept), truncated=truncated)
    return out
