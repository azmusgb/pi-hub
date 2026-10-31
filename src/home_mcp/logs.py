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

MAX_LINE = 1000
MAX_SCAN = 65_536  # a backstop on regex work; far beyond MAX_LINE, so nothing near the cut is ever returned
# Secret-like names, matched as the word itself at any non-alphanumeric boundary, so the last part of a compound
# name counts too (access_token, client_secret, FOO_API_KEY, x-hub-mac-key, --password).
SECRET_WORD = r"(?:authorization|bearer|api[_-]?key|key|token|secret|password|passwd|pin)"
# In a URL query, signatures and one-time codes are secrets too; elsewhere "code" is usually an exit or HTTP code.
QUERY_WORD = rf"(?:{SECRET_WORD}|sig|signature|code)"


def _opaque(m: re.Match) -> str:
    """A long run of token characters is a secret when it mixes letters and digits; a 40-hex commit SHA is kept."""
    run = m.group(0)
    if re.fullmatch(r"[0-9a-f]{40}", run) or not (re.search(r"\d", run) and re.search(r"[A-Za-z]", run)):
        return run
    return "[redacted]"


def _hidden(value: str) -> str:
    """A secret value replaced: a quoted one keeps its quotes; a bare one is hidden up to whitespace, a quote, a
    comma or a semicolon, and only closing brackets at its very end are put back ({'token': x}), so a value such as
    ab}cd is hidden whole."""
    if value[0] in "\"'":
        return value[0] + "[redacted]" + value[0]
    tail = re.search(r"[}\])]*$", value).group(0)
    return "[redacted]" + tail


# Every pattern starts a match only at a boundary and scans forward once, so the work is linear in the line.
REDACTIONS = [
    (re.compile(r"(?i)\b(bearer|basic)\s+[^\s\"',;]+"), r"\1 [redacted]"),
    # URL query parameters: the value ends at the next &, so the other parameters stay readable.
    (re.compile(rf"(?i)([?&][A-Za-z0-9_-]*?(?<![A-Za-z0-9]){QUERY_WORD}=)[^&\s]+"), r"\1[redacted]"),
    # Anywhere else: the key (bare, or quoted as in JSON and Python reprs, where its closing quote comes before the
    # separator), then ":" or "=" or a space, then the value. A quoted value is hidden whole, spaces and all
    # (password="two words", {'password': 'x'}); a bare one runs to whitespace, a quote, a comma, a semicolon or a
    # closing bracket at its end, so a password with & or } inside is hidden whole. A value the query rule already replaced is left alone.
    (re.compile(rf"(?i)(?<![A-Za-z0-9])({SECRET_WORD})([\"']?\s*[:=]\s*|\s+)(?!\[redacted\])"
                r"(\"[^\"]*\"?|'[^']*'?|[^\s\"',;]+)"),
     lambda m: m.group(1) + m.group(2) + _hidden(m.group(3))),
    # Long opaque tokens, judged whole by _opaque. Path segments and dotted names are not runs on their own.
    (re.compile(r"(?<![/\w.-])[A-Za-z0-9+_-]{40,}={0,2}"), _opaque),
]


CUT_MARK = " [cut]"


def redact_line(line: str) -> tuple[str, bool]:
    """One log line with secret values replaced, then cut to MAX_LINE characters: redacting the whole line first
    means a cut can never leave part of a secret behind. Returns the line and whether any of it was cut; a cut line
    ends with " [cut]"."""
    cut = False
    if len(line) > MAX_SCAN:
        cut = True
        # Redacting a long secret shortens the line and can pull text near the cut into what is returned, so drop
        # the token the cut split rather than risk returning part of it.
        head = line[:MAX_SCAN]
        cut = max(head.rfind(" "), head.rfind("\t"))
        line = (head[:cut] if cut > 0 else "") + " [truncated]"
    for pattern, repl in REDACTIONS:
        line = pattern.sub(repl, line)
    if len(line) > MAX_LINE:
        line, cut = line[:MAX_LINE - len(CUT_MARK)] + CUT_MARK, True
    return line, cut


def redact(line: str) -> str:
    return redact_line(line)[0]


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
    done = [redact_line(line) for line in r.out.splitlines() if line.strip() and line.strip() != "-- No entries --"]
    if contains:
        done = [(line, cut) for line, cut in done if contains.lower() in line.lower()]
    # The budget is UTF-8 bytes as sent (each line plus its newline), not characters.
    kept, size, dropped = [], 0, 0
    for i, (line, cut) in enumerate(reversed(done)):  # keep the newest lines when the byte cap bites
        n = len(line.encode("utf-8")) + 1
        if size + n > MAX_BYTES:
            dropped = len(done) - i
            break
        kept.append((line, cut))
        size += n
    kept.reverse()
    shortened = sum(1 for _, cut in kept if cut)
    # Every way the answer is less than the log: older lines dropped for the byte cap, and long lines cut.
    out.update(lines=[line for line, _ in kept], count=len(kept), truncated=bool(dropped or shortened),
               lines_dropped=dropped, lines_shortened=shortened, bytes=size)
    return out
